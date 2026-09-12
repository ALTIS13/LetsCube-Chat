import assert from "node:assert/strict";
import test from "node:test";

import * as mediaVariantRules from "../../artifacts/api-server/dist/workers/mediaVariantRules.mjs";
import { originalPreviewDimensions } from "../../artifacts/kub/src/lib/mediaCompression.ts";

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
  const source = `chat-avatars/${id}/avatar-c457a326-c0f1-44ee-b7bf-1200e6db51f3.png`;
  assert.ok(
    mediaVariantRules.buildChatAvatarVariantPath(id, "avatar_128", source)
      .startsWith(`variants/chats/${id}/`),
  );
  assert.equal(
    mediaVariantRules.buildProfileAvatarVariantPath(id, "avatar_128"),
    `variants/profiles/${id}/avatar_128.webp`,
  );
  assert.notEqual(
    mediaVariantRules.buildChatAvatarVariantPath(id, "avatar_256", source),
    mediaVariantRules.buildProfileAvatarVariantPath(id, "avatar_256"),
  );
});

test("a chat avatar variant cannot be found by knowing the chat id", () => {
  // The bytes are served publicly, so the database row's membership scope
  // protects the row and not the picture. What actually keeps a group photo
  // from a non-member is that the original's name carries a random uuid and
  // `chats` — the only place that name is written down — is readable by
  // members alone. A variant addressed by chat id would give that away.
  const id = "7be464a0-a510-4e09-9f70-69d17a5eab02";
  const source = `chat-avatars/${id}/avatar-c457a326-c0f1-44ee-b7bf-1200e6db51f3.png`;
  const path = mediaVariantRules.buildChatAvatarVariantPath(id, "avatar_128", source);

  assert.notEqual(path, `variants/chats/${id}/avatar_128.webp`);
  // Everything an outsider could assemble from the id alone, spelled out.
  for (const guess of [
    `variants/chats/${id}/avatar_128.webp`,
    `variants/chats/${id}/avatar_256.webp`,
    `variants/chats/${id}/128.webp`,
    `variants/chats/${id}.webp`,
  ]) {
    assert.notEqual(path, guess, `${guess} is reachable without the source path`);
  }

  // A second picture in the same chat must not land on the first one's address.
  const replacement = `chat-avatars/${id}/avatar-faf64d3c-266c-47f9-8ad2-8f1634d59630.png`;
  assert.notEqual(mediaVariantRules.buildChatAvatarVariantPath(id, "avatar_128", replacement), path);

  // Deterministic, or every worker tick would orphan the last tick's upload.
  assert.equal(mediaVariantRules.buildChatAvatarVariantPath(id, "avatar_128", source), path);
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

test("an image_preview keeps a tall picture's short side", () => {
  const preview = (width, height) => mediaVariantRules.imagePreviewSize(width, height, 1280);
  assert.deepEqual(preview(4032, 3024), { width: 1280, height: 960 }, "an ordinary photograph is unchanged");
  assert.deepEqual(preview(1920, 1080), { width: 1280, height: 720 }, "16:9 is where the floor starts to bite");
  // A 1290x2796 screenshot as it is stored once compressed. It was 591x1280,
  // and the bubble draws a tall picture about 720x1440 device pixels (D-116).
  assert.deepEqual(preview(1080, 2341), { width: 720, height: 1561 });
  assert.deepEqual(preview(2000, 1000), { width: 1440, height: 720 });
  assert.deepEqual(preview(1080, 20000), { width: 138, height: 2560 }, "the long side still stops");
  assert.deepEqual(preview(800, 600), { width: 800, height: 600 }, "never enlarged");
  assert.deepEqual(preview(0, 0), { width: 1280, height: 1280 }, "an unreadable size keeps the square box");
});

test("the worker's preview is the same size as the one a sender uploads", () => {
  // The comment in each file points at the other; this is that promise checked
  // rather than described. They have to agree, or a picture changes size under
  // the reader the moment the worker's copy takes over from the sender's.
  const sizes = [
    [4032, 3024],
    [3024, 4032],
    [1290, 2796],
    [1080, 2341],
    [1920, 1080],
    [2000, 1000],
    [1080, 20000],
    [1000, 800],
    [5000, 3],
  ];
  for (const [width, height] of sizes) {
    assert.deepEqual(
      mediaVariantRules.imagePreviewSize(width, height, 1280),
      originalPreviewDimensions(width, height),
      `${width}x${height}`,
    );
  }
});

test("a quarter-turned photograph is sized on the axes it will be shown on", () => {
  const oriented = mediaVariantRules.orientedImageSize;
  assert.deepEqual(oriented({ width: 2341, height: 1080, orientation: 6 }), { width: 1080, height: 2341 });
  assert.deepEqual(oriented({ width: 2341, height: 1080, orientation: 8 }), { width: 1080, height: 2341 });
  assert.deepEqual(oriented({ width: 1080, height: 2341, orientation: 1 }), { width: 1080, height: 2341 });
  assert.deepEqual(oriented({ width: 1080, height: 2341, orientation: 4 }), { width: 1080, height: 2341 }, "mirrored, not turned");
  assert.deepEqual(oriented({ width: 1080, height: 2341 }), { width: 1080, height: 2341 });
  assert.equal(oriented({ width: 0, height: 2341 }), null);
  assert.equal(oriented({}), null);
  // Why it matters: the box has a floor on the short side, so reading the axes
  // as stored would size this portrait photograph as a landscape one.
  assert.deepEqual(mediaVariantRules.imagePreviewSize(2341, 1080, 1280), { width: 1561, height: 720 });
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
