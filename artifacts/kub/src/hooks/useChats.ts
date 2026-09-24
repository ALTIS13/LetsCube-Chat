"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { dispatchChatsRefresh, KUB_CHATS_REFRESH_EVENT, type ChatsRefreshDetail } from "@/lib/chatEvents";
import { fetchChatBots } from "@/lib/chatBotMembership";
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
import { mapPgError } from "@/lib/errors";
import {
  LIST_READ_PENDING,
  listReadCleared,
  listReadEnded,
  listReadRefused,
  listReadSucceeded,
  listReadView,
  type ListReadProgress,
} from "@/lib/listReadState";
import { CHATS_UNAVAILABLE, plainFailure } from "@/lib/plainMessages";
import { isIncomingMessage } from "@/lib/messageActor";
import { MESSAGE_LAST_MESSAGE_SELECT } from "@/lib/messageProjection";
import { clearedAtCache } from "@/lib/clearedAtCache";
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
  // F-6. Three facts and not one: whether a read is in flight, whether the last
  // one failed, and whether anything has ever come back for this account. The
  // hook used to hold only the first, so a refused read left «Чаты не
  // найдены» on screen — a sentence about the person's account, made out of
  // a request that never got an answer. The rows stay in the store, where a
  // realtime event applies to one of them at a time; only the reading's own
  // state is held here.
  const [read, setRead] = useState<ListReadProgress>(LIST_READ_PENDING);
  const loading = read.loading;
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
      // Nobody is signed in. An empty list is the true answer here, and it is
      // the answer — not the absence of one.
      setChats([]);
      setRead(listReadCleared());
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
      const membershipRead = clearedAtCache.beginMembershipRead();
      const { data: memberships, error: membershipsError } = await supabase
        .from("chat_members")
        .select("chat_id, joined_at, last_read_at, last_delivered_at, hidden_at, cleared_at, pinned, pinned_at, pinned_order")
        .eq("user_id", userId);

      // A request that failed says nothing about the chats. Read as "no
      // memberships", it emptied the list and closed the open chat whenever a
      // revalidation ran before requests went through again — which a reconnect
      // makes likely, because the socket can rejoin a moment earlier.
      //
      // Keeping the rows was half of it (F-6). The other half is saying so: the
      // sidebar drew «Чаты не найдены» for a person whose reads are all being
      // refused — which is what the restrictive «block banned» policy on `chats`
      // does, silently and with no error at all.
      if (membershipsError) {
        setRead((previous) =>
          listReadRefused(previous, {
            subject: userId,
            message: plainFailure(mapPgError(membershipsError), CHATS_UNAVAILABLE),
          }),
        );
        return;
      }

      if (!memberships?.length) {
        if (!preserveActiveChat) {
          setChats([]);
          const selectedChatId = useAppStore.getState().selectedChatId;
          if (selectedChatId) useAppStore.getState().setSelectedChatId(null);
        }
        // This one really is an empty list: the read came back and said so.
        setRead(listReadSucceeded(userId));
        return;
      }

      const myMemberships = (memberships ?? []) as MyMembershipRow[];
      clearedAtCache.seedFromMembershipRead(userId, myMemberships, membershipRead);
      const membershipByChat = new Map(myMemberships.map((membership) => [membership.chat_id, membership]));
      const chatIds = myMemberships.map((m) => m.chat_id);

      const { data: chatsData, error: chatsError } = await supabase
        .from("chats")
        .select("*, members:chat_members(user_id, role, joined_at, last_read_at, last_delivered_at, profile:profiles(*))")
        .in("id", chatIds)
        .order("updated_at", { ascending: false });

      // `error` was not even destructured here, so this read's refusal left the
      // list exactly as it was and told nobody — and the memberships above had
      // just proved the person has chats.
      if (chatsError || !chatsData) {
        setRead((previous) =>
          listReadRefused(previous, {
            subject: userId,
            message: plainFailure(chatsError ? mapPgError(chatsError) : null, CHATS_UNAVAILABLE),
          }),
        );
        return;
      }

      const batchedSummaries = await fetchBatchedChatSummaries(supabase, chatIds);
      // Which of these chats hold a bot (D-236). One request for the whole
      // list, because the SELECT policy on `chat_bot_members` lets a member
      // read the membership of every chat they are in — and because the
      // alternative is one request per row on every fetch. It answers an empty
      // map on a refusal, so a list that cannot read it looks exactly like a
      // list with no bots in it, which is what it looked like yesterday.
      const botsByChat = await fetchChatBots(chatIds);

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
            bots: botsByChat.get(chat.id) ?? [],
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
      setRead(listReadSucceeded(userId));
    } finally {
      eventsDuringFetchRef.current = null;
      setRead(listReadEnded);
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
    // channel reported SUBSCRIBED and delivered nothing at all. That is the
    // sidebar's whole live path, so a chat that was not open never moved its
    // unread badge or its preview until some unrelated refetch happened to run.
    //
    // The cause given here used to be `public.chats` missing from the
    // `supabase_realtime` publication — withdrawn, for the reason set out in
    // the status callback below and in lib/realtimeTableChannels.ts, which also
    // holds the measurement the rule actually rests on.
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
        // Only the messages channel's own status is trusted to mean «I have
        // not missed anything».
        //
        // This said «`public.chats` is not published». Measured read-only on
        // production on 2026-09-18: it **is** — one of 33 tables in
        // `supabase_realtime` — and no migration in `.migration-backup` adds
        // it, so either it was added outside a tracked migration or it was
        // always there. The gate stays as it is either way: `messages` is the
        // table whose events this list would actually miss, and a `chats`
        // channel joining says nothing about a message that arrived while it
        // was away.
        if (name.endsWith(":messages")) revalidateWhenSubscribed(status);
      },
    );
    for (const { name } of channels) registerChannel(name);

    // Everybody else's membership rows, in every chat this user may read.
    //
    // Unfiltered on purpose: Realtime takes one `eq` filter and the question
    // here is «any chat I am in», which no single column answers. RLS answers
    // it instead — `chat_members select` is
    // `user_id = auth.uid() OR is_chat_member(chat_id)` (read from
    // `pg_policies` on 2026-09-19), so the server sends this client rows from
    // its own chats and no others. The three bindings share one channel
    // because they share one table, which is what `realtimeTableChannels.ts`
    // requires and all it requires.
    //
    // D-260: the INSERT and the DELETE are new. Before them the only join or
    // departure this hook could hear was this user's own — the bindings below
    // carry `filter: user_id=eq.${userId}` — so `chat.members` grew and shrank
    // for nobody else, and the header's «N участников», the channel header's
    // «N подписчиков» and every other reader of that array stood still until
    // something unrelated refetched the list.
    const receiptsChannelName = `chat-members:peers:${userId}`;
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_members" },
        (payload: { new: MembershipRowLike }) => {
          if (!payload.new?.chat_id || payload.new.user_id === userId) return;
          // `needs-refetch` every time it lands: the appended row has the count
          // right but no profile, and the refetch is what gives it a name.
          if (applyEvent({ kind: "peer-joined", row: payload.new }) !== "ignored") scheduleRefetch();
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_members" },
        // `Partial`, and not for tidiness: a DELETE payload carries only the
        // columns of the replica identity, which for `chat_members` is its
        // primary key. The guard below is what makes the row whole.
        (payload: { old: Partial<MembershipRowLike> }) => {
          const { chat_id: chatId, user_id: memberId } = payload.old ?? {};
          if (!chatId || !memberId || memberId === userId) return;
          applyEvent({ kind: "peer-left", row: { chat_id: chatId, user_id: memberId } });
        },
      )
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[chat-members:peers]", userId, status);
        revalidateWhenSubscribed(status);
      });
    registerChannel(receiptsChannelName);

    const membershipChannelName = `chat-members:user:${userId}`;
    const membershipChannel = rt
      .channel(membershipChannelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        (payload: { new: MembershipRowLike }) => {
          if (payload.new?.chat_id) clearedAtCache.evictChat(payload.new.chat_id);
          scheduleRefetch();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        (payload: { new: MembershipRowLike }) => {
          if (!payload.new?.chat_id) return;
          if ("cleared_at" in payload.new) {
            const previous = useAppStore.getState().chats.find((chat) => chat.id === payload.new.chat_id);
            if (previous?.cleared_at !== payload.new.cleared_at) clearedAtCache.evictChat(payload.new.chat_id);
          }
          const outcome = applyEvent({ kind: "own-membership", row: payload.new });
          if (outcome === "unknown-chat" || outcome === "needs-refetch") scheduleRefetch();
          else if (outcome === "needs-summary") scheduleSummary(payload.new.chat_id);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        (payload: { old: Partial<MembershipRowLike> }) => {
          if (payload.old?.chat_id) clearedAtCache.evictChat(payload.old.chat_id);
          scheduleRefetch();
        },
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

  return {
    chats,
    loading,
    /** The refused read's sentence, or null. Already in a person's words. */
    error: read.error,
    /** `loading | unavailable | stale | ready` — see `lib/listReadState.ts`. */
    view: listReadView(read),
    refetch: fetchChats,
  };
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
): Promise<Set<string> | null> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (!ids.length) return new Set();
  const { data, error } = await supabase
    .from("message_hidden_for_users")
    .select("message_id")
    .in("message_id", ids);
  if (error) {
    console.error("Hidden chat preview ids fetch error:", error);
    return null;
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
  const lastMessage = hiddenLastIds
    ? lastRows.find((message) => !hiddenLastIds.has(message.id)) ?? null
    : null;

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
