import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_BUBBLE_MAX_ASPECT,
  MEDIA_BUBBLE_MAX_HEIGHT_PX,
  MEDIA_BUBBLE_MIN_ASPECT,
  mediaBubbleAspectRatio,
  mediaBubbleStyle,
} from "../../artifacts/kub/src/lib/mediaBubbleLayout.ts";

/**
 * D-116, «не зумится и качество плохое»: how much of a picture the bubble shows.
 *
 * The owner chose option B on 2026-09-12 — a taller bubble, still centre
 * cropped — so the contract worth pinning is not "the clamp is 0.5" but what a
 * reader ends up seeing. Every case below therefore states a share of the
 * picture, computed the way the browser computes it, and the constants are only
 * the inputs. Written the other way round the test would pass on a rule that
 * had the right numbers and the wrong arithmetic.
 */

/** The bubble's width: `min(360px, 100vw - 7.5rem)` on a phone, `min(420px, 70vw)` from `sm`. */
const BOX = {
  phone360: 240,
  phone390: 270,
  phone430: 310,
  desktop: 420,
} as const;

const TALL_SCREENSHOT = { width: 1290, height: 2796 };
const TALL_AS_STORED = { width: 1080, height: 2341 };
const PHOTO_4_3 = { width: 4032, height: 3024 };
const PHOTO_3_2 = { width: 6000, height: 4000 };
const WIDE = { width: 2400, height: 1000 };

/**
 * What a bubble of `boxWidth` shows of a picture, as CSS arrives at it: the box
 * takes the reserved aspect and stops at the cap, then `object-cover` scales the
 * picture until it covers that box and crops whatever hangs over.
 */
function drawn(
  source: { width: number; height: number },
  boxWidth: number,
  clamp: { min: number; max: number; cap: number } = {
    min: MEDIA_BUBBLE_MIN_ASPECT,
    max: MEDIA_BUBBLE_MAX_ASPECT,
    cap: MEDIA_BUBBLE_MAX_HEIGHT_PX,
  },
) {
  const ratio = Math.min(clamp.max, Math.max(clamp.min, source.width / source.height));
  const boxHeight = Math.min(boxWidth / ratio, clamp.cap);
  const scale = Math.max(boxWidth / source.width, boxHeight / source.height);
  return {
    boxHeight,
    heightShare: boxHeight / (source.height * scale),
    widthShare: boxWidth / (source.width * scale),
  };
}

const percent = (share: number) => Math.round(share * 100);

test("a tall screenshot is shown as the owner chose: taller box, most of the picture", () => {
  assert.equal(mediaBubbleAspectRatio(TALL_SCREENSHOT), MEDIA_BUBBLE_MIN_ASPECT);
  assert.equal(mediaBubbleAspectRatio(TALL_AS_STORED), MEDIA_BUBBLE_MIN_ASPECT);

  // The owner's number is the 390px phone: 58% before, 82% after.
  assert.equal(percent(drawn(TALL_SCREENSHOT, BOX.phone390).heightShare), 82);
  assert.equal(
    percent(drawn(TALL_SCREENSHOT, BOX.phone390, { min: 0.72, max: 1.9, cap: 340 }).heightShare),
    58,
    "what the same screenshot showed before this change",
  );

  // And what every other width in the matrix gets. The narrow phone is the one
  // case the cap does not bite: 240x480 is exactly the reserved aspect.
  assert.equal(percent(drawn(TALL_SCREENSHOT, BOX.phone360).heightShare), 92);
  assert.equal(percent(drawn(TALL_SCREENSHOT, BOX.phone430).heightShare), 71);
  assert.equal(percent(drawn(TALL_SCREENSHOT, BOX.desktop).heightShare), 53);

  // Tall pictures are cropped top and bottom only — never narrowed.
  for (const boxWidth of Object.values(BOX)) {
    const box = drawn(TALL_SCREENSHOT, boxWidth);
    assert.ok(Math.abs(box.widthShare - 1) < 1e-9, `narrowed at ${boxWidth}px`);
    assert.ok(box.boxHeight <= MEDIA_BUBBLE_MAX_HEIGHT_PX, `past the cap at ${boxWidth}px`);
  }
  assert.equal(drawn(TALL_SCREENSHOT, BOX.phone360).boxHeight, MEDIA_BUBBLE_MAX_HEIGHT_PX);
});

