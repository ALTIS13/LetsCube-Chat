import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_LIST_COLLAPSED_WIDTH,
  CHAT_LIST_COLLAPSE_BELOW,
  CHAT_LIST_DEFAULT_WIDTH,
  CHAT_LIST_MAX_WIDTH,
  CHAT_LIST_MIN_WIDTH,
  FOLDER_RAIL_WIDTH,
  chatListNarrowRatio,
  effectiveChatListWidth,
  liveChatListWidth,
  readDesktopChatListState,
  serializeDesktopChatListState,
  settleChatListState,
  toggleChatListCollapsed,
} from "../../artifacts/kub/src/lib/desktopChatList.ts";

/**
 * The computer's left region, as the owner approved it on 2026-09-12.
 *
 * Every number here is Telegram Desktop's, quoted from its source in the
 * assessment, and every rule is one the drag can break silently: a width that
 * stops honouring the collapsed flag looks identical in a screenshot taken
 * while the list happens to be open.
 */

test("the rail is Telegram's 72 points and the strip is its 66", () => {
  assert.equal(FOLDER_RAIL_WIDTH, 72, "windowFiltersWidth");
  // padding.left 10 + photoSize 46 + padding.left 10.
  assert.equal(CHAT_LIST_COLLAPSED_WIDTH, 66, "dialogsSmallColumnWidth()");
  assert.equal(CHAT_LIST_MIN_WIDTH, 260, "columnMinimalWidthLeft");
  assert.equal(CHAT_LIST_MAX_WIDTH, 540, "columnMaximalWidthLeft");
  // The band a drag crosses to collapse lies strictly between the two resting
  // widths, so neither is reachable by a twitch.
  assert.ok(CHAT_LIST_COLLAPSE_BELOW > CHAT_LIST_COLLAPSED_WIDTH);
  assert.ok(CHAT_LIST_COLLAPSE_BELOW < CHAT_LIST_MIN_WIDTH);
});

/**
 * The stylesheet writes the first frame and the script writes every frame
 * after it, so the two have to agree — the shape of rule 8's bootstrap colour,
 * where a value written outside any stylesheet had to match the one inside it
 * or a cold start flashed the old one.
 */
test("the stylesheet's defaults are the module's defaults", () => {
  const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");
  assert.ok(
    css.includes(`--kub-chat-list-width: ${CHAT_LIST_DEFAULT_WIDTH}px;`),
    `index.css does not declare --kub-chat-list-width as ${CHAT_LIST_DEFAULT_WIDTH}px, so the first frame is a different width from every frame after it`,
  );
  assert.ok(
    css.includes("--kub-chat-list-narrow: 0;"),
    "index.css does not declare --kub-chat-list-narrow, so a row reads no ratio until the script runs",
  );
  // The strip's arithmetic, written down where it can be checked. Telegram
  // spends its 66 as 10 + 46 + 10; ours is 9 + 48 + 9, because the product's
  // avatar is 48 everywhere and the padding is what gives way. The stylesheet
  // takes 3px off each side at ratio 1, from the row's resting 0.75rem.
  assert.equal(CHAT_LIST_COLLAPSED_WIDTH, 9 + 48 + 9);
  assert.ok(
    css.includes("padding-inline: calc(0.75rem - 3px * var(--kub-chat-list-narrow));"),
    "the row no longer narrows its padding to 9px, so the strip is not 66pt wide",
  );
});

test("narrowing is a ratio, so the row interpolates instead of switching mode", () => {
  assert.equal(chatListNarrowRatio(CHAT_LIST_MAX_WIDTH), 0);
  assert.equal(chatListNarrowRatio(CHAT_LIST_MIN_WIDTH), 0);
  assert.equal(chatListNarrowRatio(CHAT_LIST_COLLAPSED_WIDTH), 1);
  assert.equal(chatListNarrowRatio(0), 1);

  // Halfway between 66 and 260 is 163, and the ratio there is a half.
  assert.equal(chatListNarrowRatio(163), 0.5);

  // Strictly decreasing across the band: a plateau anywhere in here is a snap
  // that no single-point assertion would see.
  let previous = -1;
  for (let width = CHAT_LIST_MIN_WIDTH; width >= CHAT_LIST_COLLAPSED_WIDTH; width -= 1) {
    const ratio = chatListNarrowRatio(width);
    assert.ok(ratio > previous, `the ratio stopped moving at ${width}px`);
    assert.ok(ratio >= 0 && ratio <= 1, `the ratio left 0..1 at ${width}px: ${ratio}`);
    previous = ratio;
  }
  assert.equal(previous, 1);
});

test("a held handle follows the pointer down to the strip and no further", () => {
  assert.equal(liveChatListWidth(400), 400);
  // Through the band, not around it: this is the interpolation the ratio drives.
  assert.equal(liveChatListWidth(150), 150);
  assert.equal(liveChatListWidth(CHAT_LIST_COLLAPSED_WIDTH), CHAT_LIST_COLLAPSED_WIDTH);
  assert.equal(liveChatListWidth(10), CHAT_LIST_COLLAPSED_WIDTH);
  assert.equal(liveChatListWidth(4000), CHAT_LIST_MAX_WIDTH);
  assert.equal(liveChatListWidth(Number.NaN), CHAT_LIST_DEFAULT_WIDTH);
});

