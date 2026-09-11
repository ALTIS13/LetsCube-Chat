import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_ACTION_LABELS,
  deleteDialogOption,
  deleteDialogTitle,
  desktopMessageActions,
  forwardDraftTitle,
  messageActionKind,
  phoneMessageActions,
  selectionCountLabel,
  type MessageActionContext,
} from "../../artifacts/kub/src/lib/messageActions.ts";
import { placeAnchored, placeAtPoint, placePhoneMenu } from "../../artifacts/kub/src/lib/messageMenuPlacement.ts";

/**
 * The owner's menus, 2026-09-11, pinned as lists rather than read out of JSX:
 * the right-click menu by message type, the phone card and its row of icons,
 * the delete dialog's one choice, and where each menu lands on a screen.
 */

const everything = {
  reply: true,
  edit: true,
  pin: true,
  forward: true,
  delete: true,
  select: true,
  retry: true,
  editFailed: true,
  discard: true,
};

function context(overrides: Partial<MessageActionContext>): MessageActionContext {
  return {
    kind: "text",
    own: false,
    localSend: false,
    failed: false,
    pinned: false,
    hasText: true,
    captionEditable: false,
    can: everything,
    ...overrides,
  };
}

const labels = (ids: readonly (keyof typeof MESSAGE_ACTION_LABELS)[]) => ids.map((id) => MESSAGE_ACTION_LABELS[id]);

test("right click on text", () => {
  assert.deepEqual(labels(desktopMessageActions(context({ own: true }))), [
    "Ответить",
    "Изменить",
    "Закрепить",
    "Копировать текст",
    "Копировать ссылку",
    "Переслать",
    "Удалить",
    "Выделить",
  ]);
  // Someone else's text offers no «Изменить».
  assert.ok(!desktopMessageActions(context({ own: false })).includes("edit"));
});

test("right click on a photo", () => {
  assert.deepEqual(labels(desktopMessageActions(context({ kind: "photo", own: true, captionEditable: true }))), [
    "Ответить",
    "Изменить подпись",
    "Закрепить",
    "Сохранить как…",
    "Копировать изображение",
    "Копировать ссылку",
    "Переслать",
    "Удалить",
    "Выделить",
  ]);
});

test("a file, a voice note or a video saves instead of copying an image", () => {
  for (const kind of ["file", "voice", "video"] as const) {
    const actions = desktopMessageActions(context({ kind }));
    assert.ok(actions.includes("saveAs"), `${kind}: no «Сохранить как…»`);
    assert.ok(!actions.includes("copyImage"), `${kind}: an image cannot be copied from it`);
  }
});

test("a caption is only offered for editing where editing cannot break the message", () => {
  // A voice note keeps its duration in the content; editing it would corrupt
  // what the player reads.
  assert.ok(!desktopMessageActions(context({ kind: "voice", own: true, captionEditable: false })).includes("editCaption"));
  assert.ok(desktopMessageActions(context({ kind: "video", own: true, captionEditable: true })).includes("editCaption"));
});

test("a pinned message offers «Открепить» in both menus", () => {
  assert.ok(desktopMessageActions(context({ pinned: true })).includes("unpin"));
  assert.ok(phoneMessageActions(context({ pinned: true })).list.includes("unpin"));
});

test("what a chat does not allow is not offered", () => {
  const none = { ...everything, pin: false, forward: false, delete: false, select: false, reply: false, edit: false };
  assert.deepEqual(labels(desktopMessageActions(context({ own: true, can: none }))), ["Копировать текст", "Копировать ссылку"]);
  assert.deepEqual(phoneMessageActions(context({ own: true, can: none })), { list: ["copyLink", "details"], row: ["copy"] });
});

