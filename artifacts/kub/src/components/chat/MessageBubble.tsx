"use client";

import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react";
import type { MessageWithSender } from "@/types/database";
import { formatFullTime } from "@/lib/format";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { AudioMessage } from "./AudioMessage";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import { FormattedText } from "@/lib/formatText";
import { KubIcon, type KubIconName } from "@/components/kub";
import type { MediaViewerItem } from "./MediaViewer";
import { requestAppConfirm } from "@/lib/appDialogs";
import type { MessageDeliveryState } from "@/lib/messageDelivery";

const EMOJI_QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉"];

interface ContextItem {
  icon: KubIconName;
  label: string;
  danger?: boolean;
  action: () => void;
}

type TextLayoutKind = "short" | "regular" | "link" | "longToken" | "preformatted" | "media";

interface MessageBubbleProps {
  message: MessageWithSender;
  isMe: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  onReply: () => void;
  onReaction: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onHideForMe?: () => void;
  onStartSelection?: () => void;
  onTogglePin?: () => void;
  onForward?: () => void;
  onOpenMedia?: (media: MediaViewerItem) => void;
  reactionMenuOpen?: boolean;
  onToggleReactionMenu?: () => void;
  onCloseReactionMenu?: () => void;
  actionMenuOpen?: boolean;
  onOpenActionMenu?: () => void;
  onCloseActionMenu?: () => void;
  selected?: boolean;
  isSelectionMode?: boolean;
  usersMap?: Record<string, string>;
  messagesMap?: Record<string, MessageWithSender>;
  deliveryState?: MessageDeliveryState | null;
  myRole?: "owner" | "admin" | "member" | null;
  isSavedChat?: boolean;
}

