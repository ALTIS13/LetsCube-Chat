"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playNotificationSoundFor } from "@/hooks/useCallSound";
import { ownAlertPolicySnapshot } from "@/hooks/useOwnPresence";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { mapPgError } from "@/lib/errors";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { KUB_CHAT_NOTIFICATIONS_READ_EVENT, type ChatNotificationsReadDetail } from "@/lib/notificationEvents";
import { markChatMessageNotificationsRead } from "@/lib/notificationReadSync";
import { mergeNotificationRows, rollbackFailedNotificationReads } from "@/lib/notificationRows";
import {
  closeBrowserNotification,
  notificationPresentationTag,
  updateBrowserAppBadge,
} from "@/lib/browserNotificationPresentation";
import { getDesktopBridge, isDesktopApp } from "@/lib/platform/desktop";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { closeNativeChatNotification } from "@/lib/platform/nativePush";
import {
  closeDesktopNotificationForRow,
  desktopMessageOverflowRows,
  showDesktopNotificationForRow,
} from "@/lib/platform/desktopNotifications";
import type { Notification } from "@/types/database";
import { isSelfMessageNotification } from "@/lib/messageNotificationProjection";

const PAGE_SIZE = 30;

type DesktopCardIdentity = Parameters<NonNullable<ReturnType<typeof getDesktopBridge>>["removeNotification"]>[0];
type DesktopCardQueue = {
  identity: DesktopCardIdentity;
  pending: Promise<void>;
  card: { owner: Set<string>; rowId: string } | null;
};

// The bell unmounts on public/auth routes; native operations outlive that hook.
// This ledger survives React remounts, not a hard WebView/document reload.
const desktopCardQueues = new Map<string, DesktopCardQueue>();
const desktopCardOwners = new Set<Set<string>>();

// Windows removal has no revision/CAS: serialize it with replacements of the
// same native identity, including notifications still awaiting their bridge ACK.
function queueDesktopCard(
  queues: Map<string, DesktopCardQueue>,
  identity: DesktopCardIdentity,
  action: (queue: DesktopCardQueue) => Promise<boolean>,
): Promise<boolean> {
  const key = `${identity.kind}:${identity.group}:${identity.id}`;
  let queue = queues.get(key);
  if (!queue) {
    queue = {
      identity: { id: identity.id, kind: identity.kind, group: identity.group },
      pending: Promise.resolve(), card: null,
    };
    queues.set(key, queue);
  }
  const current = queue;
  const operation = current.pending.then(() => action(current));
  const pending = operation.then(() => undefined, () => undefined);
  current.pending = pending;
  void pending.then(() => {
    if (current.pending === pending && !current.card) queues.delete(key);
  });
  return operation;
}

