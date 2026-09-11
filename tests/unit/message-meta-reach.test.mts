import assert from "node:assert/strict";
import test from "node:test";

import { reachableContentWidth } from "../../artifacts/kub/src/lib/messageMetaReach.ts";

/**
 * D-070: the width a message bubble's content can actually reach.
 *
 * The inline-meta decision used the width the design allows, and a received
 * message never reaches it: its row also holds the avatar lane. Every number
 * below was read off the DEV preview fixture — `getComputedStyle(stack).maxWidth`
 * verbatim, and the edges from `getBoundingClientRect` — so these cases are the
 * layouts the component really meets, not ones built to pass.
 *
 * The geometry that decides the placement end to end is asserted in
 * `tests/e2e/message-meta-spacer-line.spec.ts`. This file pins the rule itself,
 * including the half that must refuse to answer.
 */

const PHONE_390 = "min(335.4px, 560px, max(256px, 100% + 0px))";
const DESKTOP_1440 = "min(1238.4px, 560px, max(256px, 100% - 104px))";
const TABLET_768 = "min(660.48px, 560px, max(256px, 100% - 104px))";

function near(actual: number | null, expected: number, message?: string) {
  assert.notEqual(actual, null, message ?? `expected ${expected}, got null`);
  assert.ok(Math.abs((actual as number) - expected) < 1e-6, message ?? `expected ${expected}, got ${actual}`);
}

test("a received message reaches the row minus its avatar lane, not the design cap", () => {
  // 390x844: message row 366px, the stack 38px in from its left edge (32px
  // avatar lane and a 6px gap), bubble padding and border 26px.
  const width = reachableContentWidth({ maxWidth: PHONE_390, free: 328, rowReach: 366, occupied: 38, inset: 26 });
  near(width, 302);

  // The reproduction: a 238.3px last line and a 60.4px time. The old ceiling
  // said it fits; the spacer the browser actually has to place does not.
  const oldCeiling = 335.4 - 26;
  assert.ok(238.3 + 60.4 + 8 <= oldCeiling, "the premise: the design cap accepts this line");
  assert.ok(238.3 + 69 > (width as number), "and the width the bubble reaches does not");
});

test("an own message is held by the design cap, which is the narrower of the two", () => {
  near(reachableContentWidth({ maxWidth: PHONE_390, free: 366, rowReach: 366, occupied: 0, inset: 26 }), 309.4);
});

test("the same cap as WebKit serialises it gives the same kind of answer", () => {
  // WebKit drops the 560px term and reports a 362px message row at 390.
  near(
    reachableContentWidth({ maxWidth: "min(335.399994px, max(256px, 100%))", free: 324, rowReach: 362, occupied: 38, inset: 26 }),
    298,
  );
});

test("a cap without a percentage is used as it stands", () => {
  near(reachableContentWidth({ maxWidth: "335.4px", free: 328, rowReach: 366, occupied: 38, inset: 26 }), 302);
  near(reachableContentWidth({ maxWidth: "335.4px", free: 366, rowReach: 366, occupied: 0, inset: 26 }), 309.4);
});

test("there is no answer where the cap follows a row that is shrink-wrapped around the message", () => {
  // Measured at 1440: a received row at full reach would allow 560px, but a
  // row wrapped around a 560px stack resolves `100% - 104px` to 494px. The
  // width depends on the placement, so a constant would be a guess.
  assert.equal(
    reachableContentWidth({ maxWidth: DESKTOP_1440, free: 970, rowReach: 1008, occupied: 38, inset: 26 }),
    null,
  );
  // 768, the case that still wraps its spacer: the cap is 272px at full reach
  // and 256px around a 272px stack.
  assert.equal(reachableContentWidth({ maxWidth: TABLET_768, free: 376, rowReach: 376, occupied: 0, inset: 26 }), null);
});

test("a floor that binds either way is a constant again", () => {
  // At a 300px reach `max(256px, 100% - 104px)` is 256px however the row is
  // sized, so the answer does not depend on the placement.
  near(
    reachableContentWidth({ maxWidth: "min(560px, max(256px, 100% - 104px))", free: 300, rowReach: 300, occupied: 0, inset: 26 }),
    230,
  );
});

test("an expression it cannot read, or a row still being laid out, gives no answer", () => {
  assert.equal(reachableContentWidth({ maxWidth: "min(86vw, 100%)", free: 328, rowReach: 366, occupied: 38, inset: 26 }), null);
  assert.equal(reachableContentWidth({ maxWidth: PHONE_390, free: 0, rowReach: 0, occupied: 0, inset: 26 }), null);
  assert.equal(reachableContentWidth({ maxWidth: PHONE_390, free: -12, rowReach: 366, occupied: 38, inset: 26 }), null);
  assert.equal(reachableContentWidth({ maxWidth: PHONE_390, free: 20, rowReach: 58, occupied: 38, inset: 26 }), null);
});

test("with no cap at all, the free space is the answer", () => {
  near(reachableContentWidth({ maxWidth: "none", free: 328, rowReach: 366, occupied: 38, inset: 26 }), 302);
});
