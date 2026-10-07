import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
const hookSource = read("hooks/useVoiceRecorder.ts");
const inputSource = read("components/chat/MessageInput.tsx");
const fixtures = new Set();
test.afterEach(async () => {
  for (const fixture of fixtures) await fixture.close();
  fixtures.clear();
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
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected import ${name}`); return imports[name]; },
    ...globals,
  });
  return module.exports;
}

const scopeModule = compile(read("lib/composerSendScope.ts"));
const gesture = compile(read("lib/recordingGesture.ts"));
const audioTree = ts.createSourceFile("audio.ts", read("hooks/useAudioSettings.ts"), ts.ScriptTarget.Latest, true);
const constraints = audioTree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "buildAudioTrackConstraints");
assert.ok(constraints);
const audio = compile(constraints.getText(audioTree), {}, { DEFAULT_AUDIO_DEVICE_ID: "default" });

// Select unchanged AST statements from the real consumer, including its refs,
// scope lifecycle, error effect and async callbacks. Only unrelated UI/services
// are omitted; no consumer callback body is rewritten for the fixture.
function consumerSource(source) {
  const tree = ts.createSourceFile("MessageInput.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "MessageInput");
  assert.ok(component?.body);
  const names = new Set([
    "voiceHoldActive", "holdRecorderState", "recordingPreview", "voiceHold",
    "modeFeedbackTimerRef", "touchHoldTimerRef", "voiceHoldActiveRef", "voiceHoldIntentRef", "voicePendingStopRef",
    "videoHoldActiveRef", "holdRecorderStateRef", "recorderPointerStartRef", "recorderPointerDownAtRef",
    "recordingStartedAtRef", "recordingPreviewUrlRef", "pausedRecordingRef",
    "composerSendScopeRef", "composerSendScope", "voiceRecordingScopeTokenRef",
    "videoRecordingScopeTokenRef", "delayedAttachmentScopeTokenRef", "sheetScopeTokenRef",
    "setActiveHoldRecorder", "clearActiveHoldRecorder", "lockActiveRecording",
    "startVoiceHoldRecording", "stopVoiceHoldRecording", "cancelRecorderHold",
    "pauseLockedRecording", "sendLockedRecording",
  ]);
  const statements = component.body.statements.filter((node) => {
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((declaration) => {
      const name = ts.isArrayBindingPattern(declaration.name) ? declaration.name.elements[0].name.getText(tree) : declaration.name.getText(tree);
      return names.has(name);
    });
    if (ts.isIfStatement(node)) return node.expression.getText(tree) === "!composerSendScopeRef.current";
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    const deps = call.arguments[1]?.getText(tree);
    return (call.expression.getText(tree) === "useLayoutEffect" && deps?.includes("chatId, userId, topicId"))
      || (call.expression.getText(tree) === "useEffect" && ["[voiceHold.cancel]", "[voiceHoldActive]", "[holdRecorderState]", "[voiceHold.error]"].includes(deps)
        && !call.arguments[0].getText(tree).includes("holdElapsedMs"));
  });
  assert.ok(statements.some((node) => node.getText(tree).includes("const pauseLockedRecording")));
  return "export function useConsumer({ chatId, userId, topicId, onSendVoice }) {\n"
    + statements.map((node) => node.getText(tree)).join("\n")
    + "\nreturn { start:startVoiceHoldRecording, stop:stopVoiceHoldRecording, cancel:cancelRecorderHold,"
    + "pause:pauseLockedRecording, send:sendLockedRecording, lock:lockActiveRecording, recorder:voiceHold,"
    + "active:voiceHoldActive, hold:holdRecorderState, preview:recordingPreview, get token() { return voiceRecordingScopeTokenRef.current; } };\n}";
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture({ hookText = hookSource, inputText = inputSource } = {}) {
  const slots = [], effects = new Map(), cleanups = new Map();
  const requests = [], tracks = [], intervals = new Set(), stops = [], sends = [], alerts = [], urls = new Set();
  let cursor = 0, dirty = true, mounted = true, view, clock = 1800000000000, timerId = 0, holdStops = false, sendGate;
  let props = { chatId: "fictional-chat-A", userId: "fictional-owner-A", topicId: null };
  const sendFor = (chatId) => (blob, durationMs, mimeType) => {
    sends.push({ chatId, blob, durationMs, mimeType });
    return sendGate?.promise;
  };
  props.onSendVoice = sendFor(props.chatId);
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
    stop() { this.state = "inactive"; if (holdStops) stops.push(this); else this.onstop?.(); }
  }
  class FictionalDate extends Date { static now() { return clock; } }
  const globals = {
    navigator: { mediaDevices: { getUserMedia(constraints) {
      const pending = deferred();
      const request = { constraints, settled: false,
        resolve(value = stream()) { request.settled = true; pending.resolve(value); return value; },
        reject(name) { request.settled = true; const error = new Error("fictional media failure"); error.name = name; pending.reject(error); },
      };
      requests.push(request);
      return pending.promise;
    } } },
    MediaRecorder: FictionalRecorder, Date: FictionalDate,
    setInterval() { intervals.add(++timerId); return timerId; }, clearInterval(id) { intervals.delete(id); },
    clearTimeout() {}, console: { warn() {}, error() {} },
    URL: {
      createObjectURL() { const url = `blob:fictional-${urls.size + 1}`; urls.add(url); return url; },
      revokeObjectURL(url) { urls.delete(url); },
    },
  };
  const hookModule = compile(hookText, {
    react, "@/hooks/useAudioSettings": {
      DEFAULT_AUDIO_DEVICE_ID: "default", buildAudioTrackConstraints: audio.buildAudioTrackConstraints,
      getAudioSettings: () => ({ selectedInputDeviceId: "fictional-input", micInputGain: 1,
        noiseSuppression: true, echoCancellation: true, autoGainControl: true }),
    },
  }, globals);
  const noop = () => {};
  const consumerModule = compile(consumerSource(inputText), {}, {
    ...globals, ...react, ...scopeModule, useVoiceRecorder: hookModule.useVoiceRecorder,
    setShowVoice: noop, setShowCamera: noop, setShowVideoMessage: noop, setShowAttach: noop, setShowEmoji: noop,
    setVideoAutoStart: noop, setVideoAutoAddOnStop: noop, setHoldDy: noop, setCancelArmed: noop,
    setShortHint: noop, setHoldElapsedMs: noop, resetVideoRecorderFlags: noop,
    stopVideoHoldRecording() { throw new Error("unexpected video"); },
    microphonePermissionHelp: () => "fictional permission help", isNativeApp: () => false,
    showAppAlert(message) { alerts.push(message); }, recordingMinimumMs: gesture.recordingMinimumMs,
  });
  function flush() {
    for (let turns = 0; mounted && dirty; turns++) {
      assert.ok(turns < 20, "consumer render settles");
      dirty = false; cursor = 0; view = consumerModule.useConsumer(props);
      const pending = [...effects].sort((a, b) => Number(b[1].layout) - Number(a[1].layout));
      effects.clear();
      for (const [index, item] of pending) { cleanups.get(index)?.(); cleanups.set(index, item.callback()); }
    }
  }
  const drain = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } };
  flush();
  const result = {
    requests, tracks, sends, alerts, urls, drain, stream,
    get view() { flush(); return view; },
    advance(ms) { clock += ms; },
    holdStops() { holdStops = true; },
    releaseStops() {
      holdStops = false;
      for (const recorder of stops.splice(0)) {
        recorder.ondataavailable?.({ data: new Blob(["fictional delayed final chunk"]) });
        recorder.onstop?.();
      }
    },
    holdSend() { sendGate = deferred(); return sendGate; },
    switchScope(next) {
      props = { ...props, ...next };
      props.onSendVoice = sendFor(props.chatId);
      dirty = true; flush();
    },
    unmount() {
      mounted = false;
      for (const cleanup of cleanups.values()) cleanup?.();
      cleanups.clear();
    },
    async close() {
      result.unmount();
      for (let index = 0; index < requests.length; index++) {
        if (!requests[index].settled) requests[index].resolve();
        await drain();
      }
      result.releaseStops();
      assert.equal(intervals.size, 0, "no retained recording timers");
      assert.ok(tracks.every((track) => track.stops === 1), "all fictional acquired tracks released exactly once");
    },
  };
  fixtures.add(result);
  return result;
}

async function begin(f) {
  const pending = f.view.start();
  const acquired = f.requests.at(-1).resolve();
  await pending; await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  assert.equal(f.view.active, true, "new hold must remain active while its recorder starts");
  return acquired;
}

async function staleFallback(options = {}, unmount = false) {
  const f = fixture(options);
  const pending = f.view.start();
  if (unmount) f.unmount(); else f.view.cancel();
  f.requests[0].reject("OverconstrainedError"); await f.drain();
  assert.equal(f.requests.length, 1, "retired acquisition must not issue a fallback request");
  await pending;
}

async function restartDuringOldStart(options = {}, rejection = false, scope) {
  const f = fixture(options);
  const old = f.view.start();
  f.view.cancel();
  if (scope) f.switchScope(scope);
  const latest = f.view.start();
  if (rejection) f.requests[0].reject("NotAllowedError"); else f.requests[0].resolve();
  await old; await f.drain();
  assert.equal(f.view.active, true, "retired start must not clear the new hold");
  assert.equal(f.view.hold?.phase, "holding");
  f.requests[1].resolve(); await latest; await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  assert.equal(f.view.active, true);
  assert.equal(f.alerts.length, 0, "retired failure must not display an app error");
}

async function restartDuringNullStop(options = {}, scope) {
  const f = fixture(options);
  const oldStart = f.view.start();
  const oldStop = f.view.stop();
  if (scope) f.switchScope(scope);
  const latest = f.view.start();
  assert.equal(f.requests.length, 2, "null stop must allow a newer independent acquisition");
  await oldStop;
  f.requests[0].resolve(); await oldStart;
  f.requests[1].resolve(); await latest; await f.drain();
  assert.equal(f.view.recorder.state, "recording", "retired null stop must not cancel the new acquisition");
  assert.equal(f.view.active, true);
  assert.equal(f.view.hold?.phase, "holding");
}

async function restartDuringPause(options = {}, scope) {
  const f = fixture(options);
  await begin(f); f.view.lock(); f.advance(1000); f.holdStops();
  const oldPause = f.view.pause();
  f.view.cancel();
  if (scope) f.switchScope(scope);
  await begin(f);
  await oldPause; await f.drain(); f.releaseStops();
  assert.equal(f.view.recorder.state, "recording", "retired pause must not cancel the new recorder");
  assert.equal(f.view.active, true);
  assert.equal(f.view.hold?.phase, "holding");
  assert.equal(f.view.preview, null);
}

async function restartDuringSend(options = {}) {
  const f = fixture(options);
  await begin(f); f.advance(1000);
  const gate = f.holdSend();
  const oldSend = f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 1);
  await begin(f);
  gate.resolve(); await oldSend; await f.drain();
  assert.ok(f.view.token, "old send acknowledgement must preserve the new hold token");
  f.advance(1000); await f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 2, "both real holds send exactly once");
}

async function retiredRecorderEvents(options = {}) {
  const f = fixture(options);
  await begin(f); f.view.lock(); f.holdStops();
  const oldPause = f.view.pause(); f.view.cancel();
  await begin(f); await oldPause; await f.drain();
  f.releaseStops(); await f.drain();
  assert.equal(f.view.recorder.state, "recording", "old stop event must not tear down the new recorder");
  f.advance(1000); await f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 1);
  assert.equal(await f.sends[0].blob.text(), "fictional audio", "old data event must not enter the new blob");
}

async function delayedNormalStop(options = {}) {
  const f = fixture(options);
  await begin(f); f.advance(1000); f.holdStops();
  const starter = f.view.start, token = f.view.token;
  const first = f.view.stop();
  // Call the captured starter in the same event turn, before a render can fence it.
  const ignored = starter();
  assert.equal(f.view.active, false, "pending normal stop ignores a new hold before UI changes");
  assert.equal(f.view.hold, null);
  assert.equal(f.view.token, token, "pending normal stop preserves the first hold token");
  assert.equal(f.requests.length, 1);
  await ignored; await f.drain();
  f.releaseStops(); await first; await f.drain();
  assert.equal(f.sends.length, 1, "first normal stop still sends after its delayed onstop");
  assert.equal(await f.sends[0].blob.text(), "fictional audiofictional delayed final chunk");
  const latest = f.view.start();
  assert.equal(f.requests.length, 2, "settled stop permits independent microphone reacquisition");
  f.requests[1].resolve(); await latest; await f.drain();
  f.advance(1000); await f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 2, "both accepted normal holds send exactly once");
}

async function stoppingHookStart(options = {}) {
  const f = fixture(options); await begin(f); f.advance(1000); f.holdStops();
  const pending = f.view.recorder.stop(); await f.drain();
  assert.equal(await f.view.recorder.start(), false, "stopping hook recorder cannot report a successful start");
  assert.equal(f.requests.length, 1);
  f.releaseStops(); const result = await pending; await f.drain();
  assert.ok(result?.blob.size, "stopping recorder retains its final data"); f.view.cancel();
}

async function retiredNormalStop(options = {}, scope = false) {
  const f = fixture(options); const oldTrack = await begin(f); f.advance(1000); f.holdStops();
  const first = f.view.stop(); await f.drain();
  if (scope) f.switchScope({ chatId: "fictional-chat-B" }); else f.view.cancel();
  assert.equal(oldTrack.track.stops, 1, "cancel or scope change releases the old stopping tracks");
  const latest = f.view.start();
  assert.equal(f.requests.length, 2, "cancel or scope change releases the pending-stop starter lease");
  f.requests[1].resolve(); await latest; await first; await f.drain();
  f.releaseStops(); await f.drain();
  assert.equal(f.view.recorder.state, "recording", "retired normal stop cannot end the successor recorder");
  f.advance(1000); await f.view.stop(); await f.drain();
  assert.equal(f.sends.length, 1, "cancelled normal stop sends nothing; successor sends once");
  assert.equal(f.sends[0].chatId, scope ? "fictional-chat-B" : "fictional-chat-A");
  assert.equal(await f.sends[0].blob.text(), "fictional audio");
}

async function sharedPauseSend(options = {}, secondTap = true) {
  const f = fixture(options); await begin(f); f.view.lock(); f.advance(1000); f.holdStops();
  const pause = f.view.pause(), gate = f.holdSend(), firstSend = f.view.send();
  f.releaseStops(); await pause; await f.drain();
  const secondSend = secondTap ? f.view.send() : Promise.resolve(); await f.drain();
  try {
    assert.equal(f.sends.length, 1, "shared locked pause/send has exactly one send while ACK is held");
    assert.equal(f.view.preview, null, "submitted clip cannot be republished as a paused preview");
    assert.equal(f.view.hold, null, "submitted clip cannot restore a paused row");
    assert.equal(f.urls.size, 0, "submitted clip retains no preview URL");
  } finally {
    gate.resolve(); await firstSend; await secondSend; await f.drain();
  }
  assert.equal(f.view.preview, null, "submitted clip stays absent after send ACK");
  assert.equal(f.view.hold, null);
  assert.equal(f.sends[0].durationMs, 1000);
  assert.equal(await f.sends[0].blob.text(), "fictional audiofictional delayed final chunk");
}

function omitOnce(source, before, after = "") {
  assert.equal(source.split(before).length - 1, 1, "mutant targets exactly one source rule");
  return source.replace(before, after);
}

test("sequential hook recordings reacquire only after releasing the previous tracks", async () => {
  const f = fixture();
  const a = await begin(f); f.advance(1000);
  const first = await f.view.recorder.stop(); await f.drain();
  assert.equal(first.durationMs, 1000); assert.equal(first.blob.size, 15);
  assert.equal(a.track.stops, 1); assert.equal(f.view.recorder.state, "idle");
  const b = await begin(f); f.view.cancel(); await f.drain();
  assert.equal(b.track.stops, 1); assert.equal(f.requests.length, 2);
});

test("normal hold release sends once, then a new hold records and sends independently", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) { const acquired = await begin(f); f.advance(1000); await f.view.stop(); await f.drain(); assert.equal(acquired.track.stops, 1); }
  assert.equal(f.requests.length, 2); assert.equal(f.sends.length, 2);
  assert.equal(f.view.active, false); assert.equal(f.view.hold, null);
});

test("current constraint failure still retries the default microphone and releases it", async () => {
  const f = fixture(); const pending = f.view.start();
  f.requests[0].reject("OverconstrainedError"); await f.drain();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].constraints.audio.deviceId.exact, "fictional-input");
  assert.equal(f.requests[1].constraints.audio.deviceId, undefined);
  assert.equal(f.requests[1].constraints.audio.sampleRate, undefined);
  const acquired = f.requests[1].resolve(); await pending; await f.drain();
  assert.equal(f.view.recorder.state, "recording");
  f.view.cancel(); assert.equal(acquired.track.stops, 1);
});

test("cancelled pending constraint failure does not acquire again", () => staleFallback());
test("unmounted pending constraint failure does not acquire again", () => staleFallback({}, true));
test("old successful acquisition after cancel preserves the new same-chat hold", () => restartDuringOldStart());
test("old denied acquisition after cancel preserves the new same-chat hold", () => restartDuringOldStart({}, true));
test("old null stop cannot cancel a newer same-chat acquisition", () => restartDuringNullStop());
test("old null stop cannot cancel a newer changed-chat acquisition", () => restartDuringNullStop({}, { chatId: "fictional-chat-B" }));
test("old pause cannot clear or cancel a newer same-chat hold", () => restartDuringPause());
test("old pause cannot clear or cancel a newer changed-chat hold", () => restartDuringPause({}, { chatId: "fictional-chat-B" }));
test("old send acknowledgement cannot erase a newer same-chat hold token", () => restartDuringSend());
test("retired recorder final data and stop events cannot contaminate or end a new recording", () => retiredRecorderEvents());
for (const [name, next] of [
  ["chat", { chatId: "fictional-chat-B" }],
  ["owner", { userId: "fictional-owner-B" }],
  ["topic", { topicId: "fictional-topic-B" }],
]) {
  test(`old acquisition preserves the new hold after ${name} scope changes`, () => restartDuringOldStart({}, false, next));
}

test("locked recording pauses with tracks closed and sends the retained blob, not a retained microphone", async () => {
  const f = fixture(); const acquired = await begin(f); f.view.lock(); f.advance(1000);
  await f.view.pause(); await f.drain();
  assert.equal(acquired.track.stops, 1); assert.equal(f.view.hold?.phase, "paused");
  assert.equal(f.view.recorder.state, "idle"); assert.equal(f.view.active, false);
  assert.equal(f.urls.size, 1); await f.view.send(); await f.drain();
  assert.equal(f.sends.length, 1); assert.equal(f.urls.size, 0); assert.equal(f.requests.length, 1);
});

test("short recordings close tracks without sending", async () => {
  const f = fixture(); const acquired = await begin(f); f.advance(100);
  await f.view.stop(); await f.drain();
  assert.equal(acquired.track.stops, 1); assert.equal(f.sends.length, 0); assert.equal(f.view.hold, null);
});

test("current permission failure displays one app error without recording or sending", async () => {
  const f = fixture(); const pending = f.view.start();
  f.requests[0].reject("NotAllowedError"); await pending; await f.drain();
  assert.equal(f.requests.length, 1); assert.equal(f.alerts.length, 1);
  assert.equal(f.view.recorder.state, "idle"); assert.equal(f.view.hold, null); assert.equal(f.sends.length, 0);
});

test("scope cleanup retires a locked pause before a new owner begins recording", () => restartDuringPause({}, { userId: "fictional-owner-B" }));
test("delayed normal stop preserves its send and ignores synchronous replacement holds", () => delayedNormalStop());
test("direct hook start refuses a recorder waiting for its stop event", () => stoppingHookStart());
test("explicit cancel retires a normal stop and permits an independent hold", () => retiredNormalStop());
test("scope change retires a normal stop and permits an independent hold", () => retiredNormalStop({}, true));
test("locked pause followed by send before shared onstop cannot send twice while ACK is held", () => sharedPauseSend());
test("locked pause followed by send before shared onstop cannot republish a sent preview", () => sharedPauseSend({}, false));

// Each mutant is independently transpiled and executed. Literal behavior oracles,
// not the presence of a guard in source text, must reject the omitted rule.
const mutants = [
  ["send supersedes pending pause completion", () => ({ inputText: omitOnce(inputSource,
    "    // Sending takes completion authority away from any pending locked pause.\n    voiceHoldIntentRef.current += 1;\n",
    "") }), sharedPauseSend, "shared locked pause/send has exactly one send while ACK is held"],
  ["pending permission is not a stopping recorder", () => ({ hookText: omitOnce(hookSource,
    "const hasRecorder = useCallback(() => recorderRef.current !== null, []);",
    "const hasRecorder = useCallback(() => true, []);") }), restartDuringNullStop,
    "null stop must allow a newer independent acquisition"],
  ["synchronous pending-stop starter guard", () => ({ inputText: omitOnce(inputSource,
    "    if (voicePendingStopRef.current) return;\n") }), delayedNormalStop, "pending normal stop ignores a new hold before UI changes"],
  ["pending-stop lease acquisition", () => ({ inputText: omitOnce(inputSource,
    "    voicePendingStopRef.current = pendingStop;\n") }), delayedNormalStop, "pending normal stop ignores a new hold before UI changes"],
  ["pending-stop lease settlement", () => ({ inputText: omitOnce(inputSource,
    "      if (voicePendingStopRef.current === pendingStop) voicePendingStopRef.current = null;\n") }), delayedNormalStop,
    "settled stop permits independent microphone reacquisition"],
  ["pending-stop explicit cancellation", () => ({ inputText: omitOnce(inputSource,
    "    const pendingStop = voicePendingStopRef.current;\n    voicePendingStopRef.current = null;",
    "    const pendingStop = voicePendingStopRef.current;") }), retiredNormalStop,
    "cancel or scope change releases the pending-stop starter lease"],
  ["pending stopping-recorder cancellation", () => ({ inputText: omitOnce(inputSource,
    "if (voiceHoldActiveRef.current || pendingStop)", "if (voiceHoldActiveRef.current)") }), retiredNormalStop,
    "cancel or scope change releases the old stopping tracks"],
  ["pending-stop scope retirement", () => ({ inputText: omitOnce(inputSource,
    "      voicePendingStopRef.current = null;\n      composerSendScope.invalidate();",
    "      composerSendScope.invalidate();") }), options => retiredNormalStop(options, true),
    "cancel or scope change releases the pending-stop starter lease"],
  ["stopping hook refuses false start", () => ({ hookText: omitOnce(hookSource,
    'return recorderRef.current.state === "recording" && !stopResolverRef.current;', "return true;") }), stoppingHookStart,
    "stopping hook recorder cannot report a successful start"],
  ["pre-fallback stale guard", () => ({ hookText: omitOnce(hookSource, "        if (isStale()) return false;\n") }), staleFallback, "retired acquisition must not issue a fallback request"],
  ["retired final-data guard", () => ({ hookText: omitOnce(hookSource,
    "    recorder.ondataavailable = (e) => {\n      if (isStale() || recorderRef.current !== recorder) return;",
    "    recorder.ondataavailable = (e) => {") }), retiredRecorderEvents, "old data event must not enter the new blob"],
  ["retired stop-event guard", () => ({ hookText: omitOnce(hookSource,
    "    recorder.onstop = () => {\n      if (isStale() || recorderRef.current !== recorder) return;",
    "    recorder.onstop = () => {") }), retiredRecorderEvents, "old stop event must not tear down the new recorder"],
  ["new hold generation", () => ({ inputText: omitOnce(inputSource,
    "const intent = ++voiceHoldIntentRef.current;", "const intent = voiceHoldIntentRef.current;") }), restartDuringNullStop, "retired null stop must not cancel the new acquisition"],
  ["start completion intent guard", () => ({ inputText: omitOnce(inputSource,
    "voiceHoldIntentRef.current !== intent || !voiceHoldActiveRef.current || !composerSendScope.isActive(scopeToken)",
    "!composerSendScope.isActive(scopeToken)") }), restartDuringOldStart, "retired start must not clear the new hold"],
  ["null-stop intent guard", () => ({ inputText: omitOnce(inputSource,
    "voiceHoldIntentRef.current !== intent || !scopeToken || !composerSendScope.isActive(scopeToken)",
    "!scopeToken || !composerSendScope.isActive(scopeToken)") }), restartDuringNullStop, "retired null stop must not cancel the new acquisition"],
  ["send ACK intent guard", () => ({ inputText: omitOnce(inputSource,
    "voiceHoldIntentRef.current === intent && composerSendScope.isActive(scopeToken)",
    "composerSendScope.isActive(scopeToken)") }), restartDuringSend, "old send acknowledgement must preserve the new hold token"],
  ["pause completion ownership guard", () => ({ inputText: omitOnce(inputSource,
    "    if (voiceHoldIntentRef.current !== intent || !composerSendScope.isActive(scopeToken)) return;\n") }), restartDuringPause, "new hold must remain active while its recorder starts"],
];
for (const [name, mutate, scenario, oracle] of mutants) {
  test(`compiled omission mutant refused: ${name}`, async () => {
    await scenario();
    const options = mutate();
    await assert.rejects(() => scenario(options), (error) => {
      assert.equal(error.code, "ERR_ASSERTION", "compile/setup failures are not mutation proof");
      assert.equal(error.message.split("\n")[0], oracle, "literal behavior must reject the compiled mutant");
      return true;
    });
  });
}
