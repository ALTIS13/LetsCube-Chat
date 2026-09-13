// What a picked video is, once a container has been asked.
//
// D-175. Only the pure half is testable here, and that is where every judgement
// lives: what counts as a usable number, what a missing one falls back to, and
// which absences are fatal. The reading itself is a thin shell around a library
// and a File, and belongs to a browser.

import assert from "node:assert/strict";
import test from "node:test";

import { toSourceVideo } from "../../artifacts/kub/src/lib/videoSource.ts";
import { estimateBytes, offeredLevels } from "../../artifacts/kub/src/lib/videoSendLadder.ts";

const facts = (over: Partial<Parameters<typeof toSourceVideo>[0]> = {}) => ({
  sizeBytes: 80 * 1024 * 1024,
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 29.97,
  bitrate: 9_000_000,
  audioChannels: 2,
  videoCodec: "avc1.640028",
  audioCodec: "mp4a.40.2",
  ...over,
});

test("a container that answered everything feeds the ladder directly", () => {
  const read = toSourceVideo(facts());
  assert.ok(read);
  assert.deepEqual(read.source, {
    width: 1920,
    height: 1080,
    duration: 60,
    sizeBytes: 80 * 1024 * 1024,
    fps: 29.97,
    bitrate: 9_000_000,
    audioChannels: 2,
  });
  assert.deepEqual(read.codecs, { video: "avc1.640028", audio: "mp4a.40.2" });
  assert.equal(read.measured, true);
  // And the ladder can now actually be called, which was the whole point.
  assert.deepEqual(offeredLevels(read.source), [480, 720]);
  assert.ok(estimateBytes(read.source, 720) > 0);
});

test("without a picture there is nothing to offer", () => {
  // No short side means no rung and no target frame. The caller sends the file
  // as it is, which is a path every caller must have anyway.
  assert.equal(toSourceVideo(facts({ width: null })), null);
  assert.equal(toSourceVideo(facts({ height: null })), null);
  assert.equal(toSourceVideo(facts({ width: 0, height: 0 })), null);
});

test("without a duration no rung can state its size, so none is offered", () => {
  assert.equal(toSourceVideo(facts({ duration: null })), null);
  assert.equal(toSourceVideo(facts({ duration: 0 })), null);
  assert.equal(toSourceVideo(facts({ duration: Number.NaN })), null);
});

test("a missing frame rate falls through to the ladder own default", () => {
  const read = toSourceVideo(facts({ fps: null }));
  assert.ok(read);
  assert.equal(read.source.fps, undefined, "left absent rather than invented here");
  // usableFps turns that into 30, which is documented in the ladder.
  assert.ok(estimateBytes(read.source, 480) > 0);
});

test("a missing bitrate is derived from the file, and over-stating is the safe direction", () => {
  const read = toSourceVideo(facts({ bitrate: null }));
  assert.ok(read);
  // 80 MiB over 60s = about 11.18 Mbit/s, which includes the audio and the
  // container and so over-states the video track. That is the direction that
  // keeps the «never spend more than the source» clamp from firing wrongly.
  const derived = (80 * 1024 * 1024 * 8) / 60;
  assert.ok(read.source.bitrate !== undefined);
  assert.ok(Math.abs((read.source.bitrate as number) - derived) < 1);
  assert.equal(read.measured, false, "a derived number is not a measured one and says so");
});

test("a measured bitrate is preferred over the derived one", () => {
  const read = toSourceVideo(facts({ bitrate: 3_000_000 }));
  assert.ok(read);
  assert.equal(read.source.bitrate, 3_000_000);
  assert.equal(read.measured, true);
});

test("a silent clip reports no channels rather than none at all", () => {
  const read = toSourceVideo(facts({ audioChannels: null, audioCodec: null }));
  assert.ok(read);
  assert.equal(read.source.audioChannels, 0);
  assert.equal(read.codecs.audio, undefined);
});

test("a file of unknown size still produces a usable source", () => {
  // sizeBytes 0 means the derived bitrate cannot be computed. With a measured
  // one that is fine; without either, the rung has no ceiling and the ladder
  // falls back to its own target, which is correct rather than wrong.
  const withMeasured = toSourceVideo(facts({ sizeBytes: 0 }));
  assert.ok(withMeasured);
  assert.equal(withMeasured.source.bitrate, 9_000_000);

  const withNeither = toSourceVideo(facts({ sizeBytes: 0, bitrate: null }));
  assert.ok(withNeither);
  assert.equal(withNeither.source.bitrate, undefined);
  assert.ok(estimateBytes(withNeither.source, 480) > 0, "an unbounded source still estimates");
});

test("negative and infinite numbers from a broken container are refused, not propagated", () => {
  assert.equal(toSourceVideo(facts({ duration: -10 })), null);
  assert.equal(toSourceVideo(facts({ width: Number.POSITIVE_INFINITY })), null);
  const read = toSourceVideo(facts({ fps: -1, bitrate: -1 }));
  assert.ok(read);
  assert.equal(read.source.fps, undefined);
  // A negative bitrate is refused and the derived one takes over.
  assert.ok((read.source.bitrate as number) > 0);
});
