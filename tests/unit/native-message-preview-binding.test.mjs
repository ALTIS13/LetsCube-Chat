import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const { createClient } = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url))("@supabase/supabase-js");
const A = "11111111-1111-4111-8111-111111111111", B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S = "22222222-2222-4222-8222-222222222222", T = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const D = "33333333-3333-4333-8333-333333333333", E = "44444444-4444-4444-8444-444444444444";
const tick = async () => { for (let i = 0; i < 160; ++i) await Promise.resolve(); };
const held = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const ack = (user = A, sid = S) => ({ data: [{ recipient_id: user, recipient_session_id: sid }], error: null });
const binding = (user = A, sid = S, device = D) => [{ binding_v: 1, recipient_id: user, session_id: sid, device_id: device }];
const expected = (user = A, sid = S, device = D) => ({ recipientId: user, recipientSessionId: sid, deviceId: device });
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));

// Only SDK, store and platform edges are fictional. All controller/adapter/parser code is loaded.
function fixture(options = {}) {
  let now = 1_000_000, sdkToken = "fictional-sdk-one", timerId = 0, voiceEpoch = 0;
  let auth, storeChanged, runtime, expiredHash = false;
  const timers = new Map(), listeners = new Map(), requests = [], commits = [], messages = [], hashes = new Set();
  const makeSession = (user = A, sid = S, exp = Math.floor((now + (options.sessionTtl ?? 60_000)) / 1000), nonce = "initial") => ({
    user: { id: user }, access_token: `e30.${Buffer.from(JSON.stringify({ sub: user, session_id: sid,
      role: "authenticated", is_anonymous: false, exp, nonce })).toString("base64url")}.fictional`,
  });
  let session = makeSession();
  const state = { currentUser: { id: A }, authSessionIdentity: { userId: A, sessionId: S }, accountEpoch: 1 };
  const events = { addEventListener() {}, removeEventListener() {} };
  const schedule = (fn, ms = 0) => { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; };
  const window = { ...events, androidBridge: { postMessage() {} }, setTimeout: schedule, clearTimeout: id => timers.delete(id), history: { pushState() {} }, dispatchEvent() {} };
  const emit = value => { for (const fn of [...(listeners.get("registration") ?? [])]) fn({ value }); };
  const add = (name, callback) => {
    const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set);
    return Promise.resolve({ remove: async () => { set.delete(callback); } });
  };
  const sdk = createClient("http://binding-fixture.invalid", "fictional-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const name = new URL(url).pathname.split("/").at(-1), args = JSON.parse(init.body);
      requests.push({ name, args, method: init.method, signal: init.signal });
      let result;
      if (name === "register_push_device") result = options.register ? await options.register(args, requests) : ack(state.authSessionIdentity?.userId, state.authSessionIdentity?.sessionId);
      else if (name === "native_push_device_binding") result = options.resolver ? await options.resolver(args, requests) : { data: binding(state.authSessionIdentity?.userId, state.authSessionIdentity?.sessionId), error: null };
      else result = { data: true, error: null };
      if (result.error) return new Response(JSON.stringify(result.error), { status: 400, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify(result.data), { status: 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  const supabase = {
    rpc: (...args) => sdk.rpc(...args),
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: callback => { auth = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from: table => {
      assert.equal(table, "notification_preferences");
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { push_enabled: true }, error: null }) };
      return query;
    },
  };
  const voice = {
    getCapabilities: async () => ({ protocol: options.legacy ? 0 : 1 }),
    beginBinding: async () => ({ epoch: String(++voiceEpoch) }),
    commitBinding: async value => { commits.push(value); return { applied: value.epoch === String(voiceEpoch) }; },
    clearBinding: async () => { ++voiceEpoch; }, setCallsAllowed: async () => {}, setForegroundRing: async () => {},
    consumePendingAction: async () => ({ event: null }), revalidateConsumedAction: async () => ({ event: null }),
    addListener: add,
  };
  const boundary = {
    "@capacitor/core": { registerPlugin: name => { assert.equal(name, "VoiceCalls"); return voice; } },
    "@capacitor/app": { App: { addListener: add } },
    "@capacitor/push-notifications": { PushNotifications: {
      addListener: add, register: async () => emit(sdkToken), unregister: async () => {},
      checkPermissions: async () => ({ receive: "granted" }), requestPermissions: async () => ({ receive: "granted" }), createChannel: async () => {},
    } },
    [resolve(root, "lib/platform/capabilities.ts")]: { isNativeAndroid: () => options.native !== false,
      supportsCapacitorPlugin: name => name === "VoiceCalls" && !options.legacy },
    [resolve(root, "lib/supabase/client.ts")]: { createClient: () => supabase },
    [resolve(root, "lib/monitoring.ts")]: { getBuildMetadata: () => ({ version: "fictional" }) },
    [resolve(root, "lib/safeOpenChat.ts")]: { safeOpenChat: async () => true },
    [resolve(root, "store/app.store.ts")]: { useAppStore: { getState: () => state, subscribe: callback => { storeChanged = callback; return () => {}; } } },
  };
  const modules = new Map();
  function load(file) {
    if (boundary[file]) return boundary[file];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    let text = readFileSync(file, "utf8").replaceAll("import.meta.env.BASE_URL", '"/"');
    if (options.transform) text = options.transform(file, text);
    const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, window, document: { ...events, visibilityState: "visible" },
      navigator: { userAgent: "fictional" }, atob, TextEncoder, AbortController, URLSearchParams,
      setTimeout: schedule, clearTimeout: id => timers.delete(id), Date: class extends Date { static now() { return now; } },
      crypto: { subtle: { digest: async (...args) => {
        if (expiredHash) throw new Error("fictional hash failure");
        const pending = webcrypto.subtle.digest(...args); hashes.add(pending);
        try { return await pending; } finally { hashes.delete(pending); }
      } } },
      PopStateEvent: class {}, console: { error: () => messages.push("error"), warn: () => messages.push("warn") },
      require: name => {
        if (boundary[name]) return boundary[name];
        assert(name.startsWith("."), "no unowned dependency");
        return load(resolve(dirname(file), name.endsWith(".ts") ? name : `${name}.ts`));
      },
    }, { filename: file });
    if (file === resolve(root, "lib/platform/nativeVoiceController.ts")) {
      const create = module.exports.createNativeVoiceController;
      module.exports.createNativeVoiceController = deps => { runtime = create(deps); return runtime; };
    }
    return module.exports;
  }
  const calls = load(resolve(root, "lib/platform/nativeVoiceCalls.ts"));
  let dispose;
  const flush = async () => {
    for (let turn = 0; turn < 25; ++turn) {
      await tick();
      const due = [...timers].filter(([, entry]) => entry.due <= now);
      for (const [id, entry] of due) { if (timers.delete(id)) entry.fn(); }
      if (hashes.size) { await Promise.allSettled([...hashes]); continue; }
      if (!due.length) break;
    }
    await tick();
  };
  return {
    calls, state, requests, commits, messages, makeSession,
    start: async () => { dispose = calls.startNativeVoiceCalls(); await flush(); },
    snapshot: () => plain(calls.nativeMessagePreviewBindingSnapshot?.() ?? null),
    readNative: () => load(resolve(root, "lib/platform/nativeMessagePreviews.ts")).readNativeMessagePreviewCandidate(),
    reads: () => requests.filter(entry => entry.name === "native_push_device_binding"),
    registrations: () => requests.filter(entry => entry.name === "register_push_device"),
    status: () => calls.nativeVoicePushSnapshot()?.status,
    storeOnly: update => { Object.assign(state, update); storeChanged?.(); },
    signal: value => { session = value; auth("SIGNED_IN", value); },
    change: value => {
      const claims = value && JSON.parse(Buffer.from(value.access_token.split(".")[1], "base64url"));
      state.accountEpoch++;
      state.authSessionIdentity = value ? { userId: value.user.id, sessionId: claims.session_id } : null;
      state.currentUser = value ? { id: value.user.id } : null;
      storeChanged?.(); session = value; auth("SIGNED_IN", value);
    },
    rotate: value => { sdkToken = value; emit(value); },
    invalidate: () => runtime.invalidate(),
    hashFailure: () => { expiredHash = true; },
    token: value => { sdkToken = value; },
    advance: async ms => { now += ms; await flush(); }, flush,
    stop: () => { dispose?.(); },
  };
}

