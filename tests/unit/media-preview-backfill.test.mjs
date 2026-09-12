import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_PREVIEW_LONG_SIDE_CAP,
  PREVIEW_BACKFILL_MIN_SHORT_SIDE,
  isPreviewBackfillCandidate,
  legacyPreviewSize,
  previewNeedsRegeneration,
  selectPreviewBackfillRows,
} from "../../artifacts/api-server/src/workers/mediaPreviewBackfill.ts";
import {
  ORIGINAL_PREVIEW_MIN_SHORT_SIDE,
  originalPreviewDimensions,
} from "../../artifacts/kub/src/lib/mediaCompression.ts";

/**
 * D-116 left the pictures that were already uploaded behind.
 *
 * The worker never regenerates a variant it has, so the new sizing rule reached
 * new uploads only, and a tall picture sent before the change kept the thin
 * preview the reader complained about. The backfill picks those rows out of
 * `media_variants` by geometry alone — no storage reads — so what matters is
 * that the cheap test agrees with the expensive one.
 *
 * `originalPreviewDimensions` stands in for the worker's `imagePreviewSize`
 * throughout. The two are the same arithmetic, and
 * `tests/server/media-variants-worker.test.mjs` pins that on nine sizes, so
 * proving the selection against this one proves it against the worker's.
 */

test("the shapes production actually holds are judged correctly", () => {
  // A 1080x2341 screenshot: 591x1280 under the old rule. This is the row the
  // owner is looking at when they say old and new pictures differ.
  assert.equal(isPreviewBackfillCandidate(591, 1280), true, "the thin screenshot must be picked up");
  assert.equal(
    isPreviewBackfillCandidate(1280, 591),
    false,
    "the same picture lying down is already right: the floor applies to the width, and a landscape picture fills the bubble with its long side",
  );

  // An ordinary photograph never changed size, so there is nothing to redo.
  assert.equal(isPreviewBackfillCandidate(1280, 960), false, "4:3 is untouched by the new rule");
  assert.equal(isPreviewBackfillCandidate(1280, 720), false, "16:9 lying down is the cap's business, not the floor's");
  assert.equal(isPreviewBackfillCandidate(720, 1280), true, "16:9 stood up is floored, and was not before");
  assert.equal(isPreviewBackfillCandidate(960, 1280), false, "4:3 stood up already clears the floor");
  assert.equal(isPreviewBackfillCandidate(1280, 1280), false, "square is not floored either");

  // Never scaled in the first place: the source was smaller than the cap.
  assert.equal(isPreviewBackfillCandidate(1000, 800), false, "under the cap, so it is its own size");
  assert.equal(
    isPreviewBackfillCandidate(1000, 600),
    false,
    "under the cap and past 16:9 alike: that row is a 1000x600 source the new rule also keeps whole",
  );

  // Above the cap can only have come from the new rule.
  assert.equal(isPreviewBackfillCandidate(720, 1561), false, "already regenerated");
  assert.equal(isPreviewBackfillCandidate(1440, 720), false, "already regenerated, lying down");

  // A row with no size recorded is not a guess to act on.
  assert.equal(isPreviewBackfillCandidate(null, null), false);
  assert.equal(isPreviewBackfillCandidate(1280, null), false);
  assert.equal(isPreviewBackfillCandidate(1280, 0), false);
});

test("the cheap filter never misses a preview the real rule would resize", () => {
  // The soundness claim, swept rather than asserted on examples. For every
  // source shape, write down what the OLD rule stored, ask the REAL rule what
  // it wants now, and require the row-only filter to have caught it.
  //
  // This is the test that fails if anyone narrows the filter: drop the `<`
  // in the short-side comparison, or pin the long side to something other than
  // the cap, and a real row goes unregenerated.
  const sides = [
    1, 2, 3, 240, 359, 360, 600, 719, 720, 721, 800, 960, 1000, 1079, 1080, 1280,
    1281, 1290, 1440, 1920, 2000, 2341, 2560, 2796, 3024, 4032, 5000, 12000, 20000,
  ];

  let regenerated = 0;
  let selected = 0;
  for (const width of sides) {
    for (const height of sides) {
      const stored = legacyPreviewSize(width, height);
      const needs = previewNeedsRegeneration(
        stored,
        { width, height },
        originalPreviewDimensions,
      );
      const picked = isPreviewBackfillCandidate(stored.width, stored.height);

      if (needs) {
        regenerated += 1;
        assert.ok(
          picked,
          `${width}x${height} stored as ${stored.width}x${stored.height} needs regenerating and was not selected`,
        );
      }

      if (picked) {
        selected += 1;
        // The other half, and the one soundness alone does not give: a filter
        // that selected everything would satisfy the implication above while
        // putting every picture in the product through a pointless rewrite.
        // Exactly one shape may be selected without needing it — the source
        // already sitting at the cap, which the test below spells out.
        if (!needs) {
          assert.equal(
            Math.max(width, height),
            LEGACY_PREVIEW_LONG_SIDE_CAP,
            `${width}x${height} was selected but did not need regenerating`,
          );
        }
      }
    }
  }

  // A sweep that selected nothing would pass both implications vacuously.
  assert.ok(regenerated > 0, "the sweep must actually contain work to do");
  assert.ok(selected >= regenerated);
});

