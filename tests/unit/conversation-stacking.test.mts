// What may raise itself above the conversation (D-129).
//
// The rule is data so that «may this box carry a z-index» can be answered
// without a browser, and so that the two numbers the round video used to carry
// cannot come back unnoticed — they were not a style choice, they were a claim
// about the header, the pinned capsule, the search panel and the composer, all
// four of which sit at `z-index: auto` on purpose.
//
// The source scan at the end is here because a constant can be imported and
// then have a utility written beside it in `cn(...)`; the class strings alone
// cannot see that.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LOWEST_PRODUCT_LEVEL,
  PRODUCT_STACKING_LEVELS,
  ROUND_VIDEO_OPEN_CLASS,
  ROUND_VIDEO_PLAYBACK_CLASS,
  conversationStackingOffenders,
  isProductStackingLevel,
  parseStackingUtility,
  raisesOutOfTheConversation,
  stackingLevels,
} from "../../artifacts/kub/src/lib/conversationStacking.ts";

const BUBBLE_SOURCE = fileURLToPath(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
);

/**
 * A source with its comments blanked, keeping every offset.
 *
 * Rule 9 of docs/operations/interface-material.md, learned twice already: a
 * scanner that reads prose as code turns writing *about* `z-10` into a
 * declaration of it — which is exactly what the note explaining why the two
 * z-indexes went away did on this test's first run. Blanked rather than
 * removed, so the ordering assertions below still compare real positions.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line, lead: string) => lead + " ".repeat(line.length - lead.length));
}

/** The body of `RoundVideoMessage`, which is the component D-129 was about. */
function roundVideoSource(): string {
  const source = withoutComments(readFileSync(BUBBLE_SOURCE, "utf8"));
  const start = source.indexOf("function RoundVideoMessage(");
  assert.ok(start > 0, "RoundVideoMessage is no longer a function in MessageBubble.tsx");
  // Up to the next top-level declaration, which is how this file is laid out.
  const end = source.indexOf("\nfunction ", start + 1);
  assert.ok(end > start, "RoundVideoMessage has no function after it; the scan would read the rest of the file");
  return source.slice(start, end);
}

test("a z-index utility is read whatever form it is written in", () => {
  assert.equal(parseStackingUtility("z-10"), 10);
  assert.equal(parseStackingUtility("z-0"), 0);
  assert.equal(parseStackingUtility("z-auto"), "auto");
  assert.equal(parseStackingUtility("z-[45]"), 45);
  assert.equal(parseStackingUtility("z-[100]"), 100);
  // A variant is not an escape hatch: a box raised under the pointer is raised.
  assert.equal(parseStackingUtility("hover:z-20"), 20);
  assert.equal(parseStackingUtility("md:focus-within:z-[60]"), 60);
  // The negative form, which rule 12 measured to cost the hit test.
  assert.equal(parseStackingUtility("-z-10"), -10);
  assert.equal(parseStackingUtility("z-[-1]"), -1);

  for (const nothing of ["z", "zoom-10", "grid-cols-10", "z-[calc(1+1)]", "text-z-10", "", "z-10px"]) {
    assert.equal(parseStackingUtility(nothing), null, `${nothing} is not a z-index utility`);
  }
});

test("only a level that leaves tree order counts as a raise", () => {
  assert.equal(raisesOutOfTheConversation("relative z-auto rounded-full"), false);
  assert.equal(raisesOutOfTheConversation("absolute z-0"), false);
  assert.equal(raisesOutOfTheConversation("absolute right-1 top-1"), false);

  assert.equal(raisesOutOfTheConversation("group relative z-10 block"), true);
  assert.equal(raisesOutOfTheConversation("absolute z-20"), true);
  assert.equal(raisesOutOfTheConversation("hover:z-10"), true);
  assert.equal(raisesOutOfTheConversation("relative -z-10"), true);
  assert.deepEqual(stackingLevels("relative z-0 hover:z-30"), [0, 30]);
});

