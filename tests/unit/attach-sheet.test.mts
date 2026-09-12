import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTACH_SHEET_DEFAULT_TAB,
  ATTACH_SHEET_MAX_SELECTION,
  ATTACH_SHEET_PHONE_REST_SHARE,
  ATTACH_TABS,
  SHEET_FLICK_VELOCITY,
  attachGalleryArrangement,
  attachPicker,
  attachTab,
  attachTabSelection,
  fittedSheetHeight,
  formatAccuracy,
  formatCoordinates,
  locationMessageText,
  nextTabIndex,
  offersSendWithoutCompression,
  opensAttachSheet,
  planAttachSend,
  releaseSheet,
  selectPicked,
  selectedInOrder,
  selectionNumber,
  sheetContentHeight,
  sheetStretch,
  tabRevealScrollLeft,
  tabRowOverflow,
  toggleSelection,
  trappedFocusIndex,
} from "../../artifacts/kub/src/lib/attachSheet.ts";
import { MAX_STAGED_ATTACHMENTS } from "../../artifacts/kub/src/lib/stagedAttachments.ts";

/**
 * D-122: the attach sheet does the job in place, as Telegram's does, and D-119
 * stands inside it — the gallery sends compressed without a question and the
 * originals are a named function. These are the sheet's decisions without the
 * page around them, and they are the product's now: there is no switch beside
 * them and no second look to answer for.
 */

const MiB = 1024 * 1024;
const photo = (size = 2 * MiB) => ({ type: "image/jpeg", size });
const video = (size = 20 * MiB) => ({ type: "video/mp4", size });
const document = (size = 60 * MiB) => ({ type: "application/pdf", size });

test("the sheet opens on the gallery; the three tabs that work come first, and three placeholders follow «Геопозиция»", () => {
  assert.equal(ATTACH_SHEET_DEFAULT_TAB, "gallery");
  assert.equal(ATTACH_TABS[0].id, ATTACH_SHEET_DEFAULT_TAB, "the sheet opens on a tab that is not the first");
  assert.deepEqual(ATTACH_TABS.map((tab) => tab.id), ["gallery", "file", "location", "poll", "checklist", "contact"]);
  assert.deepEqual(ATTACH_TABS.map((tab) => tab.label), ["Галерея", "Файл", "Геопозиция", "Опрос", "Список", "Контакт"]);
  // The owner saw «Музыка» rendered beside them and said he does not want it.
  assert.equal(ATTACH_TABS.some((tab) => String(tab.id) === "music"), false, "«Музыка» is a tab again");
  assert.deepEqual(
    ATTACH_TABS.filter((tab) => tab.kind === "working").map((tab) => tab.id),
    ["gallery", "file", "location"],
    "Telegram's three working tabs, in Telegram's order",
  );
  for (const tab of ATTACH_TABS) assert.equal(attachTab(tab.id), tab);
});

test("a placeholder tab says what it is and that it is coming, and has nothing to select or send", () => {
  const placeholders = ATTACH_TABS.flatMap((tab) => (tab.kind === "placeholder" ? [tab] : []));
  assert.deepEqual(placeholders.map((tab) => tab.id), ["poll", "checklist", "contact"]);
  for (const tab of placeholders) {
    assert.match(tab.soon, /^Скоро здесь можно будет \S/, `${tab.label}: the line does not say the function is coming`);
    assert.doesNotMatch(tab.soon, /[\r\n]/, `${tab.label}: more than one line`);
    assert.equal(attachTabSelection(tab.id), null, `${tab.label} has a selection, so a caption and a send button`);
    assert.equal(offersSendWithoutCompression(tab.id, [photo(), video()]), false, `${tab.label} offers «Отправить без сжатия»`);
  }
  assert.equal(new Set(placeholders.map((tab) => tab.soon)).size, placeholders.length, "two placeholders say the same line");
  assert.equal(attachTabSelection("gallery"), "gallery");
  assert.equal(attachTabSelection("file"), "file");
  assert.equal(attachTabSelection("location"), null, "«Геопозиция» sends from its own row, never from a selection");
});

