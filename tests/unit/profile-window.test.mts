import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_SIZE as FLOATING_DEFAULT_SIZE,
  DOCK_BREAKPOINT,
  MIN_VISIBLE_X,
  MIN_VISIBLE_Y,
  SUPPORT_WINDOW_STORAGE_KEY,
  type PlacementStore,
  type WindowPlacement,
} from "../../artifacts/kub/src/lib/floatingWindow.ts";
import {
  PROFILE_WINDOW_DEFAULT_SIZE,
  PROFILE_WINDOW_STORAGE_KEY,
  profileDragPosition,
  profileWindowFrame,
  readProfileWindowPlacement,
  resolveProfileWindowPlacement,
  shouldCloseProfileWindowOnKey,
  shouldStartProfileDrag,
  writeProfileWindowPlacement,
} from "../../artifacts/kub/src/lib/profileWindow.ts";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

function placementAt(x: number, y: number): WindowPlacement {
  return { position: { x, y }, size: { ...PROFILE_WINDOW_DEFAULT_SIZE } };
}

/** A store the test can inspect, standing in for `sessionStorage`. */
function fakeStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const store: PlacementStore & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
  return store;
}

/**
 * An element whose `closest` answers for the tags listed, outermost last —
 * `elementInside("span", "button", "div")` is the label inside the close
 * button inside the title bar.
 */
function elementInside(...ancestors: string[]) {
  return {
    closest(selector: string) {
      const wanted = selector.split(",").map((part) => part.trim());
      const hit = ancestors.find((tag) => wanted.includes(tag));
      return hit ? { tag: hit } : null;
    },
  };
}

test("on a phone the card is still the docked panel, not a window to drag around", () => {
  const frame = profileWindowFrame(placementAt(300, 200), PHONE);
  assert.equal(frame.docked, true);
  assert.equal(frame.style, undefined, "a docked panel is laid out, never positioned by hand");
  assert.ok(frame.className.includes("border-l"), "it keeps the column border it always had");
  assert.ok(frame.className.includes("h-full"));
  assert.ok(!frame.className.includes("fixed"), "nothing floats below the dock breakpoint");
});

test("the dock breakpoint is the line between a panel and a window", () => {
  assert.equal(profileWindowFrame(placementAt(0, 0), { width: DOCK_BREAKPOINT - 1, height: 800 }).docked, true);
  assert.equal(profileWindowFrame(placementAt(0, 0), { width: DOCK_BREAKPOINT, height: 800 }).docked, false);
});

test("on a desktop the card is pinned to exactly where it was left", () => {
  const frame = profileWindowFrame(placementAt(1036, 256), DESKTOP);
  assert.equal(frame.docked, false);
  assert.deepEqual(frame.style, {
    left: "1036px",
    top: "256px",
    width: `${PROFILE_WINDOW_DEFAULT_SIZE.width}px`,
    height: `${PROFILE_WINDOW_DEFAULT_SIZE.height}px`,
  });
  assert.ok(frame.className.includes("fixed"), "it is lifted out of the conversation's flow");
  assert.ok(
    frame.className.includes("min-h-0") && frame.className.includes("overflow-hidden"),
    "the media grid has to scroll inside a window that keeps its height",
  );
});

test("the card is never taller than the screen it opens on", () => {
  // Requirement in one line: the shared-media grid scrolls inside the window,
  // and the window stays inside the viewport. A 620px card on a 500px-tall
  // browser would put its actions below the bottom edge.
  const viewport = { width: 900, height: 500 };
  const placement = resolveProfileWindowPlacement(null, viewport);
  assert.ok(placement.size.height <= viewport.height, "taller than the screen it sits in");
  assert.ok(placement.position.y + placement.size.height <= viewport.height, "its bottom hangs off");
  assert.ok(placement.position.x + placement.size.width <= viewport.width, "its right edge hangs off");
  assert.equal(profileWindowFrame(placement, viewport).style?.height, `${placement.size.height}px`);
});

test("with nothing remembered the card opens at the profile's own size", () => {
  // Written out rather than compared to the constant, which would agree with
  // itself whatever the constant said. The point is that the profile does not
  // inherit the support window's shorter default, which cut the media grid to
  // a single row.
  assert.deepEqual(PROFILE_WINDOW_DEFAULT_SIZE, { width: 380, height: 620 });
  assert.notEqual(PROFILE_WINDOW_DEFAULT_SIZE.height, FLOATING_DEFAULT_SIZE.height);
  assert.deepEqual(resolveProfileWindowPlacement(null, DESKTOP).size, { width: 380, height: 620 });
});

test("a position remembered on a wider monitor is corrected, not restored out of reach", () => {
  const placement = resolveProfileWindowPlacement(
    { position: { x: 2400, y: 1500 }, size: { width: 520, height: 900 } },
    { width: 1280, height: 720 },
  );
  assert.equal(placement.position.x, 1280 - MIN_VISIBLE_X);
  assert.equal(placement.position.y, 720 - MIN_VISIBLE_Y);
  assert.ok(placement.size.height <= 720);
  assert.ok(1280 - placement.position.x >= MIN_VISIBLE_X, "no grabbable strip left on screen");
});

test("a corrupt remembered position opens the card at the default, not at nowhere", () => {
  const placement = resolveProfileWindowPlacement({ position: { x: Number.NaN, y: 10 } }, DESKTOP);
  assert.ok(Number.isFinite(placement.position.x));
  assert.ok(Number.isFinite(placement.position.y));
  assert.deepEqual(placement.position, {
    x: DESKTOP.width - PROFILE_WINDOW_DEFAULT_SIZE.width - 24,
    y: DESKTOP.height - PROFILE_WINDOW_DEFAULT_SIZE.height - 24,
  });
});

