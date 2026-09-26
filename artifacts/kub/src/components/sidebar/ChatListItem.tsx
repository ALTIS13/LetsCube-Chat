"use client";

import { memo, useRef, type DragEvent } from "react";
import type { ChatWithLastMessage } from "@/types/database";
import { formatTime } from "@/lib/format";
import { BotTag } from "@/components/bots/BotTag";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon } from "@/components/kub";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";
import type { AvatarVariantUrls } from "@/hooks/useMediaVariants";
import { formatChatMessagePreview } from "@/lib/messagePreview";
import { getMessageDeliveryState } from "@/lib/messageDelivery";
import { isUserOnline } from "@/lib/presence";
import { useChatVoicePresence } from "@/hooks/useVoicePresence";
import { voicePresenceTitle } from "@/lib/voicePresence";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";
import {
  getGroupReadReceiptAriaLabel,
  getGroupReadReceiptCompactLabel,
  getGroupReadReceiptInfo,
} from "@/lib/groupReadReceipts";

/**
 * One row of the chat list, memoised.
 *
 * A row renders when its own chat changes and not when the list does. The list
 * renders on every message, receipt and read anywhere in it, so every value a
 * row is given has to compare equal while its chat has not changed: the chat
 * object itself (the store keeps unchanged chats as the same objects), booleans
 * rather than the whole mute list or a shared clock, and callbacks that take
 * the chat's id instead of an arrow made per row per render (D-088).
 */
interface ChatListItemProps {
  chat: ChatWithLastMessage & {
    is_pinned?: boolean;
    is_muted?: boolean;
    is_verified?: boolean;
  };
  isSelected: boolean;
  /** Notifications are off for this chat. Falls back to `chat.is_muted`. */
  isMuted?: boolean;
  /**
   * What the row's crossed-out bell means in words — «до 21:00», «навсегда»
   * (D-167). A glyph has no room for a sentence, so it carries one as its label
   * instead; the menus and the contact card print it. A plain string, so the
   * memo comparison below still holds while the chat is unchanged.
   */
  muteLabel?: string | null;
  /**
   * The other person in a private chat is online. The list works this out from
   * one clock for every row, so a tick of that clock renders only the rows whose
   * answer changed. Falls back to `presenceNow`.
   */
  isOtherOnline?: boolean;
  onClick: (chatId: string) => void;
  onContextMenuOpen?: (chatId: string, position: { x: number; y: number }) => void;
  onLongPressOpen?: (chatId: string) => void;
  isReorderable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onPinnedDragStart?: (chatId: string) => void;
  onPinnedDragEnter?: (chatId: string) => void;
  onPinnedDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onPinnedDrop?: (chatId: string) => void;
  onPinnedDragEnd?: () => void;
  presenceNow?: number;
  avatarVariant?: AvatarVariantUrls;
}

