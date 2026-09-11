"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { resolveCssLength } from "@/lib/cssLength";
import { reachableContentWidth } from "@/lib/messageMetaReach";
import {
  holdMeasuredPlacement,
  metaPlacementInputsKey,
  metaTextKey,
  type AnchoredHold,
} from "@/lib/messageMetaHold";
import { NO_SAFE_AREA_INSETS, readSafeAreaInsets, type SafeAreaInsets } from "@/lib/safeArea";
import { createPortal } from "react-dom";
import type { MessageWithSender } from "@/types/database";
import { formatFullTime } from "@/lib/format";
import { MessageActorAvatar } from "@/components/ui/ChatAvatar";
import type { AvatarVariantUrls, MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { AudioMessage } from "./AudioMessage";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import { FormattedText, isLocationPreviewMessage } from "@/lib/formatText";
import { KubIcon } from "@/components/kub";
import type { MediaViewerItem } from "./MediaViewer";
import { useChatMediaPlayback, VideoCircleProgressRing, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import type { MessageDeliveryState } from "@/lib/messageDelivery";
import {
  getGroupReadReceiptAriaLabel,
  getGroupReadReceiptCompactLabel,
  type GroupReadReceiptInfo,
} from "@/lib/groupReadReceipts";
import { formatReplyMessagePreview } from "@/lib/messagePreview";
import { getVideoPlaybackFallbackUrl, selectVideoPlaybackUrl } from "@/lib/mediaQuality";
import { groupReactions, type ReactionGroup } from "@/lib/messageReactions";
import { isUncompressedMedia } from "@/lib/mediaCompression";
import { resolveOriginalPreviewUrl } from "@/hooks/useMediaVariants";
import {
  messageActorDisplayName,
  resolveMessageActor,
} from "@/lib/messageActor";
import { QuickReactionButton, ReactionChip } from "./MessageReactions";

type TextLayoutKind = "short" | "regular" | "link" | "longToken" | "preformatted" | "media";
type MetaPlacement = "inline" | "anchored";

/**
 * What a message draws and nothing it does not.
 *
 * The menus, the long press, the double tap and the swipe used to live here,
 * one copy per message. They are the list's now (`MessageList` and
 * `MessageActionLayer`): a message reports what was asked of it and draws the
 * result. What stays is what belongs to the bubble itself — its content, its
 * time, its reactions, and the ❤️ that appears beside it under a hovering
 * pointer.
 */
interface MessageBubbleProps {
  message: MessageWithSender;
  /** Arrived while the list was on screen. History does not animate. */
  isEntering?: boolean;
  isMe: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  onJumpToReply?: (messageId: string) => void;
  /** Puts or takes back a reaction; the one-per-person rule is applied above. */
  onReaction: (emoji: string) => void;
  onRetrySend?: () => void;
  onEditFailedSend?: () => void;
  onDiscardLocalMessage?: () => void;
  onOpenMedia?: (media: MediaViewerItem) => void;
  isSelectionMode?: boolean;
  messagesMap?: Record<string, MessageWithSender>;
  mediaVariant?: MessageMediaVariantUrls;
  senderAvatarVariant?: AvatarVariantUrls;
  deliveryState?: MessageDeliveryState | null;
  groupReadInfo?: GroupReadReceiptInfo | null;
  onOpenGroupReadReceipts?: () => void;
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

/**
 * How wide a message may grow: fixed lengths, and nothing resolved against the row.
 *
 * Every cap here used to end in `max(16rem, 100% - lane)`, the lane being 104px
 * kept clear beside each message for the hover cluster. `100%` was a row
 * shrink-wrapped around the message, so how far a bubble could reach depended
 * on the placement it had been given: D-071's wasted line, and at a 40px lane
 * D-080's loop. The cluster went with the owner's decision of 2026-09-11, and
 * the lane with it.
 *
 * The one control a hovered message still shows — the ❤️ beside its time — has
 * its width kept free by padding on the message's open side
 * (`.kub-message-reserve-*` in `index.css`). Padding binds only where a narrow
 * window has left no room outside the bubble; a bubble held by its own cap has
 * room to spare and is not touched.
 */
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

/** The inline cap, which beats the class one. */
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

/*
 * Message text is start-aligned. It was justified, and D-060 is why it is not.
 *
 * Justification moves a line's slack into its word spaces, and it can only give
 * that slack somewhere else if the text hyphenates. Russian prose here does not:
 * the bubble carried `hyphens: manual`, and no engine hyphenates on its own
 * without being asked. So every line paid for the one long word it could not
 * break, and the narrower the column the more it paid.
 *
 * Measured on the DEV preview fixture with a `Range` over each word, worst gap
 * per rendered message against a natural space of 3.94px in this font at 14px:
 *
 *   viewport   bubble    worst gap   × natural
 *   360        275.9px   63.58px     16.15
 *   390        305.9px   52.00px     13.21
 *   412        327.9px   47.55px     12.08
 *   640        481.9px   22.78px      5.79
 *   768        249.9px   39.94px     10.14   (the sidebar appears; the bubble narrows)
 *   1440       537.9px   19.08px      4.85
 *
 * There is no width where it behaves — the widest bubble the product can show
 * still opens gaps nearly five times a space — so this is removed rather than
 * gated behind a breakpoint. The register's own numbers, taken on a real device
 * against a different message, agree: 7.76× at 360 and 3.48× at 412.
 */

/**
 * What to render before anything has been measured.
 *
 * The 56-character rule belonged to the old layout, where the meta flowed after
 * the last word and a long message usually did need a row of its own. The meta
 * is positioned at the bubble's corner now, with its space reserved on the last
 * line, so inline is almost always what the measurement goes on to choose — and
 * guessing anchored meant the message appeared with a row it then dropped.
 * Measured on production: a bubble painted at 81px and settled at 59px.
 *
 * An explicit line break still starts anchored. There the last line is the
 * author's choice rather than the result of wrapping, so it can be full width
 * and leave the meta nowhere to sit.
 */
function getInitialMetaPlacement(content: string): MetaPlacement {
  const text = content.trim();
  if (!text) return "inline";
  if (isLocationPreviewMessage(content)) return "inline";
  if (/[\r\n]/.test(content)) return "anchored";
  return "inline";
}

function canRenderCompactReplyInline(message: MessageWithSender, kind: TextLayoutKind, hasReactions: boolean): boolean {
  if (!message.reply_to_id || hasReactions || message.failed) return false;
  if (message.type !== "text" || kind !== "short") return false;
  const text = (message.content ?? "").trim();
  return Boolean(text) && !/[\r\n]/.test(text) && text.length <= 24;
}

/**
 * One shared promise for "the fonts have loaded", instead of one per message.
 *
 * Every bubble asked `document.fonts.ready` from its own measurement effect. It
 * is a getter that does real work, and with a screenful of messages it showed
 * up in a CPU profile of chat switching as 304ms of self time — the second
 * largest non-idle entry. Reading it once is enough: the answer is the same for
 * every bubble on the page.
 */
let fontsReadyPromise: Promise<unknown> | null = null;

function whenFontsReady(): Promise<unknown> {
  if (typeof document === "undefined") return Promise.resolve();
  if (!fontsReadyPromise) {
    fontsReadyPromise = document.fonts ? document.fonts.ready.catch(() => undefined) : Promise.resolve();
  }
  return fontsReadyPromise;
}

/**
 * A pixel length, or nothing.
 *
 * It used to accept anything `parseFloat` could chew on, which meant a computed
 * `max-width: 100%` came back as the number 100 — a hundred pixels. That fed
 * the inline-meta decision a width of 100px and made it flip its answer every
 * render.
 */
function parsePixelValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.endsWith("px")) return null;
  const parsed = Number.parseFloat(trimmed);
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

/**
 * The declared ceiling on the bubble's content, in pixels, or nothing.
 *
 * The stack carries the design cap — `min(86vw, 560px, max(16rem, 100% - lane))`
 * — and it is a real ceiling: the row can want more, and the stack still stops
 * there. Measuring the row alone therefore over-estimates whenever the design
 * cap is the tighter constraint, which is D-032: a last line 507px wide was
 * told it had 984px, chose inline, and the reserved spacer then wrapped and
 * grew the bubble 22.8px, 46ms after it was painted.
 *
 * Only the terms that do not move are read. `getComputedStyle` has already made
 * every unit absolute — `86vw` arrives as `1238.4px`, the lane as `104px` — and
 * the one thing left standing is `100%`, whose basis is the row. The row is
 * shrink-to-fit around this very bubble, so that term is not a ceiling at all:
 * it grows with the content, and resolving it against the row's current width
 * fed the measurement a limit that moved with the placement. Measured, that
 * flipped two settled messages in an unrelated chat from inline to anchored and
 * made them 15px taller. So `%` is treated as unbounded here and drops out of
 * the `min()`, leaving the fixed design ceiling — which is the only part that
 * can be applied without reopening a feedback loop.
 *
 * A cap that resolves to nothing finite returns `null`, and the caller keeps
 * the row's answer rather than a guess.
 */
function getDeclaredContentCap(
  bubbleStyle: CSSStyleDeclaration,
  stackEl: HTMLElement | null,
): { width: number; exact: boolean } | null {
  if (!stackEl) return null;
  const maxWidth = getComputedStyle(stackEl).maxWidth;
  // Asked twice, and the second answer is the interesting one. With no basis a
  // percentage cannot be resolved and the whole expression comes back `null`,
  // so a number here means the cap contains no percentage at all — it is the
  // ceiling outright, not the ceiling with a term guessed at.
  const declared = resolveCssLength(maxWidth, Number.POSITIVE_INFINITY);
  const exact = resolveCssLength(maxWidth, null) !== null;
  if (declared === null || declared <= 0) return null;

  // The stack's cap bounds the bubble's BORDER box, so the border comes off as
  // well as the padding. The bubble's own `max-width` is deliberately not read:
  // it is `100%` of the stack, and the stack is shrink-to-fit, so it describes
  // the width the bubble happens to have rather than the width it may reach.
  const paddingLeft = parsePixelValue(bubbleStyle.paddingLeft) ?? 0;
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;
  const borderLeft = parsePixelValue(bubbleStyle.borderLeftWidth) ?? 0;
  const borderRight = parsePixelValue(bubbleStyle.borderRightWidth) ?? 0;
  return { width: declared - paddingLeft - paddingRight - borderLeft - borderRight, exact };
}

/**
 * How wide the bubble's content is allowed to become.
 *
 * This is the quantity the inline-meta decision actually needs. Asking instead
 * how much room is left to the RIGHT of the last line is wrong for an own
 * message: that bubble is pinned to the right edge and grows leftwards, so the
 * space to its right is zero no matter how much room it really has. Measured,
 * that sent a 150px message with a 29px timestamp — inside a 536px allowance —
 * onto its own row.
 */
function getMaxContentWidth(bubbleEl: HTMLElement, stackEl: HTMLElement | null): number {
  const bubbleStyle = getComputedStyle(bubbleEl);
  const paddingLeft = parsePixelValue(bubbleStyle.paddingLeft) ?? 0;
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;

  // An exactly known cap IS the answer, and the row is not consulted at all.
  //
  // The row used to be asked first, on the grounds that "the row's width is the
  // same in both placements". Measured at 390, that is not true of a message
  // that does not wrap: the row is shrink-to-fit around this very bubble, so
  // for a one-line message it reports the width of the message. `Коротко` was
  // handed 100.4px against a cap of 309.4px, its 56.6px line plus a 60.4px time
  // did not fit in the smaller number, and every short message on the phone
  // took a row of its own. That is D-027's feedback loop running the other way
  // round — the row answering with the placement it had been given — and a cap
  // cannot do it, because `min(86vw, 560px, …)` is the viewport's answer rather
  // than this bubble's and does not move when the placement changes.
  //
  // Where the cap still has to guess at a percentage, the row stays. There the
  // guess is `Infinity`, and an `Infinity` inside a `max()` discards the real
  // term next to it: an own bubble at 1440 declares
  // `min(1238.4px, 560px, max(256px, 100% - 104px))`, whose true value is the
  // 256px the floor contributes and whose guessed value is 560px. Measured,
  // trusting that guess put the reserved spacer on a line of its own. So the
  // two are kept apart — an exact cap replaces the row, an inexact one only
  // tightens it, exactly as before.
  const cap = getDeclaredContentCap(bubbleStyle, stackEl);
  if (cap?.exact) return cap.width;

  // The row over-estimates when the design cap is the tighter constraint, and
  // that is the safe direction: the meta is positioned and its space reserved,
  // so a slightly generous "it fits" costs a few pixels of bubble width, never
  // an overlap. The cap is applied on top, and the two together only ever
  // tighten the answer.

  const row = (stackEl ?? bubbleEl).parentElement;
  const rowWidth = row?.getBoundingClientRect().width ?? bubbleEl.getBoundingClientRect().width;
  const fromRow = Math.max(0, rowWidth) - paddingLeft - paddingRight;
  return cap === null ? fromRow : Math.min(fromRow, cap.width);
}

/**
 * Whether the last line and its spacer fit the width the bubble can actually
 * reach. `true` whenever that width cannot be known, which leaves the decision
 * exactly as `getMaxContentWidth` made it.
 *
 * D-070; `lib/messageMetaReach.ts` carries the measurements and the reason the
 * answer cannot oscillate. What this adds is the DOM: the three edges the pure
 * function needs are read from boxes that do not move with the placement. The
 * message row is as wide as the list, and the stack's anchored edge — left for a
 * received message, right for an own one — stays put when the spacer comes or
 * goes.
 *
 * `needed` is the last line plus the spacer at the width it is actually given,
 * not the footer plus the gap. The line breaks on the spacer, and the spacer is
 * rounded up and keeps its old width through a change of a pixel — which is
 * exactly the band in which a ceiling that is otherwise right would still wrap
 * it.
 */
function fitsReachableWidth(needed: number, bubbleEl: HTMLElement, stackEl: HTMLElement | null): boolean {
  const rowEl = stackEl?.parentElement ?? null;
  const messageRowEl = rowEl?.closest<HTMLElement>("[data-message-id]") ?? null;
  if (!stackEl || !rowEl || !messageRowEl) return true;

  // Which edge is anchored is read from the layout that anchors it: an own
  // message's row packs its stack to the end. A flag passed down beside it
  // could disagree with the row and nothing would notice.
  const justify = getComputedStyle(rowEl).justifyContent;
  const alignEnd = justify === "flex-end" || justify === "end" || justify === "right";
  const stack = stackEl.getBoundingClientRect();
  const row = rowEl.getBoundingClientRect();
  const limit = messageRowEl.getBoundingClientRect();
  // The far edge is the message row's, less the room kept free on the open
  // side for the hover ❤️ (`.kub-message-reserve-*`). Padding is no placement:
  // it is the same whichever placement the meta has, so the edge still does
  // not move with the answer it feeds.
  const rowStyle = getComputedStyle(rowEl);
  const farLeft = limit.left + (parsePixelValue(rowStyle.paddingLeft) ?? 0);
  const farRight = limit.right - (parsePixelValue(rowStyle.paddingRight) ?? 0);
  const bubbleStyle = getComputedStyle(bubbleEl);
  const reachable = reachableContentWidth({
    maxWidth: getComputedStyle(stackEl).maxWidth,
    free: alignEnd ? stack.right - farLeft : farRight - stack.left,
    rowReach: alignEnd ? row.right - farLeft : farRight - row.left,
    occupied: alignEnd ? row.right - stack.right : stack.left - row.left,
    inset:
      (parsePixelValue(bubbleStyle.paddingLeft) ?? 0) +
      (parsePixelValue(bubbleStyle.paddingRight) ?? 0) +
      (parsePixelValue(bubbleStyle.borderLeftWidth) ?? 0) +
      (parsePixelValue(bubbleStyle.borderRightWidth) ?? 0),
  });
  return reachable === null || needed <= reachable;
}

function getTextRightLimit(textEl: HTMLElement, bubbleEl: HTMLElement, stackEl: HTMLElement | null): number {
  const textRect = textEl.getBoundingClientRect();
  const bubbleRect = bubbleEl.getBoundingClientRect();
  const bubbleStyle = getComputedStyle(bubbleEl);
  const paddingLeft = parsePixelValue(bubbleStyle.paddingLeft) ?? 0;
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;
  const currentContentRight = bubbleRect.right - paddingRight;
  // The bubble's own max-width counts as well as the stack's. Falling back to
  // the text's current width was safe while the meta flowed inside the
  // paragraph — that width included it. The meta is positioned now, so the
  // fallback measured the text alone, left no room for anything, and sent every
  // short message to its own row.
  const stackMaxWidth = stackEl ? parsePixelValue(getComputedStyle(stackEl).maxWidth) : null;
  const bubbleMaxWidth = parsePixelValue(bubbleStyle.maxWidth);
  const declaredMaxWidth = Math.max(stackMaxWidth ?? 0, bubbleMaxWidth ?? 0);
  const maxContentWidth = declaredMaxWidth > 0
    ? Math.max(textRect.width, declaredMaxWidth - paddingLeft - paddingRight)
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
  // The meta is taken out of the text flow and pinned to the bubble's bottom
  // right, so this is how much room the last line has to leave for it.
  const [footerReserve, setFooterReserve] = useState(0);
  // The same value, readable inside a measurement before React has rendered it:
  // the fit test has to use the width the spacer will really be given.
  const footerReserveRef = useRef(0);
  const textFlowRef = useRef<HTMLParagraphElement | null>(null);
  const textContentRef = useRef<HTMLSpanElement | null>(null);
  const footerRef = useRef<HTMLSpanElement | null>(null);
  // D-080: the standing anchored answer — what it was measured under, and how
  // the anchored layout set the text — or null. See `lib/messageMetaHold.ts`.
  const anchoredHoldRef = useRef<AnchoredHold | null>(null);
  const hasMeta = meta !== null && meta !== undefined && meta !== false;

  const measure = useCallback(() => {
    const textEl = textFlowRef.current;
    const contentEl = textContentRef.current;
    const footerEl = footerRef.current;
    // The bubble and the stack are ANCESTORS of this component, and React
    // attaches a host ref during the layout phase, which walks children before
    // parents. On the one mount that matters both refs are therefore still
    // null, this returned at its first guard, and the guess stood: measured on
    // the real chat, an own message's row was painted 38.8px tall and became
    // 50.8px one frame later (D-041).
    //
    // The nodes themselves are already in the document by then — React inserts
    // the whole subtree before it runs any layout effect — so they are read
    // from the DOM instead of waited for. The refs stay the fast path for every
    // later pass, and they point at these same two elements.
    const ownEl = textEl ?? contentEl;
    const bubbleEl =
      bubbleRef.current ?? (ownEl?.closest('[data-message-bubble="true"]') as HTMLElement | null) ?? null;
    const stackEl = stackRef.current ?? (bubbleEl?.parentElement as HTMLElement | null) ?? null;
    if (!hasMeta || !textEl || !contentEl || !footerEl || !bubbleEl) return;

    const lineRects = getTextLineRects(contentEl);
    const lastLine = lineRects.at(-1) ?? null;
    if (!lastLine) {
      setPlacement((current) => (current === "inline" ? current : "inline"));
      return;
    }

    const footerRect = footerEl.getBoundingClientRect();
    const bubbleInnerRight = getBubbleInnerRight(bubbleEl);
    const rightLimit = compound ? bubbleInnerRight : getTextRightLimit(textEl, bubbleEl, stackEl);
    const gap = 8;
    // There used to be a guard here that flipped to `anchored` whenever the
    // footer was not vertically on the last text line. It was written for a
    // footer that flowed after the last word; the footer is positioned now, so
    // the question it asked no longer has meaning — and asking it anyway sent
    // every short single-line message to its own row.

    // Whether the meta fits is a measurement, and the measurement already
    // answers it: `available` is the room left after the *last* rendered line,
    // however many lines there are. A separate single-line condition used to
    // sit on top of this and refuse every wrapped message, so a bubble whose
    // last line ended well short of the edge still grew a row containing
    // nothing but a right-aligned timestamp. See D-008.
    //
    // Removing it cannot oscillate through the text. The spacer that reserves
    // room for the meta sits outside the measured span, so adding it can only
    // shorten the last line and therefore only increase `available`. It can
    // through the row: where the cap follows a row shrink-wrapped around the
    // message, the spacer widens the row and moves the cap with it. That loop
    // is D-080, and it is held shut below.
    const reserve = Math.ceil(footerRect.width + gap);
    // A change of a pixel or less is not applied, so sub-pixel jitter in the
    // footer never re-renders the spacer. The ref follows the state exactly,
    // which is what lets the fit test below use the width that will be rendered.
    const reserveInFlow = Math.abs(footerReserveRef.current - reserve) <= 1 ? footerReserveRef.current : reserve;
    footerReserveRef.current = reserveInFlow;
    setFooterReserve(reserveInFlow);

    // A compound bubble's width is fixed by whatever sits above the text, so
    // for those the room to the right of the last line is the real constraint.
    // A plain text bubble sizes itself, so the question is whether the last
    // line and the meta fit inside the width it is allowed to reach.
    let canInline: boolean;
    if (compound) {
      canInline = rightLimit - lastLine.right >= footerRect.width + gap;
    } else {
      const maxContentWidth = getMaxContentWidth(bubbleEl, stackEl);
      // Refuse to answer on a width that cannot be real. A bubble mounting
      // inside a prepended page is measured while its row is still being laid
      // out, and the row reports a width of zero — which said the meta could
      // never fit inline. Every prepended message therefore appeared with a row
      // for the timestamp and dropped it a frame later: measured, 706px of the
      // list's height vanished at t=303ms and took the reader's place with it.
      // Keeping the current placement and waiting for the next pass costs
      // nothing, because a later pass always comes.
      if (maxContentWidth < 80) return;
      canInline = lastLine.width + footerRect.width + gap <= maxContentWidth;
    }
    const next: MetaPlacement =
      canInline && (compound || fitsReachableWidth(lastLine.width + reserveInFlow, bubbleEl, stackEl))
        ? "inline"
        : "anchored";
    // D-070: the width the design allows is not always a width the bubble can
    // reach, so an inline answer is checked against the second as well. It can
    // only ever turn inline into anchored, and it asks a question whose answer
    // is the same in both placements — see `fitsReachableWidth`.

    // D-080: an anchored answer is not overturned by an inline one measured on
    // the anchored layout, until something other than the placement changes.
    // Where the cap follows a row shrink-wrapped around the message, the inline
    // layout is the one on the wider row and the anchored one is on a row that
    // shrank because the message was anchored, so left alone each answer
    // produced the other on every commit. `lib/messageMetaHold.ts` has the
    // measurements and what counts as a change. The inputs are read from boxes
    // that do not move with the placement — the message row, not the bubble's
    // own row — and only when there is a hold to set or to test, so a message
    // that stays inline pays nothing for it. An inline layout counts only once
    // its spacer is rendered at the width reserved above: before that its row is
    // narrower than the inline layout's.
    let settled: MetaPlacement = next;
    if (next === "anchored" || anchoredHoldRef.current !== null) {
      const bubbleRowEl = stackEl?.parentElement ?? null;
      const messageRowEl = bubbleRowEl?.closest<HTMLElement>("[data-message-id]") ?? null;
      const paragraph = textEl.getBoundingClientRect();
      const spacerEl =
        placement === "inline" ? textEl.querySelector<HTMLElement>('[data-message-footer-reserve="true"]') : null;
      const held = holdMeasuredPlacement(
        next,
        {
          placement,
          inputs: metaPlacementInputsKey({
            content: `${measureKey} ${content}`,
            row: messageRowEl ? messageRowEl.getBoundingClientRect().width : 0,
            cap: stackEl ? getComputedStyle(stackEl).maxWidth : "",
            box: bubbleRowEl?.parentElement ? getComputedStyle(bubbleRowEl.parentElement).maxWidth : "",
            footer: footerRect.width,
          }),
          text: metaTextKey({ width: paragraph.width, height: paragraph.height, lastLine: lastLine.width }),
          spacer: spacerEl !== null && Math.round(spacerEl.getBoundingClientRect().width) === reserveInFlow,
        },
        anchoredHoldRef.current,
      );
      anchoredHoldRef.current = held.hold;
      settled = held.placement;
    }

    setPlacement((previous) => (previous === settled ? previous : settled));
  }, [bubbleRef, compound, content, hasMeta, measureKey, placement, stackRef]);

  /**
   * Back to the guess when the text CHANGES — and never on the mount itself.
   *
   * This is a passive effect, so React runs it after the commit that mounted
   * the row. On that first run it set state the component already had, which
   * looked like a no-op and was not: by then the layout effect below had
   * already measured the row and replaced the guess with the answer, and this
   * put the guess back. The measured value returned a frame later, through the
   * `requestAnimationFrame` pass, and that frame is D-041 — an own message's
   * bubble painted 36.8px tall and grown to 48.8px 16ms after it appeared.
   *
   * Skipping the first run restores exactly nothing, because `useState` already
   * initialises to the same two values. What it stops doing is overwriting a
   * decision that was made after it.
   */
  const resetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const resetKey = `${measureKey} ${content}`;
    if (resetKeyRef.current === resetKey) return;
    const isFirstRun = resetKeyRef.current === null;
    resetKeyRef.current = resetKey;
    if (isFirstRun) return;
    footerReserveRef.current = 0;
    setFooterReserve(0);
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
    const handleViewportResize = () => {
      schedule();
    };

    // Measure once SYNCHRONOUSLY, before this frame is painted. Every pass used
    // to go through `requestAnimationFrame`, which runs after paint — so a
    // message appeared with the meta inline, then grew a row for it on the next
    // frame. Measured on a chat of 100 messages: 304 height changes after mount
    // and 1865px of total growth, every one of them an `inline -> anchored`
    // flip. It is also what broke the history anchor when older messages were
    // prepended, because the restored position was computed from heights that
    // were about to change.
    measure();
    // The later passes stay: fonts, images and a viewport change can all move
    // the answer after the first paint.
    schedule();
    const secondFrame = window.requestAnimationFrame(schedule);
    // Two nodes, not five. The paragraph, its content span and the bubble are
    // all nested inside the stack and resize with it, so observing them as well
    // only multiplied the callbacks: one resize produced five measurements per
    // message, on every message on screen.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    [stackRef.current ?? bubbleRef.current, footerRef.current]
      .filter(Boolean)
      .forEach((node) => observer?.observe(node as Element));
    window.addEventListener("resize", handleViewportResize);
    void whenFontsReady().then(schedule);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("resize", handleViewportResize);
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
        {/* A spacer, not the meta itself. It keeps the last line from running
            under the timestamp — and because it is the only thing left in the
            flow, the bubble still grows for a message that needs the room. */}
        {hasMeta && placement === "inline" && footerReserve > 0 && (
          <span
            aria-hidden="true"
            data-message-footer-reserve="true"
            style={{ display: "inline-block", width: `${footerReserve}px` }}
          />
        )}
      </p>
      {/* Pinned to the bubble's bottom right rather than flowing after the last
          word. A wrapped message takes its width from its LONGEST line, so a
          timestamp glued to a short final line sat in the middle of the bubble
          — measured at 348px, 328px and 157px from the right edge of a 560px
          bubble, against 13px for a single-line message. */}
      {hasMeta && placement === "inline" && (
        <span
          ref={footerRef}
          data-message-footer="true"
          className={cn(footerClassName, "absolute bottom-0 right-0 translate-y-[-1px]")}
        >
          {meta}
        </span>
      )}
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
  message, isEntering = false, isMe, isFirstInGroup, isLastInGroup,
  onJumpToReply, onReaction, onOpenMedia,
  onRetrySend, onEditFailedSend, onDiscardLocalMessage,
  isSelectionMode = false,
  messagesMap = {}, mediaVariant, senderAvatarVariant, deliveryState, groupReadInfo, onOpenGroupReadReceipts,
}: MessageBubbleProps) {
  // D-046. `.msg-appear` carries `will-change: opacity, transform` under a
  // comment saying the hint is dropped when the animation ends. Nothing dropped
  // it: measured, a hundred rows still held the class and the hint eighteen
  // seconds after the last one finished. This is what drops it, and because the
  // flag only ever goes from false to true for this mount, a later render can
  // no longer put the class back and replay the fade on a settled bubble.
  const [entranceSettled, setEntranceSettled] = useState(false);
  const [reactionsExpanded, setReactionsExpanded] = useState(false);
  // The overflow popover is placed by hand from its trigger, so it cannot
  // inherit the --kub-safe-* tokens through layout; it reads the unsafe areas
  // as numbers when it opens, never during render.
  const reactionOverflowSafeRef = useRef<SafeAreaInsets>(NO_SAFE_AREA_INSETS);
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
  // The id, through a selector. Without one the bubble subscribed to the whole
  // store, so a change anywhere in it re-rendered every message on screen, and
  // no `memo` above the bubble could prevent that: a component's own
  // subscription is not a prop.
  const currentUserId = useAppStore((state) => state.currentUser?.id);
  const actor = resolveMessageActor(message);
  const actorName = messageActorDisplayName(actor);
  const textContent = message.content ?? "";
  const mediaCaption = getVisibleMediaCaption(message);
  const mediaDimensions = getMessageMediaDimensions(message);
  // Sent without compression: the stored file is the original, and the preview
  // the sender uploaded beside it is what the conversation draws until the
  // worker's own copy is ready. The viewer is what opens the original.
  const uncompressedMedia = (message.type === "image" || message.type === "video")
    && isUncompressedMedia(message.media_metadata);
  const originalPreview = message.type === "image" && uncompressedMedia ? resolveOriginalPreviewUrl(message) : null;
  const imageDisplayUrl = message.type === "image"
    ? mediaVariant?.previewUrl ?? originalPreview?.url ?? message.media_url
    : message.media_url;
  const imageDimensions = message.type === "image" && mediaVariant?.previewWidth && mediaVariant?.previewHeight
    ? { width: mediaVariant.previewWidth, height: mediaVariant.previewHeight }
    : mediaDimensions;
  /**
   * The width of whatever `imageDisplayUrl` points at, and of nothing else.
   *
   * `imageDimensions` cannot answer this, which is the trap: it is chosen on
   * `previewWidth && previewHeight` while the URL above is chosen on
   * `previewUrl`, and those are not the same condition. `media_variants.width`
   * is nullable, so a preview row that carries an address but no width sends
   * `imageDimensions` to `mediaDimensions` — the ORIGINAL's metadata — while
   * the element is showing the preview. Declaring the original's width on the
   * preview's address is the same lie as the hardcoded `1280w`, just harder to
   * see, and no `thumbWidth < mainWidth` guard can catch it because the
   * original really is the larger number.
   *
   * Keyed on `previewUrl` so the width and the address can never come from
   * different rows. Unknown stays unknown, and the caller drops the set.
   */
  const imageDisplayWidth = message.type === "image"
    ? (mediaVariant?.previewUrl
      ? mediaVariant.previewWidth ?? null
      : originalPreview
        ? originalPreview.width
        : mediaDimensions?.width ?? null)
    : null;
  const videoPosterUrl = message.type === "video" ? mediaVariant?.videoPosterUrl : undefined;
  const videoPlaybackUrl = message.type === "video" && message.media_url
    ? selectVideoPlaybackUrl({
      originalUrl: message.media_url,
      video720pUrl: mediaVariant?.video720pUrl,
      mediaMetadata: message.media_metadata,
    })
    : message.media_url;
  const textLayoutKind = getMessageTextLayoutKind(message.type, textContent);
  const widthClasses = getMessageWidthClasses(textLayoutKind);
  const stackStyle = getMessageStackStyle(textLayoutKind);

  // If the bubble unmounts while the overflow is closing, the pending timer
  // must not set state on a torn-down component.
  useEffect(() => () => {
    if (reactionOverflowCloseTimer.current) clearTimeout(reactionOverflowCloseTimer.current);
  }, []);

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
    const safe = reactionOverflowSafeRef.current;
    const maxWidth = Math.min(320, window.innerWidth - 16 - safe.left - safe.right);
    const width = Math.min(popoverRect?.width ?? 220, maxWidth);
    const height = popoverRect?.height ?? 44;
    const topBelow = triggerRect.bottom + 6;
    const top = topBelow + height <= window.innerHeight - 8 - safe.bottom
      ? topBelow
      : Math.max(8 + safe.top, triggerRect.top - height - 6);
    const left = clampNumber(
      triggerRect.right - width,
      8 + safe.left,
      Math.max(8 + safe.left, window.innerWidth - width - 8 - safe.right),
    );

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
    // Measured once per opening and again on resize, never on scroll: the
    // measurement adds and removes a probe element, and scroll fires per frame.
    reactionOverflowSafeRef.current = readSafeAreaInsets();
    updateReactionOverflowPosition();
    const handleResize = () => {
      reactionOverflowSafeRef.current = readSafeAreaInsets();
      updateReactionOverflowPosition();
    };
    const handleScroll = () => updateReactionOverflowPosition();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [reactionsExpanded, updateReactionOverflowPosition]);

  const reactionEntries = groupReactions(message.reactions, currentUserId);
  // Which emoji were already under the message at the last commit, so a chip
  // that appears afterwards — a double tap, a click, a choice from a menu — can
  // pop, and a conversation merely loading does not.
  const knownEmojiRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    knownEmojiRef.current = new Set(reactionEntries.map((group) => group.emoji));
  });
  const isVeryShortReactionText =
    message.type === "text" &&
    textLayoutKind === "short" &&
    textContent.trim().length <= 4 &&
    reactionEntries.length > 1;
  const visibleReactionLimit = Math.min(isVeryShortReactionText ? 1 : 2, reactionEntries.length);
  const visibleReactionEntries = reactionEntries.slice(0, visibleReactionLimit);
  const overflowReactionEntries = reactionEntries.slice(visibleReactionLimit);
  const hiddenReactionCount = overflowReactionEntries.reduce((total, group) => total + group.count, 0);
  const hasReactions = reactionEntries.length > 0;
  const isLocalSend = message.id.startsWith("tmp:") || Boolean(message.pending || message.checking || message.failed);
  const canReact = !isLocalSend;

  const canUseCompactReplyInline = canRenderCompactReplyInline(message, textLayoutKind, hasReactions);
  const canUseMeasuredTextMeta = message.type === "text" && textLayoutKind !== "preformatted" && !message.failed && !canUseCompactReplyInline;
  const footerMode = hasReactions ? "bottom-layer-reactions" : canUseCompactReplyInline ? "compact-reply-inline" : canUseMeasuredTextMeta ? "measured" : "meta-row";
  const showGroupReadIndicator = Boolean(groupReadInfo && groupReadInfo.readCount > 0);
  const groupReadLabel = groupReadInfo ? getGroupReadReceiptCompactLabel(groupReadInfo) : "";
  const groupReadAriaLabel = groupReadInfo ? getGroupReadReceiptAriaLabel(groupReadInfo) : "";
  // The footer is the same at every width now — the phone's «⋯» beside the
  // time is gone — so the width is no longer part of what re-measures it.
  const footerMeasureKey = [
    textContent,
    message.edited_at ?? "",
    message.pinned ? "pinned" : "",
    groupReadLabel,
    groupReadAriaLabel,
  ].join("|");
  const renderFooterContent = () => (
    <>
      {message.pinned && (
        <KubIcon name="pin" size={12} tone="muted" label="Закреплено" className="shrink-0" />
      )}
      {message.edited_at && (
        <span className="max-w-8 shrink truncate text-[12px] text-[color:var(--kub-muted)]" title="изменено">изм.</span>
      )}
      {/* `tabular-nums` already makes HH:MM a fixed width, so an extra minimum
          reserved 16px of dead space in every bubble and pushed the meta onto
          its own line far more often than it needed to. */}
      {/* D-005: the row can carry six things at one flat gap, and the eye lands
          on it straight after the message text. The sizes already form a
          coherent scale — 12px flags, 13px status, 20px actions, one type size
          — so what was missing was grouping, not resizing. A single step of
          extra space here separates the flags that precede it, pin and "изм.",
          from the status cluster of time and delivery, which belong together.
          Nothing is resized, moved or removed. */}
      <span
        className={cn(
          "inline-flex shrink-0 justify-end tabular-nums text-right text-[12px] leading-none text-[color:var(--kub-muted)]",
          (message.pinned || message.edited_at) && "ml-1",
        )}
      >
        {formatFullTime(message.created_at)}
      </span>
      {deliveryState?.isOwnMessage && !showGroupReadIndicator && (
        <span
          data-message-delivery-slot="true"
          className="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center"
        >
          <KubIcon
            name={deliveryState.icon}
            size={13}
            tone={deliveryState.tone}
            label={deliveryState.label}
          />
        </span>
      )}
      {groupReadInfo && showGroupReadIndicator && (
        <button
          type="button"
          // D-004: this is a button that opens the receipt list, but a bare
          // "3/3" after a timestamp looks like more text. The accessible name
          // was already right, so the information existed for assistive
          // technology and for nobody else. A faint chip and a focus outline
          // make it legible as something to press without adding a word to an
          // already crowded row.
          // The boundary is what makes it a control, and it has to be visible
          // against the surface it actually sits on. This chip only ever
          // appears on an OWN message — `getGroupReadReceiptInfo` returns null
          // for anyone else's — so its background is always the tinted own
          // bubble, `--kub-cyan` 22% over `--kub-surface`. Measured against
          // that, the faint fill alone came to 1.07:1 in dark and 1.11:1 in
          // light: the chip was in the markup and invisible on screen, so the
          // count still read as bare text. The accent border measures 3.78:1
          // and 3.90:1, which clears the 3:1 WCAG asks of a UI boundary. It is
          // the accent already used for this chip's hover and focus, so
          // nothing new is introduced.
          className="inline-flex h-4 items-center gap-0.5 rounded-full border border-[color:var(--kub-cyan)] bg-[var(--kub-surface-3)] px-1 text-[12px] leading-none text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-accent-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          title={groupReadAriaLabel}
          aria-label={groupReadAriaLabel}
          onClick={(event) => {
            event.stopPropagation();
            onOpenGroupReadReceipts?.();
          }}
        >
          <KubIcon name={groupReadInfo.allRead ? "doubleCheck" : "check"} size={13} tone={groupReadInfo.allRead ? "accent" : "muted"} />
          <span className="tabular-nums">{groupReadLabel}</span>
        </button>
      )}
    </>
  );
  const renderReactionChip = (group: ReactionGroup) => (
    <ReactionChip
      key={group.emoji}
      group={group}
      isNew={knownEmojiRef.current !== null && !knownEmojiRef.current.has(group.emoji)}
      onToggle={onReaction}
    />
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
            className="inline-flex h-[22px] items-center rounded-full border border-[color-mix(in_srgb,var(--kub-border-color)_72%,transparent)] bg-[color-mix(in_srgb,var(--kub-surface-2)_72%,transparent)] px-2 text-[12px] leading-none text-[color:var(--kub-muted)]"
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
      {hiddenReactionCount > 0 && reactionsExpanded && typeof document !== "undefined" && createPortal(
        <div
          ref={reactionOverflowPopoverRef}
          data-message-reactions-overflow="true"
          className="fixed z-[45] flex w-max flex-wrap items-center gap-1 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-1.5 kub-glow-soft"
          style={reactionOverflowStyle}
          onMouseEnter={clearReactionOverflowClose}
          onMouseLeave={closeReactionOverflowSoon}
          onFocus={openReactionOverflow}
          onBlur={closeReactionOverflowSoon}
          onClick={(event) => event.stopPropagation()}
        >
          {overflowReactionEntries.map((entry) => renderReactionChip(entry))}
        </div>,
        document.body
      )}

      <div
        className={cn(
          "flex gap-1.5 mb-0.5 group relative",
          isEntering && !entranceSettled && "msg-appear",
          // As wide as the conversation, so where a bubble can reach does not
          // depend on where it is placed; the stack inside is packed to its
          // sender's side, and the open side keeps the hover ❤️'s width free.
          "w-full max-w-full min-w-0",
          isMe ? "justify-end kub-message-reserve-left" : "justify-start kub-message-reserve-right",
        )}
        onAnimationEnd={(event) => {
          // Named, because the subtree runs other animations — a spinner, a
          // recording bar, a reaction popping — and any of them would
          // otherwise clear the flag before the entrance had played.
          if (event.animationName !== "msg-appear") return;
          if (event.target !== event.currentTarget) return;
          setEntranceSettled(true);
        }}
      >
        {!isMe && (
          <div className="flex-shrink-0 self-end mb-1 w-8">
            {isLastInGroup && actor.kind !== "system" && (
              <MessageActorAvatar actor={actor} size="sm" avatarVariant={senderAvatarVariant} />
            )}
          </div>
        )}

        <div
          ref={stackRef}
          className={cn("inline-flex min-w-0 max-w-full flex-col", widthClasses.stack, isMe ? "items-end" : "items-start")}
          style={stackStyle}
        >

          {!isMe && isFirstInGroup && actor.kind !== "system" && (
            <span className="ml-3 mb-0.5 inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[color:var(--kub-accent-text)]">
              <span className="truncate">{actorName}</span>
              {actor.kind === "bot" && (
                <span className="rounded-sm bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] px-1 py-px text-[9px] font-semibold uppercase text-[color:var(--kub-accent-text)]">
                  Бот
                </span>
              )}
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
              // The last bubble of a group squares its corner on the sender's
              // side. This replaces the old triangular tail, which was drawn
              // outside the bubble and overlapped the avatar.
              isMe && isLastInGroup ? "rounded-br-none" : "",
              !isMe && isLastInGroup ? "rounded-bl-none" : "",
              message.pending && "opacity-70",
              message.failed && "opacity-60",
              isSelectionMode && "cursor-pointer [&_a]:pointer-events-none [&_audio]:pointer-events-none [&_button]:pointer-events-none [&_input]:pointer-events-none [&_video]:pointer-events-none",
            )}
          >
            {/* Telegram Desktop's reaction button: beside the time, outside the
                bubble, for a hovering pointer only. It replaced the three-button
                cluster and the 104px lane kept free beside every message for it
                (D-071). Not in selection mode, where a click selects. */}
            {canReact && !isSelectionMode && (
              <QuickReactionButton messageId={message.id} placement={isMe ? "left" : "right"} onReact={onReaction} />
            )}

            {message.forwarded_from_id && (
              <div
                data-message-forwarded="true"
                className="mb-1 min-w-0 max-w-full truncate text-[12px] leading-snug text-[color:var(--kub-accent-text)]"
              >
                {message.forward_origin?.name ? (
                  <>
                    Переслано от <span className="font-semibold">{message.forward_origin.name}</span>
                  </>
                ) : (
                  "Переслано"
                )}
              </div>
            )}

            {message.reply_to_id && (() => {
              const replyMsg = messagesMap[message.reply_to_id] ?? message.reply_to ?? null;
              const replyName = replyMsg && !replyMsg.deleted_at
                ? resolveMessageActor(replyMsg).kind === "user" && replyMsg.user_id === currentUserId
                  ? "Вы"
                  : messageActorDisplayName(resolveMessageActor(replyMsg))
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
                    <span className="block truncate font-semibold leading-tight text-[color:var(--kub-accent-text)]">
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
                  originalUrl={message.media_url}
                  thumbUrl={mediaVariant?.thumbUrl}
                  thumbWidth={mediaVariant?.thumbWidth ?? null}
                  mainWidth={imageDisplayWidth}
                  title={message.content ?? "Фото"}
                  dimensions={imageDimensions}
                  original={uncompressedMedia}
                  onOpen={() => onOpenMedia?.({
                    type: "image",
                    url: message.media_url!,
                    title: message.content ?? "Фото",
                    ...(uncompressedMedia
                      ? {
                        original: true,
                        previewUrl: imageDisplayUrl && imageDisplayUrl !== message.media_url ? imageDisplayUrl : undefined,
                      }
                      : {}),
                  })}
                />
              </MediaWithCaption>
            ) : message.type === "video" && message.media_url ? (
              isRoundVideoMessage(message) ? (
                <RoundVideoMessage
                  url={videoPlaybackUrl ?? message.media_url}
                  originalUrl={message.media_url}
                  title={message.content ?? "Видео-сообщение"}
                  posterUrl={videoPosterUrl}
                  durationLabel={parseVideoMessageDuration(message.content, message)}
                  playbackItem={createPlaybackItemFromMessage(message, isMe, videoPlaybackUrl ?? message.media_url)}
                  onOpen={() => onOpenMedia?.({ type: "video", url: message.media_url!, title: message.content ?? "Видео-сообщение" })}
                />
              ) : (
                <MediaWithCaption caption={mediaCaption}>
                  <MediaVideo
                    url={videoPlaybackUrl ?? message.media_url}
                    originalUrl={message.media_url}
                    title={message.content ?? "Видео"}
                    posterUrl={videoPosterUrl}
                    dimensions={mediaDimensions}
                    playbackItem={createPlaybackItemFromMessage(message, isMe, videoPlaybackUrl ?? message.media_url)}
                    onOpen={() => onOpenMedia?.({
                      type: "video",
                      url: message.media_url!,
                      title: message.content ?? "Видео",
                      ...(uncompressedMedia ? { original: true } : {}),
                    })}
                  />
                </MediaWithCaption>
              )
            ) : message.type === "file" && message.media_url ? (
              <a
                href={message.media_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity text-[color:var(--kub-accent-text)]"
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
                  widthClasses.text
                )}
                meta={hasReactions ? null : renderFooterContent()}
                bubbleRef={bubbleRef}
                stackRef={stackRef}
                measureKey={footerMeasureKey}
                // Something above the text sets the bubble's width — a reply
                // preview, or a «Переслано от» label longer than the text.
                compound={Boolean(message.reply_to_id || message.forwarded_from_id)}
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
                className="mt-1 flex max-w-full flex-wrap items-center gap-1.5 border-t border-[color:var(--kub-rule)] pt-1 text-[12px] leading-none text-[color:var(--kub-danger-text)]"
              >
                <span className="mr-auto min-w-0">
                  {message.send_error ?? "Не удалось отправить"}
                </span>
                {onRetrySend && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-accent-text)] hover:bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)]"
                    onClick={(event) => { event.stopPropagation(); onRetrySend(); }}
                  >
                    Повторить
                  </button>
                )}
                {message.type === "text" && onEditFailedSend && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-muted)] kub-raise-hover"
                    onClick={(event) => { event.stopPropagation(); onEditFailedSend(); }}
                  >
                    Изменить
                  </button>
                )}
                {onDiscardLocalMessage && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-danger-text)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)]"
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

