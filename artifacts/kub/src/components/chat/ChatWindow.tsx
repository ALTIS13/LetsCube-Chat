"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ChatHeader } from "./ChatHeader";
import { PinnedMessage } from "./PinnedMessage";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { ForwardModal } from "./ForwardModal";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { TopicStrip } from "./TopicStrip";
import { useTopics } from "@/hooks/useTopics";
import { useMessages } from "@/hooks/useMessages";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import { KubEmptyState, KubIcon } from "@/components/kub";
import { bumpMount, bumpUnmount } from "@/lib/dev/instrumentation";
import type { MessageWithSender } from "@/types/database";

interface ChatWindowProps {
  chatId: string;
}

export function ChatWindow({ chatId }: ChatWindowProps) {
  // Dev-only mount/unmount счётчик. Должен скакать только при смене чата
  // (новый key={chatId} в родителе), не при heartbeat-эхо (Task #48).
  useEffect(() => {
    bumpMount("ChatWindow");
    return () => bumpUnmount("ChatWindow");
  }, []);
  const chats = useAppStore((s) => s.chats);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const markChatRead = useAppStore((s) => s.markChatRead);
  const setEditingMessage = useAppStore((s) => s.setEditingMessage);
  const setForwardingMessage = useAppStore((s) => s.setForwardingMessage);
  const forwardingMessage = useAppStore((s) => s.forwardingMessage);
  const selectedTopicId = useAppStore((s) => s.selectedTopicId);
  const chat = chats.find((c) => c.id === chatId);
  const isForum = !!chat?.is_forum;
  const { topics, createTopic } = useTopics(chatId, isForum);
  const {
    messages, pinnedMessages, loading, isTyping,
    sendMessage, sendTyping, toggleReaction,
    editMessage, deleteMessage, togglePin, forwardMessage, clearChatForMe,
  } = useMessages(chatId, isForum ? selectedTopicId : null);

  useEffect(() => { markChatRead(chatId); }, [chatId, markChatRead]);

  const [replyTo, setReplyTo] = useState<MessageWithSender | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [openMedia, setOpenMedia] = useState<MediaViewerItem | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const supabase = createClient();

  const myRole = (chat?.members?.find((m) => m.user_id === userId)?.role ?? null) as
    | "owner" | "admin" | "member" | null;
  const canManageTopics = myRole === "owner" || myRole === "admin";

  const handleSend = async (content: string) => {
    await sendMessage(content, replyTo?.id);
    setReplyTo(null);
  };

  const handleSendVoice = useCallback(async (blob: Blob, durationMs: number, mimeType: string) => {
    if (!userId) {
      alert("Войдите в аккаунт, чтобы отправлять голосовые сообщения.");
      return;
    }
    if (!blob || blob.size === 0 || durationMs < 1000) {
      alert("Запись слишком короткая или пустая.");
      return;
    }
    const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
    const path = `${userId}/voice_${Date.now()}.${ext}`;
    const durationSec = Math.max(1, Math.round(durationMs / 1000));

    let uploadedPath: string | null = null;
    try {
      const { data, error } = await supabase.storage
        .from("media")
        .upload(path, blob, { contentType: mimeType, upsert: false });
      if (error || !data) {
        console.error("[voice] upload error:", error);
        alert("Не удалось загрузить голосовое сообщение. Проверьте соединение и попробуйте ещё раз.");
        return;
      }
      uploadedPath = data.path;
    } catch (err) {
      console.error("[voice] upload threw:", err);
      alert("Не удалось загрузить голосовое сообщение. Проверьте соединение и попробуйте ещё раз.");
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(uploadedPath);

    try {
      const mm = Math.floor(durationSec / 60).toString().padStart(2, "0");
      const ss = (durationSec % 60).toString().padStart(2, "0");
      const { error: insertErr } = await supabase.from("messages").insert({
        chat_id: chatId,
        user_id: userId,
        type: "audio",
        media_url: publicUrl,
        content: `🎤 Голосовое сообщение (${mm}:${ss})`,
      });
      if (insertErr) {
        console.error("[voice] insert error:", insertErr);
        try { await supabase.storage.from("media").remove([uploadedPath]); }
        catch (cleanupErr) { console.error("[voice] orphan cleanup failed:", cleanupErr); }
        alert("Не удалось сохранить сообщение в чате. Попробуйте позже.");
        return;
      }
    } catch (err) {
      console.error("[voice] insert threw:", err);
      try { await supabase.storage.from("media").remove([uploadedPath]); }
      catch (cleanupErr) { console.error("[voice] orphan cleanup failed:", cleanupErr); }
      alert("Не удалось сохранить сообщение в чате. Попробуйте позже.");
      return;
    }

    try {
      await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
    } catch (err) {
      console.error("[voice] chats.updated_at bump failed:", err);
    }
  }, [chatId, userId, supabase]);

  const jumpToMessage = useCallback((messageId: string) => {
    setHighlightedId(messageId);
    const el = messageRefs.current[messageId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedId(null), 2000);
    }
  }, []);

  const handleJumpToPinned = useCallback((msg: MessageWithSender) => {
    const el = messageRefs.current[msg.id];
    if (!el) {
      setPinError("Сообщение пока не загружено.");
      window.setTimeout(() => setPinError(null), 4000);
      return;
    }
    jumpToMessage(msg.id);
  }, [jumpToMessage]);

  const handleTogglePin = useCallback(async (msg: MessageWithSender) => {
    setPinError(null);
    const result = await togglePin(msg.id, msg.pinned);
    if (!result.ok) {
      setPinError(result.error ?? "Недостаточно прав для закрепления сообщения.");
      window.setTimeout(() => setPinError(null), 5000);
    }
  }, [togglePin]);

  return (
    <div className="flex h-full w-full bg-[var(--kub-chat-bg)]">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          chatId={chatId}
          chat={chat}
          onSearchOpen={() => setShowSearch(true)}
          onInfoOpen={() => setShowInfo(true)}
          onClearForMe={clearChatForMe}
        />

        {isForum && (
          <TopicStrip
            topics={topics}
            canManage={canManageTopics}
            onCreate={createTopic}
          />
        )}

        {showSearch && (
          <ChatSearchBar
            messages={messages}
            onClose={() => setShowSearch(false)}
            onJumpTo={jumpToMessage}
          />
        )}

        {pinError && (
          <div className="mx-3 mt-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
            {pinError}
          </div>
        )}

        {pinnedMessages.length > 0 && (
          <PinnedMessage
            messages={pinnedMessages}
            onJump={handleJumpToPinned}
            onUnpin={userId ? (msg) => void handleTogglePin(msg) : undefined}
          />
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubIcon name="spinner" size={28} className="text-[color:var(--kub-cyan)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubEmptyState
              icon={<KubIcon name="chatRect" size={24} />}
              title="Сообщений пока нет"
              description="Поздоровайтесь и начните разговор."
            />
          </div>
        ) : (
          <MessageList
            messages={messages}
            onReply={setReplyTo}
            onReaction={toggleReaction}
            onEdit={(msg) => setEditingMessage(msg)}
            onDelete={(msg) => deleteMessage(msg.id)}
            onTogglePin={userId ? handleTogglePin : undefined}
            onForward={(msg) => setForwardingMessage(msg)}
            onOpenMedia={setOpenMedia}
            bottomRef={bottomRef}
            isTyping={isTyping}
            highlightedId={highlightedId}
            messageRefs={messageRefs}
            chatMembers={chat?.members}
            myRole={myRole}
          />
        )}

        <MessageInput
          chatId={chatId}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={handleSend}
          onEdit={editMessage}
          onSendVoice={handleSendVoice}
          onTyping={sendTyping}
        />
      </div>
      {showInfo && chat && (
        <ChatInfoPanel chat={chat} onClose={() => setShowInfo(false)} onClearForMe={clearChatForMe} />
      )}
      {forwardingMessage && (
        <ForwardModal
          message={forwardingMessage}
          onClose={() => setForwardingMessage(null)}
          onForward={async (targetChatId) => {
            await forwardMessage(forwardingMessage, targetChatId);
            setForwardingMessage(null);
          }}
        />
      )}
      <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
    </div>
  );
}