async function positive(h) {
  assert.equal(h.status(), "native_active", "ordinary success is independent");
  assert.equal(h.reads().length, 1, "resolver must follow genuine ACK");
  assert.equal(h.reads()[0].method, "POST");
  assert.deepEqual(Object.keys(h.reads()[0].args), ["p_token_hash"]);
  assert.match(h.reads()[0].args.p_token_hash, /^[0-9a-f]{64}$/);
  assert.equal(h.reads()[0].args.p_token_hash, createHash("sha256").update("fictional-sdk-one", "utf8").digest("hex"));
  assert.deepEqual(h.snapshot(), expected());
  assert.equal(await h.readNative(), null, "JS candidate cannot impersonate absent native plugin");
}

test("RED: genuine eight-arg ACK starts separate exact resolver POST, never native capability", async () => {
  const h = fixture(); try { await h.start(); await positive(h); assert.equal(h.registrations().length, 1); } finally { h.stop(); }
});
test("control: legacy shell ordinary success stays seven args and no resolver", async () => {
  const h = fixture({ legacy: true }); try {
    await h.start(); assert.equal(h.status(), "native_active"); assert.equal(Object.keys(h.registrations()[0].args).length, 7);
    assert.equal(h.reads().length, 0); assert.equal(h.snapshot(), null);
  } finally { h.stop(); }
});
test("control: browser never registers, resolves or gains native binding", async () => {
  const h = fixture({ native: false }); try { await h.start(); assert.equal(h.requests.length, 0); assert.equal(h.snapshot(), null); } finally { h.stop(); }
});
test("RED: held resolver cannot delay ordinary native_active or voice commit", async () => {
  const response = held(), h = fixture({ resolver: () => response.promise }); try {
    await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.commits.length, 1);
    assert.equal(h.reads().length, 1); assert.equal(h.snapshot(), null);
    response.resolve({ data: binding(), error: null }); await h.flush(); await positive(h);
  } finally { h.stop(); }
});
test("held registration ACK must precede any resolver dispatch", async () => {
  const response = held(), h = fixture({ register: () => response.promise }); try {
    await h.start(); assert.equal(h.reads().length, 0);
    response.resolve(ack()); await h.flush(); await positive(h);
  } finally { h.stop(); }
});

