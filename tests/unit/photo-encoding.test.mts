import assert from "node:assert/strict";
import test from "node:test";

import {
  JPEG_FALLBACK_QUALITY,
  JPEG_TYPE,
  KEEP_JPEG_MAX_BYTES_PER_PIXEL,
  PNG_TYPE,
  WEBP_TYPE,
  compressedPhotoEncoding,
  compressedPhotoSize,
  encodedFileIdentity,
  encoderWroteType,
  extensionForImageType,
  isCanvasPhotoCandidate,
  isHeifType,
  preferEncodedPhoto,
  shouldKeepPickedJpeg,
} from "../../artifacts/kub/src/lib/photoEncoding.ts";

/**
 * The iPhone photo path (D-114, D-116): the encoder the engine really has, the
 * name and type the bytes really are, HEIC where the engine can decode it, no
 * encode for nothing, and tall pictures that stay readable. The browser half is
 * `tests/e2e/media-send-path.spec.ts`.
 */

test("an engine writes WebP only when its probe answers with a WebP", () => {
  assert.equal(encoderWroteType("image/webp", WEBP_TYPE), true);
  assert.equal(encoderWroteType(" IMAGE/WEBP ", WEBP_TYPE), true);
  // What an engine answers for a type it cannot write, as the standard says it
  // must, and what WebKit on Apple platforms answers for WebP: a PNG.
  assert.equal(encoderWroteType("image/png", WEBP_TYPE), false);
  assert.equal(encoderWroteType("", WEBP_TYPE), false, "an empty type proves nothing");
  assert.equal(encoderWroteType(null, WEBP_TYPE), false);
  assert.equal(encoderWroteType(undefined, WEBP_TYPE), false);
});

test("without a WebP encoder a photo is written as JPEG at 0.85, with one as WebP at the profile's quality", () => {
  assert.deepEqual(compressedPhotoEncoding({ webpEncodes: true, webpQuality: 0.84 }), { type: WEBP_TYPE, quality: 0.84 });
  assert.deepEqual(compressedPhotoEncoding({ webpEncodes: false, webpQuality: 0.84 }), { type: JPEG_TYPE, quality: 0.85 });
  assert.equal(JPEG_FALLBACK_QUALITY, 0.85);
});

test("a file is named and typed from the bytes the engine wrote, never from what it was asked for", () => {
  assert.deepEqual(encodedFileIdentity("IMG_0042.HEIC", "image", "image/jpeg"), { name: "IMG_0042-image.jpg", type: "image/jpeg" });
  assert.deepEqual(encodedFileIdentity("facade.png", "image", "image/webp"), { name: "facade-image.webp", type: "image/webp" });
  // Asked for WebP and handed a PNG: the file says PNG, in its name and its type.
  assert.deepEqual(
    encodedFileIdentity("Screenshot 2026-09-11.png", "image", "image/png"),
    { name: "Screenshot 2026-09-11-image.png", type: "image/png" },
  );
  assert.deepEqual(encodedFileIdentity("portrait.jpeg", "avatar", "IMAGE/JPEG"), { name: "portrait-avatar.jpg", type: "image/jpeg" });
  assert.deepEqual(encodedFileIdentity("archive.tar.gz", "preview", "image/webp"), { name: "archive.tar-preview.webp", type: "image/webp" });
  assert.deepEqual(encodedFileIdentity("", "image", "image/jpeg"), { name: "image-image.jpg", type: "image/jpeg" });

  // A type it cannot name keeps the picked file rather than guessing a label.
  for (const unnamed of ["", null, undefined, "image/gif", "application/octet-stream"]) {
    assert.equal(encodedFileIdentity("a.png", "image", unnamed), null, `no name for ${String(unnamed)}`);
  }
  assert.equal(extensionForImageType(JPEG_TYPE), "jpg");
  assert.equal(extensionForImageType(PNG_TYPE), "png");
  assert.equal(extensionForImageType(WEBP_TYPE), "webp");
});

