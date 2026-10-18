import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../artifacts/kub/src/lib/videoEdit.ts", import.meta.url), "utf8");
const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { transformSync } = createRequire(requireKub.resolve("vite"))("esbuild");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const file = () => new File(["fictional encoded input"], "fictional.mov", { type: "video/quicktime" });
const range = { start: 1, end: 2 };

// Only dependency/control-flow leaves are simulated here. Real encoded packets,
// dimensions, pixels and PCM samples are independently checked in the browser file.
function fixture(options = {}, mutate = s => s) {
  const events = [], inputs = [], outputs = [], configs = [], formats = [], probes = [];
  const makeVideo = result => ({
    getDisplayWidth: async () => result && options.outputWidth ? options.outputWidth : options.width ?? 320,
    getDisplayHeight: async () => options.height ?? 240,
    canDecode: async () => options.videoDecode ?? true,
    computeDuration: async () => result ? options.outputVideoDuration ?? 1 : 3,
  });
  const makeAudio = result => ({
    canDecode: async () => options.audioDecode ?? true,
    getCodec: async () => "aac", getNumberOfChannels: async () => 2, getSampleRate: async () => 48000,
    computeDuration: async () => result ? options.outputAudioDuration ?? 1 : 3,
  });
  class Input {
    constructor(config) {
      this.result = inputs.length > 0; this.id = inputs.length;
      assert.equal(config.formats, sendable);
      this.video = options.noVideo || (this.result && options.outputNoVideo) ? null : makeVideo(this.result);
      this.audio = options.noAudio || (this.result && options.outputNoAudio) ? null : makeAudio(this.result);
      inputs.push(this);
    }
    async canRead() { return options.readable ?? true; }
    async getPrimaryVideoTrack() { return this.video; }
    async getPrimaryAudioTrack() { return this.audio; }
    async computeDuration(tracks) { assert.equal(tracks[0], this.video); return this.result ? options.outputDuration ?? 1 : options.duration ?? 3; }
    dispose() { events.push(`dispose-${this.id}`); this.disposed = true; }
  }
  class Output {
    constructor({ target, format }) { this.state = "pending"; this.target = target; this.format = format; outputs.push(this); }
    cancel() {
      this.state = "canceled";
      return this.canceling ??= (async () => {
        events.push("output-cancel-start");
        if (options.cleanupGate) await options.cleanupGate.promise;
        events.push("output-cancel-done");
        if (options.cancelFailure) throw Error("CANCEL_FAILED");
      })();
    }
  }
  class Conversion {
    static async init(config) {
      configs.push(config); events.push("init-start");
      if (options.initGate) await options.initGate.promise;
      if (options.initFailure) throw Error("INIT_FAILED");
      const c = new Conversion(); c.config = config; c.state = "idle";
      c.isValid = options.valid ?? true;
      const { video, audio } = config.input;
      c.utilizedTracks = options.tracks ? options.tracks({ video, audio }) : [video, ...(audio ? [audio] : [])];
      options.onInit?.(c); events.push("init-done"); return c;
    }
    async execute() {
      events.push("execute"); this.state = "executing";
      if (options.executeFailure) throw Error("EXECUTE_FAILED");
      if (options.internalCancel) {
        // Mediabunny 1.56.1 execute() deliberately invokes `void this.cancel()`
        // when a track pump fails. Its cleanup must still be joined by the owner.
        void this.cancel(); throw Error("PUMP_FAILED");
      }
      this.onProgress?.(.5, .5);
      if (options.executeGate) await options.executeGate.promise;
      if (this.state === "canceled") throw Error("CANCELED");
      this.state = "done"; this.config.output.state = "finalized";
      this.config.output.target.buffer = options.emptyOutput ? new ArrayBuffer(0) : new ArrayBuffer(8);
      options.afterExecute?.();
    }
    async cancel() {
      if (this.state === "done" || this.state === "canceled") return;
      this.state = "canceled"; events.push("conversion-cancel");
      await this.config.output.cancel();
    }
  }
  const sendable = ["MP4", "QTFF", "WEBM", "MATROSKA"];
  const dependencies = {
    mediabunny: {
      Input, Output, Conversion, BlobSource: class { constructor(file) { this.file = file; } },
      BufferTarget: class { buffer = null; },
      Mp4OutputFormat: class {
        constructor(config) { formats.push(config); }
        getSupportedVideoCodecs() { return ["avc", "vp9"]; }
        getSupportedAudioCodecs() { return ["aac", "opus"]; }
      },
      getFirstEncodableAudioCodec: async (codecs, info) => { probes.push({ codecs, info }); return options.audioCodec === null ? null : "aac"; },
    },
    "./mediaCompression.ts": { MAX_ORIGINAL_ATTACHMENT_BYTES: 52_428_800 },
    "./videoSource.ts": { SENDABLE_FORMATS: sendable },
    "./videoTranscodeSupport.ts": {
      videoTranscodeSupport: async () => options.support ?? { available: true, codec: "avc" },
      canEncodeFrame: async (codec, width, height) => { probes.push({ codec, width, height }); return options.frameSupport ?? true; },
    },
  };
  const code = transformSync(mutate(source), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, File, DOMException,
    require: name => { assert.ok(dependencies[name], `Unexpected dependency ${name}`); return dependencies[name]; } });
  return { ...module.exports, events, inputs, outputs, configs, formats, probes };
}

