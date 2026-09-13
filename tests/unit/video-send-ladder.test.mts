// What a video may be sent at, and what the number beside each rung means.
//
// D-175. The arithmetic is copied from tdesktop, which of Telegram four
// implementations is the only one that models the container and refuses to
// spend more than the source did. These tests pin both of those, because both
// are easy to drop and neither shows up as anything but a wrong number.

import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_SEND_LEVELS,
  alignTo16,
  canRemux,
  estimateBytes,
  estimateIsApproximate,
  formatEstimate,
  offeredLevels,
  shortSideOf,
  targetBitrate,
  targetSizeFor,
  usableFps,
} from "../../artifacts/kub/src/lib/videoSendLadder.ts";

const clip = (over: Partial<Parameters<typeof estimateBytes>[0]> = {}) => ({
  width: 1920,
  height: 1080,
  duration: 60,
  sizeBytes: 80 * 1024 * 1024,
  fps: 30,
  bitrate: 8_000_000,
  audioChannels: 2,
  ...over,
});

test("the rungs are named the way people say them", () => {
  assert.deepEqual(
    VIDEO_SEND_LEVELS.map((level) => level.label),
    ["480p", "720p", "1080p", "2K", "4K"],
  );
  assert.deepEqual(
    VIDEO_SEND_LEVELS.map((level) => level.height),
    [480, 720, 1080, 1440, 2160],
  );
});

test("the ladder is counted on the short side, whichever way the clip is turned", () => {
  // The same picture, landscape and portrait, must offer the same rungs. This
  // is why the short side is used: Android counts the long one, and «854» then
  // means two different pictures.
  assert.equal(shortSideOf({ width: 1920, height: 1080 }), 1080);
  assert.equal(shortSideOf({ width: 1080, height: 1920 }), 1080);
  assert.deepEqual(offeredLevels({ width: 1920, height: 1080 }), [480, 720]);
  assert.deepEqual(offeredLevels({ width: 1080, height: 1920 }), [480, 720]);
});

test("nothing above the source is offered, because upscaling costs bytes and adds nothing", () => {
  assert.deepEqual(offeredLevels({ width: 854, height: 480 }), [], "a 480p clip has nothing below it");
  assert.deepEqual(offeredLevels({ width: 1280, height: 720 }), [480]);
  assert.deepEqual(offeredLevels({ width: 3840, height: 2160 }), [480, 720, 1080, 1440]);
  assert.deepEqual(offeredLevels({ width: 0, height: 0 }), [], "an unreadable clip offers nothing");
});

test("a target frame keeps the aspect and lands on a multiple of sixteen", () => {
  // Chromium crops to 16x16 on Android rather than refusing, so a rung that
  // asks for an odd size silently becomes a different picture.
  assert.equal(alignTo16(854), 848);
  assert.equal(alignTo16(1), 16, "never smaller than one macroblock");
  assert.equal(alignTo16(480), 480);

  const landscape = targetSizeFor({ width: 1920, height: 1080 }, 720);
  assert.equal(landscape.height, 720);
  assert.equal(landscape.width % 16, 0);
  assert.ok(Math.abs(landscape.width / landscape.height - 16 / 9) < 0.05, "the aspect survived the alignment");

  const portrait = targetSizeFor({ width: 1080, height: 1920 }, 720);
  assert.equal(portrait.width, 720, "on a portrait clip the short side is the width");
  assert.equal(portrait.height % 16, 0);
});

test("the bitrate is bits per pixel per frame, clamped at both ends", () => {
  // 1280x720x30 x 0.07 = 1,935,360 — inside the band, so it is used as is.
  assert.equal(targetBitrate(1280, 720, 30), 1_935_360);
  // A postage stamp asks for less than the floor.
  assert.equal(targetBitrate(320, 240, 30), 600_000);
  // 4K at 60 asks for far more than the ceiling.
  assert.equal(targetBitrate(3840, 2160, 60), 6_800_000);
});

test("an absurd frame rate does not become an absurd bitrate", () => {
  assert.equal(usableFps(undefined), 30);
  assert.equal(usableFps(0), 30);
  assert.equal(usableFps(-5), 30);
  assert.equal(usableFps(1000), 120, "a container claiming 1000fps is capped, not believed");
  assert.equal(usableFps(24), 24);
});

