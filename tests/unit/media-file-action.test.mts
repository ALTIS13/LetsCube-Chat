// What the media viewer's file control does in each shell.
//
// D-147. «Открыть оригинал» called `window.open(url, "_blank")` everywhere, and
// three of the four shells this product runs in answer that by starting the
// system browser on top of the app. The rule is data so that «what happens in
// the Windows app» can be argued about — and changed — without a Windows app,
// and so that a shell added later has to be decided rather than inheriting
// whatever the last branch happened to be.

import assert from "node:assert/strict";
import test from "node:test";

import { mediaFileAction, mediaFileName } from "../../artifacts/kub/src/lib/mediaFileAction.ts";
import type { DistributionTarget } from "../../artifacts/kub/src/lib/platform/distribution.ts";

/** Every shell the product detects. Listed so that a new one fails here first. */
const EVERY_TARGET: DistributionTarget[] = [
  "ios_pwa",
  "android_download",
  "android_native",
  "windows_download",
  "windows_native",
  "web_only",
];

test("only the Android app hands the file to the browser; every other shell keeps it", () => {
  assert.equal(mediaFileAction("android_native").kind, "open");
  for (const target of EVERY_TARGET.filter((one) => one !== "android_native")) {
    assert.equal(mediaFileAction(target, "image").kind, target === "ios_pwa" ? "share" : "save", `${target} should keep the file in the shell`);
  }
});

test("the iPhone PWA offers the native share sheet, with a save fallback", () => {
  const action = mediaFileAction("ios_pwa", "image");
  assert.equal(action.kind, "share");
  assert.equal(action.label, "Поделиться");
  assert.equal(action.accessibleName, "Поделиться фото или сохранить его");
  assert.equal(action.leavesApp, false);
  assert.equal(mediaFileAction("ios_pwa", "video").kind, "save");
});

test("a control that leaves the app says so, and wears the icon for it", () => {
  const leaving = mediaFileAction("android_native");
  assert.equal(leaving.leavesApp, true);
  assert.equal(leaving.label, "В браузере");
  assert.equal(leaving.accessibleName, "Открыть в браузере");
  assert.equal(leaving.icon, "externalLink");

  // The reverse, which is the half D-147 was really about: a control that keeps
  // the file must not wear the glyph for leaving.
  const staying = mediaFileAction("windows_native");
  assert.equal(staying.leavesApp, false);
  assert.equal(staying.label, "Сохранить");
  assert.equal(staying.accessibleName, "Сохранить");
  assert.equal(staying.icon, "download");
});

test("the icon and the promise agree in every shell", () => {
  for (const target of EVERY_TARGET) {
    const action = mediaFileAction(target);
    assert.equal(action.leavesApp, action.kind === "open", `${target} promises one thing and does another`);
    assert.equal(
      action.icon,
      action.kind === "open" ? "externalLink" : action.kind === "share" ? "share" : "download",
      `${target} wears the wrong glyph`,
    );
    assert.ok(action.label.length > 0, `${target} has no word on it`);
    // WCAG 2.5.3: what is announced has to contain what is written, or a person
    // speaking to the page names a control the page does not answer to.
    assert.ok(
      action.accessibleName.toLowerCase().includes(action.label.toLowerCase()),
      `${target} is announced as something other than what it says`,
    );
  }
});

test("a stored file keeps its own name, whatever is hung off the address", () => {
  const stored = "https://core.letscube.ru/storage/v1/object/public/chat-media/a1/b2c3.jpg";
  assert.equal(mediaFileName(stored, "image"), "b2c3.jpg");
  assert.equal(mediaFileName(`${stored}?token=abc&download=1`, "image"), "b2c3.jpg");
  assert.equal(mediaFileName(`${stored}#top`, "image"), "b2c3.jpg");
  assert.equal(mediaFileName("https://example.invalid/a/%D1%84%D0%BE%D1%82%D0%BE.jpg", "image"), "letscube-photo.jpg");
  assert.equal(mediaFileName("https://example.invalid/a/holiday%20(2).png", "image"), "holiday (2).png");
});

test("anything that is not plainly a file name is composed here instead", () => {
  // A name goes to a real file system, so a segment carrying a path separator,
  // a quote or no extension at all is refused rather than repaired.
  for (const hostile of [
    "https://example.invalid/storage/object",
    "https://example.invalid/a/..%2F..%2Fetc%2Fpasswd",
    'https://example.invalid/a/%22quoted%22.jpg',
    "https://example.invalid/a/.hidden",
    "https://example.invalid/a/name.toolongextension",
    "",
  ]) {
    assert.equal(mediaFileName(hostile, "image"), "letscube-photo.jpg", hostile);
    assert.equal(mediaFileName(hostile, "video"), "letscube-video.mp4", hostile);
  }
});
