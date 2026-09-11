"use client";

import React, { RefObject, useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { KubIcon, KubModal } from "@/components/kub";
import { MessageBubble } from "./MessageBubble";
import type { MediaViewerItem } from "./MediaViewer";
import { TypingIndicator } from "./TypingIndicator";
import type { ChatMember, MessageWithSender, Profile } from "@/types/database";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import {
  canUseHumanMessageControls,
  isIncomingMessage,
  messageActorGroupingKey,
  resolveMessageActor,
} from "@/lib/messageActor";
import { getMessageDeliveryState, type MessageDeliveryState } from "@/lib/messageDelivery";
import {
  getGroupReadReceiptInfo,
  getReceiptDisplayName,
  sameGroupReadReceiptFace,
  type GroupReadReceiptInfo,
} from "@/lib/groupReadReceipts";
import { sameData } from "@/lib/structuralSharing";
import { requestAppConfirm } from "@/lib/appDialogs";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { formatFullTime } from "@/lib/format";
import {
  useAvatarVariantUrls,
  useMessageMediaVariantUrls,
  type AvatarVariantUrls,
  type MessageMediaVariantUrls,
} from "@/hooks/useMediaVariants";
import { advanceMessageEntrance, EMPTY_ENTRANCE_STATE, messageEntranceKey } from "@/lib/messageEntrance";
import {
  captureVisibleMessageAnchor,
  restoreVisibleMessageAnchor,
  type VisibleMessageAnchor,
} from "@/lib/messageScrollAnchor";

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
  /** Height of the chrome the composer occupies over the foot of the list. */
  bottomInset?: number;
  /** Height of the chrome the header stack occupies over the head of the list. */
  topInset?: number;
  layoutKey?: string;
  layoutVersion?: number;
  initialUnreadSince?: string | null;
  initialUnreadCount?: number;
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

/**
 * The four chips that ride inside the scrolling conversation carry no fill.
 *
 * This one, the history band, the date separator and the unread separator all
 * used to write their own material: `backdrop-blur-sm` over a hand-mixed
 * `--kub-bg` at 75-82% alpha. That is rule 1 (never write the material by hand)
 * and rule 6 (nothing that scrolls or repeats) of
 * `docs/operations/interface-material.md` at once, and the blur bought nothing:
 * these chips are block rows in the flow, so what is behind them is the chat
 * wallpaper and never a message — rule 6's own argument, exactly. D-062.
 *
 * `.kub-raise` was the obvious replacement and it is wrong here. The veil is
 * the right idea — one step above whatever it is laid on, rule 5 — but on a
 * light ground it steps DOWN, and `--kub-muted` is not far enough from the page
 * to pay for that. Photographed on the device with the text made transparent,
 * the way rule 7 requires, worst of three points across the date separator's
 * text box:
 *
 *   fill              light backdrop        light   dark backdrop      dark
 *   as shipped, 75%   rgb(233, 239, 246)    5.00    rgb(6, 11, 25)     8.05
 *   .kub-raise        rgb(219, 226, 235)    4.30    rgb(24, 29, 42)    6.68
 *   none              rgb(233, 239, 246)    4.86    rgb(6, 12, 26)     7.86
 *
 * The veil is under the 4.5 floor in the light theme. That is rule 10's warning
 * arriving in a new place — a fill that finally renders can still be the wrong
 * one — and its answer is the same: drop the fill, keep the border, which costs
 * nothing and carries the chip on its own. The 0.14 between 5.00 and 4.86 is
 * the wallpaper's dot grid showing through where the old fill dimmed it.
 *
 * So what separates these from the wallpaper is `--kub-border-color`, and for
 * the unread separator its pink form. That is what carried them before as
 * well: 75-82% of the ground over the ground is the ground.
 */
function SystemMessageNotice({ message }: { message: MessageWithSender }) {
  const text = message.content?.trim() || "Системное уведомление";
  return (
    <div className="my-2 flex w-full justify-center px-8" data-system-message={message.id}>
      <span className="max-w-[min(82vw,32rem)] rounded-full border border-[color:var(--kub-border-color)] px-3 py-1 text-center text-[12px] leading-snug text-[color:var(--kub-muted)]">
        {text}
      </span>
    </div>
  );
}

/** Keys that move a scroller, and therefore mean "I am reading, leave me here". */
const SCROLLING_KEYS = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  " ",
  "Spacebar",
]);

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
  topInset = 0,
  layoutKey,
  layoutVersion = 0,
  initialUnreadSince = null,
  initialUnreadCount = 0,
}: MessageListProps) {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sortedMessages = React.useMemo(
    () => [...messages].sort(compareMessagesForRender),
    [messages],
  );

  const messagesMap = React.useMemo(() => {
    const map: Record<string, MessageWithSender> = {};
    sortedMessages.forEach((m) => { map[m.id] = m; });
    return map;
  }, [sortedMessages]);
  const messageMediaVariants = useMessageMediaVariantUrls(sortedMessages);
  // Only a message that arrived while this list was on screen animates in.
  // The class used to be unconditional, so every bubble played it on mount and
  // opening a chat animated the whole history at once.
  // The entrance is tracked by `messageEntranceKey` rather than by the row id,
  // so a message you sent does not animate a second time when its optimistic
  // `tmp:` row is replaced by the server row. The ids are still passed as the
  // render identity, which is what the idempotency cache has to key off.
  // `layoutKey` is the chat id, and it is passed as the entrance scope because
  // this component is not remounted between conversations: without it the ids
  // of the previous chat stayed in `seen`, so every message of the next one was
  // an id that had never been seen and the whole history animated.
  const entranceRef = React.useRef(EMPTY_ENTRANCE_STATE);
  const enteringKeys = React.useMemo(() => {
    const { state, entering } = advanceMessageEntrance(
      entranceRef.current,
      sortedMessages.map(messageEntranceKey),
      sortedMessages.map((m) => m.id),
      layoutKey ?? null,
    );
    entranceRef.current = state;
    return entering;
  }, [sortedMessages, layoutKey]);
  const senderAvatarProfileIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const message of sortedMessages) {
      if (message.sender?.id && message.sender.avatar_url) ids.add(message.sender.id);
    }
    return Array.from(ids).sort();
  }, [sortedMessages]);
  const senderAvatarVariants = useAvatarVariantUrls(senderAvatarProfileIds);
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
  /** The last message's id, so a prepend is not mistaken for a send. */
  const prevLastMessageIdRef = useRef<string | null>(
    sortedMessages[sortedMessages.length - 1]?.id ?? null,
  );
  const loadingOlderRef = useRef(loadingOlder);
  useEffect(() => { loadingOlderRef.current = loadingOlder; }, [loadingOlder]);
  const hasMoreOlderRef = useRef(hasMoreOlder);
  useEffect(() => { hasMoreOlderRef.current = hasMoreOlder; }, [hasMoreOlder]);
  const preservingOlderScrollRef = useRef(false);
  const olderScrollAnchorRef = useRef<VisibleMessageAnchor | null>(null);
  const olderStartFirstMessageIdRef = useRef<string | null>(null);
  const olderStartMessageCountRef = useRef(0);
  const olderReleaseFrameRef = useRef<number | null>(null);
  const olderSafetyTimeoutRef = useRef<number | null>(null);
  const releaseOlderScrollPreservationRef = useRef<(() => void) | null>(null);
  /**
   * True only while the hold loop is actually correcting the scroll position.
   *
   * The distinction matters: the wheel that scrolls to the top is the same
   * gesture that ASKS for older history, so releasing on any input cancelled
   * the hold before it ever ran — measured, the anchor still drifted exactly
   * 445px with the hold in place. Input during the hold means the reader has
   * taken over; input before it lands is what started the load.
   */
  const olderHoldActiveRef = useRef(false);
  const initialScrollAppliedRef = useRef<string | null>(null);
  const initialScrollPendingRef = useRef(false);
  const initialScrollPendingKeyRef = useRef<string | null>(null);
  const initialBottomLockUntilRef = useRef(0);
  const isInitialBottomLocked = useCallback(() => Date.now() < initialBottomLockUntilRef.current, []);
  const initialScrollKey = React.useMemo(
    () => `${layoutKey ?? "chat"}:${initialUnreadCount}:${initialUnreadSince ?? "none"}`,
    [initialUnreadCount, initialUnreadSince, layoutKey],
  );
  const firstUnreadMessageId = React.useMemo(() => {
    if (!initialUnreadCount || !userId) return null;
    const boundaryTime = initialUnreadSince ? new Date(initialUnreadSince).getTime() : null;
    const first = sortedMessages.find((message) => {
      if (message.deleted_at || !isIncomingMessage(message, userId)) return false;
      if (!boundaryTime || Number.isNaN(boundaryTime)) return true;
      return new Date(message.created_at).getTime() > boundaryTime;
    });
    return first?.id ?? null;
  }, [initialUnreadCount, initialUnreadSince, sortedMessages, userId]);

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
      selectedMessages.every((message) => canUseHumanMessageControls(message, userId))
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

  /**
   * What the rows are given, kept identical across renders of this list.
   *
   * The list renders far more often than any message changes: its padding is a
   * prop, so a draft that wraps renders it, and so do a typing indicator, a
   * selection and a menu opening. Each of those used to re-render every bubble
   * on screen, because every row was handed things that are new on every render
   * whether or not the message is: an inline arrow for each callback, a
   * delivery state and a read-receipt summary from helpers that build a fresh
   * object per call, and the whole message map for the one entry a reply
   * preview reads. Measured on the DEV preview fixture, the same at 390x844 and
   * 1440x900: seven keystrokes with one wrap and one unwrap rendered 96 bubbles —
   * all 48, twice.
   *
   * So a row is given values that compare equal while its message has not
   * changed: receipts memoised on what they are computed from, which of the
   * optional handlers exist as booleans, and one `rowActions` object that never
   * changes and reaches the current handlers through a ref. `MessageRow` is
   * memoised on exactly those.
   */
  const handlersRef = useRef({
    onReply, onJumpToReply, onReaction, onEdit, onDelete, onHideForMe, onTogglePin, onForward,
    onRetrySend, onEditFailedSend, onDiscardLocalMessage, onOpenMedia,
  });
  // After every commit, and before any input can reach a row: an action only
  // runs from a user's event, and none is dispatched between a render and its
  // layout effects. The callers pass inline arrows, so this changes every time.
  useLayoutEffect(() => {
    handlersRef.current = {
      onReply, onJumpToReply, onReaction, onEdit, onDelete, onHideForMe, onTogglePin, onForward,
      onRetrySend, onEditFailedSend, onDiscardLocalMessage, onOpenMedia,
    };
  });

  const rowActions = React.useMemo<MessageRowActions>(() => ({
    reply: (message) => {
      setOpenActionMessageId(null);
      setOpenReactionMessageId(null);
      handlersRef.current.onReply(message);
    },
    jumpToReply: (messageId) => handlersRef.current.onJumpToReply?.(messageId),
    reaction: (messageId, emoji) => handlersRef.current.onReaction(messageId, emoji),
    edit: (message) => handlersRef.current.onEdit?.(message),
    remove: (message) => handlersRef.current.onDelete?.(message),
    hideForMe: (message) => handlersRef.current.onHideForMe?.(message),
    retrySend: (message) => handlersRef.current.onRetrySend?.(message),
    editFailedSend: (message) => handlersRef.current.onEditFailedSend?.(message),
    discardLocalMessage: (message) => handlersRef.current.onDiscardLocalMessage?.(message),
    togglePin: (message) => handlersRef.current.onTogglePin?.(message),
    forward: (message) => handlersRef.current.onForward?.(message),
    openMedia: (media) => handlersRef.current.onOpenMedia?.(media),
    startSelection: (messageId) => {
      setBulkError(null);
      setBulkConfirmAction(null);
      setSelectionMode(true);
      setSelectedIds(new Set([messageId]));
      setOpenReactionMessageId(null);
      setOpenActionMessageId(null);
    },
    toggleSelected,
    toggleReactionMenu: (messageId) => {
      setOpenActionMessageId(null);
      setOpenReactionMessageId((current) => current === messageId ? null : messageId);
    },
    closeReactionMenu: () => setOpenReactionMessageId(null),
    openActionMenu: (messageId) => {
      setOpenReactionMessageId(null);
      setOpenActionMessageId(messageId);
    },
    closeActionMenu: () => setOpenActionMessageId(null),
    openGroupReadReceipts: (messageId) => setReadReceiptsMessageId(messageId),
  }), [toggleSelected]);

  const hasJumpToReply = Boolean(onJumpToReply);
  const hasEdit = Boolean(onEdit);
  const hasDelete = Boolean(onDelete);
  const hasHideForMe = Boolean(onHideForMe);
  const hasBulkHideForMe = Boolean(onBulkHideForMe);
  const hasRetrySend = Boolean(onRetrySend);
  const hasEditFailedSend = Boolean(onEditFailedSend);
  const hasDiscardLocalMessage = Boolean(onDiscardLocalMessage);
  const hasTogglePin = Boolean(onTogglePin);
  const hasForward = Boolean(onForward);
  const hasOpenMedia = Boolean(onOpenMedia);
  const rowCapabilities = React.useMemo<MessageRowCapabilities>(() => ({
    jumpToReply: hasJumpToReply,
    edit: hasEdit,
    remove: hasDelete,
    hideForMe: hasHideForMe,
    bulkHideForMe: hasBulkHideForMe,
    retrySend: hasRetrySend,
    editFailedSend: hasEditFailedSend,
    discardLocalMessage: hasDiscardLocalMessage,
    togglePin: hasTogglePin,
    forward: hasForward,
    openMedia: hasOpenMedia,
  }), [
    hasBulkHideForMe, hasDelete, hasDiscardLocalMessage, hasEdit, hasEditFailedSend, hasForward,
    hasHideForMe, hasJumpToReply, hasOpenMedia, hasRetrySend, hasTogglePin,
  ]);

  // Rebuilt whenever a message or a member's read mark changes, which is every
  // new message and every receipt. Each receipt is kept as the object it was
  // whenever it draws the same thing, so a row renders when its own receipt
  // moved: one receipt, or one new message, used to hand every message you had
  // sent a new object and render all of them (D-088).
  const previousReceiptsRef = useRef<{
    delivery: Map<string, MessageDeliveryState | null>;
    groupRead: Map<string, GroupReadReceiptInfo | null>;
  } | null>(null);
  const receiptsByMessageId = React.useMemo(() => {
    const context = { currentUserId: userId, chatType, members: chatMembers, isSavedChat };
    const previous = previousReceiptsRef.current;
    const delivery = new Map<string, MessageDeliveryState | null>();
    const groupRead = new Map<string, GroupReadReceiptInfo | null>();
    for (const message of sortedMessages) {
      const nextDelivery = getMessageDeliveryState(message, context);
      const priorDelivery = previous?.delivery.get(message.id);
      delivery.set(
        message.id,
        priorDelivery !== undefined && sameData(priorDelivery, nextDelivery) ? priorDelivery : nextDelivery,
      );
      const nextGroupRead = getGroupReadReceiptInfo(message, context);
      const priorGroupRead = previous?.groupRead.get(message.id);
      groupRead.set(
        message.id,
        priorGroupRead !== undefined && sameGroupReadReceiptFace(priorGroupRead, nextGroupRead) ? priorGroupRead : nextGroupRead,
      );
    }
    const receipts = { delivery, groupRead };
    previousReceiptsRef.current = receipts;
    return receipts;
  }, [chatMembers, chatType, isSavedChat, sortedMessages, userId]);

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

  const releaseOlderScrollPreservation = useCallback(() => {
    if (olderReleaseFrameRef.current !== null) {
      cancelAnimationFrame(olderReleaseFrameRef.current);
      olderReleaseFrameRef.current = null;
    }
    if (olderSafetyTimeoutRef.current !== null) {
      window.clearTimeout(olderSafetyTimeoutRef.current);
      olderSafetyTimeoutRef.current = null;
    }
    olderHoldActiveRef.current = false;
    olderScrollAnchorRef.current = null;
    olderStartFirstMessageIdRef.current = null;
    olderStartMessageCountRef.current = 0;
    preservingOlderScrollRef.current = false;
  }, []);

  const loadOlderAtTop = useCallback(async () => {
    const el = containerRef.current;
    if (
      !el ||
      !onLoadOlder ||
      loadingOlderRef.current ||
      preservingOlderScrollRef.current ||
      !hasMoreOlderRef.current ||
      initialScrollAppliedRef.current !== initialScrollKey ||
      initialScrollPendingRef.current ||
      isInitialBottomLocked()
    ) return;
    preservingOlderScrollRef.current = true;
    olderScrollAnchorRef.current = captureVisibleMessageAnchor(el);
    olderStartFirstMessageIdRef.current = sortedMessages[0]?.id ?? null;
    olderStartMessageCountRef.current = sortedMessages.length;
    try {
      const result = await onLoadOlder();
      if (result && result.loaded === 0) {
        releaseOlderScrollPreservation();
        return;
      }
      // React applies the prepended page asynchronously. Only start the guard
      // after the request finishes so a slow network cannot release the anchor.
      olderSafetyTimeoutRef.current = window.setTimeout(releaseOlderScrollPreservation, 2_000);
    } catch (error) {
      releaseOlderScrollPreservation();
      throw error;
    }
  }, [initialScrollKey, isInitialBottomLocked, onLoadOlder, releaseOlderScrollPreservation, sortedMessages]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (preservingOlderScrollRef.current) {
      olderScrollAnchorRef.current = captureVisibleMessageAnchor(el) ?? olderScrollAnchorRef.current;
    }
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (isInitialBottomLocked()) {
      isAtBottomRef.current = true;
      setShowScrollBtn(false);
      setNewCount(0);
      return;
    }
    const atBottom = distFromBottom < 120;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setNewCount(0);
    const hasScrollableHistory = el.scrollHeight > el.clientHeight + 240;
    if (
      initialScrollAppliedRef.current === initialScrollKey &&
      !initialScrollPendingRef.current &&
      hasScrollableHistory &&
      el.scrollTop < 160
    ) void loadOlderAtTop();
  }, [initialScrollKey, isInitialBottomLocked, loadOlderAtTop]);

  useLayoutEffect(() => {
    if (!preservingOlderScrollRef.current || !olderScrollAnchorRef.current) return;
    const prepended = sortedMessages.length > olderStartMessageCountRef.current
      && (sortedMessages[0]?.id ?? null) !== olderStartFirstMessageIdRef.current;
    if (!prepended) return;

    const container = containerRef.current;
    if (!container) {
      releaseOlderScrollPreservation();
      return;
    }
    // Restore, then KEEP restoring until the heights stop moving.
    //
    // One restore was not enough. Prepended messages are measured the frame
    // they mount and settle afterwards — text re-wraps, images arrive, the
    // timestamp finds its place — so the position computed at commit time was
    // computed from heights that were about to change. Measured on production,
    // the reader's anchor drifted 1147px while the content grew 6469px, against
    // a contract that allows 3px.
    //
    // The restore is idempotent: it recomputes the correction from where the
    // anchor is now, so repeating it converges rather than accumulating.
    const anchor = olderScrollAnchorRef.current;
    restoreVisibleMessageAnchor(container, anchor);

    let settledFrames = 0;
    olderHoldActiveRef.current = true;
    const hold = () => {
      olderReleaseFrameRef.current = null;
      if (!preservingOlderScrollRef.current) return;
      const el = containerRef.current;
      if (!el) {
        releaseOlderScrollPreservation();
        return;
      }
      const before = el.scrollTop;
      restoreVisibleMessageAnchor(el, anchor);
      // Two consecutive frames that needed no correction mean the layout has
      // stopped moving; the safety timeout ends it either way.
      settledFrames = Math.abs(el.scrollTop - before) <= 1 ? settledFrames + 1 : 0;
      // Four frames rather than two. Measured, the layout looked settled for two
      // frames and then shed 706px on the next one, so a two-frame window
      // released the hold immediately before the change it existed for. The
      // safety timeout still bounds the whole thing.
      if (settledFrames >= 4) {
        releaseOlderScrollPreservation();
        return;
      }
      olderReleaseFrameRef.current = requestAnimationFrame(hold);
    };
    olderReleaseFrameRef.current = requestAnimationFrame(hold);
  }, [releaseOlderScrollPreservation, sortedMessages]);

  releaseOlderScrollPreservationRef.current = releaseOlderScrollPreservation;

  useEffect(() => releaseOlderScrollPreservation, [initialScrollKey, releaseOlderScrollPreservation]);

  /**
   * Put the list at the bottom NOW, with no frame in between.
   *
   * Every correction used to be deferred by at least one `requestAnimationFrame`
   * from a passive effect, which means the browser painted the commit that made
   * the correction necessary before the correction ran. Measured on the real
   * chat, that is exactly what both reports describe: entering a chat painted
   * three frames at `scrollTop = 0` — the top of the loaded history, 2790px from
   * the target — before snapping to the bottom (D-037), and sending a message
   * painted three frames with the new bubble clipped against the composer, 57px
   * below where it belongs, before it jumped into the stream (D-038).
   *
   * Called from a layout effect this runs after React has written the DOM and
   * before the browser paints, so the first frame the reader sees is already the
   * settled one. The anchoring itself is unchanged: same target, same rules, same
   * guards — only the frame it lands on moves.
   */
  const applyBottomNow = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, el.scrollHeight - el.clientHeight), behavior: smooth ? "smooth" : "auto" });
    setNewCount(0);
    setShowScrollBtn(false);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => applyBottomNow(smooth));
  }, [applyBottomNow]);

  const scrollToBottomAfterLayout = useCallback((smooth = false) => {
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        // Two frames after the commit that asked for it, the reader may no
        // longer be meant to be at the bottom. When a list mounts, the inset
        // pass below schedules this before the entry, in the same commit, puts
        // a reader with unread messages on the first of them — and when the
        // header and the composer were already measured, no inset changes
        // afterwards to cancel it. It then arrived a frame later and put the
        // reader at the bottom. Measured on a reopened chat with 24 unread:
        // placed on the first one at 209ms, at the bottom at 288ms (D-089).
        if (isAtBottomRef.current) scrollToBottom(smooth);
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [scrollToBottom]);

  /** The unread entry, placed before paint. Same target as the deferred pass. */
  const applyMessageTopNow = useCallback((messageId: string) => {
    const target = messageRefs?.current[messageId];
    if (!target) return;
    target.scrollIntoView({ behavior: "auto", block: "start" });
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, el.scrollTop - 56);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setNewCount(0);
  }, [messageRefs]);

  const scrollToMessageAfterLayout = useCallback((messageId: string) => {
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => applyMessageTopNow(messageId));
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [applyMessageTopNow]);

  const releaseInitialScrollGuard = useCallback((scrollKey: string, delayMs: number) => {
    window.setTimeout(() => {
      if (initialScrollPendingKeyRef.current !== scrollKey) return;
      initialScrollPendingRef.current = false;
      initialScrollPendingKeyRef.current = null;
    }, delayMs);
  }, []);

  const releaseInitialScrollControl = useCallback(() => {
    initialBottomLockUntilRef.current = 0;
    initialScrollPendingRef.current = false;
    initialScrollPendingKeyRef.current = null;
  }, []);

  /**
   * Any real input from the reader ends both holds.
   *
   * The older-history hold keeps correcting the scroll position for as long as
   * the prepended messages are still settling. Without this it would also
   * correct against the reader's own scrolling and drag them back.
   */
  const releaseScrollControl = useCallback(() => {
    releaseInitialScrollControl();
    if (olderHoldActiveRef.current) releaseOlderScrollPreservationRef.current?.();
  }, [releaseInitialScrollControl]);


  // Keep bottom lock for new messages and typing indicator without pulling
  // users down when they intentionally scrolled up.
  //
  // A layout effect, and instant rather than smooth. The smooth scroll never
  // delivered the correction: measured on a real send it covered 3px in its
  // first 17ms and 3px more by the time an instant write from another path
  // overtook it, so its only observable effect was that the new bubble was
  // painted where it did not belong.
  useLayoutEffect(() => {
    const messageCountChanged = prevMessageCountRef.current !== sortedMessages.length;
    prevMessageCountRef.current = sortedMessages.length;

    // A message YOU sent always takes you to it, whatever the scroll state says.
    //
    // `isAtBottomRef` is written by the scroll handler, so it is a lagging view
    // of where the list is: scroll events are asynchronous, and between two
    // quick sends the composer resizes the container without producing one. A
    // send that arrived while the flag was briefly stale was treated as "new
    // content while the reader is elsewhere" — no scroll, just the counter — so
    // the bubble was painted below the fold, under the composer, and only a
    // later settle pass moved it up. That is why the first send looked right
    // and the second did not.
    //
    // This does not weaken the contract in section 11 of CLAUDE.md. That
    // protects a reader in the history from being yanked to the bottom by
    // OTHER people's messages, and incoming messages still only bump the
    // counter. Your own send is an explicit request to see it.
    //
    // Keyed on the last message's identity rather than the count: loading older
    // history changes the count too, and the last message is still yours, so a
    // count test would force a jump to the bottom in the middle of a prepend —
    // the exact thing the prepend hold exists to prevent.
    const lastMessage = sortedMessages[sortedMessages.length - 1];
    const lastMessageId = lastMessage?.id ?? null;
    const lastMessageChanged = prevLastMessageIdRef.current !== lastMessageId;
    prevLastMessageIdRef.current = lastMessageId;
    const lastActor = lastMessage !== undefined ? resolveMessageActor(lastMessage) : null;
    const lastMessageIsMine = lastActor?.kind === "user" && lastActor.id === userId;
    const iJustSent =
      lastMessageChanged &&
      lastMessageIsMine &&
      !preservingOlderScrollRef.current &&
      !loadingOlderRef.current;

    if (isAtBottomRef.current || iJustSent) {
      applyBottomNow();
    } else if (messageCountChanged && !preservingOlderScrollRef.current && !loadingOlderRef.current) {
      setNewCount((n) => n + 1);
    }
  }, [isTyping, sortedMessages, applyBottomNow, userId]);

  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return undefined;
    // The composer changing height changes this container's own height, so the
    // bottom moves in the same commit. Correct it before that commit is painted,
    // then let the deferred pass absorb whatever settles afterwards.
    applyBottomNow();
    return scrollToBottomAfterLayout(false);
  }, [applyBottomNow, bottomInset, topInset, layoutVersion, scrollToBottomAfterLayout]);

  useEffect(() => {
    const content = contentRef.current;
    const scrollport = containerRef.current;
    if ((!content && !scrollport) || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      const shouldKeepBottom = isAtBottomRef.current || isInitialBottomLocked();
      if (!shouldKeepBottom || preservingOlderScrollRef.current || loadingOlderRef.current) return;
      // Synchronously, inside the callback. A ResizeObserver runs after layout
      // and before paint, so this catches the growth that no React commit can
      // see — the bubble that reflows 24px on its own once the text has wrapped,
      // which is D-032. Deferred by a frame it was painted first and corrected
      // after, and that was the one visible step left on chat entry.
      //
      // This cannot loop: writing `scrollTop` resizes nothing, so it cannot
      // retrigger the observer that is running.
      applyBottomNow();
    });
    if (content) observer.observe(content);
    // The scrollport as well as the content, and border-box on purpose.
    //
    // D-058: on Android the WebView SHRINKS when the keyboard opens, it does not
    // get covered. So `innerHeight - visualViewport.height` is honestly 0, the
    // composer does not move, `layoutVersion` does not change, and the content's
    // height does not change either — measured, `scrollHeight` stayed at 4467
    // through the whole cycle. The one box that moved was this one: 748 to 482.
    // Nothing observed it, so `scrollTop` was left at 3719 while the maximum
    // rose to 3985 and the newest three messages went behind the composer, 242px
    // under its top edge. And no affordance was offered, because `scrollTop`
    // never changed, so no `scroll` event fired and `isAtBottomRef` still said
    // the reader was at the bottom.
    //
    // The whole defect is an asymmetry: GROWING the viewport forces the browser
    // to clamp `scrollTop` down to the new maximum, which is why dismissing the
    // keyboard always looked correct. Shrinking leaves a still-valid `scrollTop`
    // alone, and nothing else was watching.
    //
    // The guard above is the one that matters and it is deliberately the
    // existing one: a reader who was at the bottom is put back at the bottom, a
    // reader who was up in the history is left exactly where they are, because
    // they did not ask to move and the keyboard is not their request to.
    //
    // `border-box`, so this observes the scrollport's own height and not its
    // padding. The padding carries `bottomInset`, which is the composer's
    // measured height, and that already has a layout effect keyed on it — a
    // content-box observation would fire a second time for every composer
    // resize and add nothing.
    if (scrollport) observer.observe(scrollport, { box: "border-box" });
    return () => observer.disconnect();
  }, [applyBottomNow, isInitialBottomLocked]);

  // Initial chat open and chat switch need to wait for composer/tray layout
  // before locking the history to the real visual bottom.
  //
  // The wait still happens — the deferred pass and the settle timers below are
  // unchanged — but the first placement is made here, before the browser paints
  // the commit that mounted the list. A freshly mounted scroll container starts
  // at `scrollTop = 0`, so without this the reader is shown the top of the
  // loaded history first, every single time (D-037).
  useLayoutEffect(() => {
    const hasMessages = sortedMessages.length > 0;
    if (!hasMessages) return undefined;
    if (initialScrollAppliedRef.current === initialScrollKey) return undefined;
    initialScrollAppliedRef.current = initialScrollKey;
    initialScrollPendingRef.current = true;
    initialScrollPendingKeyRef.current = initialScrollKey;
    isAtBottomRef.current = true;
    prevMessageCountRef.current = sortedMessages.length;
    setNewCount(0);
    setShowScrollBtn(false);
    if (firstUnreadMessageId) {
      initialBottomLockUntilRef.current = 0;
      isAtBottomRef.current = false;
      releaseInitialScrollGuard(initialScrollKey, 520);
      applyMessageTopNow(firstUnreadMessageId);
      const cancelUnreadFrame = scrollToMessageAfterLayout(firstUnreadMessageId);
      return () => cancelUnreadFrame();
    }
    initialBottomLockUntilRef.current = Date.now() + 4200;
    applyBottomNow();
    const cancelFrame = scrollToBottomAfterLayout(false);
    const scheduleBottomSettle = (delay: number) => window.setTimeout(() => {
      if (initialScrollAppliedRef.current !== initialScrollKey) return;
      if (!isInitialBottomLocked()) return;
      scrollToBottom(false);
    }, delay);
    [120, 320, 680, 1200, 1750, 2600, 3600, 4150].forEach(scheduleBottomSettle);
    releaseInitialScrollGuard(initialScrollKey, 4300);
    return () => {
      cancelFrame();
    };
  }, [applyBottomNow, applyMessageTopNow, isInitialBottomLocked, initialScrollKey, firstUnreadMessageId, sortedMessages.length, scrollToBottom, scrollToBottomAfterLayout, scrollToMessageAfterLayout, releaseInitialScrollGuard]);

  const resolvedBottomInset = Math.max(0, bottomInset);
  const resolvedTopInset = Math.max(0, topInset);

  return (
    <div
      className="relative flex-1 min-h-0 min-w-0 overflow-hidden"
      style={{
        // Painted before the chrome that frosts over it, and the mechanism is
        // this box's position in the markup — nothing in this style.
        //
        // The list runs the full height of the pane, behind the header and the
        // composer, so a blur over either has messages to sample instead of a
        // flat page. All three are positioned boxes with `z-index: auto`, so
        // the one that paints on top is simply the one that comes last: the
        // caller must render this list *before* the chrome. `ChatWindow` and
        // the DEV capture page both do, and `tests/e2e/chat-glass-layout.spec`
        // measures it in Chromium and WebKit.
        //
        // This used to be `order: -1` with the chrome first instead. `order`
        // moves a flex item's paint position in Chromium, but WebKit does not
        // apply it to positioned boxes at all — measured on Safari 26.4, the
        // header was painted under the conversation at every width and the
        // only way out of a chat on an iPhone could not be tapped (D-062).
        //
        // A `z-index` here is not the alternative: it would make this box a
        // stacking context and clamp the `fixed` overlays it hosts — the
        // read-receipts dialog, the selection bar on a phone, a bubble's
        // context menu — inside it. That is the defect `KubGlassLayer`,
        // `AppTopBar` and `MediaViewer` each carry a note about.
        //
        // The overlays below hang off this box's edges, and those edges are now
        // under the chrome. They read the insets from here rather than take
        // them as props so the offsets stay in the class that owns them.
        "--kub-list-top-inset": `${resolvedTopInset}px`,
        "--kub-list-bottom-inset": `${resolvedBottomInset}px`,
      } as React.CSSProperties}
    >
      {onBulkHideForMe && selectionMode && (
        <div className="fixed bottom-[calc(4.75rem+var(--kub-safe-bottom))] left-3 right-3 z-[70] flex items-center justify-between gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]/95 p-2 shadow-lg backdrop-blur sm:absolute sm:bottom-auto sm:left-auto sm:right-3 sm:top-[calc(var(--kub-list-top-inset,0px)+0.5rem)] sm:w-auto sm:justify-start sm:p-1.5">
          <span className="px-2 text-xs font-semibold text-[color:var(--kub-muted)]">
            Выбрано: {selectedMessages.length}
          </span>
          <button
            type="button"
            onClick={handleBulkHideForMe}
            disabled={selectedMessages.length === 0 || bulkDeleting}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:opacity-40",
              bulkConfirmAction === "hide" ? "bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-danger-text)]",
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
                bulkConfirmAction === "delete" ? "bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-danger-text)]",
              )}
            >
              <KubIcon name="delete" size={14} />
              {bulkDeleting && bulkConfirmAction === "delete" ? "Удаляем..." : "Удалить для всех"}
            </button>
          )}
          <button
            type="button"
            onClick={cancelSelection}
            className="inline-flex h-8 items-center justify-center rounded-lg px-2 text-xs font-semibold text-[color:var(--kub-muted)] kub-raise-hover"
          >
            Отмена
          </button>
        </div>
      )}
      {bulkError && (
        <div className="absolute left-3 right-3 top-[calc(var(--kub-list-top-inset,0px)+3.5rem)] z-20 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[var(--kub-surface)]/95 px-3 py-2 text-xs text-[color:var(--kub-danger-text)] shadow-lg backdrop-blur">
          {bulkError}
        </div>
      )}
      <div
        ref={containerRef}
        data-testid="message-scroll-container"
        data-has-more-older={hasMoreOlder ? "true" : "false"}
        data-loading-older={loadingOlder ? "true" : "false"}
        onScroll={handleScroll}
        onPointerDown={releaseScrollControl}
        onTouchStart={releaseScrollControl}
        onWheel={releaseScrollControl}
        // A reader who moves with the keyboard is asking to be left alone just
        // as much as one who uses the wheel. Without this, PageUp, Home, the
        // arrows and space scroll the list while the entry lock stays armed —
        // and an armed lock makes `handleScroll` assert "at bottom" without
        // measuring, so the next thing that settles the layout pulls them back
        // down. Every other pointing device released it; the keyboard did not.
        onKeyDown={(event) => {
          if (SCROLLING_KEYS.has(event.key)) releaseScrollControl();
        }}
        onClickCapture={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-reaction-menu], [data-reaction-trigger]")) return;
          if (target?.closest("[data-action-menu]")) return;
          if (openReactionMessageId) setOpenReactionMessageId(null);
          if (openActionMessageId) setOpenActionMessageId(null);
        }}
        className="chat-bg h-full min-w-0 overflow-y-auto overflow-x-hidden px-3 py-2 pb-6 [overflow-anchor:none] sm:px-4"
        // Padding and scroll-padding move together, on both edges.
        //
        // The padding is what keeps the conversation out from under the chrome
        // that now runs over it. The scroll-padding is what keeps every
        // programmatic scroll honest: `scrollIntoView` aligns to the scrollport,
        // and without this the search jump, the reply jump and the first-unread
        // entry would all deliver their target to an edge the chrome covers —
        // arriving, by the browser's account, exactly where it was asked to.
        // That is the quiet way this change could have broken everything.
        style={{
          paddingTop: `calc(0.5rem + ${resolvedTopInset}px)`,
          scrollPaddingTop: `calc(0.5rem + ${resolvedTopInset}px)`,
          paddingBottom: `calc(1.5rem + ${resolvedBottomInset}px)`,
          scrollPaddingBottom: `calc(1.5rem + ${resolvedBottomInset}px)`,
        }}
      >
        <div ref={contentRef} className="[overflow-anchor:none]">
          {(loadingOlder || olderError) && (
            <div className="flex justify-center py-2" data-message-history-status>
              <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kub-border-color)] px-3 py-1 text-xs text-[color:var(--kub-muted)]">
                {loadingOlder && <KubIcon name="spinner" size={12} />}
                {olderError ?? "Загружаем историю..."}
              </span>
            </div>
          )}

          {sortedMessages.map((msg, idx) => {
          const prev = idx > 0 ? sortedMessages[idx - 1] : null;
          const next = idx < sortedMessages.length - 1 ? sortedMessages[idx + 1] : null;
          const showDate = shouldShowDateSeparator(prev, msg);
          const actor = resolveMessageActor(msg);
          const actorKey = messageActorGroupingKey(msg);
          const isMe = actor.kind === "user" && actor.id === userId;
          const isSameSenderAsPrev = !showDate && prev !== null && messageActorGroupingKey(prev) === actorKey;
          const isSameSenderAsNext = next !== null && messageActorGroupingKey(next) === actorKey &&
            !shouldShowDateSeparator(msg, next);

          return (
            <MessageRow
              // Keyed by what survives the optimistic swap, not by the row id.
              //
              // A message you send is rendered twice under two ids: first as
              // `tmp:<client id>`, then as the server row. With the id as the
              // key those are two different DOM nodes, so the whole row is torn
              // down and mounted again — and the second mount re-runs the
              // bubble's meta measurement from its initial guess. That guess is
              // `inline`; the answer for an own message is `anchored`, one row
              // taller. Measured on the real chat with a witness row sampled
              // every animation frame, that replay moved the entire
              // conversation +15px and then -15px, a quarter of a second after
              // the message had already settled — a twitch with nothing behind
              // it, because nothing about the message had changed.
              //
              // `messageEntranceKey` is `client_message_id` when there is one,
              // which is the single value both sides of the swap share, and the
              // id otherwise. The store dedupes by the same value, so two rows
              // can never hold one key.
              key={messageEntranceKey(msg)}
              msg={msg}
              userId={userId}
              isMe={isMe}
              isFirstInGroup={!isSameSenderAsPrev}
              isLastInGroup={!isSameSenderAsNext}
              // The label rather than a flag. "Сегодня" turns into "Вчера" at
              // midnight with nothing about the message changing, and a memoised
              // row only renders again when one of its props does.
              dateLabel={showDate ? getMessageDayLabel(msg.created_at) : null}
              isFirstUnread={msg.id === firstUnreadMessageId}
              highlighted={highlightedId === msg.id}
              isEntering={enteringKeys.has(messageEntranceKey(msg))}
              selectionMode={selectionMode}
              selected={selectionMode && selectedIds.has(msg.id)}
              reactionMenuOpen={openReactionMessageId === msg.id}
              actionMenuOpen={openActionMessageId === msg.id}
              replyTarget={msg.reply_to_id ? messagesMap[msg.reply_to_id] : undefined}
              mediaVariant={messageMediaVariants[msg.id]}
              senderAvatarVariant={msg.sender?.id ? senderAvatarVariants[msg.sender.id] : undefined}
              deliveryState={receiptsByMessageId.delivery.get(msg.id) ?? null}
              groupReadInfo={receiptsByMessageId.groupRead.get(msg.id) ?? null}
              isSavedChat={isSavedChat}
              myRole={myRole}
              messageRefs={messageRefs}
              capabilities={rowCapabilities}
              actions={rowActions}
            />
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
      </div>

      {showScrollBtn && (
        <button
          onClick={() => scrollToBottom(true)}
          aria-label="К последним сообщениям"
          className="absolute bottom-[calc(var(--kub-list-bottom-inset,0px)+1rem)] right-4 w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 z-10 bg-[var(--kub-surface)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)] hover:text-[color:var(--kub-cyan)] kub-glow-soft"
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

/** Everything a row can ask the list to do. One object for the life of the list. */
interface MessageRowActions {
  reply: (message: MessageWithSender) => void;
  jumpToReply: (messageId: string) => void;
  reaction: (messageId: string, emoji: string) => void;
  edit: (message: MessageWithSender) => void;
  remove: (message: MessageWithSender) => void;
  hideForMe: (message: MessageWithSender) => void;
  retrySend: (message: MessageWithSender) => void;
  editFailedSend: (message: MessageWithSender) => void;
  discardLocalMessage: (message: MessageWithSender) => void;
  togglePin: (message: MessageWithSender) => void;
  forward: (message: MessageWithSender) => void;
  openMedia: (media: MediaViewerItem) => void;
  startSelection: (messageId: string) => void;
  toggleSelected: (messageId: string) => void;
  toggleReactionMenu: (messageId: string) => void;
  closeReactionMenu: () => void;
  openActionMenu: (messageId: string) => void;
  closeActionMenu: () => void;
  openGroupReadReceipts: (messageId: string) => void;
}

/**
 * Which optional handlers the list was given.
 *
 * Presence decides what a bubble offers — no `onEdit`, no «Изменить» — so it has
 * to reach the row. As booleans it compares by value, where the handlers
 * themselves are new arrows on every render of the caller.
 */
interface MessageRowCapabilities {
  jumpToReply: boolean;
  edit: boolean;
  remove: boolean;
  hideForMe: boolean;
  bulkHideForMe: boolean;
  retrySend: boolean;
  editFailedSend: boolean;
  discardLocalMessage: boolean;
  togglePin: boolean;
  forward: boolean;
  openMedia: boolean;
}

interface MessageRowProps {
  msg: MessageWithSender;
  userId: string | null;
  isMe: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  dateLabel: string | null;
  isFirstUnread: boolean;
  highlighted: boolean;
  isEntering: boolean;
  selectionMode: boolean;
  selected: boolean;
  reactionMenuOpen: boolean;
  actionMenuOpen: boolean;
  replyTarget: MessageWithSender | undefined;
  mediaVariant: MessageMediaVariantUrls | undefined;
  senderAvatarVariant: AvatarVariantUrls | undefined;
  deliveryState: MessageDeliveryState | null;
  groupReadInfo: GroupReadReceiptInfo | null;
  isSavedChat: boolean | undefined;
  myRole: "owner" | "admin" | "member" | null | undefined;
  messageRefs: React.MutableRefObject<Record<string, HTMLDivElement>> | undefined;
  capabilities: MessageRowCapabilities;
  actions: MessageRowActions;
}

/** A local send offers no reply and no reaction. One function, so it compares equal. */
const NOOP = () => undefined;

const EMPTY_MESSAGES_MAP: Record<string, MessageWithSender> = {};

/**
 * The bubble, memoised. `MessageRow` below already skips a render that changes
 * nothing about its message; this also skips one that changes only the row
 * around the bubble — a date label, the jump highlight, the unread separator.
 */
const MemoizedMessageBubble = React.memo(MessageBubble);

/**
 * One message of the conversation, memoised on props that stay `Object.is`
 * equal while the message and what it may do are unchanged — see `rowActions`
 * in `MessageList` for how the list keeps them that way.
 */
const MessageRow = React.memo(function MessageRow({
  msg,
  userId,
  isMe,
  isFirstInGroup,
  isLastInGroup,
  dateLabel,
  isFirstUnread,
  highlighted,
  isEntering,
  selectionMode,
  selected,
  reactionMenuOpen,
  actionMenuOpen,
  replyTarget,
  mediaVariant,
  senderAvatarVariant,
  deliveryState,
  groupReadInfo,
  isSavedChat,
  myRole,
  messageRefs,
  capabilities,
  actions,
}: MessageRowProps) {
  const isSystemMessage = msg.type === "system";
  const canUseHumanControls = canUseHumanMessageControls(msg, userId);
  const canSelect = !msg.deleted_at && !isSystemMessage;
  const isLocalSend = msg.id.startsWith("tmp:") || Boolean(msg.pending || msg.checking || msg.failed);
  const hasGroupReadInfo = groupReadInfo !== null;

  // Once per message rather than once per render, so the bubble's memo sees the
  // same functions until the message, or what it may do, changes.
  const handlers = React.useMemo(() => ({
    onReply: isLocalSend ? NOOP : () => actions.reply(msg),
    onReaction: isLocalSend ? NOOP : (emoji: string) => actions.reaction(msg.id, emoji),
    onEdit: !isLocalSend && canUseHumanControls && capabilities.edit ? () => actions.edit(msg) : undefined,
    onDelete: !isLocalSend && canUseHumanControls && capabilities.remove ? () => actions.remove(msg) : undefined,
    onHideForMe: !isLocalSend && capabilities.hideForMe ? () => actions.hideForMe(msg) : undefined,
    onRetrySend: capabilities.retrySend && msg.failed ? () => actions.retrySend(msg) : undefined,
    onEditFailedSend: capabilities.editFailedSend && msg.failed ? () => actions.editFailedSend(msg) : undefined,
    onDiscardLocalMessage: capabilities.discardLocalMessage && isLocalSend
      ? () => actions.discardLocalMessage(msg)
      : undefined,
    onStartSelection: capabilities.bulkHideForMe && canSelect ? () => actions.startSelection(msg.id) : undefined,
    onTogglePin: !isLocalSend && capabilities.togglePin ? () => actions.togglePin(msg) : undefined,
    onForward: !isLocalSend && capabilities.forward ? () => actions.forward(msg) : undefined,
    onToggleReactionMenu: () => actions.toggleReactionMenu(msg.id),
    onOpenActionMenu: () => actions.openActionMenu(msg.id),
    onOpenGroupReadReceipts: hasGroupReadInfo ? () => actions.openGroupReadReceipts(msg.id) : undefined,
  }), [actions, canSelect, canUseHumanControls, capabilities, hasGroupReadInfo, isLocalSend, msg]);

  // The one entry a reply preview reads. The whole map is rebuilt whenever any
  // message changes, and handing it down re-rendered every row on each arrival.
  const replyMap = React.useMemo(
    () => (msg.reply_to_id && replyTarget ? { [msg.reply_to_id]: replyTarget } : EMPTY_MESSAGES_MAP),
    [msg.reply_to_id, replyTarget],
  );

  return (
    <div
      data-message-id={msg.id}
      ref={(el) => { if (el && messageRefs) messageRefs.current[msg.id] = el; }}
      className={cn(
        highlighted &&
          "transition-colors duration-500 rounded-lg bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]"
      )}
    >
      {dateLabel !== null && (
        <div className="flex justify-center my-3" data-message-date-separator={getMessageDayKey(msg.created_at)}>
          <span className="px-3 py-1 rounded-full text-xs select-none text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]">
            {dateLabel}
          </span>
        </div>
      )}
      {isFirstUnread && (
        <div className="unread-separator my-3 flex items-center justify-center" data-testid="first-unread-separator">
          {/* The pink tint went with the blur, and the border keeps the
              signal. A tinted fill under coloured words is the shape of
              the ops-report callout in rule 10: a backdrop moved toward
              the text's own colour costs contrast and says nothing the
              border does not already say. */}
          <span className="rounded-full border border-[color-mix(in_srgb,var(--kub-pink)_35%,var(--kub-border-color))] px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--kub-pink)]">
            Новые сообщения
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
              actions.toggleSelected(msg.id);
            }}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
              selected
                ? "border-[var(--kub-cyan)] bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-[color:var(--kub-muted)]"
            )}
            aria-label={selected ? "Снять выбор" : "Выбрать сообщение"}
          >
            {selected && <KubIcon name="check" size={14} />}
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
            actions.toggleSelected(msg.id);
          }}
          aria-disabled={selectionMode && !canSelect}
        >
          <MemoizedMessageBubble
            message={msg}
            isEntering={isEntering}
            isMe={isMe}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            onReply={handlers.onReply}
            onJumpToReply={capabilities.jumpToReply ? actions.jumpToReply : undefined}
            onReaction={handlers.onReaction}
            onEdit={handlers.onEdit}
            onDelete={handlers.onDelete}
            onHideForMe={handlers.onHideForMe}
            onRetrySend={handlers.onRetrySend}
            onEditFailedSend={handlers.onEditFailedSend}
            onDiscardLocalMessage={handlers.onDiscardLocalMessage}
            onStartSelection={handlers.onStartSelection}
            onTogglePin={handlers.onTogglePin}
            onForward={handlers.onForward}
            onOpenMedia={capabilities.openMedia ? actions.openMedia : undefined}
            reactionMenuOpen={reactionMenuOpen}
            onToggleReactionMenu={handlers.onToggleReactionMenu}
            onCloseReactionMenu={actions.closeReactionMenu}
            actionMenuOpen={actionMenuOpen}
            onOpenActionMenu={handlers.onOpenActionMenu}
            onCloseActionMenu={actions.closeActionMenu}
            selected={selected}
            isSelectionMode={selectionMode}
            messagesMap={replyMap}
            mediaVariant={mediaVariant}
            senderAvatarVariant={senderAvatarVariant}
            deliveryState={deliveryState}
            groupReadInfo={groupReadInfo}
            onOpenGroupReadReceipts={handlers.onOpenGroupReadReceipts}
            isSavedChat={isSavedChat}
            myRole={myRole}
          />
        </div>
      </div>
      )}
    </div>
  );
});

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