test("a photo's long side is capped at the profile's size, and a photo is never enlarged", () => {
  const size = (width: number, height: number) => {
    const result = compressedPhotoSize(width, height, 1920);
    return [result.width, result.height, result.resized];
  };

  assert.deepEqual(size(4032, 3024), [1920, 1440, true]);
  assert.deepEqual(size(3024, 4032), [1440, 1920, true]);
  assert.deepEqual(size(2000, 2000), [1920, 1920, true]);
  assert.deepEqual(size(1290, 2796), [886, 1920, true]);
  assert.deepEqual(size(1280, 960), [1280, 960, false]);
  assert.deepEqual(size(0, 100), [1, 100, false], "a size that makes no sense is not resized");
  assert.deepEqual(size(Number.NaN, 100), [1, 100, false]);
});

test("a small JPEG that needs no resize is not written again as JPEG", () => {
  const photo = { type: "image/jpeg", width: 1280, height: 960, resized: false };
  const budget = Math.floor(1280 * 960 * KEEP_JPEG_MAX_BYTES_PER_PIXEL);

  // The report's 274 KB photo, on an engine that writes only JPEG: sent as picked.
  assert.equal(shouldKeepPickedJpeg({ ...photo, size: 274_000, outputType: JPEG_TYPE }), true);
  assert.equal(shouldKeepPickedJpeg({ ...photo, size: budget, outputType: JPEG_TYPE }), true);
  assert.equal(
    shouldKeepPickedJpeg({ ...photo, size: budget + 1, outputType: JPEG_TYPE }),
    false,
    "denser than the encoder writes: an encode earns bytes",
  );

  // Where the engine writes WebP the encode still earns its keep.
  assert.equal(shouldKeepPickedJpeg({ ...photo, size: 274_000, outputType: WEBP_TYPE }), false);
  // A photo that needs resizing always goes through the canvas.
  assert.equal(shouldKeepPickedJpeg({ ...photo, size: 274_000, resized: true, outputType: JPEG_TYPE }), false);
  // Only a JPEG: a screenshot or a HEIC is always encoded.
  assert.equal(shouldKeepPickedJpeg({ ...photo, type: PNG_TYPE, size: 1000, outputType: JPEG_TYPE }), false);
  assert.equal(shouldKeepPickedJpeg({ ...photo, type: "image/heic", size: 1000, outputType: JPEG_TYPE }), false);
  assert.equal(shouldKeepPickedJpeg({ ...photo, size: 0, outputType: JPEG_TYPE }), false);
  assert.equal(shouldKeepPickedJpeg({ ...photo, width: 0, size: 10, outputType: JPEG_TYPE }), false);
});

test("a HEIC is tried on the canvas, and once decoded it never stays a HEIC", () => {
  assert.equal(isHeifType("image/heic"), true);
  assert.equal(isHeifType("IMAGE/HEIF"), true);
  assert.equal(isHeifType("image/jpeg"), false);

  for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) {
    assert.equal(isCanvasPhotoCandidate(type), true, type);
  }
  // A GIF would stop moving; the rest are not photos.
  for (const type of ["image/gif", "image/svg+xml", "video/quicktime", "", null]) {
    assert.equal(isCanvasPhotoCandidate(type), false, String(type));
  }

  assert.equal(
    preferEncodedPhoto({ sourceType: "image/heic", sourceSize: 300_000, encodedSize: 420_000 }),
    true,
    "a larger JPEG beats a HEIC that has no previews and that Chromium cannot draw",
  );
  assert.equal(preferEncodedPhoto({ sourceType: "image/png", sourceSize: 300_000, encodedSize: 420_000 }), false);
  assert.equal(preferEncodedPhoto({ sourceType: "image/png", sourceSize: 300_000, encodedSize: 300_000 }), false, "no smaller is no better");
  assert.equal(preferEncodedPhoto({ sourceType: "image/png", sourceSize: 300_000, encodedSize: 120_000 }), true);
  assert.equal(preferEncodedPhoto({ sourceType: "image/heic", sourceSize: 300_000, encodedSize: 0 }), false, "an empty encode is never taken");
});
