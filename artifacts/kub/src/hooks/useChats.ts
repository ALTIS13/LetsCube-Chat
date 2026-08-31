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
import { isIncomingMessage } from "@/lib/messageActor";
import { MESSAGE_LAST_MESSAGE_SELECT } from "@/lib/messageProjection";

const VISIBILITY_REFRESH_THROTTLE_MS = 10_000;
const CHAT_REFETCH_DEBOUNCE_MS = 350;
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
  const lastVisibilityFetchAt = useRef(0);
  const unhideInFlightRef = useRef(new Set<string>());

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
    bumpFetch("useChats");

    try {
      const { data: memberships } = await supabase
        .from("chat_members")
        .select("chat_id, joined_at, last_read_at, last_delivered_at, hidden_at, cleared_at, pinned, pinned_at, pinned_order")
        .eq("user_id", userId);

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
          const effectiveReadAt = latestTimestamp(
            myMembership?.last_read_at,
            myMembership?.joined_at,
            myMembership?.cleared_at,
          );

          const batchedSummary = batchedSummaries?.get(chat.id) ?? null;
          let lastMsgData = batchedSummary?.lastMessage ?? null;
          let unreadCount = batchedSummary?.unreadCount ?? 0;

          if (!batchedSummary) {
            let lastMessageQuery = supabase
              .from("messages")
              .select(MESSAGE_LAST_MESSAGE_SELECT)
              .eq("chat_id", chat.id)
              .is("deleted_at", null);
            if (myMembership?.cleared_at) {
              lastMessageQuery = lastMessageQuery.gt("created_at", myMembership.cleared_at);
            }
            const { data: lastMsgRows } = await lastMessageQuery
              .order("created_at", { ascending: false })
              .limit(25);
            const lastRows = (lastMsgRows ?? []) as SidebarLastMessage[];
            const hiddenLastIds = await fetchHiddenMessageIdSet(
              supabase,
              lastRows.map((message) => message.id),
            );
            lastMsgData = lastRows.find((message) => !hiddenLastIds.has(message.id)) ?? null;

            if (effectiveReadAt) {
              const { count } = await supabase
                .from("messages")
                .select("id", { count: "exact" })
                .eq("chat_id", chat.id)
                .or(`user_id.neq.${userId},bot_id.not.is.null`)
                .gt("created_at", effectiveReadAt)
                .is("deleted_at", null)
                .limit(1);
              unreadCount = count ?? 0;
            } else {
              let unreadQuery = supabase
                .from("messages")
                .select("id", { count: "exact" })
                .eq("chat_id", chat.id)
                .or(`user_id.neq.${userId},bot_id.not.is.null`)
                .is("deleted_at", null)
                .limit(1);
              if (myMembership?.cleared_at) {
                unreadQuery = unreadQuery.gt("created_at", myMembership.cleared_at);
              }
              const { count } = await unreadQuery;
              unreadCount = count ?? 0;
            }
          }

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

      setChats(sortedVisibleChats);
    } finally {
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

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefetch = (payload?: { eventType?: string; new?: { id?: string; chat_id?: string; user_id?: string | null; bot_id?: string | null; type?: string | null; created_at?: string }; old?: { chat_id?: string } }) => {
      const eventChatId = payload?.new?.chat_id ?? payload?.old?.chat_id;
      if (eventChatId && payload?.eventType === "INSERT" && payload.new?.id) {
        dispatchChatsRefresh({ reason: "message-realtime", chatId: eventChatId, messageId: payload.new.id });
        const chat = useAppStore.getState().chats.find((item) => item.id === eventChatId);
        if (
          chat?.type === "private" &&
          isIncomingMessage({
            type: payload.new.type ?? "text",
            user_id: payload.new.user_id ?? null,
            bot_id: payload.new.bot_id ?? null,
          }, userId) &&
          !isSavedChat(chat, userId)
        ) {
          scheduleMarkChatDelivered(supabase, eventChatId, payload.new.created_at);
        }
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fetchChats();
      }, 250);
    };
    const channelName = `chats:user:${userId}`;
    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, debouncedRefetch)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, debouncedRefetch)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chats" }, debouncedRefetch)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chats" }, debouncedRefetch)
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[chats:user]", userId, status);
      });
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [userId, rt, fetchChats]);

  useEffect(() => {
    if (!userId) return;
    const channelName = `chat-members:receipts:${userId}`;
    const channel = rt
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_members" },
        (payload: { new: { chat_id: string; user_id: string; last_read_at: string | null; last_delivered_at: string | null } }) => {
          if (!payload.new.chat_id || payload.new.user_id === userId) return;
          const chat = useAppStore.getState().chats.find((item) => item.id === payload.new.chat_id);
          if (!chat?.members?.some((member) => member.user_id === payload.new.user_id)) return;
          useAppStore.getState().updateChat({
            ...chat,
            members: chat.members.map((member) =>
              member.user_id === payload.new.user_id
                ? { ...member, last_read_at: payload.new.last_read_at, last_delivered_at: payload.new.last_delivered_at }
                : member
            ),
          });
        },
      )
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[chat-members:receipts]", userId, status);
      });
    registerChannel(channelName);
    return () => {
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [userId, rt]);

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fetchChats();
      }, CHAT_REFETCH_DEBOUNCE_MS);
    };
    const channelName = `chat-members:user:${userId}`;
    const channel = rt
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_members", filter: `user_id=eq.${userId}` },
        scheduleRefresh,
      )
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[chat-members:user]", userId, status);
      });
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [userId, rt, fetchChats]);

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ChatsRefreshDetail>).detail;
      if (detail?.reason === "message-realtime") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fetchChats();
      }, CHAT_REFETCH_DEBOUNCE_MS);
    };
    window.addEventListener(KUB_CHATS_REFRESH_EVENT, handleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(KUB_CHATS_REFRESH_EVENT, handleRefresh);
    };
  }, [userId, fetchChats]);

  useEffect(() => {
    const total = chats.reduce((sum, chat) => sum + (chat.unread_count ?? 0), 0);
    document.title = total > 0 ? `(${total}) LETSCUBE` : "LETSCUBE";
  }, [chats]);

  useEffect(() => {
    const refreshAfterBackground = (force = false) => {
      const now = Date.now();
      if (!force && now - lastVisibilityFetchAt.current < VISIBILITY_REFRESH_THROTTLE_MS) return;
      lastVisibilityFetchAt.current = now;
      void fetchChats({ preserveActiveChat: true });
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refreshAfterBackground();
    };
    const onOnline = () => {
      refreshAfterBackground();
    };
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      refreshAfterBackground();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      refreshAfterBackground(event.persisted);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
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
