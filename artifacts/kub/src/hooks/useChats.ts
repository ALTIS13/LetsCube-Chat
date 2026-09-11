"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { dispatchChatsRefresh, KUB_CHATS_REFRESH_EVENT, type ChatsRefreshDetail } from "@/lib/chatEvents";
import { isSavedChat } from "@/lib/chatDisplay";
import { sortChatsForSidebar } from "@/lib/chatSort";
import { scheduleMarkChatDelivered } from "@/lib/deliveryReceipts";
import {
  buildChatSummaryMap,
  isChatListSummariesEnabled,
  isChatListSummariesUnavailable,
  type ChatSummary,
} from "@/lib/chatSummaryBatching";
import {
  applyChatSummaries,
  reduceChatListEvent,
  replayChatListEvents,
  type ChatListEvent,
  type ChatListEventContext,
  type ChatListEventOutcome,
  type MembershipRowLike,
  type MessageRowLike,
} from "@/lib/chatListDelta";
import { isIncomingMessage } from "@/lib/messageActor";
import { MESSAGE_LAST_MESSAGE_SELECT } from "@/lib/messageProjection";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import {
  createResumeRevalidationGate,
  RESUME_REVALIDATE_AFTER_HIDDEN_MS,
  RESUME_REVALIDATE_MIN_INTERVAL_MS,
} from "@/lib/resumeRevalidation";
import type { RealtimeChannel } from "@supabase/supabase-js";

const CHAT_REFETCH_DEBOUNCE_MS = 350;
const CHAT_SUMMARY_DEBOUNCE_MS = 250;
const CHAT_LIST_SUMMARIES_ENABLED = isChatListSummariesEnabled(
  import.meta.env.VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED,
);
let chatListSummariesCapability: "unknown" | "supported" | "unsupported" =
  CHAT_LIST_SUMMARIES_ENABLED ? "unknown" : "unsupported";

type SidebarLastMessage = NonNullable<ChatWithLastMessage["last_message"]>;
type SidebarSummaryMap = Map<string, ChatSummary<SidebarLastMessage>>;

type FetchChatsOptions = {
  preserveActiveChat?: boolean;
};

type MyMembershipRow = {
  chat_id: string;
  joined_at: string;
  last_read_at: string | null;
  last_delivered_at: string | null;
  hidden_at: string | null;
  cleared_at: string | null;
  pinned: boolean;
  pinned_at: string | null;
  pinned_order: number | null;
};

type SummaryMembership = {
  joined_at: string | null;
  last_read_at: string | null;
  cleared_at: string | null;
};

