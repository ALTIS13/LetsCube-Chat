// What the worker does with a video that is already the rendition.
//
// D-175, the server half. The client now encodes to 720p H.264 before it
// uploads, and the worker used to re-encode that anyway: a CPU minute spent to
// produce a slightly worse copy of the same picture. These tests pin the rule
// that stops it, and pin that the rule is measured rather than believed.
//
// The reuse is also why the rendition frame moved to the short side. The old
// filter fitted every picture into one landscape 1280x720 box, so a portrait
// clip -- most of what a phone takes -- came out 405 points wide, and a client
// that produced 720x1280 would have been re-encoded down to that. Both halves
// now count the short side, which is what tdesktop does and what «720p» has
// always meant.

import assert from "node:assert/strict";
import test from "node:test";

import * as mediaVariantRules from "../../artifacts/api-server/dist/workers/mediaVariantRules.mjs";

const seam = mediaVariantRules.mediaVariantWorkerTestSeams;

/** An mp4 head: a box length, a four-character name, and nothing else that matters. */
function mp4Head(order) {
  const boxes = order.map((type) => {
    const box = Buffer.alloc(16);
    box.writeUInt32BE(16, 0);
    box.write(type, 4, 4, "ascii");
    return box;
  });
  return new Uint8Array(Buffer.concat(boxes));
}

const probe = (over = {}) => ({
  width: 1280,
  height: 720,
  videoCodec: "h264",
  audioCodec: "aac",
  formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
  ...over,
});

// The spread goes before the probe, not after. The first draft put `...over`
// last, so a case that changed one probe field replaced the whole probe with
// that one field -- and every probe case then failed for want of a width rather
// than for the reason it named. A green test can be vacuous; so can a red one.
const reuse = ({ probe: probeOver = {}, ...rest } = {}) =>
  seam.canReuseSourceAsVideo720p({
    sourceBucket: "media",
    variantBucket: "media",
    frontLoadedMoov: true,
    ...rest,
    probe: probe(probeOver),
  });

test("the rendition counts the short side, so a portrait clip is not crushed", () => {
  // 1080x1920 under the old landscape box became 405x720. The short side is
  // what 720p names, so it is 720x1280 now.
  assert.deepEqual(seam.video720pTargetSize({ width: 1080, height: 1920 }), { width: 720, height: 1280 });
  assert.deepEqual(seam.video720pTargetSize({ width: 1920, height: 1080 }), { width: 1280, height: 720 });
  assert.deepEqual(seam.video720pTargetSize({ width: 3840, height: 2160 }), { width: 1280, height: 720 });
});

test("a clip already smaller than the rendition is left at its own size", () => {
  assert.deepEqual(seam.video720pTargetSize({ width: 640, height: 480 }), { width: 640, height: 480 });
  assert.deepEqual(seam.video720pTargetSize({ width: 1280, height: 720 }), { width: 1280, height: 720 });
});

test("an extreme aspect is held by the long side as well as the short one", () => {
  // 2.39:1 cinema. The short side alone would ask for 1721x720, which is a
  // frame nothing needs for playback in a conversation.
  assert.deepEqual(seam.video720pTargetSize({ width: 3440, height: 1440 }), { width: 1280, height: 536 });
});

test("every frame the rule produces is even, because H.264 cannot encode an odd one", () => {
  for (const source of [
    { width: 1081, height: 1921 },
    { width: 999, height: 333 },
    { width: 1235, height: 719 },
  ]) {
    const target = seam.video720pTargetSize(source);
    assert.equal(target.width % 2, 0, `${source.width}x${source.height} produced an odd width`);
    assert.equal(target.height % 2, 0, `${source.width}x${source.height} produced an odd height`);
  }
});

test("a nonsense frame produces nothing rather than a division by zero", () => {
  assert.deepEqual(seam.video720pTargetSize({ width: 0, height: 0 }), { width: 0, height: 0 });
  assert.deepEqual(seam.video720pTargetSize({ width: -10, height: 720 }), { width: 0, height: 0 });
});

test("an upload that already is the rendition is reused rather than remade", () => {
  assert.equal(reuse(), true);
});