for (const order of ["old-first", "new-first"]) {
  test(`held resolvers on owner switch: ${order} cannot retire or replace newest candidate`, async () => {
    const old = held(), next = held(); let count = 0;
    const h = fixture({ resolver: () => ++count === 1 ? old.promise : next.promise }); try {
      await h.start(); h.change(h.makeSession(B, T)); assert.equal(h.snapshot(), null); await h.flush();
      const finishOld = async () => { old.resolve({ data: binding(), error: null }); await h.flush(); };
      const finishNew = async () => { next.resolve({ data: binding(B, T, E), error: null }); await h.flush(); };
      if (order === "old-first") { await finishOld(); assert.equal(h.snapshot(), null); await finishNew(); }
      else { await finishNew(); await finishOld(); }
      assert.deepEqual(h.snapshot(), expected(B, T, E)); assert.equal(h.registrations().length, 2);
    } finally { h.stop(); }
  });
  test(`held ACK on owner switch: ${order} never resolves old registration`, async () => {
    const old = held(), next = held(); let count = 0;
    const h = fixture({ register: () => ++count === 1 ? old.promise : next.promise }); try {
      await h.start(); h.change(h.makeSession(B, T)); await h.flush();
      if (order === "old-first") { old.resolve(ack()); await h.flush(); next.resolve(ack(B, T)); }
      else { next.resolve(ack(B, T)); await h.flush(); old.resolve(ack()); }
      await h.flush(); assert.equal(h.reads().length, 1); assert.deepEqual(h.snapshot(), expected(B, T));
    } finally { h.stop(); }
  });
}

