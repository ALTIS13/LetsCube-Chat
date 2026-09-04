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
import { getMessageDeliveryState } from "@/lib/messageDelivery";
import { getGroupReadReceiptInfo, getReceiptDisplayName, type GroupReadReceiptInfo } from "@/lib/groupReadReceipts";
import { requestAppConfirm } from "@/lib/appDialogs";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { formatFullTime } from "@/lib/format";
import { useAvatarVariantUrls, useMessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { advanceMessageEntrance, EMPTY_ENTRANCE_STATE } from "@/lib/messageEntrance";
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
  bottomInset?: number;
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
  const entranceRef = React.useRef(EMPTY_ENTRANCE_STATE);
  const enteringIds = React.useMemo(() => {
    const { state, entering } = advanceMessageEntrance(
      entranceRef.current,
      sortedMessages.map((m) => m.id),
    );
    entranceRef.current = state;
    return entering;
  }, [sortedMessages]);
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

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: Math.max(0, el.scrollHeight - el.clientHeight), behavior: smooth ? "smooth" : "auto" });
      setNewCount(0);
      setShowScrollBtn(false);
    });
  }, []);

  const scrollToBottomAfterLayout = useCallback((smooth = false) => {
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => scrollToBottom(smooth));
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [scrollToBottom]);

  const scrollToMessageAfterLayout = useCallback((messageId: string) => {
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        const target = messageRefs?.current[messageId];
        if (!target) return;
        target.scrollIntoView({ behavior: "auto", block: "start" });
        const el = containerRef.current;
        if (el) {
          el.scrollTop = Math.max(0, el.scrollTop - 56);
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          isAtBottomRef.current = atBottom;
          setShowScrollBtn(!atBottom);
          if (atBottom) setNewCount(0);
        }
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [messageRefs]);

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
    if (!isAtBottomRef.current) return undefined;
    return scrollToBottomAfterLayout(false);
  }, [bottomInset, layoutVersion, scrollToBottomAfterLayout]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const shouldKeepBottom = isAtBottomRef.current || isInitialBottomLocked();
      if (!shouldKeepBottom || preservingOlderScrollRef.current || loadingOlderRef.current) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => scrollToBottom(false));
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [isInitialBottomLocked, scrollToBottom]);

  // Initial chat open and chat switch need to wait for composer/tray layout
  // before locking the history to the real visual bottom.
  useEffect(() => {
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
      const cancelUnreadFrame = scrollToMessageAfterLayout(firstUnreadMessageId);
      return () => cancelUnreadFrame();
    }
    initialBottomLockUntilRef.current = Date.now() + 4200;
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
  }, [isInitialBottomLocked, initialScrollKey, firstUnreadMessageId, sortedMessages.length, scrollToBottom, scrollToBottomAfterLayout, scrollToMessageAfterLayout, releaseInitialScrollGuard]);

  const resolvedBottomInset = Math.max(0, bottomInset);

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
        style={{
          paddingBottom: `calc(1.5rem + ${resolvedBottomInset}px)`,
          scrollPaddingBottom: `calc(1.5rem + ${resolvedBottomInset}px)`,
        }}
      >
        <div ref={contentRef} className="[overflow-anchor:none]">
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
          const actor = resolveMessageActor(msg);
          const actorKey = messageActorGroupingKey(msg);
          const isMe = actor.kind === "user" && actor.id === userId;
          const isSameSenderAsPrev = !showDate && prev !== null && messageActorGroupingKey(prev) === actorKey;
          const isSameSenderAsNext = next !== null && messageActorGroupingKey(next) === actorKey &&
            !shouldShowDateSeparator(msg, next);
          const isSystemMessage = msg.type === "system";
          const canUseHumanControls = canUseHumanMessageControls(msg, userId);

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
              data-message-id={msg.id}
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
              {msg.id === firstUnreadMessageId && (
                <div className="unread-separator my-3 flex items-center justify-center" data-testid="first-unread-separator">
                  <span className="rounded-full border border-[color-mix(in_srgb,var(--kub-pink)_35%,var(--kub-border-color))] bg-[color-mix(in_srgb,var(--kub-bg)_82%,var(--kub-pink)_8%)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--kub-pink)] backdrop-blur-sm">
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
                    isEntering={enteringIds.has(msg.id)}
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
                    onEdit={!isLocalSend && canUseHumanControls && onEdit ? () => onEdit(msg) : undefined}
                    onDelete={!isLocalSend && canUseHumanControls && onDelete ? () => onDelete(msg) : undefined}
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
                    messagesMap={messagesMap}
                    mediaVariant={messageMediaVariants[msg.id]}
                    senderAvatarVariant={msg.sender?.id ? senderAvatarVariants[msg.sender.id] : undefined}
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
