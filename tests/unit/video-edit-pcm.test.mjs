import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const path = new URL("../../artifacts/kub/src/lib/videoEditPcm.ts", import.meta.url);
const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { transformSync } = createRequire(requireKub.resolve("vite"))("esbuild");
const mb = requireKub("mediabunny");
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function load(globals = {}, mutate = s => s) {
  const module = { exports: {} };
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  vm.runInNewContext(transformSync(mutate(source), { loader: "ts", format: "cjs", target: "es2022" }).code,
    { module, exports: module.exports, require: n => { assert.equal(n, "mediabunny"); return mb; },
      File, Blob, DOMException, Uint8Array, ArrayBuffer, WritableStream, ...globals });
  return module.exports;
}

// Real installed mux/demux, fictional payload (no claim that these packets decode).
async function encoded({ multiple = false, offset = 0, gap = false, description = [0x11, 0x88] } = {}) {
  const target = new mb.BufferTarget(), output = new mb.Output({ target, format: new mb.Mp4OutputFormat() });
  const video = new mb.EncodedVideoPacketSource("avc"), audio = new mb.EncodedAudioPacketSource("aac");
  output.addVideoTrack(video); output.addAudioTrack(audio);
  const extra = multiple ? new mb.EncodedAudioPacketSource("aac") : null;
  if (extra) output.addAudioTrack(extra);
  await output.start();
  await video.add(new mb.EncodedPacket(new Uint8Array([0, 0, 0, 1, 0x65]), "key", 0, 3),
    { decoderConfig: { codec: "avc1.42001e", codedWidth: 320, codedHeight: 240,
      description: new Uint8Array([1, 0x42, 0, 0x1e, 0xff, 0xe0, 0]) } });
  for (let i = 0; i < 142; i++) await audio.add(new mb.EncodedPacket(new Uint8Array([0]), "key",
    (i - 1) * 1024 / 48000 + offset + (gap && i > 50 ? .1 : 0), 1024 / 48000),
    i ? undefined : { decoderConfig: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 1,
      description: new Uint8Array(description) } });
  if (extra) await extra.add(new mb.EncodedPacket(new Uint8Array([0]), "key", 0, 1024 / 48000),
    { decoderConfig: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 1, description: new Uint8Array([0x11, 0x88]) } });
  await output.finalize();
  const file = new File([target.buffer], "fictional.mp4", { type: "video/mp4" });
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: [mb.MP4] });
  return { file, input, video: await input.getPrimaryVideoTrack(), audio: await input.getPrimaryAudioTrack() };
}

test("actual MP4 eligibility accepts observed AAC-LC and returns literal preallocation budgets without decoding", async () => {
  const h = load(); assert.equal(typeof h.inspectPcmFallback, "function", "PCM fallback must be implemented");
  const f = await encoded();
  try {
    const p = await h.inspectPcmFallback(f.file, f.input, f.video, f.audio);
    assert.equal(p.sampleRate, 48000); assert.equal(p.channels, 1);
    assert.equal(p.maxFrames, 145408); assert.equal(p.decodedBytes, 581632);
    assert.equal(p.copyBytes, 2326528); assert.equal(p.outputBytes, 8388608);
  } finally { f.input.dispose(); }
});

test("real mux/demux rejects multiple tracks, offsets, gaps and non-LC ASC before Web Audio", async () => {
  const h = load(); assert.equal(typeof h.inspectPcmFallback, "function");
  for (const options of [{ multiple: true }, { offset: .2 }, { gap: true }, { description: [0x29, 0x88] }]) {
    const f = await encoded(options);
    try { await assert.rejects(h.inspectPcmFallback(f.file, f.input, f.video, f.audio), /VIDEO_EDIT_UNSUPPORTED/, JSON.stringify(options)); }
    finally { f.input.dispose(); }
  }
});

test("literal size/duration/PCM/copy caps fail closed before allocations", async () => {
  const h = load(); assert.equal(typeof h.pcmBudget, "function");
  const ok = h.pcmBudget(8388608, 15, 721024);
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), { maxFrames: 721024, decodedBytes: 2884096, copyBytes: 11536384, outputBytes: 8388608 });
  for (const args of [[8388609, 3, 145408], [1, 15.001, 721024], [1, NaN, 1], [1, 3, 786433],
    [1, 3, Infinity], [0, 3, 1], [1, 0, 1]]) assert.throws(() => h.pcmBudget(...args), /VIDEO_EDIT_UNSUPPORTED/);
});

