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
import {
  PROFILE_WINDOW_DEFAULT_SIZE,
  PROFILE_WINDOW_STORAGE_KEY,
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

test("there is one profile surface, and the chat list opens it", () => {
  const list = readFileSync("artifacts/kub/src/components/sidebar/ChatList.tsx", "utf8");
  // Right-clicking a row used to open a second, differently shaped mini-profile
  // with its own subset of these very actions.
  assert.doesNotMatch(list, /ChatProfilePreviewModal/, "the second profile surface is back");
  assert.doesNotMatch(list, /setPreviewChatId/, "the chat list owns profile state of its own again");
  assert.doesNotMatch(list, /data-chat-profile-preview/, "the mini-profile markup is back");

  // Both entries must reach the card, and by the route the chat window already
  // listens on — the same one «Поиск в чате» uses.
  const profileAction = list.match(/id: "profile",[\s\S]{0,220}?\n\s{6}\}\);/);
  assert.ok(profileAction, "the chat list no longer offers «Открыть профиль»");
  assert.match(profileAction[0], /selectAndOpenPanel\("info"\)/, "«Открыть профиль» opens something else");

  const groupAction = list.match(/id: "group-info",[\s\S]{0,260}?\n\s{6}\}\);/);
  assert.ok(groupAction, "the chat list no longer offers the group information entry");
  assert.match(groupAction[0], /selectAndOpenPanel\("info"\)/, "the group entry opens something else");
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
    ["уведомления", /onClick=\{\(\) => toggleMutedChat\(chat\.id\)\}[\s\S]{0,600}?Включить уведомления/],
    ["Закрепить чат", /onClick=\{handlePinToggle\}[\s\S]{0,400}?Открепить чат[\s\S]{0,40}?Закрепить чат/],
    ["Очистить историю у себя", /onClick=\{handleClearForMe\}[\s\S]{0,500}?Очистить историю у себя/],
    ["Удалить чат у себя", /onClick=\{handleHidePrivateChat\}[\s\S]{0,400}?Удалить чат у себя/],
    ["Покинуть группу", /setLeaveGroupOpen\(true\)[\s\S]{0,700}?Покинуть группу/],
    ["Удалить групповой чат", /setDeleteGroupOpen\(true\)[\s\S]{0,700}?Удалить групповой чат/],
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
    /const windowTitle = view === "gallery" \? \(activeSection\?\.label \?\? "Общие медиа"\) : rootTitle;/,
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
    /const observer = new IntersectionObserver\([\s\S]*?\n {2}\}, \[view, sectionHasMore, activeMediaSection\]\);/,
  );
  assert.ok(observer, "nothing watches the end of the list");
  assert.match(observer[0], /observer\.observe\(node\)/, "the sentinel is never observed");
  assert.match(observer[0], /observer\.disconnect\(\)/, "the observer outlives the sub-view");
  assert.match(observer[0], /root: mediaScrollerRef\.current/, "the observer watches the page, not the list's scroller");
  // Polling offsets is the thing this replaced.
  assert.doesNotMatch(panelSource, /scrollTop/, "the list is back to reading scroll offsets");
  assert.doesNotMatch(panelSource, /onScroll=/, "the list is back to reading scroll offsets");
});

test("the affordance exists only while the open section has more to load", () => {
  const sentinel = panelSource.match(
    /\{activeSection && sectionHasMore && \(\s*\n\s*<div ref=\{sentinelRef\}[\s\S]*?\n {10}\)\}/,
  );
  assert.ok(sentinel, "the end of the list is not gated on the section having more");
  // Nothing is left behind when the section is complete: no empty row, no
  // disabled control, no permanent spinner.
  assert.match(sentinel[0], /data-testid="chat-info-media-sentinel"/);
  assert.match(
    panelSource,
    /const sectionHasMore = activeSection\?\.hasMore === true && !autoLoadStalled;/,
    "«more» is no longer asked of the section that is open",
  );
  assert.match(
    panelSource,
    /const sectionLoading = activeSection\?\.kind === "link" \? loadingLinks : loadingMedia;/,
    "one loading flag stands for two different queries again",
  );
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

test("a reader who never scrolls can still reach the rest", () => {
  const sentinel = panelSource.match(
    /\{activeSection && sectionHasMore && \(\s*\n\s*<div ref=\{sentinelRef\}[\s\S]*?\n {10}\)\}/,
  );
  assert.ok(sentinel, "the end of the list is gone");
  // Nothing scrolls into view when a reader tabs, so an observer alone leaves
  // the rest of the list unreachable from the keyboard.
  assert.match(sentinel[0], /onClick=\{\(\) => void loadMoreActiveSection\(\)\}/, "there is no control to press");
  assert.match(sentinel[0], /Загрузить ещё/, "the control has no label");
  // One element across the load: unmounting the button somebody just pressed
  // drops their focus to the document.
  assert.equal((sentinel[0].match(/<button/g) ?? []).length, 1, "the control is swapped out mid-load");
  assert.match(sentinel[0], /aria-busy=\{sectionLoading\}/, "a screen reader is not told a page is loading");
  // The indicator is a skeleton, which is where this codebase already answers
  // `prefers-reduced-motion` — see `.kub-skeleton` in index.css.
  assert.match(sentinel[0], /KubStableSkeleton/, "the loading indicator animates without a reduced-motion answer");
  assert.match(sentinel[0], /Загружаем ещё…/, "nothing says a page is on its way");
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
