"use client";

import React, { RefObject, useState, useEffect, useCallback, useRef } from "react";
import { KubIcon } from "@/components/kub";
import { MessageBubble } from "./MessageBubble";
import type { MediaViewerItem } from "./MediaViewer";
import { TypingIndicator } from "./TypingIndicator";
import type { ChatMember, MessageWithSender } from "@/types/database";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";

interface MessageListProps {
  messages: MessageWithSender[];
  onReply: (msg: MessageWithSender) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onEdit?: (msg: MessageWithSender) => void;
  onDelete?: (msg: MessageWithSender) => void;
  onBulkDelete?: (messages: MessageWithSender[]) => Promise<void> | void;
  onTogglePin?: (msg: MessageWithSender) => void;
  onForward?: (msg: MessageWithSender) => void;
  onOpenMedia?: (media: MediaViewerItem) => void;
  bottomRef: RefObject<HTMLDivElement | null>;
  isTyping?: boolean;
  typingUser?: string;
  highlightedId?: string | null;
  messageRefs?: React.MutableRefObject<Record<string, HTMLDivElement>>;
  chatMembers?: (ChatMember & { profile?: unknown })[];
  /** Role of the current user in this chat — propagated to MessageBubble. */
  myRole?: "owner" | "admin" | "member" | null;
}

function shouldShowDateSeparator(prev: MessageWithSender | null, current: MessageWithSender): boolean {
  if (!prev) return true;
  return new Date(prev.created_at).toDateString() !== new Date(current.created_at).toDateString();
}

