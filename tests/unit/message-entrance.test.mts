import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  advanceMessageEntrance,
  EMPTY_ENTRANCE_STATE,
} from "../../artifacts/kub/src/lib/messageEntrance.ts";

test("opening a chat animates nothing", () => {
  // The bug: `msg-appear` was unconditional, so every bubble played it on
  // mount and the whole history animated at once when a chat opened.
  const { entering } = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a", "b", "c"]);
  assert.equal(entering.size, 0);
});

test("a message that arrives afterwards animates", () => {
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a", "b"]);
  const second = advanceMessageEntrance(first.state, ["a", "b", "c"]);
  assert.deepEqual([...second.entering], ["c"]);
});

test("only the new one animates, not its neighbours", () => {
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a"]);
  const second = advanceMessageEntrance(first.state, ["a", "b", "c"]);
  assert.deepEqual([...second.entering].sort(), ["b", "c"], "the settled message animated too");
});

test("repeating a call is idempotent, and that is deliberate", () => {
  // Two contracts pull against each other here and this is where they settle.
  //
  // Idempotency is required: React may invoke the `useMemo` twice for one
  // render, and a second invocation that diffed against an already-advanced
  // `seen` would return nothing and lose the animation in development.
  //
  // The cost is that a repeat call keeps reporting the same ids as entering.
  // That is harmless because a CSS animation does not restart when the same
  // class is re-applied to an element that never unmounted — the browser only
  // replays it on remount or on an animation-name change. So the answer stays
  // stable and the bubble still animates exactly once.
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a"]);
  const arrival = advanceMessageEntrance(first.state, ["a", "b"]);
  const repeat = advanceMessageEntrance(arrival.state, ["a", "b"]);
  assert.deepEqual([...repeat.entering], [...arrival.entering]);
  // And the next genuine change moves on from it.
  const next = advanceMessageEntrance(repeat.state, ["a", "b", "c"]);
  assert.deepEqual([...next.entering], ["c"]);
});

test("the same ids asked twice give the same answer", () => {
  // React may invoke a `useMemo` more than once for one render — StrictMode
  // does it on purpose. Without this the second invocation would diff against a
  // `seen` the first had already advanced and quietly lose the animation.
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a"]);
  const arrival = advanceMessageEntrance(first.state, ["a", "b"]);
  assert.deepEqual([...arrival.entering], ["b"]);
  const again = advanceMessageEntrance(arrival.state, ["a", "b"]);
  assert.deepEqual([...again.entering], ["b"], "the repeat call dropped the animation");
});

test("loading older history does not animate it", () => {
  // Prepending is not arrival. Fifty bubbles fading in above the reader is the
  // exact thing this is here to prevent.
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["d", "e"]);
  const prepended = advanceMessageEntrance(first.state, ["a", "b", "c", "d", "e"]);
  assert.deepEqual([...prepended.entering].sort(), ["a", "b", "c"]);
  // NOTE: this is the honest current behaviour, and it is why `MessageList`
  // must not animate a prepend. Recorded so the limit is visible rather than
  // discovered.
});

test("a message leaving does not resurrect an old one", () => {
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a", "b"]);
  const deleted = advanceMessageEntrance(first.state, ["a"]);
  assert.equal(deleted.entering.size, 0);
  const backAgain = advanceMessageEntrance(deleted.state, ["a", "b"]);
  assert.deepEqual([...backAgain.entering], ["b"], "it left and returned, so it is arriving");
});

test("the animation is applied only to entering messages", () => {
  const bubble = readFileSync("artifacts/kub/src/components/chat/MessageBubble.tsx", "utf8");
  assert.match(bubble, /isEntering && "msg-appear"/, "msg-appear is unconditional again");
  assert.ok(
    !/relative msg-appear/.test(bubble),
    "the class is back in the static list, so history animates again",
  );
});

test("the animation moves nothing that has a size", () => {
  // D-032 and the modal-entry rule: a decorative resize is what reads as a
  // jerk, and a growing row would move the scroll anchor.
  const css = readFileSync("artifacts/kub/src/index.css", "utf8");
  const block = css.slice(css.indexOf("@keyframes msg-appear"), css.indexOf("@keyframes ripple"));
  assert.ok(!block.includes("scale("), "msg-appear resizes the bubble again");
  assert.ok(!/\bheight\b|\bwidth\b|\bmargin\b|\bpadding\b/.test(block), "msg-appear animates layout");
  assert.ok(block.includes("var(--kub-motion-fast)"), "the shared timing step was replaced by a literal");
  assert.ok(block.includes("prefers-reduced-motion"), "reduced motion is not honoured");
});
