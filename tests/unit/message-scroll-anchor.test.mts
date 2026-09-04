import assert from "node:assert/strict";
import test from "node:test";

import {
  captureVisibleMessageAnchor,
  restoreVisibleMessageAnchor,
} from "../../artifacts/kub/src/lib/messageScrollAnchor.ts";

type Rect = { top: number; bottom: number };

function message(id: string, rect: Rect) {
  return {
    dataset: { messageId: id },
    getBoundingClientRect: () => rect,
  };
}

function container(messages: ReturnType<typeof message>[]) {
  return {
    scrollTop: 120,
    scrollHeight: 2_400,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    querySelectorAll: () => messages,
  } as unknown as HTMLElement;
}

test("captures the first message crossing the visible viewport", () => {
  const node = container([
    message("hidden", { top: 20, bottom: 90 }),
    message("visible", { top: 90, bottom: 150 }),
  ]);

  assert.deepEqual(captureVisibleMessageAnchor(node), {
    messageId: "visible",
    viewportOffset: -10,
  });
});

test("restores the same message offset after older rows are prepended", () => {
  const target = message("anchor", { top: 460, bottom: 520 });
  const node = container([target]);

  assert.equal(
    restoreVisibleMessageAnchor(node, { messageId: "anchor", viewportOffset: 40 }),
    true,
  );
  assert.equal(node.scrollTop, 440);
});

test("does not move when the captured message is no longer rendered", () => {
  const node = container([]);
  assert.equal(
    restoreVisibleMessageAnchor(node, { messageId: "missing", viewportOffset: 20 }),
    false,
  );
  assert.equal(node.scrollTop, 120);
});

/**
 * The property the older-history hold is built on.
 *
 * The hold calls this once per animation frame for as long as the prepended
 * rows are still settling, and that is only safe because each call recomputes
 * the correction from where the anchor is NOW. A restore that applied a
 * remembered delta instead would accumulate: the register measured the anchor
 * drifting 1147px while the content grew 6469px, against a contract that allows
 * 3px, and four consecutive settled frames are what release the hold.
 *
 * `live()` models a real scroller: writing `scrollTop` moves every row, exactly
 * as the browser does, so a second call sees the result of the first.
 */
function live(rows: Record<string, number>, scrollTop = 1_000) {
  const state = { scrollTop, rows: { ...rows } };
  const node = {
    get scrollTop() { return state.scrollTop; },
    set scrollTop(next: number) {
      const delta = next - state.scrollTop;
      state.scrollTop = next;
      for (const id of Object.keys(state.rows)) state.rows[id] -= delta;
    },
    scrollHeight: 20_000,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: () => Object.entries(state.rows).map(([id, top]) =>
      message(id, { top, bottom: top + 40 })),
  } as unknown as HTMLElement;
  return { node, state };
}

test("restoring twice converges instead of accumulating", () => {
  const { node, state } = live({ anchor: 300 });
  const anchor = { messageId: "anchor", viewportOffset: 100 };

  restoreVisibleMessageAnchor(node, anchor);
  assert.equal(state.rows.anchor, 100, "the first restore did not land the anchor");
  const afterFirst = state.scrollTop;

  restoreVisibleMessageAnchor(node, anchor);
  assert.equal(state.scrollTop, afterFirst, "a second restore moved the list again");
  assert.equal(state.rows.anchor, 100);
});

test("a restore after the content has grown above the anchor still lands it exactly", () => {
  // What a prepend does: rows arrive above the reader, so their anchor is
  // suddenly far down the viewport. One restore has to put it back wherever it
  // moved to, however far that is.
  const { node, state } = live({ anchor: 100 });
  const anchor = { messageId: "anchor", viewportOffset: 100 };

  state.rows.anchor += 1_275; // the growth the hold exists to absorb
  restoreVisibleMessageAnchor(node, anchor);

  assert.equal(state.rows.anchor, 100);
  assert.equal(state.scrollTop, 1_000 + 1_275);
});

test("a restore never scrolls past the end of the content", () => {
  const { node, state } = live({ anchor: 100 }, 19_000);
  node.scrollTop = 19_000;
  restoreVisibleMessageAnchor(node, { messageId: "anchor", viewportOffset: -50_000 });
  assert.equal(state.scrollTop, 19_400, "the clamp to the last scrollable pixel is gone");
});
