import assert from "node:assert/strict";
import test from "node:test";

import {
  swipeActionFor,
  swipeCommits,
  swipeOffset,
  swipeProgress,
} from "../../artifacts/kub/src/lib/messageSwipe.ts";

/**
 * D-287: reply and forward as a swipe on the message row, beside the long-press
 * menu rather than instead of it.
 *
 * Every number here is written as a literal rather than read back from the
 * module's own constants. An assertion spelled against the constant it means to
 * pin moves with it and stays green through the very change it exists to catch
 * — the trap this repository met on 2026-09-17.
 *
 * The distances come from Telegram for Android 12.10.3, measured on a 420dpi
 * device on 2026-09-20 (`docs/operations/reference-clients.md`, section 16): a
 * row starts moving after about 27dp of finger travel, then tracks it one to
 * one, and the action fires between 46dp and 50dp. Ours starts sooner — 12
 * rather than 27 — because the arrow is the only thing that says the gesture
 * exists, and a row that does not move until 27dp says it late.
 */

const BOTH = { reply: true, forward: true };

test("a finger that has barely moved has started nothing", () => {
  assert.equal(swipeActionFor(-12, 0, BOTH), null);
  assert.equal(swipeActionFor(12, 0, BOTH), null);
  assert.equal(swipeActionFor(-13, 0, BOTH), "reply");
  assert.equal(swipeActionFor(13, 0, BOTH), "forward");
});

test("left is reply and right is forward, and neither is the other", () => {
  assert.equal(swipeActionFor(-40, 0, BOTH), "reply");
  assert.equal(swipeActionFor(40, 0, BOTH), "forward");
});

test("a scroll is not a swipe: the movement has to be clearly horizontal", () => {
  // 40 across against 30 down is 1.33x, below the 1.4x a swipe needs.
  assert.equal(swipeActionFor(-40, 30, BOTH), null);
  assert.equal(swipeActionFor(40, -30, BOTH), null);
  // 40 across against 20 down is 2x, and is a swipe.
  assert.equal(swipeActionFor(-40, 20, BOTH), "reply");
  assert.equal(swipeActionFor(40, 20, BOTH), "forward");
});

test("a direction whose action this message does not offer starts nothing", () => {
  assert.equal(swipeActionFor(-40, 0, { reply: false, forward: true }), null);
  assert.equal(swipeActionFor(40, 0, { reply: false, forward: true }), "forward");
  assert.equal(swipeActionFor(-40, 0, { reply: true, forward: false }), "reply");
  assert.equal(swipeActionFor(40, 0, { reply: true, forward: false }), null);
  assert.equal(swipeActionFor(-40, 0, { reply: false, forward: false }), null);
  assert.equal(swipeActionFor(40, 0, { reply: false, forward: false }), null);
});

test("the row follows the finger from where it started moving, and stops at 64", () => {
  // The first 12 are spent starting the gesture, so the row is still at 0.
  assert.equal(swipeOffset(-12, "reply"), 0);
  assert.equal(swipeOffset(-32, "reply"), -20);
  assert.equal(swipeOffset(-76, "reply"), -64);
  assert.equal(swipeOffset(-400, "reply"), -64);
  assert.equal(swipeOffset(12, "forward"), 0);
  assert.equal(swipeOffset(32, "forward"), 20);
  assert.equal(swipeOffset(76, "forward"), 64);
  assert.equal(swipeOffset(400, "forward"), 64);
});

test("a row never travels the way its action does not go", () => {
  assert.equal(swipeOffset(50, "reply"), 0);
  assert.equal(swipeOffset(-50, "forward"), 0);
});

test("releasing at 48 acts, and at 47 does not", () => {
  assert.equal(swipeCommits(-48, "reply"), true);
  assert.equal(swipeCommits(-47, "reply"), false);
  assert.equal(swipeCommits(48, "forward"), true);
  assert.equal(swipeCommits(47, "forward"), false);
});

test("an offset that ran the other way never acts", () => {
  assert.equal(swipeCommits(64, "reply"), false);
  assert.equal(swipeCommits(-64, "forward"), false);
  assert.equal(swipeCommits(0, "reply"), false);
  assert.equal(swipeCommits(0, "forward"), false);
});

test("the indicator is full at the distance that acts, not at the distance the row stops", () => {
  assert.equal(swipeProgress(0), 0);
  assert.equal(swipeProgress(-24), 0.5);
  assert.equal(swipeProgress(24), 0.5);
  assert.equal(swipeProgress(-48), 1);
  assert.equal(swipeProgress(-64), 1);
  assert.equal(swipeProgress(64), 1);
});
