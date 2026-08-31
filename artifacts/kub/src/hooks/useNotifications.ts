"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { mapPgError } from "@/lib/errors";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { dispatchChatsRefresh } from "@/lib/chatEvents";
import { KUB_CHAT_NOTIFICATIONS_READ_EVENT, type ChatNotificationsReadDetail } from "@/lib/notificationEvents";
import { markChatMessageNotificationsRead } from "@/lib/notificationReadSync";
import {
  closeBrowserNotification,
  notificationPresentationTag,
  updateBrowserAppBadge,
} from "@/lib/browserNotificationPresentation";
import { isDesktopApp } from "@/lib/platform/desktop";
import {
  closeDesktopNotificationForRow,
  desktopMessageOverflowRows,
  showDesktopNotificationForRow,
} from "@/lib/platform/desktopNotifications";
import type { Notification } from "@/types/database";
import { isSelfMessageNotification } from "@/lib/messageNotificationProjection";

const PAGE_SIZE = 30;

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
  // Узкий per-field селектор: подписываемся ТОЛЬКО на примитив userId,
  // чтобы heartbeat-эхо не дёргало этот хук (Task #48).
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
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

  const presentDesktopNotification = useCallback((row: Notification) => {
    presentedDesktopIdsRef.current.add(row.id);
    void showDesktopNotificationForRow(row).then((delivered) => {
      if (!delivered) presentedDesktopIdsRef.current.delete(row.id);
    });
  }, []);

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

    let failed = false;
    for (const id of idsToMark) {
      const { error: rpcErr } = await supabase.rpc("notifications_mark_read", { p_id: id });
      if (rpcErr) {
        failed = true;
        if (!options.silent) setError(mapPgError(rpcErr));
      }
      autoMarkingReadRef.current.delete(id);
    }

    if (failed) {
      setItems((prev) =>
        prev.map((n) => {
          if (!snapshot.has(n.id)) return n;
          return { ...n, read_at: snapshot.get(n.id) ?? null };
        }),
      );
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
    setLoading(true);
    bumpFetch("useNotifications");
    const { data, error: err } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
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
    setItems((prev) => filterRowsForDisplay(mergeRows(prev, nextRows), userId, mutedChatIds));
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
          setItems((prev) => mergeRows(prev, [row]));
          if (isDesktopApp() && !row.read_at && !presentedDesktopIdsRef.current.has(row.id)) {
            presentDesktopNotification(row);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Notification;
          setItems((prev) => prev.map((n) => (n.id === row.id ? row : n)));
        },
      )
      .subscribe((status) => {
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
        void closeBrowserNotification(previousTag);
        if (isDesktopApp() && !isMessageNotification(item)) {
          void closeDesktopNotificationForRow(item);
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
          void closeDesktopNotificationForRow(previousItem);
        }
      }

      const overflowRows = desktopMessageOverflowRows(items, 5);
      const overflowIds = new Set(overflowRows.map((item) => item.id));
      for (const item of overflowRows) {
        if (trimmedDesktopIdsRef.current.has(item.id)) continue;
        trimmedDesktopIdsRef.current.add(item.id);
        void closeDesktopNotificationForRow(item);
      }
      for (const id of trimmedDesktopIdsRef.current) {
        if (!overflowIds.has(id)) trimmedDesktopIdsRef.current.delete(id);
      }
      unreadDesktopIdsRef.current = currentDesktopUnread;
    }
    void updateBrowserAppBadge(unreadCount);
  }, [items, unreadCount]);

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
        if (tag) await closeBrowserNotification(tag);
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

// Merge two unordered notification lists by id, keep the newest copy
// of each row (highest `created_at`), sort desc, and cap at PAGE_SIZE.
function mergeRows(a: Notification[], b: Notification[]): Notification[] {
  const byId = new Map<string, Notification>();
  for (const n of a) byId.set(n.id, n);
  for (const n of b) {
    const existing = byId.get(n.id);
    if (!existing || existing.created_at <= n.created_at) byId.set(n.id, n);
  }
  return Array.from(byId.values())
    .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))
    .slice(0, PAGE_SIZE);
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