test("the phone card: a list, then a row of icons", () => {
  assert.deepEqual(phoneMessageActions(context({ own: true })), {
    list: ["copyLink", "forward", "pin", "details"],
    row: ["reply", "copy", "edit", "delete"],
  });
  // Own media edits its caption from the same «Изменить».
  assert.deepEqual(phoneMessageActions(context({ kind: "photo", own: true, captionEditable: true, hasText: false })).row, [
    "reply",
    "copy",
    "edit",
    "delete",
  ]);
  // Someone else's message: no «Изменить».
  assert.deepEqual(phoneMessageActions(context({ own: false })).row, ["reply", "copy", "delete"]);
});

test("a message that has not reached the server offers only what can be done to it", () => {
  const failed = context({ own: true, localSend: true, failed: true });
  assert.deepEqual(labels(desktopMessageActions(failed)), ["Повторить", "Изменить", "Копировать текст", "Удалить"]);
  assert.deepEqual(phoneMessageActions(failed), { list: [], row: ["retry", "editFailed", "copy", "discard"] });
  const pending = context({ own: true, localSend: true, failed: false });
  assert.deepEqual(desktopMessageActions(pending), ["copyText", "discard"]);
});

test("what a message is, for the menu", () => {
  assert.equal(messageActionKind({ type: "text", content: "Привет" }), "text");
  assert.equal(messageActionKind({ type: "image", media_url: "data:image/png;base64,AA" }), "photo");
  assert.equal(messageActionKind({ type: "video", media_url: "https://x/v.mp4" }), "video");
  assert.equal(messageActionKind({ type: "audio", media_url: "https://x/a.webm" }), "voice");
  assert.equal(messageActionKind({ type: "file", media_url: "https://x/a.pdf" }), "file");
  // A media row without its file has nothing to save or copy.
  assert.equal(messageActionKind({ type: "image", media_url: null }), "text");
});

test("the delete dialog: one title, and one choice only where it means something", () => {
  assert.equal(deleteDialogTitle(1), "Удалить сообщение?");
  assert.equal(deleteDialogTitle(2), "Удалить 2 сообщения?");
  assert.equal(deleteDialogTitle(5), "Удалить 5 сообщений?");
  assert.equal(deleteDialogTitle(21), "Удалить 21 сообщение?");

  const base = { count: 1, allOwn: true, chatType: "private", isSavedChat: false, otherName: "Аня" };
  assert.equal(deleteDialogOption(base), "Также удалить для Аня");
  assert.equal(deleteDialogOption({ ...base, otherName: "  " }), "Также удалить для собеседника");
  assert.equal(deleteDialogOption({ ...base, chatType: "group" }), "Удалить у всех");
  // Someone else's message is deleted for the reader only.
  assert.equal(deleteDialogOption({ ...base, allOwn: false }), null);
  // Saved Messages has nobody else to delete it for.
  assert.equal(deleteDialogOption({ ...base, isSavedChat: true }), null);
});

test("the forward bar and the selection bar count in words", () => {
  assert.equal(forwardDraftTitle(1), "Переслать сообщение");
  assert.equal(forwardDraftTitle(2), "Переслать 2 сообщения");
  assert.equal(forwardDraftTitle(11), "Переслать 11 сообщений");
  assert.equal(selectionCountLabel(3), "Выделено: 3");
});

const phone = { width: 390, height: 844 };
const iphone = { top: 59, right: 0, bottom: 34, left: 0 };
const none = { top: 0, right: 0, bottom: 0, left: 0 };

test("a message in the middle of the screen does not move: bar above, card below", () => {
  const placement = placePhoneMenu({
    viewport: phone,
    safe: none,
    bubble: { top: 380, bottom: 440, left: 50, right: 300 },
    bar: { width: 360, height: 52 },
    card: { width: 264, height: 300 },
    align: "start",
  });
  assert.equal(placement.lift, 0);
  assert.equal(placement.bar.top, 380 - 8 - 52);
  assert.equal(placement.card.top, 448);
  assert.equal(placement.bar.left, 18, "the bar starts at the bubble but stays inside the margin");
  assert.equal(placement.card.left, 50);
});

