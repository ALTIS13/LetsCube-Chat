/**
 * The photo viewer's zoom, as arithmetic and nothing else.
 *
 * "Нельзя увеличить фото": the page deliberately refuses page zoom —
 * `maximum-scale=1, user-scalable=no` in `index.html` — so a photo opened in the
 * viewer could only ever be seen fitted to the screen. Zoom belongs to the
 * viewer, and every decision it makes is here, where it can be tested without a
 * browser: how far a gesture scales, which point stays under the finger, and how
 * far the picture may travel before it would leave the stage.
 *
 * The model. At rest the picture is fitted into the stage and centred in it. A
 * zoom is a `scale` about the picture's own centre followed by a translation
 * `(x, y)` of that centre away from the stage's centre, which is exactly what
 * `transform: translate(x, y) scale(s)` with a centred origin draws. Every point
 * passed in is relative to the stage's centre, in CSS pixels.
 */

export interface ZoomState {
  /** 1 is the picture fitted to the stage. */
  scale: number;
  /** The picture centre's offset from the stage centre, in CSS pixels. */
  x: number;
  y: number;
}

export interface ZoomSize {
  width: number;
  height: number;
}

export interface ZoomPoint {
  x: number;
  y: number;
}

/** Fitted. A picture is never shown smaller than the stage allows. */
export const MIN_ZOOM = 1;
/** Four times fitted: enough to read a screenshot's small print on a phone. */
export const MAX_ZOOM = 4;
/** Where a double tap or a double click takes a picture that is at rest. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** Two taps further apart than this in time are two taps. */
export const DOUBLE_TAP_MS = 300;
/** Two taps further apart than this on screen are two taps. */
export const DOUBLE_TAP_SLOP_PX = 24;
/** A pointer that travels less than this between down and up has tapped, not dragged. */
export const TAP_SLOP_PX = 10;

/**
 * Below this the picture counts as at rest. Floating-point pinches and wheel
 * steps land near 1 rather than on it, and a picture 1.0004 times its fitted
 * size is not one anybody could pan.
 */
const REST_EPSILON = 1e-3;

export const ZOOM_AT_REST: ZoomState = Object.freeze({ scale: 1, x: 0, y: 0 });

