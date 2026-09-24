// Whether the stored file is the original or a copy of it (D-097).
//
// The shapes below are the ones `buildAttachmentMediaMetadata` in
// `lib/mediaCompression.ts` actually writes, not invented ones — a photo sent
// the ordinary way, a photo sent with «Отправить без сжатия», a video the
// attach sheet re-encoded, a round message, and the rows that predate any of
// it. The third state is the one worth the module: a message that does not say
// must not be made to say.

import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaFileActionName,
  mediaOriginality,
  originalityNote,
  type MediaOriginality,
} from "../../artifacts/kub/src/lib/mediaOriginality.ts";
import { mediaFileAction } from "../../artifacts/kub/src/lib/mediaFileAction.ts";

/** A photo the client compressed: what `stageFiles` uploads by default. */
const COMPRESSED_PHOTO = {
  kind: "image",
  mime_type: "image/webp",
  size_bytes: 384_102,
  original_size_bytes: 4_210_688,
  original_mime_type: "image/jpeg",
  optimized: true,
  width: 1920,
  height: 1440,
  photo_quality: "sd",
  uncompressed: false,
};

/** «Отправить без сжатия»: the stored file is the picked one. */
const ORIGINAL_PHOTO = {
  kind: "image",
  mime_type: "image/jpeg",
  size_bytes: 4_210_688,
  original_size_bytes: 4_210_688,
  original_mime_type: "image/jpeg",
  optimized: false,
  width: 4032,
  height: 3024,
  uncompressed: true,
  preview: { path: "chat/a.preview.webp", width: 1280, height: 960, mime_type: "image/webp", size_bytes: 52_118 },
};

/** A round video message, whose metadata says nothing about compression at all. */
const ROUND_VIDEO = {
  kind: "video_message",
  shape: "round",
  duration_ms: 4_200,
  mime_type: "video/webm",
  size_bytes: 840_000,
};

test("the sender's own answer is believed first", () => {
  assert.equal(mediaOriginality(ORIGINAL_PHOTO), "original");
  // Even where a size was carried over from a sheet that had already shrunk a
  // video: `uncompressed` is the choice that was made, and it wins.
  assert.equal(
    mediaOriginality({ ...ORIGINAL_PHOTO, optimized: true, original_size_bytes: 9_000_000 }),
    "original",
  );
});

test("a copy is only called one where the metadata proves a re-encode", () => {
  assert.equal(mediaOriginality(COMPRESSED_PHOTO), "compressed");
  // Each proof on its own, so no single field carries the whole answer.
  assert.equal(mediaOriginality({ kind: "image", optimized: true }), "compressed");
  assert.equal(
    mediaOriginality({ kind: "video", size_bytes: 1_000, original_size_bytes: 9_000, optimized: false }),
    "compressed",
  );
  assert.equal(
    mediaOriginality({ kind: "image", mime_type: "image/webp", original_mime_type: "image/jpeg", optimized: false }),
    "compressed",
  );
  // A type carrying parameters is still the same type.
  assert.equal(
    mediaOriginality({ kind: "image", mime_type: "image/jpeg; charset=binary", original_mime_type: "IMAGE/JPEG", optimized: false }),
    "unknown",
  );
});

test("what the metadata does not say stays unsaid", () => {
  for (const nothing of [null, undefined, {}, [], "image/webp", 7, { kind: "image" }]) {
    assert.equal(mediaOriginality(nothing), "unknown", `${JSON.stringify(nothing)} says nothing`);
  }
  // The round message: no flag, no picked size, no second type.
  assert.equal(mediaOriginality(ROUND_VIDEO), "unknown");
  // A photograph the canvas could not make smaller is uploaded as picked, so
  // calling it a copy would be the same kind of lie in the other direction.
  assert.equal(
    mediaOriginality({ kind: "image", mime_type: "image/jpeg", original_mime_type: "image/jpeg", size_bytes: 91_000, original_size_bytes: 91_000, optimized: false, uncompressed: false }),
    "unknown",
  );
  // A stored file *larger* than the picked one is not a compression either.
  assert.equal(
    mediaOriginality({ kind: "image", size_bytes: 9_000, original_size_bytes: 1_000, optimized: false }),
    "unknown",
  );
});

test("the badge is a word and the sentence is what it means", () => {
  assert.equal(originalityNote("unknown"), null);

  const original = originalityNote("original");
  assert.equal(original?.badge, "Оригинал");
  // Already short enough for the narrowest header, so one spelling.
  assert.equal(original?.compactBadge, "Оригинал");
  assert.ok(original && original.sentence.length > original.badge.length);

  const copy = originalityNote("compressed");
  assert.equal(copy?.badge, "Сжатая копия");
  // Measured: at 360 a video left the picture's own name 51px beside the full
  // phrase. This is the word that fits, and it is the opposite of «Оригинал»
  // rather than a different fact.
  assert.equal(copy?.compactBadge, "Копия");
  assert.ok(copy!.compactBadge.length < copy!.badge.length);
  // The consequence, which is the whole of D-097: there is no better file to
  // ask the server for. The same sentence on both spellings.
  assert.ok(copy && copy.sentence.includes("Оригинал остался у отправителя"));
});

test("the control's name says what the press will hand over, per shell", () => {
  const save = mediaFileAction("windows_native");
  const open = mediaFileAction("android_native");
  const share = mediaFileAction("ios_pwa", "image");

  assert.equal(mediaFileActionName(save, "original"), "Сохранить оригинал");
  assert.equal(mediaFileActionName(save, "compressed"), "Сохранить сжатую копию");
  assert.equal(mediaFileActionName(open, "original"), "Открыть оригинал в браузере");
  assert.equal(mediaFileActionName(open, "compressed"), "Открыть сжатую копию в браузере");
  assert.equal(mediaFileActionName(share, "original"), "Поделиться оригиналом или сохранить его");
  assert.equal(mediaFileActionName(share, "compressed"), "Поделиться сжатой копией или сохранить её");

  // D-147's own wording is what an unknown message keeps, in both shells: this
  // module adds to that answer and never replaces it.
  assert.equal(mediaFileActionName(save, "unknown"), save.accessibleName);
  assert.equal(mediaFileActionName(open, "unknown"), open.accessibleName);
  assert.equal(mediaFileActionName(save, "unknown"), "Сохранить");
  assert.equal(mediaFileActionName(open, "unknown"), "Открыть в браузере");

  // And wherever it does speak, it still says where the press goes.
  for (const state of ["original", "compressed"] as MediaOriginality[]) {
    assert.ok(mediaFileActionName(open, state).includes("в браузере"), `${state} must keep D-147's warning`);
  }
});
