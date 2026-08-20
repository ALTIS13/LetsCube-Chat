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
