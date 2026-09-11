import assert from "node:assert/strict";
import test from "node:test";

import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  DOUBLE_TAP_ZOOM,
  MAX_ZOOM,
  ZOOM_AT_REST,
  clampScale,
  clampZoom,
  claimsDrag,
  isDoubleTap,
  isZoomed,
  panBy,
  panLimits,
  pinchGeometry,
  pinchZoom,
  toggleZoomAt,
  wheelZoomFactor,
  zoomAt,
  zoomTransform,
  type ZoomPoint,
  type ZoomSize,
  type ZoomState,
} from "../../artifacts/kub/src/lib/mediaZoom.ts";

/**
 * The photo viewer's zoom. Every rule the viewer applies to a gesture is
 * decided in `lib/mediaZoom.ts`; the browser half is in
 * `tests/e2e/media-viewer-zoom.spec.ts`.
 */

// A 3:4 photo fitted into a phone's stage: full width, a band of black above
// and below. Tall enough to overflow the stage on both axes at every scale used
// below, so a focus point can be held on both.
const stage: ZoomSize = { width: 390, height: 700 };
const picture: ZoomSize = { width: 390, height: 520 };
// A landscape photo, which stays shorter than the same stage at moderate zoom.
const landscape: ZoomSize = { width: 390, height: 260 };

/** Where the picture point `u` (relative to the picture's centre, unscaled) is drawn. */
function drawnAt(state: ZoomState, u: ZoomPoint): ZoomPoint {
  return { x: state.x + state.scale * u.x, y: state.y + state.scale * u.y };
}

/** Which picture point is drawn at stage point `p`. */
function pictureAt(state: ZoomState, p: ZoomPoint): ZoomPoint {
  return { x: (p.x - state.x) / state.scale, y: (p.y - state.y) / state.scale };
}

/** The picture's drawn box, relative to the stage centre. */
function box(state: ZoomState) {
  return {
    left: state.x - (picture.width * state.scale) / 2,
    right: state.x + (picture.width * state.scale) / 2,
    top: state.y - (picture.height * state.scale) / 2,
    bottom: state.y + (picture.height * state.scale) / 2,
  };
}