test("every condition on the reuse is load-bearing", () => {
  const spoiled = [
    ["a codec no browser would get from us", { probe: { videoCodec: "hevc" } }],
    ["audio nothing can play beside H.264", { probe: { audioCodec: "opus" } }],
    ["a container that is not mp4", { probe: { formatNames: ["matroska", "webm"] } }],
    ["a frame that still has to come down", { probe: { width: 1920, height: 1080 } }],
    ["metadata at the back, so playback waits for the whole file", { frontLoadedMoov: false }],
    ["an object in a bucket the variant row cannot name", { sourceBucket: "chat-avatars" }],
  ];
  for (const [why, change] of spoiled) {
    assert.equal(reuse(change), false, `the upload was still reused with ${why}`);
  }
});

test("a silent clip is reused, because no audio is not the wrong audio", () => {
  assert.equal(reuse({ probe: { audioCodec: null } }), true);
});

test("the probe reads the frame, both codecs and the container", () => {
  const stdout = JSON.stringify({
    streams: [
      { index: 0, codec_type: "video", codec_name: "h264", width: 1280, height: 720 },
      { index: 1, codec_type: "audio", codec_name: "aac" },
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
  });
  assert.deepEqual(seam.parseVideoProbe(stdout), {
    width: 1280,
    height: 720,
    videoCodec: "h264",
    audioCodec: "aac",
    formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
  });
});

test("a probe of something with no picture answers nothing at all", () => {
  const audioOnly = JSON.stringify({
    streams: [{ index: 0, codec_type: "audio", codec_name: "aac" }],
    format: { format_name: "mov,mp4" },
  });
  assert.equal(seam.parseVideoProbe(audioOnly), null);
  assert.equal(seam.parseVideoProbe("not json at all"), null);
  assert.equal(seam.parseVideoProbe(JSON.stringify({ streams: [] })), null);
});

test("the probe asks about the source, not about our own output", () => {
  const args = seam.buildVideoProbeArgs("/tmp/source.mp4");
  assert.ok(args.includes("/tmp/source.mp4"));
  const entries = args[args.indexOf("-show_entries") + 1];
  for (const field of ["codec_type", "codec_name", "width", "height", "format=format_name"]) {
    assert.ok(entries.includes(field), `the probe does not ask for ${field}`);
  }
});

test("metadata in front of the media is what makes a file playable while it arrives", () => {
  assert.equal(seam.hasFrontLoadedMoov(mp4Head(["ftyp", "moov", "mdat"])), true);
  assert.equal(seam.hasFrontLoadedMoov(mp4Head(["ftyp", "free", "moov", "mdat"])), true);
  assert.equal(seam.hasFrontLoadedMoov(mp4Head(["ftyp", "mdat", "moov"])), false);
  assert.equal(seam.hasFrontLoadedMoov(mp4Head(["ftyp"])), false);
  assert.equal(seam.hasFrontLoadedMoov(new Uint8Array([0, 0, 0])), false);
});

test("a truncated or lying box length ends the walk rather than running off the file", () => {
  const short = Buffer.alloc(16);
  short.writeUInt32BE(4, 0);
  short.write("ftyp", 4, 4, "ascii");
  assert.equal(seam.hasFrontLoadedMoov(new Uint8Array(short)), false);

  const toEndOfFile = Buffer.alloc(16);
  toEndOfFile.writeUInt32BE(0, 0);
  toEndOfFile.write("free", 4, 4, "ascii");
  assert.equal(seam.hasFrontLoadedMoov(new Uint8Array(toEndOfFile)), false);
});

test("a 64-bit box length is followed rather than mistaken for an empty box", () => {
  // What a large upload carries: declared size 1, the real length in the eight
  // bytes after the name.
  const large = Buffer.alloc(32);
  large.writeUInt32BE(1, 0);
  large.write("free", 4, 4, "ascii");
  large.writeBigUInt64BE(16n, 8);
  large.writeUInt32BE(16, 16);
  large.write("moov", 20, 4, "ascii");
  assert.equal(seam.hasFrontLoadedMoov(new Uint8Array(large)), true);
});

test("the transcode asks ffmpeg for the exact frame the rule computed", () => {
  const args = seam.buildVideo720pFfmpegArgs("in.mov", "out.mp4", 2, { width: 720, height: 1280 });
  assert.equal(args[args.indexOf("-vf") + 1], "scale=w=720:h=1280");
  // And the rest of the bounded encoding is unchanged.
  assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
  assert.equal(args[args.indexOf("-crf") + 1], "24");
  assert.equal(args[args.indexOf("-maxrate") + 1], "3M");
  assert.ok(args.includes("+faststart"), "the rendition must be playable while it arrives");
});
