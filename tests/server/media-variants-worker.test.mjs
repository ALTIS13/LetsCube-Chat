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

test("media variants worker keeps a chat's avatar apart from a profile's", () => {
  // The two share the variant kinds, so only the path tells them apart. If a
  // chat and a profile ever had the same uuid the files would overwrite each
  // other, and a group would wear somebody's face.
  const id = "7be464a0-a510-4e09-9f70-69d17a5eab02";
  assert.equal(
    mediaVariantRules.buildChatAvatarVariantPath(id, "avatar_128"),
    `variants/chats/${id}/avatar_128.webp`,
  );
  assert.equal(
    mediaVariantRules.buildProfileAvatarVariantPath(id, "avatar_128"),
    `variants/profiles/${id}/avatar_128.webp`,
  );
  assert.notEqual(
    mediaVariantRules.buildChatAvatarVariantPath(id, "avatar_256"),
    mediaVariantRules.buildProfileAvatarVariantPath(id, "avatar_256"),
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

test("media variants worker scans bounded candidate pages beyond the newest page", () => {
  assert.equal(typeof mediaVariantRules.buildCandidatePageRanges, "function");
  if (typeof mediaVariantRules.buildCandidatePageRanges !== "function") return;
  assert.deepEqual(mediaVariantRules.buildCandidatePageRanges(120, 360), [
    { from: 0, to: 119 },
    { from: 120, to: 239 },
    { from: 240, to: 359 },
  ]);
  assert.deepEqual(mediaVariantRules.buildCandidatePageRanges(120, 125), [
    { from: 0, to: 119 },
    { from: 120, to: 124 },
  ]);
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

test("media variants worker builds bounded 720p ffmpeg args and parses probed dimensions", () => {
  const seam = mediaVariantRules.mediaVariantWorkerTestSeams;
  assert.equal(typeof seam?.buildVideo720pFfmpegArgs, "function");
  if (typeof seam?.buildVideo720pFfmpegArgs !== "function") return;

  assert.deepEqual(seam.buildVideo720pFfmpegArgs("input.mov", "output.mp4", 2), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    "input.mov",
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "scale=w=min(1280\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "24",
    "-maxrate",
    "3M",
    "-bufsize",
    "6M",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-threads",
    "2",
    "-movflags",
    "+faststart",
    "output.mp4",
  ]);
  assert.deepEqual(
    seam.parseVideoDimensions('{"streams":[{"width":1278,"height":718}]}'),
    { width: 1278, height: 718 },
  );
  assert.equal(seam.parseVideoDimensions('{"streams":[{"width":0,"height":718}]}'), null);
});

test("media variants worker builds MIME-aware ready and failed video rows", () => {
  const seam = mediaVariantRules.mediaVariantWorkerTestSeams;
  assert.equal(typeof seam?.buildMessageVariantReadyRow, "function");
  if (typeof seam?.buildMessageVariantReadyRow !== "function") return;

  const message = { id: "message-1", chat_id: "chat-1", user_id: "user-1" };
  const source = { bucket: "media", path: "source/video.mov" };
  const variant = {
    kind: "video_720p",
    path: "variants/messages/chat-1/message-1/video_720p.mp4",
    mimeType: "video/mp4",
    width: 1278,
    height: 718,
    sizeBytes: 12345,
  };

  assert.deepEqual(
    seam.buildMessageVariantReadyRow(message, source, variant, "2026-07-12T00:00:00.000Z"),
    {
      message_id: "message-1",
      chat_id: "chat-1",
      owner_id: "user-1",
      source_bucket: "media",
      source_path: "source/video.mov",
      variant_kind: "video_720p",
      variant_bucket: "media",
      variant_path: "variants/messages/chat-1/message-1/video_720p.mp4",
      mime_type: "video/mp4",
      width: 1278,
      height: 718,
      size_bytes: 12345,
      status: "ready",
      updated_at: "2026-07-12T00:00:00.000Z",
    },
  );
  assert.deepEqual(
    seam.buildMessageVariantFailedRow(
      message,
      source,
      "video_720p",
      "variants/messages/chat-1/message-1/video_720p.mp4",
      "video/mp4",
      "etimedout",
      "2026-07-12T00:00:00.000Z",
    ),
    {
      message_id: "message-1",
      chat_id: "chat-1",
      owner_id: "user-1",
      source_bucket: "media",
      source_path: "source/video.mov",
      variant_kind: "video_720p",
      variant_bucket: "media",
      variant_path: "variants/messages/chat-1/message-1/video_720p.mp4",
      mime_type: "video/mp4",
      status: "failed",
      error_code: "etimedout",
      updated_at: "2026-07-12T00:00:00.000Z",
    },
  );
});

test("media variants worker removes message and source details from storage failure logs", () => {
  const seam = mediaVariantRules.mediaVariantWorkerTestSeams;
  assert.equal(typeof seam?.safeStorageFailureDetails, "function");
  if (typeof seam?.safeStorageFailureDetails !== "function") return;

  const details = seam.safeStorageFailureDetails({
    name: "StorageApiError",
    code: "not_found",
    status: 404,
    message: "private/source/video.mov was not found",
  });
  assert.deepEqual(details, { name: "StorageApiError", code: "not_found", status: 404 });
  assert.equal(Object.hasOwn(details, "message"), false);
  assert.equal(JSON.stringify(details).includes("source/video.mov"), false);
});
