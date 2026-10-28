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
import { createNotificationFeedV2, type NotificationFeedRowV2 } from "@/lib/notificationFeedV2";
import { CONNECTION_REVIVED_EVENT } from "@/lib/realtimeRevival";
import { isMissingRpcError } from "@/lib/rpcAvailability";
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
import { currentMessageAlertAllowed } from "@/lib/messageAlertDecisions";

const PAGE_SIZE = 30;
const NATIVE_READ_RETRY_MS = 5000;
const FEED_HANDSHAKE_MS = 10000;
const FEED_RETRY_MS = 1000;
const FEED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type NativeReadPairState = { status: "inflight" | "settled" | "retry"; retryAfter: number; fetchRevision: number };
type FeedConnection = {
  owner: object;
  controller: ReturnType<typeof createNotificationFeedV2> | null;
  refresh(): Promise<void>;
};

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

/** Versioned own feed. The controller owns bounded reconciliation and stream
 * admission; snapshots/reconnects never grant sound or Windows presentation.
 * Read writes retain their existing RPCs, independently of alert authority.
 */
export function useNotifications() {
  const supabase = createClient();
  // Narrow primitives keep heartbeat updates inert while observing session replacement.
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const sessionId = useAppStore((s) => s.authSessionIdentity?.sessionId ?? null);
  const accountEpoch = useAppStore((s) => s.accountEpoch);
  const mutedChatIds = useAppStore((s) => s.mutedChatIds);

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOwnerRef = useRef({ userId, sessionId, accountEpoch, pending: new Set<string>() });
  if (readOwnerRef.current.userId !== userId || readOwnerRef.current.sessionId !== sessionId || readOwnerRef.current.accountEpoch !== accountEpoch) {
    readOwnerRef.current = { userId, sessionId, accountEpoch, pending: new Set<string>() };
  }
  const readOwner = readOwnerRef.current;
  const alertRowsRef = useRef({ owner: readOwner, rows: new Map<string, Notification>() });
  if (alertRowsRef.current.owner !== readOwner) alertRowsRef.current = { owner: readOwner, rows: new Map() };
  const readMountedRef = useRef(false);
  const unreadPresentationTagsRef = useRef<Map<string, string>>(new Map());
  const nativeReadPairsRef = useRef({ owner: readOwner, pairs: new Map<string, NativeReadPairState>() });
  const nativeReadFetchRevisionRef = useRef(0);
  const unreadDesktopIdsRef = useRef<Map<string, Notification>>(new Map());
  const trimmedDesktopIdsRef = useRef<Set<string>>(new Set());
  const presentedDesktopIdsRef = useRef<Set<string>>(new Set());
  const feedRef = useRef<FeedConnection | null>(null);
  const accountGenerationRef = useRef(0);

  useEffect(() => {
    readMountedRef.current = true;
    return () => { readMountedRef.current = false; };
  }, []);
  const isCurrentReadOwner = useCallback(() => {
    const state = useAppStore.getState();
    return readMountedRef.current && readOwnerRef.current === readOwner && Boolean(readOwner.userId)
      && state.currentUser?.id === readOwner.userId && state.accountEpoch === readOwner.accountEpoch
      && state.authSessionIdentity?.userId === readOwner.userId
      && state.authSessionIdentity.sessionId === readOwner.sessionId;
  }, [readOwner]);

  const refresh = useCallback(async (_options: { presentNewDesktop?: boolean } = {}) => {
    const connection = feedRef.current;
    if (!isCurrentReadOwner() || connection?.owner !== readOwner) return;
    // The compatibility option never admits catch-up snapshots as new alerts.
    await connection.refresh();
  }, [isCurrentReadOwner, readOwner]);

  const presentDesktopNotification = useCallback((row: Notification, sourceCurrent: () => boolean) => {
    if (!userId || row.user_id !== userId) return;
    const handled = presentedDesktopIdsRef.current;
    let quiet = false;
    const mayDeliver = () => {
      if (!sourceCurrent() || !isCurrentReadOwner() || handled !== presentedDesktopIdsRef.current || useAppStore.getState().accountEpoch !== accountEpoch) return false;
      const latest = alertRowsRef.current.rows.get(row.id) ?? row;
      if (latest.read_at || latest.alert_suppressed_at || readOwner.pending.has(row.id)) return false;
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
          if (row.kind === "message" && !await currentMessageAlertAllowed(row.id, mayDeliver, supabase)) return false;
          if (!mayDeliver()) return false;
          const delivered = await bridge.notify(payload);
          if (delivered) queue.card = { owner: handled, rowId: row.id };
          return delivered;
        }),
      };
    }).then((delivered) => {
      if (!delivered && !quiet) handled.delete(row.id);
    });
  }, [userId, accountEpoch, isCurrentReadOwner, readOwner, supabase]);

  const closeDesktopNotification = useCallback((row: Notification) => {
    const owner = presentedDesktopIdsRef.current;
    void closeDesktopNotificationForRow(row, async () => {
      const bridge = getDesktopBridge();
      if (!bridge) throw new Error("desktop_runtime_unavailable");
      return {
        sendNotification: async () => false,
        removeNotification: (identity) => queueDesktopCard(desktopCardQueues, identity, async (queue) => {
          const state = useAppStore.getState();
          if (!isCurrentReadOwner() || owner !== presentedDesktopIdsRef.current || state.currentUser?.id !== row.user_id || state.accountEpoch !== accountEpoch) return false;
          if (queue.card && (queue.card.owner !== owner || queue.card.rowId !== row.id)) return false;
          const removed = await bridge.removeNotification(identity);
          if (removed) queue.card = null;
          return removed;
        }),
      };
    });
  }, [accountEpoch, isCurrentReadOwner]);

  useEffect(() => {
    accountGenerationRef.current += 1;
    setItems([]);
    setError(null);
    setLoading(false);
    unreadPresentationTagsRef.current = new Map();
    unreadDesktopIdsRef.current = new Map();
    trimmedDesktopIdsRef.current = new Set();
    presentedDesktopIdsRef.current = new Set();
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
  }, [userId, sessionId, accountEpoch]);

  const markReadIds = useCallback(async (ids: string[], options: { silent?: boolean } = {}) => {
    const generation = accountGenerationRef.current;
    const current = () => isCurrentReadOwner() && generation === accountGenerationRef.current;
    if (!current()) return;
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return;

    const idsToMark = uniqueIds.filter((id) => !readOwner.pending.has(id));
    if (!idsToMark.length) return;
    for (const id of idsToMark) readOwner.pending.add(id);
    try {
      for (const id of idsToMark) {
        if (!current()) return;
        try {
          const { error: rpcErr } = await supabase.rpc("notifications_mark_read", { p_id: id });
          if (!current()) return;
          if (rpcErr) {
            if (!options.silent) setError((prev) => current() ? mapPgError(rpcErr) : prev);
          } else {
            // A write ACK has no row/revision. Only a new authoritative read
            // may advance the feed and clear native cards.
            await refresh();
          }
        } catch (error) {
          if (!current()) return;
          if (!options.silent) setError((prev) => current() ? mapPgError(error) : prev);
        }
      }
    } finally {
      for (const id of idsToMark) readOwner.pending.delete(id);
    }
  }, [isCurrentReadOwner, readOwner, supabase, refresh]);

  const applyConfirmedReadRows = useCallback(async (current: () => boolean) => {
    if (!current()) return;
    // Controller page+lookup reconciles the entire retained view, including
    // exact unavailable identities. A partial read reply must not merge old
    // payload back into a row already retired by the live stream.
    await refresh();
  }, [refresh]);

  const normalizeRowsForDisplay = useCallback((rows: Notification[]) => {
    const ownUnreadIds = rows
      .filter((row) => !row.read_at && isOwnMessageNotification(row, userId))
      .map((row) => row.id);
    if (ownUnreadIds.length) void markReadIds(ownUnreadIds, { silent: true });
    return filterRowsForDisplay(rows, userId, mutedChatIds);
  }, [markReadIds, mutedChatIds, userId]);

  const displayRef = useRef(normalizeRowsForDisplay);
  displayRef.current = normalizeRowsForDisplay;
  const createdRef = useRef((_: NotificationFeedRowV2, _current: () => boolean) => {});
  createdRef.current = (source, sourceCurrent) => {
    if (!isCurrentReadOwner() || !sourceCurrent()) return;
    const row: Notification = { ...source, alert_origin: null };
    if (row.kind === "chat_added" || row.kind === "group_invite") {
      dispatchChatsRefresh({ reason: "chat-notification", chatId: payloadString(row.payload, "chat_id") });
    }
    if (isOwnMessageNotification(row, userId) || isMutedNotification(row, mutedChatIds)) return;
    const mayAlert = () => {
      const latest = alertRowsRef.current.rows.get(row.id) ?? row;
      return sourceCurrent() && isCurrentReadOwner() && !latest.read_at && !latest.alert_suppressed_at
        && !readOwner.pending.has(row.id);
    };
    if (!mayAlert()) return;
    const osToast = isDesktopApp() && !presentedDesktopIdsRef.current.has(row.id);
    if (!osToast) playNotificationSoundFor({ chatId: payloadString(row.payload, "chat_id") ?? null, osToast: false,
      isCurrent: mayAlert,
      ...(row.kind === "message" ? { authorize: () => currentMessageAlertAllowed(row.id, mayAlert, supabase) } : {}),
    });
    if (osToast) presentDesktopNotification(row, mayAlert);
  };

  useEffect(() => {
    if (!userId || !sessionId || !FEED_UUID.test(userId) || !FEED_UUID.test(sessionId) || !isCurrentReadOwner()) return;
    let cancelled = false, live = false, stopped = false, refreshAfterOpen = false, retries = 0;
    let handshake: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    let waiting: Promise<void> | undefined, finishWaiting: (() => void) | undefined;
    const generation = accountGenerationRef.current;
    const current = () => !cancelled && feedRef.current === connection && isCurrentReadOwner()
      && generation === accountGenerationRef.current;
    const settle = () => { finishWaiting?.(); finishWaiting = undefined; waiting = undefined; };
    const connection: FeedConnection = { owner: readOwner, controller: null, refresh() {
      if (!current()) return Promise.resolve();
      waiting ??= new Promise<void>(resolve => { finishWaiting = resolve; });
      const result = waiting;
      if (stopped) restart();
      if (live) connection.controller?.refresh(); else refreshAfterOpen = true;
      return result;
    } };
    feedRef.current = connection;
    const restart = () => {
      if (!current() || navigator.onLine === false) { settle(); return; }
      clearTimeout(retry); retry = undefined;
      stopped = false; live = false;
      setLoading(previous => current() ? true : previous);
      connection.controller?.restart();
    };
    const rpcData = async (name: "notification_feed_open_v2" | "notification_feed_page_v2" | "notification_feed_lookup_v2",
      args: { p_limit: 30; p_held_ids: string[] } | { p_limit: 30 } | { p_ids: string[] }) => {
      if (!current()) throw new Error("notification_feed_owner");
      if (handshake === undefined) handshake = setTimeout(() => { if (current()) connection.controller?.timeout(); }, FEED_HANDSHAKE_MS);
      bumpFetch("useNotifications");
      const result = await supabase.rpc(name, args);
      if (result.error) throw result.error;
      return result.data;
    };
    setLoading(previous => current() ? true : previous);
    connection.controller = createNotificationFeedV2({ userId, sessionId, accountEpoch }, {
      isCurrent: current,
      subscribe(receive, status) {
        live = false; stopped = false;
        clearTimeout(handshake);
        handshake = setTimeout(() => { if (current()) connection.controller?.timeout(); }, FEED_HANDSHAKE_MS);
        const channelName = `notification-feed-v2:${userId}:${sessionId}`;
        registerChannel(channelName);
        const channel = supabase.channel(channelName).on("postgres_changes", {
          event: "INSERT", schema: "public", table: "notification_feed_events_v2", filter: `recipient_id=eq.${userId}`,
        }, payload => receive(payload.new)).subscribe(status);
        return () => {
          clearTimeout(handshake); handshake = undefined;
          void supabase.removeChannel(channel);
          unregisterChannel(channelName);
        };
      },
      open: args => rpcData("notification_feed_open_v2", args),
      page: args => rpcData("notification_feed_page_v2", args),
      lookup: args => rpcData("notification_feed_lookup_v2", args),
      onRows(rows) {
        if (!current()) return;
        clearTimeout(handshake); handshake = undefined; retries = 0; live = true; stopped = false;
        const next: Notification[] = rows.map(row => ({ ...row, alert_origin: null }));
        alertRowsRef.current = { owner: readOwner, rows: new Map(next.map(row => [row.id, row])) };
        if (isNativeAndroid()) nativeReadFetchRevisionRef.current++;
        const visible = displayRef.current(next);
        setItems(previous => current() ? visible : previous);
        setLoading(previous => current() ? false : previous);
        setError(previous => current() ? null : previous);
        if (refreshAfterOpen) { refreshAfterOpen = false; connection.controller?.refresh(); }
        else settle();
      },
      onCreated: (row, allowed) => { if (current()) createdRef.current(row, () => current() && allowed()); },
      onResync(reason) {
        if (!current()) return;
        live = false; stopped = true;
        setLoading(previous => current() ? false : previous);
        const error = mapPgError(new Error(`notification_feed_v2:${reason}`));
        setError(previous => current() ? error : previous);
        settle();
        if (retries++ === 0 && navigator.onLine !== false) retry = setTimeout(restart, FEED_RETRY_MS);
      },
    });
    const offline = () => { if (current()) connection.controller?.timeout(); };
    const rejoin = () => { if (current()) restart(); };
    window.addEventListener("offline", offline);
    window.addEventListener("online", rejoin);
    window.addEventListener(CONNECTION_REVIVED_EVENT, rejoin);
    return () => {
      cancelled = true; clearTimeout(handshake); clearTimeout(retry); settle();
      connection.controller?.dispose();
      if (feedRef.current === connection) feedRef.current = null;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", rejoin);
      window.removeEventListener(CONNECTION_REVIVED_EVENT, rejoin);
    };
  }, [userId, sessionId, accountEpoch, supabase, readOwner, isCurrentReadOwner]);

  useEffect(() => {
    if (!isCurrentReadOwner()) return;
    const visible = normalizeRowsForDisplay([...alertRowsRef.current.rows.values()]);
    setItems(previous => isCurrentReadOwner() ? visible : previous);
  }, [normalizeRowsForDisplay, isCurrentReadOwner]);

  const unreadCount = items.reduce((acc, n) => (n.user_id === userId && !n.read_at ? acc + 1 : acc), 0);

  useEffect(() => {
    if (!isCurrentReadOwner()) return;
    const previousUnread = unreadPresentationTagsRef.current;
    const currentUnread = new Map<string, string>();
    const currentUnreadTagCounts = new Map<string, number>();
    for (const item of items) {
      if (item.user_id !== userId) continue;
      if (item.read_at) continue;
      const tag = notificationPresentationTag(item);
      if (!tag) continue;
      currentUnread.set(item.id, tag);
      currentUnreadTagCounts.set(tag, (currentUnreadTagCounts.get(tag) ?? 0) + 1);
    }
    for (const item of items) {
      if (item.user_id !== userId) continue;
      if (!item.read_at) continue;
      const previousTag = previousUnread.get(item.id);
      if (!isNativeAndroid() && previousTag && !currentUnreadTagCounts.has(previousTag)) {
        void closeBrowserNotification(previousTag, () => isCurrentReadOwner()
          && ![...alertRowsRef.current.rows.values()].some(row => row.user_id === userId
            && !row.read_at && notificationPresentationTag(row) === previousTag));
        if (isDesktopApp() && !isMessageNotification(item)) {
          closeDesktopNotification(item);
        }
      }
    }
    unreadPresentationTagsRef.current = currentUnread;

    if (isNativeAndroid()) {
      const pairs = nativeReadPairsRef.current.owner === readOwner ? nativeReadPairsRef.current.pairs : new Map<string, NativeReadPairState>();
      const visible = new Set<string>();
      const byChat = new Map<string, Array<{ notificationId: string; messageId: string; key: string; entry: NativeReadPairState }>>();
      for (const item of items) {
        if (item.user_id !== userId || !item.read_at || !isMessageNotification(item)) continue;
        const chatId = payloadString(item.payload, "chat_id"), messageId = payloadString(item.payload, "message_id");
        if (!chatId || !messageId || [item.id, chatId, messageId].some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))) continue;
        const key = `${item.id}:${chatId}:${messageId}`;
        visible.add(key);
        const previous = pairs.get(key);
        if (previous) {
          if (previous.status !== "retry") continue;
          const fetched = nativeReadFetchRevisionRef.current > previous.fetchRevision;
          previous.fetchRevision = nativeReadFetchRevisionRef.current;
          if (Date.now() < previous.retryAfter || !fetched) continue;
        }
        const entry: NativeReadPairState = { status: "inflight", retryAfter: 0, fetchRevision: nativeReadFetchRevisionRef.current };
        pairs.set(key, entry);
        const batch = byChat.get(chatId) ?? [];
        batch.push({ notificationId: item.id, messageId, key, entry });
        byChat.set(chatId, batch);
      }
      for (const key of pairs.keys()) if (!visible.has(key)) pairs.delete(key);
      nativeReadPairsRef.current = { owner: readOwner, pairs };
      for (const [chatId, confirmed] of byChat) {
        const batch = confirmed.slice(0, PAGE_SIZE);
        const settle = (status: unknown) => {
          if (!isCurrentReadOwner() || nativeReadPairsRef.current.owner !== readOwner || nativeReadPairsRef.current.pairs !== pairs) return;
          for (const { key, entry } of batch) {
            if (pairs.get(key) !== entry) continue;
            pairs.set(key, { status: status === "settled" ? "settled" : "retry",
              retryAfter: Date.now() + NATIVE_READ_RETRY_MS, fetchRevision: nativeReadFetchRevisionRef.current });
          }
        };
        void closeNativeChatNotification({ chatId, confirmed: batch.map(({ notificationId, messageId }) => ({ notificationId, messageId })) }, isCurrentReadOwner)
          .then(settle, () => settle("retry"));
      }
    }

    if (isDesktopApp()) {
      const previousDesktopUnread = unreadDesktopIdsRef.current;
      const currentDesktopUnread = new Map<string, Notification>();
      for (const item of items) {
        if (item.user_id === userId && !item.read_at && isMessageNotification(item)) {
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
  }, [items, unreadCount, closeDesktopNotification, isCurrentReadOwner, readOwner, userId]);

  useEffect(() => {
    if (userId) return;
    unreadPresentationTagsRef.current.clear();
    unreadDesktopIdsRef.current.clear();
    trimmedDesktopIdsRef.current.clear();
    presentedDesktopIdsRef.current.clear();
    void updateBrowserAppBadge(0);
  }, [userId]);

  const markRead = useCallback(
    async (id: string) => {
      await markReadIds([id]);
    },
    [markReadIds],
  );

  const markMessageNotificationsForChatRead = useCallback(async (chatId: string, readUntil: string | null = null) => {
    const generation = accountGenerationRef.current;
    const current = () => isCurrentReadOwner() && generation === accountGenerationRef.current;
    if (!current()) return;
    const matching = items.filter((item) => item.user_id === readOwner.userId && !item.read_at
      && isMessageNotification(item) && payloadString(item.payload, "chat_id") === chatId);
    const matchingIds = matching.map((item) => item.id);
    try {
      const rpcError = await markChatMessageNotificationsRead(supabase, chatId, readUntil, undefined, current);
      if (!current()) return;
      if (!rpcError) {
        await applyConfirmedReadRows(current);
        return;
      }
      if (!isMissingRpcError(rpcError)) { setError((prev) => current() ? mapPgError(rpcError) : prev); return; }

      let eligibleIds = matchingIds;
      if (readUntil !== null) {
        const messageIds = [...new Set(matching.map((row) => payloadString(row.payload, "message_id"))
          .filter((id): id is string => Boolean(id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))))];
        if (!messageIds.length) return;
        // Notification creation time is not the message horizon (backfills differ).
        const { data, error: horizonError } = await supabase.from("messages").select("id")
          .eq("chat_id", chatId).in("id", messageIds).lte("created_at", readUntil);
        if (!current()) return;
        if (horizonError) { setError((prev) => current() ? mapPgError(horizonError) : prev); return; }
        const eligibleMessages = new Set((data ?? []).map((row) => row.id));
        eligibleIds = matching.filter((row) => eligibleMessages.has(payloadString(row.payload, "message_id") ?? ""))
          .map((row) => row.id);
      }
      if (current() && eligibleIds.length) await markReadIds(eligibleIds, { silent: true });
    } catch (error) {
      if (current()) setError((prev) => current() ? mapPgError(error) : prev);
    }
  }, [items, markReadIds, supabase, isCurrentReadOwner, readOwner, applyConfirmedReadRows]);

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
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(KUB_CHAT_NOTIFICATIONS_READ_EVENT, handleChatNotificationsRead);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [markMessageNotificationsForChatRead, refresh]);

  const markAllRead = useCallback(async () => {
    const generation = accountGenerationRef.current;
    const current = () => isCurrentReadOwner() && generation === accountGenerationRef.current;
    if (!current()) return;
    try {
      const { error: rpcErr } = await supabase.rpc("notifications_mark_all_read");
      if (!current()) return;
      if (rpcErr) { setError((prev) => current() ? mapPgError(rpcErr) : prev); return; }
      await applyConfirmedReadRows(current);
    } catch (error) {
      if (current()) setError((prev) => current() ? mapPgError(error) : prev);
    }
  }, [supabase, isCurrentReadOwner, applyConfirmedReadRows]);

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
  return item.kind !== "message" && Boolean(chatId && mutedChatIds.includes(chatId));
}

function isMessageNotification(item: Notification): boolean {
  return item.kind.includes("message");
}

function isOwnMessageNotification(item: Notification, userId: string | null): boolean {
  if (!userId || !isMessageNotification(item)) return false;
  return isSelfMessageNotification(item.payload, userId);
}
