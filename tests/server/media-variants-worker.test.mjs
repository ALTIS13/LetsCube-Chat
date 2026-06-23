import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMessageVariantPath,
  getExpectedMessageVariantKinds,
} from "../../artifacts/api-server/dist/workers/mediaVariantRules.mjs";

test("media variants worker requests image and video variants by message type", () => {
  assert.deepEqual(getExpectedMessageVariantKinds({ type: "image" }), [
    "image_thumb",
    "image_preview",
  ]);
  assert.deepEqual(getExpectedMessageVariantKinds({ type: "video" }), [
    "video_poster",
  ]);
  assert.deepEqual(getExpectedMessageVariantKinds({ type: "audio" }), []);
});

test("media variants worker stores message variants under deterministic paths", () => {
  assert.equal(
    buildMessageVariantPath("chat-1", "message-2", "video_poster", "webp"),
    "variants/messages/chat-1/message-2/video_poster.webp",
  );
});
