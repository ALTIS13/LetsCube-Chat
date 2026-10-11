import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const sources = new Map();
function read(path) {
  const bytes = readFileSync(new URL(path, root));
  sources.set(path, bytes);
  return bytes.toString("utf8").replaceAll("\r\n", "\n");
}
const hookSource = read("hooks/useVoiceRecorder.ts");
const inputSource = read("components/chat/MessageInput.tsx");
const fixtures = new Set();
test.afterEach(async () => {
  for (const fixture of fixtures) await fixture.close();
  fixtures.clear();
});
test.after(() => {
  for (const [path, bytes] of sources) {
    assert.ok(bytes.equals(readFileSync(new URL(path, root))), `source unchanged: ${path}`);
  }
});

function compile(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, {
    module, exports: module.exports, Error, Blob,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `unexpected import ${name}`);
      return imports[name];
    },
    ...globals,
  }, { timeout: 1000 });
  return module.exports;
}

const scope = compile(read("lib/composerSendScope.ts"));
const gesture = compile(read("lib/recordingGesture.ts"));
const audioTree = ts.createSourceFile("audio.ts", read("hooks/useAudioSettings.ts"), ts.ScriptTarget.Latest, true);
const constraints = audioTree.statements.find((node) => ts.isFunctionDeclaration(node)
  && node.name?.text === "buildAudioTrackConstraints");
assert.ok(constraints);
const audio = compile(constraints.getText(audioTree), {}, { DEFAULT_AUDIO_DEVICE_ID: "default" });

