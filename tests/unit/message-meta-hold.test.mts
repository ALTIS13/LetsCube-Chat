import assert from "node:assert/strict";
import test from "node:test";

import {
  holdMeasuredPlacement,
  metaPlacementInputsKey,
  metaTextKey,
  type AnchoredHold,
  type MeasuredLayout,
  type MetaPlacement,
  type MetaPlacementInputs,
} from "../../artifacts/kub/src/lib/messageMetaHold.ts";

/**
 * D-080: an anchored time is not overturned by an inline answer measured on the
 * anchored layout, until something other than the placement changes.
 *
 * The numbers are measurements off the DEV preview fixture: the reproduction at
 * 768x1024 with `--kub-action-lane: 2.5rem`, and WebKit at 390x844 with the
 * shipped lane — `getComputedStyle(stack).maxWidth` verbatim, the widths from
 * `getBoundingClientRect`. Paragraph heights are the line count at the 22.75px
 * line height of 14px text. The conversation settling in the browser, and every
 * message keeping the placement it had before, is asserted in
 * `tests/e2e/message-meta-placement-settles.spec.ts` and
 * `tests/e2e/message-meta-spacer-line.spec.ts`. This file pins the rule.
 */

const LINE = 22.75;

const REPRODUCTION: MetaPlacementInputs = {
  content: "013. Можно подробнее про второй пункт?||||3/3|desktop-actions 013. Можно подробнее про второй пункт?",
  row: 376,
  cap: "min(660.48px, 560px, max(256px, 100% - 40px))",
  box: "100%",
  footer: 83.3,
};
const INPUTS = metaPlacementInputsKey(REPRODUCTION);

/** The two layouts of the reproduction, and what each of them measured. */
const INLINE_LAYOUT: MeasuredLayout = {
  placement: "inline",
  inputs: INPUTS,
  text: metaTextKey({ width: 310, height: LINE, lastLine: 288.8 }),
  spacer: true,
};
const ANCHORED_LAYOUT: MeasuredLayout = {
  placement: "anchored",
  inputs: INPUTS,
  text: metaTextKey({ width: 248.8, height: 2 * LINE, lastLine: 45.4 }),
  spacer: false,
};
const layoutOf = (placement: MetaPlacement) => (placement === "inline" ? INLINE_LAYOUT : ANCHORED_LAYOUT);
const measuredIn = (placement: MetaPlacement): MetaPlacement => (placement === "inline" ? "anchored" : "inline");

test("the reproduction settles on the answer measured on the wider row, after one change", () => {
  let placement: MetaPlacement = "inline";
  let hold: AnchoredHold | null = null;
  let changes = 0;
  // In the browser this alternated 52 times, until React gave up.
  for (let pass = 0; pass < 60; pass += 1) {
    const next = holdMeasuredPlacement(measuredIn(placement), layoutOf(placement), hold);
    if (next.placement !== placement) changes += 1;
    placement = next.placement;
    hold = next.hold;
  }
  assert.equal(placement, "anchored");
  assert.equal(changes, 1);
  assert.deepEqual(hold, { inputs: INPUTS, text: ANCHORED_LAYOUT.text });
});

test("both layouts of the reproduction report the same inputs", () => {
  // The message row, the cap, the box and the footer do not move with the
  // placement. The bubble row (376 against 314.8px) and the paragraph do, and
  // are not inputs.
  const inline = metaPlacementInputsKey({ ...REPRODUCTION, row: 376, footer: 83.3 });
  const anchored = metaPlacementInputsKey({ ...REPRODUCTION, row: 376.0, footer: 83.3 });
  assert.equal(inline, anchored);
});

test("an inline answer is taken as it comes when nothing is held", () => {
  assert.deepEqual(holdMeasuredPlacement("inline", INLINE_LAYOUT, null), { placement: "inline", hold: null });
  assert.deepEqual(holdMeasuredPlacement("inline", ANCHORED_LAYOUT, null), { placement: "inline", hold: null });
});

test("an anchored answer always stands; from the anchored layout it also records the text", () => {
  assert.deepEqual(holdMeasuredPlacement("anchored", INLINE_LAYOUT, null), {
    placement: "anchored",
    hold: { inputs: INPUTS, text: null },
  });
  assert.deepEqual(holdMeasuredPlacement("anchored", ANCHORED_LAYOUT, null), {
    placement: "anchored",
    hold: { inputs: INPUTS, text: ANCHORED_LAYOUT.text },
  });
  const wider = metaPlacementInputsKey({ ...REPRODUCTION, row: 512 });
  assert.deepEqual(holdMeasuredPlacement("anchored", { ...INLINE_LAYOUT, inputs: wider }, { inputs: INPUTS, text: ANCHORED_LAYOUT.text }), {
    placement: "anchored",
    hold: { inputs: wider, text: null },
  });
});

test("the first look at the anchored layout records how it set the text, and holds", () => {
  const hold: AnchoredHold = { inputs: INPUTS, text: null };
  assert.deepEqual(holdMeasuredPlacement("inline", ANCHORED_LAYOUT, hold), {
    placement: "anchored",
    hold: { inputs: INPUTS, text: ANCHORED_LAYOUT.text },
  });
});

test("a hold stands only against the anchored layout", () => {
  // An inline answer from an inline layout is that layout speaking for itself,
  // so there is nothing to overturn: no loop can come of taking it.
  const hold: AnchoredHold = { inputs: INPUTS, text: ANCHORED_LAYOUT.text };
  assert.deepEqual(holdMeasuredPlacement("inline", INLINE_LAYOUT, hold), { placement: "inline", hold: null });
});

