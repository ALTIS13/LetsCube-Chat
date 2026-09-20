import assert from "node:assert/strict";
import test from "node:test";

import {
  SURFACE_FORM_BOX,
  SURFACE_FORM_GUTTER,
  SURFACE_FORM_MEASURE,
  surfaceFormCapBinds,
  surfaceFormContentWidth,
} from "../../artifacts/kub/src/lib/surfaceMeasure.ts";

/**
 * The geometry of a full surface, pinned by literals rather than by itself.
 *
 * D-285 recorded the reason this file is written this way: its gutter mutation
 * came back green on the first pass because both assertions were expressed in
 * terms of the constant under test, so setting it to 0 turned them into «at
 * least −1 pixels», which every panel satisfies. **A contract that reads its
 * own subject cannot fail.** Every number below is written out.
 */

test("the form measure is Discord's 696, and the cap is that measure plus its own padding", () => {
  assert.equal(SURFACE_FORM_MEASURE, 696);
  assert.equal(SURFACE_FORM_GUTTER, 24);
  // 744. Written out rather than derived: the point of the cap is that it is
  // the padded box, and an assertion that recomputes the sum cannot tell the
  // two conventions apart.
  assert.equal(SURFACE_FORM_BOX, 744);
});

test("the cap binds only above a 744px pane, which is the window D-222 never measures", () => {
  // The four panes `bot-settings-container-queries.spec.ts` asserts literals
  // at. All four must be untouched, or that instrument goes red for a reason
  // that has nothing to do with the reader.
  assert.equal(surfaceFormCapBinds(700), false, "a 700pt window's whole pane");
  assert.equal(surfaceFormCapBinds(416), false, "768 less the 352pt list");
  assert.equal(surfaceFormCapBinds(390), false, "a phone");
  assert.equal(surfaceFormCapBinds(744), false, "exactly the cap is not above it");

  assert.equal(surfaceFormCapBinds(745), true);
  assert.equal(surfaceFormCapBinds(1088), true, "1440 less the list");
  assert.equal(surfaceFormCapBinds(1568), true, "1920 less the list");
});

test("a capped pane draws exactly 696, and an uncapped one is unchanged", () => {
  assert.equal(surfaceFormContentWidth(1088), 696, "1440 less the list, capped");
  assert.equal(surfaceFormContentWidth(1568), 696, "1920 less the list, the same column");

  // Below the cap the content is the pane less its own padding, which is what
  // these panes draw today and what D-222's literals were measured against.
  assert.equal(surfaceFormContentWidth(700), 652);
  assert.equal(surfaceFormContentWidth(416), 368);
  assert.equal(surfaceFormContentWidth(390), 342);
});

test("a nonsense pane answers with the measure rather than a negative column", () => {
  assert.equal(surfaceFormContentWidth(0), 696);
  assert.equal(surfaceFormContentWidth(-1), 696);
  assert.equal(surfaceFormContentWidth(Number.NaN), 696);
  assert.equal(surfaceFormCapBinds(Number.NaN), false);
  // Narrower than its own padding: zero, never below it.
  assert.equal(surfaceFormContentWidth(30), 0);
});
