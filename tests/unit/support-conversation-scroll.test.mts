import assert from "node:assert/strict";
import test from "node:test";

import {
  getSupportScrollAction,
  isSupportScrollNearBottom,
} from "../../artifacts/kub/src/lib/support/conversationScroll.ts";

test("support conversation considers a small bottom gap anchored", () => {
  assert.equal(
    isSupportScrollNearBottom({ scrollHeight: 1_200, scrollTop: 620, clientHeight: 500 }),
    true,
  );
  assert.equal(
    isSupportScrollNearBottom({ scrollHeight: 1_200, scrollTop: 300, clientHeight: 500 }),
    false,
  );
});

test("opening another support conversation always starts at the latest message", () => {
  assert.equal(
    getSupportScrollAction({
      conversationChanged: true,
      messageCountIncreased: false,
      wasNearBottom: false,
      lastMessageOwned: false,
    }),
    "bottom",
  );
});

test("incoming updates preserve history reading away from the bottom", () => {
  assert.equal(
    getSupportScrollAction({
      conversationChanged: false,
      messageCountIncreased: true,
      wasNearBottom: false,
      lastMessageOwned: false,
    }),
    "preserve",
  );
});

test("anchored readers and own replies continue to the latest message", () => {
  for (const input of [
    { wasNearBottom: true, lastMessageOwned: false },
    { wasNearBottom: false, lastMessageOwned: true },
  ]) {
    assert.equal(
      getSupportScrollAction({
        conversationChanged: false,
        messageCountIncreased: true,
        ...input,
      }),
      "bottom",
    );
  }
});
