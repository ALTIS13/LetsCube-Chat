/**
 * How large a picture is drawn inside a chat bubble.
 *
 * D-116, «не зумится и качество плохое»: a 1290x2796 screenshot had its aspect
 * clamped to 0.72 inside a box at most 340 px tall and was then centre-cropped,
 * so a 390 px phone showed 58% of its height — and the top and the bottom of a
 * screenshot are where the thing being shown usually is.
 *
 * The owner chose option B on 2026-09-12: a taller bubble that shows most of a
 * tall picture, still centre-cropped rather than letterboxed over a blurred
 * fill. A picture's aspect may go down to 0.5 and the box may be 550 px tall.
 *
 * The cap was 480 px until the owner saw the frames and asked for it higher.
 * At 480 how much showed depended on how wide the phone was: 82% at 390 px but
 * only 71% at 430 px, and the tester's iPhone is a 430. At 550 that phone shows
 * 82% — the number the owner approved — and the narrower phones are held by the
 * 0.5 clamp rather than by the cap, at 92% on both 390 and 360. A desktop goes
 * from 53% to 60%.
 *
 * The wide side is left where it was. At 1.9 the bubble is already a strip
 * 142 px tall on a phone; letting a panorama spread wider buys a thinner
 * picture rather than a fuller one, and a panorama is read in the viewer.
 *
 * What moves and what does not: an ordinary photograph is inside both clamps
 * and asks for a box shorter than 550 px at every width, so 4:3 and 3:2 are
 * drawn exactly as before. On a phone the cap no longer bites at all — twice
 * the bubble's width is reached first, and that is the 0.5 clamp — while on a
 * desktop it bites below an aspect of about 0.76, so a portrait photograph
 * there shows more of itself too.
 *
 * A video keeps the old clamp; see `getVideoAspectStyle` in
 * `components/chat/MessageBubble.tsx`. The choice above was made about
 * pictures, and a video's box has its own height cap and its own controls.
 *
 * Imports nothing, so `node --test` loads it directly:
 * `tests/unit/media-bubble-layout.test.mts`.
 */

/** How tall a picture may be drawn, relative to its width. Below this the bubble is cropped. */
export const MEDIA_BUBBLE_MIN_ASPECT = 0.5;
/** How wide, as before this change. */
export const MEDIA_BUBBLE_MAX_ASPECT = 1.9;
/** Whatever the aspect asks for, the box stops here. One number, at every width. */
export const MEDIA_BUBBLE_MAX_HEIGHT_PX = 550;

export interface MediaBubbleDimensions {
  width: number;
  height: number;
}

/**
 * The aspect a bubble reserves for a picture, or null when there is nothing to
 * reserve and no fallback to reserve it with.
 *
 * A size that cannot be divided — zero, negative, not a number — falls back
 * rather than reserving `Infinity`, which the old rule turned into the widest
 * possible strip.
 */
export function mediaBubbleAspectRatio(
  dimensions: MediaBubbleDimensions | null | undefined,
  fallbackRatio?: number,
): number | null {
  if (!dimensions && !(fallbackRatio && fallbackRatio > 0)) return null;
  const measured = dimensions ? dimensions.width / dimensions.height : Number.NaN;
  const raw = Number.isFinite(measured) && measured > 0 ? measured : fallbackRatio ?? 1;
  return Math.min(MEDIA_BUBBLE_MAX_ASPECT, Math.max(MEDIA_BUBBLE_MIN_ASPECT, raw));
}

export interface MediaBubbleStyle {
  aspectRatio?: string;
  maxHeight: string;
}

/**
 * The inline style a picture's box carries: the reserved aspect, and the cap.
 *
 * The cap is written here rather than as a utility class so that the number
 * lives in one place — a class would have to repeat it at each breakpoint, and
 * the two copies would drift the first time one of them was tuned.
 */
export function mediaBubbleStyle(
  dimensions: MediaBubbleDimensions | null | undefined,
  fallbackRatio?: number,
): MediaBubbleStyle {
  const ratio = mediaBubbleAspectRatio(dimensions, fallbackRatio);
  return {
    ...(ratio === null ? {} : { aspectRatio: ratio.toFixed(4) }),
    maxHeight: `${MEDIA_BUBBLE_MAX_HEIGHT_PX}px`,
  };
}
