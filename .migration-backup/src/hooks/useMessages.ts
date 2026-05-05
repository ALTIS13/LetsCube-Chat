"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type { MessageWithSender } from "@/types/database";
import { useAppStore } from "@/store/app.store";

export function useMessages(chatId: string | null, topicId: string | null = null) {
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const { messages, setMessages, addMessage, replaceMessage, removeMessage, currentUser, mutedChatIds } = useAppStore();

  const supabase = createClient(); // REST-операции
  const rt = getRealtimeClient();  // WebSocket каналы

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof rt.channel> | null>(null);

  const currentUserRef = useRef(currentUser);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  const mutedRef = useRef(mutedChatIds);
  useEffect(() => { mutedRef.current = mutedChatIds; }, [mutedChatIds]);
  const chatIdRef = useRef(chatId);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  // topicId is passed into INSERTs and used to filter the realtime stream so
  // we only show messages from the active topic in forum chats.
  const topicIdRef = useRef(topicId);
  useEffect(() => { topicIdRef.current = topicId; }, [topicId]);

  const fetchMessages = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    let query = supabase
      .from("messages")
      .select(`*, sender:profiles!user_id(*), reactions(*)`)
      .eq("chat_id", chatId)
      .is("deleted_at", null);
    // Forum chats: scope to the selected topic.  Non-forum: all messages
    // have topic_id = null, so the filter is a no-op when topicId is null.
    query = topicId ? query.eq("topic_id", topicId) : query.is("topic_id", null);
    const { data } = await query
      .order("created_at", { ascending: true })
      .limit(100);
    if (data) setMessages(chatId, data as unknown as MessageWithSender[]);
    setLoading(false);
    const user = currentUserRef.current;
    if (user) {
      await supabase.from("chat_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("chat_id", chatId)
        .eq("user_id", user.id);
    }
  }, [chatId, topicId, supabase, setMessages]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // Typing broadcast
  useEffect(() => {
    if (!chatId || !currentUser) return;
    const ch = rt.channel(`room:${chatId}`, { config: { broadcast: { ack: false } } });
    ch.on("broadcast", { event: "typing" }, (payload: { payload?: { userId?: string } }) => {
      if (payload.payload?.userId !== currentUserRef.current?.id) {
        setIsTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setIsTyping(false), 3000);
      }
    }).subscribe((status: string) => console.log("[typing]", status));
    typingChannelRef.current = ch;
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      rt.removeChannel(ch);
      typingChannelRef.current = null;
    };
  }, [chatId, currentUser, rt]);

  const sendTyping = useCallback(() => {
    const ch = typingChannelRef.current;
    const user = currentUserRef.current;
    if (!chatIdRef.current || !user || !ch) return;
    ch.send({ type: "broadcast", event: "typing", payload: { userId: user.id } });
  }, []);

  // postgres_changes for new/updated messages
  useEffect(() => {
    if (!chatId || !currentUser) return;

    const channel = rt
      .channel(`db:${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload: { new: { id: string; chat_id: string; topic_id: string | null; user_id: string; type: string; content: string | null } }) => {
          if (payload.new.chat_id !== chatIdRef.current) return;
          // Filter by topic — ignore messages from other topics in the same chat.
          if ((payload.new.topic_id ?? null) !== (topicIdRef.current ?? null)) return;
          const { data } = await supabase
            .from("messages")
            .select(`*, sender:profiles!user_id(*), reply_to:messages!reply_to_id(id, content, type, user_id, sender:profiles(id, full_name)), reactions(*)`)
            .eq("id", payload.new.id)
            .single();
          if (!data) return;
          addMessage(payload.new.chat_id, data as unknown as MessageWithSender);
          const user = currentUserRef.current;
          if (user && data.user_id !== user.id && document.hidden &&
              Notification.permission === "granted" && !mutedRef.current.includes(payload.new.chat_id)) {
            const senderName = (data as unknown as MessageWithSender).sender?.full_name ?? "Новое сообщение";
            const body = data.type === "text" ? (data.content ?? "")
              : data.type === "image" ? "🖼 Фото"
              : data.type === "audio" ? "🎤 Голосовое сообщение"
              : data.type === "video" ? "🎬 Видео" : "📎 Файл";
            new Notification(senderName, { body, icon: "/icons/icon-192.png", tag: payload.new.chat_id });
          }
          if (user && data.user_id !== user.id) {
            await supabase.from("chat_members")
              .update({ last_read_at: new Date().toISOString() })
              .eq("chat_id", payload.new.chat_id)
              .eq("user_id", user.id);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        async (payload: { new: { id: string; chat_id: string; deleted_at: string | null } }) => {
          if (payload.new.chat_id !== chatIdRef.current) return;
          // Soft-delete: remove from store entirely so the bubble disappears.
          if (payload.new.deleted_at) {
            removeMessage(payload.new.chat_id, payload.new.id);
            return;
          }
          const { data } = await supabase
            .from("messages")
            .select("*, sender:profiles!user_id(*), reactions(*)")
            .eq("id", payload.new.id)
            .single();
          if (data) {
            const current = useAppStore.getState().messages[payload.new.chat_id] ?? [];
            setMessages(payload.new.chat_id, current.map((m) => m.id === data.id ? (data as MessageWithSender) : m));
          }
        }
      )
      .subscribe((status: string) => console.log("[messages]", status));

    return () => { rt.removeChannel(channel); };
  }, [chatId, currentUser, rt, addMessage, setMessages]);

  const sendMessage = useCallback(async (content: string, replyToId?: string) => {
    const user = currentUserRef.current;
    const trimmed = content.trim();
    if (!chatId || !user || !trimmed) return null;

    // 1) Optimistic: render the message instantly with a temporary id.
    //    The real DB id will replace `tempId` when INSERT returns; the realtime
    //    echo that follows is deduped by the upsert in addMessage.
    const tempId = `tmp:${crypto.randomUUID()}`;
    const optimistic: MessageWithSender = {
      id: tempId,
      chat_id: chatId,
      topic_id: topicId,
      user_id: user.id,
      content: trimmed,
      type: "text",
      media_url: null,
      reply_to_id: replyToId ?? null,
      forwarded_from_id: null,
      edited_at: null,
      deleted_at: null,
      pinned: false,
      created_at: new Date().toISOString(),
      sender: user,
      reactions: [],
      pending: true,
    };
    addMessage(chatId, optimistic);

    // 2) Real INSERT.
    const { data, error } = await supabase
      .from("messages")
      .insert({ chat_id: chatId, topic_id: topicId, user_id: user.id, content: trimmed, type: "text", reply_to_id: replyToId ?? null })
      .select("*, sender:profiles!user_id(*), reactions(*)")
      .single();

    if (error || !data) {
      console.error("Send error:", error);
      // Mark as failed but keep the bubble visible so the user can see something went wrong.
      replaceMessage(chatId, tempId, { ...optimistic, pending: false, failed: true });
      return null;
    }

    // 3) Swap the temp message for the canonical server copy.
    replaceMessage(chatId, tempId, data as unknown as MessageWithSender);

    await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
    return data;
  }, [chatId, topicId, supabase, addMessage, replaceMessage]);

  // ── Edit ────────────────────────────────────────────────────────────────
  // UPDATE the row; the realtime UPDATE handler above will replace the message
  // with the freshly-joined data, so no manual store push is needed here.
  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    const trimmed = newContent.trim();
    if (!chatId || !trimmed) return;
    const { error } = await supabase
      .from("messages")
      .update({ content: trimmed, edited_at: new Date().toISOString() })
      .eq("id", messageId);
    if (error) console.error("Edit error:", error);
  }, [chatId, supabase]);

  // ── Delete (soft) ───────────────────────────────────────────────────────
  // Set deleted_at; realtime UPDATE handler removes the bubble from view.
  const deleteMessage = useCallback(async (messageId: string) => {
    if (!chatId) return;
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);
    if (error) console.error("Delete error:", error);
  }, [chatId, supabase]);

  // ── Pin / unpin ─────────────────────────────────────────────────────────
  const togglePin = useCallback(async (messageId: string, currentlyPinned: boolean) => {
    if (!chatId) return;
    const { error } = await supabase
      .from("messages")
      .update({ pinned: !currentlyPinned })
      .eq("id", messageId);
    if (error) console.error("Pin error:", error);
  }, [chatId, supabase]);

  // ── Forward ─────────────────────────────────────────────────────────────
  // Insert a copy of the message into a target chat.  We carry over content,
  // type and media_url, and link back via forwarded_from_id.
  const forwardMessage = useCallback(async (
    src: MessageWithSender,
    targetChatId: string,
  ) => {
    const user = currentUserRef.current;
    if (!user) return null;
    const { data, error } = await supabase
      .from("messages")
      .insert({
        chat_id: targetChatId,
        user_id: user.id,
        content: src.content,
        type: src.type,
        media_url: src.media_url,
        forwarded_from_id: src.id,
      })
      .select("*, sender:profiles!user_id(*), reactions(*)")
      .single();
    if (error) { console.error("Forward error:", error); return null; }
    await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", targetChatId);
    return data;
  }, [supabase]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const user = currentUserRef.current;
    if (!user) return;
    const { data: existing } = await supabase.from("reactions").select("id")
      .eq("message_id", messageId).eq("user_id", user.id).eq("emoji", emoji).single();
    if (existing) {
      await supabase.from("reactions").delete().eq("id", existing.id);
    } else {
      await supabase.from("reactions").insert({ message_id: messageId, user_id: user.id, emoji });
    }
    const { data: updatedMsg } = await supabase.from("messages")
      .select("*, sender:profiles!user_id(*), reactions(*)")
      .eq("id", messageId).single();
    if (updatedMsg && chatId) {
      const current = useAppStore.getState().messages[chatId] ?? [];
      setMessages(chatId, current.map((m) => m.id === messageId ? (updatedMsg as MessageWithSender) : m));
    }
  }, [chatId, supabase, setMessages]);

  return {
    messages: messages[chatId ?? ""] ?? [],
    loading, isTyping,
    sendMessage, sendTyping, toggleReaction,
    editMessage, deleteMessage, togglePin, forwardMessage,
    refetch: fetchMessages,
  };
}
