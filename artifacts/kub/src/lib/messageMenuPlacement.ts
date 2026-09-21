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
  /** What the card belongs to — a face. Decides the vertical position. */
  anchor: BoxEdges;
  size: { width: number; height: number };
  /**
   * What the card must not cover — the drawn part of the anchor's own row.
   *
   * Decides the **horizontal** position, where `anchor` decides the vertical.
   * Absent, the anchor plays both parts, which is what this function did until
   * 2026-09-21 and is the whole of the defect it had.
   */
  avoid?: BoxEdges;
  gap?: number;
}

/**
 * A card **beside** the thing that opened it, clear of the row it lives in.
 *
 * ## The question this answers, and how it differs from `placeAnchored`
 *
 * `placeAnchored` centres a popover on its anchor and opens it above or below.
 * That is right for a reaction bar over a message — the anchor is wide and the
 * popover is short. It is wrong for a profile opened from a 32-point face at
 * the left edge of the conversation: centring a 320-point card on it puts three
 * quarters of it over the chat-list column.
 *
 * ## The correction of 2026-09-21, and the measurement behind it
 *
 * The first version opened beside the **anchor**, which is exactly what Discord
 * configures — read out of stable 615980, chunk 67878: the message author's
 * avatar passes `targetElementRef` = the avatar `<img>` and `position:"right"`,
 * and the popout component (module 922016) derives `align:"top"` from that
 * position, with `spacing: 8`, `autoInvert: true` and
 * `nudgeAlignIntoViewport: true`. Right of the face, top-aligned, eight points,
 * flip, clamp — the same four things this function does.
 *
 * **And it covered the message anyway**, because copying the configuration is
 * not copying the outcome. Measured at 1440 against the fixture: the avatar at
 * x 672..704, the bubble at **710..1044**, and the card landing at 712..1032 —
 * over 320 of the bubble's 334 points. The card took away precisely the context
 * the small tier exists to preserve.
 *
 * **The structural difference from the reference, which is why the same
 * configuration lands differently.** Discord's messages are full-width text
 * rows: the row *is* the column, so there is no space beside a row and its
 * popout necessarily overlaps one. Ours are **bubbles capped at about half the
 * pane** — the same measurement shows 380 points of empty conversation to the
 * right of that bubble, more than the 328 a card and its gap need. We have a
 * beside that Discord has not got, so not using it would be copying a
 * constraint instead of a decision.
 *
 * The precedent is in this very file: `placeAtPoint` already takes `avoid`, so
 * that a menu opening upwards «stops above the message rather than above the
 * pointer, so it never lies over the very message it acts on». This is that
 * idea on the other axis.
 *
 * ## The order it tries
 *
 * Right of the row, then left of it, then below it, then above it — and the
 * vertical position for the two sideways cases comes from the **anchor**, so
 * the card still reads as belonging to that face rather than to the row.
 */
export function placeBeside(
  input: BesideInput,
): { top: number; left: number; side: "right" | "left" | "below" | "above" } {
  const { viewport, safe, anchor, size } = input;
  const gap = input.gap ?? 8;
  // What must stay visible. Without one, the face plays both parts — which is
  // the shape this function had before the row was passed in.
  const avoid = input.avoid ?? anchor;
  const minLeft = safe.left + HORIZONTAL_MARGIN;
  const maxLeft = viewport.width - safe.right - HORIZONTAL_MARGIN - size.width;
  const minTop = safe.top + VERTICAL_MARGIN;
  const maxTop = viewport.height - safe.bottom - VERTICAL_MARGIN - size.height;

  const rightLeft = avoid.right + gap;
  const leftLeft = avoid.left - gap - size.width;
  // Room is measured against where the card would actually end, not against the
  // row: a card wider than the space left is not «fitting on the right» merely
  // because the row is.
  const fitsRight = rightLeft <= maxLeft;
  const fitsLeft = leftLeft >= minLeft;

  if (fitsRight || fitsLeft) {
    const side = fitsRight ? "right" : "left";
    const left = clamp(side === "right" ? rightLeft : leftLeft, minLeft, maxLeft);
    // Top-aligned with the **face** rather than centred on it. A centred card
    // moves as the anchor's height changes, and an avatar's height is the one
    // thing about a message row that varies least — so aligning the tops keeps
    // the card in the same place for every row it is opened from.
    return { top: Math.round(clamp(anchor.top, minTop, maxTop)), left: Math.round(left), side };
  }

  // Neither side is free — a narrow window, or a very wide message. Then the
  // honest answer is vertical, which is what every other anchored menu in this
  // product does: below the row where that fits, above it where it does not,
  // and aligned to the face's own x so it still points at somebody.
  const belowTop = avoid.bottom + gap;
  const aboveTop = avoid.top - gap - size.height;
  const side = belowTop <= maxTop || aboveTop < minTop ? "below" : "above";
  const top = clamp(side === "below" ? belowTop : aboveTop, minTop, maxTop);
  return { top: Math.round(top), left: Math.round(clamp(anchor.left, minLeft, maxLeft)), side };
}
