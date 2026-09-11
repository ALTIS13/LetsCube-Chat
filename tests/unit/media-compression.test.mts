import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORIGINAL_ATTACHMENT_BYTES,
  ORIGINAL_PREVIEW_MAX_DIMENSION,
  buildAttachmentMediaMetadata,
  exceedsOriginalLimit,
  isCompressibleMediaType,
  isUncompressedMedia,
  mediaSendDialogTitle,
  mediaSendShape,
  originalLimitAlertTitle,
  originalLimitMessage,
  originalPreviewDimensions,
  originalPreviewPath,
  planAttachmentPreparation,
  readOriginalPreview,
  shouldBuildOriginalPreview,
  shouldConfirmMediaSend,
  splitByOriginalLimit,
} from "../../artifacts/kub/src/lib/mediaCompression.ts";
import { applyVideoQualityToAttachments } from "../../artifacts/kub/src/lib/mediaQuality.ts";

/**
 * Testers' complaint 2: photos and videos could only be sent compressed.
 *
 * Approved by the owner: compressed stays the default, and a person can send
 * the original, as in Telegram — «Файл» in the attach menu, marked
 * «Без сжатия», and a «Сжать изображение» checkbox in a desktop's send
 * dialog; no quality is ever asked for (D-119). The original goes as
 * it is, up to 50 MB a file. Every decision that makes that true is here; the
 * browser half is `tests/e2e/media-send-without-compression.spec.ts`.
 */

const MiB = 1024 * 1024;

test("the limit is 50 MB per original, and a file of exactly 50 MB is within it", () => {
  assert.equal(MAX_ORIGINAL_ATTACHMENT_BYTES, 50 * MiB);
  assert.equal(exceedsOriginalLimit(0), false);
  assert.equal(exceedsOriginalLimit(50 * MiB), false, "the limit itself is allowed");
  assert.equal(exceedsOriginalLimit(50 * MiB + 1), true, "one byte over is not");

  const within = { name: "a.jpg", size: 50 * MiB, type: "image/jpeg" };
  const over = { name: "b.jpg", size: 50 * MiB + 1, type: "image/jpeg" };
  const alsoWithin = { name: "c.jpg", size: 10, type: "image/jpeg" };
  // «Файл» takes any file (D-119). A document has no original to refuse: it
  // meets the limit every attachment meets, in that check's words.
  const pdf = { name: "d.pdf", size: 60 * MiB, type: "application/pdf" };
  const film = { name: "e.mp4", size: 60 * MiB, type: "video/mp4" };
  assert.deepEqual(splitByOriginalLimit([within, over, alsoWithin, pdf, film]), {
    within: [within, alsoWithin, pdf],
    over: [over, film],
  });
});

test("a file takes the compressed path by default and the original path only when asked", () => {
  // Compressed, as today: only what the canvas can re-encode is re-encoded.
  assert.equal(planAttachmentPreparation("image/jpeg", true), "compress");
  assert.equal(planAttachmentPreparation("image/png", true), "compress");
  assert.equal(planAttachmentPreparation("image/webp", true), "compress");
  assert.equal(planAttachmentPreparation("image/gif", true), "as-is", "a GIF would lose its animation");
  assert.equal(planAttachmentPreparation("image/heic", true), "as-is");
  assert.equal(planAttachmentPreparation("video/mp4", true), "as-is", "a video is compressed by the server's 720p copy");
  assert.equal(planAttachmentPreparation("application/pdf", true), "as-is");
  assert.equal(planAttachmentPreparation("audio/mpeg", true), "as-is");

  // Without compression every photo and video is the original.
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "video/mp4", "video/quicktime"]) {
    assert.equal(planAttachmentPreparation(type, false), "original", type);
  }
  // A document or a sound has no compressed form to opt out of.
  assert.equal(planAttachmentPreparation("application/pdf", false), "as-is");
  assert.equal(planAttachmentPreparation("audio/mpeg", false), "as-is");
  assert.equal(planAttachmentPreparation("", false), "as-is");

  assert.equal(isCompressibleMediaType("image/png"), true);
  assert.equal(isCompressibleMediaType("video/webm"), true);
  assert.equal(isCompressibleMediaType("application/pdf"), false);
  assert.equal(isCompressibleMediaType(""), false);
});