function assertClose(actual: number, expected: number, message: string, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

test("the scale stays between fitted and the maximum", () => {
  assert.equal(clampScale(0.2), 1);
  assert.equal(clampScale(1), 1);
  assert.equal(clampScale(2.2), 2.2);
  assert.equal(clampScale(40), MAX_ZOOM);
  assert.equal(clampScale(Number.NaN), 1, "a broken gesture must not produce a broken picture");
  assert.equal(clampScale(Number.POSITIVE_INFINITY), 1);
});

test("zooming keeps the tapped point of the picture under the finger", () => {
  const focus = { x: 60, y: -30 };
  const under = pictureAt(ZOOM_AT_REST, focus);
  const zoomed = zoomAt(ZOOM_AT_REST, 2, focus, picture, stage);
  assert.equal(zoomed.scale, 2);
  const after = drawnAt(zoomed, under);
  assertClose(after.x, focus.x, "x");
  assertClose(after.y, focus.y, "y");

  // And from an already zoomed and panned state, not only from rest.
  const further = zoomAt(zoomed, 3, { x: -20, y: 10 }, picture, stage);
  const again = drawnAt(further, pictureAt(zoomed, { x: -20, y: 10 }));
  assertClose(again.x, -20, "x from a zoomed state");
  assertClose(again.y, 10, "y from a zoomed state");
});

test("the picture can never be dragged out of sight", () => {
  const zoomed = zoomAt(ZOOM_AT_REST, 3, { x: 0, y: 0 }, picture, stage);
  const flung = panBy(zoomed, { x: 5000, y: -5000 }, picture, stage);
  const limits = panLimits(3, picture, stage);
  assert.equal(flung.x, limits.x, "a drag far to the right stops where the left edge meets the stage");
  assert.equal(flung.y, -limits.y, "a drag far up stops where the bottom edge meets the stage");

  // The property itself: on an axis where the picture is wider than the stage
  // it still covers the stage, and where it is not it stays centred.
  const drawn = box(flung);
  assert.ok(drawn.left <= -stage.width / 2 + 1e-9, "the stage shows an empty band at the left");
  assert.ok(drawn.right >= stage.width / 2 - 1e-9, "the stage shows an empty band at the right");
  assert.ok(drawn.top <= -stage.height / 2 + 1e-9, "the picture's top left the stage");
  assert.ok(drawn.bottom >= stage.height / 2 - 1e-9, "the picture's bottom left the stage");

  // 1.5x makes the landscape photo 390px tall inside a 700px stage: it may not
  // move vertically at all — not by a drag, and not by a focus above the centre.
  const shallow = panBy(
    zoomAt(ZOOM_AT_REST, 1.5, { x: 0, y: -120 }, landscape, stage),
    { x: 0, y: 300 },
    landscape,
    stage,
  );
  assert.equal(shallow.y, 0, "a picture shorter than the stage was allowed to drift off centre");
});

test("zooming near an edge stops at the edge rather than showing past it", () => {
  // The top-left corner of the picture, zoomed in 4x: the point cannot stay put,
  // because keeping it would open a gap between the picture and the stage.
  const corner = { x: -picture.width / 2, y: -picture.height / 2 };
  const zoomed = zoomAt(ZOOM_AT_REST, MAX_ZOOM, corner, picture, stage);
  const limits = panLimits(MAX_ZOOM, picture, stage);
  assert.equal(zoomed.x, limits.x);
  assert.equal(zoomed.y, limits.y);
  assert.ok(box(zoomed).left <= -stage.width / 2 + 1e-9);
});

test("a double tap goes in at the point and a second one comes back to rest", () => {
  const focus = { x: 40, y: 20 };
  const zoomed = toggleZoomAt(ZOOM_AT_REST, focus, picture, stage);
  assert.equal(zoomed.scale, DOUBLE_TAP_ZOOM);
  const kept = drawnAt(zoomed, pictureAt(ZOOM_AT_REST, focus));
  assertClose(kept.x, focus.x, "x");
  assertClose(kept.y, focus.y, "y");
  assert.deepEqual(toggleZoomAt(zoomed, { x: -100, y: 100 }, picture, stage), ZOOM_AT_REST);
});

test("returning to the fitted scale returns to the centre, exactly", () => {
  // Floating point makes a pinch land beside 1 rather than on it; a picture
  // left 0.0004 zoomed and 3px off centre could not be panned back.
  const zoomed = panBy(zoomAt(ZOOM_AT_REST, 2, { x: 90, y: 0 }, picture, stage), { x: -40, y: 0 }, picture, stage);
  const back = zoomAt(zoomed, 1.0004, { x: 10, y: 10 }, picture, stage);
  assert.deepEqual(back, ZOOM_AT_REST);
  assert.equal(isZoomed(back), false);
  assert.equal(zoomTransform(back), "none", "a picture at rest must be drawn without a transform, as before");
});

test("a pinch scales by the fingers' spread and follows their midpoint", () => {
  const a = { x: -50, y: 0 };
  const b = { x: 50, y: 0 };
  const startGeometry = pinchGeometry(a, b);
  const start = { state: ZOOM_AT_REST, ...startGeometry };
  const under = pictureAt(ZOOM_AT_REST, startGeometry.midpoint);

  // The fingers spread to 250px apart and drift 30px down together.
  const spread = pinchGeometry({ x: -125, y: 30 }, { x: 125, y: 30 });
  const zoomed = pinchZoom(start, spread.distance, spread.midpoint, picture, stage);
  assertClose(zoomed.scale, 2.5, "scale");
  const followed = drawnAt(zoomed, under);
  assertClose(followed.x, spread.midpoint.x, "the picture point left the fingers horizontally");
  assertClose(followed.y, spread.midpoint.y, "the picture point left the fingers vertically");

  // Past the maximum it stops, and closing the fingers again ends at rest.
  const wide = pinchZoom(start, 5000, spread.midpoint, picture, stage);
  assert.equal(wide.scale, MAX_ZOOM);
  const closed = pinchZoom({ state: zoomed, ...spread }, 20, spread.midpoint, picture, stage);
  assert.deepEqual(closed, ZOOM_AT_REST);

  // A degenerate start — two fingers on one point — changes nothing.
  assert.deepEqual(pinchZoom({ state: zoomed, distance: 0, midpoint: { x: 0, y: 0 } }, 100, { x: 0, y: 0 }, picture, stage), zoomed);
});

test("at rest a drag belongs to what surrounds the picture; zoomed, it pans", () => {
  // A swipe to the next photo or a swipe to close must never fight panning, so
  // exactly one of them may own a drag.
  assert.equal(claimsDrag(ZOOM_AT_REST), false);
  assert.deepEqual(panBy(ZOOM_AT_REST, { x: 120, y: 80 }, picture, stage), ZOOM_AT_REST, "a picture at rest was moved by a drag");
  const zoomed = zoomAt(ZOOM_AT_REST, 2, { x: 0, y: 0 }, picture, stage);
  assert.equal(claimsDrag(zoomed), true);
  assert.equal(panBy(zoomed, { x: 30, y: 0 }, picture, stage).x, 30);
});

test("ctrl+wheel: a mouse notch is a step, a trackpad pinch is proportional, both directions agree", () => {
  const notchIn = wheelZoomFactor(-100);
  const notchOut = wheelZoomFactor(100);
  assert.ok(notchIn > 1 && notchIn < 2, `a notch in scaled by ${notchIn}`);
  assertClose(notchIn * notchOut, 1, "in and out by the same notch must cancel");

  const pinchIn = wheelZoomFactor(-4);
  assert.ok(pinchIn > 1 && pinchIn < 1.06, `a small pinch step scaled by ${pinchIn}`);
  assert.ok(wheelZoomFactor(-8) > pinchIn, "a larger pinch step must zoom further");

  // Lines and pages are converted before bounding, so they cannot jump either.
  assert.equal(wheelZoomFactor(-3, 1), wheelZoomFactor(-48));
  assert.equal(wheelZoomFactor(-1, 2), wheelZoomFactor(-100));
  assert.equal(wheelZoomFactor(Number.NaN), 1);

  // Enough notches reach the limit and no further.
  let state = ZOOM_AT_REST;
  for (let notch = 0; notch < 40; notch += 1) {
    state = zoomAt(state, state.scale * wheelZoomFactor(-100), { x: 10, y: 10 }, picture, stage);
  }
  assert.equal(state.scale, MAX_ZOOM);
  for (let notch = 0; notch < 40; notch += 1) {
    state = zoomAt(state, state.scale * wheelZoomFactor(100), { x: 10, y: 10 }, picture, stage);
  }
  assert.deepEqual(state, ZOOM_AT_REST);
});

test("a double tap is two quick taps in one place, and nothing else", () => {
  const first = { time: 1000, x: 100, y: 200 };
  assert.equal(isDoubleTap(null, first), false);
  assert.equal(isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS, x: 110, y: 205 }), true);
  assert.equal(isDoubleTap(first, { time: 1001 + DOUBLE_TAP_MS, x: 100, y: 200 }), false, "too slow");
  assert.equal(isDoubleTap(first, { time: 1100, x: 100 + DOUBLE_TAP_SLOP_PX + 1, y: 200 }), false, "too far apart");
  assert.equal(isDoubleTap(first, { time: 900, x: 100, y: 200 }), false, "out of order");
});

