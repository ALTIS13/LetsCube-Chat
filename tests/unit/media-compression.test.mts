import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORIGINAL_ATTACHMENT_BYTES,
  ORIGINAL_PREVIEW_MAX_DIMENSION,
  ORIGINAL_PREVIEW_MAX_LONG_SIDE,
  ORIGINAL_PREVIEW_MIN_SHORT_SIDE,
  buildAttachmentMediaMetadata,
  exceedsOriginalLimit,
  isCompressibleMediaType,
  isUncompressedMedia,
  mediaSendTitle,
  mediaSendShape,
  originalLimitAlertTitle,
  originalLimitMessage,
  originalPreviewDimensions,
  originalPreviewPath,
  planAttachmentPreparation,
  readOriginalPreview,
  shouldBuildOriginalPreview,
  splitByOriginalLimit,
} from "../../artifacts/kub/src/lib/mediaCompression.ts";
import { MEDIA_BUBBLE_MAX_HEIGHT_PX } from "../../artifacts/kub/src/lib/mediaBubbleLayout.ts";
import { applyVideoQualityToAttachments } from "../../artifacts/kub/src/lib/mediaQuality.ts";

/**
 * Testers' complaint 2: photos and videos could only be sent compressed.
 *
 * Approved by the owner: compressed stays the default, and a person can send
 * the original, as in Telegram — the attach sheet's «Файл» tab, and
 * «Отправить без сжатия» under its «…»; no quality is ever asked for
 * (D-119, D-122). The original goes as
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
  // An iPhone's camera photo: tried on the canvas, and sent as picked by an
  // engine that cannot decode it (`tests/unit/photo-encoding.test.mts`).
  assert.equal(planAttachmentPreparation("image/heic", true), "compress");
  assert.equal(planAttachmentPreparation("image/heif", true), "compress");
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

test("an original over the limit says what is wrong and where the compressed way is", () => {
  const photo = { name: "IMG_2041.JPG", size: 63 * MiB, type: "image/jpeg" };

  // Every space between a number and its unit, and inside a quoted control name,
  // is non-breaking: rendered, «до 50 | МБ» and «Фото или | видео» had split
  // across lines in the dialog and in the phone's alert.
  // The attach sheet is the only place an original is asked for (D-122), so a
  // refusal names the compressed way that is on the screen: «Галерея».
  const sheet = originalLimitMessage(photo);
  assert.ok(sheet, "a 63 MB original is refused");
  assert.match(sheet, /IMG_2041\.JPG/);
  assert.match(sheet, /63\u00a0МБ/);
  assert.match(sheet, /до\u00a050\u00a0МБ/);
  // The sheet's refusal opens with its offer, where the menu's finished on it.
  assert.match(sheet, /[Сс]о сжатием/);
  assert.ok(sheet.includes("«Галереи»"), "the refusal does not say where the compressed way is");
  assert.doesNotMatch(sheet, /Сжать/, "a menu has no box to tick, on a desktop either");

  assert.equal(originalLimitMessage({ ...photo, size: 50 * MiB }), null);

  // Rounding must never print the limit as the size of a file over it.
  const barelyOver = originalLimitMessage({ ...photo, size: 50 * MiB + 1 });
  assert.ok(barelyOver);
  assert.match(barelyOver, /51\u00a0МБ/);

  const video = originalLimitMessage({ name: "trip.mp4", size: 120 * MiB, type: "video/mp4" });
  assert.ok(video);
  assert.match(video, /[Сс]о сжатием/);
  assert.match(video, /видео/);

  // Over the compressed limit too: compression is not offered as the way out.
  const huge = originalLimitMessage({ name: "trip.mp4", size: 300 * MiB, type: "video/mp4" });
  assert.ok(huge);
  assert.match(huge, /250\u00a0МБ/);
  assert.match(huge, /Сократите/);
  assert.doesNotMatch(huge, /Включите/);

  for (const message of [sheet, barelyOver, video, huge]) {
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

  // From an engine that cannot write WebP the preview is a JPEG, and says so.
  const jpegPreview = buildAttachmentMediaMetadata(
    {
      kind: "image",
      mimeType: "image/png",
      size: 2_400_000,
      uncompressed: true,
      width: 1290,
      height: 2796,
      previewFile: { size: 210_000, type: "image/jpeg" },
      previewWidth: 591,
      previewHeight: 1280,
    },
    { path: "u1/c1-a7.png", previewPath: "u1/c1-a7.preview.jpg" },
  );
  assert.deepEqual(jpegPreview?.preview, {
    path: "u1/c1-a7.preview.jpg",
    width: 591,
    height: 1280,
    mime_type: "image/jpeg",
    size_bytes: 210_000,
  });

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
  // The extension is the preview's real type: a JPEG is never stored under `.webp`.
  assert.equal(originalPreviewPath("u1/c1-a1.png", "image/webp"), "u1/c1-a1.preview.webp");
  assert.equal(originalPreviewPath("u1/c1-a1.png", "image/jpeg"), "u1/c1-a1.preview.jpg");

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
  assert.deepEqual(
    readOriginalPreview({ ...message, media_metadata: { uncompressed: true, preview: { path: "u1/c1-a1.preview.jpg", width: 1280, height: 960 } } }),
    { path: "u1/c1-a1.preview.jpg", width: 1280, height: 960 },
    "a JPEG preview, from an engine that cannot write WebP, is read at its own derived address",
  );

  const variants: Array<[string, unknown]> = [
    ["a video", { ...message, type: "video" }],
    ["a compressed photo", { ...message, media_metadata: { ...message.media_metadata, uncompressed: false } }],
    ["a preview in someone else's folder", { ...message, media_metadata: { uncompressed: true, preview: { path: "u2/c1-a1.preview.webp", width: 1280, height: 960 } } }],
    ["a preview that climbs out", { ...message, media_metadata: { uncompressed: true, preview: { path: "u1/../u2/c1-a1.preview.webp", width: 1280, height: 960 } } }],
    ["a preview with no width", { ...message, media_metadata: { uncompressed: true, preview: { path: "u1/c1-a1.preview.webp", width: 0, height: 960 } } }],
    ["a preview whose width is text", { ...message, media_metadata: { uncompressed: true, preview: { path: "u1/c1-a1.preview.webp", width: "1280", height: 960 } } }],
    ["a preview at an address no preview is written to", { ...message, media_metadata: { uncompressed: true, preview: { path: "u1/c1-a1.preview.png", width: 1280, height: 960 } } }],
    ["a JPEG preview in someone else's folder", { ...message, media_metadata: { uncompressed: true, preview: { path: "u2/c1-a1.preview.jpg", width: 1280, height: 960 } } }],
    ["no stored original", { ...message, media_path: null }],
    ["no bucket", { ...message, media_bucket: null }],
    ["metadata that is a list", { ...message, media_metadata: [] }],
  ];
  for (const [what, candidate] of variants) {
    assert.equal(readOriginalPreview(candidate as typeof message), null, what);
  }

  assert.equal(ORIGINAL_PREVIEW_MAX_DIMENSION, 1280, "the same size as the server's image_preview");
  // The floor is the bubble's box in device pixels (D-116), measured on the
  // phone the tester holds: 430 CSS px of screen gives a 310 px bubble, and a
  // phone has three device pixels to the point. It is asserted against the
  // bubble's own constant so that neither can be tuned alone and leave the
  // preview smaller than the box it is drawn in — which is exactly what the
  // equality below caught when the cap went from 480 to 550.
  assert.equal(ORIGINAL_PREVIEW_MIN_SHORT_SIDE, 310 * 3);
  // The box is at most this tall in device pixels, and a picture held at the
  // 0.5 clamp is twice its width long, so the floor has to carry that far.
  assert.ok(
    MEDIA_BUBBLE_MAX_HEIGHT_PX * 3 <= ORIGINAL_PREVIEW_MIN_SHORT_SIDE * 2,
    "the bubble is taller than the preview the floor guarantees",
  );
  assert.equal(ORIGINAL_PREVIEW_MAX_LONG_SIDE, 2560);

  // Every landscape picture is sized by the long-side cap alone: it fills the
  // bubble with that side, which 1280 already carries well past the floor.
  assert.deepEqual(originalPreviewDimensions(4032, 3024), { width: 1280, height: 960 }, "an ordinary photograph is unchanged");
  assert.deepEqual(originalPreviewDimensions(1000, 800), { width: 1000, height: 800 });
  assert.deepEqual(originalPreviewDimensions(1920, 1080), { width: 1280, height: 720 }, "16:9 is the cap's, not the floor's");
  assert.deepEqual(originalPreviewDimensions(2000, 1000), { width: 1280, height: 640 });
  // A portrait photograph is inside the floor already at 4:3.
  assert.deepEqual(originalPreviewDimensions(3024, 4032), { width: 960, height: 1280 });
  // A 1290x2796 screenshot, and the 1080x2341 it is stored as once compressed.
  // Both were 591x1280 before D-116 and 720x1561 while the cap was 480.
  assert.deepEqual(originalPreviewDimensions(1290, 2796), { width: 930, height: 2016 });
  assert.deepEqual(originalPreviewDimensions(1080, 2341), { width: 930, height: 2016 });
  assert.deepEqual(originalPreviewDimensions(1080, 20000), { width: 138, height: 2560 }, "the long side still stops");
  // A 3px side is the long-side cap's business, not the floor's: this is a
  // landscape strip, so it is simply capped rather than blown up to the ceiling.
  assert.deepEqual(originalPreviewDimensions(5000, 3), { width: 1280, height: 1 });

  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/jpeg", width: 4032, height: 3024, size: 4_800_000 }), true);
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/png", width: 800, height: 600, size: 90_000 }), false, "small enough to be its own preview");
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/webp", width: 1200, height: 900, size: 900_000 }), true, "heavy for its size");
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/jpeg", width: null, height: null, size: 5_000_000 }), true);
  assert.equal(shouldBuildOriginalPreview({ mimeType: "image/gif", width: 4000, height: 3000, size: 9_000_000 }), false, "a still preview would stop the animation");
  assert.equal(shouldBuildOriginalPreview({ mimeType: "video/mp4", width: 1920, height: 1080, size: 9_000_000 }), false);
});

test("a phone and a desktop are told apart by the pointer, not the width", () => {
  // Both now do the same thing with a pick — the attach sheet is the send step
  // everywhere (D-122) — but the sheet itself is drawn as a sheet or as a panel.
  assert.equal(mediaSendShape((query) => ({ matches: query === "(pointer: coarse)" })), "phone");
  assert.equal(mediaSendShape(() => ({ matches: false })), "desktop");
  assert.equal(mediaSendShape(null), "desktop");
  assert.equal(mediaSendShape(undefined), "desktop");
});

test("the send button's title counts what it sends", () => {
  const png = { type: "image/png" };
  const mp4 = { type: "video/mp4" };
  const pdf = { type: "application/pdf" };
  assert.equal(mediaSendTitle([png]), "Отправить фото");
  assert.equal(mediaSendTitle([png, png]), "Отправить 2 фото");
  assert.equal(mediaSendTitle([mp4]), "Отправить видео");
  assert.equal(mediaSendTitle([mp4, mp4, mp4]), "Отправить 3 видео");
  assert.equal(mediaSendTitle([png, mp4]), "Отправить 2 файла");
  assert.equal(mediaSendTitle([png, mp4, pdf, png, png]), "Отправить 5 файлов");
  assert.equal(mediaSendTitle([pdf]), "Отправить файл");
  assert.equal(mediaSendTitle(Array.from({ length: 21 }, () => pdf)), "Отправить 21 файл");
});

test("choosing a video quality does not re-compress an original", () => {
  const original = { kind: "video", mediaQuality: "original" as const, uncompressed: true };
  const compressed = { kind: "video", mediaQuality: "balanced" as const };
  const [first, second] = applyVideoQualityToAttachments([original, compressed], "compact");
  assert.equal(first.mediaQuality, "original");
  assert.equal(second.mediaQuality, "compact");
});