async function rotation(transform) {
  const old = held(), second = held(), h = fixture({ transform,
    register: (_args, requests) => requests.filter(r => r.name === "register_push_device").length === 2 ? second.promise : ack(),
    resolver: (_args, requests) => requests.filter(r => r.name === "native_push_device_binding").length === 1 ? old.promise : { data: binding(A, S, E), error: null },
  });
  try {
    await h.start(); h.rotate("fictional-sdk-two"); await h.flush();
    h.rotate("fictional-sdk-three"); old.resolve({ data: binding(), error: null }); await h.flush();
    assert.equal(h.snapshot(), null, "queued rotation fences old-token late response before next registration ACK");
    second.resolve(ack()); await h.flush();
    assert.equal(h.registrations().length, 3); assert.equal(h.reads().length, 2);
    assert.deepEqual(h.snapshot(), expected(A, S, E));
  } finally { h.stop(); }
}
test("queued token rotation immediately fences old resolver without changing ordinary registration drain", () => rotation());

async function queuedAck(transform) {
  const first = held(), next = held(); let count = 0;
  const h = fixture({ transform, register: () => ++count === 1 ? first.promise : next.promise });
  try {
    await h.start(); h.rotate("fictional-sdk-two"); first.resolve(ack()); await h.flush();
    assert.equal(h.registrations().length, 2);
    assert.equal(h.reads().length, 0, "old token ACK cannot dispatch while rotation waits in same generation");
    next.resolve(ack()); await h.flush(); assert.equal(h.reads().length, 1); assert.deepEqual(h.snapshot(), expected());
  } finally { h.stop(); }
}
test("queued rotation before old ACK refuses old hash before any resolver dispatch", () => queuedAck());

for (const boundary of ["epoch", "owner", "sid", "logout", "disable", "invalidate", "dispose", "expiry"]) {
  test(`candidate synchronously retires at ${boundary}; late read cannot resurrect it`, async () => {
    const response = held(), h = fixture({ resolver: () => response.promise }); try {
      await h.start();
      if (boundary === "epoch") h.storeOnly({ accountEpoch: 2 });
      if (boundary === "owner") h.storeOnly({ currentUser: { id: B }, authSessionIdentity: { userId: B, sessionId: S } });
      if (boundary === "sid") h.storeOnly({ authSessionIdentity: { userId: A, sessionId: T } });
      if (boundary === "logout") h.change(null);
      if (boundary === "disable") await h.calls.disableNativeVoicePush();
      if (boundary === "invalidate") h.invalidate();
      if (boundary === "dispose") h.stop();
      if (boundary === "expiry") await h.advance(60_000);
      response.resolve({ data: binding(), error: null }); await h.flush(); assert.equal(h.snapshot(), null);
    } finally { h.stop(); }
  });
}
test("published candidate retires synchronously on store epoch even before auth callback", async () => {
  const h = fixture(); try { await h.start(); await positive(h); h.storeOnly({ accountEpoch: 2 }); assert.equal(h.snapshot(), null); } finally { h.stop(); }
});
test("same-session auth refresh changes operation generation, not store epoch; normal registration reacquires", async () => {
  const h = fixture(); try {
    await h.start(); await positive(h); h.signal(h.makeSession(A, S, undefined, "refresh")); assert.equal(h.snapshot(), null);
    await h.flush(); assert.equal(h.state.accountEpoch, 1); assert.deepEqual(h.snapshot(), expected()); assert.equal(h.reads().length, 2);
  } finally { h.stop(); }
});
test("access expired before ACK cannot dispatch binding read although ordinary registration succeeds", async () => {
  const response = held(), h = fixture({ sessionTtl: 1_000, register: () => response.promise }); try {
    await h.start(); await h.advance(1_000); response.resolve(ack()); await h.flush();
    assert.equal(h.reads().length, 0); assert.equal(h.snapshot(), null);
    assert.equal(h.status(), "native_active");
  } finally { h.stop(); }
});
test("bounded resolver timeout retires operation, ignores late reply, never retries mutating registration", async () => {
  const response = held(), h = fixture({ resolver: () => response.promise }); try {
    await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.reads().length, 1);
    await h.advance(5_000); assert.equal(h.reads()[0].signal.aborted, true);
    response.resolve({ data: binding(), error: null }); await h.flush();
    assert.equal(h.snapshot(), null); assert.equal(h.registrations().length, 1); assert.equal(h.reads().length, 1); assert.equal(h.status(), "native_active");
  } finally { h.stop(); }
});