test("an original over the limit says what is wrong and what to do, where it was asked for", () => {
  const photo = { name: "IMG_2041.JPG", size: 63 * MiB, type: "image/jpeg" };

  // Every space between a number and its unit, and inside a quoted control name,
  // is non-breaking: rendered, «до 50 | МБ» and «Фото или | видео» had split
  // across lines in the dialog and in the phone's alert.
  // «Файл» asks for the original from the attach menu on every device (D-119),
  // so a refusal there names the menu's way out; the dialog names its box.
  const menu = originalLimitMessage(photo, "menu");
  assert.ok(menu, "a 63 MB original is refused");
  assert.match(menu, /IMG_2041\.JPG/);
  assert.match(menu, /63\u00a0МБ/);
  assert.match(menu, /до\u00a050\u00a0МБ/);
  assert.match(menu, /со сжатием/);
  assert.match(menu, /«Фото\u00a0или\u00a0видео»/, "the menu's refusal says where the compressed choice is");
  assert.doesNotMatch(menu, /Сжать/, "a menu has no box to tick, on a desktop either");

  const dialog = originalLimitMessage(photo, "dialog");
  assert.ok(dialog);
  assert.match(dialog, /IMG_2041\.JPG/);
  assert.match(dialog, /«Сжать\u00a0изображение»/, "the dialog's refusal names the box it is looking at");
  assert.match(dialog, /уберите/);

  assert.equal(originalLimitMessage({ ...photo, size: 50 * MiB }, "menu"), null);

  // Rounding must never print the limit as the size of a file over it.
  const barelyOver = originalLimitMessage({ ...photo, size: 50 * MiB + 1 }, "menu");
  assert.ok(barelyOver);
  assert.match(barelyOver, /51\u00a0МБ/);

  const video = originalLimitMessage({ name: "trip.mp4", size: 120 * MiB, type: "video/mp4" }, "menu");
  assert.ok(video);
  assert.match(video, /со сжатием/);
  assert.match(video, /видео/);

  // Over the compressed limit too: compression is not offered as the way out.
  const huge = originalLimitMessage({ name: "trip.mp4", size: 300 * MiB, type: "video/mp4" }, "dialog");
  assert.ok(huge);
  assert.match(huge, /250\u00a0МБ/);
  assert.match(huge, /Сократите/);
  assert.doesNotMatch(huge, /Включите/);

  for (const message of [menu, dialog, barelyOver, video, huge]) {
    assert.doesNotMatch(message, /\d МБ/, `a number is split from its unit: ${message}`);
    assert.doesNotMatch(message, /«[^»]* [^»]*»/, `a quoted control name can break: ${message}`);
    assert.doesNotMatch(message, / —/, `a dash can start a line: ${message}`);
    assert.doesNotMatch(message, /до \d/, `«до» can be left at the end of a line: ${message}`);
  }

  assert.equal(originalLimitAlertTitle(1), "Файл больше 50\u00a0МБ");
  assert.equal(originalLimitAlertTitle(2), "Файлы больше 50\u00a0МБ");
});