test("the last message above the composer is lifted until the card fits under it", () => {
  const placement = placePhoneMenu({
    viewport: phone,
    safe: iphone,
    bubble: { top: 700, bottom: 740, left: 120, right: 378 },
    bar: { width: 360, height: 52 },
    card: { width: 264, height: 300 },
    align: "end",
  });
  const bottomBound = 844 - 34 - 8;
  assert.equal(740 - placement.lift + 8 + 300, bottomBound, "the card ends exactly at the home indicator's margin");
  assert.ok(placement.card.top + 300 <= bottomBound);
  assert.ok(placement.bar.top >= 59 + 8, "the bar stays clear of the status bar");
  assert.equal(placement.card.left, 378 - 264, "an own message's card hangs from its right edge");
});

test("a message under the header is lowered so the bar fits above it", () => {
  const placement = placePhoneMenu({
    viewport: phone,
    safe: iphone,
    bubble: { top: 70, bottom: 130, left: 50, right: 300 },
    bar: { width: 360, height: 52 },
    card: { width: 264, height: 300 },
    align: "start",
  });
  assert.ok(placement.lift < 0, "the message moves down");
  assert.equal(placement.bar.top, 59 + 8);
  assert.equal(70 - placement.lift - 8 - 52, placement.bar.top);
});

test("a message taller than the screen stays put and the menus are clamped onto the screen", () => {
  const placement = placePhoneMenu({
    viewport: phone,
    safe: iphone,
    bubble: { top: 60, bottom: 900, left: 50, right: 300 },
    bar: { width: 360, height: 52 },
    card: { width: 264, height: 300 },
    align: "start",
  });
  assert.equal(placement.lift, 0);
  assert.ok(placement.bar.top >= 67);
  assert.ok(placement.card.top + 300 <= 844 - 34 - 8);
});

test("a menu at the pointer flips up near the bottom and never leaves the safe screen", () => {
  const screen = { width: 1440, height: 900 };
  assert.deepEqual(placeAtPoint({ viewport: screen, safe: none, point: { x: 600, y: 200 }, size: { width: 256, height: 400 } }), {
    top: 204,
    left: 600,
  });
  assert.deepEqual(placeAtPoint({ viewport: screen, safe: none, point: { x: 1400, y: 800 }, size: { width: 256, height: 400 } }), {
    top: 396,
    left: 1440 - 8 - 256,
  });
});

test("a menu that has to open upwards stops above its message, not above the pointer", () => {
  const screen = { width: 1440, height: 900 };
  const size = { width: 256, height: 360 };
  // Right click in the middle of a message whose top is at 606.
  assert.equal(placeAtPoint({ viewport: screen, safe: none, point: { x: 1000, y: 626 }, size, avoid: { top: 606 } }).top, 606 - 6 - 360);
  // Without the message it would have covered the message's top 16px.
  assert.equal(placeAtPoint({ viewport: screen, safe: none, point: { x: 1000, y: 626 }, size }).top, 626 - 4 - 360);
  // A message too close to the top to fit the menu above it falls back to the pointer.
  assert.equal(placeAtPoint({ viewport: screen, safe: none, point: { x: 1000, y: 700 }, size, avoid: { top: 200 } }).top, 700 - 4 - 360);
});

test("a popover opens where it was asked to, and on the other side when it does not fit", () => {
  const screen = { width: 800, height: 600 };
  const anchor = { top: 300, bottom: 328, left: 400, right: 428 };
  const above = placeAnchored({ viewport: screen, safe: none, anchor, size: { width: 44, height: 200 }, prefer: "above" });
  assert.deepEqual(above, { top: 94, left: 392, side: "above" });
  const nearTop = placeAnchored({
    viewport: screen,
    safe: none,
    anchor: { top: 40, bottom: 68, left: 400, right: 428 },
    size: { width: 44, height: 200 },
    prefer: "above",
  });
  assert.equal(nearTop.side, "below");
  assert.equal(nearTop.top, 74);
});
