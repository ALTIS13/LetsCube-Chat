/**
 * Where a message's menus go, as arithmetic.
 *
 * Every menu here is placed by hand from a measured box, so none of them can
 * inherit the `--kub-safe-*` tokens through layout: the unsafe areas arrive as
 * numbers (`lib/safeArea.ts`) and are added to every margin. Rule 13 of
 * `docs/operations/interface-material.md`.
 *
 * Pure, so `node --test` can pin the cases a screenshot only shows one of: the
 * last message above the composer, a message under the header, a message
 * taller than the screen.
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface BoxEdges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export interface PhoneMenuInput {
  viewport: Viewport;
  safe: Insets;
  /** The message bubble, where it is now. */
  bubble: BoxEdges;
  bar: { width: number; height: number };
  card: { width: number; height: number };
  /** A received message hangs from the left, an own one from the right. */
  align: "start" | "end";
}

export interface PhoneMenuPlacement {
  /**
   * How far the message is lifted, in pixels. Positive moves it up. A message
   * sitting on the composer is lifted so the card fits under it, which is what
   * Telegram does; a message under the header is lowered so the bar fits above.
   */
  lift: number;
  bar: { top: number; left: number };
  card: { top: number; left: number };
}

/** Vertical breathing room between the message, the bar and the card. */
export const PHONE_MENU_GAP = 8;
const VERTICAL_MARGIN = 8;
const HORIZONTAL_MARGIN = 12;

/**
 * The reaction bar above the message, the card below it, and the message moved
 * only as far as that needs.
 *
 * When everything cannot fit — a message taller than the screen — the message
 * stays where it can and the bar and card are clamped onto the screen over it.
 * Covering part of a very long message is the lesser cost: a menu off the
 * screen cannot be used at all.
 */
export function placePhoneMenu(input: PhoneMenuInput): PhoneMenuPlacement {
  const { viewport, safe, bubble, bar, card, align } = input;
  const topBound = safe.top + VERTICAL_MARGIN;
  const bottomBound = viewport.height - safe.bottom - VERTICAL_MARGIN;
  const needAbove = bar.height + PHONE_MENU_GAP;
  const needBelow = card.height + PHONE_MENU_GAP;

  let lift = Math.max(0, bubble.bottom + needBelow - bottomBound);
  const maxUp = Math.max(0, bubble.top - (topBound + needAbove));
  lift = Math.min(lift, maxUp);

  if (lift === 0 && bubble.top - needAbove < topBound) {
    const wantDown = topBound + needAbove - bubble.top;
    const roomDown = Math.max(0, bottomBound - needBelow - bubble.bottom);
    lift = -Math.min(wantDown, roomDown);
  }

  const top = bubble.top - lift;
  const bottom = bubble.bottom - lift;
  const leftBound = safe.left + HORIZONTAL_MARGIN;
  const rightBound = viewport.width - safe.right - HORIZONTAL_MARGIN;
  const horizontal = (width: number) =>
    align === "start"
      ? clamp(bubble.left, leftBound, rightBound - width)
      : clamp(bubble.right - width, leftBound, rightBound - width);

  return {
    // `|| 0` folds the -0 a clamped-away downward lift rounds to.
    lift: Math.round(lift) || 0,
    bar: {
      top: Math.round(clamp(top - needAbove, topBound, bottomBound - bar.height)),
      left: Math.round(horizontal(bar.width)),
    },
    card: {
      top: Math.round(clamp(bottom + PHONE_MENU_GAP, topBound, bottomBound - card.height)),
      left: Math.round(horizontal(card.width)),
    },
  };
}

export interface PointMenuInput {
  viewport: Viewport;
  safe: Insets;
  point: { x: number; y: number };
  size: { width: number; height: number };
  /**
   * The message the menu is for. A menu that has to open upwards stops above
   * the message rather than above the pointer, so it never lies over the top
   * of the very message it acts on.
   */
  avoid?: { top: number };
}

/**
 * A menu opened at the pointer: below and to the right of it where it fits,
 * flipped up where it does not, and never past the screen's safe edges.
 */