test("the arrows walk the tabs and wrap, Home and End reach the ends, other keys are left alone", () => {
  assert.equal(nextTabIndex(0, "ArrowRight", 3), 1);
  assert.equal(nextTabIndex(2, "ArrowRight", 3), 0);
  assert.equal(nextTabIndex(0, "ArrowLeft", 3), 2);
  assert.equal(nextTabIndex(1, "Home", 3), 0);
  assert.equal(nextTabIndex(0, "End", 3), 2);
  for (const key of ["Enter", " ", "Tab", "ArrowDown", "a"]) assert.equal(nextTabIndex(1, key, 3), null, key);
  assert.equal(nextTabIndex(0, "ArrowRight", 0), null);
  // Over the whole row: End is «Контакт», and «Галерея» and «Контакт» wrap into each other.
  const count = ATTACH_TABS.length;
  assert.equal(ATTACH_TABS[nextTabIndex(0, "End", count)!].id, "contact");
  assert.equal(ATTACH_TABS[nextTabIndex(0, "ArrowLeft", count)!].id, "contact");
  assert.equal(ATTACH_TABS[nextTabIndex(count - 1, "ArrowRight", count)!].id, "gallery");
  assert.equal(ATTACH_TABS[nextTabIndex(2, "ArrowRight", count)!].id, "poll");
});

test("a tab row wider than the sheet says which end hides tabs, and brings a tab into view with the next one peeking in", () => {
  const row = { viewportWidth: 390, contentWidth: 560 };
  assert.equal(tabRowOverflow({ ...row, scrollLeft: 0 }), "end");
  assert.equal(tabRowOverflow({ ...row, scrollLeft: 85 }), "both");
  assert.equal(tabRowOverflow({ ...row, scrollLeft: 170 }), "start");
  assert.equal(tabRowOverflow({ ...row, scrollLeft: 169.5 }), "start", "half a pixel of rounding is not a hidden tab");
  assert.equal(tabRowOverflow({ viewportWidth: 560, contentWidth: 560, scrollLeft: 0 }), "none");

  const reveal = (scrollLeft: number, tabStart: number, tabEnd: number) =>
    tabRevealScrollLeft({ ...row, scrollLeft, tabStart, tabEnd, margin: 28 });
  assert.equal(reveal(0, 480, 556), 170, "the last tab goes to the end of the row, and no further");
  assert.equal(reveal(0, 320, 396), 34, "a tab half out on the right comes in with room beyond it");
  assert.equal(reveal(170, 160, 236), 132, "a tab half out on the left comes in with room before it");
  assert.equal(reveal(40, 100, 176), 40, "a tab already in view moved the row");
  assert.equal(reveal(170, 4, 80), 0, "the first tab goes to the start, not past it");
});

test("Tab never leaves the sheet: it wraps both ways, and enters at an end", () => {
  assert.equal(trappedFocusIndex(4, 5, false), 0);
  assert.equal(trappedFocusIndex(0, 5, true), 4);
  assert.equal(trappedFocusIndex(2, 5, false), 3);
  assert.equal(trappedFocusIndex(-1, 5, false), 0);
  assert.equal(trappedFocusIndex(-1, 5, true), 4);
  assert.equal(trappedFocusIndex(0, 0, false), -1);
});

test("the camera is the phone's own, asked for only through the picker, and only «Файл» and the gallery's originals skip compression", () => {
  const camera = attachPicker("camera");
  assert.equal(camera.capture, "environment");
  assert.equal(camera.accept, "image/*,video/*");
  assert.equal(camera.compress, true);
  assert.equal(camera.source, "camera");
  assert.equal(camera.multiple, false);
  // Capacitor's WebView opens a camera for `capture` only with exactly one of the two types.
  assert.equal(attachPicker("camera", { androidNative: true }).accept, "image/*");
  assert.equal(attachPicker("library", { androidNative: true }).accept, "image/*,video/*");

  const library = attachPicker("library");
  assert.deepEqual([library.accept, library.capture, library.multiple, library.compress], ["image/*,video/*", null, true, true]);

  const originals = attachPicker("library-original");
  assert.deepEqual([originals.accept, originals.multiple, originals.compress], ["image/*,video/*", true, false]);

  const file = attachPicker("file");
  assert.deepEqual([file.accept, file.capture, file.multiple, file.compress], [null, null, true, false]);
});

test("a selection is numbered in the order it was made, and closes up when one leaves", () => {
  let selected: string[] = [];
  selected = toggleSelection(selected, "b");
  selected = toggleSelection(selected, "a");
  selected = toggleSelection(selected, "c");
  assert.deepEqual(selected, ["b", "a", "c"]);
  assert.equal(selectionNumber(selected, "a"), 2);
  selected = toggleSelection(selected, "b");
  assert.deepEqual(selected, ["a", "c"]);
  assert.equal(selectionNumber(selected, "a"), 1);
  assert.equal(selectionNumber(selected, "b"), null);

  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(selectedInOrder(items, ["c", "missing", "a"]).map((item) => item.id), ["c", "a"]);
});

