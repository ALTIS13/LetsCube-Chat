"use client";

import type { ChatWithLastMessage } from "@/types/database";
import { formatTime } from "@/lib/format";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon } from "@/components/kub";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";
import { formatChatMessagePreview } from "@/lib/messagePreview";

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
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const lastMsg = chat.last_message;
  const display = getChatDisplayInfo(chat, currentUserId);
  const isOutgoing = !!currentUserId && lastMsg?.user_id === currentUserId;
  const hasUnread = (chat.unread_count ?? 0) > 0;
  const isMuted = chat.is_muted;
  const isPinned = chat.is_pinned;
  const isOtherOnline = chat.type === "private"
    && !!chat.other_user?.online_at
    && Date.now() - new Date(chat.other_user.online_at).getTime() < 90_000;

  const getMessagePreview = () => {
    if (!lastMsg) return chat.cleared_at ? "История очищена" : "Сообщений пока нет";
    return formatChatMessagePreview(lastMsg);
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 transition-colors relative group",
        "hover:bg-[var(--kub-surface-2)]",
        isSelected && "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] hover:bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]"
      )}
    >
      {/* Active accent rail */}
      {isSelected && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]" />
      )}

      <div className="flex-shrink-0 relative">
        <ChatAvatar chat={chat} size="md" isSaved={display.isSaved} />
        {isOtherOnline && (
          <span
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 bg-[var(--kub-online)] kub-pulse"
            style={{ borderColor: isSelected ? "color-mix(in srgb, var(--kub-cyan) 18%, var(--kub-surface))" : "var(--kub-surface)" }}
          />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {display.isSaved ? (
              <KubIcon name="bookmark" size={13} className="flex-shrink-0 text-[color:var(--kub-cyan)]" />
            ) : chat.type === "channel" ? (
              <KubIcon name="channel" size={13} className="flex-shrink-0 text-[color:var(--kub-muted)]" />
            ) : chat.type === "group" ? (
              <KubIcon name="group" size={13} className="flex-shrink-0 text-[color:var(--kub-muted)]" />
            ) : (
              <KubIcon name="user" size={13} className="flex-shrink-0 text-[color:var(--kub-muted)]" />
            )}
            <span className="text-sm font-semibold truncate text-[color:var(--kub-text)]">
              {display.title}
            </span>
            {chat.is_verified && (
              <KubIcon name="verified" size={13} className="flex-shrink-0 text-[color:var(--kub-cyan)]" />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isOutgoing && (
              <KubIcon
                name="doubleCheck"
                size={13}
                className={hasUnread ? "text-[color:var(--kub-cyan)]" : "text-[color:var(--kub-muted)]"}
              />
            )}
            {lastMsg && (
              <span
                className={cn(
                  "text-[11px]",
                  hasUnread ? "text-[color:var(--kub-cyan)] font-semibold" : "text-[color:var(--kub-muted)]"
                )}
              >
                {formatTime(lastMsg.created_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="block min-w-0 flex-1 truncate text-left text-xs leading-4 text-[color:var(--kub-muted)]">
            {display.isSaved && !lastMsg ? "Сохранённые сообщения" : getMessagePreview()}
          </span>

          <div className="flex shrink-0 items-center gap-1">
            {isPinned && !hasUnread && (
              <KubIcon name="pin" size={11} className="text-[color:var(--kub-muted)]" />
            )}
            {isMuted && (
              <span title="Уведомления отключены" aria-label="Уведомления отключены" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--kub-muted)]">
                <KubIcon name="notificationsOff" size={15} />
              </span>
            )}
            {hasUnread && (
              <span
                className={cn(
                  "min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1.5 text-white",
                  isMuted ? "bg-[color:var(--kub-muted)]" : "bg-[var(--kub-cyan)] kub-glow-soft"
                )}
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
