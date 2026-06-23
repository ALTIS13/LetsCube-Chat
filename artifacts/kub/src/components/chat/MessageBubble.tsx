"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MessageWithSender } from "@/types/database";
import { formatFullTime } from "@/lib/format";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import type { AvatarVariantUrls, MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { AudioMessage } from "./AudioMessage";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import { FormattedText, isLocationPreviewMessage } from "@/lib/formatText";
import { KubIcon, type KubIconName } from "@/components/kub";
import type { MediaViewerItem } from "./MediaViewer";
import { useChatMediaPlayback, VideoCircleProgressRing, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import { requestAppConfirm } from "@/lib/appDialogs";
import type { MessageDeliveryState } from "@/lib/messageDelivery";
import {
  getGroupReadReceiptAriaLabel,
  getGroupReadReceiptCompactLabel,
  type GroupReadReceiptInfo,
} from "@/lib/groupReadReceipts";
import { formatReplyMessagePreview } from "@/lib/messagePreview";

const EMOJI_QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉"];

interface ContextItem {
  icon: KubIconName;
  label: string;
  danger?: boolean;
  action: () => void;
}

type TextLayoutKind = "short" | "regular" | "link" | "longToken" | "preformatted" | "media";
type MetaPlacement = "inline" | "anchored";

interface MessageBubbleProps {
  message: MessageWithSender;
  isMe: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  onReply: () => void;
  onJumpToReply?: (messageId: string) => void;
  onReaction: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onHideForMe?: () => void;
  onStartSelection?: () => void;
  onTogglePin?: () => void;
  onForward?: () => void;
  onRetrySend?: () => void;
  onEditFailedSend?: () => void;
  onDiscardLocalMessage?: () => void;
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
  mediaVariant?: MessageMediaVariantUrls;
  senderAvatarVariant?: AvatarVariantUrls;
  deliveryState?: MessageDeliveryState | null;
  groupReadInfo?: GroupReadReceiptInfo | null;
  onOpenGroupReadReceipts?: () => void;
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
  if (isLocationPreviewMessage(content)) return "short";
  if (hasUrl) return "link";
  if (longestToken >= 34) return "longToken";
  if (text.length >= 8 && /\s/.test(text)) return "regular";
  return "short";
}

function getMessageWidthClasses(kind: TextLayoutKind): { stack: string; bubble: string; text: string } {
  switch (kind) {
    case "link":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(64vw,580px)] md:max-w-[min(52vw,580px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:anywhere] [word-break:break-word]",
      };
    case "preformatted":
      return {
        stack: "w-[min(86vw,54rem)] max-w-[86vw] sm:w-[min(74vw,54rem)] md:w-[min(70vw,54rem)]",
        bubble: "w-full",
        text: "overflow-x-auto font-mono text-[13px] leading-snug [overflow-wrap:anywhere] [tab-size:2]",
      };
    case "longToken":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(60vw,580px)] md:max-w-[min(52vw,580px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:anywhere] [word-break:break-word]",
      };
    case "regular":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(70vw,560px)] md:max-w-[min(56vw,560px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:break-word] [word-break:normal]",
      };
    case "short":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(72vw,680px)] md:max-w-[min(65vw,680px)]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:break-word] [word-break:normal]",
      };
    case "media":
    default:
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(72vw,680px)] md:max-w-[min(65vw,680px)]",
        bubble: "w-fit",
        text: "[overflow-wrap:break-word] [word-break:normal]",
      };
  }
}

function getMessageStackStyle(kind: TextLayoutKind): CSSProperties | undefined {
  switch (kind) {
    case "link":
    case "longToken":
      return { maxWidth: "min(86vw, 580px)" };
    case "regular":
      return { maxWidth: "min(86vw, 560px)" };
    default:
      return undefined;
  }
}

function clampReplyPreviewText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  return `${chars.slice(0, Math.max(1, maxLength - 3)).join("")}...`;
}

function getCompactReplyPreviewCap(replyBody: string): { chars: number; maxWidth: string } {
  const length = Array.from(replyBody.replace(/\s+/g, " ").trim()).length;

  if (length <= 6) {
    return { chars: 12, maxWidth: "min(100%, 108px, 13ch)" };
  }

  if (length <= 12) {
    return { chars: 14, maxWidth: "min(100%, 116px, 14ch)" };
  }

  return { chars: 16, maxWidth: "min(100%, 124px, 16ch)" };
}

function shouldJustifyOrdinaryText(content: string): boolean {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text || isLocationPreviewMessage(content) || /\bhttps?:\/\/\S+/.test(text) || /```[\s\S]*```/.test(content)) {
    return false;
  }

  const words = text.split(/\s+/).filter(Boolean);
  const longestToken = words.reduce((max, token) => Math.max(max, token.length), 0);
  if (longestToken >= 34 || words.length < 10 || text.length < 72) return false;

  return true;
}

function getInitialMetaPlacement(content: string): MetaPlacement {
  const text = content.trim();
  if (!text) return "inline";
  if (isLocationPreviewMessage(content)) return "inline";
  if (/[\r\n]/.test(content)) return "anchored";
  return text.length <= 56 ? "inline" : "anchored";
}

function canRenderCompactReplyInline(message: MessageWithSender, kind: TextLayoutKind, hasReactions: boolean): boolean {
  if (!message.reply_to_id || hasReactions || message.failed) return false;
  if (message.type !== "text" || kind !== "short") return false;
  const text = (message.content ?? "").trim();
  return Boolean(text) && !/[\r\n]/.test(text) && text.length <= 24;
}

function parsePixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTextLineRects(contentEl: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(contentEl);
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));
  range.detach();

  const lines: Array<{ top: number; right: number; bottom: number; left: number }> = [];
  for (const rect of rects) {
    const rectCenter = (rect.top + rect.bottom) / 2;
    const line = lines.find((candidate) => {
      const candidateCenter = (candidate.top + candidate.bottom) / 2;
      return Math.abs(candidateCenter - rectCenter) <= Math.max(4, Math.min(candidate.bottom - candidate.top, rect.height) * 0.7);
    });

    if (line) {
      line.top = Math.min(line.top, rect.top);
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.left = Math.min(line.left, rect.left);
    } else {
      lines.push({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
    }
  }

  return lines
    .sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top))
    .map((line) => new DOMRect(line.left, line.top, line.right - line.left, line.bottom - line.top));
}

function getTextRightLimit(textEl: HTMLElement, bubbleEl: HTMLElement, stackEl: HTMLElement | null): number {
  const textRect = textEl.getBoundingClientRect();
  const bubbleRect = bubbleEl.getBoundingClientRect();
  const bubbleStyle = getComputedStyle(bubbleEl);
  const paddingLeft = parsePixelValue(bubbleStyle.paddingLeft) ?? 0;
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;
  const currentContentRight = bubbleRect.right - paddingRight;
  const stackMaxWidth = stackEl ? parsePixelValue(getComputedStyle(stackEl).maxWidth) : null;
  const maxContentWidth = stackMaxWidth
    ? Math.max(textRect.width, stackMaxWidth - paddingLeft - paddingRight)
    : textRect.width;
  const maxRightFromText = textRect.left + maxContentWidth;
  const viewportRight = typeof window === "undefined" ? maxRightFromText : window.innerWidth - 8;
  return Math.min(Math.max(currentContentRight, maxRightFromText), viewportRight);
}

function getBubbleInnerRight(bubbleEl: HTMLElement): number {
  const bubbleRect = bubbleEl.getBoundingClientRect();
  const bubbleStyle = getComputedStyle(bubbleEl);
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;
  return bubbleRect.right - paddingRight;
}

