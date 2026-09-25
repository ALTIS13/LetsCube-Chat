// What a photo is sent at, and the two things this must never quietly change.
//
// D-174: SD was the 2026-09-13 default; on 2026-09-25 the owner asked for HD
// on new devices, while keeping a person's explicit SD preference.
// D-119 had removed a three-stop selector and a five-stop slider that asked on
// every send; these tests pin the difference rather than the similarity.
//
// 2026-09-21: the state is now remembered per device, which completes D-119
// rather than reopening it — a binary that forgets is a question put again on
// every send, and the client D-119 cites persists it. What is still refused is
// a question at send time, and «Файл» is still the separate uncompressed path.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_MEDIA_QUALITY,
  DEFAULT_PHOTO_SEND_QUALITY,
  PHOTO_RESOLUTION_HD,
  PHOTO_RESOLUTION_SD,
  PHOTO_RESOLUTION_STORAGE_KEY,
  PHOTO_SEND_HD,
  PHOTO_SEND_SD,
  getImageUploadProfile,
  isHdPhotoQuality,
  photoResolutionToStore,
  photoSendQuality,
  readStoredPhotoResolution,
} from "../../artifacts/kub/src/lib/mediaQuality.ts";

const source = (path: string) => readFileSync(new URL(`../../artifacts/kub/src/${path}`, import.meta.url), "utf8");

test("a new device sends photos in HD while an explicit SD choice remains available", () => {
  assert.equal(DEFAULT_PHOTO_SEND_QUALITY, PHOTO_SEND_HD);
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
  // What this refuses is the *old* mechanism: the multi-stop selector's own
  // stored value, read by the conversation. The sheet's SD/HD state is
  // remembered now (2026-09-21) under a key of its own, and that is the thing
  // D-119 argues for rather than against — a binary that forgets is a question
  // put again on every send. This line stayed, and its reason changed.
  assert.equal(
    chat.includes("MEDIA_QUALITY_STORAGE_KEY"),
    false,
    "the multi-stop selector's stored quality is back in the conversation, which is what D-119 removed",
  );
});

// ── the state is remembered, per device (2026-09-21) ─────────────────────────

test("a missing preference starts in HD, but an explicit SD choice remains SD", () => {
  assert.equal(readStoredPhotoResolution(PHOTO_RESOLUTION_HD), true);
  assert.equal(readStoredPhotoResolution(PHOTO_RESOLUTION_SD), false);
  assert.equal(readStoredPhotoResolution(null), true);
  assert.equal(readStoredPhotoResolution(undefined), true);
  // The shapes a store really comes back in. Each of these is a state a device
  // is actually in: never written, cleared, half-written, written by a version
  // that spelled it differently, or written by one that added a third value.
  for (const raw of ["", " ", "HD", "Hd", "hd ", "true", "1", "original", "compact", "ultra"]) {
    assert.equal(
      readStoredPhotoResolution(raw),
      false,
      `${JSON.stringify(raw)} was read as HD, so an unreadable store costs somebody the smaller upload`,
    );
  }
});

test("what is written is the state, not the encode profile", () => {
  assert.equal(photoResolutionToStore(true), PHOTO_RESOLUTION_HD);
  assert.equal(photoResolutionToStore(false), PHOTO_RESOLUTION_SD);
  // The round trip, which is the only thing the device ever does with these.
  assert.equal(readStoredPhotoResolution(photoResolutionToStore(true)), true);
  assert.equal(readStoredPhotoResolution(photoResolutionToStore(false)), false);
  // Deliberately not the MediaQuality words. `PHOTO_SEND_HD` is "original",
  // which in this file also names the untouched-bytes path; storing it would
  // let a later change to either meaning reinterpret a choice already made.
  assert.notEqual(PHOTO_RESOLUTION_HD, PHOTO_SEND_HD);
  assert.notEqual(PHOTO_RESOLUTION_SD, PHOTO_SEND_SD);
});

test("the key is versioned and namespaced, like every other preference here", () => {
  // A literal, not a shape test: two preferences sharing a key overwrite each
  // other, and the failure looks like a bug in whichever was read second.
  assert.equal(PHOTO_RESOLUTION_STORAGE_KEY, "kub:photo-resolution:v1");
});

test("the sheet reads and writes the key, and the decision stays out of the component", () => {
  const sheet = source("components/chat/attach/AttachSheet.tsx");
  // Read at mount and written on the press: either one alone is a state that
  // looks remembered in one direction only.
  assert.match(sheet, /useState\(\(\) => readStoredPhotoResolution\(readPhotoResolution\(\)\)\)/);
  assert.match(sheet, /writePhotoResolution\(next\)/);
  // Both browser calls are wrapped: access itself throws where site data is
  // blocked, and an attach sheet that cannot open is worse than one that forgets.
  const reader = sheet.slice(sheet.indexOf("function readPhotoResolution"), sheet.indexOf("function writePhotoResolution"));
  assert.match(reader, /try \{/);
  assert.match(reader, /catch/);
  // And the meaning of the stored string is decided in the pure module, which
  // `node --test` can reach — not inline where only a browser could check it.
  assert.equal(sheet.includes('=== "hd"'), false, "the sheet decides what the stored value means");
});

/** «Файл» is still the separate, explicitly named uncompressed path. */
test("remembering the resolution did not merge it with sending an original", () => {
  const sheet = source("components/chat/attach/AttachSheet.tsx");
  assert.match(sheet, /tab === "file" \? "original" : mode/);
  assert.equal(
    PHOTO_RESOLUTION_STORAGE_KEY.includes("compress"),
    false,
    "the remembered state is a resolution; compression is the other control",
  );
});