for (const [name, result] of [
  ["refusal", { data: [], error: null }], ["null", { data: null, error: null }],
  ["multirow", { data: [...binding(), ...binding()], error: null }],
  ["wrong version", { data: [{ ...binding()[0], binding_v: 2 }], error: null }],
  ["extra key", { data: [{ ...binding()[0], endpoint: "fictional-forbidden" }], error: null }],
  ["wrong owner", { data: binding(B), error: null }], ["wrong SID", { data: binding(A, T), error: null }],
  ["nonuuid", { data: binding(A, S, "metadata-not-uuid"), error: null }],
  ["transport", { data: null, error: { code: "42501", message: "fictional-private-error" } }],
]) {
  test(`resolver ${name} leaves candidate null and genuine ordinary success unchanged`, async () => {
    const h = fixture({ resolver: () => result }); try {
      await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.reads().length, 1);
      assert.equal(h.snapshot(), null); assert.equal(h.registrations().length, 1); assert.deepEqual(h.messages, []);
    } finally { h.stop(); }
  });
}
for (const [name, response] of [
  ["legacy void fallback", { data: null, error: { code: "PGRST202", message: "register_push_device p_voice_call_protocol does not exist" } }],
  ["missing pair", { data: null, error: null }], ["foreign pair", ack(B, T)],
  ["extra ACK key", { data: [{ ...ack().data[0], device_id: D }], error: null }],
  ["error", { data: null, error: { code: "42501" } }],
]) {
  test(`registration ${name} cannot authorize resolver or expand ACK`, async () => {
    const h = fixture({ register: args => "p_voice_call_protocol" in args ? response : { data: null, error: null } }); try {
      await h.start(); assert.equal(h.reads().length, 0); assert.equal(h.snapshot(), null);
      if (name.startsWith("legacy")) { assert.equal(h.status(), "native_active"); assert.equal(h.registrations().length, 2); }
    } finally { h.stop(); }
  });
}
for (const [name, token] of [["edge ASCII space", " fictional-sdk "], ["empty", ""]]) {
  test(`noncanonical ${name} cannot resolve; ordinary registration is unmodified`, async () => {
    const h = fixture(); try { h.token(token); await h.start(); assert.equal(h.reads().length, 0); assert.equal(h.status(), "native_active"); } finally { h.stop(); }
  });
}
test("SHA failure cannot resolve or undo ordinary registration success", async () => {
  const h = fixture(); try { h.hashFailure(); await h.start(); assert.equal(h.reads().length, 0); assert.equal(h.status(), "native_active"); } finally { h.stop(); }
});
test("edge tab bytes stay canonical for SQL ASCII-space btrim; do not use broad JS trim", async () => {
  const h = fixture(); try {
    h.token("\tfictional-sdk\t"); await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.reads().length, 1);
    assert.equal(h.reads()[0].args.p_token_hash, createHash("sha256").update("\tfictional-sdk\t", "utf8").digest("hex"));
    assert.deepEqual(h.snapshot(), expected());
  } finally { h.stop(); }
});
test("thrown resolver transport error is optional and cannot expose errors or retry registration", async () => {
  const h = fixture({ resolver: () => { throw new Error("fictional-private-transport"); } }); try {
    await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.snapshot(), null);
    assert.equal(h.registrations().length, 1); assert.equal(h.reads().length, 1); assert.deepEqual(h.messages, []);
  } finally { h.stop(); }
});
test("registration timeout followed by late exact ACK cannot authorize a resolver read", async () => {
  const response = held(), h = fixture({ register: () => response.promise }); try {
    await h.start(); await h.advance(20_000); assert.equal(h.status(), "native_setup_missing");
    response.resolve(ack()); await h.flush(); assert.equal(h.reads().length, 0); assert.equal(h.snapshot(), null);
    assert.equal(h.registrations().length, 1); assert.equal(h.commits.length, 0);
  } finally { h.stop(); }
});

