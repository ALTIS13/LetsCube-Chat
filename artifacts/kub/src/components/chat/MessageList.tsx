"use client";

import React, { RefObject, useState, useEffect, useCallback, useRef } from "react";
import { KubIcon, KubModal } from "@/components/kub";
import { MessageBubble } from "./MessageBubble";
import type { MediaViewerItem } from "./MediaViewer";
import { TypingIndicator } from "./TypingIndicator";
import type { ChatMember, MessageWithSender, Profile } from "@/types/database";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import { getMessageDeliveryState } from "@/lib/messageDelivery";
import { getGroupReadReceiptInfo, getReceiptDisplayName, type GroupReadReceiptInfo } from "@/lib/groupReadReceipts";
import { requestAppConfirm } from "@/lib/appDialogs";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { formatFullTime } from "@/lib/format";

interface MessageListProps {
  messages: MessageWithSender[];
  onReply: (msg: MessageWithSender) => void;
  onJumpToReply?: (messageId: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onEdit?: (msg: MessageWithSender) => void;
  onDelete?: (msg: MessageWithSender) => void;
  onHideForMe?: (msg: MessageWithSender) => void;
  onBulkHideForMe?: (messages: MessageWithSender[]) => Promise<void> | void;
  onBulkDeleteForEveryone?: (messages: MessageWithSender[]) => Promise<void> | void;
  onTogglePin?: (msg: MessageWithSender) => void;
  onForward?: (msg: MessageWithSender) => void;
  onRetrySend?: (msg: MessageWithSender) => void;
  onEditFailedSend?: (msg: MessageWithSender) => void;
  onDiscardLocalMessage?: (msg: MessageWithSender) => void;
  onOpenMedia?: (media: MediaViewerItem) => void;
  bottomRef: RefObject<HTMLDivElement | null>;
  isTyping?: boolean;
  typingUser?: string;
  highlightedId?: string | null;
  messageRefs?: React.MutableRefObject<Record<string, HTMLDivElement>>;
  chatMembers?: (ChatMember & { profile?: Profile | null })[];
  chatType?: string | null;
  isSavedChat?: boolean;
  /** Role of the current user in this chat — propagated to MessageBubble. */
  myRole?: "owner" | "admin" | "member" | null;
  onLoadOlder?: () => Promise<{ loaded: number } | void> | { loaded: number } | void;
  hasMoreOlder?: boolean;
  loadingOlder?: boolean;
  olderError?: string | null;
  bottomInset?: number;
}

function compareMessagesForRender(a: MessageWithSender, b: MessageWithSender): number {
  const byCreatedAt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.id.localeCompare(b.id);
}

function getMessageDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMessageDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dayKey = getMessageDayKey(dateStr);
  if (dayKey === getMessageDayKey(today.toISOString())) return "Сегодня";
  if (dayKey === getMessageDayKey(yesterday.toISOString())) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function shouldShowDateSeparator(prev: MessageWithSender | null, current: MessageWithSender): boolean {
  if (!prev) return true;
  return getMessageDayKey(prev.created_at) !== getMessageDayKey(current.created_at);
}

function SystemMessageNotice({ message }: { message: MessageWithSender }) {
  const text = message.content?.trim() || "Системное уведомление";
  return (
    <div className="my-2 flex w-full justify-center px-8" data-system-message={message.id}>
      <span className="max-w-[min(82vw,32rem)] rounded-full border border-[color:var(--kub-border-color)] bg-[color-mix(in_srgb,var(--kub-bg)_76%,transparent)] px-3 py-1 text-center text-[11px] leading-snug text-[color:var(--kub-muted)] shadow-sm backdrop-blur-sm">
        {text}
      </span>
    </div>
  );
}

export function MessageList({
  messages,
  onReply,
  onJumpToReply,
  onReaction,
  onEdit,
  onDelete,
  onHideForMe,
  onBulkHideForMe,
  onBulkDeleteForEveryone,
  onTogglePin,
  onForward,
  onRetrySend,
  onEditFailedSend,
  onDiscardLocalMessage,
  onOpenMedia,
  bottomRef,
  isTyping = false,
  typingUser,
  highlightedId,
  messageRefs,
  chatMembers,
  chatType,
  isSavedChat,
  myRole,
  onLoadOlder,
  hasMoreOlder = false,
  loadingOlder = false,
  olderError = null,
  bottomInset = 0,
}: MessageListProps) {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sortedMessages = React.useMemo(
    () => [...messages].sort(compareMessagesForRender),
    [messages],
  );

  // Build userId → fullName map and messageId → message map from loaded messages
  const usersMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    sortedMessages.forEach((m) => {
      if (m.user_id && m.sender?.full_name) map[m.user_id] = m.sender.full_name;
    });
    return map;
  }, [sortedMessages]);

  const messagesMap = React.useMemo(() => {
    const map: Record<string, MessageWithSender> = {};
    sortedMessages.forEach((m) => { map[m.id] = m; });
    return map;
  }, [sortedMessages]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkConfirmAction, setBulkConfirmAction] = useState<"hide" | "delete" | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [openReactionMessageId, setOpenReactionMessageId] = useState<string | null>(null);
  const [openActionMessageId, setOpenActionMessageId] = useState<string | null>(null);
  const [readReceiptsMessageId, setReadReceiptsMessageId] = useState<string | null>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(sortedMessages.length);
  const loadingOlderRef = useRef(loadingOlder);
  useEffect(() => { loadingOlderRef.current = loadingOlder; }, [loadingOlder]);
  const hasMoreOlderRef = useRef(hasMoreOlder);
  useEffect(() => { hasMoreOlderRef.current = hasMoreOlder; }, [hasMoreOlder]);
  const preservingOlderScrollRef = useRef(false);

  const selectableMessages = React.useMemo(
    () => sortedMessages.filter((message) => !message.deleted_at),
    [sortedMessages],
  );
  const selectedMessages = React.useMemo(
    () => selectableMessages.filter((message) => selectedIds.has(message.id)),
    [selectableMessages, selectedIds],
  );
  const selectedCanDeleteForEveryone = React.useMemo(
    () => Boolean(
      onBulkDeleteForEveryone &&
      !isSavedChat &&
      selectedMessages.length > 0 &&
      selectedMessages.every((message) => message.user_id === userId)
    ),
    [isSavedChat, onBulkDeleteForEveryone, selectedMessages, userId],
  );
  const readReceiptsMessage = React.useMemo(
    () => readReceiptsMessageId ? sortedMessages.find((message) => message.id === readReceiptsMessageId) ?? null : null,
    [readReceiptsMessageId, sortedMessages],
  );
  const readReceiptsInfo = React.useMemo(
    () => readReceiptsMessage
      ? getGroupReadReceiptInfo(readReceiptsMessage, {
        currentUserId: userId,
        chatType,
        members: chatMembers,
        isSavedChat,
      })
      : null,
    [chatMembers, chatType, isSavedChat, readReceiptsMessage, userId],
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
    setBulkConfirmAction(null);
    setBulkDeleting(false);
    setOpenReactionMessageId(null);
    setOpenActionMessageId(null);
  }, []);

  const handleBulkHideForMe = useCallback(async () => {
    if (!onBulkHideForMe || selectedMessages.length === 0) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить выбранные сообщения у себя?",
      description: "Сообщения исчезнут только у вас. У других участников они останутся.",
      confirmLabel: "Удалить у себя",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    setBulkConfirmAction("hide");
    setBulkDeleting(true);
    setBulkError(null);
    try {
      await onBulkHideForMe(selectedMessages);
      cancelSelection();
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Не удалось скрыть выбранные сообщения.");
      setBulkDeleting(false);
    }
  }, [cancelSelection, onBulkHideForMe, selectedMessages]);

  const handleBulkDeleteForEveryone = useCallback(async () => {
    if (!onBulkDeleteForEveryone || !selectedCanDeleteForEveryone) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить выбранные сообщения для всех?",
      description: "Это действие нельзя отменить. Сообщения будут заменены плашками удаления.",
      confirmLabel: "Удалить для всех",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    setBulkConfirmAction("delete");
    setBulkDeleting(true);
    setBulkError(null);
    try {
      await onBulkDeleteForEveryone(selectedMessages);
      cancelSelection();
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Не удалось удалить выбранные сообщения для всех.");
      setBulkDeleting(false);
    }
  }, [cancelSelection, onBulkDeleteForEveryone, selectedCanDeleteForEveryone, selectedMessages]);

  useEffect(() => {
    setBulkConfirmAction(null);
  }, [selectedIds]);

  const loadOlderAtTop = useCallback(async () => {
    const el = containerRef.current;
    if (!el || !onLoadOlder || loadingOlderRef.current || !hasMoreOlderRef.current) return;
    const beforeHeight = el.scrollHeight;
    const beforeTop = el.scrollTop;
    preservingOlderScrollRef.current = true;
    await onLoadOlder();
    requestAnimationFrame(() => {
      const current = containerRef.current;
      if (current) {
        current.scrollTop = beforeTop + (current.scrollHeight - beforeHeight);
      }
      preservingOlderScrollRef.current = false;
    });
  }, [onLoadOlder]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 120;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setNewCount(0);
    if (el.scrollTop < 160) void loadOlderAtTop();
  }, [loadOlderAtTop]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
      setNewCount(0);
      setShowScrollBtn(false);
    });
  }, []);

  // Keep bottom lock for new messages and typing indicator without pulling
  // users down when they intentionally scrolled up.
  useEffect(() => {
    const messageCountChanged = prevMessageCountRef.current !== sortedMessages.length;
    prevMessageCountRef.current = sortedMessages.length;
    if (isAtBottomRef.current) {
      scrollToBottom(true);
    } else if (messageCountChanged && !preservingOlderScrollRef.current && !loadingOlderRef.current) {
      setNewCount((n) => n + 1);
    }
  }, [isTyping, sortedMessages.length, scrollToBottom]);

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom(false);
  }, [bottomInset, scrollToBottom]);

  // Initial scroll
  useEffect(() => {
    scrollToBottom(false);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
      {onBulkHideForMe && selectionMode && (
        <div className="fixed bottom-[4.75rem] left-3 right-3 z-[70] flex items-center justify-between gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]/95 p-2 shadow-lg backdrop-blur sm:absolute sm:bottom-auto sm:left-auto sm:right-3 sm:top-2 sm:w-auto sm:justify-start sm:p-1.5">
          <span className="px-2 text-xs font-semibold text-[color:var(--kub-muted)]">
            Выбрано: {selectedMessages.length}
          </span>
          <button
            type="button"
            onClick={handleBulkHideForMe}
            disabled={selectedMessages.length === 0 || bulkDeleting}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:opacity-40",
              bulkConfirmAction === "hide" ? "bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] text-[color:var(--kub-danger)]" : "text-[color:var(--kub-danger)]",
            )}
          >
            <KubIcon name="delete" size={14} />
            {bulkDeleting && bulkConfirmAction === "hide" ? "Удаляем..." : "Удалить у себя"}
          </button>
          {selectedCanDeleteForEveryone && (
            <button
              type="button"
              onClick={handleBulkDeleteForEveryone}
              disabled={selectedMessages.length === 0 || bulkDeleting}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:opacity-40",
                bulkConfirmAction === "delete" ? "bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] text-[color:var(--kub-danger)]" : "text-[color:var(--kub-danger)]",
              )}
            >
              <KubIcon name="delete" size={14} />
              {bulkDeleting && bulkConfirmAction === "delete" ? "Удаляем..." : "Удалить для всех"}
            </button>
          )}
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
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-reaction-menu], [data-reaction-trigger]")) return;
          if (target?.closest("[data-action-menu]")) return;
          if (openReactionMessageId) setOpenReactionMessageId(null);
          if (openActionMessageId) setOpenActionMessageId(null);
        }}
        className="chat-bg h-full min-w-0 overflow-y-auto overflow-x-hidden px-3 py-2 pb-6 sm:px-4"
        style={{ paddingBottom: `calc(1.5rem + ${Math.max(0, bottomInset)}px)` }}
      >
        {(loadingOlder || olderError) && (
          <div className="flex justify-center py-2" data-message-history-status>
            <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kub-border-color)] bg-[color-mix(in_srgb,var(--kub-bg)_78%,transparent)] px-3 py-1 text-xs text-[color:var(--kub-muted)] backdrop-blur-sm">
              {loadingOlder && <KubIcon name="spinner" size={12} />}
              {olderError ?? "Загружаем историю..."}
            </span>
          </div>
        )}

        {sortedMessages.map((msg, idx) => {
          const prev = idx > 0 ? sortedMessages[idx - 1] : null;
          const next = idx < sortedMessages.length - 1 ? sortedMessages[idx + 1] : null;
          const showDate = shouldShowDateSeparator(prev, msg);
          const isMe = msg.user_id === userId;
          const isSameSenderAsPrev = !showDate && prev?.user_id === msg.user_id;
          const isSameSenderAsNext = next?.user_id === msg.user_id &&
            !shouldShowDateSeparator(msg, next);
          const isSystemMessage = msg.type === "system";

          const canSelect = !msg.deleted_at && !isSystemMessage;
          const isLocalSend = msg.id.startsWith("tmp:") || Boolean(msg.pending || msg.checking || msg.failed);
          const deliveryState = getMessageDeliveryState(msg, {
            currentUserId: userId,
            chatType,
            members: chatMembers,
            isSavedChat,
          });
          const groupReadInfo = getGroupReadReceiptInfo(msg, {
            currentUserId: userId,
            chatType,
            members: chatMembers,
            isSavedChat,
          });

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
                <div className="flex justify-center my-3" data-message-date-separator={getMessageDayKey(msg.created_at)}>
                  <span className="px-3 py-1 rounded-full text-xs select-none backdrop-blur-sm bg-[color-mix(in_srgb,var(--kub-bg)_75%,transparent)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
                    {getMessageDayLabel(msg.created_at)}
                  </span>
                </div>
              )}
              {isSystemMessage ? (
                <SystemMessageNotice message={msg} />
              ) : (
              <div className={cn("flex w-full min-w-0 items-center gap-1.5 overflow-hidden", isMe ? "justify-end" : "justify-start")}>
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
                    "min-w-0 max-w-full",
                    selectionMode && canSelect ? "cursor-pointer rounded-xl" : "",
                    selectionMode && canSelect && "max-w-[calc(100%-2.25rem)]"
                  )}
                  onClickCapture={(event) => {
                    if (!selectionMode) return;
                    const target = event.target as HTMLElement | null;
                    const isInteractive = Boolean(target?.closest("button,a,input,textarea,select,video,audio,[role='slider']"));
                    if (!canSelect) {
                      if (isInteractive) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                      return;
                    }
                    event.preventDefault();
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
                    onReply={isLocalSend ? () => undefined : () => {
                      setOpenActionMessageId(null);
                      setOpenReactionMessageId(null);
                      onReply(msg);
                    }}
                    onJumpToReply={onJumpToReply}
                    onReaction={isLocalSend ? () => undefined : (emoji) => onReaction(msg.id, emoji)}
                    onEdit={!isLocalSend && onEdit ? () => onEdit(msg) : undefined}
                    onDelete={!isLocalSend && onDelete ? () => onDelete(msg) : undefined}
                    onHideForMe={!isLocalSend && onHideForMe ? () => onHideForMe(msg) : undefined}
                    onRetrySend={onRetrySend && msg.failed ? () => onRetrySend(msg) : undefined}
                    onEditFailedSend={onEditFailedSend && msg.failed ? () => onEditFailedSend(msg) : undefined}
                    onDiscardLocalMessage={onDiscardLocalMessage && isLocalSend ? () => onDiscardLocalMessage(msg) : undefined}
                    onStartSelection={onBulkHideForMe && canSelect ? () => {
                      setBulkError(null);
                      setBulkConfirmAction(null);
                      setSelectionMode(true);
                      setSelectedIds(new Set([msg.id]));
                      setOpenReactionMessageId(null);
                      setOpenActionMessageId(null);
                    } : undefined}
                    onTogglePin={!isLocalSend && onTogglePin ? () => onTogglePin(msg) : undefined}
                    onForward={!isLocalSend && onForward ? () => onForward(msg) : undefined}
                    onOpenMedia={onOpenMedia}
                    reactionMenuOpen={openReactionMessageId === msg.id}
                    onToggleReactionMenu={() => {
                      setOpenActionMessageId(null);
                      setOpenReactionMessageId((current) => current === msg.id ? null : msg.id);
                    }}
                    onCloseReactionMenu={() => setOpenReactionMessageId(null)}
                    actionMenuOpen={openActionMessageId === msg.id}
                    onOpenActionMenu={() => {
                      setOpenReactionMessageId(null);
                      setOpenActionMessageId(msg.id);
                    }}
                    onCloseActionMenu={() => setOpenActionMessageId(null)}
                    selected={selectionMode && selectedIds.has(msg.id)}
                    isSelectionMode={selectionMode}
                    usersMap={usersMap}
                    messagesMap={messagesMap}
                    deliveryState={deliveryState}
                    groupReadInfo={groupReadInfo}
                    onOpenGroupReadReceipts={groupReadInfo ? () => setReadReceiptsMessageId(msg.id) : undefined}
                    isSavedChat={isSavedChat}
                    myRole={myRole}
                  />
                </div>
              </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex justify-start mt-1 mb-3">
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

      {readReceiptsMessage && readReceiptsInfo && (
        <GroupReadReceiptsModal
          info={readReceiptsInfo}
          onClose={() => setReadReceiptsMessageId(null)}
        />
      )}
    </div>
  );
}

function GroupReadReceiptsModal({
  info,
  onClose,
}: {
  info: GroupReadReceiptInfo;
  onClose: () => void;
}) {
  return (
    <KubModal
      open
      onClose={onClose}
      title="Прочитали"
      description={`${info.readCount} из ${info.totalRecipients}`}
      icon={<KubIcon name={info.allRead ? "doubleCheck" : "eye"} size={18} />}
      size="sm"
    >
      {info.readers.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-4 text-center text-sm text-[color:var(--kub-muted)]">
          Пока никто не прочитал
        </div>
      ) : (
        <div className="grid gap-2">
          {info.readers.map((reader) => {
            const name = getReceiptDisplayName(reader);
            const avatarProfile = reader.profile ?? {
              id: reader.userId,
              full_name: name,
              username: null,
              avatar_url: null,
            };
            return (
              <div
                key={reader.userId}
                className="flex min-w-0 items-center gap-3 rounded-xl bg-[var(--kub-surface-2)] px-3 py-2"
              >
                <UserAvatar user={avatarProfile} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{name}</div>
                  <div className="text-xs text-[color:var(--kub-muted)]">{formatFullTime(reader.readAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </KubModal>
  );
}
