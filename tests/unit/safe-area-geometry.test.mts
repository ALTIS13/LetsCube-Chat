import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SIZE,
  MIN_VISIBLE_X,
  MIN_VISIBLE_Y,
  resolvePlacement,
} from "../../artifacts/kub/src/lib/floatingWindow.ts";
import { profileWindowFrame, resolveProfileWindowPlacement } from "../../artifacts/kub/src/lib/profileWindow.ts";
import { NO_SAFE_AREA_INSETS, readSafeAreaInsets, safeViewport } from "../../artifacts/kub/src/lib/safeArea.ts";

/**
 * The hand-placed surfaces keep clear of the hardware by being placed in the
 * part of the screen it leaves alone.
 *
 * The support window and the contact card already had geometry that keeps a
 * window on screen: clamping, docking below 640px, and a stored position
 * corrected for a smaller screen. Given the safe viewport instead of the whole
 * one, and drawn offset by the left and top insets, that same geometry keeps
 * them off the notch and the home indicator without learning that either
 * exists. These are the two halves of that arrangement, and the case that
 * shows they add up.
 */

/** iPhone 14 Pro held sideways, in points. */
const LANDSCAPE = { width: 852, height: 393 };
const LANDSCAPE_INSETS = { top: 0, right: 59, bottom: 21, left: 59 };

test("the safe viewport is the screen minus the hardware, and never negative", () => {
  assert.deepEqual(safeViewport(LANDSCAPE, LANDSCAPE_INSETS), { width: 734, height: 372 });
  assert.deepEqual(safeViewport(LANDSCAPE, NO_SAFE_AREA_INSETS), LANDSCAPE);
  assert.deepEqual(
    safeViewport({ width: 50, height: 20 }, { top: 30, right: 40, bottom: 30, left: 40 }),
    { width: 0, height: 0 },
  );
});

test("with no document to measure there are no insets, not an exception", () => {
  assert.deepEqual(readSafeAreaInsets(), { top: 0, right: 0, bottom: 0, left: 0 });
});

/** Where the card is drawn on the screen, for a stored placement or none. */
function drawnCard(stored: { position: { x: number; y: number } } | null) {
  const viewport = safeViewport(LANDSCAPE, LANDSCAPE_INSETS);
  const placement = resolveProfileWindowPlacement(stored, viewport);
  const frame = profileWindowFrame(placement, viewport, { x: LANDSCAPE_INSETS.left, y: LANDSCAPE_INSETS.top });
  assert.equal(frame.docked, false, "a phone held sideways is wide enough to float the card");
  assert.ok(frame.style);
  const left = Number.parseFloat(frame.style.left);
  const top = Number.parseFloat(frame.style.top);
  return {
    left,
    top,
    right: left + Number.parseFloat(frame.style.width),
    bottom: top + Number.parseFloat(frame.style.height),
  };
}

test("a card opened with nothing remembered is drawn clear of the notch and the home indicator", () => {
  const card = drawnCard(null);
  assert.ok(card.left >= LANDSCAPE_INSETS.left, `the card starts at ${card.left}, under the left notch`);
  assert.ok(card.right <= LANDSCAPE.width - LANDSCAPE_INSETS.right, `the card ends at ${card.right}, under the right notch`);
  assert.ok(card.top >= LANDSCAPE_INSETS.top, `the card starts above the screen at ${card.top}`);
  assert.ok(
    card.bottom <= LANDSCAPE.height - LANDSCAPE_INSETS.bottom,
    `the card ends at ${card.bottom}, on the home indicator`,
  );
});

test("a card dragged as far as it goes keeps its handle clear of the hardware", () => {
  // The window rules let a card hang off an edge on purpose, keeping only
  // enough of the title bar on screen to drag it back — MIN_VISIBLE_X across,
  // MIN_VISIBLE_Y down. What the safe viewport adds is that this reachable part
  // is measured from the notch and the home indicator rather than from the
  // glass, so it can never be the part hidden under them.
  const pushedLeft = drawnCard({ position: { x: -5000, y: -5000 } });
  assert.ok(
    pushedLeft.right - LANDSCAPE_INSETS.left >= MIN_VISIBLE_X,
    `only ${pushedLeft.right - LANDSCAPE_INSETS.left}px of the card is clear of the left notch`,
  );
  assert.ok(pushedLeft.top >= LANDSCAPE_INSETS.top, `the title bar is above the screen at ${pushedLeft.top}`);

  const pushedRight = drawnCard({ position: { x: 5000, y: 5000 } });
  assert.ok(
    LANDSCAPE.width - LANDSCAPE_INSETS.right - pushedRight.left >= MIN_VISIBLE_X,
    `only ${LANDSCAPE.width - LANDSCAPE_INSETS.right - pushedRight.left}px of the card is clear of the right notch`,
  );
  assert.ok(
    LANDSCAPE.height - LANDSCAPE_INSETS.bottom - pushedRight.top >= MIN_VISIBLE_Y,
    `the title bar starts ${LANDSCAPE.height - LANDSCAPE_INSETS.bottom - pushedRight.top}px above the home indicator`,
  );
});

test("the default placement lands clear of the right-hand notch as well", () => {
  // Bottom-right is where a support panel is expected, and the right edge is
  // where the notch is when the phone is turned the other way.
  const viewport = safeViewport(LANDSCAPE, LANDSCAPE_INSETS);
  const placement = resolvePlacement(null, viewport);
  const right = placement.position.x + placement.size.width + LANDSCAPE_INSETS.left;
  assert.ok(placement.size.width <= DEFAULT_SIZE.width);
  assert.ok(
    right <= LANDSCAPE.width - LANDSCAPE_INSETS.right,
    `the support window ends at ${right}, under the right-hand notch`,
  );
});

test("without an origin the frame is exactly the placement, as it was", () => {
  const viewport = { width: 1440, height: 900 };
  const placement = resolveProfileWindowPlacement({ position: { x: 300, y: 200 } }, viewport);
  const frame = profileWindowFrame(placement, viewport);
  assert.equal(frame.style?.left, `${placement.position.x}px`);
  assert.equal(frame.style?.top, `${placement.position.y}px`);
});