for (const boundary of ["epoch", "owner", "sid", "logout", "disable", "invalidate", "dispose", "expiry"]) {
  test(`published binding is unavailable immediately after ${boundary}`, async () => {
    const h = fixture(); try {
      await h.start(); await positive(h);
      if (boundary === "epoch") h.storeOnly({ accountEpoch: 2 });
      if (boundary === "owner") h.storeOnly({ currentUser: { id: B }, authSessionIdentity: { userId: B, sessionId: S } });
      if (boundary === "sid") h.storeOnly({ authSessionIdentity: { userId: A, sessionId: T } });
      if (boundary === "logout") h.change(null);
      if (boundary === "disable") await h.calls.disableNativeVoicePush();
      if (boundary === "invalidate") h.invalidate();
      if (boundary === "dispose") h.stop();
      if (boundary === "expiry") await h.advance(60_000);
      assert.equal(h.snapshot(), null);
    } finally { h.stop(); }
  });
}

function mutation(file, needle, replacement) {
  const target = resolve(root, "lib/platform", file);
  assert.equal(readFileSync(target, "utf8").split(needle).length, 2, "unique compiled mutation target");
  return (path, text) => path === target ? text.replace(needle, replacement) : text;
}
async function storeFence(transform, update) {
  const response = held(), h = fixture({ transform, resolver: () => response.promise });
  try {
    await h.start(); h.storeOnly(update); response.resolve({ data: binding(), error: null }); await h.flush();
    assert.equal(h.snapshot(), null);
  } finally { h.stop(); }
}
for (const [name, file, needle, replacement, verify] of [
  ["ACK gate", "nativeVoiceController.ts", "messagePreviewRegistrationAck(data, owner)", "true", async transform => {
    const h = fixture({ transform, register: () => ({ data: [{ ...ack().data[0], device_id: D }], error: null }) });
    try { await h.start(); assert.equal(h.reads().length, 0); } finally { h.stop(); }
  }],
  ["token revision", "nativeVoiceController.ts", "expected.tokenRevision !== tokenRevision", "false", queuedAck],
  ["account epoch", "nativeVoiceController.ts", "owner.accountEpoch === expected.accountEpoch", "true", transform => storeFence(transform, { accountEpoch: 2 })],
  ["current owner", "nativeVoiceController.ts", "owner.recipientId === expected.recipientId", "true", transform => storeFence(transform, { currentUser: { id: B }, authSessionIdentity: { userId: B, sessionId: S } })],
  ["current SID", "nativeVoiceController.ts", "owner.recipientSessionId === expected.recipientSessionId", "true", transform => storeFence(transform, { authSessionIdentity: { userId: A, sessionId: T } })],
  ["four-key version", "nativeMessagePreviewBinding.ts", "row.binding_v !== 1", "row.binding_v !== 2", async transform => {
    const h = fixture({ transform, resolver: () => ({ data: [{ ...binding()[0], binding_v: 2 }], error: null }) });
    try { await h.start(); assert.equal(h.snapshot(), null); } finally { h.stop(); }
  }],
  ["cardinality", "nativeMessagePreviewBinding.ts", "data.length !== 1 || !record(data[0]))", "data.length < 1 || !record(data[0]))", async transform => {
    const h = fixture({ transform, resolver: () => ({ data: [...binding(), ...binding()], error: null }) });
    try { await h.start(); assert.equal(h.snapshot(), null); } finally { h.stop(); }
  }],
  ["actual device UUID", "nativeMessagePreviewBinding.ts", "!isVoiceUuid(row.device_id)", "false", async transform => {
    const h = fixture({ transform, resolver: () => ({ data: binding(A, S, "metadata-not-uuid"), error: null }) });
    try { await h.start(); assert.equal(h.snapshot(), null); } finally { h.stop(); }
  }],
  ["resolver timeout", "nativeVoiceController.ts", "Math.min(5_000, owner.expiresAt - deps.now())", "Math.min(5_001, owner.expiresAt - deps.now())", async transform => {
    const response = held(), h = fixture({ transform, resolver: () => response.promise });
    try { await h.start(); await h.advance(5_000); assert.equal(h.reads()[0].signal.aborted, true); } finally { h.stop(); }
  }],
  ["canonical SHA bytes", "nativeVoiceCalls.ts", "new TextEncoder().encode(token)", "new TextEncoder().encode(\"wrong\")", async transform => {
    const h = fixture({ transform }); try { await h.start(); await positive(h); } finally { h.stop(); }
  }],
]) {
  test(`compiled mutation killed: ${name}`, async () => {
    await verify();
    await assert.rejects(() => verify(mutation(file, needle, replacement)), { code: "ERR_ASSERTION" });
  });
}
