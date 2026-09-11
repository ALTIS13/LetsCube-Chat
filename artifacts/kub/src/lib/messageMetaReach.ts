import { resolveCssLength } from "./cssLength.ts";

/**
 * How wide a message bubble's content can actually become — D-070.
 *
 * The inline-meta decision in `MessageBubble` compares the last line and the
 * timestamp against a ceiling, and that ceiling is the width the design ALLOWS:
 * the stack's `max-width`. It is blind to whatever else stands in the row. A
 * received message shares its row with the 32px avatar lane and a 6px gap, so
 * its bubble stops 38px short of the cap. Measured on the DEV preview fixture
 * at 390: the decision used 309.4px, the bubble's content could never exceed
 * 302px, and a last line of 238.3px chose inline. The spacer that reserves the
 * timestamp's room is an inline box in the same paragraph, so its 69px did not
 * fit the 302px the paragraph really had and it wrapped onto a line of its own —
 * a fourth line holding nothing but the time. 5 of 120 messages at 390, 4 at
 * 360, 4 on WebKit at 390, every one of them a received message.
 *
 * The width returned here does not depend on the placement, and that is the
 * whole point. The message row (`[data-message-id]`) is as wide as the list, not
 * as wide as its content; the stack's anchored edge — the left one for a
 * received message, the right one for an own — does not move when the spacer
 * comes or goes, only the far edge does; and the cap is resolved against the row
 * at its full reach. The same number comes back in both placements, so using it
 * to refuse a placement cannot make the two placements argue for each other.
 * This is D-027's feedback loop kept shut by construction rather than by care.
 *
 * It returns `null` — and the caller keeps the rule exactly as it was — where no
 * such number exists. That is the case when the cap carries a term resolved
 * against a row that is shrink-wrapped around the message:
 * `max(16rem, 100% - var(--kub-action-lane))` once the lane is 104px, which is
 * every width from 640px up. There the reach of a bubble depends on whether the
 * spacer is in the row, so the inline layout cannot be predicted from the
 * anchored one, and a constant would let a message with a long last word flip
 * on every pass. Measured at 768, 11 of 120 own messages still wrap their spacer
 * for that reason; closing it needs the lane decided, not a sharper guess.
 */
export interface MessageReachGeometry {
  /** The stack's computed `max-width`, as `getComputedStyle` reports it. */
  maxWidth: string;
  /** From the stack's anchored edge to the message row's far edge. */
  free: number;
  /** From the row's anchored edge to the message row's far edge. */
  rowReach: number;
  /** What stands in the row between the row's anchored edge and the stack's. */
  occupied: number;
  /** The bubble's horizontal padding and border, which the cap includes. */
  inset: number;
}

export function reachableContentWidth(geometry: MessageReachGeometry): number | null {
  const { maxWidth, free, rowReach, occupied, inset } = geometry;
  // A row still being laid out reports nothing sensible; no answer is better
  // than one computed from a width of zero.
  if (!(free > 0) || !(rowReach > 0) || !(occupied >= 0)) return null;

  const expression = maxWidth.trim();
  const capped = expression !== "" && expression !== "none";
  const capAtReach = capped ? resolveCssLength(expression, rowReach) : Number.POSITIVE_INFINITY;
  if (capAtReach === null) return null;
  const reach = Math.min(capAtReach, free);

  if (capped) {
    // The same cap, resolved as it would be if the row were shrink-wrapped
    // around a stack exactly this wide. If that is narrower, the cap follows the
    // row and the row follows the placement: there is no constant to give.
    const capWhenShrunk = resolveCssLength(expression, occupied + reach);
    if (capWhenShrunk === null || capWhenShrunk < reach - 0.5) return null;
  }

  const content = reach - inset;
  return content > 0 ? content : null;
}
