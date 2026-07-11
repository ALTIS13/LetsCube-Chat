import assert from "node:assert/strict";
import test from "node:test";

import * as mediaVariantRules from "../../artifacts/api-server/dist/workers/mediaVariantRules.mjs";

test("media variants worker requests image and video variants by message type", () => {
  assert.deepEqual(mediaVariantRules.getExpectedMessageVariantKinds({ type: "image" }), [
    "image_thumb",
    "image_preview",
  ]);
  assert.deepEqual(mediaVariantRules.getExpectedMessageVariantKinds({ type: "video" }), [
    "video_poster",
    "video_720p",
  ]);
  assert.deepEqual(mediaVariantRules.getExpectedMessageVariantKinds({ type: "audio" }), []);
});

test("media variants worker stores message variants under deterministic paths", () => {
  assert.equal(
    mediaVariantRules.buildMessageVariantPath("chat-1", "message-2", "video_poster", "webp"),
    "variants/messages/chat-1/message-2/video_poster.webp",
  );
  assert.equal(
    mediaVariantRules.buildMessageVariantPath("chat-1", "message-2", "video_720p", "mp4"),
    "variants/messages/chat-1/message-2/video_720p.mp4",
  );
});

test("media variants worker processes only video variants that are not ready", () => {
  assert.equal(typeof mediaVariantRules.getMissingMessageVariantKinds, "function");
  if (typeof mediaVariantRules.getMissingMessageVariantKinds !== "function") return;
  assert.deepEqual(
    mediaVariantRules.getMissingMessageVariantKinds({ type: "video" }, new Set(["video_poster"])),
    ["video_720p"],
  );
});

test("media variants worker uses bounded 720p encoding defaults", () => {
  assert.deepEqual(mediaVariantRules.VIDEO_720P_ENCODING, {
    width: 1280,
    height: 720,
    preset: "veryfast",
    crf: 24,
    maxRate: "3M",
    bufferSize: "6M",
    audioBitrate: "128k",
    pixelFormat: "yuv420p",
    fastStart: true,
  });
});

test("media variants worker uses bounded error codes", () => {
  assert.equal(typeof mediaVariantRules.sanitizeVariantErrorCode, "function");
  if (typeof mediaVariantRules.sanitizeVariantErrorCode !== "function") return;
  assert.equal(mediaVariantRules.sanitizeVariantErrorCode("ETIMEDOUT"), "etimedout");
  assert.equal(
    mediaVariantRules.sanitizeVariantErrorCode("source/path/example.mp4"),
    "variant_generation_failed",
  );
});
