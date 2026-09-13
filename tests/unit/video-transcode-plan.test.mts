// What should happen to a picked video, given the rung and the browser.
//
// D-175. Every path that ends in "send it as it was picked" is named, because
// that outcome is indistinguishable from a failure to a person: the video just
// arrives large. These tests pin which reason applies where, so a silent
// decline can never be mistaken for a transcode that went wrong.

import assert from "node:assert/strict";
import test from "node:test";

import { planVideoSend, transcodedName } from "../../artifacts/kub/src/lib/videoTranscode.ts";
import type { SourceVideo } from "../../artifacts/kub/src/lib/videoSendLadder.ts";

const clip = (over: Partial<SourceVideo> = {}): SourceVideo => ({
  width: 1920,
  height: 1080,
  duration: 60,
  sizeBytes: 80 * 1024 * 1024,
  fps: 30,
  bitrate: 9_000_000,
  audioChannels: 2,
  ...over,
});

const CAN = { available: true, codec: "avc" as const };
const CANNOT = { available: false, codec: null };

test("choosing the source sends what was picked, and says that is why", () => {
  const plan = planVideoSend(clip(), "source", CAN);
  assert.equal(plan.action, "as-is");
  assert.equal(plan.reason, "chose-source");
  assert.equal(plan.target, null);
});

test("a browser without an encoder sends what was picked, and says that is why", () => {
  // Firefox on Android has no VideoEncoder in any version. This is the ordinary
  // path there, not an error, and the reason distinguishes it from a refusal.
  const plan = planVideoSend(clip(), 720, CANNOT);
  assert.equal(plan.action, "as-is");
  assert.equal(plan.reason, "no-encoder");
});

test("a rung the encoder cannot take is declined by name", () => {
  const plan = planVideoSend(clip({ width: 3840, height: 2160 }), 2160, CAN, false);
  assert.equal(plan.action, "as-is");
  assert.equal(plan.reason, "rung-not-encodable");
});

test("a chosen rung below the source is transcoded, at the frame and bitrate the ladder computed", () => {
  const plan = planVideoSend(clip(), 720, CAN);
  assert.equal(plan.action, "transcode");
  assert.equal(plan.reason, "transcoding");
  assert.ok(plan.target);
  assert.equal(plan.target.height, 720, "the short side is the rung");
  assert.equal(plan.target.width % 16, 0, "and the frame is encoder-aligned");
  assert.equal(plan.target.codec, "avc");
  assert.equal(plan.target.frameRate, 30);
  assert.ok(plan.target.bitrate > 0);
});

test("a rung never asks for more bits than the source spends", () => {
  // The ladder rule, applied to the encoder setting rather than only to the
  // estimate. A 1 Mbit/s source re-encoded at the rung's nominal rate would
  // produce a larger file that is not a better one.
  const thin = planVideoSend(clip({ bitrate: 1_000_000 }), 720, CAN);
  assert.ok(thin.target);
  assert.equal(thin.target.bitrate, 1_000_000);

  const fat = planVideoSend(clip({ bitrate: 20_000_000 }), 720, CAN);
  assert.ok(fat.target);
  assert.ok(fat.target.bitrate < 20_000_000, "the rung caps a fat source rather than copying it");
});

test("a source with no known bitrate is transcoded at the rung rate", () => {
  const plan = planVideoSend(clip({ bitrate: undefined }), 480, CAN);
  assert.ok(plan.target);
  assert.ok(plan.target.bitrate > 0);
});

test("a rung that would not make the file smaller is refused rather than wasted", () => {
  // Spending minutes of somebody battery to produce a generation-lossed copy of
  // the same size is worse than sending what they picked. This is the only
  // as-is path that is a judgement rather than a limitation.
  // Coherent numbers matter here: a 854x480 clip at 400 kbit/s for a minute
  // weighs about four megabytes, not the eighty the default carries. The first
  // draft of this test left the default in place and so measured nothing.
  const alreadySmall = clip({ width: 854, height: 480, bitrate: 400_000, sizeBytes: 4 * 1024 * 1024 });
  const plan = planVideoSend(alreadySmall, 480, CAN);
  assert.equal(plan.action, "as-is");
  assert.equal(plan.reason, "not-smaller");
});

test("the frame rate follows the source, and an absurd one is tamed first", () => {
  const slow = planVideoSend(clip({ fps: 24 }), 720, CAN);
  assert.equal(slow.target?.frameRate, 24);
  const absurd = planVideoSend(clip({ fps: 1000 }), 720, CAN);
  assert.equal(absurd.target?.frameRate, 120, "capped by the ladder rather than believed");
  const missing = planVideoSend(clip({ fps: undefined }), 720, CAN);
  assert.equal(missing.target?.frameRate, 30);
});

test("the transcoded file is named for what it now contains", () => {
  // A name whose extension disagrees with its bytes is correct everywhere until
  // one reader trusts the name.
  assert.equal(transcodedName("holiday.mov"), "holiday.mp4");
  assert.equal(transcodedName("clip.webm"), "clip.mp4");
  assert.equal(transcodedName("already.mp4"), "already.mp4");
  assert.equal(transcodedName("no-extension"), "no-extension.mp4");
  assert.equal(transcodedName(".hidden"), ".hidden.mp4", "a leading dot is a name, not an extension");
  assert.equal(transcodedName(""), "video.mp4");
});