test("the round video's controls declare no level, and the pre-fix ones are named", () => {
  assert.deepEqual(
    conversationStackingOffenders([
      { name: "playback button", className: ROUND_VIDEO_PLAYBACK_CLASS },
      { name: "open-in-viewer button", className: ROUND_VIDEO_OPEN_CLASS },
    ]),
    [],
  );

  // Exactly what the two carried before D-129, with nothing else changed.
  assert.deepEqual(
    conversationStackingOffenders([
      { name: "playback button", className: ROUND_VIDEO_PLAYBACK_CLASS.replace("group relative", "group relative z-10") },
      { name: "open-in-viewer button", className: ROUND_VIDEO_OPEN_CLASS.replace("top-1", "top-1 z-20") },
    ]),
    [
      { name: "playback button", levels: [10] },
      { name: "open-in-viewer button", levels: [20] },
    ],
  );
});

test("the controls keep the positioning tree order depends on", () => {
  // Dropping the z-indexes only works because all three boxes are positioned:
  // the ring `absolute`, this button `relative`, the corner one `absolute`.
  // A `static` box paints in the in-flow step, under every positioned sibling,
  // and the corner button would stop covering the video.
  assert.match(ROUND_VIDEO_PLAYBACK_CLASS, /(^|\s)relative(\s|$)/);
  assert.match(ROUND_VIDEO_OPEN_CLASS, /(^|\s)absolute(\s|$)/);
});

test("the vocabulary is the whole set of levels a portalled surface may take", () => {
  assert.deepEqual(PRODUCT_STACKING_LEVELS, {
    reactionOverflow: 45,
    panel: 60,
    supportWindow: 70,
    updateBanner: 80,
    mediaViewer: 90,
    modal: 95,
    banScreen: 100,
  });
  assert.equal(LOWEST_PRODUCT_LEVEL, 45);

  for (const level of Object.values(PRODUCT_STACKING_LEVELS)) {
    assert.equal(isProductStackingLevel(level), true, `${level} is in the vocabulary`);
  }
  // The numbers the conversation used to carry, and the gaps somebody would
  // reach for between two real levels.
  for (const invented of [10, 20, 30, 40, 50, 65, 85, 99, 9999]) {
    assert.equal(isProductStackingLevel(invented), false, `${invented} is not a level anybody has defended`);
  }
  // A modal has to be reachable from a full-screen photo, and nothing may cover
  // the ban screen. Those two orderings are the reason the numbers are what
  // they are, so they are asserted rather than left to the table above.
  assert.ok(PRODUCT_STACKING_LEVELS.modal > PRODUCT_STACKING_LEVELS.mediaViewer);
  assert.ok(PRODUCT_STACKING_LEVELS.banScreen > PRODUCT_STACKING_LEVELS.modal);
});

test("nothing in the round video's markup declares a z-index", () => {
  const source = roundVideoSource();
  const written = source
    .split(/[\s"'`{}()<>,]+/)
    .map(parseStackingUtility)
    .filter((level) => level !== null);
  assert.deepEqual(written, [], "a z-index is written in RoundVideoMessage again");
});

test("the round video uses the shared classes, in the order that is the layering", () => {
  const source = roundVideoSource();
  assert.ok(source.includes("ROUND_VIDEO_PLAYBACK_CLASS"), "the playback button no longer uses the shared class");
  assert.ok(source.includes("ROUND_VIDEO_OPEN_CLASS"), "the corner button no longer uses the shared class");

  // Order by position, not by presence: tree order *is* the layering now.
  const ring = source.indexOf("VideoCircleProgressRing");
  const playback = source.indexOf("ROUND_VIDEO_PLAYBACK_CLASS");
  const open = source.indexOf("ROUND_VIDEO_OPEN_CLASS");
  assert.ok(ring > 0 && playback > 0 && open > 0, "one of the circle's three boxes is gone");
  assert.ok(ring < playback, "the progress ring must be rendered before the video, or it covers it");
  assert.ok(playback < open, "the corner button must be rendered last, or the video covers it");
});