test("the sheet selects no more than the composer can send at once", () => {
  assert.equal(ATTACH_SHEET_MAX_SELECTION, MAX_STAGED_ATTACHMENTS);
  const full = Array.from({ length: ATTACH_SHEET_MAX_SELECTION }, (_, index) => `p${index}`);
  assert.deepEqual(toggleSelection(full, "one-more"), full, "a tap past the limit selected");
  assert.deepEqual(toggleSelection(full, "p3").length, ATTACH_SHEET_MAX_SELECTION - 1, "a selected item could not be deselected at the limit");

  const picked = selectPicked(["a"], ["b", "a", "c"], 3);
  assert.deepEqual(picked, { selected: ["a", "b", "c"], refused: 0 });
  assert.deepEqual(selectPicked(["a", "b"], ["c", "d", "e"], 3), { selected: ["a", "b", "c"], refused: 2 });
});

test("the gallery sends compressed as it is; «без сжатия» leaves an original over 50 MB behind and sends the rest", () => {
  const files = [photo(), photo(50 * MiB + 1), video(80 * MiB), document()];
  assert.deepEqual(planAttachSend(files, "compressed"), { send: files, refused: [], compress: true });

  const originals = planAttachSend(files, "original");
  assert.equal(originals.compress, false);
  assert.deepEqual(originals.send, [files[0], files[3]], "a document is not refused as an original, only a photo or a video");
  assert.deepEqual(originals.refused, [files[1], files[2]]);
  assert.deepEqual(planAttachSend([photo(50 * MiB)], "original").refused, [], "exactly 50 MB is within the limit");
});

test("«Отправить без сжатия» is offered where there is something to compress, and nowhere else", () => {
  assert.equal(offersSendWithoutCompression("gallery", [photo()]), true);
  assert.equal(offersSendWithoutCompression("gallery", [document(), video()]), true);
  assert.equal(offersSendWithoutCompression("gallery", [document()]), false);
  assert.equal(offersSendWithoutCompression("file", [photo()]), false, "«Файл» already sends the original");
  assert.equal(offersSendWithoutCompression("location", [photo()]), false);
});

test("the gallery opens on two tiles, and picks turn it into the grid", () => {
  assert.equal(attachGalleryArrangement(0), "tiles");
  assert.equal(attachGalleryArrangement(1), "grid");
  assert.equal(attachGalleryArrangement(ATTACH_SHEET_MAX_SELECTION), "grid");
});

test("a sheet at rest leaves the conversation above it", () => {
  assert.ok(
    ATTACH_SHEET_PHONE_REST_SHARE > 0.5 && ATTACH_SHEET_PHONE_REST_SHARE <= 0.75,
    "the sheet at rest either hides the conversation or barely shows itself",
  );
});

test("pasted or dropped photos open the sheet on every device; a camera shot or documents alone do not", () => {
  assert.equal(opensAttachSheet({ source: "paste", files: [photo()] }), true);
  assert.equal(opensAttachSheet({ source: "drop", files: [document(), video()] }), true);
  assert.equal(opensAttachSheet({ source: "picker", files: [photo()] }), true);
  assert.equal(opensAttachSheet({ source: "camera", files: [photo()] }), false);
  assert.equal(opensAttachSheet({ source: "drop", files: [document()] }), false);
  // No shape to ask about: a desktop pick goes to the sheet exactly as a phone's
  // does, which is what retiring the desktop send dialog means (D-122).
  assert.equal(opensAttachSheet.length, 1, "the sheet's gate takes something besides the files again");
});

test("a sheet let go of: a flick goes one detent its way, a third of the way moves, less springs back", () => {
  const sizes = { restHeight: 540, fullHeight: 860 };
  const at = (detent: "rest" | "full", dy: number, velocity = 0) => releaseSheet({ detent, dy, velocity, ...sizes });

  // A third of the 540pt sheet is 180; a third of the 320pt stretch to full is about 107.
  assert.equal(at("rest", 0), "rest");
  assert.equal(at("rest", 170), "rest", "under a third of the sheet closed it");
  assert.equal(at("rest", 190), "close");
  assert.equal(at("rest", -110), "full");
  assert.equal(at("rest", -100), "rest", "under a third of the stretch opened it fully");
  assert.equal(at("rest", 10, SHEET_FLICK_VELOCITY), "close");
  assert.equal(at("rest", -10, -SHEET_FLICK_VELOCITY), "full");

  assert.equal(at("full", 110), "rest");
  assert.equal(at("full", 100), "full");
  assert.equal(at("full", 320 + 170), "rest");
  assert.equal(at("full", 320 + 190), "close");
  assert.equal(at("full", 5, SHEET_FLICK_VELOCITY), "rest", "a flick from full closed the sheet outright");
});