export function placeAtPoint(input: PointMenuInput): { top: number; left: number } {
  const { viewport, safe, point, size, avoid } = input;
  const minLeft = safe.left + VERTICAL_MARGIN;
  const maxLeft = viewport.width - safe.right - VERTICAL_MARGIN - size.width;
  const minTop = safe.top + VERTICAL_MARGIN;
  const maxTop = viewport.height - safe.bottom - VERTICAL_MARGIN - size.height;
  const below = point.y + 4;
  const aboveMessage = avoid ? avoid.top - 6 - size.height : Number.NEGATIVE_INFINITY;
  const above = aboveMessage >= minTop ? aboveMessage : point.y - 4 - size.height;
  const top = below <= maxTop ? below : above >= minTop ? above : clamp(below, minTop, maxTop);
  return { top: Math.round(top), left: Math.round(clamp(point.x, minLeft, maxLeft)) };
}

export interface AnchoredInput {
  viewport: Viewport;
  safe: Insets;
  anchor: BoxEdges;
  size: { width: number; height: number };
  /** Which way to open when both fit. */
  prefer: "above" | "below";
  gap?: number;
}

/** A popover beside a control: centred on it, above or below, clamped to the screen. */
export function placeAnchored(input: AnchoredInput): { top: number; left: number; side: "above" | "below" } {
  const { viewport, safe, anchor, size, prefer } = input;
  const gap = input.gap ?? 6;
  const minTop = safe.top + VERTICAL_MARGIN;
  const maxTop = viewport.height - safe.bottom - VERTICAL_MARGIN - size.height;
  const aboveTop = anchor.top - gap - size.height;
  const belowTop = anchor.bottom + gap;
  const fitsAbove = aboveTop >= minTop;
  const fitsBelow = belowTop <= maxTop;
  const side: "above" | "below" =
    prefer === "above" ? (fitsAbove || !fitsBelow ? "above" : "below") : fitsBelow || !fitsAbove ? "below" : "above";
  const top = clamp(side === "above" ? aboveTop : belowTop, minTop, maxTop);
  const centre = (anchor.left + anchor.right) / 2;
  const left = clamp(
    centre - size.width / 2,
    safe.left + VERTICAL_MARGIN,
    viewport.width - safe.right - VERTICAL_MARGIN - size.width,
  );
  return { top: Math.round(top), left: Math.round(left), side };
}

export interface BesideInput {
  viewport: Viewport;
  safe: Insets;
  anchor: BoxEdges;
  size: { width: number; height: number };
  gap?: number;
}

/**
 * A card **beside** the thing that opened it, which is a different question
 * from `placeAnchored`'s.
 *
 * `placeAnchored` centres a popover on its anchor and opens it above or below.
 * That is right for a reaction bar over a message — the anchor is wide and the
 * popover is short. It is wrong for a profile opened from a 32-point face at
 * the left edge of the conversation: centring a 320-point card on a 32-point
 * avatar puts three quarters of it over the chat-list column, so the card
 * straddles the divider and points at nothing.
 *
 * Discord's popout is beside the avatar, and that is the property that makes
 * the small tier cheap: the reader glances sideways and the conversation has
 * not moved. So this opens to the **right** of the anchor, flips to its left
 * when the right will not hold it, and aligns the card's top with the anchor's
 * — clamped, so a face near the bottom of the screen lifts the card rather
 * than pushing it off.
 *
 * `side` is returned for the caller that wants to point a tail at the anchor;
 * nothing is obliged to use it.
 */
export function placeBeside(input: BesideInput): { top: number; left: number; side: "right" | "left" } {
  const { viewport, safe, anchor, size } = input;
  const gap = input.gap ?? 8;
  const minLeft = safe.left + HORIZONTAL_MARGIN;
  const maxLeft = viewport.width - safe.right - HORIZONTAL_MARGIN - size.width;
  const minTop = safe.top + VERTICAL_MARGIN;
  const maxTop = viewport.height - safe.bottom - VERTICAL_MARGIN - size.height;

  const rightLeft = anchor.right + gap;
  const leftLeft = anchor.left - gap - size.width;
  // Room on the right is measured against where the card would actually end,
  // not against the anchor: a card wider than the space left is not «fitting
  // on the right» merely because the anchor is.
  const fitsRight = rightLeft <= maxLeft;
  const fitsLeft = leftLeft >= minLeft;
  const side: "right" | "left" = fitsRight || !fitsLeft ? "right" : "left";
  const left = clamp(side === "right" ? rightLeft : leftLeft, minLeft, maxLeft);

  // Top-aligned with the face rather than centred on it. A centred card moves
  // as the anchor's height changes, and an avatar's height is the one thing
  // about a message row that varies least — so aligning the tops keeps the
  // card in the same place for every row it is opened from.
  const top = clamp(anchor.top, minTop, maxTop);
  return { top: Math.round(top), left: Math.round(left), side };
}
