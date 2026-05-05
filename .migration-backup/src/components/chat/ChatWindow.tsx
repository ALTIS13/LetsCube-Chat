"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ChatHeader } from "./ChatHeader";
import { PinnedMessage } from "./PinnedMessage";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { ForwardModal } from "./ForwardModal";
import { TopicStrip } from "./TopicStrip";
import { useTopics } from "@/hooks/useTopics";
import { useMessages } from "@/hooks/useMessages";
import { useAppStore } from "@/store/app.store";
import { createClient } from "@/lib/supabase/client";
import type { MessageWithSender } from "@/types/database";
import { Loader2 } from "lucide-react";

interface ChatWindowProps {
  chatId: string;
}

export function ChatWindow({ chatId }: ChatWindowProps) {
  const {
    chats, currentUser, markChatRead,
    setEditingMessage, setForwardingMessage, forwardingMessage,
    selectedTopicId,
  } = useAppStore();
  const chat = chats.find((c) => c.id === chatId);
  const isForum = !!chat?.is_forum;
  const { topics, createTopic } = useTopics(chatId, isForum);
  // For forum chats, useMessages is keyed by both chat and active topic.
  const {
    messages, loading, isTyping,
    sendMessage, sendTyping, toggleReaction,
    editMessage, deleteMessage, togglePin, forwardMessage,
  } = useMessages(chatId, isForum ? selectedTopicId : null);

  // Zero out unread badge when chat is opened
  useEffect(() => {
    markChatRead(chatId);
  }, [chatId, markChatRead]);
  const [replyTo, setReplyTo] = useState<MessageWithSender | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const supabase = createClient();

  const pinnedMessage = messages.find((m) => m.pinned);
  // Current user's role in this chat — drives admin-only message actions.
  const myRole = (chat?.members?.find((m) => m.user_id === currentUser?.id)?.role ?? null) as
    | "owner" | "admin" | "member" | null;
  const canManageTopics = myRole === "owner" || myRole === "admin";

  const handleSend = async (content: string) => {
    await sendMessage(content, replyTo?.id);
    setReplyTo(null);
  };

  const handleSendVoice = useCallback(async (blob: Blob, duration: number) => {
    if (!currentUser) return;
    // Upload to Supabase Storage
    const filename = `voice_${Date.now()}.webm`;
    const { data, error } = await supabase.storage
      .from("media")
      .upload(`${currentUser.id}/${filename}`, blob, { contentType: "audio/webm" });

    if (error) { console.error("Voice upload error:", error); return; }

    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);

    // Insert message with type=audio
    await supabase.from("messages").insert({
      chat_id: chatId,
      user_id: currentUser.id,
      type: "audio",
      media_url: publicUrl,
      content: `🎤 Голосовое сообщение (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")})`,
    });

    await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
  }, [chatId, currentUser, supabase]);

  const jumpToMessage = useCallback((messageId: string) => {
    setHighlightedId(messageId);
    const el = messageRefs.current[messageId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedId(null), 2000);
    }
  }, []);

  return (
    <div className="flex h-full w-full" style={{ background: "var(--tg-chat-bg)" }}>
      <div className="flex flex-col flex-1 min-w-0">
      <ChatHeader
        chatId={chatId}
        chat={chat}
        onSearchOpen={() => setShowSearch(true)}
        onInfoOpen={() => setShowInfo(true)}
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

      {pinnedMessage && <PinnedMessage message={pinnedMessage} />}

      {loading ? (
        <div className="flex-1 flex items-center justify-center chat-bg">
          <Loader2 size={28} className="animate-spin" style={{ color: "var(--tg-text-secondary)" }} />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center chat-bg">
          <div className="text-center px-6">
            <div className="text-4xl mb-3">👋</div>
            <p className="text-sm" style={{ color: "var(--tg-text-secondary)" }}>
              Сообщений пока нет. Поздоровайтесь!
            </p>
          </div>
        </div>
      ) : (
        <MessageList
          messages={messages}
          onReply={setReplyTo}
          onReaction={toggleReaction}
          onEdit={(msg) => setEditingMessage(msg)}
          onDelete={(msg) => deleteMessage(msg.id)}
          onTogglePin={(msg) => togglePin(msg.id, msg.pinned)}
          onForward={(msg) => setForwardingMessage(msg)}
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
        <ChatInfoPanel chat={chat} onClose={() => setShowInfo(false)} />
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
    </div>
  );
}
