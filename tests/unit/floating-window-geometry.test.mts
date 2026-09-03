import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SIZE,
  DOCK_BREAKPOINT,
  MIN_SIZE,
  MIN_VISIBLE_X,
  MIN_VISIBLE_Y,
  clampPosition,
  defaultPosition,
  fitSize,
  isDocked,
  resolvePlacement,
} from "../../artifacts/kub/src/lib/floatingWindow.ts";

const DESKTOP = { width: 1440, height: 900 };

test("a window dragged past the right edge keeps a grabbable strip on screen", () => {
  const size = { width: 380, height: 560 };
  const placed = clampPosition({ x: 5000, y: 100 }, size, DESKTOP);
  assert.equal(placed.x, DESKTOP.width - MIN_VISIBLE_X);
  assert.ok(placed.x + size.width > DESKTOP.width, "it is allowed to hang off the edge");
  assert.ok(DESKTOP.width - placed.x >= MIN_VISIBLE_X, "but not past what can be grabbed");
});

test("a window dragged past the left edge is still reachable", () => {
  const size = { width: 380, height: 560 };
  const placed = clampPosition({ x: -5000, y: 100 }, size, DESKTOP);
  assert.equal(placed.x + size.width, MIN_VISIBLE_X);
});

test("a window can never be pushed above the top, where the handle would be gone", () => {
  const placed = clampPosition({ x: 100, y: -300 }, DEFAULT_SIZE, DESKTOP);
  assert.equal(placed.y, 0);
});

test("a window dragged past the bottom keeps its title bar visible", () => {
  const placed = clampPosition({ x: 100, y: 5000 }, DEFAULT_SIZE, DESKTOP);
  assert.equal(placed.y, DESKTOP.height - MIN_VISIBLE_Y);
});

test("a position inside the viewport is left alone", () => {
  const placed = clampPosition({ x: 300, y: 200 }, DEFAULT_SIZE, DESKTOP);
  assert.deepEqual(placed, { x: 300, y: 200 });
});

test("the window shrinks to a viewport it does not fit", () => {
  const fitted = fitSize({ width: 380, height: 560 }, { width: 420, height: 400 });
  assert.ok(fitted.height <= 400, "it must not be taller than the window it sits in");
  assert.ok(fitted.width <= 420);
});

test("shrinking stops at the minimum, so the composer never disappears", () => {
  const fitted = fitSize({ width: 380, height: 560 }, { width: 900, height: 380 });
  assert.equal(fitted.height, Math.max(380 - 16, MIN_SIZE.height));
  assert.ok(fitted.height >= MIN_SIZE.height);
});

test("a placement stored on a wider monitor is corrected, not thrown away", () => {
  // The person arranged the panel on a 2560px screen and reopened it on a
  // laptop. Discarding the placement would lose the arrangement; keeping it
  // verbatim would put the panel off screen.
  const placement = resolvePlacement(
    { position: { x: 2100, y: 1300 }, size: { width: 520, height: 800 } },
    { width: 1280, height: 720 },
  );
  assert.ok(placement.position.x <= 1280 - MIN_VISIBLE_X);
  assert.ok(placement.position.y <= 720 - MIN_VISIBLE_Y);
  assert.ok(placement.size.height <= 720);
});

test("with nothing stored the panel opens near the bottom-right, fully on screen", () => {
  const placement = resolvePlacement(null, DESKTOP);
  assert.deepEqual(placement.size, DEFAULT_SIZE);
  assert.equal(placement.position.x, DESKTOP.width - DEFAULT_SIZE.width - 24);
  assert.equal(placement.position.y, DESKTOP.height - DEFAULT_SIZE.height - 24);
});

test("the default position is itself clamped on a small screen", () => {
  const viewport = { width: 700, height: 420 };
  const size = fitSize(DEFAULT_SIZE, viewport);
  const position = defaultPosition(size, viewport);
  assert.ok(position.y >= 0, "never above the top");
  assert.ok(position.y <= viewport.height - MIN_VISIBLE_Y);
});

test("a phone docks the panel instead of floating it", () => {
  assert.equal(isDocked({ width: 390, height: 844 }), true);
  assert.equal(isDocked({ width: DOCK_BREAKPOINT - 1, height: 800 }), true);
  assert.equal(isDocked({ width: DOCK_BREAKPOINT, height: 800 }), false);
  assert.equal(isDocked(DESKTOP), false);
});

test("a corrupt stored placement falls back to the default rather than NaN", () => {
  const placement = resolvePlacement(
    { position: { x: Number.NaN, y: 10 } } as never,
    DESKTOP,
  );
  assert.ok(Number.isFinite(placement.position.x));
  assert.ok(Number.isFinite(placement.position.y));
});