test("selected frames use nearest boundaries and copy only that interval; no source alias", async () => {
  const h = load(); assert.equal(typeof h.selectPcmFrames, "function");
  const data = Float32Array.from({ length: 144384 }, (_, i) => i);
  const decoded = { sampleRate: 48000, numberOfChannels: 1, length: data.length, getChannelData: () => data };
  let allocation;
  const context = { createBuffer(channels, length, rate) {
    allocation = [channels, length, rate]; const copy = new Float32Array(length);
    return { copyToChannel: src => copy.set(src), getChannelData: () => copy };
  } };
  const selected = h.selectPcmFrames(decoded, context, { start: 1.100001, end: 1.900001 },
    { ...h.pcmBudget(100, 3.008, 145408), sampleRate: 48000, channels: 1, duration: 3.008 });
  assert.deepEqual(allocation, [1, 38400, 48000]);
  assert.equal(selected.getChannelData(0)[0], 52800); assert.equal(selected.getChannelData(0).at(-1), 91199);
  data[52800] = -1; assert.equal(selected.getChannelData(0)[0], 52800);
  assert.throws(() => h.selectPcmFrames({ ...decoded, length: 900000 }, context, { start: 1, end: 2 },
    { ...h.pcmBudget(100, 3.008, 145408), sampleRate: 48000, channels: 1, duration: 3.008 }), /VIDEO_EDIT_INVALID_PCM/);
});

test("abort during unabortable decode owns stale completion and awaited context close, with no selected allocation", async () => {
  const gate = deferred(), closing = deferred(), events = [], c = new AbortController();
  const h = load({ AudioContext: class {
    constructor(options) { events.push(["context", options.sampleRate]); }
    async decodeAudioData() { events.push("decode"); return gate.promise; }
    createBuffer() { assert.fail("stale PCM must never be copied"); }
    async close() { events.push("close"); await closing.promise; events.push("closed"); }
  } });
  assert.equal(typeof h.decodePcmSelection, "function");
  let settled = false;
  const job = h.decodePcmSelection(new File(["bounded"], "f.mp4"), { start: 1, end: 2 },
    { ...h.pcmBudget(7, 3, 145408), sampleRate: 48000, channels: 1, duration: 3 }, c.signal);
  job.then(() => { settled = true; }, () => { settled = true; });
  await tick(); c.abort(); await tick(); assert.equal(settled, false);
  assert.deepEqual(events, [["context", 48000], "decode"]);
  gate.resolve({}); await tick(); assert.equal(settled, false); assert.equal(events.at(-1), "close");
  closing.resolve(); await assert.rejects(job, { name: "AbortError" }); assert.equal(events.at(-1), "closed");
});

test("real installed StreamTarget writes a bounded WAV, supports seeks and refuses overflow", async () => {
  const h = load(); assert.equal(typeof h.boundedPcmTarget, "function");
  const sink = h.boundedPcmTarget(128);
  const output = new mb.Output({ target: sink.target, format: new mb.WavOutputFormat() });
  const source = new mb.EncodedAudioPacketSource("pcm-s16"); output.addAudioTrack(source);
  await output.start();
  await source.add(new mb.EncodedPacket(new Uint8Array(16), "key", 0, 8 / 48000),
    { decoderConfig: { codec: "pcm-s16", sampleRate: 48000, numberOfChannels: 1 } });
  await output.finalize(); const bytes = sink.finish();
  assert.ok(bytes.length > 16 && bytes.length <= 128); assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "RIFF");
  const tiny = h.boundedPcmTarget(8), over = new mb.Output({ target: tiny.target, format: new mb.WavOutputFormat() });
  over.addAudioTrack(new mb.EncodedAudioPacketSource("pcm-s16"),
    { decoderConfig: { codec: "pcm-s16", sampleRate: 48000, numberOfChannels: 1 } });
  await assert.rejects(async () => { await over.start(); await over.finalize(); }, /VIDEO_EDIT_OUTPUT_BUDGET/);
  if (over.state !== "canceled") await over.cancel();
});