test("a rung never asks for more bits than the source already spent", () => {
  // The rule tdesktop states as «Quality mode never spends much more than the
  // source did». A 1 Mbit/s clip re-encoded at 1.9 would be a bigger file that
  // is not a better one.
  const thin = clip({ bitrate: 1_000_000, audioChannels: 0 });
  const fat = clip({ bitrate: 20_000_000, audioChannels: 0 });
  const thinAt720 = estimateBytes(thin, 720);
  const fatAt720 = estimateBytes(fat, 720);
  assert.ok(thinAt720 < fatAt720, "the thin source must estimate smaller at the same rung");

  // And explicitly: the thin one is bounded by its own bitrate, not by the rung.
  const seconds = 60;
  const ceiling = (1_000_000 * seconds) / 8;
  assert.ok(thinAt720 < ceiling * 1.2, "the estimate ran away from what the source spends");
});

test("a silent clip is not charged for audio, and a stereo one is", () => {
  const silent = estimateBytes(clip({ audioChannels: 0 }), 720);
  const stereo = estimateBytes(clip({ audioChannels: 2 }), 720);
  assert.ok(stereo > silent, "two channels of audio weigh something");
  // 64 kbit/s per channel over 60s = 960,000 bytes, plus the audio container tables.
  assert.ok(stereo - silent > 900_000, "the audio cost is roughly its bitrate over the duration");
});

test("the container is modelled, not ignored", () => {
  // A long clip at a low bitrate is mostly tables. Without the per-frame terms
  // the estimate for one is noticeably light.
  const long = estimateBytes(clip({ duration: 600, bitrate: 800_000, audioChannels: 0 }), 480);
  const bare = (Math.min(targetBitrate(848, 480, 30), 800_000) * 600) / 8;
  assert.ok(long > bare, "the container weighs nothing, so the estimate is short");
  assert.ok(long - bare > 400_000, "ten minutes of frame tables is not a rounding error");
});

test("a duration of zero does not produce a negative or absurd size", () => {
  const still = estimateBytes(clip({ duration: 0 }), 480);
  assert.ok(still > 0 && still < 10_000, "an empty clip is the container and nothing else");
  const negative = estimateBytes(clip({ duration: -5 }), 480);
  assert.ok(negative > 0, "a negative duration is treated as none, not as a credit");
});

test("the size is written the way it is read here", () => {
  // A number and its unit are separated by a non-breaking space here, as
  // formatSizeRoundedUp in mediaCompression already does. Built from its code
  // point so no copy of this file can quietly substitute a plain one: that is
  // exactly what produced a failure whose two sides read identically.
  const NB = String.fromCharCode(160);
  assert.equal(formatEstimate(12.4 * 1024 * 1024), `12${NB}МБ`);
  assert.equal(formatEstimate(1.5 * 1024 * 1024), `1,5${NB}МБ`);
  assert.equal(formatEstimate(2.25 * 1024 * 1024 * 1024), `2,3${NB}ГБ`);
  assert.equal(formatEstimate(400 * 1024), `400${NB}КБ`);
  assert.equal(formatEstimate(0), `1${NB}КБ`, "nothing is ever written as zero beside a control");
});

/**
 * The honesty of the number.
 *
 * Android computes its estimate from a bitrate it asked the hardware for
 * (`extractRealEncoderBitrate`). A browser has no such call: `isConfigSupported`
 * answers yes or no. So this is an estimate, and the flag exists so that a
 * surface cannot present it as anything else without deleting a constant that
 * says otherwise.
 */
test("every number here is an estimate and says so", () => {
  assert.equal(estimateIsApproximate, true);
});

test("remuxing is offered only where nothing needs re-encoding", () => {
  const source = { width: 1920, height: 1080 };
  assert.equal(canRemux(source, "source", { video: "avc1.640028", audio: "mp4a.40.2" }), true);
  assert.equal(canRemux(source, "source", { video: "avc1.42001f" }), true, "a silent H.264 clip still remuxes");
  assert.equal(canRemux(source, "source", { video: "hev1.1.6.L93.B0", audio: "mp4a.40.2" }), false, "HEVC must be transcoded");
  assert.equal(canRemux(source, "source", { video: "vp09.00.10.08", audio: "opus" }), false);
  assert.equal(
    canRemux(source, 720, { video: "avc1.640028", audio: "mp4a.40.2" }),
    false,
    "a chosen rung means the picture changes, so there is nothing to repackage",
  );
});