test("an inline layout still waiting for its spacer is taken, not held", () => {
  // Chromium at 1024x1024 with a 40px lane, the same message a page load after
  // Inter arrived: the footer went from 75.1 to 83.3px, so the reserve moved from
  // 84 to 92px while the rendered spacer was still 84px. The row was 398.8px
  // where the inline layout's is 406.8px, and 288.8 + 83.3 + 8 = 380.1 came out
  // over its 374.8px ceiling. Held, the message stayed anchored at a width where
  // both layouts, measured properly, say inline.
  const inputs = metaPlacementInputsKey({ ...REPRODUCTION, row: 612, cap: "min(880.64px, 560px, max(256px, 100% - 40px))" });
  const waiting: MeasuredLayout = {
    placement: "inline",
    inputs,
    text: metaTextKey({ width: 372.8, height: LINE, lastLine: 288.8 }),
    spacer: false,
  };
  const anchored: MeasuredLayout = {
    placement: "anchored",
    inputs,
    text: metaTextKey({ width: 248.8, height: 2 * LINE, lastLine: 45.4 }),
    spacer: false,
  };
  const first = holdMeasuredPlacement("anchored", waiting, null);
  assert.deepEqual(first, { placement: "anchored", hold: null });
  // So the anchored layout's inline answer is taken, and the next inline layout,
  // with its spacer, decides.
  assert.deepEqual(holdMeasuredPlacement("inline", anchored, first.hold), { placement: "inline", hold: null });
  // A spacer in place is what makes the same answer a hold.
  assert.deepEqual(holdMeasuredPlacement("anchored", { ...waiting, spacer: true }, null), {
    placement: "anchored",
    hold: { inputs, text: null },
  });
});

test("a change to any input releases the hold", () => {
  const hold: AnchoredHold = { inputs: INPUTS, text: ANCHORED_LAYOUT.text };
  const changed: Record<string, MetaPlacementInputs> = {
    // A wider window or a closed sidebar.
    "the message row": { ...REPRODUCTION, row: 408 },
    // The shipped lane again, or another viewport's `vw` term.
    "the cap": { ...REPRODUCTION, cap: "min(660.48px, 560px, max(256px, 100% - 104px))" },
    // Selection mode.
    "the box": { ...REPRODUCTION, box: "calc(100% - 36px)" },
    // The same own message's footer in the fallback face and in Inter, on Chromium.
    "the footer": { ...REPRODUCTION, footer: 75.1 },
    // An edit, a pin, a new read count.
    "the content": { ...REPRODUCTION, content: "013. Можно подробнее про второй пункт?|2026-09-11||4/4|desktop-actions" },
  };
  for (const [name, inputs] of Object.entries(changed)) {
    const key = metaPlacementInputsKey(inputs);
    assert.notEqual(key, INPUTS, `${name}: a change must produce different inputs`);
    assert.deepEqual(
      holdMeasuredPlacement("inline", { ...ANCHORED_LAYOUT, inputs: key }, hold),
      { placement: "inline", hold: null },
      `${name}: a changed layout must get a fresh decision`,
    );
  }
});

test("the text moving under the same inputs releases the hold", () => {
  // WebKit at 390x844, an own message under the shipped lane: anchored at 1.65s
  // with four lines, laid out again at 3.12s with five in the same paragraph.
  const inputs = metaPlacementInputsKey({
    content: "063. Длинный абзац о планах на неделю",
    row: 362,
    cap: "min(335.399994px, max(256px, 100%))",
    box: "100%",
    footer: 109.3,
  });
  const before: MeasuredLayout = {
    placement: "anchored",
    inputs,
    text: metaTextKey({ width: 309.4, height: 4 * LINE, lastLine: 243.8 }),
    spacer: false,
  };
  const after: MeasuredLayout = {
    placement: "anchored",
    inputs,
    text: metaTextKey({ width: 309.4, height: 5 * LINE, lastLine: 68.1 }),
    spacer: false,
  };

  const held = holdMeasuredPlacement("anchored", before, null);
  assert.deepEqual(held, { placement: "anchored", hold: { inputs, text: before.text } });
  assert.deepEqual(holdMeasuredPlacement("inline", after, held.hold), { placement: "inline", hold: null });
  // And the same look again is still held: only a difference releases.
  assert.deepEqual(holdMeasuredPlacement("inline", before, held.hold), held);
});

test("an anchored answer on text that moved keeps the hold, with the new text", () => {
  const moved: MeasuredLayout = { ...ANCHORED_LAYOUT, text: metaTextKey({ width: 248.8, height: 3 * LINE, lastLine: 240 }) };
  assert.deepEqual(holdMeasuredPlacement("anchored", moved, { inputs: INPUTS, text: ANCHORED_LAYOUT.text }), {
    placement: "anchored",
    hold: { inputs: INPUTS, text: moved.text },
  });
});

test("sub-pixel noise is not a change", () => {
  const noisyInputs = metaPlacementInputsKey({ ...REPRODUCTION, row: 376.2, footer: 83.31, cap: ` ${REPRODUCTION.cap} ` });
  assert.equal(noisyInputs, INPUTS);
  const noisyText = metaTextKey({ width: 248.6, height: 2 * LINE + 0.2, lastLine: 45.2 });
  assert.equal(noisyText, ANCHORED_LAYOUT.text);
  const hold: AnchoredHold = { inputs: INPUTS, text: ANCHORED_LAYOUT.text };
  assert.deepEqual(holdMeasuredPlacement("inline", { placement: "anchored", inputs: noisyInputs, text: noisyText, spacer: false }, hold), {
    placement: "anchored",
    hold,
  });
});