test("the one false positive is a decision, not an accident", () => {
  // An upright source whose long side is already exactly the cap and whose
  // width is under the floor: 600x1280. The old rule stored it unscaled, and the
  // new rule also leaves it alone, because the floor only promises the width
  // 930 "when the source has it" — this one has 600.
  //
  // The row-only filter cannot tell this apart from a 938x2000 that genuinely
  // needs redoing, because both are stored as a 1280-tall, sub-930 preview. So
  // it is selected, the worker recomputes the same size, and writes the bytes
  // it already had. Wasteful for a handful of rows; the alternative is
  // downloading every original just to ask.
  const stored = legacyPreviewSize(600, 1280);
  assert.deepEqual(stored, { width: 600, height: 1280 });
  assert.equal(isPreviewBackfillCandidate(stored.width, stored.height), true, "it is selected");
  assert.equal(
    previewNeedsRegeneration(stored, { width: 600, height: 1280 }, originalPreviewDimensions),
    false,
    "and it did not need to be: the rewrite is a no-op, not a change",
  );
});

test("running the backfill twice finds nothing the second time", () => {
  // Idempotence, which is what makes the tool safe to stop half way and safe to
  // re-run. Whatever the new rule produces must fall outside the filter, or the
  // backfill would keep selecting the rows it just fixed, forever.
  // All upright: a lying-down picture is never selected now, so it has nothing
  // to be idempotent about.
  for (const [width, height] of [
    [1080, 2341],
    [1290, 2796],
    [1080, 1920],
    [1080, 20000],
    [1000, 3000],
  ]) {
    const stored = legacyPreviewSize(width, height);
    assert.equal(
      isPreviewBackfillCandidate(stored.width, stored.height),
      true,
      `${width}x${height} should be selected once`,
    );
    const regenerated = originalPreviewDimensions(width, height);
    assert.equal(
      isPreviewBackfillCandidate(regenerated.width, regenerated.height),
      false,
      `${width}x${height} was selected again after being fixed`,
    );
  }
});

test("only a ready image_preview is eligible to be replaced", () => {
  // Upright on purpose. Lying down, this row would be excluded by its geometry
  // and every case below would pass without the status filter doing anything.
  const thin = { width: 591, height: 1280 };
  const rows = [
    { id: "a", variant_kind: "image_preview", status: "ready", ...thin },
    { id: "b", variant_kind: "image_preview", status: "failed", ...thin },
    { id: "c", variant_kind: "image_preview", status: "stale", ...thin },
    { id: "d", variant_kind: "image_thumb", status: "ready", width: 360, height: 166 },
    { id: "e", variant_kind: "video_poster", status: "ready", ...thin },
    { id: "f", variant_kind: "image_preview", status: "ready", width: 1280, height: 960 },
    { id: "g", variant_kind: "image_preview", status: "ready", width: null, height: null },
  ];

  assert.deepEqual(
    selectPreviewBackfillRows(rows).map((row) => row.id),
    ["a"],
  );
});

test("a failed row is left alone because it is the worker's only memory", () => {
  // D-034: a `failed` row carrying `source_missing` or `source_unreadable` is
  // how the worker remembers not to fetch bytes that are never coming back. It
  // keeps no queue, so reviving one as work would restore the retry loop that
  // produced 826 warnings in seven hours. Spelled out separately from the table
  // above because it is a safety property, not a filter detail.
  // Upright, so that `status` is the only thing keeping it out: a lying-down row
  // is not a candidate anyway, and this test would then prove nothing.
  const failed = [
    { id: "gone", variant_kind: "image_preview", status: "failed", width: 591, height: 1280 },
  ];
  assert.deepEqual(selectPreviewBackfillRows(failed), []);
});

test("the floor the selection reads is the floor the product draws to", () => {
  // The selection asks "is this short side under the floor", so if the floor
  // moves and this number does not, the backfill silently stops finding the
  // rows it exists for — and every row it already fixed is at the wrong size
  // again and has to be found a second time.
  //
  // This is not hypothetical: it has already happened once. The floor is derived
  // from the bubble's box, the owner asked for the bubble taller on 2026-09-12,
  // and the assertion tying the two went red — which is how the floor came to
  // move from 720 to 930 and the selection here with it, rather than the
  // backfill quietly running against a number the product had left behind.
  assert.equal(PREVIEW_BACKFILL_MIN_SHORT_SIDE, ORIGINAL_PREVIEW_MIN_SHORT_SIDE);
});

test("the cap the selection reads is the cap the preview rule uses", () => {
  // If the long-side cap ever moves, the filter's middle branch stops matching
  // production and the whole selection quietly empties. Tie it to observable
  // behaviour rather than to a second copy of the number.
  assert.deepEqual(originalPreviewDimensions(4032, 3024), {
    width: LEGACY_PREVIEW_LONG_SIDE_CAP,
    height: 960,
  });
});
