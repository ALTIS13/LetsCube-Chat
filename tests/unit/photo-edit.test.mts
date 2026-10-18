import assert from "node:assert/strict";
import test from "node:test";
import { exportPhotoEdit, renderPhotoEditPreview, type PhotoEditIntent } from "../../artifacts/kub/src/lib/photoEdit.ts";

const file = () => new File(["fictional bytes"], "fictional.png", { type: "image/png" });
const intent: PhotoEditIntent = { rotation: 0, crop: null, marks: [] };

test("malformed edit intent is rejected before any browser decoder or canvas is needed", async () => {
  for (const [invalid, code] of [
    [{ ...intent, rotation: 360 }, "INVALID_INTENT"],
    [{ ...intent, crop: { x: 0, y: 0, width: -1, height: 1 } }, "INVALID_CROP"],
    [{ ...intent, crop: { x: 0, y: 0, width: 1, height: NaN } }, "INVALID_CROP"],
    [{ ...intent, marks: [{ kind: "cover", x: 0, y: 0, width: 0, height: 1 }] }, "INVALID_MARK"],
    [{ ...intent, marks: [{ kind: "pen", points: [{ x: 1.01, y: 0 }], color: "red", width: .1 }] }, "INVALID_MARK"],
    [{ ...intent, marks: [{ kind: "other" }] }, "INVALID_MARK"],
  ] as const) {
    await assert.rejects(renderPhotoEditPreview(file(), invalid as unknown as PhotoEditIntent), { message: `PHOTO_EDIT_${code}` });
  }
});

test("empty, animated and oversized file metadata is refused before decode, without allocating oversized bytes", async () => {
  const oversized = file();
  // This unit control deliberately changes only File metadata; native bytes and
  // decoding/encoding success are independently proved by the browser suite.
  Object.defineProperty(oversized, "size", { value: 52_428_801 });
  for (const input of [new File([], "empty.png", { type: "image/png" }),
    new File(["GIF89a"], "animated.gif", { type: "image/gif" }), oversized]) {
    await assert.rejects(renderPhotoEditPreview(input, intent), { message: "PHOTO_EDIT_UNSUPPORTED_FILE" });
  }
});

test("pre-abort is AbortError and an unavailable decoder never becomes an original-file success", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderPhotoEditPreview(file(), intent, controller.signal), { name: "AbortError" });
  await assert.rejects(renderPhotoEditPreview(file(), intent), { message: "PHOTO_EDIT_UNAVAILABLE" });
  await assert.rejects(exportPhotoEdit(file(), intent, { quality: "invented" as never }), { message: "PHOTO_EDIT_INVALID_QUALITY" });
});