test("moving the profile card leaves the support window where the person put it", () => {
  // The two windows are the same machinery. Sharing the key too would make
  // dragging one silently drag the other.
  assert.notEqual(PROFILE_WINDOW_STORAGE_KEY, SUPPORT_WINDOW_STORAGE_KEY);
  const support = JSON.stringify({ position: { x: 10, y: 20 }, size: { width: 380, height: 560 } });
  const store = fakeStore({ [SUPPORT_WINDOW_STORAGE_KEY]: support });

  writeProfileWindowPlacement(placementAt(700, 90), store);

  assert.equal(store.data.get(SUPPORT_WINDOW_STORAGE_KEY), support, "the support window was moved too");
  assert.deepEqual(readProfileWindowPlacement(store), placementAt(700, 90));
  assert.equal(
    readProfileWindowPlacement(fakeStore({ [SUPPORT_WINDOW_STORAGE_KEY]: support })),
    null,
    "the profile opened on the support window's remembered position",
  );
});

test("where the card was put is remembered for the sitting, not for good", async (t) => {
  const session = fakeStore();
  const local = fakeStore();
  Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true, writable: true });
  t.after(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage");
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  writeProfileWindowPlacement(placementAt(512, 64));

  assert.ok(session.data.has(PROFILE_WINDOW_STORAGE_KEY), "nothing was remembered for the session");
  assert.equal(local.data.size, 0, "a window position outlived the session it belonged to");
  assert.deepEqual(readProfileWindowPlacement(), placementAt(512, 64));
});

test("a press that lands on a control in the title bar is a click, not a drag", () => {
  // The drag takes pointer capture, which redirects every later pointer event
  // to the handle. Starting one on the close button is how the card stops
  // being closable.
  assert.equal(
    shouldStartProfileDrag({ docked: false, button: 0, target: elementInside("span", "button", "div") }),
    false,
  );
  assert.equal(
    shouldStartProfileDrag({ docked: false, button: 0, target: elementInside("input", "label", "div") }),
    false,
  );
  assert.equal(
    shouldStartProfileDrag({ docked: false, button: 0, target: elementInside("span", "div") }),
    true,
    "the title itself has to be draggable or there is no handle",
  );
  assert.equal(shouldStartProfileDrag({ docked: false, button: 0, target: null }), true);
});

test("a docked panel does not move, and neither does a right-click", () => {
  assert.equal(shouldStartProfileDrag({ docked: true, button: 0, target: elementInside("div") }), false);
  assert.equal(shouldStartProfileDrag({ docked: false, button: 2, target: elementInside("div") }), false);
});

test("dragging moves the card by exactly what the pointer moved", () => {
  const position = profileDragPosition(
    { origin: { x: 500, y: 300 }, start: { x: 900, y: 120 } },
    { x: 520, y: 340 },
    PROFILE_WINDOW_DEFAULT_SIZE,
    DESKTOP,
  );
  assert.deepEqual(position, { x: 920, y: 160 });
});

test("dragging cannot throw the card off the screen", () => {
  const position = profileDragPosition(
    { origin: { x: 500, y: 300 }, start: { x: 900, y: 120 } },
    { x: 5000, y: 5000 },
    PROFILE_WINDOW_DEFAULT_SIZE,
    DESKTOP,
  );
  assert.equal(position.x, DESKTOP.width - MIN_VISIBLE_X);
  assert.equal(position.y, DESKTOP.height - MIN_VISIBLE_Y);
});

test("Escape closes the card", () => {
  assert.equal(shouldCloseProfileWindowOnKey({ key: "Escape" }), true);
  assert.equal(shouldCloseProfileWindowOnKey({ key: "Enter" }), false);
  assert.equal(shouldCloseProfileWindowOnKey({ key: "Escape", defaultPrevented: true }), false);
});

test("Escape belongs to the confirmation standing on top of the card", () => {
  // «Удалить чат у себя» opens a modal over the profile and listens for Escape
  // itself. One press must dismiss one thing.
  assert.equal(shouldCloseProfileWindowOnKey({ key: "Escape", overlayAbove: true }), false);
});

test("Escape while renaming the group does not throw the card away", () => {
  assert.equal(shouldCloseProfileWindowOnKey({ key: "Escape", editing: true }), false);
});

test("the panel component takes its frame from the window rules, and announces itself as a dialog", () => {
  // A source contract, not a behavioural one: there is no DOM in this suite.
  // It catches the component drifting away from the module the rest of this
  // file tests — a hand-rolled second frame, or a lost `role="dialog"`, which
  // the shell's own Escape handler reads to decide whether to close the chat.
  const panel = readFileSync("artifacts/kub/src/components/chat/ChatInfoPanel.tsx", "utf8");
  assert.ok(panel.includes('from "@/lib/profileWindow"'), "the panel no longer uses the window rules");
  assert.ok(panel.includes("profileWindowFrame(placement, viewport)"));
  assert.ok(panel.includes("style={frame.style}"), "the resolved position is not applied");
  assert.ok(panel.includes("cn(frame.className"), "the resolved frame classes are not applied");
  assert.ok(panel.includes('role="dialog"'), "the shell will keep closing the chat on Escape");
  assert.ok(
    !panel.includes("md:w-80 flex-shrink-0 border-l"),
    "the docked classes are hard-coded in the component again instead of coming from the frame",
  );

  const shell = readFileSync("artifacts/kub/src/components/layout/MainLayout.tsx", "utf8");
  assert.ok(
    shell.includes('[role="dialog"]'),
    "the shell stopped standing down for open dialogs, so Escape would close the chat under the card",
  );
});