test("literal MP4/primary/no-copy/no-tags config, native dimensions and actual audio encoder parameters", async () => {
  const f = fixture(), result = await f.trimVideo(file(), range);
  assert.equal(result.changed, true); assert.equal(result.file.type, "video/mp4"); assert.equal(result.file.name, "fictional.mp4");
  assert.deepEqual([result.width, result.height, result.duration], [320, 240, 1]);
  const c = f.configs[0]; assert.equal(c.tracks, "primary"); assert.equal(c.copy, false); assert.deepEqual(Object.keys(c.tags), []);
  assert.deepEqual(JSON.parse(JSON.stringify(c.trim)), { start: 1, end: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(c.video)), { codec: "avc" }); assert.equal(c.audio.codec, "aac");
  assert.deepEqual(JSON.parse(JSON.stringify(f.formats)), [{ fastStart: "in-memory" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.probes)), [{ codec: "avc", width: 320, height: 240 }, { codecs: ["aac", "opus"], info: { numberOfChannels: 2, sampleRate: 48000 } }]);
  assert.ok(f.inputs.every(i => i.disposed));
});

test("isValid alone cannot authorize missing, substituted, duplicate or extra primary tracks", async () => {
  for (const tracks of [({ audio }) => [audio], ({ video }) => [video], ({ video }) => [video, video],
    ({ video, audio }) => [video, audio, {}], () => [{}, {}]]) {
    const f = fixture({ tracks }); await assert.rejects(f.trimVideo(file(), range), /VIDEO_EDIT_MISSING_TRACK/);
    assert.ok(!f.events.includes("execute")); assert.ok(f.events.includes("output-cancel-done")); assert.equal(f.events.at(-1), "dispose-0");
  }
  const f = fixture({ valid: false }); await assert.rejects(f.trimVideo(file(), range), /VIDEO_EDIT_MISSING_TRACK/);
});

test("unsupported primary decoder, encoder, frame size or required audio codec rejects before conversion", async () => {
  for (const options of [{ videoDecode: false }, { audioDecode: false }, { frameSupport: false }, { audioCodec: null },
    { support: { available: false, codec: null } }, { support: { available: true, codec: "vp8" } }]) {
    const f = fixture(options); await assert.rejects(f.inspectVideoEdit(file()), /VIDEO_EDIT_UNSUPPORTED/);
    assert.equal(f.configs.length, 0); assert.ok(f.inputs.every(i => i.disposed));
  }
});

test("invalid metadata and files cannot reach encoder allocation; literal 50 MiB cap", async () => {
  for (const options of [{ noVideo: true }, { readable: false }, { width: 0 }, { height: Infinity }, { duration: 0 }, { duration: NaN }]) {
    const f = fixture(options); await assert.rejects(f.inspectVideoEdit(file()), /VIDEO_EDIT_(NO_VIDEO|UNREADABLE|INVALID_METADATA)/);
    assert.equal(f.probes.length, 0); assert.ok(f.inputs.every(i => i.disposed));
  }
  const big = file(); Object.defineProperty(big, "size", { value: 52_428_801 });
  const f = fixture(); await assert.rejects(f.inspectVideoEdit(big), /VIDEO_EDIT_INVALID_FILE/); assert.equal(f.inputs.length, 0);
  const edge = file(); Object.defineProperty(edge, "size", { value: 52_428_800 }); await f.inspectVideoEdit(edge);
});

test("no-op is exactly identical File and does not require an encoder; invalid ranges never get a fallback", async () => {
  const f = fixture({ support: { available: false, codec: null } }), original = file();
  const same = await f.trimVideo(original, { start: 0, end: 3 });
  assert.equal(same.file, original); assert.equal(same.changed, false); assert.equal(f.configs.length, 0); assert.equal(f.probes.length, 0);
  for (const invalid of [{ start: 0, end: 4 }, { start: 0, end: NaN }, { start: -1, end: 1 }, { start: 1, end: 1 }]) {
    const g = fixture(); await assert.rejects(g.trimVideo(original, invalid), /VIDEO_EDIT_INVALID_RANGE/); assert.equal(g.configs.length, 0);
  }
});