// Reuse the accepted voice-recording-intent VM pattern, but include the actual
// pointer entry and timer: duplicating a bare hook call is not a consumer probe.
function consumerSource() {
  const tree = ts.createSourceFile("MessageInput.tsx", inputSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "MessageInput");
  assert.ok(component?.body);
  const names = new Set([
    "voiceHoldActive", "holdRecorderState", "recordingPreview", "voiceHold", "recorderMode",
    "modeFeedbackTimerRef", "touchHoldTimerRef", "touchRecordingStartedRef", "touchLongPressTriggeredRef",
    "touchPointerMovedRef", "voiceHoldActiveRef", "voiceHoldIntentRef", "voicePendingStopRef",
    "videoHoldActiveRef", "holdRecorderStateRef", "recorderPointerStartRef", "recorderPointerDownAtRef",
    "recorderPointerIdRef", "recordingStartedAtRef", "recordingPreviewUrlRef", "pausedRecordingRef",
    "composerSendScopeRef", "composerSendScope", "voiceRecordingScopeTokenRef",
    "videoRecordingScopeTokenRef", "delayedAttachmentScopeTokenRef", "sheetScopeTokenRef",
    "setActiveHoldRecorder", "clearActiveHoldRecorder", "startVoiceHoldRecording", "stopVoiceHoldRecording",
    "startRecorderHold", "cancelRecorderHold", "handleRecorderPointerDown",
  ]);
  const selectedNames = new Set();
  const statements = component.body.statements.filter((node) => {
    if (ts.isVariableStatement(node)) {
      return node.declarationList.declarations.some((declaration) => {
        const name = ts.isArrayBindingPattern(declaration.name)
          ? declaration.name.elements[0].name.getText(tree) : declaration.name.getText(tree);
        if (!names.has(name)) return false;
        selectedNames.add(name);
        return true;
      });
    }
    if (ts.isIfStatement(node)) return node.expression.getText(tree) === "!composerSendScopeRef.current";
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    const deps = call.arguments[1]?.getText(tree);
    return (call.expression.getText(tree) === "useLayoutEffect" && deps?.includes("chatId, userId, topicId"))
      || (call.expression.getText(tree) === "useEffect"
        && ["[voiceHold.cancel]", "[voiceHoldActive]", "[holdRecorderState]", "[voiceHold.error]"].includes(deps)
        && !call.arguments[0].getText(tree).includes("holdElapsedMs"));
  });
  assert.deepEqual([...selectedNames].sort(), [...names].sort(), "all selected consumer declarations exist");
  const longPress = tree.statements.find((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((item) => item.name.getText(tree) === "MOBILE_RECORDER_LONG_PRESS_MS"));
  assert.ok(longPress);
  return longPress.getText(tree) + "\nexport function useConsumer({ chatId, userId, topicId, onSendVoice }) {\n"
    + statements.map((node) => node.getText(tree)).join("\n")
    + "\nreturn { pointerDown:handleRecorderPointerDown, stop:stopVoiceHoldRecording, cancel:cancelRecorderHold,"
    + "recorder:voiceHold, active:voiceHoldActive, hold:holdRecorderState };\n}";
}

const selectedConsumer = consumerSource();

function fixture(hookText = hookSource, consumerText = selectedConsumer) {
  const slots = [], effects = new Map(), cleanups = new Map();
  const requests = [], tracks = [], sends = [], alerts = [], captures = [];
  const intervals = new Set(), timeouts = new Map();
  let cursor = 0, dirty = true, mounted = true, view, clock = 1800000000000, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const effect = (layout) => (callback, deps) => {
    const index = cursor++;
    if (!same(slots[index], deps)) { slots[index] = deps; effects.set(index, { callback, layout }); }
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(slots[index], next)) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect: effect(false), useLayoutEffect: effect(true),
  };
  const stream = () => {
    const track = { stops: 0, stop() { this.stops += 1; } };
    tracks.push(track);
    return { track, getTracks() { return [track]; } };
  };
  class FictionalRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, options = {}) { this.stream = stream; this.mimeType = options.mimeType || "audio/webm"; this.state = "inactive"; }
    start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob(["fictional audio"]) }); }
    stop() { this.state = "inactive"; this.onstop?.(); }
  }
  class FictionalDate extends Date { static now() { return clock; } }
  const globals = {
    navigator: { mediaDevices: { getUserMedia(constraints) {
      let resolve, reject;
      const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
      const request = {
        constraints, settled: false,
        resolve() {
          assert.equal(request.settled, false);
          request.settled = true;
          const acquired = stream(); resolve(acquired); return acquired;
        },
        reject(name) {
          assert.equal(request.settled, false);
          request.settled = true;
          const error = new Error("fictional media failure"); error.name = name; reject(error);
        },
      };
      requests.push(request);
      return promise;
    } } },
    MediaRecorder: FictionalRecorder, Date: FictionalDate,
    setInterval() { intervals.add(++timerId); return timerId; }, clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, delay) { const id = ++timerId; timeouts.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    console: { warn() {}, error() {} }, URL: { revokeObjectURL() {} },
  };
  const hook = compile(hookText, {
    react, "@/hooks/useAudioSettings": {
      DEFAULT_AUDIO_DEVICE_ID: "default", buildAudioTrackConstraints: audio.buildAudioTrackConstraints,
      getAudioSettings: () => ({ selectedInputDeviceId: "fictional-input", micInputGain: 1,
        noiseSuppression: true, echoCancellation: true, autoGainControl: true }),
    },
  }, globals);
  const noop = () => {};
  const consumer = compile(consumerText, {}, {
    ...globals, ...react, ...scope, useVoiceRecorder: hook.useVoiceRecorder, isAttachmentBusy: false,
    setShowVoice: noop, setShowCamera: noop, setShowVideoMessage: noop, setShowAttach: noop, setShowEmoji: noop,
    setVideoAutoStart: noop, setVideoAutoAddOnStop: noop, setHoldDy: noop, setCancelArmed: noop,
    setShortHint: noop, setHoldElapsedMs: noop, resetVideoRecorderFlags: noop,
    startVideoHoldRecording() { throw new Error("unexpected video acquisition"); },
    microphonePermissionHelp: () => "fictional permission help", isNativeApp: () => false,
    showAppAlert() { alerts.push(true); }, recordingMinimumMs: gesture.recordingMinimumMs,
  });
  const props = { chatId: "fictional-chat", userId: "fictional-owner", topicId: null,
    onSendVoice(blob, durationMs) { sends.push({ bytes: blob.size, durationMs }); } };
  function flush() {
    for (let turns = 0; mounted && dirty; turns++) {
      assert.ok(turns < 20, "consumer render settles");
      dirty = false; cursor = 0; view = consumer.useConsumer(props);
      const pending = [...effects].sort((a, b) => Number(b[1].layout) - Number(a[1].layout));
      effects.clear();
      for (const [index, item] of pending) { cleanups.get(index)?.(); cleanups.set(index, item.callback()); }
    }
  }
  const drain = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } };
  const event = (pointerType = "mouse") => ({ button: 0, pointerType, pointerId: 7, clientX: 30, clientY: 40,
    preventDefault: noop, currentTarget: { setPointerCapture(id) { captures.push(id); } } });
  flush();
  const result = {
    requests, tracks, sends, alerts, captures, drain, event,
    get view() { flush(); return view; },
    advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timeouts]) {
        if (timer.at <= clock) { timeouts.delete(id); timer.callback(); }
      }
    },
    async close() {
      mounted = false;
      for (const cleanup of cleanups.values()) cleanup?.();
      cleanups.clear();
      for (const request of requests) {
        if (!request.settled) request.resolve();
        await drain();
      }
      assert.equal(intervals.size, 0, "no retained recording timers");
      assert.equal(timeouts.size, 0, "no retained gesture timers");
      assert.ok(tracks.every((track) => track.stops === 1), "every acquired fictional track released exactly once");
    },
  };
  fixtures.add(result);
  return result;
}

