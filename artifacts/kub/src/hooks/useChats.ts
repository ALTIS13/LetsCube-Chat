"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type { ChatWithLastMessage, Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { KUB_CHATS_REFRESH_EVENT, type ChatsRefreshDetail } from "@/lib/chatEvents";
import { isSavedChat } from "@/lib/chatDisplay";

const VISIBILITY_REFRESH_THROTTLE_MS = 10_000;
const CHAT_REFETCH_DEBOUNCE_MS = 350;

export function useChats() {
  const [loading, setLoading] = useState(true);
  const chats = useAppStore((s) => s.chats);
  const setChats = useAppStore((s) => s.setChats);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = createClient();
  const rt = getRealtimeClient();
  const fetchInFlightRef = useRef(false);
  const fetchQueuedRef = useRef(false);
  const lastVisibilityFetchAt = useRef(0);

  type MyMembershipRow = {
    chat_id: string;
    last_read_at: string | null;
    hidden_at: string | null;
    cleared_at: string | null;
    pinned: boolean;
    pinned_at: string | null;
  };

  const fetchChats = useCallback(async () => {
    if (!userId) {
      setChats([]);
      setLoading(false);
      return;
    }

    if (fetchInFlightRef.current) {
      fetchQueuedRef.current = true;
      return;
    }

    fetchInFlightRef.current = true;
    bumpFetch("useChats");

    try {
      const { data: memberships } = await supabase
        .from("chat_members")
        .select("chat_id, last_read_at, hidden_at, cleared_at, pinned, pinned_at")
        .eq("user_id", userId);

      if (!memberships?.length) {
        setChats([]);
        const selectedChatId = useAppStore.getState().selectedChatId;
        if (selectedChatId) useAppStore.getState().setSelectedChatId(null);
        return;
      }

      const myMemberships = (memberships ?? []) as MyMembershipRow[];
      const membershipByChat = new Map(myMemberships.map((membership) => [membership.chat_id, membership]));
      const chatIds = myMemberships.map((m) => m.chat_id);

      const { data: chatsData } = await supabase
        .from("chats")
        .select("*, members:chat_members(user_id, role, last_read_at, profile:profiles(*))")
        .in("id", chatIds)
        .order("updated_at", { ascending: false });

      if (!chatsData) return;

      const enriched: ChatWithLastMessage[] = await Promise.all(
        chatsData.map(async (chat) => {
          const { data: lastMsgData } = await supabase
            .from("messages")
            .select("*, sender:profiles(*)")
            .eq("chat_id", chat.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const myMembership = membershipByChat.get(chat.id) ?? null;

          let unreadCount = 0;
          if (myMembership?.last_read_at) {
            const { count } = await supabase
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("chat_id", chat.id)
              .neq("user_id", userId)
              .gt("created_at", myMembership.last_read_at)
              .is("deleted_at", null);
            unreadCount = count ?? 0;
          } else {
            const { count } = await supabase
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("chat_id", chat.id)
              .neq("user_id", userId)
              .is("deleted_at", null);
            unreadCount = count ?? 0;
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

          return {
            ...chat,
            name: displayName,
            avatar_url: displayAvatarUrl,
            other_user: otherUser,
            last_message: lastMsgData ?? undefined,
            unread_count: unreadCount,
            is_pinned: Boolean(myMembership?.pinned),
            pinned_at: myMembership?.pinned_at ?? null,
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

      visibleChats.sort((a, b) => {
        const aSaved = isSavedChat(a, userId);
        const bSaved = isSavedChat(b, userId);
        if (aSaved !== bSaved) return aSaved ? -1 : 1;
        const aPinned = Boolean(a.is_pinned);
        const bPinned = Boolean(b.is_pinned);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        if (aPinned && bPinned) {
          const aPinnedAt = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
          const bPinnedAt = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
          if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
        }
        const aTime = a.last_message?.created_at ?? a.updated_at;
        const bTime = b.last_message?.created_at ?? b.updated_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      // Reconcile stale active chat after delete/member removal. Only clear
      // after a successful fresh list proves the selected chat is no longer visible.
      const selectedChatId = useAppStore.getState().selectedChatId;
      if (selectedChatId && !visibleChats.some((chat) => chat.id === selectedChatId)) {
        useAppStore.getState().setSelectedChatId(null);
      }

      setChats(visibleChats);
    } finally {
      setLoading(false);
      fetchInFlightRef.current = false;
      if (fetchQueuedRef.current) {
        fetchQueuedRef.current = false;
        window.setTimeout(() => {
          void fetchChats();
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
    const debouncedRefetch = () => {
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
    document.title = total > 0 ? `(${total}) KUB` : "KUB";
  }, [chats]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibilityFetchAt.current < VISIBILITY_REFRESH_THROTTLE_MS) return;
      lastVisibilityFetchAt.current = now;
      void fetchChats();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchChats]);

  return { chats, loading, refetch: fetchChats };
}