export const ChatListItem = memo(function ChatListItem({
  chat,
  isSelected,
  isMuted: isMutedProp,
  muteLabel,
  isOtherOnline: isOtherOnlineProp,
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
  presenceNow,
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
  // Subscribed per row rather than handed down: the whole map through a prop
  // or a context would render every row whenever anybody anywhere joins a
  // call, which is the measurement that turned `useVoiceSpeaking` into a
  // boolean per person. `useVoicePresence` holds each entry identical while
  // its own numbers have not moved, so this subscription is free for a row
  // whose call did not change.
  const voice = useChatVoicePresence(chat.id);
  const isMuted = isMutedProp ?? chat.is_muted;
  const muteTitle = muteLabel ? `Уведомления отключены ${muteLabel}` : "Уведомления отключены";
  const isPinned = chat.is_pinned;
  // The row is what a person drags, so the row is what has to say so. Named
  // per chat because every pinned row carries its own copy.
  const reorderHintId = isReorderable ? `pinned-reorder-${chat.id}` : undefined;
  const isOtherOnline = isOtherOnlineProp
    ?? (chat.type === "private" && isUserOnline(chat.other_user, presenceNow ?? Date.now()));

  const clearLongPressTimer = () => {
    touchStartRef.current = null;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const getMessagePreview = () => {
    if (!lastMsg) return chat.cleared_at ? "История очищена" : "Сообщений пока нет";
    // The reader, for the one preview that is not the same for both people in
    // a conversation: a call record says «Входящий» to one of them and
    // «Исходящий» to the other, from one row.
    const preview = formatChatMessagePreview(lastMsg, currentUserId);
    const actor = resolveMessageActor(lastMsg);
    return chat.type !== "private" && (actor.kind === "bot" || actor.kind === "deleted_bot")
      ? `${messageActorDisplayName(actor)}: ${preview}`
      : preview;
  };

  return (
    <button
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          suppressClickRef.current = false;
          return;
        }
        onClick(chat.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const isRecentTouch = Date.now() - lastTouchAtRef.current < 1_000;
        const isCoarsePointer = typeof window !== "undefined"
          && window.matchMedia?.("(pointer: coarse)").matches;
        if (isRecentTouch || isCoarsePointer) return;
        if (!onContextMenuOpen) return;
        if (suppressClickRef.current) return;
        onContextMenuOpen(chat.id, { x: event.clientX, y: event.clientY });
      }}
      onPointerDown={(event) => {
        // A fresh press is a fresh interaction, so whatever suppressed the last
        // click — a drag that began here, a long press — must not swallow this
        // one. The flag used to live until some later click consumed it, which
        // was invisible while only the 16px handle could start a drag; now the
        // row itself starts it, and the click it would have eaten is the one
        // that opens the chat.
        suppressClickRef.current = false;
        if (event.pointerType !== "touch" || !onLongPressOpen) return;
        lastTouchAtRef.current = Date.now();
        clearLongPressTimer();
        touchStartRef.current = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          suppressClickRef.current = true;
          onLongPressOpen(chat.id);
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
      // The whole row is the grip. It used to be a 16px handle standing before
      // the avatar, which shifted every pinned row against every other one and
      // kept its width while the narrowing column faded everything else — so in
      // the strip of avatars the pinned pictures sat off the axis the rest were
      // on. The drop side was always on the row; only these two were not.
      draggable={isReorderable}
      aria-describedby={reorderHintId}
      onDragStart={(event) => {
        if (!isReorderable) return;
        // A computer's affordance, exactly as the handle was: it was drawn only
        // from `sm` up. A coarse pointer reorders through the long-press
        // sheet's «Переместить выше»/«Переместить ниже» instead, and a drag
        // begun by a thumb would race that sheet's own timer. The same question
        // the context menu above asks, asked the same way.
        if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
          event.preventDefault();
          return;
        }
        suppressClickRef.current = true;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", chat.id);
        onPinnedDragStart?.(chat.id);
      }}
      onDragEnd={() => {
        if (!isReorderable) return;
        onPinnedDragEnd?.();
      }}
      onDragEnter={(event) => {
        if (!isReorderable) return;
        event.preventDefault();
        onPinnedDragEnter?.(chat.id);
      }}
      onDragOver={(event) => {
        if (!isReorderable) return;
        onPinnedDragOver?.(event);
      }}
      onDrop={(event) => {
        if (!isReorderable) return;
        event.preventDefault();
        onPinnedDrop?.(chat.id);
      }}
      data-testid="chat-list-item"
      data-chat-id={chat.id}
      data-unread-count={chat.unread_count ?? 0}
      data-has-messages={lastMsg ? "true" : "false"}
      className={cn(
        // The gap and the horizontal padding are `.kub-chat-list-row`, not
        // `gap-3 px-3`. A utility beats a class in `@layer components` (rule
        // 10), so the utilities silently won over the narrowing interpolation
        // and the row kept its full padding at every width of the drag. On a
        // phone, and on a computer at rest, the class computes the same 12px.
        "kub-chat-list-row w-full flex items-center py-2.5 transition-colors relative group",
        "kub-raise-hover",
        isSelected && "bg-[rgb(var(--kub-cyan-rgb)/0.14)] hover:bg-[rgb(var(--kub-cyan-rgb)/0.18)]",
        isDragging && "opacity-55",
        isDragOver && "bg-[rgb(var(--kub-cyan-rgb)/0.10)] outline outline-1 outline-[color:var(--kub-cyan)]/45"
      )}
    >
      {/* Active accent rail */}
      {isSelected && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--kub-cyan)]" />
      )}

      {/* What the three stripes used to say, said without taking any width.
          `aria-hidden` keeps it out of the row's own name — a button is named
          by its contents, and this is a description of the row, not part of
          what the row is called — while a node referenced straight by
          `aria-describedby` is still read out even when it is hidden. */}
      {isReorderable && (
        <span id={reorderHintId} aria-hidden="true" className="sr-only">
          Закреплённый чат: перетащите или измените порядок через контекстное меню
        </span>
      )}

      {/* The one thing the strip of avatars keeps. See `.kub-chat-list-column`
          in index.css: as the column narrows the row's gap and padding
          interpolate towards Telegram's 66px and everything beside this fades. */}
      <div className="flex-shrink-0 relative" data-chat-avatar="">
        <ChatAvatar
          chat={chat}
          size="md"
          isSaved={display.isSaved}
          avatarVariant={avatarVariant}
          profileId={chat.other_user?.id ?? null}
        />
        {/* 8px of colour with a 2px ring, which is the same picture the 12px
            box with `border-2` drew — the disc was 8px there too, once the
            border was taken off both sides. Said as a ring rather than as a
            border so presence is one size everywhere it appears, including the
            8px dot in the admin activity list. */}
        {isOtherOnline && (
          <span
            className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-[var(--kub-online)]"
            style={{ boxShadow: `0 0 0 2px ${isSelected ? "color-mix(in srgb, var(--kub-cyan) 18%, var(--kub-surface))" : "var(--kub-surface)"}` }}
          />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5" data-chat-row-body="">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {display.isSaved ? (
              <KubIcon name="bookmark" size={13} className="flex-shrink-0 text-[color:var(--kub-cyan)]" />
            ) : chat.type === "channel" ? (
              <KubIcon name="channel" size={13} className="flex-shrink-0 text-[color:var(--kub-muted)]" />
            ) : chat.type === "group" ? (
              <KubIcon name="group" size={13} className="flex-shrink-0 text-[color:var(--kub-muted)]" />
            ) : display.isBot ? (
              // The type glyph was «user» here, which is not a missing mark but
              // a wrong one: this row is not a person. The word beside the name
              // is what actually reads at a glance (D-236); the glyph is the
              // same correction the rest of the strip already makes.
              <KubIcon name="bot" size={13} className="flex-shrink-0 text-[color:var(--kub-muted)]" />
            ) : (
              <KubIcon name="user" size={13} className="flex-shrink-0 text-[color:var(--kub-muted)]" />
            )}
            <span className="text-base sm:text-sm ios:text-base font-semibold truncate text-[color:var(--kub-text)]">
              {display.title}
            </span>
            {display.isBot && <BotTag />}
            {chat.is_verified && (
              <KubIcon name="verified" size={13} className="flex-shrink-0 text-[color:var(--kub-cyan)]" />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {showGroupReadIndicator && groupReadInfo ? (
              <span
                className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full text-[12px] leading-none text-[color:var(--kub-muted)]"
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
                  "text-[12px]",
                  hasUnread ? "text-[color:var(--kub-accent-text)] font-semibold" : "text-[color:var(--kub-muted)]"
                )}
              >
                {formatTime(lastMsg.created_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="block min-w-0 flex-1 truncate text-left text-sm leading-5 sm:text-xs sm:leading-4 ios:text-sm ios:leading-5 text-[color:var(--kub-muted)]">
            {display.isSaved && !lastMsg ? "Сохранённые сообщения" : getMessagePreview()}
          </span>

          <div className="flex shrink-0 items-center gap-1">
            {/* A call in progress, leftmost of this cluster because it is the
                only one of the four about something happening right now — the
                pin, the mute and the counter are all states of the row.

                `--kub-online-text` rather than `--kub-online`: the tone exists
                in both forms precisely because the dot's value does not clear
                4.5:1 as text, and this is a glyph beside a number.

                Inside `data-chat-row-body`, which fades to nothing as the
                column is dragged down to a strip of avatars. That is the same
                rule the unread counter follows, and following it is the point:
                at 66 points the row IS the avatar, and making one exception
                would be a second answer to a question the column has already
                settled. */}
            {voice && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold leading-none text-[color:var(--kub-online-text)]"
                data-testid="chat-list-voice"
                data-voice-count={voice.count}
                data-voice-rooms={voice.rooms}
                title={voicePresenceTitle(voice)}
                aria-label={voicePresenceTitle(voice)}
              >
                <KubIcon name="headset" size={12} tone="currentColor" />
                <span className="tabular-nums">{voice.count}</span>
              </span>
            )}
            {isPinned && !hasUnread && (
              <KubIcon name="pin" size={11} className="text-[color:var(--kub-muted)]" />
            )}
            {isMuted && (
              <span title={muteTitle} aria-label={muteTitle} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--kub-muted)]">
                <KubIcon name="notificationsOff" size={15} />
              </span>
            )}
            {hasUnread && (
              <span
                className={cn(
                  // The counter's foreground is the page colour, not white. The
                  // folder tab and the notification bell already draw the same
                  // badge on the same fill that way; this one kept `text-white`
                  // and measured 3.55:1 against `--kub-cyan` in the dark theme.
                  // `--kub-bg` gives 5.55:1 there and 4.56:1 in the light theme,
                  // and it is the pair the accent's own action token declares.
                  "min-w-[18px] h-[18px] rounded-full text-[12px] font-bold flex items-center justify-center px-1.5 text-[color:var(--kub-bg)]",
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
});
