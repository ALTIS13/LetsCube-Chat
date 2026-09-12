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
 * fill. A picture's aspect may go down to 0.5 and the box may be 480 px tall,
 * so the same screenshot shows 82% of its height on a 390 px phone — 71% at
 * 430 px, and 92% at 360 px, where the box is not capped at all.
 *
 * The wide side is left where it was. At 1.9 the bubble is already a strip
 * 142 px tall on a phone; letting a panorama spread wider buys a thinner
 * picture rather than a fuller one, and a panorama is read in the viewer.
 *
 * What moves and what does not: an ordinary photograph is inside both clamps
 * and asks for a box shorter than 480 px at every width, so 4:3 and 3:2 are
 * drawn exactly as before. The cap bites below an aspect of about 0.56 on a
 * 390 px phone and below 0.875 on a desktop, so a portrait photograph on a
 * desktop — where the box used to stop at 380 px — now shows more of itself
 * too. That is the one number for both breakpoints doing its work.
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
export const MEDIA_BUBBLE_MAX_HEIGHT_PX = 480;

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