type RealtimeRowPayload = {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

/** What the reader is looking at now: a message that lands in the chat on screen is read as it lands. */
function eventContext(userId: string): ChatListEventContext {
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  return { currentUserId: userId, readingChatId: visible ? useAppStore.getState().selectedChatId : null };
}

/**
 * The sidebar's chats, kept live.
 *
 * The list is fetched whole when it has to be — on mount, when this user joins
 * or leaves a chat, when a chat is hidden or cleared, when a local action asks
 * for it, after coming back to a page that was away and after Realtime
 * reconnects. Everything else arrives as one event about one chat and is applied
 * to that chat alone (`lib/chatListDelta.ts`), so a message, a receipt or a read
 * renders one row and asks the server for nothing, or for that one chat's
 * summary when the event cannot settle it (D-088).
 */
export function useChats() {
  const [loading, setLoading] = useState(true);
  const chats = useAppStore((s) => s.chats);
  const setChats = useAppStore((s) => s.setChats);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = createClient();
  const rt = getRealtimeClient();
  const fetchInFlightRef = useRef(false);
  const fetchQueuedRef = useRef(false);
  const queuedPreserveActiveChatRef = useRef(false);
  const unhideInFlightRef = useRef(new Set<string>());
  /**
   * The events that arrived while a full fetch was in flight, or `null` when
   * none is. Each was applied as it arrived, over the list on screen; the fetch
   * started from an older snapshot, so they are applied again over what it
   * returns rather than being put back by it.
   */
  const eventsDuringFetchRef = useRef<ChatListEvent[] | null>(null);
  /** Bumped when a full fetch starts, so a summary asked for before it knows its answer is the older one. */
  const fetchGenerationRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryChatIdsRef = useRef(new Set<string>());

  const fetchChats = useCallback(async (options: FetchChatsOptions = {}) => {
    const preserveActiveChat = Boolean(options.preserveActiveChat);
    if (!userId) {
      setChats([]);
      setLoading(false);
      return;
    }

    if (fetchInFlightRef.current) {
      fetchQueuedRef.current = true;
      queuedPreserveActiveChatRef.current = queuedPreserveActiveChatRef.current || preserveActiveChat;
      return;
    }

    fetchInFlightRef.current = true;
    fetchGenerationRef.current += 1;
    eventsDuringFetchRef.current = [];
    bumpFetch("useChats");

    try {
      const { data: memberships, error: membershipsError } = await supabase
        .from("chat_members")
        .select("chat_id, joined_at, last_read_at, last_delivered_at, hidden_at, cleared_at, pinned, pinned_at, pinned_order")
        .eq("user_id", userId);

      // A request that failed says nothing about the chats. Read as "no
      // memberships", it emptied the list and closed the open chat whenever a
      // revalidation ran before requests went through again — which a reconnect
      // makes likely, because the socket can rejoin a moment earlier.
      if (membershipsError) return;

      if (!memberships?.length) {
        if (!preserveActiveChat) {
          setChats([]);
          const selectedChatId = useAppStore.getState().selectedChatId;
          if (selectedChatId) useAppStore.getState().setSelectedChatId(null);
        }
        return;
      }

      const myMemberships = (memberships ?? []) as MyMembershipRow[];
      const membershipByChat = new Map(myMemberships.map((membership) => [membership.chat_id, membership]));
      const chatIds = myMemberships.map((m) => m.chat_id);

      const { data: chatsData } = await supabase
        .from("chats")
        .select("*, members:chat_members(user_id, role, joined_at, last_read_at, last_delivered_at, profile:profiles(*))")
        .in("id", chatIds)
        .order("updated_at", { ascending: false });

      if (!chatsData) return;

      const batchedSummaries = await fetchBatchedChatSummaries(supabase, chatIds);

      const enriched: ChatWithLastMessage[] = await Promise.all(
        chatsData.map(async (chat) => {
          const myMembership = membershipByChat.get(chat.id) ?? null;
          const summary = batchedSummaries?.get(chat.id)
            ?? await fetchFallbackChatSummary(supabase, chat.id, userId, myMembership);
          const lastMsgData = summary.lastMessage;
          const unreadCount = summary.unreadCount;

          let displayName = chat.name;
          let displayAvatarUrl = chat.avatar_url ?? null;
          let otherUser: Profile | null = null;
          if (chat.type === "private") {
            const other = (
              chat.members as { user_id: string; profile: Profile | null }[]
            )?.find((m) => m.user_id !== userId);
            if (other?.profile) {
              displayName = other.profile.full_name ?? other.profile.username ?? chat.name;
              displayAvatarUrl = other.profile.avatar_url ?? null;
              otherUser = other.profile;
            }
          }
          if (
            chat.type === "private" &&
            lastMsgData &&
            isIncomingMessage(lastMsgData, userId) &&
            !isSavedChat(chat as unknown as ChatWithLastMessage, userId) &&
            (!myMembership?.last_delivered_at ||
              new Date(lastMsgData.created_at).getTime() > new Date(myMembership.last_delivered_at).getTime())
          ) {
            scheduleMarkChatDelivered(supabase, chat.id, lastMsgData.created_at);
          }

          return {
            ...chat,
            name: displayName,
            avatar_url: displayAvatarUrl,
            other_user: otherUser,
            last_message: lastMsgData ?? undefined,
            unread_count: unreadCount,
            is_pinned: Boolean(myMembership?.pinned),
            pinned_at: myMembership?.pinned_at ?? null,
            pinned_order: myMembership?.pinned_order ?? null,
            hidden_at: myMembership?.hidden_at ?? null,
            cleared_at: myMembership?.cleared_at ?? null,
          } as ChatWithLastMessage;
        }),
      );

      const visibleChats = enriched.filter((chat) => {
        if (!chat.hidden_at) return true;
        const lastActivity = chat.last_message?.created_at ?? chat.updated_at;
        return new Date(lastActivity).getTime() > new Date(chat.hidden_at).getTime();
      });
      for (const chat of visibleChats) {
        if (!chat.hidden_at || chat.type !== "private") continue;
        const lastActivity = chat.last_message?.created_at ?? chat.updated_at;
        if (new Date(lastActivity).getTime() <= new Date(chat.hidden_at).getTime()) continue;
        if (unhideInFlightRef.current.has(chat.id)) continue;
        unhideInFlightRef.current.add(chat.id);
        void (async () => {
          try {
            await supabase.rpc("unhide_private_chat", { p_chat_id: chat.id });
          } finally {
            unhideInFlightRef.current.delete(chat.id);
          }
        })();
      }

      const sortedVisibleChats = sortChatsForSidebar(visibleChats, userId);

      // Reconcile stale active chat after delete/member removal. Only clear
      // after a successful fresh list proves the selected chat is no longer visible.
      const selectedChatId = useAppStore.getState().selectedChatId;
      if (!preserveActiveChat && selectedChatId && !sortedVisibleChats.some((chat) => chat.id === selectedChatId)) {
        useAppStore.getState().setSelectedChatId(null);
      }

      const arrived = eventsDuringFetchRef.current ?? [];
      setChats(
        arrived.length
          ? sortChatsForSidebar(replayChatListEvents(sortedVisibleChats, arrived, eventContext(userId)), userId)
          : sortedVisibleChats,
      );
    } finally {
      eventsDuringFetchRef.current = null;
      setLoading(false);
      fetchInFlightRef.current = false;
      if (fetchQueuedRef.current) {
        fetchQueuedRef.current = false;
        const preserveQueuedActiveChat = queuedPreserveActiveChatRef.current;
        queuedPreserveActiveChatRef.current = false;
        window.setTimeout(() => {
          void fetchChats({ preserveActiveChat: preserveQueuedActiveChat });
        }, CHAT_REFETCH_DEBOUNCE_MS);
      }
    }
  }, [userId, supabase, setChats]);

  useEffect(() => {
    void fetchChats();
  }, [fetchChats]);

  // Timers belong to one signed-in user; a pending refetch must not run for the next.
  useEffect(() => () => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
    refetchTimerRef.current = null;
    summaryTimerRef.current = null;
    summaryChatIdsRef.current.clear();
  }, [userId]);

  /** One full fetch for however many reasons arrive together. */
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      void fetchChats();
    }, CHAT_REFETCH_DEBOUNCE_MS);
  }, [fetchChats]);

  /**
   * One chat's preview and count from the server, for an event that could not
   * settle them: the preview was deleted, or a read stopped short of it.
   * Requests made together share one call.
   */
  const scheduleSummary = useCallback((chatId: string) => {
    if (!userId) return;
    summaryChatIdsRef.current.add(chatId);
    if (summaryTimerRef.current) return;
    const flush = async () => {
      summaryTimerRef.current = null;
      // A full fetch in flight will bring every summary, but from a snapshot
      // that may predate the change this one was asked for. Wait for it.
      if (fetchInFlightRef.current) {
        summaryTimerRef.current = setTimeout(() => void flush(), CHAT_SUMMARY_DEBOUNCE_MS);
        return;
      }
      const ids = Array.from(summaryChatIdsRef.current);
      summaryChatIdsRef.current.clear();
      if (!ids.length) return;
      const generation = fetchGenerationRef.current;
      bumpFetch("useChats:summary");
      const summaries = await fetchChatSummaries(supabase, ids, userId);
      // A full fetch that started meanwhile is the fresher answer.
      if (generation !== fetchGenerationRef.current || fetchInFlightRef.current) return;
      const current = useAppStore.getState().chats;
      const patched = applyChatSummaries(current, summaries);
      if (patched !== current) useAppStore.getState().setChats(sortChatsForSidebar(patched, userId));
    };
    summaryTimerRef.current = setTimeout(() => void flush(), CHAT_SUMMARY_DEBOUNCE_MS);
  }, [supabase, userId]);

  /** Applies one event to the list on screen, and remembers it for a fetch in flight. */
  const applyEvent = useCallback((event: ChatListEvent): ChatListEventOutcome => {
    if (!userId) return "ignored";
    eventsDuringFetchRef.current?.push(event);
    const state = useAppStore.getState();
    const { chats: next, outcome } = reduceChatListEvent(state.chats, event, eventContext(userId));
    if (next !== state.chats) {
      state.setChats(event.kind === "peer-receipt" ? next : sortChatsForSidebar(next, userId));
    }
    return outcome;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    // A channel is live from `SUBSCRIBED` on, and nothing it missed before —
    // the gap between the fetch and the join, or the time a reconnect took —
    // will ever arrive on it. One fetch closes that, however many channels
    // report together.
    const revalidateWhenSubscribed = (status: string) => {
      if (status === "SUBSCRIBED") scheduleRefetch();
    };

    const handleMessageInsert = (payload: RealtimeRowPayload) => {
      const row = payload.new as unknown as MessageRowLike | null;
      if (!row?.id || !row.chat_id) return;
      dispatchChatsRefresh({ reason: "message-realtime", chatId: row.chat_id, messageId: row.id });
      const chat = useAppStore.getState().chats.find((item) => item.id === row.chat_id);
      if (
        chat?.type === "private" &&
        isIncomingMessage({
          type: row.type ?? "text",
          user_id: row.user_id ?? null,
          bot_id: row.bot_id ?? null,
        }, userId) &&
        !isSavedChat(chat, userId)
      ) {
        scheduleMarkChatDelivered(supabase, row.chat_id, row.created_at);
      }
      const outcome = applyEvent({ kind: "message-insert", row });
      if (outcome === "unknown-chat") {
        scheduleRefetch();
        return;
      }
      if (outcome !== "needs-row") return;
      // A bot's name is not in the row. The one message, not the list.
      void (async () => {
        const { data } = await supabase
          .from("messages")
          .select(MESSAGE_LAST_MESSAGE_SELECT)
          .eq("id", row.id)
          .maybeSingle();
        if (!data) return;
        const joined = applyEvent({ kind: "message-insert", row: data as unknown as MessageRowLike });
        if (joined === "unknown-chat") scheduleRefetch();
      })();
    };

    const handleMessageUpdate = (payload: RealtimeRowPayload) => {
      const row = payload.new as unknown as MessageRowLike | null;
      if (!row?.id || !row.chat_id) return;
      if (applyEvent({ kind: "message-update", row }) === "needs-summary") scheduleSummary(row.chat_id);
    };

    // One channel per table. These four bindings used to share a channel, and
    // the two `chats` ones took the two `messages` ones down with them: the
    // channel reported SUBSCRIBED and delivered nothing at all, because
    // `public.chats` is not in the `supabase_realtime` publication. That is the
    // sidebar's whole live path, so a chat that was not open never moved its
    // unread badge or its preview until some unrelated refetch happened to run.
    // See lib/realtimeTableChannels.ts for the measurement.
    const baseName = `chats:user:${userId}`;
    const channels = subscribeByTable<(payload: RealtimeRowPayload) => void, RealtimeChannel>(
      rt,
      baseName,
      [
        { event: "INSERT", schema: "public", table: "messages", handler: handleMessageInsert },
        { event: "UPDATE", schema: "public", table: "messages", handler: handleMessageUpdate },
        { event: "UPDATE", schema: "public", table: "chats", handler: scheduleRefetch },
        { event: "DELETE", schema: "public", table: "chats", handler: scheduleRefetch },
      ],
      (name, status) => {
        if (import.meta.env.DEV) console.debug(`[${name}]`, userId, status);
        // `public.chats` is not published, so its channel joining says nothing
        // about what was missed.
        if (name.endsWith(":messages")) revalidateWhenSubscribed(status);
      },
    );
    for (const { name } of channels) registerChannel(name);

    const receiptsChannelName = `chat-members:receipts:${userId}`;
    const receiptsChannel = rt
      .channel(receiptsChannelName)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_members" },
        (payload: { new: MembershipRowLike }) => {
          if (!payload.new?.chat_id || payload.new.user_id === userId) return;
          applyEvent({ kind: "peer-receipt", row: payload.new });
        },
      )
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[chat-members:receipts]", userId, status);
        revalidateWhenSubscribed(status);
      });
    registerChannel(receiptsChannelName);

    const membershipChannelName = `chat-members:user:${userId}`;
    const membershipChannel = rt
      .channel(membershipChannelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        scheduleRefetch,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        (payload: { new: MembershipRowLike }) => {
          if (!payload.new?.chat_id) return;
          const outcome = applyEvent({ kind: "own-membership", row: payload.new });
          if (outcome === "unknown-chat" || outcome === "needs-refetch") scheduleRefetch();
          else if (outcome === "needs-summary") scheduleSummary(payload.new.chat_id);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        scheduleRefetch,
      )
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[chat-members:user]", userId, status);
        revalidateWhenSubscribed(status);
      });
    registerChannel(membershipChannelName);

    return () => {
      for (const { name, channel } of channels) {
        rt.removeChannel(channel);
        unregisterChannel(name);
      }
      rt.removeChannel(receiptsChannel);
      unregisterChannel(receiptsChannelName);
      rt.removeChannel(membershipChannel);
      unregisterChannel(membershipChannelName);
    };
  }, [userId, rt, supabase, applyEvent, scheduleRefetch, scheduleSummary]);

  useEffect(() => {
    if (!userId) return;
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ChatsRefreshDetail>).detail;
      if (detail?.reason === "message-realtime") return;
      scheduleRefetch();
    };
    window.addEventListener(KUB_CHATS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(KUB_CHATS_REFRESH_EVENT, handleRefresh);
    };
  }, [userId, scheduleRefetch]);

  useEffect(() => {
    const total = chats.reduce((sum, chat) => sum + (chat.unread_count ?? 0), 0);
    document.title = total > 0 ? `(${total}) LETSCUBE` : "LETSCUBE";
  }, [chats]);

  // Coming back to the page. A window `focus` is deliberately not a reason: the
  // page stayed visible, so Realtime kept delivering, and a focus is every click
  // back into the window. See `lib/resumeRevalidation.ts`.
  useEffect(() => {
    const gate = createResumeRevalidationGate({
      minHiddenMs: RESUME_REVALIDATE_AFTER_HIDDEN_MS,
      minIntervalMs: RESUME_REVALIDATE_MIN_INTERVAL_MS,
    });
    if (document.visibilityState === "hidden") gate.hidden();
    const revalidate = () => {
      void fetchChats({ preserveActiveChat: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        gate.hidden();
        return;
      }
      if (gate.visible()) revalidate();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (gate.pageShow(event.persisted)) revalidate();
    };
    // Back from offline always refetches: that is a real reconnect.
    const onOnline = () => {
      if (gate.online()) revalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, [fetchChats]);

  return { chats, loading, refetch: fetchChats };
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latest = value;
    latestMs = ms;
  }
  return latest;
}

async function fetchHiddenMessageIdSet(
  supabase: ReturnType<typeof createClient>,
  messageIds: string[],
): Promise<Set<string>> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (!ids.length) return new Set();
  const { data, error } = await supabase
    .from("message_hidden_for_users")
    .select("message_id")
    .in("message_id", ids);
  if (error) {
    console.error("Hidden chat preview ids fetch error:", error);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.message_id));
}

