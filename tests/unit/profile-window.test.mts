import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The application's classes live in `@layer components`, so a rule's closing
// brace is indented and no longer delimits it. See tests/unit/helpers/css.mjs.
import { atRuleTexts, ruleBody } from "./helpers/css.mjs";
import {
  DEFAULT_SIZE as FLOATING_DEFAULT_SIZE,
  DOCK_BREAKPOINT,
  MIN_VISIBLE_X,
  MIN_VISIBLE_Y,
  SUPPORT_WINDOW_STORAGE_KEY,
  type PlacementStore,
  type WindowPlacement,
} from "../../artifacts/kub/src/lib/floatingWindow.ts";
import { CHAT_LIST_MIN_WIDTH } from "../../artifacts/kub/src/lib/desktopChatList.ts";
import {
  PROFILE_WINDOW_DEFAULT_SIZE,
  PROFILE_WINDOW_STORAGE_KEY,
  paneFitsProfileColumn,
  profileDragPosition,
  profileWindowFrame,
  readProfileWindowPlacement,
  resolveProfileWindowEscape,
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
  assert.ok(!frame.className.includes("fixed"), "nothing floats below the dock breakpoint");
});

test("the docked card is laid over the conversation, not beside it", () => {
  // D-050. It used to be a flex child of the same row as the conversation,
  // which is not what "covers the whole phone" means to a layout engine: the
  // chat was compressed to 24px and pushed off the left edge rather than left
  // alone. Measured at 390x844 with 75 rows, `scrollHeight` went from 6,586 to
  // 114,731 and single rows were laid out up to 4,786px tall - every one of
  // them re-measured at the wrong width, and again on the way back.
  const frame = profileWindowFrame(placementAt(300, 200), PHONE);
  assert.ok(frame.className.includes("absolute"), "the card is in the flow again");
  assert.ok(frame.className.includes("inset-0"), "the card no longer covers the conversation");
  assert.ok(
    !/\bflex-shrink-0\b/.test(frame.className),
    "a flex child of the conversation's row is what compressed the chat to 24px",
  );
  assert.ok(
    !/\bw-full\b|\bmd:w-80\b/.test(frame.className),
    "a positioned sheet is sized by its insets; a width class here means it is back in the row",
  );
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

/**
 * D-161: on a computer the card docks as a third column, beside the
 * conversation rather than on it.
 *
 * Measured on the fixture at 1440 before this, with the card open: a 380x620
 * window covering 26.2% of the conversation and four of its fourteen bubbles,
 * standing on the composer, and scrolling 639px of itself inside 562px — while
 * the pane beside it measured 1001px and had 621 to spare. At 1920 it covered
 * 14.7% and three bubbles. The owner's words about the web client: «выглядит
 * как помесь телефона и десктопа … давай придерживаться скорее desktop
 * варианта по большей части в web».
 */

test("the column appears only when the conversation keeps the product's own minimum", () => {
  // The floor is not invented here. `CHAT_LIST_MIN_WIDTH` is Telegram's
  // `columnMinimalWidthLeft`, already the narrowest this application lets a
  // column be, so the rule moves with that decision instead of restating it.
  assert.equal(PROFILE_WINDOW_DEFAULT_SIZE.width + CHAT_LIST_MIN_WIDTH, 640);
  assert.equal(paneFitsProfileColumn(640), true);
  assert.equal(paneFitsProfileColumn(639), false, "the conversation would be left under the minimum");

  // The panes actually measured on the fixture, with the chat list at its
  // default 360: 1001px at 1440, and 335px at 768.
  assert.equal(paneFitsProfileColumn(1001), true, "1440 has 621px of conversation to spare");
  assert.equal(paneFitsProfileColumn(335), false, "768 would be left with -45px of conversation");

  // The pane, never the viewport: the chat list is dragged by hand, so at one
  // window width the pane is a range. 1280 with the list at its maximum 540 is
  // 1280 - (72 + 540 + 1) = 667, which still fits; the same window with a
  // wider list would not, and only a measurement can tell the two apart.
  assert.equal(paneFitsProfileColumn(667), true);
  assert.equal(paneFitsProfileColumn(Number.NaN), false, "an unmeasured pane is not a wide one");
});

test("on a computer the card is a column beside the conversation, not a window on it", () => {
  const frame = profileWindowFrame(placementAt(1036, 256), DESKTOP, { x: 0, y: 0 }, true);
  assert.equal(frame.surface, "column");
  assert.equal(frame.docked, false, "a column is not the phone's sheet");
  assert.equal(frame.draggable, false);

  // In the flow. This is the defect itself: `fixed` is how the card came to
  // stand on four bubbles and on the composer while the pane had room for it.
  assert.ok(!/\bfixed\b/.test(frame.className), "the column is lifted out of the row again");
  assert.ok(!/\babsolute\b/.test(frame.className), "the column is laid over the conversation again");
  assert.ok(/\brelative\b/.test(frame.className));
  assert.ok(/\bh-full\b/.test(frame.className), "the column does not run the height of the pane");
  assert.ok(/\bflex-shrink-0\b/.test(frame.className), "the conversation can squeeze the card");
  assert.ok(
    /\bmin-h-0\b/.test(frame.className) && /\boverflow-hidden\b/.test(frame.className),
    "the media grid has to scroll inside a column that keeps its height",
  );

  // One card at one size in both shapes, taken from the one constant. The
  // remembered position is not in it: a column is placed by its row.
  assert.deepEqual(frame.style, { width: `${PROFILE_WINDOW_DEFAULT_SIZE.width}px` });
});

test("the column reserves the window's own buttons", () => {
  // D-112, and rule 13 of the material contract. The column is flush to the
  // right edge of the window, which is exactly where the Windows app draws
  // minimise, maximise and close — so without the reservation this card's own
  // close button would open underneath them.
  const frame = profileWindowFrame(placementAt(0, 0), DESKTOP, { x: 0, y: 0 }, true);
  assert.ok(/\bpt-window-top\b/.test(frame.className), "the column opens under the window buttons");
});

test("the column takes the fill of a surface that covers nothing", () => {
  // The material's token table: `-strong` is for anything covering content it
  // is not part of. A column covers nothing — it stands beside the
  // conversation as the chat list does, on the page's own ambient.
  const column = profileWindowFrame(placementAt(0, 0), DESKTOP, { x: 0, y: 0 }, true);
  assert.ok(/\bkub-glass\b/.test(column.className), "the column carries none of the material");
  assert.ok(!/\bkub-glass-strong\b/.test(column.className), "a column wears the covering fill");

  // And the window it falls back to still covers the conversation, so it keeps
  // the strong one.
  const floating = profileWindowFrame(placementAt(0, 0), DESKTOP);
  assert.ok(/\bkub-glass-strong\b/.test(floating.className));
});

test("a pane wide enough for a column does not change the phone", () => {
  // Below the dock breakpoint the answer is the sheet whatever else is true.
  // A phone's pane is its screen, so the two questions could otherwise be
  // asked in either order and give different answers.
  const frame = profileWindowFrame(placementAt(300, 200), PHONE, { x: 0, y: 0 }, true);
  assert.equal(frame.surface, "docked");
  assert.equal(frame.docked, true);
  assert.equal(frame.style, undefined, "a docked panel is laid out, never positioned by hand");
  assert.ok(frame.className.includes("absolute inset-0"));
});

test("without a measured pane the card is still the window it was", () => {
  // The fallback is what every narrow pane gets, and it is also what the card
  // gets for as long as nothing has measured the room: a card that has not
  // been told how much space there is has not got any.
  const frame = profileWindowFrame(placementAt(1036, 256), DESKTOP);
  assert.equal(frame.surface, "floating");
  assert.equal(frame.draggable, true);
  assert.equal(frame.style?.left, "1036px");
});

test("a column is laid out, so there is nothing to drag", () => {
  const target = elementInside("span", "div");
  assert.equal(shouldStartProfileDrag({ docked: false, column: true, button: 0, target }), false);
  assert.equal(
    shouldStartProfileDrag({ docked: false, column: false, button: 0, target }),
    true,
    "the window form lost its handle",
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
  // Drawn offset by the left and top insets: the placement is resolved in the
  // part of the screen the notch and the home indicator leave alone. The
  // fourth argument is D-161's: whether the pane can hold the column.
  assert.ok(
    panel.includes("profileWindowFrame(placement, viewport, { x: insets.left, y: insets.top }, columnFits)"),
  );
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

test("the panel measures the pane it sits in and wears the shape that answers", () => {
  // A source contract, like the frame one above: there is no DOM in this
  // suite. What it pins is the wiring D-161 added — that the pane is measured
  // at all, that the verdict reaches the frame, and that the three places
  // which used to read «not docked» now read «is it a window».
  assert.ok(
    panelSource.includes('closest("[data-kub-conversation-pane]")'),
    "the card no longer finds the pane, so it can never become a column",
  );
  assert.ok(
    panelSource.includes("paneFitsProfileColumn("),
    "the card decides the shape itself instead of asking the rule",
  );
  assert.ok(
    panelSource.includes('column: frame.surface === "column"'),
    "a column can be dragged, which writes a placement that only shows up later on a narrower pane",
  );
  assert.ok(
    panelSource.includes("data-surface={frame.surface}"),
    "the shape is not on the element, so nothing outside can tell the three apart",
  );
  assert.ok(
    panelSource.includes('frame.draggable ? "cursor-grab'),
    "the column offers a grab cursor for a drag it will refuse",
  );
  // The row the column docks into has to say so; `closest` above is looking
  // for exactly this attribute. Not `data-kub-chat-*`: that namespace belongs
  // to the retired chat-chrome DEV switch and chat-chrome.test.mts keeps it
  // empty, which is what caught the first spelling of this attribute.
  const window = readFileSync("artifacts/kub/src/components/chat/ChatWindow.tsx", "utf8");
  assert.ok(
    window.includes("data-kub-conversation-pane"),
    "the chat pane is unmarked, so the card measures nothing and stays a window",
  );
});

/**
 * The shared-media gallery is a sub-view, not an expanding block.
 *
 * What the owner reported after using the card: «свернуть галерею если я открыл
 * не могу». «Общие медиа» appended the grid underneath the actions, and for a
 * private chat the actions were rendered unconditionally — so there was nothing
 * to collapse, only more card. It is a push now, and both the arrow and Escape
 * pop it.
 */

test("Escape inside the gallery goes back to the card, not away from it", () => {
  assert.equal(resolveProfileWindowEscape({ key: "Escape", subview: true }), "back");
  assert.equal(resolveProfileWindowEscape({ key: "Escape", subview: false }), "close");
  assert.equal(resolveProfileWindowEscape({ key: "Escape" }), "close");
});

test("the sub-view does not take Escape away from what is standing over it", () => {
  // A confirmation opened from inside the gallery owns Escape until it is gone;
  // popping the gallery underneath it would move the card while it is being read.
  assert.equal(resolveProfileWindowEscape({ key: "Escape", subview: true, overlayAbove: true }), "ignore");
  assert.equal(resolveProfileWindowEscape({ key: "Escape", subview: true, editing: true }), "ignore");
  assert.equal(resolveProfileWindowEscape({ key: "Escape", subview: true, defaultPrevented: true }), "ignore");
  assert.equal(resolveProfileWindowEscape({ key: "Enter", subview: true }), "ignore");
});

const panelSource = readFileSync("artifacts/kub/src/components/chat/ChatInfoPanel.tsx", "utf8");

test("the gallery is pushed and popped rather than appended to the card", () => {
  // A source contract, like the frame one above: there is no DOM in this suite.
  assert.ok(
    panelSource.includes('data-testid="chat-info-gallery-view"'),
    "the shared media no longer renders as its own view",
  );
  assert.ok(
    panelSource.includes('data-testid="chat-info-back"'),
    "there is no way back out of the gallery",
  );
  assert.ok(
    panelSource.includes("resolveProfileWindowEscape("),
    "Escape no longer distinguishes the sub-view from the card root",
  );
  assert.ok(
    panelSource.includes('subview: view !== "root"'),
    "Escape is told nothing about which view is open, so it always closes the card",
  );
  // The old shape: a third tab beside Сведения and Участники, whose content was
  // appended below the info block instead of replacing it.
  assert.doesNotMatch(
    panelSource,
    /tab === "media"/,
    "the gallery is a tab again, which is the block that could not be collapsed",
  );
  assert.doesNotMatch(
    panelSource,
    /\["info", "members", "media"\]/,
    "the media tab is back in the strip",
  );
});

test("the gallery moves without resizing, and takes its timing from the tokens", () => {
  assert.ok(panelSource.includes("kub-subview"), "the push uses no shared transition class");

  const css = readFileSync("artifacts/kub/src/index.css", "utf8");
  const rule = ruleBody(css, ".kub-subview");
  assert.match(rule, /var\(--kub-motion-[a-z]+\)/, "the push hard-codes its duration");
  assert.match(rule, /var\(--kub-ease-[a-z]+\)/, "the push hard-codes its easing");

  // Height, width and padding are never animated: the card would resize while
  // the grid inside it was being read, and the entry would be unmeasurable.
  const transition = rule.match(/transition:([\s\S]*?);/);
  assert.ok(transition, ".kub-subview declares no transition");
  // Written as literals rather than built from names: a regex assembled out of
  // an escaped template silently became /\bheight\b/ with a backspace in it,
  // and passed whatever the stylesheet said.
  const forbidden: Array<[string, RegExp]> = [
    ["height", /\bheight\b/],
    ["width", /\bwidth\b/],
    ["padding", /\bpadding\b/],
    ["margin", /\bmargin\b/],
    ["all", /\ball\b/],
  ];
  for (const [name, pattern] of forbidden) {
    assert.ok(pattern.test("x " + name), `the ${name} guard cannot match anything`);
    assert.doesNotMatch(
      transition[1],
      pattern,
      `.kub-subview animates ${name}, which has a size`,
    );
  }

  const reduced = atRuleTexts(css, /^@media \(prefers-reduced-motion: reduce\)$/).join("\n");
  assert.match(reduced, /\.kub-subview/, "the push still slides under reduced motion");
});

test("the media viewer is drawn above the window it was opened from", () => {
  // `z-[90]` only means "above everything" while the viewer is a child of the
  // page. Opened from the `z-[60]` profile card it was measured inside that
  // card's own stacking context, and the `z-[70]` support window covered a
  // full-screen photo. Reachable only with both open at once.
  const viewer = readFileSync("artifacts/kub/src/components/chat/MediaViewer.tsx", "utf8");
  assert.ok(viewer.includes("createPortal("), "the viewer renders inside whatever opened it again");
  assert.ok(viewer.includes("document.body"), "the viewer is portalled somewhere other than the body");
  assert.ok(viewer.includes("z-[90]"), "the viewer lost the z-index the portal exists to make meaningful");
});

test("there is one profile surface, and the chat list opens it without entering the chat", () => {
  const list = readFileSync("artifacts/kub/src/components/sidebar/ChatList.tsx", "utf8");
  // Right-clicking a row used to open a second, differently shaped mini-profile
  // with its own subset of these very actions.
  assert.doesNotMatch(list, /ChatProfilePreviewModal/, "the second profile surface is back");
  assert.doesNotMatch(list, /setPreviewChatId/, "the chat list owns profile state of its own again");
  assert.doesNotMatch(list, /data-chat-profile-preview/, "the mini-profile markup is back");

  /**
   * **This assertion was inverted by D-283, and the inversion is the point.**
   *
   * It used to require `selectAndOpenPanel("info")` here — it pinned, as a
   * contract, the very behaviour the owner reported as a loss: «У нас пропала
   * возможность открыть профиль пользователя не заходя в ЛС с ним.» The card
   * was right to be one; the route through a conversation was not, and a guard
   * that reads source cannot tell «one surface» from «one door» unless
   * somebody writes down which it meant.
   *
   * So both halves are stated now. The entry reaches the overlay, and it must
   * **not** reach the chat: `openUserProfile` takes a person, never a chat id.
   */
  const profileAction = list.match(/id: "profile",[\s\S]{0,260}?\n\s{6}\}\);/);
  assert.ok(profileAction, "the chat list no longer offers «Открыть профиль»");
  assert.match(profileAction[0], /openUserProfile\(userId\)/, "«Открыть профиль» opens something else");
  assert.doesNotMatch(
    profileAction[0],
    /selectAndOpenPanel|onChatSelect/,
    "«Открыть профиль» enters the conversation again (D-283)",
  );

  // And it is offered for a person only. `chat.type === "private"` is also
  // true of a bot conversation, which has no person behind it; the decision is
  // in `lib/chatRowProfile.ts` and covered by `chat-row-profile.test.mts`.
  assert.match(
    list,
    /chatRowProfileTarget\(chat, currentUser\?\.id \?\? null\)/,
    "the chat list decides who a row's profile is by itself again",
  );

  // The group entry keeps the old route, and must: a group's information IS
  // the conversation's, and the panel is where it lives.
  const groupAction = list.match(/id: "group-info",[\s\S]{0,260}?\n\s{6}\}\);/);
  assert.ok(groupAction, "the chat list no longer offers the group information entry");
  assert.match(groupAction[0], /selectAndOpenPanel\("info"\)/, "the group entry opens something else");
});

test("the person's card has one implementation, drawn by both of its containers", () => {
  // What the consolidation comment in `ChatList` protects, restated where it
  // can be checked. `MemberCard` is a module now; the information panel and
  // the standalone overlay both import it, and neither rebuilds it.
  const card = readFileSync("artifacts/kub/src/components/chat/MemberCard.tsx", "utf8");
  assert.match(card, /export function MemberCard\(/, "the card is no longer exported");

  const panel = readFileSync("artifacts/kub/src/components/chat/ChatInfoPanel.tsx", "utf8");
  assert.match(panel, /from "\.\/MemberCard"/, "the panel builds a card of its own again");
  assert.doesNotMatch(panel, /^function MemberCard\(/m, "a second card is back inside the panel");

  const overlay = readFileSync("artifacts/kub/src/components/profile/UserProfileOverlay.tsx", "utf8");
  assert.match(overlay, /from "@\/components\/chat\/MemberCard"/, "the overlay builds a card of its own");
  // The overlay belongs to no chat, so it must not invent the chat-scoped
  // facts the card can draw: a standing in a group, a join date, a role chip.
  assert.match(overlay, /roleLabel=""/, "the overlay invents a standing for somebody");
  assert.match(overlay, /joinedLabel=""/, "the overlay invents a join date");
  assert.match(overlay, /groupRoles=\{\[\]\}/, "the overlay invents group roles");
});

test("every action and confirmation the card carried is still on it", () => {
  // The card is the surviving surface, so nothing may be lost in the move.
  //
  // Each label is bound to the handler that runs it, not merely looked for in
  // the file: «Общие медиа» also appears in the sub-view's own title, so a bare
  // string search stayed green while the action row underneath it was renamed.
  const rows: Array<[string, RegExp]> = [
    // The one «Общие медиа» entry became a row per kind; the family is checked
    // in its own test below, and reaching the media at all is checked here.
    ["общие медиа", /onClick=\{\(\) => openMediaSection\(section\.kind\)\}[\s\S]{0,600}?section\.countedLabel/],
    // D-167: the row is no longer a toggle over `localStorage`, so its words
    // are no longer written here. It draws what `chatMuteMenuEntries` decides —
    // one row at rest carrying what the account holds, five once it is opened
    // into the durations — and the words themselves are pinned in
    // `tests/unit/chat-mute.test.mts`. What is pinned here is still the
    // binding: the row the person presses is wired to the handler that writes,
    // the same way «Покинуть группу» is pinned below.
    ["уведомления", /chatMuteMenuEntries\(muteState, muteChoiceOpen, Date\.now\(\)\)\.map[\s\S]{0,900}?applyMute\(entry\.id === "unmute" \? "off" : entry\.id\)/],
    ["Закрепить чат", /onClick=\{handlePinToggle\}[\s\S]{0,400}?Открепить чат[\s\S]{0,40}?Закрепить чат/],
    ["Очистить историю у себя", /onClick=\{handleClearForMe\}[\s\S]{0,500}?Очистить историю у себя/],
    ["Удалить чат у себя", /onClick=\{handleHidePrivateChat\}[\s\S]{0,400}?Удалить чат у себя/],
    // D-169: these two read their own words out of `lib/chatVocabulary.ts`, so
    // that a channel is offered «Покинуть канал» rather than «Покинуть группу».
    // What each one says is pinned in `tests/unit/chat-vocabulary.test.mts`, in
    // both nouns; what is pinned here is still the binding — that the label the
    // person presses is the one wired to this handler.
    ["Покинуть группу", /setLeaveGroupOpen\(true\)[\s\S]{0,700}?words\.leaveLabel/],
    ["Удалить группу", /setDeleteGroupOpen\(true\)[\s\S]{0,700}?words\.deleteLabel/],
    ["Пригласить пользователя", /setInviteOpen\(true\)[\s\S]{0,400}?Пригласить пользователя/],
  ];
  for (const [label, pattern] of rows) {
    assert.match(panelSource, pattern, `the card lost the «${label}» action`);
  }

  // The two «у себя» actions destroy something and must still ask first.
  const clearHandler = panelSource.match(/const handleClearForMe = async \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(clearHandler, "«Очистить историю у себя» is gone from the card");
  assert.match(clearHandler[0], /requestAppConfirm\(/, "«Очистить историю у себя» stopped asking first");
  const hideHandler = panelSource.match(/const handleHidePrivateChat = async \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(hideHandler, "«Удалить чат у себя» is gone from the card");
  assert.match(hideHandler[0], /requestAppConfirm\(/, "«Удалить чат у себя» stopped asking first");

  // Bio and role badges belong to the card too; the badges themselves are item
  // 19's territory and are untouched here.
  assert.ok(panelSource.includes("<ProfileRoleSummary user={otherUser} compact />"), "the role badges are gone");
  assert.match(panelSource, /otherUser\?\.bio[\s\S]{0,400}?otherUser\.bio/, "the bio is gone from the card");
});

/**
 * The division and the counts live in the card's own scroll.
 *
 * The owner liked the divided sub-view and asked for it arranged differently:
 * the counts belong on the card. The shape is a desktop contact card — identity,
 * detail rows, then a vertical list of counted rows («1543 фотографии», one per
 * line, full width), then the destructive actions. The strip of section tabs is
 * gone; what is behind a row is only that row's contents.
 *
 * Source contracts, like the frame ones above: there is no DOM in this suite,
 * so what is pinned is the wiring, not the rendering.
 */

test("the card offers a row per kind, labelled by its own count", () => {
  const band = panelSource.match(/data-testid="chat-info-media-rows"[\s\S]*?\n {12}\)\}/);
  assert.ok(band, "the card no longer renders the counted media rows");
  assert.match(
    band[0],
    /mediaSections\.map\(\(section\) =>/,
    "the rows are not built from the sections, so a kind could be listed twice or not at all",
  );
  assert.match(
    band[0],
    /\{section\.countedLabel\}/,
    "a row prints something other than its own counted label",
  );
  assert.match(
    band[0],
    /onClick=\{\(\) => openMediaSection\(section\.kind\)\}[\s\S]{0,600}?\{section\.countedLabel\}/,
    "a row does not open the kind it is labelled with",
  );
  // A kind holding nothing has no row: `buildMessageMediaSections` never builds
  // one, and the band itself is absent in a chat that has only carried text.
  assert.match(
    panelSource,
    /\{mediaSections\.length > 0 && \(\s*\n\s*<div\s*\n\s*className="px-4 py-3 mt-2 space-y-1 border-t/,
    "the counted band renders even when the chat holds no media",
  );
});

test("a row that was pressed opens that kind and not the first one", () => {
  const opener = panelSource.match(/const openMediaSection = \(kind: MessageMediaKind\) => \{[\s\S]*?\n  \};/);
  assert.ok(opener, "pressing a counted row no longer opens anything");
  assert.match(opener[0], /setMediaSection\(kind\)/, "the sub-view opens on whatever was open last");
  assert.match(opener[0], /setView\("gallery"\)/, "the sub-view is never pushed");
  // The old entry: one «Общие медиа» button that pushed with no kind chosen,
  // leaving the strip inside to say what the chat contained.
  assert.doesNotMatch(panelSource, /openGallery/, "the single undivided «Общие медиа» entry is back");
  assert.doesNotMatch(
    panelSource,
    /data-testid="chat-info-open-gallery"/,
    "the single undivided «Общие медиа» entry is back",
  );
});

test("the section tab strip is gone from the sub-view", () => {
  // Two places to read the same counts is one place to read them wrong.
  //
  // The word, not the attribute: `role="tablist"` matches only the literal the
  // strip happened to be written with, and a mutation that reintroduced the
  // role through `role={… ? "tablist" : undefined}` walked straight past it.
  assert.doesNotMatch(panelSource, /tablist/, "the horizontal section strip is back");
  assert.doesNotMatch(panelSource, /aria-selected/, "the horizontal section strip is back");
  assert.doesNotMatch(panelSource, /role="tab"/, "the horizontal section strip is back");
  assert.doesNotMatch(
    panelSource,
    /data-testid="chat-info-media-sections"/,
    "the horizontal section strip is back",
  );
  assert.doesNotMatch(panelSource, /overflow-x-auto/, "something in the card scrolls sideways again");
  // The title bar names the one kind that is open instead.
  assert.match(
    panelSource,
    // Loosened on 2026-09-13 when the settings screen made this a three-way
    // choice rather than a ternary (D-164). What is being guarded is that the
    // gallery's title is the section's own name, and that is still the line.
    /view === "gallery"\s*\n?\s*\? \(activeSection\?\.label \?\? "Общие медиа"\)/,
    "the sub-view title no longer names the kind that is open",
  );
});

test("the counts are loaded with the card, not with the sub-view", () => {
  // They are on the root now, and a kind the card has not loaded is
  // indistinguishable from a kind this chat has never contained.
  assert.doesNotMatch(
    panelSource,
    /if \(view !== "gallery"\) return;/,
    "the media load waits for the gallery again, so the card would show no counts",
  );
  const loader = panelSource.match(
    /useEffect\(\(\) => \{\s*\n\s*setMedia\(\[\]\);[\s\S]*?\}, \[loadMedia, loadLinks, loadMediaCounts\]\);/,
  );
  assert.ok(loader, "nothing loads the media when the card opens");
  assert.match(loader[0], /void loadMedia\(true\);/, "the media is never loaded");
  assert.match(loader[0], /void loadLinks\(true\);/, "the links are never loaded, so «ссылок» could not be counted");
  // The totals are the card's real source now, and they are asked for with the
  // card rather than when a kind is opened: the row has to exist before it can
  // be pressed, and a kind outside the loaded page has no row without them.
  assert.match(loader[0], /void loadMediaCounts\(\);/, "the exact totals are never fetched");

  // Both loaders must be keyed on the id, not on the user object: the store
  // hands back a fresh `currentUser` on any profile change, and the effect
  // above would then empty and refetch the counts underneath the reader.
  assert.match(panelSource, /\}, \[chat\.id, currentUserId, supabase\]\);/, "a loader is keyed on the user object");
  assert.doesNotMatch(
    panelSource,
    /\}, \[chat\.id, currentUser, supabase\]\);/,
    "a loader is keyed on the user object",
  );
});

test("the card is one scrolling column, and its rows take their timing from the tokens", () => {
  // One scroll: the identity, the detail rows, the counted rows and the
  // destructive actions move together. `chat-info-root-view` is the scroller,
  // and it is the same layer below the dock breakpoint as above it.
  assert.match(
    panelSource,
    /className="kub-subview absolute inset-0 overflow-y-auto"\s*\n\s*data-state=\{view === "root"/,
    "the card root is no longer a single scrolling column",
  );

  const motion = panelSource.match(/const rowMotionClass =\s*\n\s*"([^"]*)";/);
  assert.ok(motion, "the action rows declare no shared motion");
  assert.match(motion[1], /duration-\[var\(--kub-motion-[a-z]+\)\]/, "a row hard-codes its duration");
  assert.match(motion[1], /ease-\[var\(--kub-ease-[a-z]+\)\]/, "a row hard-codes its easing");
  // Colour only. A row that transitioned a size would move every row under it,
  // and the tokens are what makes reduced motion reach this at all.
  assert.match(motion[1], /transition-colors/, "the rows transition something other than colour");
  const forbidden: Array<[string, RegExp]> = [
    ["everything", /transition-all/],
    ["height", /\bheight\b/],
    ["width", /\bwidth\b/],
    ["padding", /\bpadding\b/],
  ];
  for (const [name, pattern] of forbidden) {
    assert.ok(pattern.test("transition-all height width padding"), `the ${name} guard cannot match anything`);
    assert.doesNotMatch(motion[1], pattern, `a row animates ${name}, which has a size`);
  }
  assert.ok(panelSource.includes("cn(actionRowClass"), "the shared row class is no longer applied");
});

test("a count the card does not have yet is a placeholder, not an absence", () => {
  // `ProfileRoleSummary` printing «Локации не назначены» mid-flight is the
  // recorded precedent: a section that does not yet know may not make a claim,
  // and a missing band reads as «this chat has no shared media».
  const loading = panelSource.match(/\{mediaSections\.length === 0 && loadingMedia && \([\s\S]*?\n {12}\)\}/);
  assert.ok(loading, "the card asserts there is no media while it is still loading");
  assert.match(loading[0], /KubStableSkeleton/, "the placeholder sizes itself from its content");
  // One row's worth. Three would imply a count nothing has established.
  assert.equal(
    (loading[0].match(/KubStableSkeleton/g) ?? []).length,
    2,
    "the placeholder guesses how many kinds are coming",
  );
});

/**
 * The sub-view loads as the reader scrolls, and offers nothing when it is done.
 *
 * The owner's two complaints about «Показать ещё», in their order: the button
 * appeared even when there was nothing further to load, and it should not have
 * been a button. Both were the same cause — «is there more» was asked of the
 * media page counter, which knows nothing about the section that is open.
 *
 * Source contracts again: there is no DOM in this suite, so what is pinned is
 * the wiring.
 */

test("the sub-view has no «Показать ещё» button", () => {
  assert.doesNotMatch(panelSource, /Показать ещё/, "the button is back");
  // And the question it asked is gone with it: a panel-wide flag standing in
  // for every section is how it came to be offered under «Ссылки».
  assert.doesNotMatch(panelSource, /hasMoreMedia/, "the panel-wide «more» flag is back");
});

test("more is fetched when the end of the list comes into view, not on a scroll offset", () => {
  const observer = panelSource.match(
    /const observer = new IntersectionObserver\([\s\S]*?\n {2}\}, \[view, sectionHasMore, activeMediaSection, activeSection\?\.loadedCount, sectionLoading\]\);/,
  );
  assert.ok(observer, "nothing watches the end of the list");
  assert.match(observer[0], /observer\.observe\(node\)/, "the sentinel is never observed");
  assert.match(observer[0], /observer\.disconnect\(\)/, "the observer outlives the sub-view");
  assert.match(observer[0], /root: mediaScrollerRef\.current/, "the observer watches the page, not the list's scroller");
  // The loader is reached through a ref, not through this effect's
  // dependencies. Keyed on the callback instead, every page re-fired the load
  // before the observer had a frame to say the sentinel had moved out of view,
  // and the list loaded itself to the end with nobody scrolling — measured on
  // the fixture at sixty pictures and three pages. See the e2e spec's «the end
  // of the list offers no press».
  assert.match(observer[0], /void loadMoreRef\.current\(\)/, "the observer does not load the next page");
  // Over the code, not over the prose about it. The comment above this effect
  // names the dependency list it replaced, and a scan that reads comments would
  // fail on the explanation — rule 9 of the interface material, met here in a
  // different file.
  assert.doesNotMatch(
    panelSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    /\[sentinelVisible/,
    "a second effect loads on a stale visibility flag again",
  );
  // Polling offsets is the thing this replaced, and that is still the contract.
  // It used to be enforced by forbidding the strings `scrollTop` and
  // `onScroll=` anywhere in the file, which D-171 made too blunt: the month
  // marker follows the scroll and must, because the month a reader is inside
  // is not a thing an observer on the end of the list can answer. So what is
  // pinned now is the thing that actually mattered — that nothing in a scroll
  // listener loads a page.
  const listeners = [...panelSource.matchAll(/addEventListener\("scroll", (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(listeners, ["readMonthMarker"], "something other than the month marker listens to the scroll");
  const marker = panelSource.match(/const readMonthMarker = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/);
  assert.ok(marker, "the month marker is gone");
  assert.doesNotMatch(marker[0], /loadMedia|loadLinks|loadMoreActiveSection/, "the scroll listener loads pages");
  assert.doesNotMatch(panelSource, /onScroll=/, "a page can be loaded from a React scroll handler again");
});

test("the affordance exists only while the open section has more to load", () => {
  // D-171 replaced one element doing two jobs — an observer target that was
  // also a «Загрузить ещё» button — with five distinct answers to «what is at
  // the end of this list», decided in `lib/sharedMediaBrowsing.ts`. Two of them
  // carry the sentinel; the other three are a refusal, a server with nothing
  // further to give, and a complete list, which draws nothing at all.
  assert.match(
    panelSource,
    /\{tailShown && activeSection && \(tail\.kind === "more" \|\| tail\.kind === "loading"\) && \(/,
    "the end of the list is not gated on the tail state",
  );
  // One element across the load, and the reason is mechanical rather than a
  // matter of focus this time: the observer is attached in an effect keyed on
  // `sectionHasMore`, so a second element swapped in when a page starts leaves
  // it watching a detached node and the list stops at two pages forever.
  assert.equal(
    (panelSource.match(/ref=\{sentinelRef\}/g) ?? []).length,
    1,
    "the observer's target is swapped out mid-load",
  );
  assert.equal((panelSource.match(/data-testid="chat-info-media-sentinel"/g) ?? []).length, 1);
  assert.match(
    panelSource,
    /const sectionHasMore = activeSection\?\.hasMore === true && !autoLoadStalled && !sectionFailed;/,
    "a refused page is retried automatically on every scroll",
  );
  assert.match(
    panelSource,
    /const sectionLoading = activeSection\?\.kind === "link" \? loadingLinks : loadingMedia;/,
    "one loading flag stands for two different queries again",
  );
  assert.match(
    panelSource,
    /const sectionFailed = activeSection\?\.kind === "link" \? linksFailed : mediaFailed;/,
    "one failure flag stands for two different queries",
  );
  // Nothing is left behind when the section is complete: `mediaTailState`
  // answers «complete» and no branch below renders for it.
  assert.doesNotMatch(panelSource, /tail\.kind === "complete"/, "the complete list draws something");
});

test("one request at a time, and none at all once one comes back empty", () => {
  const loader = panelSource.match(/const loadMoreActiveSection = useCallback\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/);
  assert.ok(loader, "nothing loads the next page");
  assert.match(
    loader[0],
    /if \(!activeSection \|\| activeSection\.hasMore !== true\) return;/,
    "a complete section is still fetched",
  );
  assert.match(loader[0], /if \(autoLoadStalled\) return;/, "an exhausted section is fetched forever");
  assert.match(loader[0], /if \(loadingLinks\) return;/, "two link pages can be in flight at once");
  assert.match(loader[0], /if \(loadingMedia\) return;/, "two media pages can be in flight at once");
  // A state flag is only visible after a render, and a second press does not
  // wait for one.
  assert.match(loader[0], /if \(loadingMoreRef\.current\) return;/, "two presses can both start a page");
  assert.match(loader[0], /loadingMoreRef\.current = true;/);
  assert.match(loader[0], /\} finally \{\s*\n\s*loadingMoreRef\.current = false;/, "a failed page locks the list");
  // The guard that the loading flag cannot provide: a request that returns
  // nothing while the total still says there is more.
  assert.match(loader[0], /=== 0\) setAutoLoadStalled\(true\)/, "an empty page does not stop the sentinel");
  assert.equal(
    (loader[0].match(/=== 0\) setAutoLoadStalled\(true\)/g) ?? []).length,
    2,
    "only one of the two queries can stall",
  );
});

test("a page is asked for by cursor, not by how many rows survived", () => {
  // Hidden rows are dropped after they arrive, so the list grows more slowly
  // than the range does. Paging from the list's length re-requests rows that
  // were already refused, and once a whole page is hidden it stops advancing —
  // which, with the button gone, is a loop rather than a stuck control.
  assert.match(panelSource, /mediaCursorRef\.current = start \+ received;/, "the media cursor never advances");
  assert.match(panelSource, /linkCursorRef\.current = start \+ rows\.length;/, "the link cursor never advances");
  assert.doesNotMatch(panelSource, /loadMedia\(false, media\.length\)/, "paging is back on the list's length");
});

test("a page that did not arrive says so rather than looking like the end", () => {
  // This test used to say «a reader who never scrolls can still reach the
  // rest» and pinned the «Загрузить ещё» button as the answer, on the reasoning
  // that «nothing scrolls into view when a reader tabs». That reasoning is
  // wrong: focusing an element scrolls it into view unless `preventScroll` is
  // passed, so tabbing to the last tile moves the sentinel into the observer's
  // 200px margin and the page loads. It is measured rather than argued, in
  // `tests/e2e/shared-media-browsing.spec.ts` — «tabbing to the end of the grid
  // loads the next page» — because a claim about focus behaviour belongs in a
  // browser and not in a source scan.
  //
  // What is pinned here is the contract that replaced it: a refusal is a state
  // of its own, with its own sentence and its own control, and it is never the
  // thing the complete list draws (which is nothing at all). D-140 and D-193
  // are the same defect on other surfaces.
  const failed = panelSource.match(
    /\{tailShown && tail\.kind === "failed" && \(\s*\n[\s\S]*?\n {10}\)\}/,
  );
  assert.ok(failed, "a refused page is drawn as nothing again");
  assert.match(failed[0], /\{tail\.message\}/, "the failure has no sentence");
  assert.match(failed[0], /data-testid="chat-info-media-retry"/, "there is no way to ask again");
  assert.match(failed[0], /onClick=\{retryActiveSection\}/, "the control asks for nothing");
  assert.match(failed[0], /\{tail\.action\}/, "the control has no label");
  // And the empty list distinguishes «nothing here» from «could not read».
  const empty = panelSource.match(/data-testid="chat-info-media-empty"[\s\S]*?\n {12}<\/div>/);
  assert.ok(empty, "the empty list is gone");
  assert.match(empty[0], /\{sectionEmpty\.title\}/, "the empty list hard-codes its own claim again");
  assert.match(empty[0], /sectionEmpty\.retry/, "an unreadable list offers no way to ask again");
  assert.match(panelSource, /const sectionEmpty = mediaEmptyState\(sectionFailed\);/);
  // The loading state still answers `prefers-reduced-motion` through the
  // skeleton, and still tells a screen reader a page is on its way.
  const sentinel = panelSource.match(
    /\{tailShown && activeSection && \(tail\.kind === "more" \|\| tail\.kind === "loading"\) && \(\s*\n[\s\S]*?\n {10}\)\}/,
  );
  assert.ok(sentinel, "nothing is drawn while a page is on its way");
  assert.match(sentinel[0], /KubStableSkeleton/, "the loading indicator animates without a reduced-motion answer");
  assert.match(
    sentinel[0],
    /role=\{tail\.kind === "loading" \? "status" : undefined\}/,
    "a screen reader is not told a page is loading",
  );
  // Neither of the two states the observer watches offers a press: paging
  // happens because the reader arrived, not because they pressed.
  assert.doesNotMatch(sentinel[0], /<button/, "the sentinel is a button pretending to be a sentinel again");
});

test("opening a kind fetches that kind once its total is known", () => {
  const opener = panelSource.match(/const openMediaSection = \(kind: MessageMediaKind\) => \{[\s\S]*?\n  \};/);
  assert.ok(opener, "pressing a counted row no longer opens anything");
  // «96 файлов» is a row because the chat holds ninety-six files, not because a
  // loaded page contained one. Without narrowing the query it opens on nothing.
  assert.match(opener[0], /if \(!mediaCounts \|\| kind === "link" \|\| mediaScope === kind\) return;/);
  assert.match(opener[0], /void loadMedia\(true, kind\);/, "the kind that was opened is never fetched");
  assert.match(opener[0], /mediaCursorRef\.current = 0;/, "the new scope pages from the old scope's cursor");
  assert.match(opener[0], /setAutoLoadStalled\(false\);/, "one exhausted section exhausts every other one");
  assert.match(
    panelSource,
    /\.in\("type", kind \? MEDIA_KIND_MESSAGE_TYPES\[kind\] : MEDIA_MESSAGE_TYPES\)/,
    "the query is not narrowed to the kind that was opened",
  );
});
