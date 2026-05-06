"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type { MessageWithSender } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";

export function useMessages(chatId: string | null, topicId: string | null = null) {
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  // Per-slice selectors: не подписываемся на весь store (раньше любая
  // мутация — chats, selectedChatId, mutedChatIds — ререндерила хук). Сами
  // setMessages/addMessage/replaceMessage в zustand стабильны по ссылке.
  // NB: removeMessage intentionally not used — soft-deletes keep the row
  // in store so the bubble can render a "сообщение удалено" placeholder.
  const messages = useAppStore((s) => s.messages);
  const setMessages = useAppStore((s) => s.setMessages);
  const addMessage = useAppStore((s) => s.addMessage);
  const replaceMessage = useAppStore((s) => s.replaceMessage);
  const currentUser = useAppStore((s) => s.currentUser);
  const mutedChatIds = useAppStore((s) => s.mutedChatIds);
  const userId = currentUser?.id ?? null;

  const supabase = createClient(); // REST-операции
  const rt = getRealtimeClient();  // WebSocket каналы

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof rt.channel> | null>(null);

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
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
    bumpFetch("useMessages");
    setLoading(true);
    // NB: we do NOT filter out `deleted_at IS NOT NULL` here.  Soft-deleted
    // rows are kept in the timeline so MessageBubble can render a
    // "сообщение удалено" placeholder in the slot they used to occupy —
    // this matches Telegram-style soft delete and prevents the timeline
    // from "shifting" when a message is removed (own scroll position,
    // reply anchors, date separators all stay stable).  Original content
    // is scrubbed server-side by policy / scheduled job.
    let query = supabase
      .from("messages")
      .select(`*, sender:profiles!user_id(*), reactions(*)`)
      .eq("chat_id", chatId);
    // Forum chats: scope to the selected topic.  Non-forum: all messages
    // have topic_id = null, so the filter is a no-op when topicId is null.
    query = topicId ? query.eq("topic_id", topicId) : query.is("topic_id", null);
    const { data } = await query
      .order("created_at", { ascending: true })
      .limit(100);
    if (data) {
      const fetched = data as unknown as MessageWithSender[];
      const existing = useAppStore.getState().messages[chatId] ?? [];
      setMessages(chatId, mergeMessagesById(fetched, existing));
    }
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

  // Typing broadcast — one channel per chat, stable name, dev-only diag.
  // Зависимости — на примитив `userId`, не на объект `currentUser`, чтобы
  // канал не пересоздавался на каждое heartbeat-echo (Task #48).
  useEffect(() => {
    if (!chatId || !userId) return;
    const channelName = `messages:chat:${chatId}:typing`;
    const ch = rt.channel(channelName, { config: { broadcast: { ack: false } } });
    ch.on("broadcast", { event: "typing" }, (payload: { payload?: { userId?: string } }) => {
      if (payload.payload?.userId !== currentUserRef.current?.id) {
        setIsTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setIsTyping(false), 3000);
      }
    }).subscribe((status: string) => {
      if (import.meta.env.DEV) console.debug("[messages:typing]", chatId, status);
    });
    typingChannelRef.current = ch;
    registerChannel(channelName);
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      rt.removeChannel(ch);
      typingChannelRef.current = null;
      unregisterChannel(channelName);
    };
  }, [chatId, userId, rt]);

  const sendTyping = useCallback(() => {
    const ch = typingChannelRef.current;
    const user = currentUserRef.current;
    if (!chatIdRef.current || !user || !ch) return;
    ch.send({ type: "broadcast", event: "typing", payload: { userId: user.id } });
  }, []);

  // postgres_changes for new/updated messages.
  //
  // Channel name is stable per-chat (`messages:chat:{id}`) and we set a
  // server-side `chat_id=eq.X` filter on each subscription so the realtime
  // backend doesn't shower us with rows from chats we aren't viewing.  The
  // RLS layer additionally guarantees we only ever see rows we're allowed
  // to read, but the explicit filter keeps the wire chatter down.
  useEffect(() => {
    if (!chatId || !userId) return;

    const channelName = `messages:chat:${chatId}`;
    const channel = rt
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        async (payload: { new: MessageWithSender }) => {
          if (payload.new.chat_id !== chatIdRef.current) return;
          // Filter by topic — ignore messages from other topics in the same chat.
          if ((payload.new.topic_id ?? null) !== (topicIdRef.current ?? null)) return;
          const provisional = buildRealtimeMessage(payload.new);
          if (isRealtimeVoiceMessage(provisional)) {
            addMessage(payload.new.chat_id, provisional);
          }
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
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        async (payload: { new: { id: string; chat_id: string; deleted_at: string | null } }) => {
          if (payload.new.chat_id !== chatIdRef.current) return;
          // Re-fetch the row (pulls in sender + reactions + cleared content
          // for soft-deletes).  We patch in place so soft-deletes keep their
          // slot in the stream and render as a "сообщение удалено" placeholder
          // rather than vanishing — matches Telegram-style soft delete UX.
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
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[messages:chat]", chatId, status);
      });
    registerChannel(channelName);

    return () => {
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [chatId, userId, rt, addMessage, setMessages]);

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
    const { data: existing, error: lookupError } = await supabase.from("reactions").select("id")
      .eq("message_id", messageId).eq("user_id", user.id).eq("emoji", emoji).maybeSingle();
    if (lookupError) {
      console.error("Reaction lookup error:", lookupError);
      return;
    }
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

function buildRealtimeMessage(row: MessageWithSender): MessageWithSender {
  // Receiver path: render voice bubbles from the realtime INSERT row
  // immediately. The richer REST refetch below upserts the same id with
  // sender/reactions, so this temporary row only covers the first paint.
  return {
    ...row,
    media_url: row.media_url ?? null,
    content: row.content ?? null,
    reactions: row.reactions ?? [],
    pending: false,
  };
}

function mergeMessagesById(
  fetched: MessageWithSender[],
  existing: MessageWithSender[],
): MessageWithSender[] {
  if (!existing.length) return fetched;
  const byId = new Map(fetched.map((message) => [message.id, message]));
  for (const message of existing) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

function isRealtimeVoiceMessage(message: MessageWithSender): boolean {
  if (message.type === "audio") return true;

  const mediaUrl = (message.media_url ?? "").toLowerCase();
  const content = (message.content ?? "").toLowerCase();

  // Receiver realtime INSERT rows can arrive before the joined REST refetch.
  // Detect audio from stable row fields so the voice bubble/progress skeleton
  // renders on first paint, even if the richer message copy follows later.
  return (
    /\b(audio|voice)\b/.test(content) ||
    /\.(webm|ogg|oga|mp3|wav|m4a|aac)(?:[?#].*)?$/.test(mediaUrl) ||
    mediaUrl.includes("/voice") ||
    mediaUrl.includes("/audio")
  );
}