/**
 * One chat's preview and unread count without the summaries RPC: the newest
 * messages the user may see, and a count of other people's messages since the
 * read mark. The compatibility path for a deployment without the RPC.
 */
async function fetchFallbackChatSummary(
  supabase: ReturnType<typeof createClient>,
  chatId: string,
  userId: string,
  membership: SummaryMembership | null,
): Promise<ChatSummary<SidebarLastMessage>> {
  const effectiveReadAt = latestTimestamp(
    membership?.last_read_at,
    membership?.joined_at,
    membership?.cleared_at,
  );

  let lastMessageQuery = supabase
    .from("messages")
    .select(MESSAGE_LAST_MESSAGE_SELECT)
    .eq("chat_id", chatId)
    .is("deleted_at", null);
  if (membership?.cleared_at) {
    lastMessageQuery = lastMessageQuery.gt("created_at", membership.cleared_at);
  }
  const { data: lastMsgRows } = await lastMessageQuery
    .order("created_at", { ascending: false })
    .limit(25);
  const lastRows = (lastMsgRows ?? []) as SidebarLastMessage[];
  const hiddenLastIds = await fetchHiddenMessageIdSet(
    supabase,
    lastRows.map((message) => message.id),
  );
  const lastMessage = lastRows.find((message) => !hiddenLastIds.has(message.id)) ?? null;

  let unreadQuery = supabase
    .from("messages")
    .select("id", { count: "exact" })
    .eq("chat_id", chatId)
    .or(`user_id.neq.${userId},bot_id.not.is.null`)
    .is("deleted_at", null);
  if (effectiveReadAt) {
    unreadQuery = unreadQuery.gt("created_at", effectiveReadAt);
  }
  const { count } = await unreadQuery.limit(1);
  return { lastMessage, unreadCount: count ?? 0 };
}