test("ambiguous/nonunit edit-list is refused even when public demux still reports the same primary timeline", async () => {
  const h = load(); assert.equal(typeof h.inspectPcmFallback, "function");
  const f = await encoded();
  try {
    const bytes = new Uint8Array(await f.file.arrayBuffer());
    const offset = Buffer.from(bytes).indexOf(Buffer.from("elst")); assert.ok(offset > 0);
    new DataView(bytes.buffer).setInt16(offset + 20, 2); // v0 entry media_rate_integer (normally 1).
    const changed = new File([bytes], "nonunit.mp4");
    const input = new mb.Input({ source: new mb.BlobSource(changed), formats: [mb.MP4] });
    try { await assert.rejects(h.inspectPcmFallback(changed, input, await input.getPrimaryVideoTrack(),
      await input.getPrimaryAudioTrack()), /VIDEO_EDIT_UNSUPPORTED/); }
    finally { input.dispose(); }
  } finally { f.input.dispose(); }
});

test("retry classifier accepts only execute EncodingError, never abort, IO, init or output failure", () => {
  const h = load(); assert.equal(typeof h.isPcmCodecFailure, "function");
  assert.equal(h.isPcmCodecFailure(new DOMException("native decode", "EncodingError"), "execute"), true);
  for (const [error, phase] of [[new Error("IO"), "execute"], [new DOMException("", "AbortError"), "execute"],
    [new DOMException("", "EncodingError"), "init"], [new DOMException("", "EncodingError"), "verify"]]) {
    assert.equal(h.isPcmCodecFailure(error, phase), false);
  }
});

test("loaded literal budget and selected-frame omissions are observable, not self-referential assertions", () => {
  const base = load();
  assert.throws(() => base.pcmBudget(8388609, 3, 145408), /VIDEO_EDIT_UNSUPPORTED/);
  assert.throws(() => base.pcmBudget(1, 15.001, 145408), /VIDEO_EDIT_UNSUPPORTED/);
  const replace = (old, value) => s => { assert.ok(s.includes(old)); return s.replace(old, value); };
  const inputMutant = load({}, replace("const INPUT_BYTES = 8_388_608;", "const INPUT_BYTES = 8_388_609;"));
  assert.equal(inputMutant.pcmBudget(8388609, 3, 145408).outputBytes, 8388608);
  const durationMutant = load({}, replace("const DURATION_SECONDS = 15;", "const DURATION_SECONDS = 16;"));
  assert.equal(durationMutant.pcmBudget(1, 15.001, 145408).decodedBytes, 581632);
  const pcmMutant = load({}, s => replace("const PCM_BYTES = 3_145_728;", "const PCM_BYTES = 4_000_000;")(
    replace("const COPY_BYTES = 12_582_912;", "const COPY_BYTES = 16_000_000;")(s)));
  assert.throws(() => base.pcmBudget(1, 3, 786433), /VIDEO_EDIT_UNSUPPORTED/);
  assert.equal(pcmMutant.pcmBudget(1, 3, 786433).decodedBytes, 3145732);
});

test("loaded omission of edit provenance admits the actual nonunit-edit control", async () => {
  const f = await encoded(), original = new Uint8Array(await f.file.arrayBuffer());
  const offset = Buffer.from(original).indexOf(Buffer.from("elst"));
  new DataView(original.buffer).setInt16(offset + 20, 2);
  const changed = new File([original], "nonunit.mp4");
  // Same trustworthy tracks, changed byte-level origin: proves the extra check is load-bearing.
  const h = load({}, s => { const line = "await verifyMp4Origin(file, video, audio, audioStart, audioEnd, videoEnd, signal);";
    assert.ok(s.includes(line)); return s.replace(line, ""); });
  try {
    await assert.rejects(load().inspectPcmFallback(changed, f.input, f.video, f.audio), /VIDEO_EDIT_UNSUPPORTED/);
    assert.equal((await h.inspectPcmFallback(changed, f.input, f.video, f.audio)).maxFrames, 145408);
  } finally { f.input.dispose(); }
});

test("reopening real output rejects original full rendition, extra track and duration mismatch", async () => {
  const h = load(); assert.equal(typeof h.verifyPcmOutput, "function");
  const f = await encoded();
  try {
    await assert.rejects(h.verifyPcmOutput(f.input, 320, 240, .8), /VIDEO_EDIT_INVALID_OUTPUT/);
    await assert.rejects(h.verifyPcmOutput(f.input, 640, 240, 3), /VIDEO_EDIT_INVALID_OUTPUT/);
  } finally { f.input.dispose(); }
});