function payloadString(p: unknown, key: string): string | undefined {
  if (!p || typeof p !== "object") return undefined;
  const v = (p as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * In-app notifications for the current user (Task #32).
 *
 * Loads the latest 30 rows from `public.notifications` and stays in
 * sync via a per-user realtime channel:
 *   • INSERT → prepend, bump unread count.
 *   • UPDATE → replace in place (mark-read flow flips `read_at`).
 *
 * Server-only inserts: clients can't insert into `notifications`
 * directly (no RLS write policy); rows arrive via the SECURITY
 * DEFINER `_notify` helper called by triggers on tasks/chat_members/
 * bans/mutes. Mark-as-read goes through the
 * `notifications_mark_read*` RPCs.
 *
 * Race-safety: the initial fetch and the realtime channel both
 * mutate state, and the channel can deliver an INSERT before the
 * fetch resolves. We therefore never blind-replace state — both
 * paths go through `mergeRows` which dedupes by id and re-sorts by
 * `created_at desc`, then truncates back to PAGE_SIZE so the bell
 * stays bounded.
 */
export function useNotifications() {
  const supabase = createClient();
  // Narrow primitives keep heartbeat updates inert while observing session replacement.
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const accountEpoch = useAppStore((s) => s.accountEpoch);
  const mutedChatIds = useAppStore((s) => s.mutedChatIds);

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoMarkingReadRef = useRef<Set<string>>(new Set());
  const unreadPresentationTagsRef = useRef<Map<string, string>>(new Map());
  const unreadDesktopIdsRef = useRef<Map<string, Notification>>(new Map());
  const trimmedDesktopIdsRef = useRef<Set<string>>(new Set());
  const presentedDesktopIdsRef = useRef<Set<string>>(new Set());
  const desktopBaselineLoadedRef = useRef(false);
  const accountGenerationRef = useRef(0);

  const presentDesktopNotification = useCallback((row: Notification) => {
    if (!userId || row.user_id !== userId) return;
    const handled = presentedDesktopIdsRef.current;
    let quiet = false;
    const mayDeliver = () => {
      if (handled !== presentedDesktopIdsRef.current || useAppStore.getState().accountEpoch !== accountEpoch) return false;
      const policy = ownAlertPolicySnapshot(userId);
      if (policy === "quiet") quiet = true;
      return policy === "allow";
    };
    if (!mayDeliver()) {
      if (quiet) handled.add(row.id);
      return;
    }
    handled.add(row.id);
    void showDesktopNotificationForRow(row, async () => {
      const bridge = getDesktopBridge();
      if (!bridge) throw new Error("desktop_runtime_unavailable");
      return {
        // Foreground resolution above this boundary may have awaited a status/account change.
        sendNotification: (payload) => queueDesktopCard(desktopCardQueues, payload, async (queue) => {
          if (!mayDeliver()) return false;
          const delivered = await bridge.notify(payload);
          if (delivered) queue.card = { owner: handled, rowId: row.id };
          return delivered;
        }),
      };
    }).then((delivered) => {
      if (!delivered && !quiet) handled.delete(row.id);
    });
  }, [userId, accountEpoch]);

  const closeDesktopNotification = useCallback((row: Notification) => {
    const owner = presentedDesktopIdsRef.current;
    void closeDesktopNotificationForRow(row, async () => {
      const bridge = getDesktopBridge();
      if (!bridge) throw new Error("desktop_runtime_unavailable");
      return {
        sendNotification: async () => false,
        removeNotification: (identity) => queueDesktopCard(desktopCardQueues, identity, async (queue) => {
          const state = useAppStore.getState();
          if (owner !== presentedDesktopIdsRef.current || state.currentUser?.id !== row.user_id || state.accountEpoch !== accountEpoch) return false;
          if (queue.card && (queue.card.owner !== owner || queue.card.rowId !== row.id)) return false;
          const removed = await bridge.removeNotification(identity);
          if (removed) queue.card = null;
          return removed;
        }),
      };
    });
  }, [accountEpoch]);

  useEffect(() => {
    accountGenerationRef.current += 1;
    setItems([]);
    unreadPresentationTagsRef.current = new Map();
    unreadDesktopIdsRef.current = new Map();
    trimmedDesktopIdsRef.current = new Set();
    presentedDesktopIdsRef.current = new Set();
    desktopBaselineLoadedRef.current = false;
    const owner = presentedDesktopIdsRef.current;
    desktopCardOwners.add(owner);
    return () => {
      accountGenerationRef.current += 1;
      desktopCardOwners.delete(owner);
      if (presentedDesktopIdsRef.current === owner) presentedDesktopIdsRef.current = new Set();
      for (const queue of desktopCardQueues.values()) {
        void queueDesktopCard(desktopCardQueues, queue.identity, async (current) => {
          if (!current.card || desktopCardOwners.has(current.card.owner)) return false;
          const removed = await getDesktopBridge()?.removeNotification(current.identity);
          if (removed) current.card = null;
          return removed ?? false;
        }).catch(() => undefined);
      }
    };
  }, [userId, accountEpoch]);

  const markReadIds = useCallback(async (ids: string[], options: { silent?: boolean } = {}) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return;

    const idsToMark = uniqueIds.filter((id) => !autoMarkingReadRef.current.has(id));
    if (!idsToMark.length) return;
    for (const id of idsToMark) autoMarkingReadRef.current.add(id);

    const snapshot = new Map<string, string | null>();
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => {
        if (!idsToMark.includes(n.id)) return n;
        snapshot.set(n.id, n.read_at);
        return n.read_at ? n : { ...n, read_at: nowIso };
      }),
    );

    const failedIds = new Set<string>();
    for (const id of idsToMark) {
      const { error: rpcErr } = await supabase.rpc("notifications_mark_read", { p_id: id });
      if (rpcErr) {
        failedIds.add(id);
        if (!options.silent) setError(mapPgError(rpcErr));
      }
      autoMarkingReadRef.current.delete(id);
    }

    if (failedIds.size > 0) {
      setItems((prev) => rollbackFailedNotificationReads(prev, snapshot, failedIds));
    }
  }, [supabase]);

  const normalizeRowsForDisplay = useCallback((rows: Notification[]) => {
    const ownUnreadIds = rows
      .filter((row) => !row.read_at && isOwnMessageNotification(row, userId))
      .map((row) => row.id);
    if (ownUnreadIds.length) void markReadIds(ownUnreadIds, { silent: true });
    return filterRowsForDisplay(rows, userId, mutedChatIds);
  }, [markReadIds, mutedChatIds, userId]);

  const refresh = useCallback(async (options: { presentNewDesktop?: boolean } = {}) => {
    if (!userId) {
      setItems([]);
      return;
    }
    const generation = accountGenerationRef.current;
    setLoading(true);
    bumpFetch("useNotifications");
    const { data, error: err } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (generation !== accountGenerationRef.current || useAppStore.getState().currentUser?.id !== userId) return;
    setLoading(false);
    if (err) {
      setError(mapPgError(err));
      return;
    }
    setError(null);
    const nextRows = normalizeRowsForDisplay((data ?? []) as Notification[]);
    if (isDesktopApp()) {
      if (!desktopBaselineLoadedRef.current) {
        for (const row of nextRows) presentedDesktopIdsRef.current.add(row.id);
        desktopBaselineLoadedRef.current = true;
      } else if (options.presentNewDesktop) {
        for (const row of nextRows) {
          if (row.read_at || presentedDesktopIdsRef.current.has(row.id)) continue;
          presentDesktopNotification(row);
        }
      }
    }
    setItems((prev) => filterRowsForDisplay(mergeNotificationRows(prev, nextRows, PAGE_SIZE), userId, mutedChatIds));
  }, [userId, supabase, normalizeRowsForDisplay, mutedChatIds, presentDesktopNotification]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    let subscribedOnce = false;
    void refresh().then(() => {
      if (cancelled) return;
      // Merge — never replace — so any realtime INSERTs that landed before
      // this fetch resolved aren't dropped. `refresh` itself already merges.
    });

    const channelName = `notifications:${userId}`;
    registerChannel(channelName);
    const ch = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (cancelled || useAppStore.getState().currentUser?.id !== userId) return;
          const row = payload.new as Notification;
          if (row.kind === "chat_added" || row.kind === "group_invite") {
            dispatchChatsRefresh({
              reason: "chat-notification",
              chatId: payloadString(row.payload, "chat_id"),
            });
          }
          if (isOwnMessageNotification(row, userId)) {
            if (!row.read_at) void markReadIds([row.id], { silent: true });
            return;
          }
          if (isMutedNotification(row, mutedChatIds)) return;
          // After the two refusals above and before anything is drawn: a
          // notification that is this reader's own echo, or one from a muted
          // conversation, must not make a sound either — and both have already
          // returned. Whether this one does is `notificationSoundAllowed`'s,
          // which also refuses a ping over a ringtone and a ping for the
          // conversation being read right now.
          //
          // `osToast` is the same condition the desktop branch below runs on,
          // written once and read twice rather than guessed: the Windows
          // application raises a real toast for this row and Windows sounds it,
          // so a second sound from here would be two for one message.
          const osToast =
            isDesktopApp() && !row.read_at && !presentedDesktopIdsRef.current.has(row.id);
          playNotificationSoundFor({ chatId: payloadString(row.payload, "chat_id") ?? null, osToast });
          setItems((prev) => mergeNotificationRows(prev, [row], PAGE_SIZE));
          if (osToast) {
            presentDesktopNotification(row);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (cancelled || useAppStore.getState().currentUser?.id !== userId) return;
          const row = payload.new as Notification;
          setItems((prev) => prev.map((n) => (n.id === row.id ? row : n)));
        },
      )
      .subscribe((status) => {
        if (cancelled || useAppStore.getState().currentUser?.id !== userId) return;
        if (status !== "SUBSCRIBED") return;
        if (subscribedOnce) void refresh({ presentNewDesktop: true });
        subscribedOnce = true;
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      unregisterChannel(channelName);
    };
  }, [userId, supabase, mutedChatIds, refresh, presentDesktopNotification]);

  useEffect(() => {
    setItems((prev) => normalizeRowsForDisplay(prev));
  }, [normalizeRowsForDisplay]);

  const unreadCount = items.reduce((acc, n) => (n.read_at ? acc : acc + 1), 0);

  useEffect(() => {
    const previousUnread = unreadPresentationTagsRef.current;
    const currentUnread = new Map<string, string>();
    const currentUnreadTagCounts = new Map<string, number>();
    for (const item of items) {
      if (item.read_at) continue;
      const tag = notificationPresentationTag(item);
      if (!tag) continue;
      currentUnread.set(item.id, tag);
      currentUnreadTagCounts.set(tag, (currentUnreadTagCounts.get(tag) ?? 0) + 1);
    }
    for (const item of items) {
      if (!item.read_at) continue;
      const previousTag = previousUnread.get(item.id);
      if (previousTag && !currentUnreadTagCounts.has(previousTag)) {
        if (isNativeAndroid()) void closeNativeChatNotification(previousTag);
        else void closeBrowserNotification(previousTag);
        if (isDesktopApp() && !isMessageNotification(item)) {
          closeDesktopNotification(item);
        }
      }
    }
    unreadPresentationTagsRef.current = currentUnread;

    if (isDesktopApp()) {
      const previousDesktopUnread = unreadDesktopIdsRef.current;
      const currentDesktopUnread = new Map<string, Notification>();
      for (const item of items) {
        if (!item.read_at && isMessageNotification(item)) {
          currentDesktopUnread.set(item.id, item);
        }
      }
      for (const [id, previousItem] of previousDesktopUnread) {
        if (!currentDesktopUnread.has(id)) {
          closeDesktopNotification(previousItem);
        }
      }

      const overflowRows = desktopMessageOverflowRows(items, 5);
      const overflowIds = new Set(overflowRows.map((item) => item.id));
      for (const item of overflowRows) {
        if (trimmedDesktopIdsRef.current.has(item.id)) continue;
        trimmedDesktopIdsRef.current.add(item.id);
        closeDesktopNotification(item);
      }
      for (const id of trimmedDesktopIdsRef.current) {
        if (!overflowIds.has(id)) trimmedDesktopIdsRef.current.delete(id);
      }
      unreadDesktopIdsRef.current = currentDesktopUnread;
    }
    void updateBrowserAppBadge(unreadCount);
  }, [items, unreadCount, closeDesktopNotification]);

  useEffect(() => {
    if (userId) return;
    unreadPresentationTagsRef.current.clear();
    unreadDesktopIdsRef.current.clear();
    trimmedDesktopIdsRef.current.clear();
    presentedDesktopIdsRef.current.clear();
    desktopBaselineLoadedRef.current = false;
    void updateBrowserAppBadge(0);
  }, [userId]);

  const markRead = useCallback(
    async (id: string) => {
      await markReadIds([id]);
    },
    [markReadIds],
  );

  const markMessageNotificationsForChatRead = useCallback(async (chatId: string, readUntil: string | null = null) => {
    const matchingIds = items
      .filter((item) => !item.read_at && isMessageNotification(item) && payloadString(item.payload, "chat_id") === chatId)
      .map((item) => item.id);
    const rpcError = await markChatMessageNotificationsRead(
      supabase,
      chatId,
      readUntil,
      async (markedChatId) => {
        const tag = notificationPresentationTag({
          kind: "message",
          payload: { chat_id: markedChatId },
        });
        if (tag) {
          if (isNativeAndroid()) await closeNativeChatNotification(tag);
          else await closeBrowserNotification(tag);
        }
      },
    );
    if (!rpcError) {
      const nowIso = new Date().toISOString();
      setItems((prev) => prev.map((item) =>
        !item.read_at && isMessageNotification(item) && payloadString(item.payload, "chat_id") === chatId
          ? { ...item, read_at: nowIso }
          : item
      ));
      return;
    }

    // Compatibility fallback for deployments where the chat-scoped RPC has
    // not been applied yet. It cannot cover rows absent from the local page,
    // but preserves the previous per-notification behavior.
    if (matchingIds.length) await markReadIds(matchingIds, { silent: true });
  }, [items, markReadIds, supabase]);

  useEffect(() => {
    const handleChatNotificationsRead = (event: Event) => {
      const detail = (event as CustomEvent<ChatNotificationsReadDetail>).detail;
      if (!detail?.chatId) return;
      void markMessageNotificationsForChatRead(detail.chatId, detail.readUntil ?? null);
    };
    const handleFocus = () => {
      void refresh({ presentNewDesktop: true });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh({ presentNewDesktop: true });
    };
    window.addEventListener(KUB_CHAT_NOTIFICATIONS_READ_EVENT, handleChatNotificationsRead);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(KUB_CHAT_NOTIFICATIONS_READ_EVENT, handleChatNotificationsRead);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [markMessageNotificationsForChatRead, refresh]);

  const markAllRead = useCallback(async () => {
    // Snapshot per-row read_at so we can roll back precisely on RPC
    // failure rather than losing legitimately-read state.
    const snapshot = new Map<string, string | null>();
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => {
        snapshot.set(n.id, n.read_at);
        return n.read_at ? n : { ...n, read_at: nowIso };
      }),
    );
    const { error: rpcErr } = await supabase.rpc("notifications_mark_all_read");
    if (rpcErr) {
      setError(mapPgError(rpcErr));
      setItems((prev) =>
        prev.map((n) => {
          if (!snapshot.has(n.id)) return n;
          return { ...n, read_at: snapshot.get(n.id) ?? null };
        }),
      );
    }
  }, [supabase]);

  return { items, unreadCount, loading, error, markRead, markReadIds, markMessageNotificationsForChatRead, markAllRead, refresh };
}

function filterMutedNotifications(items: Notification[], mutedChatIds: string[]): Notification[] {
  if (mutedChatIds.length === 0) return items;
  return items.filter((item) => !isMutedNotification(item, mutedChatIds));
}

function filterRowsForDisplay(
  items: Notification[],
  userId: string | null,
  mutedChatIds: string[],
): Notification[] {
  return filterMutedNotifications(
    items.filter((row) => !isOwnMessageNotification(row, userId)),
    mutedChatIds,
  );
}

function isMutedNotification(item: Notification, mutedChatIds: string[]): boolean {
  const chatId = payloadString(item.payload, "chat_id");
  return Boolean(chatId && mutedChatIds.includes(chatId));
}

function isMessageNotification(item: Notification): boolean {
  return item.kind.includes("message");
}

function isOwnMessageNotification(item: Notification, userId: string | null): boolean {
  if (!userId || !isMessageNotification(item)) return false;
  return isSelfMessageNotification(item.payload, userId);
}