export function isZoomed(state: ZoomState): boolean {
  return state.scale > MIN_ZOOM + REST_EPSILON;
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * How far the picture's centre may move from the stage's centre on each axis.
 *
 * On an axis where the scaled picture is wider than the stage, until its edge
 * meets the stage's edge — any further and the stage would show an empty band
 * beside a picture that could be dragged out of sight entirely. On an axis where
 * it is not wider, not at all: it stays centred, as it is at rest.
 */
export function panLimits(scale: number, picture: ZoomSize, stage: ZoomSize): ZoomPoint {
  return {
    x: Math.max(0, (picture.width * scale - stage.width) / 2),
    y: Math.max(0, (picture.height * scale - stage.height) / 2),
  };
}

/** Any state, brought inside the scale range and the pan limits it implies. */
export function clampZoom(state: ZoomState, picture: ZoomSize, stage: ZoomSize): ZoomState {
  const scale = clampScale(state.scale);
  if (scale <= MIN_ZOOM + REST_EPSILON) return ZOOM_AT_REST;
  const limits = panLimits(scale, picture, stage);
  return {
    scale,
    x: clampAxis(state.x, limits.x),
    y: clampAxis(state.y, limits.y),
  };
}

function clampAxis(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  // `+ 0` turns a -0 into 0, so a clamped state compares equal to the rest state.
  return Math.min(limit, Math.max(-limit, value)) + 0;
}

/**
 * Scale to `nextScale` while the point of the picture under `focus` stays under
 * it — the point that was tapped, the cursor, the fingers.
 *
 * The picture point under the focus is `(focus - offset) / scale`, and asking it
 * to be under the same focus after the change gives the new offset directly. The
 * limits are applied afterwards, so near an edge the picture stops at the edge
 * and the focus drifts by exactly what the limit took.
 */
export function zoomAt(
  state: ZoomState,
  nextScale: number,
  focus: ZoomPoint,
  picture: ZoomSize,
  stage: ZoomSize,
): ZoomState {
  const scale = clampScale(nextScale);
  const ratio = scale / state.scale;
  return clampZoom(
    {
      scale,
      x: focus.x - (focus.x - state.x) * ratio,
      y: focus.y - (focus.y - state.y) * ratio,
    },
    picture,
    stage,
  );
}

/** A double tap or a double click: in to `DOUBLE_TAP_ZOOM` at the point, or back to rest. */
export function toggleZoomAt(state: ZoomState, focus: ZoomPoint, picture: ZoomSize, stage: ZoomSize): ZoomState {
  if (isZoomed(state)) return ZOOM_AT_REST;
  return zoomAt(state, DOUBLE_TAP_ZOOM, focus, picture, stage);
}

/**
 * The scale factor for one wheel event with Ctrl held.
 *
 * In Chromium — the Windows shell's WebView2 among them — and in Firefox, a
 * trackpad pinch reaches the page as exactly that: wheel events with `ctrlKey`
 * set and small fractional deltas. Safari sends a pinch as its own gesture
 * events instead, which nothing here reads. A mouse wheel sends a hundred
 * pixels a notch. The delta is bounded before it is used so a single
 * notch is a comfortable step rather than a jump to the limit, and a pinch stays
 * proportional to the fingers. Negative deltas zoom in, as on every platform.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;
  // DOM_DELTA_LINE and DOM_DELTA_PAGE, in the pixels a browser would scroll.
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
  const bounded = Math.max(-50, Math.min(50, pixels));
  return Math.exp(-bounded * 0.01);
}

/** What a two-finger gesture remembers from the moment the second finger landed. */
export interface PinchStart {
  state: ZoomState;
  distance: number;
  midpoint: ZoomPoint;
}

/**
 * A pinch, computed from where it started rather than accumulated per move, so
 * rounding cannot drift over a long gesture. The picture point that was under
 * the fingers' midpoint follows the midpoint, which is also what makes a
 * two-finger drag pan.
 */
export function pinchZoom(
  start: PinchStart,
  distance: number,
  midpoint: ZoomPoint,
  picture: ZoomSize,
  stage: ZoomSize,
): ZoomState {
  if (!(start.distance > 0) || !(distance > 0)) return start.state;
  const scale = clampScale(start.state.scale * (distance / start.distance));
  const ratio = scale / start.state.scale;
  return clampZoom(
    {
      scale,
      x: midpoint.x - (start.midpoint.x - start.state.x) * ratio,
      y: midpoint.y - (start.midpoint.y - start.state.y) * ratio,
    },
    picture,
    stage,
  );
}

/**
 * Whether a one-finger drag on the picture is the viewer's to handle.
 *
 * Only while zoomed. At rest a drag moves nothing here, and it must stay free
 * for whatever surrounds the picture — a swipe to the next photo, a swipe to
 * close — so that those gestures and panning can never both answer one drag.
 */
export function claimsDrag(state: ZoomState): boolean {
  return isZoomed(state);
}

/** A drag that started at `start`, moved by `delta`. Nothing moves at rest. */
export function panBy(start: ZoomState, delta: ZoomPoint, picture: ZoomSize, stage: ZoomSize): ZoomState {
  if (!claimsDrag(start)) return start;
  return clampZoom({ scale: start.scale, x: start.x + delta.x, y: start.y + delta.y }, picture, stage);
}

export interface ZoomTap {
  /** Milliseconds, from the event's `timeStamp`. */
  time: number;
  x: number;
  y: number;
}

/** Whether `next` completes a double tap begun by `previous`. */
export function isDoubleTap(previous: ZoomTap | null, next: ZoomTap): boolean {
  if (!previous) return false;
  const elapsed = next.time - previous.time;
  return elapsed >= 0
    && elapsed <= DOUBLE_TAP_MS
    && Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP_PX;
}

/** The distance and midpoint of two pointers, for a pinch. */
export function pinchGeometry(a: ZoomPoint, b: ZoomPoint): { distance: number; midpoint: ZoomPoint } {
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/** The CSS transform for a state; `none` at rest, so a picture at rest is drawn exactly as before. */
export function zoomTransform(state: ZoomState): string {
  if (!isZoomed(state) && state.x === 0 && state.y === 0) return "none";
  return `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
}