interface MediaDimensions {
  width: number;
  height: number;
}

/**
 * A picture in a bubble, with the same two recoveries the video bubbles have.
 *
 * A bubble paints before its variants are known, so its first `src` is the
 * original and `url` changes to the preview a moment later. Without the reset
 * below, one failed request — a blip, a dropped connection, an aborted load —
 * latched `failed` forever: the preview that arrived next was never rendered,
 * because the error box had replaced the `<img>` that would have loaded it.
 * Measured against production: aborting a single message image left the bubble
 * reading "Не удалось загрузить изображение" 28 seconds later in the same chat,
 * and only a reload cleared it. That is the "медиа не грузится, F5 помогает"
 * report.
 *
 * The second recovery is the fallback: a variant that fails hands the bubble
 * back to the original rather than giving up, which is what `MediaVideo` and
 * `RoundVideoMessage` already do.
 */
function MediaImage({
  url,
  originalUrl,
  thumbUrl,
  thumbWidth,
  mainWidth,
  title,
  dimensions,
  original = false,
  onOpen,
}: {
  url: string;
  originalUrl: string;
  thumbUrl?: string;
  thumbWidth?: number | null;
  mainWidth?: number | null;
  title: string;
  dimensions: MediaDimensions | null;
  /** Sent without compression; marked on the photo, as Telegram marks an HD one. */
  original?: boolean;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [usingOriginal, setUsingOriginal] = useState(false);
  const aspectStyle = getMediaAspectStyle(dimensions);
  const hasReservedAspect = Boolean(aspectStyle);
  const activeUrl = usingOriginal ? originalUrl : url;

  /**
   * Two candidates, each declared at the width it actually is.
   *
   * The descriptors used to be written `${thumbUrl} 360w, ${url} 1280w`, and
   * neither number came from anywhere: both were invented and neither variant
   * is normally either size. A thumb measured 154px wide while claiming 360w,
   * so on a 390px phone — where `sizes` asks for 86vw, about 335px — the
   * browser believed the thumb was enough detail and drew a 154px image into a
   * 335px box. The reverse costs bytes: an over-declared preview is skipped in
   * favour of a full-size original nobody needed.
   *
   * The real widths were already being carried from the database rows all
   * along, in `thumbWidth` and `previewWidth`; they simply never reached this
   * element. Both arrive as props rather than being re-derived here, because
   * the width has to come from the same row as the address it describes — see
   * `imageDisplayWidth` at the call site for what happens when it does not.
   *
   * If either width is unknown, the set is dropped rather than guessed. `src`
   * alone is correct — it is only the resolution hint that is missing — and a
   * wrong descriptor is worse than no descriptor, because the browser trusts
   * it absolutely and has no way to find out otherwise.
   */
  const srcSet = !usingOriginal && thumbUrl && thumbWidth && mainWidth && thumbWidth < mainWidth
    ? `${thumbUrl} ${thumbWidth}w, ${url} ${mainWidth}w`
    : undefined;

  useEffect(() => {
    setFailed(false);
    setUsingOriginal(false);
  }, [originalUrl, url]);

  const handleError = () => {
    if (activeUrl !== originalUrl) {
      setUsingOriginal(true);
      return;
    }
    setFailed(true);
  };

  if (failed) {
    return (
      <div className="flex max-w-[260px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить изображение.</span>
        <a href={originalUrl} target="_blank" rel="noreferrer" className="text-[color:var(--kub-accent-text)] hover:underline">
          Открыть
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block max-h-[340px] w-[min(360px,calc(100vw-7.5rem))] max-w-full overflow-hidden rounded-xl text-left sm:max-h-[380px] sm:w-[min(420px,70vw)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
      style={aspectStyle}
      aria-label="Открыть фото"
    >
      <img
        src={activeUrl}
        srcSet={srcSet}
        sizes={srcSet ? "(max-width: 640px) 86vw, 420px" : undefined}
        alt={title || "Фото"}
        loading="lazy"
        decoding="async"
        className={cn(
          "w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]",
          hasReservedAspect ? "h-full" : "max-h-[340px] sm:max-h-[380px]"
        )}
        onError={handleError}
      />
      {original && (
        // On the photo, not glass: rule 6 of the interface material keeps blur
        // out of what scrolls. White on black at 55% holds 4.7:1 even over a
        // white photograph.
        <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[12px] font-semibold leading-4 text-white">
          Оригинал
        </span>
      )}
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
  originalUrl,
  title,
  posterUrl,
  dimensions,
  playbackItem,
  onOpen,
}: {
  url: string;
  originalUrl: string;
  title: string;
  posterUrl?: string;
  dimensions: MediaDimensions | null;
  playbackItem: ChatMediaPlaybackItem | null;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [usingOriginal, setUsingOriginal] = useState(false);
  const mediaPlayback = useChatMediaPlayback();
  const replaceCurrentItemUrl = mediaPlayback.replaceCurrentItemUrl;
  const aspectStyle = getMediaAspectStyle(dimensions, 16 / 9);
  const activeUrl = usingOriginal ? originalUrl : url;
  const activePlaybackItem = useMemo(
    () => playbackItem && { ...playbackItem, url: activeUrl },
    [activeUrl, playbackItem],
  );

  useEffect(() => {
    setFailed(false);
    setUsingOriginal(false);
  }, [originalUrl, url]);

  useEffect(() => {
    if (activePlaybackItem) replaceCurrentItemUrl(activePlaybackItem.id, activePlaybackItem.url);
  }, [activePlaybackItem?.id, activePlaybackItem?.url, replaceCurrentItemUrl]);

  const handleError = () => {
    const fallbackUrl = getVideoPlaybackFallbackUrl(activeUrl, originalUrl);
    if (fallbackUrl) {
      if (activePlaybackItem) {
        replaceCurrentItemUrl(activePlaybackItem.id, fallbackUrl, { suppressCurrentError: true });
      }
      setUsingOriginal(true);
      return;
    }
    setFailed(true);
  };

  if (failed) {
    return (
      <div className="flex max-w-[280px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить видео.</span>
        <a href={originalUrl} target="_blank" rel="noreferrer" className="text-[color:var(--kub-accent-text)] hover:underline">
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
        src={activeUrl}
        poster={posterUrl}
        preload="metadata"
        controls
        playsInline
        className="block h-full max-h-[320px] w-full bg-black object-contain"
        onPlay={(event) => {
          if (activePlaybackItem) mediaPlayback.activate(activePlaybackItem, event.currentTarget);
        }}
        onError={handleError}
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
  originalUrl,
  title,
  posterUrl,
  durationLabel,
  playbackItem,
  onOpen,
}: {
  url: string;
  originalUrl: string;
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
  const [usingOriginal, setUsingOriginal] = useState(false);
  const mediaPlayback = useChatMediaPlayback();
  const activateMediaPlayback = mediaPlayback.activate;
  const replaceCurrentItemUrl = mediaPlayback.replaceCurrentItemUrl;
  const activeUrl = usingOriginal ? originalUrl : url;
  const activePlaybackItem = useMemo(
    () => playbackItem && { ...playbackItem, url: activeUrl },
    [activeUrl, playbackItem],
  );

  useEffect(() => {
    setFailed(false);
    setUsingOriginal(false);
  }, [originalUrl, url]);

  useEffect(() => {
    if (activePlaybackItem) replaceCurrentItemUrl(activePlaybackItem.id, activePlaybackItem.url);
  }, [activePlaybackItem?.id, activePlaybackItem?.url, replaceCurrentItemUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : getMediaMetadataNumberFromItem(activePlaybackItem) / 1000;
      setProgress(duration > 0 ? Math.min(1, Math.max(0, video.currentTime / duration)) : 0);
    };
    const onPlay = () => {
      setPlaying(true);
      if (activePlaybackItem) activateMediaPlayback(activePlaybackItem, video);
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
  }, [activateMediaPlayback, activePlaybackItem, activeUrl]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || failed) return;
    if (activePlaybackItem) {
      mediaPlayback.toggle(activePlaybackItem, video);
      return;
    }
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };
  const activeProgress = activePlaybackItem && mediaPlayback.isCurrent(activePlaybackItem.id) ? mediaPlayback.progress : progress;
  const isActivePlaying = activePlaybackItem && mediaPlayback.isCurrent(activePlaybackItem.id) ? mediaPlayback.isPlaying : playing;
  const isActiveMedia = Boolean(activePlaybackItem && mediaPlayback.isCurrent(activePlaybackItem.id));

  const handleError = () => {
    const fallbackUrl = getVideoPlaybackFallbackUrl(activeUrl, originalUrl);
    if (fallbackUrl) {
      if (activePlaybackItem) {
        replaceCurrentItemUrl(activePlaybackItem.id, fallbackUrl, { suppressCurrentError: true });
      }
      setUsingOriginal(true);
      return;
    }
    setFailed(true);
  };

  if (failed) {
    return (
      <div className="flex max-w-[240px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить видео.</span>
        <button type="button" onClick={onOpen} className="text-[color:var(--kub-accent-text)] hover:underline">
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
          "group relative z-10 block h-full w-full overflow-hidden rounded-full bg-black shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          isActiveMedia && "ring-2 ring-[color:var(--kub-cyan)]"
        )}
        aria-label={isActivePlaying ? "Пауза видео-сообщения" : "Воспроизвести видео-сообщение"}
      >
        <video
          ref={videoRef}
          src={activeUrl}
          poster={posterUrl}
          preload="metadata"
          playsInline
          className="h-full w-full object-cover"
          onError={handleError}
        />
        {!isActivePlaying && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors group-hover:bg-black/30">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 backdrop-blur">
              <KubIcon name="play" size={19} />
            </span>
          </span>
        )}
        {durationLabel && (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white backdrop-blur">
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

function createPlaybackItemFromMessage(
  message: MessageWithSender,
  isMe: boolean,
  mediaUrl: string | null | undefined = message.media_url,
): ChatMediaPlaybackItem | null {
  if (!mediaUrl || message.deleted_at) return null;
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
    url: mediaUrl,
    title: kind === "video_message"
      ? "Видеосообщение"
      : kind === "voice"
        ? "Голосовое сообщение"
        : kind === "audio"
          ? "Аудио"
          : "Видео",
    subtitle: isMe ? "Вы" : messageActorDisplayName(resolveMessageActor(message)),
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

export function isRoundVideoMessage(message: MessageWithSender): boolean {
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

export function getVisibleMediaCaption(message: MessageWithSender): string | null {
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
