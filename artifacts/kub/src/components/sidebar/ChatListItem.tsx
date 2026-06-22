"use client";

import { useRef, type DragEvent } from "react";
import type { ChatWithLastMessage } from "@/types/database";
import { formatTime } from "@/lib/format";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon } from "@/components/kub";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";
import type { AvatarVariantUrls } from "@/hooks/useMediaVariants";
import { formatChatMessagePreview } from "@/lib/messagePreview";
import { getMessageDeliveryState } from "@/lib/messageDelivery";
import { isUserOnline } from "@/lib/presence";
import {
  getGroupReadReceiptAriaLabel,
  getGroupReadReceiptCompactLabel,
  getGroupReadReceiptInfo,
} from "@/lib/groupReadReceipts";

interface ChatListItemProps {
  chat: ChatWithLastMessage & {
    is_pinned?: boolean;
    is_muted?: boolean;
    is_verified?: boolean;
  };
  isSelected: boolean;
  onClick: () => void;
  onContextMenuOpen?: (position: { x: number; y: number }) => void;
  onLongPressOpen?: () => void;
  isReorderable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onPinnedDragStart?: () => void;
  onPinnedDragEnter?: () => void;
  onPinnedDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onPinnedDrop?: () => void;
  onPinnedDragEnd?: () => void;
  presenceNow?: number;
  avatarVariant?: AvatarVariantUrls;
}

export function ChatListItem({
  chat,
  isSelected,
  onClick,
  onContextMenuOpen,
  onLongPressOpen,
  isReorderable = false,
  isDragging = false,
  isDragOver = false,
  onPinnedDragStart,
  onPinnedDragEnter,
  onPinnedDragOver,
  onPinnedDrop,
  onPinnedDragEnd,
  presenceNow = Date.now(),
  avatarVariant,
}: ChatListItemProps) {
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const lastTouchAtRef = useRef(0);
  const lastMsg = chat.last_message;
  const display = getChatDisplayInfo(chat, currentUserId);
  const deliveryState = getMessageDeliveryState(lastMsg, {
    currentUserId,
    chatType: chat.type,
    members: chat.members,
    isSavedChat: display.isSaved,
  });
  const groupReadInfo = getGroupReadReceiptInfo(lastMsg, {
    currentUserId,
    chatType: chat.type,
    members: chat.members,
    isSavedChat: display.isSaved,
  });
  const showGroupReadIndicator = Boolean(groupReadInfo && groupReadInfo.readCount > 0);
  const hasUnread = (chat.unread_count ?? 0) > 0;
  const isMuted = chat.is_muted;
  const isPinned = chat.is_pinned;
  const isOtherOnline = chat.type === "private" && isUserOnline(chat.other_user, presenceNow);

  const clearLongPressTimer = () => {
    touchStartRef.current = null;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const getMessagePreview = () => {
    if (!lastMsg) return chat.cleared_at ? "История очищена" : "Сообщений пока нет";
    return formatChatMessagePreview(lastMsg);
  };

  return (
    <button
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          suppressClickRef.current = false;
          return;
        }
        onClick();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const isRecentTouch = Date.now() - lastTouchAtRef.current < 1_000;
        const isCoarsePointer = typeof window !== "undefined"
          && window.matchMedia?.("(pointer: coarse)").matches;
        if (isRecentTouch || isCoarsePointer) return;
        if (!onContextMenuOpen) return;
        if (suppressClickRef.current) return;
        onContextMenuOpen({ x: event.clientX, y: event.clientY });
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch" || !onLongPressOpen) return;
        lastTouchAtRef.current = Date.now();
        clearLongPressTimer();
        touchStartRef.current = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          suppressClickRef.current = true;
          onLongPressOpen();
        }, 520);
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== "touch" || !touchStartRef.current) return;
        const dx = Math.abs(event.clientX - touchStartRef.current.x);
        const dy = Math.abs(event.clientY - touchStartRef.current.y);
        if (dx > 8 || dy > 8) clearLongPressTimer();
      }}
      onPointerUp={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onDragEnter={(event) => {
        if (!isReorderable) return;
        event.preventDefault();
        onPinnedDragEnter?.();
      }}
      onDragOver={(event) => {
        if (!isReorderable) return;
        onPinnedDragOver?.(event);
      }}
      onDrop={(event) => {
        if (!isReorderable) return;
        event.preventDefault();
        onPinnedDrop?.();
      }}
      data-testid="chat-list-item"
      data-unread-count={chat.unread_count ?? 0}
      data-has-messages={lastMsg ? "true" : "false"}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 transition-colors relative group",
        "hover:bg-[var(--kub-surface-2)]",
        isSelected && "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] hover:bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]",
        isDragging && "opacity-55",
        isDragOver && "bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)] outline outline-1 outline-[color:var(--kub-cyan)]/45"
      )}
    >
      {/* Active accent rail */}
      {isSelected && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]" />
      )}

      {isReorderable && (
        <span
          draggable
          data-pinned-drag-handle="true"
          className="hidden h-8 w-4 shrink-0 cursor-grab items-center justify-center rounded-md text-[color:var(--kub-muted)] opacity-45 transition-opacity hover:bg-[var(--kub-surface-3)] hover:text-[color:var(--kub-cyan)] active:cursor-grabbing group-hover:opacity-100 sm:inline-flex"
          title="Перетащить закреплённый чат"
          aria-label="Перетащить закреплённый чат"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onDragStart={(event) => {
            suppressClickRef.current = true;
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", chat.id);
            onPinnedDragStart?.();
          }}
          onDragEnd={(event) => {
            event.stopPropagation();
            onPinnedDragEnd?.();
          }}
        >
          <KubIcon name="menu" size={13} />
        </span>
      )}

      <div className="flex-shrink-0 relative">
        <ChatAvatar chat={chat} size="md" isSaved={display.isSaved} avatarVariant={avatarVariant} />
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
            {showGroupReadIndicator && groupReadInfo ? (
              <span
                className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full text-[10px] leading-none text-[color:var(--kub-muted)]"
                title={getGroupReadReceiptAriaLabel(groupReadInfo)}
                aria-label={getGroupReadReceiptAriaLabel(groupReadInfo)}
              >
                <KubIcon
                  name={groupReadInfo.allRead ? "doubleCheck" : "check"}
                  size={12}
                  tone={groupReadInfo.allRead ? "accent" : "muted"}
                />
                <span className="tabular-nums">{getGroupReadReceiptCompactLabel(groupReadInfo)}</span>
              </span>
            ) : deliveryState?.isOwnMessage && (
              <KubIcon
                name={deliveryState.icon}
                size={13}
                label={deliveryState.label}
                tone={deliveryState.tone}
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