export function MessageList({
  messages,
  onReply,
  onReaction,
  onEdit,
  onDelete,
  onBulkDelete,
  onTogglePin,
  onForward,
  onOpenMedia,
  bottomRef,
  isTyping = false,
  typingUser,
  highlightedId,
  messageRefs,
  chatMembers,
  myRole,
}: MessageListProps) {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);

  // Compute: latest timestamp that any non-me member has read up to
  const othersLastReadAt = React.useMemo(() => {
    if (!chatMembers || !userId) return null;
    const others = chatMembers.filter((m) => m.user_id !== userId);
    if (!others.length) return null;
    // Use the latest last_read_at among all other members
    const timestamps = others.map((m) => m.last_read_at).filter(Boolean) as string[];
    if (!timestamps.length) return null;
    return timestamps.sort().at(-1) ?? null;
  }, [chatMembers, userId]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build userId → fullName map and messageId → message map from loaded messages
  const usersMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    messages.forEach((m) => {
      if (m.user_id && m.sender?.full_name) map[m.user_id] = m.sender.full_name;
    });
    return map;
  }, [messages]);

  const messagesMap = React.useMemo(() => {
    const map: Record<string, typeof messages[0]> = {};
    messages.forEach((m) => { map[m.id] = m; });
    return map;
  }, [messages]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [openReactionMessageId, setOpenReactionMessageId] = useState<string | null>(null);
  const isAtBottomRef = useRef(true);

  const selectableMessages = React.useMemo(
    // Current backend policy allows soft-delete through message UPDATE only for
    // the author. Do not let users select rows that the server will reject.
    () => messages.filter((message) => !message.deleted_at && message.user_id === userId),
    [messages, userId],
  );
  const selectedMessages = React.useMemo(
    () => selectableMessages.filter((message) => selectedIds.has(message.id)),
    [selectableMessages, selectedIds],
  );

  const toggleSelected = useCallback((messageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!onBulkDelete || selectedMessages.length === 0) return;
    if (!confirm(`Удалить выбранные сообщения (${selectedMessages.length})?`)) return;
    setBulkError(null);
    try {
      await onBulkDelete(selectedMessages);
      cancelSelection();
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Не удалось удалить выбранные сообщения.");
    }
  }, [cancelSelection, onBulkDelete, selectedMessages]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 80;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setNewCount(0);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    setNewCount(0);
    setShowScrollBtn(false);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(true);
    } else {
      setNewCount((n) => n + 1);
    }
  }, [messages.length, scrollToBottom]);

  // Initial scroll
  useEffect(() => {
    scrollToBottom(false);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex-1 overflow-hidden">
      {onBulkDelete && selectionMode && (
        <div className="absolute right-3 top-2 z-20 flex items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]/95 p-1.5 shadow-lg backdrop-blur">
          <span className="px-2 text-xs font-semibold text-[color:var(--kub-muted)]">
            Выбрано: {selectedMessages.length}
          </span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={selectedMessages.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[color:var(--kub-danger)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:opacity-40"
          >
            <KubIcon name="delete" size={14} />
            Удалить
          </button>
          <button
            type="button"
            onClick={cancelSelection}
            className="inline-flex h-8 items-center justify-center rounded-lg px-2 text-xs font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-2)]"
          >
            Отмена
          </button>
        </div>
      )}
      {bulkError && (
        <div className="absolute left-3 right-3 top-14 z-20 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[var(--kub-surface)]/95 px-3 py-2 text-xs text-[color:var(--kub-danger)] shadow-lg backdrop-blur">
          {bulkError}
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onClickCapture={(event) => {
          if (!openReactionMessageId) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-reaction-menu], [data-reaction-trigger]")) return;
          setOpenReactionMessageId(null);
        }}
        className="chat-bg h-full overflow-y-auto px-4 py-2 pb-4"
      >
        {messages.map((msg, idx) => {
          const prev = idx > 0 ? messages[idx - 1] : null;
          const next = idx < messages.length - 1 ? messages[idx + 1] : null;
          const showDate = shouldShowDateSeparator(prev, msg);
          const isMe = msg.user_id === userId;
          const isSameSenderAsPrev = !showDate && prev?.user_id === msg.user_id;
          const isSameSenderAsNext = next?.user_id === msg.user_id &&
            !shouldShowDateSeparator(msg, next);

          const isRead = isMe && othersLastReadAt
            ? othersLastReadAt >= msg.created_at
            : false;
          const canSelect = !msg.deleted_at && isMe;

          return (
            <div
              key={msg.id}
              ref={(el) => { if (el && messageRefs) messageRefs.current[msg.id] = el; }}
              className={cn(
                highlightedId === msg.id &&
                  "transition-colors duration-500 rounded-lg bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]"
              )}
            >
              {showDate && (
                <div className="flex justify-center my-3">
                  <span className="px-3 py-1 rounded-full text-xs select-none backdrop-blur-sm bg-[color-mix(in_srgb,var(--kub-bg)_75%,transparent)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
                    {formatDate(msg.created_at)}
                  </span>
                </div>
              )}
              <div className={cn("flex items-center gap-2", isMe ? "justify-end" : "justify-start")}>
                {selectionMode && canSelect && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSelected(msg.id);
                    }}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                      selectedIds.has(msg.id)
                        ? "border-[var(--kub-cyan)] bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                        : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-[color:var(--kub-muted)]"
                    )}
                    aria-label={selectedIds.has(msg.id) ? "Снять выбор" : "Выбрать сообщение"}
                  >
                    {selectedIds.has(msg.id) && <KubIcon name="check" size={14} />}
                  </button>
                )}
                <div
                  className={cn(
                    selectionMode && canSelect ? "min-w-0 flex-1 cursor-pointer rounded-xl" : "min-w-0",
                    selectionMode && selectedIds.has(msg.id) && "ring-2 ring-[color:var(--kub-cyan)]/50"
                  )}
                  onClickCapture={(event) => {
                    if (!selectionMode || !canSelect) return;
                    const target = event.target as HTMLElement | null;
                    if (target?.closest("button,a,input,textarea,select,video,audio,[role='slider']")) return;
                    event.stopPropagation();
                    toggleSelected(msg.id);
                  }}
                  aria-disabled={selectionMode && !canSelect}
                >
                  <MessageBubble
                    message={msg}
                    isMe={isMe}
                    isFirstInGroup={!isSameSenderAsPrev}
                    isLastInGroup={!isSameSenderAsNext}
                    onReply={() => onReply(msg)}
                    onReaction={(emoji) => onReaction(msg.id, emoji)}
                    onEdit={onEdit ? () => onEdit(msg) : undefined}
                    onDelete={onDelete ? () => onDelete(msg) : undefined}
                    onStartSelection={onBulkDelete && canSelect ? () => {
                      setSelectionMode(true);
                      setSelectedIds(new Set([msg.id]));
                    } : undefined}
                    onTogglePin={onTogglePin ? () => onTogglePin(msg) : undefined}
                    onForward={onForward ? () => onForward(msg) : undefined}
                    onOpenMedia={onOpenMedia}
                    reactionMenuOpen={openReactionMessageId === msg.id}
                    onToggleReactionMenu={() =>
                      setOpenReactionMessageId((current) => current === msg.id ? null : msg.id)
                    }
                    onCloseReactionMenu={() => setOpenReactionMessageId(null)}
                    usersMap={usersMap}
                    messagesMap={messagesMap}
                    isRead={isRead}
                    myRole={myRole}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex justify-start mt-1">
            <TypingIndicator name={typingUser} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button
          onClick={() => scrollToBottom(true)}
          aria-label="К последним сообщениям"
          className="absolute bottom-4 right-4 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105 active:scale-95 z-10 bg-[var(--kub-surface)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)] hover:text-[color:var(--kub-cyan)] kub-glow-soft"
        >
          {newCount > 0 && (
            <span className="absolute -top-2 -right-1 min-w-5 h-5 rounded-full text-xs font-semibold flex items-center justify-center px-1 bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]">
              {newCount}
            </span>
          )}
          <KubIcon name="chevronDown" size={18} />
        </button>
      )}
    </div>
  );
}