test("caller cannot move the selected interval while initialization is pending", async () => {
  const gate = deferred(), f = fixture({ initGate: gate }), selected = { start: 1, end: 2 };
  const promise = f.trimVideo(file(), selected); await new Promise(setImmediate); selected.start = 0; selected.end = 3;
  gate.resolve(); await promise; assert.deepEqual(JSON.parse(JSON.stringify(f.configs[0].trim)), { start: 1, end: 2 });
});

test("abort during init waits for init and held cleanup, then disposes exactly once", async () => {
  const init = deferred(), cleanup = deferred(), c = new AbortController();
  const f = fixture({ initGate: init, cleanupGate: cleanup }); let settled = false;
  const promise = f.trimVideo(file(), range, { signal: c.signal }); promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(setImmediate); c.abort(); await new Promise(setImmediate); assert.equal(settled, false); assert.equal(f.inputs[0].disposed, undefined);
  init.resolve(); await new Promise(setImmediate); assert.equal(settled, false); assert.ok(!f.events.includes("execute"));
  cleanup.resolve(); await assert.rejects(promise, { name: "AbortError" }); assert.equal(f.events.at(-1), "dispose-0");
  assert.equal(f.events.filter(e => e === "dispose-0").length, 1);
});

test("failed init and failed execute both settle output cancellation before input disposal", async () => {
  for (const options of [{ initFailure: true }, { executeFailure: true }]) {
    const cleanup = deferred(), f = fixture({ ...options, cleanupGate: cleanup }); let settled = false;
    const promise = f.trimVideo(file(), range); promise.catch(() => { settled = true; });
    await new Promise(setImmediate); assert.equal(settled, false); assert.ok(!f.inputs[0].disposed);
    cleanup.resolve(); await assert.rejects(promise, /(INIT|EXECUTE)_FAILED/);
    assert.ok(f.events.indexOf("output-cancel-done") < f.events.indexOf("dispose-0"));
  }
});

test("dependency self-cancel on pump error is joined even when conversion already says canceled", async () => {
  const cleanup = deferred(), f = fixture({ internalCancel: true, cleanupGate: cleanup }); let settled = false;
  const promise = f.trimVideo(file(), range); promise.catch(() => { settled = true; });
  await new Promise(setImmediate); assert.equal(settled, false, "must not return while library-owned cancellation is still pending");
  assert.ok(!f.inputs[0].disposed); cleanup.resolve(); await assert.rejects(promise, /PUMP_FAILED/);
  assert.ok(f.events.indexOf("output-cancel-done") < f.events.indexOf("dispose-0"));
});

test("dependency-internal cancel rejection is observed and remains a rejected edit, never unhandled or fallback", async () => {
  const f = fixture({ internalCancel: true, cancelFailure: true });
  await assert.rejects(f.trimVideo(file(), range), /PUMP_FAILED/);
  assert.ok(f.events.includes("output-cancel-done")); assert.equal(f.events.at(-1), "dispose-0");
  await new Promise(setImmediate);
});

test("late abort after execute rejects and a malformed encoded output never becomes success", async () => {
  const c = new AbortController(), f = fixture({ afterExecute: () => c.abort() });
  await assert.rejects(f.trimVideo(file(), range, { signal: c.signal }), { name: "AbortError" });
  assert.equal(f.inputs.length, 1); assert.ok(f.inputs[0].disposed);
  for (const options of [{ outputNoVideo: true }, { outputNoAudio: true }, { outputWidth: 640 }, { outputVideoDuration: 0 },
    { outputAudioDuration: 0 }, { emptyOutput: true }]) {
    const g = fixture(options); await assert.rejects(g.trimVideo(file(), range), /VIDEO_EDIT_(INVALID_OUTPUT|NO_VIDEO)/);
    assert.ok(g.inputs.every(i => i.disposed));
  }
});

test("video-only requires exactly its primary video and no audio probe; pre-abort allocates nothing", async () => {
  const f = fixture({ noAudio: true }); await f.trimVideo(file(), range);
  assert.equal(f.configs[0].audio, undefined); assert.equal(f.probes.length, 1);
  const c = new AbortController(); c.abort(); const g = fixture();
  await assert.rejects(g.inspectVideoEdit(file(), { signal: c.signal }), { name: "AbortError" });
  await assert.rejects(g.trimVideo(file(), range, { signal: c.signal }), { name: "AbortError" }); assert.equal(g.inputs.length, 0);
});

test("literal omitted required-track guard is killed by an audio-only conversion configuration", async () => {
  const f = fixture({ tracks: ({ audio }) => [audio] }, s => {
    const old = 'if (!conversion.isValid || conversion.utilizedTracks.length !== required.length\n      || required.some(track => !conversion!.utilizedTracks.includes(track)))';
    assert.ok(s.includes(old)); return s.replace(old, 'if (!conversion.isValid)');
  });
  const result = await f.trimVideo(file(), range);
  assert.equal(result.changed, true, "omission bypasses the pre-execute oracle in this explicit dependency-only control");
  assert.ok(f.events.includes("execute"));
});