function oneRequest(f) {
  assert.equal(f.requests.length, 1, "one live pending gesture must acquire only once");
}

test("successive actual consumer holds acquire once each, after prior tracks stop", async () => {
  const f = fixture();
  for (let hold = 0; hold < 2; hold++) {
    f.view.pointerDown(f.event());
    assert.equal(f.requests.length, hold + 1);
    const acquired = f.requests[hold].resolve(); await f.drain();
    assert.equal(f.view.recorder.state, "recording");
    assert.equal(f.view.active, true);
    f.advance(1000); await f.view.stop(); await f.drain();
    assert.equal(acquired.track.stops, 1);
    assert.equal(f.view.recorder.state, "idle");
    assert.equal(f.sends.length, hold + 1);
  }
  assert.equal(f.requests.length, 2);
});

test("OverconstrainedError permits exactly one fallback, without the selected device or advanced constraints", async () => {
  const f = fixture();
  f.view.pointerDown(f.event()); oneRequest(f);
  f.requests[0].reject("OverconstrainedError"); await f.drain();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].constraints.audio.deviceId.exact, "fictional-input");
  assert.equal(f.requests[0].constraints.audio.sampleRate.ideal, 48000);
  assert.equal(f.requests[1].constraints.audio.deviceId, undefined);
  assert.equal(f.requests[1].constraints.audio.sampleRate, undefined);
  assert.equal(f.requests[1].constraints.audio.sampleSize, undefined);
  f.requests[1].resolve(); await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  assert.equal(f.requests.length, 2);
  f.view.cancel(); await f.drain();
});

test("NotAllowedError has no fallback or acquired stream", async () => {
  const f = fixture();
  f.view.pointerDown(f.event()); oneRequest(f);
  f.requests[0].reject("NotAllowedError"); await f.drain();
  assert.equal(f.requests.length, 1);
  assert.equal(f.tracks.length, 0);
  assert.equal(f.view.recorder.error, "permission_denied");
  assert.equal(f.view.active, false);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.sends.length, 0);
});