function isFooterOnLastTextLine(lastLine: DOMRect, footerRect: DOMRect): boolean {
  const lineCenter = (lastLine.top + lastLine.bottom) / 2;
  const footerCenter = (footerRect.top + footerRect.bottom) / 2;
  return Math.abs(lineCenter - footerCenter) <= Math.max(8, lastLine.height * 0.75);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface MeasuredTextWithMetaProps {
  content: string;
  textClassName: string;
  meta?: ReactNode;
  bubbleRef: React.RefObject<HTMLDivElement | null>;
  stackRef: React.RefObject<HTMLDivElement | null>;
  measureKey: string;
  compound?: boolean;
}

function MeasuredTextWithMeta({
  content,
  textClassName,
  meta,
  bubbleRef,
  stackRef,
  measureKey,
  compound = false,
}: MeasuredTextWithMetaProps) {
  const [placement, setPlacement] = useState<MetaPlacement>(() => getInitialMetaPlacement(content));
  const textFlowRef = useRef<HTMLParagraphElement | null>(null);
  const textContentRef = useRef<HTMLSpanElement | null>(null);
  const footerRef = useRef<HTMLSpanElement | null>(null);
  const blockedInlineSignatureRef = useRef<string | null>(null);
  const hasMeta = meta !== null && meta !== undefined && meta !== false;

  const measure = useCallback(() => {
    const textEl = textFlowRef.current;
    const contentEl = textContentRef.current;
    const footerEl = footerRef.current;
    const bubbleEl = bubbleRef.current;
    if (!hasMeta || !textEl || !contentEl || !footerEl || !bubbleEl) return;

    const lineRects = getTextLineRects(contentEl);
    const lastLine = lineRects.at(-1) ?? null;
    if (!lastLine) {
      setPlacement((current) => (current === "inline" ? current : "inline"));
      return;
    }

    const footerRect = footerEl.getBoundingClientRect();
    const bubbleInnerRight = getBubbleInnerRight(bubbleEl);
    const rightLimit = compound ? bubbleInnerRight : getTextRightLimit(textEl, bubbleEl, stackRef.current);
    const gap = 8;
    const signature = [
      compound ? "compound" : "simple",
      lineRects.length,
      Math.round(textEl.getBoundingClientRect().width),
      Math.round(footerRect.width),
      Math.round(rightLimit),
      Math.round(lastLine.left),
      Math.round(lastLine.right),
    ].join("|");

    if (placement === "inline" && !isFooterOnLastTextLine(lastLine, footerRect)) {
      blockedInlineSignatureRef.current = signature;
      setPlacement((previous) => (previous === "anchored" ? previous : "anchored"));
      return;
    }

    const available = rightLimit - lastLine.right;
    const singleLineText = lineRects.length <= 1;
    const canInline =
      singleLineText &&
      available >= footerRect.width + gap &&
      blockedInlineSignatureRef.current !== signature;
    const next: MetaPlacement = canInline ? "inline" : "anchored";

    setPlacement((previous) => (previous === next ? previous : next));
  }, [bubbleRef, compound, hasMeta, placement, stackRef]);

  useEffect(() => {
    blockedInlineSignatureRef.current = null;
    setPlacement(getInitialMetaPlacement(content));
  }, [content, measureKey]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    schedule();
    const secondFrame = window.requestAnimationFrame(schedule);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    [textFlowRef.current, textContentRef.current, footerRef.current, bubbleRef.current, stackRef.current]
      .filter(Boolean)
      .forEach((node) => observer?.observe(node as Element));
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule).catch(() => undefined);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [bubbleRef, measure, measureKey, placement, stackRef]);

  const footerClassName = "inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none";

  return (
    <div
      data-message-text-meta-group="true"
      data-message-meta-placement={placement}
      className={cn(
        "relative max-w-full min-w-0",
        placement === "inline" ? "w-fit self-start" : "w-full"
      )}
    >
      <p
        ref={textFlowRef}
        data-message-text-flow="true"
        className={cn(textClassName, placement === "inline" && "w-fit")}
      >
        <span ref={textContentRef} data-message-text-content="true">
          <FormattedText content={content} />
        </span>
        {hasMeta && placement === "inline" && (
          <span
            ref={footerRef}
            data-message-footer="true"
            className={cn(footerClassName, "ml-1.5 translate-y-[1px] [vertical-align:-0.12em]")}
          >
            {meta}
          </span>
        )}
      </p>
      {hasMeta && placement === "anchored" && (
        <div
          data-message-bottom-meta="true"
          className="mt-0.5 flex max-w-full items-center justify-end leading-none"
        >
          <span ref={footerRef} data-message-footer="true" className={footerClassName}>
            {meta}
          </span>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({
  message, isMe, isFirstInGroup, isLastInGroup,
  onReply, onJumpToReply, onReaction, onEdit, onDelete, onHideForMe, onStartSelection, onTogglePin, onForward, onOpenMedia,
  onRetrySend, onEditFailedSend, onDiscardLocalMessage,
  reactionMenuOpen = false, onToggleReactionMenu, onCloseReactionMenu,
  actionMenuOpen, onOpenActionMenu, onCloseActionMenu, selected = false, isSelectionMode = false,
  usersMap = {}, messagesMap = {}, mediaVariant, senderAvatarVariant, deliveryState, groupReadInfo, onOpenGroupReadReceipts, isSavedChat,
}: MessageBubbleProps) {
  const [showContext, setShowContext] = useState(false);
  const [reactionsExpanded, setReactionsExpanded] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [reactionPos, setReactionPos] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const reactionsLayerRef = useRef<HTMLDivElement | null>(null);
  const reactionOverflowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactionOverflowPopoverRef = useRef<HTMLDivElement | null>(null);
  const reactionOverflowCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reactionOverflowStyle, setReactionOverflowStyle] = useState<CSSProperties>({
    left: 8,
    top: 8,
    maxWidth: "calc(100vw - 16px)",
  });
  const { currentUser } = useAppStore();
  const textContent = message.content ?? "";
  const mediaCaption = getVisibleMediaCaption(message);
  const mediaDimensions = getMessageMediaDimensions(message);
  const imageDisplayUrl = message.type === "image"
    ? mediaVariant?.previewUrl ?? message.media_url
    : message.media_url;
  const imageDimensions = message.type === "image" && mediaVariant?.previewWidth && mediaVariant?.previewHeight
    ? { width: mediaVariant.previewWidth, height: mediaVariant.previewHeight }
    : mediaDimensions;
  const videoPosterUrl = message.type === "video" ? mediaVariant?.videoPosterUrl : undefined;
  const textLayoutKind = getMessageTextLayoutKind(message.type, textContent);
  const widthClasses = getMessageWidthClasses(textLayoutKind);
  const stackStyle = getMessageStackStyle(textLayoutKind);
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
    if (reactionOverflowCloseTimer.current) clearTimeout(reactionOverflowCloseTimer.current);
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

  useEffect(() => {
    if (!reactionsExpanded) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && reactionsLayerRef.current?.contains(target)) return;
      if (target && reactionOverflowPopoverRef.current?.contains(target)) return;
      setReactionsExpanded(false);
    };

    window.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [reactionsExpanded]);

  const updateReactionOverflowPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const trigger = reactionOverflowTriggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = reactionOverflowPopoverRef.current?.getBoundingClientRect();
    const maxWidth = Math.min(320, window.innerWidth - 16);
    const width = Math.min(popoverRect?.width ?? 220, maxWidth);
    const height = popoverRect?.height ?? 44;
    const topBelow = triggerRect.bottom + 6;
    const top = topBelow + height <= window.innerHeight - 8
      ? topBelow
      : Math.max(8, triggerRect.top - height - 6);
    const left = clampNumber(triggerRect.right - width, 8, Math.max(8, window.innerWidth - width - 8));

    setReactionOverflowStyle({
      left,
      top,
      maxWidth,
    });
  }, []);

  const clearReactionOverflowClose = useCallback(() => {
    if (reactionOverflowCloseTimer.current) {
      clearTimeout(reactionOverflowCloseTimer.current);
      reactionOverflowCloseTimer.current = null;
    }
  }, []);

  const openReactionOverflow = useCallback(() => {
    clearReactionOverflowClose();
    setReactionsExpanded(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(updateReactionOverflowPosition);
    }
  }, [clearReactionOverflowClose, updateReactionOverflowPosition]);

  const closeReactionOverflowSoon = useCallback(() => {
    clearReactionOverflowClose();
    reactionOverflowCloseTimer.current = setTimeout(() => {
      setReactionsExpanded(false);
      reactionOverflowCloseTimer.current = null;
    }, 120);
  }, [clearReactionOverflowClose]);

  useLayoutEffect(() => {
    if (!reactionsExpanded || typeof window === "undefined") return;
    updateReactionOverflowPosition();
    const handleViewportChange = () => updateReactionOverflowPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [reactionsExpanded, updateReactionOverflowPosition]);

  const reactionGroups = (message.reactions ?? []).reduce<Record<string, { count: number; mine: boolean }>>(
    (acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false };
      acc[r.emoji].count++;
      if (r.user_id === currentUser?.id) acc[r.emoji].mine = true;
      return acc;
    }, {}
  );
  const reactionEntries = Object.entries(reactionGroups);
  const isVeryShortReactionText =
    message.type === "text" &&
    textLayoutKind === "short" &&
    textContent.trim().length <= 4 &&
    reactionEntries.length > 1;
  const visibleReactionLimit = Math.min(isVeryShortReactionText ? 1 : 2, reactionEntries.length);
  const visibleReactionEntries = reactionEntries.slice(0, visibleReactionLimit);
  const overflowReactionEntries = reactionEntries.slice(visibleReactionLimit);
  const hiddenReactionCount = reactionEntries
    .slice(visibleReactionLimit)
    .reduce((total, [, { count }]) => total + count, 0);
  const hasReactions = reactionEntries.length > 0;
  const isLocalSend = message.id.startsWith("tmp:") || Boolean(message.pending || message.checking || message.failed);
  const canReact = !isLocalSend;

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

  const regularContextItems: ContextItem[] = [
    { icon: "reply", label: "Ответить", action: () => { onReply(); closeContext(); } },
    ...(groupReadInfo && onOpenGroupReadReceipts ? [
      { icon: "eye" as KubIconName, label: "Кто прочитал", action: () => { onOpenGroupReadReceipts(); closeContext(); } },
    ] : []),
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
  const localSendContextItems: ContextItem[] = [
    ...(onRetrySend ? [
      { icon: "rotate" as KubIconName, label: "Повторить", action: () => { onRetrySend(); closeContext(); } },
    ] : []),
    ...(message.type === "text" && onEditFailedSend ? [
      { icon: "edit" as KubIconName, label: "Изменить", action: () => { onEditFailedSend(); closeContext(); } },
    ] : []),
    { icon: "copy", label: "Копировать", action: () => { navigator.clipboard.writeText(message.content ?? ""); closeContext(); } },
    ...(onDiscardLocalMessage ? [
      { icon: "delete" as KubIconName, label: "Удалить", danger: true, action: () => { onDiscardLocalMessage(); closeContext(); } },
    ] : []),
  ];
  const contextItems = isLocalSend ? localSendContextItems : regularContextItems;
  const canUseCompactReplyInline = canRenderCompactReplyInline(message, textLayoutKind, hasReactions);
  const canUseMeasuredTextMeta = message.type === "text" && textLayoutKind !== "preformatted" && !message.failed && !canUseCompactReplyInline;
  const justifyOrdinaryText =
    textLayoutKind === "regular" &&
    !message.reply_to_id &&
    !hasReactions &&
    shouldJustifyOrdinaryText(message.content ?? "");
  const footerMode = hasReactions ? "bottom-layer-reactions" : canUseCompactReplyInline ? "compact-reply-inline" : canUseMeasuredTextMeta ? "measured" : "meta-row";
  const showGroupReadIndicator = Boolean(groupReadInfo && groupReadInfo.readCount > 0);
  const groupReadLabel = groupReadInfo ? getGroupReadReceiptCompactLabel(groupReadInfo) : "";
  const groupReadAriaLabel = groupReadInfo ? getGroupReadReceiptAriaLabel(groupReadInfo) : "";
  const footerMeasureKey = [
    message.id,
    textContent,
    message.created_at,
    message.edited_at ?? "",
    message.pinned ? "pinned" : "",
    deliveryState?.state ?? "",
    deliveryState?.icon ?? "",
    deliveryState?.label ?? "",
    groupReadLabel,
    groupReadAriaLabel,
    compactContextMenu ? "mobile-actions" : "desktop-actions",
  ].join("|");
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
      {deliveryState?.isOwnMessage && !showGroupReadIndicator && (
        <KubIcon
          name={deliveryState.icon}
          size={13}
          tone={deliveryState.tone}
          label={deliveryState.label}
        />
      )}
      {groupReadInfo && showGroupReadIndicator && (
        <button
          type="button"
          className="inline-flex h-4 items-center gap-0.5 rounded-full px-0.5 text-[10px] leading-none text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)]"
          title={groupReadAriaLabel}
          aria-label={groupReadAriaLabel}
          onClick={(event) => {
            event.stopPropagation();
            onOpenGroupReadReceipts?.();
          }}
        >
          <KubIcon name={groupReadInfo.allRead ? "doubleCheck" : "check"} size={11} tone={groupReadInfo.allRead ? "accent" : "muted"} />
          <span className="tabular-nums">{groupReadLabel}</span>
        </button>
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
  const renderReactionChip = ([emoji, { count, mine }]: [string, { count: number; mine: boolean }], keyPrefix = "reaction") => (
    <button
      key={`${keyPrefix}-${emoji}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onReaction(emoji);
      }}
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
  );

  const renderReactionsRow = (mode: "standalone" | "bottom-layer" = "standalone") => {
    if (!hasReactions) return null;
    return (
      <div
        ref={reactionsLayerRef}
        data-message-reactions-row="true"
        data-message-reactions-expanded={reactionsExpanded ? "true" : "false"}
        className={cn(
          "relative flex max-w-full flex-wrap items-center justify-start gap-1",
          mode === "standalone" ? "mt-1 w-fit self-start" : "min-w-0 flex-1"
        )}
      >
        {visibleReactionEntries.map((entry) => renderReactionChip(entry))}
        {hiddenReactionCount > 0 && (
          <button
            ref={reactionOverflowTriggerRef}
            type="button"
            className="inline-flex h-[22px] items-center rounded-full border border-[color-mix(in_srgb,var(--kub-border-color)_72%,transparent)] bg-[color-mix(in_srgb,var(--kub-surface-2)_72%,transparent)] px-2 text-[11px] leading-none text-[color:var(--kub-muted)]"
            title={`Ещё ${hiddenReactionCount} реакций`}
            aria-label={`Ещё ${hiddenReactionCount} реакций`}
            aria-expanded={reactionsExpanded}
            onMouseEnter={openReactionOverflow}
            onMouseLeave={closeReactionOverflowSoon}
            onFocus={openReactionOverflow}
            onBlur={closeReactionOverflowSoon}
            onClick={(event) => {
              event.stopPropagation();
              if (reactionsExpanded) {
                setReactionsExpanded(false);
              } else {
                openReactionOverflow();
              }
            }}
          >
            +{hiddenReactionCount}
          </button>
        )}
      </div>
    );
  };

  const renderReactionsBottomLayer = () => {
    if (!hasReactions) return null;
    return (
      <div
        data-message-bottom-layer="reactions"
        className="mt-1 flex max-w-full items-end gap-2 self-stretch leading-none"
      >
        {renderReactionsRow("bottom-layer")}
        <div
          data-message-footer="true"
          className="ml-auto inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none"
        >
          {renderFooterContent()}
        </div>
      </div>
    );
  };

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
            {canReact && (
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
            )}
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

      {canReact && reactionMenuOpen && !compactContextMenu && (
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

      {hiddenReactionCount > 0 && reactionsExpanded && typeof document !== "undefined" && createPortal(
        <div
          ref={reactionOverflowPopoverRef}
          data-message-reactions-overflow="true"
          className="fixed z-[45] flex w-max flex-wrap items-center gap-1 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-1.5 shadow-2xl kub-glow-soft"
          style={reactionOverflowStyle}
          onMouseEnter={clearReactionOverflowClose}
          onMouseLeave={closeReactionOverflowSoon}
          onFocus={openReactionOverflow}
          onBlur={closeReactionOverflowSoon}
          onClick={(event) => event.stopPropagation()}
        >
          {overflowReactionEntries.map((entry) => renderReactionChip(entry, "overflow-reaction"))}
        </div>,
        document.body
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
              <UserAvatar user={message.sender} size="sm" avatarVariant={senderAvatarVariant} />
            )}
          </div>
        )}

        <div
          ref={stackRef}
          className={cn("inline-flex min-w-0 max-w-full flex-col", widthClasses.stack, isMe ? "items-end" : "items-start")}
          style={stackStyle}
        >

          {!isMe && isFirstInGroup && message.sender && (
            <span className="text-xs font-semibold ml-3 mb-0.5 text-[color:var(--kub-cyan)]">
              {message.sender.full_name}
            </span>
          )}

          <div
            ref={bubbleRef}
            data-message-bubble="true"
            data-message-layout-kind={textLayoutKind}
            data-message-footer-mode={footerMode}
            className={cn(
              "relative flex flex-col max-w-full px-3 pt-2 rounded-2xl transition-opacity select-none sm:select-text",
              hasReactions ? "pb-2" : "pb-1",
              widthClasses.bubble,
              bubbleClass,
              isMe ? "rounded-br-sm" : "rounded-bl-sm",
              isMe && isLastInGroup ? "bubble-out" : "",
              !isMe && isLastInGroup ? "bubble-in" : "",
              message.pending && "opacity-70",
              message.failed && "opacity-60",
              selected && "ring-2 ring-[color:var(--kub-cyan)]/55 bg-[color-mix(in_srgb,var(--kub-cyan)_10%,var(--kub-message-in))]",
              isSelectionMode && "cursor-pointer [&_a]:pointer-events-none [&_audio]:pointer-events-none [&_button]:pointer-events-none [&_input]:pointer-events-none [&_video]:pointer-events-none",
            )}
          >
            <div
              className={cn(
                "absolute top-1 hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex z-10",
                isMe ? "-left-20" : "-right-20"
              )}
            >
              {canReact && (
                <button
                  onClick={handleToggleReactionMenu}
                  data-reaction-trigger="true"
                  aria-label="Реакция"
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-[var(--kub-surface-2)] hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)] border border-[color:var(--kub-border-color)]"
                >
                  <KubIcon name="smile" size={14} />
                </button>
              )}
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

            {message.reply_to_id && (() => {
              const replyMsg = messagesMap[message.reply_to_id] ?? message.reply_to ?? null;
              const replyUserId = replyMsg?.user_id ?? null;
              const replyName = replyMsg && !replyMsg.deleted_at
                ? replyUserId === currentUser?.id
                  ? "Вы"
                  : (replyUserId ? usersMap[replyUserId] : null) ?? replyMsg.sender?.full_name ?? "Без имени"
                : "Ответ";
              const compactPreview = canUseCompactReplyInline;
              const compactPreviewCap = compactPreview
                ? getCompactReplyPreviewCap(message.content ?? "")
                : null;
              const preview = clampReplyPreviewText(formatReplyMessagePreview(replyMsg), compactPreviewCap?.chars ?? 28);
              const replyNameLabel = clampReplyPreviewText(replyName, compactPreview ? 18 : 24);
              return (
                <button
                  type="button"
                  data-message-reply-preview="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    onJumpToReply?.(message.reply_to_id!);
                  }}
                  className="mb-1.5 flex w-fit min-w-0 items-stretch gap-2 overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--kub-surface-2)_55%,transparent)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--kub-surface-3)_72%,transparent)]"
                  style={{ maxWidth: compactPreviewCap?.maxWidth ?? "min(100%, 170px, 22ch)" }}
                  aria-label="Перейти к исходному сообщению"
                >
                  <span className="w-0.5 flex-shrink-0 self-stretch rounded-full bg-[var(--kub-cyan)]" />
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate font-semibold leading-tight text-[color:var(--kub-cyan)]">
                      {replyNameLabel}
                    </span>
                    <span
                      className="block overflow-hidden truncate whitespace-nowrap leading-tight text-[color:var(--kub-muted)]"
                      style={{
                        textOverflow: "ellipsis",
                      }}
                    >
                      {preview}
                    </span>
                  </span>
                </button>
              );
            })()}

            {isVoiceMessage(message) ? (
              <AudioMessage
                url={message.media_url}
                duration={parseAudioDuration(message.content)}
                isMe={isMe}
                playbackItem={createPlaybackItemFromMessage(message, isMe)}
              />
            ) : message.type === "image" && message.media_url ? (
              <MediaWithCaption caption={mediaCaption}>
                <MediaImage
                  url={imageDisplayUrl ?? message.media_url}
                  thumbUrl={mediaVariant?.thumbUrl}
                  title={message.content ?? "Фото"}
                  dimensions={imageDimensions}
                  onOpen={() => onOpenMedia?.({ type: "image", url: message.media_url!, title: message.content ?? "Фото" })}
                />
              </MediaWithCaption>
            ) : message.type === "video" && message.media_url ? (
              isRoundVideoMessage(message) ? (
                <RoundVideoMessage
                  url={message.media_url}
                  title={message.content ?? "Видео-сообщение"}
                  posterUrl={videoPosterUrl}
                  durationLabel={parseVideoMessageDuration(message.content, message)}
                  playbackItem={createPlaybackItemFromMessage(message, isMe)}
                  onOpen={() => onOpenMedia?.({ type: "video", url: message.media_url!, title: message.content ?? "Видео-сообщение" })}
                />
              ) : (
                <MediaWithCaption caption={mediaCaption}>
                  <MediaVideo
                    url={message.media_url}
                    title={message.content ?? "Видео"}
                    posterUrl={videoPosterUrl}
                    dimensions={mediaDimensions}
                    playbackItem={createPlaybackItemFromMessage(message, isMe)}
                    onOpen={() => onOpenMedia?.({ type: "video", url: message.media_url!, title: message.content ?? "Видео" })}
                  />
                </MediaWithCaption>
              )
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
            ) : canUseCompactReplyInline ? (
              <div
                data-message-text-flow="true"
                data-message-meta-placement="inline"
                className={cn(
                  "flex w-full max-w-full min-w-0 items-baseline gap-2 text-sm leading-relaxed whitespace-pre-wrap text-[color:var(--kub-text)]",
                  widthClasses.text
                )}
              >
                <span className="min-w-0 flex-1">
                  <FormattedText content={message.content ?? ""} />
                </span>
                <span
                  data-message-footer="true"
                  className="ml-auto inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none [vertical-align:-0.12em]"
                >
                  {renderFooterContent()}
                </span>
              </div>
            ) : canUseMeasuredTextMeta ? (
              <MeasuredTextWithMeta
                content={message.content ?? ""}
                textClassName={cn(
                  "min-w-0 max-w-full text-sm leading-relaxed whitespace-pre-wrap text-[color:var(--kub-text)]",
                  justifyOrdinaryText && "[text-align:justify] [text-align-last:start]",
                  widthClasses.text
                )}
                meta={hasReactions ? null : renderFooterContent()}
                bubbleRef={bubbleRef}
                stackRef={stackRef}
                measureKey={footerMeasureKey}
                compound={Boolean(message.reply_to_id)}
              />
            ) : (
              <p
                data-message-text-flow="true"
                className={cn(
                  "min-w-0 max-w-full text-sm leading-relaxed whitespace-pre-wrap text-[color:var(--kub-text)]",
                  widthClasses.text
                )}
              >
                <FormattedText content={message.content ?? ""} />
              </p>
            )}

            {message.failed && isMe && (
              <div
                data-message-send-error="true"
                className="mt-1 flex max-w-full flex-wrap items-center gap-1.5 border-t border-[color:var(--kub-border-color)]/60 pt-1 text-[11px] leading-none text-[color:var(--kub-danger)]"
              >
                <span className="mr-auto min-w-0">
                  {message.send_error ?? "Не удалось отправить"}
                </span>
                {onRetrySend && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-cyan)] hover:bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)]"
                    onClick={(event) => { event.stopPropagation(); onRetrySend(); }}
                  >
                    Повторить
                  </button>
                )}
                {message.type === "text" && onEditFailedSend && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)]"
                    onClick={(event) => { event.stopPropagation(); onEditFailedSend(); }}
                  >
                    Изменить
                  </button>
                )}
                {onDiscardLocalMessage && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-danger)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)]"
                    onClick={(event) => { event.stopPropagation(); onDiscardLocalMessage(); }}
                  >
                    Удалить
                  </button>
                )}
              </div>
            )}

            {!canUseMeasuredTextMeta && !canUseCompactReplyInline && !hasReactions && (
              <div
                data-message-bottom-meta="true"
                className="mt-0.5 flex self-stretch max-w-full items-center justify-end leading-none"
              >
                <div
                  data-message-footer="true"
                  className="inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none"
                >
                  {renderFooterContent()}
                </div>
              </div>
            )}

            {hasReactions ? renderReactionsBottomLayer() : renderReactionsRow()}
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

interface MediaDimensions {
  width: number;
  height: number;
}

function MediaImage({
  url,
  thumbUrl,
  title,
  dimensions,
  onOpen,
}: {
  url: string;
  thumbUrl?: string;
  title: string;
  dimensions: MediaDimensions | null;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const aspectStyle = getMediaAspectStyle(dimensions);
  const hasReservedAspect = Boolean(aspectStyle);

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
      className="group block max-h-[340px] w-[min(360px,calc(100vw-7.5rem))] max-w-full overflow-hidden rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-[color:var(--kub-cyan)] sm:max-h-[380px] sm:w-[min(420px,70vw)]"
      style={aspectStyle}
      aria-label="Открыть фото"
    >
      <img
        src={url}
        srcSet={thumbUrl ? `${thumbUrl} 360w, ${url} 1280w` : undefined}
        sizes="(max-width: 640px) 86vw, 420px"
        alt={title || "Фото"}
        loading="lazy"
        decoding="async"
        className={cn(
          "w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]",
          hasReservedAspect ? "h-full" : "max-h-[340px] sm:max-h-[380px]"
        )}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function MediaWithCaption({ children, caption }: { children: ReactNode; caption: string | null }) {
  return (
    <div className="flex max-w-full flex-col gap-1.5">
      {children}
      {caption && (
        <p className="min-w-0 max-w-full whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--kub-text)]">
          <FormattedText content={caption} />
        </p>
      )}
    </div>
  );
}

function MediaVideo({
  url,
  title,
  posterUrl,
  dimensions,
  playbackItem,
  onOpen,
}: {
  url: string;
  title: string;
  posterUrl?: string;
  dimensions: MediaDimensions | null;
  playbackItem: ChatMediaPlaybackItem | null;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const mediaPlayback = useChatMediaPlayback();
  const aspectStyle = getMediaAspectStyle(dimensions, 16 / 9);

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
    <div
      className="relative max-h-[320px] w-[min(360px,calc(100vw-7.5rem))] max-w-full overflow-hidden rounded-xl bg-black sm:w-[min(420px,70vw)]"
      style={aspectStyle}
    >
      <video
        ref={videoRef}
        src={url}
        poster={posterUrl}
        preload="metadata"
        controls
        playsInline
        className="block h-full max-h-[320px] w-full bg-black object-contain"
        onPlay={(event) => {
          if (playbackItem) mediaPlayback.activate(playbackItem, event.currentTarget);
        }}
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

function RoundVideoMessage({
  url,
  title,
  posterUrl,
  durationLabel,
  playbackItem,
  onOpen,
}: {
  url: string;
  title: string;
  posterUrl?: string;
  durationLabel: string | null;
  playbackItem: ChatMediaPlaybackItem | null;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const mediaPlayback = useChatMediaPlayback();
  const activateMediaPlayback = mediaPlayback.activate;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : getMediaMetadataNumberFromItem(playbackItem) / 1000;
      setProgress(duration > 0 ? Math.min(1, Math.max(0, video.currentTime / duration)) : 0);
    };
    const onPlay = () => {
      setPlaying(true);
      if (playbackItem) activateMediaPlayback(playbackItem, video);
      sync();
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
    };
    video.addEventListener("timeupdate", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [activateMediaPlayback, playbackItem, url]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || failed) return;
    if (playbackItem) {
      mediaPlayback.toggle(playbackItem, video);
      return;
    }
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };
  const activeProgress = playbackItem && mediaPlayback.isCurrent(playbackItem.id) ? mediaPlayback.progress : progress;
  const isActivePlaying = playbackItem && mediaPlayback.isCurrent(playbackItem.id) ? mediaPlayback.isPlaying : playing;
  const isActiveMedia = Boolean(playbackItem && mediaPlayback.isCurrent(playbackItem.id));

  if (failed) {
    return (
      <div className="flex max-w-[240px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить видео.</span>
        <button type="button" onClick={onOpen} className="text-[color:var(--kub-cyan)] hover:underline">
          Открыть
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="sent-video-message-circle"
      data-active-media={isActiveMedia ? "true" : "false"}
      className={cn(
        "relative h-48 w-48 max-w-full sm:h-52 sm:w-52",
        isActiveMedia && "drop-shadow-[0_0_18px_color-mix(in_srgb,var(--kub-cyan)_28%,transparent)]"
      )}
    >
      <VideoCircleProgressRing
        progress={activeProgress}
        testId="video-message-progress-ring"
        className={cn(isActiveMedia ? "opacity-100" : "opacity-80")}
      />
      <button
        type="button"
        onClick={togglePlayback}
        className={cn(
          "group relative z-10 block h-full w-full overflow-hidden rounded-full bg-black shadow-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--kub-cyan)]",
          isActiveMedia && "ring-2 ring-[color:var(--kub-cyan)]"
        )}
        aria-label={isActivePlaying ? "Пауза видео-сообщения" : "Воспроизвести видео-сообщение"}
      >
        <video
          ref={videoRef}
          src={url}
          poster={posterUrl}
          preload="metadata"
          playsInline
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
        {!isActivePlaying && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors group-hover:bg-black/30">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 backdrop-blur">
              <KubIcon name="play" size={19} />
            </span>
          </span>
        )}
        {durationLabel && (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
            {durationLabel}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="absolute right-1 top-1 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/80"
        aria-label="Открыть видео в просмотрщике"
      >
        <KubIcon name="externalLink" size={14} />
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

function parseVideoMessageDuration(content: string | null | undefined, message?: MessageWithSender): string | null {
  const durationMs = getMediaMetadataNumber(message, "duration_ms");
  if (durationMs && durationMs > 0) return formatMetadataDuration(durationMs);
  return content?.match(/(\d{1,2}:\d{2})/)?.[1] ?? null;
}

function createPlaybackItemFromMessage(message: MessageWithSender, isMe: boolean): ChatMediaPlaybackItem | null {
  if (!message.media_url || message.deleted_at) return null;
  if (message.type !== "audio" && message.type !== "video") return null;
  const kind: ChatMediaPlaybackItem["kind"] = message.type === "video"
    ? isRoundVideoMessage(message)
      ? "video_message"
      : "video"
    : isVoiceMessage(message)
      ? "voice"
      : "audio";
  const durationMs = getMediaMetadataNumber(message, "duration_ms") ?? durationStringToMs(message.content);
  return {
    id: message.id,
    chatId: message.chat_id,
    kind,
    url: message.media_url,
    title: kind === "video_message"
      ? "Видеосообщение"
      : kind === "voice"
        ? "Голосовое сообщение"
        : kind === "audio"
          ? "Аудио"
          : "Видео",
    subtitle: isMe ? "Вы" : message.sender?.full_name ?? message.sender?.username ?? "Участник",
    durationMs,
  };
}

function durationStringToMs(content: string | null | undefined): number | null {
  const match = content?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return (minutes * 60 + seconds) * 1000;
}

function getMediaMetadataNumberFromItem(item: ChatMediaPlaybackItem | null): number {
  return item?.durationMs && item.durationMs > 0 ? item.durationMs : 0;
}

function isRoundVideoMessage(message: MessageWithSender): boolean {
  return message.type === "video" && (
    getMediaMetadataString(message, "kind") === "video_message" ||
    getMediaMetadataString(message, "shape") === "round" ||
    /^Видео-сообщение(?:\s|\(|$)/i.test(message.content?.trim() ?? "")
  );
}

function isVoiceMessage(message: MessageWithSender): boolean {
  if (message.type === "audio") return true;
  if (message.type === "video") return false;
  const mediaUrl = message.media_url?.toLowerCase() ?? "";
  if (/\.(webm|ogg|oga|mp3|wav|m4a|aac)(\?|#|$)/.test(mediaUrl)) return true;
  const content = message.content?.toLowerCase() ?? "";
  return content.includes("голосовое") || content.includes("voice");
}

function getVisibleMediaCaption(message: MessageWithSender): string | null {
  if (message.type !== "image" && message.type !== "video") return null;
  const content = message.content?.trim();
  if (!content) return null;
  if (isRoundVideoMessage(message)) return null;
  if (looksLikeMediaFileName(content)) return null;
  if (/^(фото|видео|image|video)$/i.test(content)) return null;
  return content;
}

function getMediaMetadataString(message: MessageWithSender | undefined, key: string): string | null {
  const metadata = message?.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function getMediaMetadataNumber(message: MessageWithSender | undefined, key: string): number | null {
  const metadata = message?.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getMessageMediaDimensions(message: MessageWithSender): MediaDimensions | null {
  const width = getMediaMetadataNumber(message, "width");
  const height = getMediaMetadataNumber(message, "height");
  if (!width || !height || width <= 0 || height <= 0) return null;
  return { width, height };
}

function getMediaAspectStyle(dimensions: MediaDimensions | null, fallbackRatio?: number): CSSProperties | undefined {
  if (!dimensions && !fallbackRatio) return undefined;
  const rawRatio = dimensions ? dimensions.width / dimensions.height : fallbackRatio ?? 1;
  const ratio = Math.min(1.9, Math.max(0.72, rawRatio));
  return { aspectRatio: ratio.toFixed(4) };
}

function formatMetadataDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString();
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function looksLikeMediaFileName(value: string): boolean {
  return /^[\w\s().-]+\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/i.test(value);
}
