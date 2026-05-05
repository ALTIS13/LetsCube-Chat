"use client";

import { CheckCheck, Volume2, VolumeX, Pin, BadgeCheck } from "lucide-react";
import type { ChatWithLastMessage } from "@/types/database";
import { formatTime } from "@/lib/format";
import { ChatAvatar } from "@/components/ui/ChatAvatar";

interface ChatListItemProps {
  chat: ChatWithLastMessage & {
    is_pinned?: boolean;
    is_muted?: boolean;
    is_verified?: boolean;
  };
  isSelected: boolean;
  onClick: () => void;
}

export function ChatListItem({ chat, isSelected, onClick }: ChatListItemProps) {
  const lastMsg = chat.last_message;
  const isOutgoing = lastMsg?.user_id === "me";
  const hasUnread = (chat.unread_count ?? 0) > 0;
  const isMuted = chat.is_muted;
  const isPinned = chat.is_pinned;
  // Show the green dot only for private chats where the other user pinged
  // the heartbeat within the last 90 seconds (tolerates ~3 missed ticks).
  const isOtherOnline = chat.type === "private"
    && !!chat.other_user?.online_at
    && Date.now() - new Date(chat.other_user.online_at).getTime() < 90_000;

  const getMessagePreview = () => {
    if (!lastMsg) return "Сообщений пока нет";
    if (lastMsg.type === "image") return "🖼 Фото";
    if (lastMsg.type === "audio") return "🎤 Голосовое сообщение";
    if (lastMsg.type === "video") return "🎬 Видео";
    if (lastMsg.type === "file") return "📎 Файл";
    return lastMsg.content ?? "";
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 transition-colors relative group"
      style={{
        background: isSelected ? "var(--tg-active)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--tg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 relative">
        <ChatAvatar chat={chat} size="md" />
        {/* Real online indicator: derived from other_user.online_at */}
        {isOtherOnline && (
          <span
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
            style={{ background: "var(--tg-online)", borderColor: isSelected ? "var(--tg-active)" : "var(--tg-sidebar)" }}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Row 1: name + time */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 min-w-0">
            {chat.type === "channel" && (
              <Volume2 size={13} className="flex-shrink-0" style={{ color: "var(--tg-text-secondary)" }} />
            )}
            <span className="text-sm font-medium truncate" style={{ color: "var(--tg-text)" }}>
              {chat.name}
            </span>
            {chat.is_verified && (
              <BadgeCheck size={13} className="flex-shrink-0" style={{ color: "var(--tg-accent)" }} />
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isOutgoing && (
              <CheckCheck size={13} style={{ color: hasUnread ? "var(--tg-accent)" : "var(--tg-text-secondary)" }} />
            )}
            {lastMsg && (
              <span
                className="text-xs"
                style={{ color: hasUnread ? "var(--tg-accent)" : "var(--tg-text-secondary)" }}
              >
                {formatTime(lastMsg.created_at)}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: last message + badges */}
        <div className="flex items-center justify-between gap-1">
          <span
            className="text-xs truncate flex-1"
            style={{ color: "var(--tg-text-secondary)" }}
          >
            {getMessagePreview()}
          </span>

          {/* Right badges */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {isPinned && !hasUnread && (
              <Pin size={11} style={{ color: "var(--tg-text-secondary)" }} />
            )}
            {isMuted && !hasUnread && (
              <VolumeX size={11} style={{ color: "var(--tg-text-secondary)" }} />
            )}
            {hasUnread && (
              <span
                className="min-w-[18px] h-[18px] rounded-full text-[10px] font-semibold flex items-center justify-center px-1"
                style={{
                  background: isMuted ? "var(--tg-muted)" : "var(--tg-unread)",
                  color: "#fff",
                }}
              >
                {(chat.unread_count ?? 0) > 99 ? "99+" : chat.unread_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