test("duplicate touch down before the long-press timer fires still acquires once", async () => {
  const f = fixture();
  const down = f.view.pointerDown, event = f.event("touch");
  down(event); down(event);
  f.advance(319); assert.equal(f.requests.length, 0);
  f.advance(1); oneRequest(f);
  f.requests[0].resolve(); await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  f.view.cancel(); await f.drain();
});

test("duplicate mouse down while acquisition is pending must not acquire again", async () => {
  const f = fixture();
  const down = f.view.pointerDown, event = f.event();
  down(event); oneRequest(f);
  assert.equal(f.requests[0].settled, false);
  down(event);
  assert.equal(f.captures.length, 1, "duplicate delivery is retired before replacing pointer capture");
  oneRequest(f);
  f.requests[0].resolve(); await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  assert.equal(f.view.active, true);
  f.advance(1000); await f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 1, "duplicate press does not retire the original send intent");
});

test("duplicate touch down after long press while acquisition is pending must not acquire again", async () => {
  const f = fixture();
  f.view.pointerDown(f.event("touch")); f.advance(320); oneRequest(f);
  assert.equal(f.requests[0].settled, false);
  f.view.pointerDown(f.event("touch")); f.advance(320);
  assert.equal(f.captures.length, 1);
  oneRequest(f);
  f.requests[0].resolve(); await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  assert.equal(f.view.active, true);
  f.advance(1000); await f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 1);
});

test("cancelled pending hold admits a fresh hold and releases its late old stream", async () => {
  const f = fixture();
  f.view.pointerDown(f.event()); oneRequest(f);
  f.view.cancel(); await f.drain();
  f.view.pointerDown(f.event());
  assert.equal(f.requests.length, 2, "new intent may acquire after cancellation");
  const current = f.requests[1].resolve(); await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  const retired = f.requests[0].resolve(); await f.drain();
  assert.equal(retired.track.stops, 1);
  assert.equal(current.track.stops, 0);
  assert.equal(f.view.active, true);
  f.advance(1000); await f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 1);
  assert.equal(current.track.stops, 1);
});

test("removing the actual active-hold guard reintroduces duplicate pending acquisition", async () => {
  const guarded = "if (voiceHoldActiveRef.current) return;";
  assert.equal(selectedConsumer.split(guarded).length - 1, 1);
  const mutant = selectedConsumer.replace(guarded, "");
  for (const pointerType of ["mouse", "touch"]) {
    const f = fixture(hookSource, mutant);
    f.view.pointerDown(f.event(pointerType));
    if (pointerType === "touch") f.advance(320);
    oneRequest(f);
    f.view.pointerDown(f.event(pointerType));
    if (pointerType === "touch") f.advance(320);
    assert.throws(() => oneRequest(f), { code: "ERR_ASSERTION", actual: 2, expected: 1 });
    await f.close(); fixtures.delete(f);
  }
});

test("duplicate pointer down after the recorder starts does not reacquire", async () => {
  const f = fixture();
  f.view.pointerDown(f.event()); oneRequest(f);
  f.requests[0].resolve(); await f.drain();
  f.view.pointerDown(f.event()); await f.drain();
  oneRequest(f);
  assert.equal(f.view.recorder.state, "recording");
  f.view.cancel(); await f.drain();
});

test("a compiled generic extra-call mutation calibrates the counter, not an OS permission prompt", async () => {
  const needle = "    let stream: MediaStream | null = null;";
  assert.equal(hookSource.split(needle).length - 1, 1);
  const mutant = hookSource.replace(needle,
    "    void navigator.mediaDevices.getUserMedia({ audio: true }).then(releaseStream);\n" + needle);
  const f = fixture(mutant);
  f.view.pointerDown(f.event());
  assert.equal(f.requests.length, 2);
  assert.throws(() => oneRequest(f), { code: "ERR_ASSERTION", actual: 2, expected: 1 });
  f.requests[0].resolve(); f.requests[1].resolve(); await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  f.view.cancel(); await f.drain();
});