test("the metadata says which way a photo or a video went", () => {
  const compressed = buildAttachmentMediaMetadata(
    {
      kind: "image",
      mimeType: "image/webp",
      size: 120_000,
      originalSize: 900_000,
      originalMimeType: "image/jpeg",
      optimized: true,
      width: 1920,
      height: 1440,
    },
    { path: "u1/c1-a1.webp" },
  );
  assert.deepEqual(compressed, {
    kind: "image",
    mime_type: "image/webp",
    size_bytes: 120_000,
    original_size_bytes: 900_000,
    original_mime_type: "image/jpeg",
    optimized: true,
    width: 1920,
    height: 1440,
    uncompressed: false,
  });

  const original = buildAttachmentMediaMetadata(
    {
      kind: "image",
      mimeType: "image/jpeg",
      size: 4_800_000,
      originalSize: 4_800_000,
      originalMimeType: "image/jpeg",
      optimized: false,
      width: 4032,
      height: 3024,
      uncompressed: true,
      previewFile: { size: 180_000 },
      previewWidth: 1280,
      previewHeight: 960,
    },
    { path: "u1/c1-a1.jpg", previewPath: "u1/c1-a1.preview.webp" },
  );
  assert.deepEqual(original, {
    kind: "image",
    mime_type: "image/jpeg",
    size_bytes: 4_800_000,
    original_size_bytes: 4_800_000,
    original_mime_type: "image/jpeg",
    optimized: false,
    width: 4032,
    height: 3024,
    uncompressed: true,
    preview: { path: "u1/c1-a1.preview.webp", width: 1280, height: 960, mime_type: "image/webp", size_bytes: 180_000 },
  });
  assert.equal(isUncompressedMedia(original), true);
  assert.equal(isUncompressedMedia(compressed), false);

  // A preview that did not reach storage is not promised to anyone.
  const withoutPreview = buildAttachmentMediaMetadata(
    { kind: "image", mimeType: "image/png", size: 10, uncompressed: true, previewFile: { size: 5 }, previewWidth: 1, previewHeight: 1 },
    { path: "u1/c1-a2.png", previewPath: null },
  );
  assert.equal(withoutPreview && "preview" in withoutPreview, false);
  assert.equal(withoutPreview?.uncompressed, true);

  // An original video plays the original, whatever the quality choice said.
  const originalVideo = buildAttachmentMediaMetadata(
    { kind: "video", mimeType: "video/mp4", size: 30_000_000, uncompressed: true, mediaQuality: "compact" },
    { path: "u1/c1-a3.mp4" },
  );
  assert.equal(originalVideo?.media_quality, "original");
  assert.equal(originalVideo?.uncompressed, true);

  const compressedVideo = buildAttachmentMediaMetadata(
    { kind: "video", mimeType: "video/mp4", size: 30_000_000, mediaQuality: "compact" },
    { path: "u1/c1-a4.mp4" },
  );
  assert.equal(compressedVideo?.media_quality, "compact");
  assert.equal(compressedVideo?.uncompressed, false);

  // The kinds this change does not touch keep their exact shape.
  assert.deepEqual(
    buildAttachmentMediaMetadata(
      { kind: "video_message", mimeType: "video/webm", size: 800, durationMs: 4200, mediaQuality: "balanced" },
      { path: "u1/c1-a5.webm" },
    ),
    { kind: "video_message", shape: "round", duration_ms: 4200, mime_type: "video/webm", size_bytes: 800, media_quality: "balanced" },
  );
  const document = buildAttachmentMediaMetadata(
    { kind: "file", mimeType: "application/pdf", size: 900, uncompressed: true },
    { path: "u1/c1-a6.pdf" },
  );
  assert.equal(document && "uncompressed" in document, false);

  assert.equal(isUncompressedMedia({ uncompressed: "true" }), false);
  assert.equal(isUncompressedMedia(null), false);
  assert.equal(isUncompressedMedia([]), false);
});

test("a preview sits beside its original and is read from nowhere else", () => {
  assert.equal(originalPreviewPath("u1/c1-a1.png"), "u1/c1-a1.preview.webp");
  assert.equal(originalPreviewPath("u1/c1-a1"), "u1/c1-a1.preview.webp");
  assert.equal(originalPreviewPath("u1.x/c1-a1.jpeg"), "u1.x/c1-a1.preview.webp");

  const message = {
    type: "image",
    media_bucket: "media",
    media_path: "u1/c1-a1.jpg",
    media_metadata: {
      uncompressed: true,
      preview: { path: "u1/c1-a1.preview.webp", width: 1280, height: 960 },
    },
  };
  assert.deepEqual(readOriginalPreview(message), { path: "u1/c1-a1.preview.webp", width: 1280, height: 960 });

  const variants: Array<[string, unknown]> = [
    ["a video", { ...message, type: "video" }],
    ["a compressed photo", { ...message, media_metadata: { ...message.media_metadata, uncompressed: false } }],
    ["a preview in someone else's folder", { ...message, media_metadata: { uncompressed: true, preview: { path: "u2/c1-a1.preview.webp", width: 1280, height: 960 } } }],
    ["a preview that climbs out", { ...message, media_metadata: { uncompressed: true, preview: { path: "u1/../u2/c1-a1.preview.webp", width: 1280, height: 960 } } }],
    ["a preview with no width", { ...message, media_metadata: { uncompressed: true, preview: { path: "u1/c1-a1.preview.webp", width: 0, height: 960 } } }],
    ["a preview whose width is text", { ...message, media_metadata: { uncompressed: true, preview: { path: "u1/c1-a1.preview.webp", width: "1280", height: 960 } } }],
    ["no stored original", { ...message, media_path: null }],
    ["no bucket", { ...message, media_bucket: null }],
    ["metadata that is a list", { ...message, media_metadata: [] }],
  ];
  for (const [what, candidate] of variants) {
    assert.equal(readOriginalPreview(candidate as typeof message), null, what);
  }

  assert.equal(ORIGINAL_PREVIEW_MAX_DIMENSION, 1280, "the same size as the server's image_preview");
  assert.deepEqual(originalPreviewDimensions(4032, 3024), { width: 1280, height: 960 });
  assert.deepEqual(originalPreviewDimensions(3024, 4032), { width: 960, height: 1280 });
  assert.deepEqual(originalPreviewDimensions(1000, 800), { width: 1000, height: 800 });
  assert.deepEqual(originalPreviewDimensions(5000, 3), { width: 1280, height: 1 });

  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/jpeg", width: 4032, height: 3024, size: 4_800_000 }), true);
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/png", width: 800, height: 600, size: 90_000 }), false, "small enough to be its own preview");
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/webp", width: 1200, height: 900, size: 900_000 }), true, "heavy for its size");
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/jpeg", width: null, height: null, size: 5_000_000 }), true);
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/gif", width: 4000, height: 3000, size: 9_000_000 }), false, "a still preview would stop the animation");
  assert.equal(shouldBuildOriginalPreview({ mimeType: "video/mp4", width: 1920, height: 1080, size: 9_000_000 }), false);
});

