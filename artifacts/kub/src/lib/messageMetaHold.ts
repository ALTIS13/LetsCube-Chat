/**
 * Keeping a measured anchored time where it is — D-080.
 *
 * `MessageBubble` decides whether a message's time sits inline, beside the last
 * line, or anchored on a row of its own, by measuring the layout it has just
 * rendered. Where the stack's cap is `max(16rem, 100% - var(--kub-action-lane))`
 * and `100%` is a bubble row shrink-wrapped around the message, the two
 * placements lay the message out at different widths, and each can measure its
 * way into the other. Measured on the DEV preview fixture at 768x1024 with a 40px
 * lane, for an own message whose text is 288.8px on one line and whose footer is
 * 83.3px:
 *
 * | | inline | anchored |
 * | --- | --- | --- |
 * | bubble row | 376px — the 92px spacer takes it to the full message row | 314.8px — shrink-wrapped around the text |
 * | cap, `row - 40px` | 336px | 274.8px |
 * | paragraph | 310px, one line of 288.8px | 248.8px, two lines, the last 45.4px |
 * | the decision | 288.8 + 83.3 + 8 > 352: anchored | 45.4 + 83.3 + 8 <= 290.8: inline |
 *
 * Every commit set the other placement, 52 times for each of two messages, until
 * React stopped with "Maximum update depth exceeded" and the error boundary
 * replaced the whole interface.
 *
 * The two answers are not equally informed. The spacer only ever adds to what the
 * message asks of its row, so the inline layout is always the one on the wider
 * row — here the full message row, the same geometry D-070's reach is read from.
 * The inline answer came from a row that shrank because the message was anchored,
 * and a cap that followed it down. So an anchored answer stands, and an inline
 * answer measured on the anchored layout cannot overturn it, until something
 * other than the placement changes.
 *
 * That holds only for an inline layout whose spacer is already rendered at the
 * width the decision reserves. Measured on Chromium at 1024x1024 with the same
 * lane: when Inter arrived the footer went from 75.1 to 83.3px, the reserve from
 * 84 to 92px, and the spacer on screen was still 84px. That row was 398.8px where
 * the inline layout's is 406.8px, 288.8 + 83.3 + 8 = 380.1 came out over its
 * 374.8px ceiling, and holding the answer kept nine messages anchored at a width
 * where both layouts, measured with the spacer in place, say inline. Such an
 * answer is taken, as it always was, and not held.
 *
 * Two things can show that something did.
 *
 * The inputs: everything the layout depends on except the placement — the text
 * and what the footer shows (`measureKey`), the message row's width, the stack's
 * computed cap with the viewport terms and the lane already resolved, the
 * computed cap of the box the bubble's row sits in (selection mode narrows it),
 * and the footer's width, which is the same in both placements and moves with the
 * face: 75.1px in the fallback and 83.3px in Inter for the same own message on
 * Chromium, where the row and the cap did not move at all.
 *
 * And the text, as the anchored layout set it. A hold keeps that layout on screen
 * and nothing about the placement changes it again, so if it sets the text
 * differently while the inputs stand still, something outside the placement did.
 * Measured on WebKit at 390x844: an own message was anchored at 1.65s with four
 * lines, the last 243.8px wide; at 3.12s WebKit laid the conversation out again,
 * and the same 309.4px paragraph held five lines, the last 68.1px, with the row,
 * the cap, the box, the footer and the face all unchanged. Held on the inputs
 * alone, seven messages kept a row for a time that fitted beside their last line.
 * So the first measurement of the anchored layout under a hold records its
 * paragraph box and last line, and a later difference releases the hold. In the
 * loop that record never changes, because the anchored layout is only ever
 * measured against itself.
 */

export type MetaPlacement = "inline" | "anchored";

export interface MetaPlacementInputs {
  /** The text and everything the footer renders from: the component's `measureKey`. */
  content: string;
  /** The `[data-message-id]` row's width, which is the list's rather than the message's. */
  row: number;
  /** The stack's computed `max-width`, verbatim. */
  cap: string;
  /** The computed `max-width` of the box the bubble's row sits in. */
  box: string;
  /** The footer's width, the same in both placements. */
  footer: number;
}

/**
 * The inputs as one comparable value. Widths are rounded to what a layout can
 * show — whole pixels for the row, a tenth for the footer — so sub-pixel noise
 * does not pass for a change.
 */
export function metaPlacementInputsKey(inputs: MetaPlacementInputs): string {
  // JSON, because the content can hold any separator a join would use.
  return JSON.stringify([
    inputs.content,
    Math.round(inputs.row),
    inputs.cap.trim(),
    inputs.box.trim(),
    Math.round(inputs.footer * 10) / 10,
  ]);
}

export interface MetaTextBox {
  /** The paragraph's box. */
  width: number;
  height: number;
  /** The width of the last line of text. */
  lastLine: number;
}

/** How a layout set the text, in whole pixels. */
export function metaTextKey(text: MetaTextBox): string {
  return [Math.round(text.width), Math.round(text.height), Math.round(text.lastLine)].join("x");
}

export interface MeasuredLayout {
  /** The placement the measured layout was rendered with. */
  placement: MetaPlacement;
  /** `metaPlacementInputsKey` of what it was measured under. */
  inputs: string;
  /** `metaTextKey` of how it set the text. */
  text: string;
  /**
   * For an inline layout: whether its spacer is rendered at the width the
   * decision reserves. Until it is, the row is narrower than the inline layout
   * really is, and the argument for holding its answer does not apply.
   */
  spacer: boolean;
}

export interface AnchoredHold {
  /** The inputs the anchored answer was measured under. */
  inputs: string;
  /** How the anchored layout set the text, once it has been measured; `null` until then. */
  text: string | null;
}

export interface HeldPlacement {
  placement: MetaPlacement;
  hold: AnchoredHold | null;
}

/**
 * What to render, given what a layout just measured.
 *
 * An anchored measurement always stands and becomes the hold. An inline
 * measurement stands unless it was taken on the anchored layout, under the inputs
 * the hold was measured under, with the text set the way the anchored layout set
 * it when it was first measured.
 */
export function holdMeasuredPlacement(measured: MetaPlacement, layout: MeasuredLayout, hold: AnchoredHold | null): HeldPlacement {
  if (measured === "anchored") {
    // An inline layout still waiting for its spacer is on a narrower row than
    // the inline layout: its answer is taken, as it always was, and not held.
    if (layout.placement === "inline" && !layout.spacer) return { placement: "anchored", hold: null };
    return {
      placement: "anchored",
      hold: { inputs: layout.inputs, text: layout.placement === "anchored" ? layout.text : null },
    };
  }
  if (hold === null || hold.inputs !== layout.inputs || layout.placement !== "anchored") {
    return { placement: "inline", hold: null };
  }
  // The first look at the anchored layout under this hold: this is what it does
  // to the text, and it is what a later look is compared with.
  if (hold.text === null) return { placement: "anchored", hold: { inputs: hold.inputs, text: layout.text } };
  if (hold.text === layout.text) return { placement: "anchored", hold };
  // The text moved while nothing the placement depends on did.
  return { placement: "inline", hold: null };
}
