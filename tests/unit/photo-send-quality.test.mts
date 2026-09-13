// What a photo is sent at, and the two things this must never quietly change.
//
// D-174: the owner asked on 2026-09-13 for SD by default with HD available.
// D-119 had removed a five-stop selector that asked on every send and remembered
// the answer; these tests pin the difference rather than the similarity.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_MEDIA_QUALITY,
  DEFAULT_PHOTO_SEND_QUALITY,
  PHOTO_SEND_HD,
  PHOTO_SEND_SD,
  getImageUploadProfile,
  isHdPhotoQuality,
  photoSendQuality,
} from "../../artifacts/kub/src/lib/mediaQuality.ts";

const source = (path: string) => readFileSync(new URL(`../../artifacts/kub/src/${path}`, import.meta.url), "utf8");

test("a photo goes at SD unless the sheet says otherwise", () => {
  assert.equal(DEFAULT_PHOTO_SEND_QUALITY, PHOTO_SEND_SD);
  assert.equal(photoSendQuality(false), PHOTO_SEND_SD);
  assert.equal(photoSendQuality(true), PHOTO_SEND_HD);
  assert.equal(isHdPhotoQuality(PHOTO_SEND_HD), true);
  assert.equal(isHdPhotoQuality(PHOTO_SEND_SD), false);
});

test("SD and HD are two different encodes, and HD is the larger one", () => {
  const sd = getImageUploadProfile(PHOTO_SEND_SD);
  const hd = getImageUploadProfile(PHOTO_SEND_HD);
  assert.equal(sd.maxDimension, 1280);
  assert.equal(hd.maxDimension, 2560);
  assert.ok(hd.quality > sd.quality, "HD must not encode at a lower quality than SD");
  assert.ok(hd.maxDimension > sd.maxDimension);
});

/**
 * The constant the camera recorder reads.
 *
 * `DEFAULT_MEDIA_QUALITY` feeds `getVideoRecordingProfile`, so moving it to
 * answer a question about photographs would re-tune video recording as a side
 * effect. The photo default is its own constant precisely so that cannot happen,
 * and this test fails if someone later collapses the two.
 */
test("the photo default is not the recorder's default", () => {
  assert.equal(DEFAULT_MEDIA_QUALITY, "balanced", "the recorder's bitrates moved");
  assert.notEqual(
    DEFAULT_PHOTO_SEND_QUALITY,
    DEFAULT_MEDIA_QUALITY,
    "the photo default and the recorder default became one constant again, so a photo decision now re-tunes video recording",
  );
});

/**
 * The naming trap, written as a test because it has two meanings in this
 * repository and they are one word apart.
 *
 * `mediaQuality: "original"` is a re-encode at 2560px. `uncompressed: true` is
 * the picked bytes, untouched, which is the «Отправить без сжатия» path. HD is
 * the first. If HD ever becomes the second, a photo sent HD would stop being
 * stripped of its location data, because that stripping is what the re-encode
 * does for free.
 */
test("HD is a re-encode, not the untouched file", () => {
  assert.equal(PHOTO_SEND_HD, "original", "HD maps to the image profile named original");
  const compression = source("lib/mediaCompression.ts");
  assert.ok(
    compression.includes("uncompressed"),
    "the untouched path lost the flag that distinguishes it from an HD re-encode",
  );
  const profile = getImageUploadProfile(PHOTO_SEND_HD);
  assert.ok(profile.maxDimension < 4096, "HD must still be bounded, or it is not a re-encode at all");
});

/** The composer still asks nothing: D-119's actual objection, kept. */
test("the control lives on the sheet, and the composer is left alone", () => {
  const input = source("components/chat/MessageInput.tsx");
  for (const gone of ["MEDIA_QUALITY_OPTIONS", "MediaQualitySelector", "onMediaQualityChange"]) {
    assert.equal(input.includes(gone), false, `the composer asks again, through ${gone}`);
  }
  const chat = source("components/chat/ChatWindow.tsx");
  assert.equal(
    chat.includes("MEDIA_QUALITY_STORAGE_KEY"),
    false,
    "a chosen quality is remembered between sends again, which is what D-119 removed",
  );
});