test("a sheet already as tall as all it holds has no taller detent: up springs back, down still closes", () => {
  const fitted = { restHeight: 300, fullHeight: 300 };
  const at = (detent: "rest" | "full", dy: number, velocity = 0) => releaseSheet({ detent, dy, velocity, ...fitted });
  assert.equal(at("rest", -200), "rest", "a drag up on a sheet with nothing more to show took it to full height");
  assert.equal(at("rest", -10, -2 * SHEET_FLICK_VELOCITY), "rest", "a flick up on it did");
  assert.equal(at("rest", 90), "rest");
  assert.equal(at("rest", 110), "close", "a third of a 300pt sheet is 100");
  assert.equal(at("rest", 5, SHEET_FLICK_VELOCITY), "close");
  assert.equal(at("full", 5, SHEET_FLICK_VELOCITY), "close", "a flick down from a full height that is the rest height went nowhere");
});

test("the sheet's height follows its content: short for two tiles, grown by picks, never past its ceiling", () => {
  // Measured on a 699pt sheet whose scrolling part is 480 of it: the chrome is 219.
  assert.equal(sheetContentHeight({ sheet: 699, scroller: 480, content: 142 }), 361, "two tiles make a 361pt sheet");
  assert.equal(sheetContentHeight({ sheet: 699, scroller: 480, content: 287 }), 506, "three picks grow it");
  assert.equal(sheetContentHeight({ sheet: 500, scroller: 281, content: 142 }), 361, "mid-animation the answer moved");
  assert.equal(sheetContentHeight({ sheet: 699.4, scroller: 480.1, content: 142.2 }), 362, "rounded down, the content would scroll a pixel");

  // The CSS height is the content's, under the option's ceiling, which a tall content reaches and scrolls under.
  assert.deepEqual(fittedSheetHeight({ ceiling: "75dvh", content: 361 }), { height: "min(75dvh, 361px)" });
  assert.deepEqual(fittedSheetHeight({ ceiling: "75dvh", content: 360.2 }), { height: "min(75dvh, 361px)" });
  // Unmeasured, the browser sizes it to the content under the same ceiling: no fixed share of the screen.
  assert.deepEqual(fittedSheetHeight({ ceiling: "75dvh", content: null }), { height: "auto", maxHeight: "75dvh" });
  assert.deepEqual(
    fittedSheetHeight({ ceiling: "75dvh", content: 361, stretch: 40, available: "92dvh" }),
    { height: "min(92dvh, calc(min(75dvh, 361px) + 40px))" },
  );
  assert.deepEqual(fittedSheetHeight({ ceiling: "75dvh", content: 361, stretch: 0.4 }), { height: "min(75dvh, 361px)" });

  // Dragged up, it follows the finger until it shows all it holds, then gives a third.
  assert.equal(sheetStretch({ dy: -100, height: 699, content: 1400 }), 100);
  assert.equal(sheetStretch({ dy: -90, height: 361, content: 361 }), 30, "a sheet with nothing more to show followed the finger");
  assert.equal(sheetStretch({ dy: -159, height: 361, content: 400 }), 79, "39 of room, then a third of the remaining 120");
  assert.equal(sheetStretch({ dy: 50, height: 361, content: 361 }), 0, "a drag down stretched it");
  assert.equal(sheetStretch({ dy: -90, height: 361, content: null }), 30, "unmeasured, it only gives");
});

test("a place is shown to about a metre with the device's accuracy, and sent in the message it always was", () => {
  assert.equal(formatCoordinates(55.7558, 37.6173), "55.75580, 37.61730");
  assert.equal(formatCoordinates(-33.8688, 151.2093), "-33.86880, 151.20930");
  // The unit stays on the number's line.
  const NBSP = String.fromCharCode(0xa0);
  assert.equal(formatAccuracy(18.4), `18${NBSP}м`);
  assert.equal(formatAccuracy(0.4), `1${NBSP}м`, "a sub-metre figure reads as zero metres");
  assert.equal(formatAccuracy(0), null);
  assert.equal(formatAccuracy(1234), `1,2${NBSP}км`);
  assert.equal(formatAccuracy(Number.NaN), null);
  assert.equal(formatAccuracy(undefined), null);
  // The text the one-tap item sent, character for character, so a conversation
  // draws a shared location exactly as it did.
  const latitude = 55.7558;
  const longitude = 37.6173;
  assert.equal(locationMessageText(latitude, longitude), `📍 Местоположение: https://maps.google.com/?q=${latitude},${longitude}`);
});