test("a phone stages a pick at once, and a desktop asks in the send dialog", () => {
  assert.equal(mediaSendShape((query) => ({ matches: query === "(pointer: coarse)" })), "phone");
  assert.equal(mediaSendShape(() => ({ matches: false })), "desktop");
  assert.equal(mediaSendShape(null), "desktop");
  assert.equal(mediaSendShape(undefined), "desktop");

  const photo = [{ type: "image/png" }];
  assert.equal(shouldConfirmMediaSend({ shape: "desktop", source: "picker", files: photo }), true);
  assert.equal(shouldConfirmMediaSend({ shape: "desktop", source: "paste", files: photo }), true);
  assert.equal(shouldConfirmMediaSend({ shape: "desktop", source: "drop", files: photo }), true);
  assert.equal(shouldConfirmMediaSend({ shape: "desktop", source: "camera", files: photo }), false, "a shot from the camera is already confirmed");
  assert.equal(shouldConfirmMediaSend({ shape: "phone", source: "picker", files: photo }), false);
  assert.equal(shouldConfirmMediaSend({ shape: "desktop", source: "picker", files: [{ type: "application/pdf" }] }), false);
  assert.equal(
    shouldConfirmMediaSend({ shape: "desktop", source: "picker", files: [{ type: "application/pdf" }, { type: "image/jpeg" }] }),
    true,
  );
});

test("the send dialog's title counts what it sends", () => {
  const png = { type: "image/png" };
  const mp4 = { type: "video/mp4" };
  const pdf = { type: "application/pdf" };
  assert.equal(mediaSendDialogTitle([png]), "Отправить фото");
  assert.equal(mediaSendDialogTitle([png, png]), "Отправить 2 фото");
  assert.equal(mediaSendDialogTitle([mp4]), "Отправить видео");
  assert.equal(mediaSendDialogTitle([mp4, mp4, mp4]), "Отправить 3 видео");
  assert.equal(mediaSendDialogTitle([png, mp4]), "Отправить 2 файла");
  assert.equal(mediaSendDialogTitle([png, mp4, pdf, png, png]), "Отправить 5 файлов");
  assert.equal(mediaSendDialogTitle([pdf]), "Отправить файл");
  assert.equal(mediaSendDialogTitle(Array.from({ length: 21 }, () => pdf)), "Отправить 21 файл");
});

test("choosing a video quality does not re-compress an original", () => {
  const original = { kind: "video", mediaQuality: "original" as const, uncompressed: true };
  const compressed = { kind: "video", mediaQuality: "balanced" as const };
  const [first, second] = applyVideoQualityToAttachments([original, compressed], "compact");
  assert.equal(first.mediaQuality, "original");
  assert.equal(second.mediaQuality, "compact");
});