function getMessageTextLayoutKind(type: MessageWithSender["type"], content: string): TextLayoutKind {
  if (type !== "text") return "media";
  const text = content.trim();
  if (!text) return "short";

  const hasUrl = /\bhttps?:\/\/\S+/.test(text);
  const hasCodeFence = /```[\s\S]*```/.test(content);
  const lines = text.split(/\r?\n/);
  const longestToken = text
    .split(/\s+/)
    .reduce((max, token) => Math.max(max, token.length), 0);
  const meaningfulLines = lines.filter((line) => line.trim().length > 0);
  const indentedLines = meaningfulLines.filter((line) => /^( {2,}|\t)/.test(line)).length;
  const spacedLines = meaningfulLines.filter((line) => / {3,}|\t/.test(line)).length;
  const asciiArtLines = meaningfulLines.filter((line) => {
    const compact = line.replace(/\s/g, "");
    if (compact.length < 8) return false;
    const asciiArtChars = compact.match(/[+\-|=_*`~./\\()[\]{}<>#@░▒▓█─│┌┐└┘]/g)?.length ?? 0;
    return asciiArtChars / compact.length >= 0.45;
  }).length;
  const preformattedLike =
    hasCodeFence ||
    (meaningfulLines.length >= 3 && (indentedLines >= 2 || spacedLines >= 2 || asciiArtLines >= 2));

  if (preformattedLike && !hasUrl) return "preformatted";
  if (hasUrl) return "link";
  if (longestToken >= 34) return "longToken";
  if (text.length >= 8 && /\s/.test(text)) return "regular";
  return "short";
}

function getMessageWidthClasses(kind: TextLayoutKind): { stack: string; bubble: string; text: string } {
  switch (kind) {
    case "link":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(64vw,620px)] md:max-w-[min(52vw,620px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:break-word]",
      };
    case "preformatted":
      return {
        stack: "w-[min(86vw,54rem)] max-w-[86vw] sm:w-[min(74vw,54rem)] md:w-[min(70vw,54rem)]",
        bubble: "w-full",
        text: "overflow-x-auto font-mono text-[13px] leading-snug [overflow-wrap:anywhere] [tab-size:2]",
      };
    case "longToken":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(60vw,640px)] md:max-w-[min(52vw,640px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:anywhere]",
      };
    case "regular":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(72vw,680px)] md:max-w-[min(65vw,680px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:break-word]",
      };
    case "short":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(72vw,680px)] md:max-w-[min(65vw,680px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:break-word]",
      };
    case "media":
    default:
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(72vw,680px)] md:max-w-[min(65vw,680px)]",
        bubble: "w-fit",
        text: "[overflow-wrap:break-word]",
      };
  }
}

export function MessageBubble({
  message, isMe, isFirstInGroup, isLastInGroup,
  onReply, onReaction, onEdit, onDelete, onHideForMe, onStartSelection, onTogglePin, onForward, onOpenMedia,
  reactionMenuOpen = false, onToggleReactionMenu, onCloseReactionMenu,
  actionMenuOpen, onOpenActionMenu, onCloseActionMenu, selected = false, isSelectionMode = false,
  usersMap = {}, messagesMap = {}, deliveryState, isSavedChat,
}: MessageBubbleProps) {
  const [showContext, setShowContext] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [reactionPos, setReactionPos] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const { currentUser } = useAppStore();
  const textContent = message.content ?? "";
  const textLayoutKind = getMessageTextLayoutKind(message.type, textContent);
  const widthClasses = getMessageWidthClasses(textLayoutKind);
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const compactContextMenu = viewportWidth < 640;
  const contextMenuWidth = 256;
  const contextMenuMaxHeight = Math.max(180, Math.min(480, viewportHeight - 16));
  const contextMenuOpensUp = !compactContextMenu && contextPos.y > viewportHeight / 2;
  const contextMenuStyle: CSSProperties = compactContextMenu
    ? { left: 12, right: 12, bottom: 12, maxHeight: "min(65vh, 480px)" }
    : {
        left: Math.min(Math.max(8, contextPos.x), Math.max(8, viewportWidth - contextMenuWidth - 8)),
        width: contextMenuWidth,
        maxHeight: contextMenuMaxHeight,
        ...(contextMenuOpensUp
          ? { bottom: Math.max(8, viewportHeight - contextPos.y + 8) }
          : { top: Math.min(contextPos.y + 8, Math.max(8, viewportHeight - contextMenuMaxHeight - 8)) }),
      };
  const reactionPickerWidth = 284;
  const reactionPickerStyle: CSSProperties = {
    left: Math.min(Math.max(8, reactionPos.x - reactionPickerWidth / 2), Math.max(8, viewportWidth - reactionPickerWidth - 8)),
    width: Math.min(reactionPickerWidth, viewportWidth - 16),
    ...(reactionPos.y > 64
      ? { top: Math.max(8, reactionPos.y - 52) }
      : { top: Math.min(viewportHeight - 52, reactionPos.y + 36) }),
  };
  const contextOpen = actionMenuOpen ?? showContext;
  const closeContext = useCallback(() => {
    setShowContext(false);
    onCloseActionMenu?.();
  }, [onCloseActionMenu]);

  // Belt-and-suspenders cleanup: if the bubble unmounts mid-touch (e.g. user
  // navigates away during a long-press), clear the pending timer so it
  // doesn't try to setShowContext on a torn-down component.
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    setBodySelectionSuppressed(false);
  }, []);

  useEffect(() => {
    if (!contextOpen) setBodySelectionSuppressed(false);
  }, [contextOpen]);

  useEffect(() => {
    if (!reactionMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseReactionMenu?.();
    };
    const handleOutsidePointer = (event: PointerEvent | MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-reaction-menu], [data-reaction-trigger]")) return;
      onCloseReactionMenu?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handleOutsidePointer, true);
    window.addEventListener("contextmenu", handleOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handleOutsidePointer, true);
      window.removeEventListener("contextmenu", handleOutsidePointer, true);
    };
  }, [onCloseReactionMenu, reactionMenuOpen]);

  const reactionGroups = (message.reactions ?? []).reduce<Record<string, { count: number; mine: boolean }>>(
    (acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false };
      acc[r.emoji].count++;
      if (r.user_id === currentUser?.id) acc[r.emoji].mine = true;
      return acc;
    }, {}
  );
  const reactionEntries = Object.entries(reactionGroups);
  const compactReactionText =
    message.type === "text" &&
    (textLayoutKind === "short" || (textLayoutKind === "regular" && textContent.trim().length <= 80));
  const visibleReactionLimit = compactReactionText ? (textLayoutKind === "short" ? 2 : 3) : 6;
  const visibleReactionEntries = reactionEntries.slice(0, visibleReactionLimit);
  const hiddenReactionCount = reactionEntries
    .slice(visibleReactionLimit)
    .reduce((total, [, { count }]) => total + count, 0);
  const hasReactions = reactionEntries.length > 0;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const openContextAt = useCallback((clientX: number, clientY: number) => {
    setContextPos({ x: clientX, y: clientY });
    setShowContext(true);
    onOpenActionMenu?.();
    onCloseReactionMenu?.();
  }, [onCloseReactionMenu, onOpenActionMenu]);

  const handleToggleReactionMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setReactionPos({ x: rect.left + rect.width / 2, y: rect.top });
    closeContext();
    onToggleReactionMenu?.();
  }, [closeContext, onToggleReactionMenu]);

  const openContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isSelectionMode) return;
    openContextAt(e.clientX, e.clientY);
  }, [isSelectionMode, openContextAt]);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    if (isSelectionMode) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button,a,input,textarea,select,video,audio,[role='slider']")) return;
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    clearLongPressTimer();
    setBodySelectionSuppressed(true);
    longPressTimer.current = setTimeout(() => {
      openContextAt(touch.clientX, touch.clientY);
      longPressTimer.current = null;
    }, 650);
  }, [clearLongPressTimer, isSelectionMode, openContextAt]);
  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    const start = touchStartRef.current;
    if (!touch || !start) return;
    const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
    if (moved > 10) {
      clearLongPressTimer();
      setBodySelectionSuppressed(false);
    }
  }, [clearLongPressTimer]);
  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
    touchStartRef.current = null;
    if (!contextOpen) setBodySelectionSuppressed(false);
  }, [clearLongPressTimer, contextOpen]);

  const contextItems: ContextItem[] = [
    { icon: "reply", label: "Ответить", action: () => { onReply(); closeContext(); } },
    { icon: "copy",  label: "Копировать", action: () => { navigator.clipboard.writeText(message.content ?? ""); closeContext(); } },
    ...(isMe && message.type === "text" && onEdit ? [
      { icon: "edit" as KubIconName, label: "Изменить", action: () => { onEdit(); closeContext(); } },
    ] : []),
    ...(onTogglePin ? [{
      icon: (message.pinned ? "pinOff" : "pin") as KubIconName,
      label: message.pinned ? "Открепить" : "Закрепить",
      action: () => { onTogglePin(); closeContext(); },
    }] : []),
    ...(onForward ? [
      { icon: "forward" as KubIconName, label: "Переслать", action: () => { onForward(); closeContext(); } },
    ] : []),
    ...(onStartSelection ? [
      { icon: "check" as KubIconName, label: "Выбрать сообщения", action: () => {
        setBodySelectionSuppressed(false);
        onCloseReactionMenu?.();
        onStartSelection();
        closeContext();
      } },
    ] : []),
    ...(onHideForMe ? [
      { icon: "delete" as KubIconName, label: "Удалить у себя", danger: true, action: () => {
          void requestAppConfirm({
            title: "Удалить сообщение у себя?",
            description: "Сообщение исчезнет только у вас. У других участников оно останется.",
            confirmLabel: "Удалить у себя",
            tone: "danger",
            icon: "delete",
          }).then((confirmed) => {
            if (confirmed) onHideForMe();
          });
          closeContext();
        } },
    ] : []),
    ...(isMe && onDelete && !isSavedChat ? [
      { icon: "delete" as KubIconName, label: "Удалить для всех", danger: true, action: () => {
          void requestAppConfirm({
            title: "Удалить сообщение для всех?",
            description: "Это действие нельзя отменить. Сообщение будет заменено компактной плашкой удаления.",
            confirmLabel: "Удалить для всех",
            tone: "danger",
            icon: "delete",
          }).then((confirmed) => {
            if (confirmed) onDelete();
          });
          closeContext();
        } },
    ] : []),
  ];
  const textLikeNoReactionFooter =
    message.type === "text" &&
    !hasReactions &&
    textLayoutKind !== "preformatted";
  const compactInlineTextFooter =
    textLikeNoReactionFooter &&
    textLayoutKind !== "link" &&
    textLayoutKind !== "longToken" &&
    !textContent.includes("\n") &&
    textContent.trim().length <= 80;
  const anchoredTextFooter = textLikeNoReactionFooter && !compactInlineTextFooter;
  const anchoredFooterSpacerClass = cn(
    deliveryState?.isOwnMessage ? "w-[4.75rem] sm:w-[3.25rem]" : "w-14 sm:w-8",
    (message.edited_at || message.pinned) && (deliveryState?.isOwnMessage ? "w-24 sm:w-20" : "w-20 sm:w-14"),
  );
  const renderFooterContent = () => (
    <>
      {message.pinned && (
        <KubIcon name="pin" size={12} tone="muted" label="Закреплено" className="shrink-0" />
      )}
      {message.edited_at && (
        <span className="max-w-8 shrink truncate text-[10px] text-[color:var(--kub-muted)]" title="изменено">изм.</span>
      )}
      <span className="shrink-0 text-[10px] leading-none text-[color:var(--kub-muted)]">
        {formatFullTime(message.created_at)}
      </span>
      {deliveryState?.isOwnMessage && (
        <KubIcon
          name={deliveryState.icon}
          size={13}
          tone={deliveryState.tone}
          label={deliveryState.label}
        />
      )}
      <button
        type="button"
        className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)] sm:hidden"
        aria-label="Действия сообщения"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openContextAt(rect.left, rect.bottom + 4);
        }}
      >
        <KubIcon name="more" size={13} />
      </button>
    </>
  );

  const bubbleClass = isMe
    ? "bg-[color-mix(in_srgb,var(--kub-cyan)_22%,var(--kub-surface))] border border-[color:var(--kub-cyan)]/40 text-[color:var(--kub-text)]"
    : "bg-[var(--kub-message-in)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)]";

  // Soft-delete: render an inert placeholder bubble in the same slot so the
  // surrounding date separators / scroll position stay stable.  No reply
  // tail, no context menu, no reactions — it's a stub, not a message.
  // Placed AFTER all hooks to keep the Rules of Hooks happy.
  if (message.deleted_at) {
    return (
      <div className={cn("flex gap-1.5 mb-0.5", isMe ? "justify-end" : "justify-start")}>
        {!isMe && <div className="flex-shrink-0 self-end mb-1 w-8" />}
        <div className={cn("flex max-w-[78%] sm:max-w-[72%] md:max-w-[65%]", isMe ? "items-end" : "items-start")}>
          <div
            data-message-bubble="true"
            className={cn(
              "flex items-center gap-1.5 rounded-2xl px-2.5 py-1.5 text-xs italic leading-none select-none",
              "bg-[var(--kub-surface-2)]/80 border border-dashed border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]",
              isMe ? "rounded-br-sm" : "rounded-bl-sm",
            )}
          >
            <KubIcon name="delete" size={12} tone="muted" className="shrink-0" />
            <span>Сообщение удалено</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {contextOpen && (
        <div className="fixed inset-0 z-50" onClick={closeContext}>
          <div
            data-action-menu="true"
            className="absolute z-50 min-w-60 overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] py-1 shadow-2xl kub-glow-soft"
            style={contextMenuStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between gap-1 border-b border-[color:var(--kub-border-color)] px-3 pb-2 pt-1">
                {EMOJI_QUICK.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { onReaction(emoji); closeContext(); }}
                    className={cn(
                      "flex min-w-0 flex-1 items-center justify-center rounded-full transition-all hover:bg-[var(--kub-surface-3)] active:scale-95",
                      compactContextMenu ? "h-9 text-xl" : "h-8 text-lg",
                    )}
                    aria-label={`Поставить реакцию ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            {contextItems.map(({ icon, label, danger, action }) => (
              <button
                key={label}
                onClick={action}
                className={cn(
                  "flex w-full items-center gap-3 whitespace-nowrap px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--kub-surface-3)]",
                  danger ? "text-[color:var(--kub-danger)]" : "text-[color:var(--kub-text)]"
                )}
              >
                <KubIcon name={icon} size={16} tone={danger ? "danger" : "muted"} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {reactionMenuOpen && !compactContextMenu && (
        <div
          data-reaction-menu="true"
          className="fixed z-[55] flex max-w-[calc(100vw-16px)] items-center justify-center gap-0.5 rounded-full border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 py-1.5 shadow-2xl kub-glow-soft"
          style={reactionPickerStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {EMOJI_QUICK.slice(0, 6).map((emoji) => (
            <button
              key={emoji}
              onClick={() => { onReaction(emoji); onCloseReactionMenu?.(); }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-all hover:scale-125 hover:bg-[var(--kub-surface-3)]"
              aria-label={`Поставить реакцию ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "flex gap-1.5 mb-0.5 group relative msg-appear",
          "max-w-full min-w-0",
          isMe ? "justify-end" : "justify-start",
        )}
        onContextMenu={openContext}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {!isMe && (
          <div className="flex-shrink-0 self-end mb-1 w-8">
            {isLastInGroup && message.sender && (
              <UserAvatar user={message.sender} size="sm" />
            )}
          </div>
        )}

        <div className={cn("inline-flex min-w-0 max-w-full flex-col", widthClasses.stack, isMe ? "items-end" : "items-start")}>

          {!isMe && isFirstInGroup && message.sender && (
            <span className="text-xs font-semibold ml-3 mb-0.5 text-[color:var(--kub-cyan)]">
              {message.sender.full_name}
            </span>
          )}

          {message.reply_to_id && (() => {
            const replyMsg = messagesMap[message.reply_to_id] ?? message.reply_to;
            if (!replyMsg) return null;
            const replyUserId = replyMsg.user_id;
            const replyName = replyUserId === currentUser?.id
              ? "Вы"
              : (replyUserId ? usersMap[replyUserId] : null) ?? replyMsg.sender?.full_name ?? "Без имени";
            return (
              <div
                className={cn(
                  "flex items-stretch gap-2 px-3 py-1.5 mb-px text-xs max-w-full rounded-t-2xl",
                  isMe ? "rounded-br-sm self-end" : "rounded-bl-sm self-start",
                  bubbleClass, "opacity-90"
                )}
              >
                <div className="w-0.5 rounded-full flex-shrink-0 self-stretch bg-[var(--kub-cyan)]" />
                <div className="min-w-0">
                  <div className="font-semibold truncate text-[color:var(--kub-cyan)]">
                    {replyName}
                  </div>
                  <div className="truncate opacity-70 text-[color:var(--kub-text)]">
                    {replyMsg.content}
                  </div>
                </div>
              </div>
            );
          })()}

          <div
            data-message-bubble="true"
            data-message-layout-kind={textLayoutKind}
            data-message-footer-mode={
              compactInlineTextFooter ? "compact-inline" : anchoredTextFooter ? "anchored" : hasReactions ? "reactions" : "bottom-meta"
            }
            className={cn(
              "relative flex flex-col max-w-full px-3 pt-2 rounded-2xl transition-opacity select-none sm:select-text",
              hasReactions ? "pb-2" : compactInlineTextFooter ? "pb-0.5 pr-2.5" : "pb-1.5",
              widthClasses.bubble,
              bubbleClass,
              isMe
                ? cn("rounded-br-sm", message.reply_to_id && "rounded-tr-none")
                : cn("rounded-bl-sm", message.reply_to_id && "rounded-tl-none"),
              isMe && isLastInGroup ? "bubble-out" : "",
              !isMe && isLastInGroup ? "bubble-in" : "",
              message.pending && "opacity-70",
              message.failed && "opacity-60",
              selected && "ring-2 ring-[color:var(--kub-cyan)]/55 bg-[color-mix(in_srgb,var(--kub-cyan)_10%,var(--kub-message-in))]",
              isSelectionMode && "cursor-pointer [&_a]:pointer-events-none [&_audio]:pointer-events-none [&_button]:pointer-events-none [&_input]:pointer-events-none [&_video]:pointer-events-none",
            )}
            style={hasReactions && textLayoutKind === "short" ? { minWidth: "9rem" } : undefined}
          >
            <div
              className={cn(
                "absolute top-1 hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex z-10",
                isMe ? "-left-20" : "-right-20"
              )}
            >
              <button
                onClick={handleToggleReactionMenu}
                data-reaction-trigger="true"
                aria-label="Реакция"
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]"
              >
                <KubIcon name="smile" size={14} />
              </button>
              <button
                onClick={onReply}
                aria-label="Ответить"
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]"
              >
                <KubIcon name="reply" size={14} />
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openContextAt(rect.left, rect.bottom + 4);
                }}
                aria-label="Действия сообщения"
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]"
              >
                <KubIcon name="more" size={14} />
              </button>
            </div>

            {isVoiceMessage(message) ? (
              <AudioMessage url={message.media_url} duration={parseAudioDuration(message.content)} isMe={isMe} />
            ) : message.type === "image" && message.media_url ? (
              <MediaImage
                url={message.media_url}
                title={message.content ?? "Фото"}
                onOpen={() => onOpenMedia?.({ type: "image", url: message.media_url!, title: message.content ?? "Фото" })}
              />
            ) : message.type === "video" && message.media_url ? (
              <MediaVideo
                url={message.media_url}
                title={message.content ?? "Видео"}
                onOpen={() => onOpenMedia?.({ type: "video", url: message.media_url!, title: message.content ?? "Видео" })}
              />
            ) : message.type === "file" && message.media_url ? (
              <a
                href={message.media_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity text-[color:var(--kub-cyan)]"
              >
                <KubIcon name="file" size={16} />
                <span className="truncate max-w-[200px]">{message.content ?? "File"}</span>
              </a>
            ) : (
              <p
                data-message-text-flow="true"
                className={cn("min-w-0 max-w-full text-sm leading-relaxed whitespace-pre-wrap break-words [word-break:normal] text-[color:var(--kub-text)]", widthClasses.text)}
              >
                <FormattedText content={message.content ?? ""} />
                {compactInlineTextFooter && (
                  <span
                    data-message-footer="true"
                    className="ml-1.5 inline-flex max-w-max shrink-0 items-center justify-end gap-1 whitespace-nowrap align-text-bottom leading-none"
                  >
                    {renderFooterContent()}
                  </span>
                )}
                {anchoredTextFooter && (
                  <span
                    data-message-footer-spacer="true"
                    className={cn("inline-block h-[1em] align-baseline", anchoredFooterSpacerClass)}
                    aria-hidden="true"
                  />
                )}
              </p>
            )}

            {anchoredTextFooter && (
              <span
                data-message-footer="true"
                className="absolute bottom-1.5 right-2.5 inline-flex max-w-max shrink-0 items-center justify-end gap-1 whitespace-nowrap leading-none"
              >
                {renderFooterContent()}
              </span>
            )}

            {!textLikeNoReactionFooter && (
              <div
                data-message-bottom-meta="true"
                className={cn(
                  "flex max-w-full items-end leading-none",
                  hasReactions ? "mt-1 w-full min-w-[6.75rem] gap-1.5" : "ml-auto mt-px w-fit justify-end gap-1 pl-3",
                )}
              >
                {hasReactions && (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-1">
                    {visibleReactionEntries.map(([emoji, { count, mine }]) => (
                      <button
                        key={emoji}
                        onClick={() => onReaction(emoji)}
                        className={cn(
                          "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11px] leading-none transition-all hover:scale-105 active:scale-95",
                          mine
                            ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] border-[color-mix(in_srgb,var(--kub-cyan)_72%,transparent)] text-[color:var(--kub-cyan)]"
                            : "bg-[color-mix(in_srgb,var(--kub-surface-2)_72%,transparent)] border-[color-mix(in_srgb,var(--kub-border-color)_72%,transparent)] text-[color:var(--kub-muted)]"
                        )}
                      >
                        <span className="text-sm leading-none">{emoji}</span>
                        {count > 1 && <span className="tabular-nums">{count}</span>}
                      </button>
                    ))}
                    {hiddenReactionCount > 0 && (
                      <span
                        className="inline-flex h-[22px] items-center rounded-full border border-[color-mix(in_srgb,var(--kub-border-color)_72%,transparent)] bg-[color-mix(in_srgb,var(--kub-surface-2)_72%,transparent)] px-2 text-[11px] leading-none text-[color:var(--kub-muted)]"
                        title={`Ещё ${hiddenReactionCount} реакций`}
                        aria-label={`Ещё ${hiddenReactionCount} реакций`}
                      >
                        +{hiddenReactionCount}
                      </span>
                    )}
                  </div>
                )}

                <div
                  data-message-footer="true"
                  className="ml-auto flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none"
                >
                  {renderFooterContent()}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

function setBodySelectionSuppressed(suppressed: boolean) {
  if (typeof document === "undefined") return;
  document.body.style.userSelect = suppressed ? "none" : "";
  document.body.style.webkitUserSelect = suppressed ? "none" : "";
  document.documentElement.classList.toggle("kub-selection-suppressed", suppressed);
  if (suppressed) window.getSelection()?.removeAllRanges();
}

function MediaImage({ url, title, onOpen }: { url: string; title: string; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex max-w-[260px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить изображение.</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-[color:var(--kub-cyan)] hover:underline">
          Открыть
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-[min(360px,calc(100vw-7.5rem))] max-w-full overflow-hidden rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-[color:var(--kub-cyan)] sm:w-[min(420px,70vw)]"
      aria-label="Открыть фото"
    >
      <img
        src={url}
        alt={title || "Фото"}
        loading="lazy"
        className="max-h-[340px] w-full object-cover transition-transform duration-200 group-hover:scale-[1.01] sm:max-h-[380px]"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function MediaVideo({ url, title, onOpen }: { url: string; title: string; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex max-w-[280px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить видео.</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-[color:var(--kub-cyan)] hover:underline">
          Открыть
        </a>
      </div>
    );
  }

  return (
    <div className="relative w-[min(360px,calc(100vw-7.5rem))] max-w-full overflow-hidden rounded-xl bg-black sm:w-[min(420px,70vw)]">
      <video
        src={url}
        preload="metadata"
        controls
        playsInline
        className="block aspect-video w-full max-h-[320px] bg-black object-contain"
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={onOpen}
        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg bg-black/65 px-2.5 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-black/80"
        aria-label="Открыть видео в просмотрщике"
      >
        <KubIcon name="externalLink" size={14} />
        <span className="hidden sm:inline">Открыть</span>
      </button>
    </div>
  );
}

function parseAudioDuration(content: string | null | undefined): number {
  const match = content?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
  return minutes * 60 + seconds;
}

function isVoiceMessage(message: MessageWithSender): boolean {
  if (message.type === "audio") return true;
  const mediaUrl = message.media_url?.toLowerCase() ?? "";
  if (/\.(webm|ogg|oga|mp3|wav|m4a|aac)(\?|#|$)/.test(mediaUrl)) return true;
  const content = message.content?.toLowerCase() ?? "";
  return content.includes("голосовое") || content.includes("voice");
}