test("a released handle settles on the strip or on a normal width, never between", () => {
  assert.deepEqual(settleChatListState(120), { width: CHAT_LIST_COLLAPSED_WIDTH, collapsed: true });
  assert.deepEqual(settleChatListState(CHAT_LIST_COLLAPSE_BELOW - 1), {
    width: CHAT_LIST_COLLAPSED_WIDTH,
    collapsed: true,
  });
  assert.deepEqual(settleChatListState(CHAT_LIST_COLLAPSE_BELOW), {
    width: CHAT_LIST_MIN_WIDTH,
    collapsed: false,
  });
  assert.deepEqual(settleChatListState(420), { width: 420, collapsed: false });
  assert.deepEqual(settleChatListState(900), { width: CHAT_LIST_MAX_WIDTH, collapsed: false });

  // Nothing rests inside the band.
  for (let width = CHAT_LIST_COLLAPSED_WIDTH; width <= CHAT_LIST_MAX_WIDTH; width += 1) {
    const settled = settleChatListState(width);
    const rests = settled.collapsed
      ? settled.width === CHAT_LIST_COLLAPSED_WIDTH
      : settled.width >= CHAT_LIST_MIN_WIDTH && settled.width <= CHAT_LIST_MAX_WIDTH;
    assert.ok(rests, `${width}px settled at ${JSON.stringify(settled)}`);
  }
});

/**
 * The one Telegram gets wrong. tdesktop#6409: the collapsed state does not
 * survive a restart. Ours does, and the flag beats the number so the width the
 * person chose before collapsing is still there to come back to.
 */
test("a collapsed list stays collapsed, and keeps the width it will return to", () => {
  assert.equal(effectiveChatListWidth({ width: 480, collapsed: true }), CHAT_LIST_COLLAPSED_WIDTH);
  assert.equal(effectiveChatListWidth({ width: 480, collapsed: false }), 480);

  const collapsed = toggleChatListCollapsed({ width: 480, collapsed: false });
  assert.deepEqual(collapsed, { width: 480, collapsed: true });
  assert.equal(effectiveChatListWidth(collapsed), CHAT_LIST_COLLAPSED_WIDTH);
  // And back to the width it had, not to the default.
  const reopened = toggleChatListCollapsed(collapsed);
  assert.deepEqual(reopened, { width: 480, collapsed: false });
  assert.equal(effectiveChatListWidth(reopened), 480);
});

test("an out-of-range width is brought back inside whichever way it left", () => {
  assert.equal(effectiveChatListWidth({ width: 40, collapsed: false }), CHAT_LIST_MIN_WIDTH);
  assert.equal(effectiveChatListWidth({ width: 9000, collapsed: false }), CHAT_LIST_MAX_WIDTH);
  assert.equal(effectiveChatListWidth({ width: Number.NaN, collapsed: false }), CHAT_LIST_DEFAULT_WIDTH);
});

test("what storage hands back is trusted only where it is a number and a boolean", () => {
  const stored = serializeDesktopChatListState({ width: 412, collapsed: true });
  assert.deepEqual(readDesktopChatListState(stored), { width: 412, collapsed: true });

  // A round trip through storage keeps both halves.
  const roundTripped = readDesktopChatListState(serializeDesktopChatListState({ width: 300, collapsed: false }));
  assert.deepEqual(roundTripped, { width: 300, collapsed: false });

  for (const raw of [
    null,
    undefined,
    "",
    "not json",
    "[]",
    "42",
    '{"width":"400","collapsed":true}',
    '{"collapsed":"yes"}',
    "{}",
  ]) {
    const state = readDesktopChatListState(raw);
    assert.ok(
      state.width >= CHAT_LIST_MIN_WIDTH && state.width <= CHAT_LIST_MAX_WIDTH,
      `${JSON.stringify(raw)} produced ${state.width}px`,
    );
    assert.equal(typeof state.collapsed, "boolean", `${JSON.stringify(raw)} produced a non-boolean flag`);
  }

  // A string width is not a width, and a truthy non-true is not the flag: both
  // fall back rather than being coerced.
  assert.deepEqual(readDesktopChatListState('{"width":"400","collapsed":true}'), {
    width: CHAT_LIST_DEFAULT_WIDTH,
    collapsed: true,
  });
  assert.equal(readDesktopChatListState('{"collapsed":1}').collapsed, false);
  assert.equal(readDesktopChatListState('{"collapsed":"true"}').collapsed, false);

  // A stored width outside the bounds is clamped on the way in, so a window
  // that was once much wider cannot hand this one a 900px column.
  assert.equal(readDesktopChatListState('{"width":9000}').width, CHAT_LIST_MAX_WIDTH);
  assert.equal(readDesktopChatListState('{"width":10}').width, CHAT_LIST_MIN_WIDTH);
});
