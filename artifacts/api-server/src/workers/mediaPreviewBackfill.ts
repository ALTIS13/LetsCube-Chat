/**
 * Which stored `image_preview` rows were written under the old sizing rule.
 *
 * D-116 changed how a preview is sized: the long side still stops at 1280, but
 * the short side now keeps at least 720 when the source has it. The worker does
 * not regenerate a variant that already exists, so without a backfill only new
 * uploads get the better preview and a tall picture sent last week keeps its
 * thin one. This module decides which rows that is.
 *
 * Deliberately self-contained: no imports at all. `mediaVariantRules.ts` reaches
 * its neighbour through an extensionless relative path, which Node's resolver
 * cannot follow, so a test that imported this through it would need the bundle
 * built first. With nothing to resolve, `node --test` reads this source
 * directly and the selection can be proven without a build step.
 *
 * The sizing rule itself is *not* copied here. `previewNeedsRegeneration` takes
 * it as a function, so the operator tool can hand it the worker's own
 * `imagePreviewSize` and a test can hand it the client's
 * `originalPreviewDimensions` — which an existing test already pins to be the
 * same arithmetic. A second copy of that formula is exactly the drift the
 * original defect was made of.
 */

/** The long side every `image_preview` was capped at before D-116, and still is. */
export const LEGACY_PREVIEW_LONG_SIDE_CAP = 1280;

/**
 * The width a tall preview keeps when the source has it.
 *
 * Mirrors `IMAGE_PREVIEW_MIN_SHORT_SIDE` in `mediaVariantRules.ts`. It is read
 * here only to recognise a row that sits below it; the resizing is still the
 * worker's.
 *
 * It was 720 while the bubble's cap was 480. Both moved together on 2026-09-12,
 * when the owner asked for the cap higher: the box on the phone the tester
 * holds is 310x550 CSS, which is 930x1650 device pixels.
 */
export const PREVIEW_BACKFILL_MIN_SHORT_SIDE = 930;

export interface PreviewSize {
  width: number;
  height: number;
}

/** A preview sizing rule: the box a source of this size should be drawn into. */
export type PreviewSizer = (width: number, height: number, max: number) => PreviewSize;

/** What a stored variant row has to say for itself before anything is decided. */
export interface StoredPreviewRow {
  variant_kind?: string | null;
  status?: string | null;
  width?: number | null;
  height?: number | null;
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The size the old rule produced, for a source of this size.
 *
 * Only the long side was capped, and nothing was ever enlarged. Kept here
 * because the selection's soundness is a claim *about* these rows: a test can
 * generate the exact geometry production holds rather than guessing at it.
 */
export function legacyPreviewSize(
  width: number,
  height: number,
  max: number = LEGACY_PREVIEW_LONG_SIDE_CAP,
): PreviewSize {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether a stored preview is worth reading the original for, from the row alone.
 *
 * Three facts about the old rule make this decidable without touching storage:
 *
 * - A preview whose long side is under the cap was never scaled at all, so it
 *   is the source's own size, and the new rule leaves a source alone too.
 * - A preview lying down is already right: the floor applies only to a picture
 *   taller than it is wide, because that is the one whose *width* — the axis
 *   that fills the bubble — is its short side. A landscape picture fills the
 *   bubble with its long side, which the cap leaves at 1280, well past the
 *   floor, so the new rule returns exactly the box it already has.
 * - A tall preview at the cap whose width already clears the floor is inside
 *   the rule too.
 * - A preview above the cap cannot have come from the old rule; it was written
 *   by the new one and is already right.
 *
 * So the candidates are the upright rows sitting exactly at the cap with a
 * width under the floor. This never misses a row that needs regenerating — the
 * sweep in `tests/unit/media-preview-backfill.test.mjs` holds that — and it
 * admits one harmless false positive, a source whose long side is itself
 * exactly 1280, which regenerates to the size it already has.
 */
export function isPreviewBackfillCandidate(
  width: number | null | undefined,
  height: number | null | undefined,
): boolean {
  // A row with no recorded size says nothing about its geometry. Reading it as
  // a candidate would put every unknown row through a regeneration on a guess.
  if (!isPositive(width) || !isPositive(height)) return false;
  const longSide = Math.max(width, height);
  if (longSide !== LEGACY_PREVIEW_LONG_SIDE_CAP) return false;
  // Square counts as lying down: nothing is floored at 1:1 either.
  if (height <= width) return false;
  return width < PREVIEW_BACKFILL_MIN_SHORT_SIDE;
}

/**
 * The ground truth, once the original's real size is known.
 *
 * The backfill tool does not use this — it would have to download every
 * original to ask — but it is what `isPreviewBackfillCandidate` is checked
 * against, and it is what the worker effectively re-derives when it rewrites
 * the row.
 */
export function previewNeedsRegeneration(
  recorded: PreviewSize,
  source: PreviewSize,
  sizePreview: PreviewSizer,
  max: number = LEGACY_PREVIEW_LONG_SIDE_CAP,
): boolean {
  const wanted = sizePreview(source.width, source.height, max);
  return wanted.width !== recorded.width || wanted.height !== recorded.height;
}

/**
 * The rows to hand back to the worker, out of everything the table holds.
 *
 * `status` is load-bearing and not a formality. A `failed` row may carry
 * `source_missing` or `source_unreadable`, which is the worker's only memory of
 * a dead end; reviving one as work to do would reintroduce D-034, where the
 * worker re-fetched objects that were never coming back. Only a row that
 * currently serves a reader is eligible to be replaced.
 */
export function selectPreviewBackfillRows<T extends StoredPreviewRow>(rows: readonly T[]): T[] {
  return rows.filter(
    (row) =>
      row.variant_kind === "image_preview" &&
      row.status === "ready" &&
      isPreviewBackfillCandidate(row.width, row.height),
  );
}