test("an ordinary photograph is drawn exactly as it was", () => {
  for (const source of [PHOTO_4_3, PHOTO_3_2]) {
    const ratio = mediaBubbleAspectRatio(source);
    assert.ok(ratio !== null && ratio === source.width / source.height, "clamped a photograph that needed no clamping");
    for (const boxWidth of Object.values(BOX)) {
      const box = drawn(source, boxWidth);
      const before = drawn(source, boxWidth, { min: 0.72, max: 1.9, cap: 340 });
      assert.ok(Math.abs(box.heightShare - 1) < 1e-9, `cropped ${source.width}x${source.height} at ${boxWidth}px`);
      assert.ok(Math.abs(box.widthShare - 1) < 1e-9);
      assert.equal(box.boxHeight, before.boxHeight, `the box moved at ${boxWidth}px`);
      assert.ok(box.boxHeight < MEDIA_BUBBLE_MAX_HEIGHT_PX, "an ordinary photograph never reaches the cap");
    }
  }
});

test("the wide side is the one it always was", () => {
  // Deliberate: at 1.9 the bubble is already a strip 142px tall on a phone, so
  // widening the clamp buys a thinner picture rather than a fuller one, and a
  // panorama is read in the viewer. Nothing about a wide picture changed here.
  assert.equal(mediaBubbleAspectRatio(WIDE), MEDIA_BUBBLE_MAX_ASPECT);
  for (const boxWidth of Object.values(BOX)) {
    const box = drawn(WIDE, boxWidth);
    const before = drawn(WIDE, boxWidth, { min: 0.72, max: 1.9, cap: 340 });
    assert.equal(box.boxHeight, before.boxHeight);
    assert.equal(percent(box.widthShare), percent(before.widthShare));
    assert.ok(Math.abs(box.heightShare - 1) < 1e-9, "a wide picture is cropped at the sides, not top and bottom");
  }
  assert.equal(percent(drawn(WIDE, BOX.phone390).widthShare), 79);

  // 16:9 is inside the clamp and is not touched at all.
  const sixteenNine = mediaBubbleAspectRatio({ width: 1920, height: 1080 });
  assert.ok(sixteenNine !== null && Math.abs(sixteenNine - 16 / 9) < 1e-12);
});

test("a size that cannot be divided falls back instead of reserving a strip", () => {
  assert.equal(mediaBubbleAspectRatio(null), null, "nothing to reserve, and no fallback");
  assert.equal(mediaBubbleAspectRatio(undefined), null);
  const fallback = mediaBubbleAspectRatio(null, 16 / 9);
  assert.ok(fallback !== null && Math.abs(fallback - 16 / 9) < 1e-12);
  // 100/0 is Infinity, which the old rule turned into the widest strip it had.
  assert.equal(mediaBubbleAspectRatio({ width: 100, height: 0 }), 1);
  assert.equal(mediaBubbleAspectRatio({ width: 0, height: 0 }, 1.5), 1.5);
  assert.equal(mediaBubbleAspectRatio({ width: -4, height: 3 }), 1);
});

test("the style the box carries", () => {
  assert.deepEqual(mediaBubbleStyle(TALL_SCREENSHOT), { aspectRatio: "0.5000", maxHeight: "480px" });
  assert.deepEqual(mediaBubbleStyle(PHOTO_4_3), { aspectRatio: "1.3333", maxHeight: "480px" });
  assert.deepEqual(mediaBubbleStyle(WIDE), { aspectRatio: "1.9000", maxHeight: "480px" });
  // No aspect to reserve: the cap still travels, because without it the picture
  // has no box for `object-cover` to cover.
  assert.deepEqual(mediaBubbleStyle(null), { maxHeight: "480px" });
  assert.deepEqual(mediaBubbleStyle(null, 16 / 9), { aspectRatio: "1.7778", maxHeight: "480px" });
});
