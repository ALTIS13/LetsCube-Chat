import assert from "node:assert/strict";
import test from "node:test";

import {
  swipeActionFor,
  swipeCommits,
  swipeMayStartAt,
  swipeOffset,
  swipeProgress,
} from "../../artifacts/kub/src/lib/messageSwipe.ts";

/**
 * D-287: a swipe left on a message row replies, beside the long-press menu
 * rather than instead of it.
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
 *
 * The 30 pinned below is Android's own: `type=systemGestures` insets read off
 * both of the owner's phones, 30dp in from each edge, where the back gesture
 * lives in gesture navigation. A row swipe refuses to begin there.
 */

const CAN = { reply: true };

test("a finger that has barely moved has started nothing", () => {
  assert.equal(swipeActionFor(-12, 0, CAN), null);
  assert.equal(swipeActionFor(-13, 0, CAN), "reply");
});

test("only leftward is ours: rightward belongs to the platform's back gesture", () => {
  assert.equal(swipeActionFor(-40, 0, CAN), "reply");
  assert.equal(swipeActionFor(13, 0, CAN), null);
  assert.equal(swipeActionFor(40, 0, CAN), null);
  assert.equal(swipeActionFor(400, 0, CAN), null);
});

test("a scroll is not a swipe: the movement has to be clearly horizontal", () => {
  // 40 across against 30 down is 1.33x, below the 1.4x a swipe needs.
  assert.equal(swipeActionFor(-40, 30, CAN), null);
  assert.equal(swipeActionFor(-40, -30, CAN), null);
  // 40 across against 20 down is 2x, and is a swipe.
  assert.equal(swipeActionFor(-40, 20, CAN), "reply");
});

test("a message that cannot be replied to starts nothing", () => {
  assert.equal(swipeActionFor(-40, 0, { reply: false }), null);
});

test("a finger that went down in the platform's gesture inset may not swipe", () => {
  // A 411px phone viewport, which is what a 1080px screen at 420dpi gives.
  assert.equal(swipeMayStartAt(30, 411), true);
  assert.equal(swipeMayStartAt(29, 411), false);
  assert.equal(swipeMayStartAt(0, 411), false);
  assert.equal(swipeMayStartAt(381, 411), true);
  assert.equal(swipeMayStartAt(382, 411), false);
  assert.equal(swipeMayStartAt(411, 411), false);
  // The middle of any sensible viewport is always allowed.
  assert.equal(swipeMayStartAt(200, 411), true);
  assert.equal(swipeMayStartAt(720, 1440), true);
});

test("a viewport that makes no sense refuses rather than guesses", () => {
  assert.equal(swipeMayStartAt(100, 0), false);
  assert.equal(swipeMayStartAt(100, -1), false);
  assert.equal(swipeMayStartAt(Number.NaN, 411), false);
  assert.equal(swipeMayStartAt(100, Number.NaN), false);
  // Narrower than both insets together: nothing is far enough from either edge.
  assert.equal(swipeMayStartAt(30, 59), false);
});

test("the row follows the finger from where it started moving, and stops at 64", () => {
  // The first 12 are spent starting the gesture, so the row is still at 0.
  assert.equal(swipeOffset(-12), 0);
  assert.equal(swipeOffset(-32), -20);
  assert.equal(swipeOffset(-76), -64);
  assert.equal(swipeOffset(-400), -64);
});

test("a row never travels the way its action does not go", () => {
  assert.equal(swipeOffset(50), 0);
  assert.equal(swipeOffset(400), 0);
});

test("releasing at 48 replies, and at 47 does not", () => {
  assert.equal(swipeCommits(-48), true);
  assert.equal(swipeCommits(-47), false);
  assert.equal(swipeCommits(0), false);
  assert.equal(swipeCommits(64), false);
});

test("the indicator is full at the distance that acts, not at the distance the row stops", () => {
  assert.equal(swipeProgress(0), 0);
  assert.equal(swipeProgress(-24), 0.5);
  assert.equal(swipeProgress(-48), 1);
  assert.equal(swipeProgress(-64), 1);
});