async function fetchBatchedChatSummaries(
  supabase: ReturnType<typeof createClient>,
  chatIds: string[],
): Promise<SidebarSummaryMap | null> {
  if (!chatIds.length || chatListSummariesCapability === "unsupported") return null;
  const { data, error } = await supabase.rpc("chat_list_summaries", {
    p_chat_ids: chatIds,
  });
  if (error) {
    if (isChatListSummariesUnavailable(error)) {
      chatListSummariesCapability = "unsupported";
    } else if (import.meta.env.DEV) {
      console.warn("Chat summary batch fetch failed; using compatibility fallback.", error);
    }
    return null;
  }
  chatListSummariesCapability = "supported";
  return buildChatSummaryMap<SidebarLastMessage>(
    (data ?? []).map((row) => ({
      chat_id: row.chat_id,
      last_message: row.last_message as SidebarLastMessage | null,
      unread_count: row.unread_count,
    })),
  );
}

/** Summaries for a few chats already in the list, by the RPC when it exists. */
async function fetchChatSummaries(
  supabase: ReturnType<typeof createClient>,
  chatIds: string[],
  userId: string,
): Promise<SidebarSummaryMap> {
  const batched = await fetchBatchedChatSummaries(supabase, chatIds);
  if (batched) return batched;
  const summaries: SidebarSummaryMap = new Map();
  const listed = useAppStore.getState().chats;
  await Promise.all(chatIds.map(async (chatId) => {
    const chat = listed.find((item) => item.id === chatId);
    if (!chat) return;
    const me = chat.members?.find((member) => member.user_id === userId) ?? null;
    summaries.set(chatId, await fetchFallbackChatSummary(supabase, chatId, userId, {
      joined_at: me?.joined_at ?? null,
      last_read_at: me?.last_read_at ?? null,
      cleared_at: chat.cleared_at ?? null,
    }));
  }));
  return summaries;
}