test("a state from anywhere is brought back inside the rules", () => {
  assert.deepEqual(clampZoom({ scale: 9, x: 0, y: 0 }, picture, stage), { scale: MAX_ZOOM, x: 0, y: 0 });
  assert.deepEqual(clampZoom({ scale: 0.5, x: 200, y: 200 }, picture, stage), ZOOM_AT_REST);
  const limits = panLimits(2, picture, stage);
  assert.deepEqual(clampZoom({ scale: 2, x: -999, y: Number.NaN }, picture, stage), { scale: 2, x: -limits.x, y: 0 });
  // A stage that widens around a zoomed picture — a phone turned sideways —
  // leaves less of the picture outside it, so the limit tightens, and
  // re-clamping the same state honours the new one.
  const narrow = { width: 300, height: 700 };
  const pannedInNarrow = { scale: 2, x: panLimits(2, picture, narrow).x, y: 0 };
  assert.ok(panLimits(2, picture, stage).x < pannedInNarrow.x, "the premise: the wider stage has the tighter limit");
  assert.equal(clampZoom(pannedInNarrow, picture, stage).x, panLimits(2, picture, stage).x);
  assert.match(zoomTransform({ scale: 2, x: 12, y: -8 }), /^translate3d\(12px, -8px, 0\) scale\(2\)$/);
});
