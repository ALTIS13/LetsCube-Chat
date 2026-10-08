import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const A = "11111111-1111-4111-8111-111111111111", B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S = "22222222-2222-4222-8222-222222222222", T = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const D = "33333333-3333-4333-8333-333333333333", E = "44444444-4444-4444-8444-444444444444";
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 120; ++i) await Promise.resolve(); };
const tuple = (recipientId = A, recipientSessionId = S, deviceId = D) => ({ recipientId, recipientSessionId, deviceId });

// Actual runtime/controller/adapters; only SDK, platform and store edges are fictional.
function fixture(options = {}) {
  let wall = 1_000_000, mono = 0, timerId = 0, voiceEpoch = 0, nativeRevision = 0;
  let auth, changed, runtime, dispose, ticket = null, verified = null, sessionReads = 0, sdkToken = "fictional-one", directBinding = tuple();
  const timers = new Map(), listeners = new Map(), effects = [], logs = [], requests = [];
  const state = { currentUser: { id: A }, authSessionIdentity: { userId: A, sessionId: S }, accountEpoch: 1 };
  const makeSession = (user = A, sid = S, exp = Math.floor((wall + 60_000) / 1000), extra = {}) => ({
    user: { id: user, is_anonymous: false }, access_token: `e30.${Buffer.from(JSON.stringify({
      sub: user, session_id: sid, role: "authenticated", is_anonymous: false, exp, ...extra,
    })).toString("base64url")}.fictional`,
  });
  let session = makeSession();
  const schedule = (work, delay = 0) => { const id = ++timerId; timers.set(id, { work, at: mono + delay }); return id; };
  const add = (name, work) => {
    const set = listeners.get(name) ?? new Set(); set.add(work); listeners.set(name, set);
    return Promise.resolve({ remove: async () => { set.delete(work); } });
  };
  const native = {
    getCapabilities: async () => ({ protocol: 0 }),
    beginBinding: async args => {
      const index = effects.filter(e => e.name === "begin").length; effects.push({ name: "begin", args: plain(args) });
      const apply = () => {
        if (!Number.isSafeInteger(args.revision) || args.revision <= nativeRevision) throw new Error("fictional stale begin");
        nativeRevision = args.revision; verified = null; ticket = { ...args, epoch: `ticket-${args.revision}` };
        return { epoch: ticket.epoch };
      };
      return options.begin ? options.begin(args, index, apply) : apply();
    },
    verifyBinding: async args => {
      const index = effects.filter(e => e.name === "verify").length; effects.push({ name: "verify", args: plain(args) });
      const apply = () => {
        const ok = ticket && args.revision === nativeRevision && args.epoch === ticket.epoch
          && args.recipientId === ticket.recipientId && args.recipientSessionId === ticket.recipientSessionId
          && args.accountEpoch === ticket.accountEpoch;
        if (ok) verified = tuple(args.recipientId, args.recipientSessionId, args.deviceId);
        return { verified: !!ok };
      };
      return options.verify ? options.verify(args, index, apply) : apply();
    },
    clearBinding: async args => {
      const index = effects.filter(e => e.name === "clear").length; effects.push({ name: "clear", args: plain(args) });
      const apply = () => {
        const applied = Number.isSafeInteger(args.revision) && args.revision > nativeRevision;
        if (applied) { nativeRevision = args.revision; ticket = verified = null; }
        return { applied };
      };
      return options.clear ? options.clear(args, index, apply) : apply();
    },
  };
  const voice = {
    getCapabilities: async () => ({ protocol: options.legacy ? 0 : 1 }), beginBinding: async () => ({ epoch: String(++voiceEpoch) }),
    commitBinding: async args => { effects.push({ name: "voice", args }); return { applied: args.epoch === String(voiceEpoch) }; },
    clearBinding: async () => { ++voiceEpoch; }, setCallsAllowed: async () => {}, setForegroundRing: async () => {},
    consumePendingAction: async () => ({ event: null }), revalidateConsumedAction: async () => ({ event: null }), addListener: add,
  };
  const supabase = {
    auth: {
      onAuthStateChange: callback => { auth = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => {
        const index = ++sessionReads;
        return options.sessionRead && index > 1 ? options.sessionRead(session, index) : { data: { session }, error: null };
      },
    },
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { push_enabled: true }, error: null }) }; return q; },
    rpc: (name, args) => {
      requests.push({ name, args });
      const call = async () => {
        const { userId, sessionId } = state.authSessionIdentity ?? {};
        if (name === "register_push_device") return options.register ? options.register(args) : { data: [{ recipient_id: userId, recipient_session_id: sessionId }], error: null };
        if (name === "native_push_device_binding") return options.resolver ? options.resolver(args) : { data: [{
          binding_v: 1, recipient_id: userId, session_id: sessionId, device_id: userId === A ? D : E,
        }], error: null };
        return { data: true, error: null };
      };
      const promise = Promise.resolve().then(call); promise.abortSignal = () => promise; return promise;
    },
  };
  const events = { addEventListener() {}, removeEventListener() {} };
  const boundary = {
    "@capacitor/core": { registerPlugin: name => { assert.ok(name === "VoiceCalls" || name === "MessagePreviews"); return name === "VoiceCalls" ? voice : native; } },
    "@capacitor/app": { App: { addListener: add } }, "@capacitor/push-notifications": { PushNotifications: { addListener: add } },
    [resolve(root, "lib/platform/capabilities.ts")]: { isNativeAndroid: () => options.browser !== true,
      supportsCapacitorPlugin: name => name === "VoiceCalls" ? !options.legacy : options.plugin !== false },
    [resolve(root, "lib/platform/nativePush.ts")]: {
      enableNativeAndroidPush: async register => (await register(sdkToken)) ?? { status: "native_active", message: "" },
      disableNativeAndroidPush: async () => ({ status: "native_inactive", message: "" }),
    },
    [resolve(root, "lib/supabase/client.ts")]: { createClient: () => supabase, getSupabasePublishableKey: () => options.key ?? "sb_publishable_fictional" },
    [resolve(root, "lib/monitoring.ts")]: { getBuildMetadata: () => ({ version: "fictional" }) },
    [resolve(root, "lib/safeOpenChat.ts")]: { safeOpenChat: async () => true },
    [resolve(root, "store/app.store.ts")]: { useAppStore: { getState: () => state, subscribe: work => { changed = work; return () => {}; } } },
  };
  const modules = new Map();
  function load(file) {
    if (boundary[file]) return boundary[file];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    let source = readFileSync(file, "utf8").replaceAll("import.meta.env.BASE_URL", '"/"');
    if (options.transform) source = options.transform(file, source);
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, atob, AbortController, TextEncoder,
      window: { ...events, setTimeout: schedule, clearTimeout: id => timers.delete(id), history: { pushState() {} }, dispatchEvent() {} },
      document: { ...events, visibilityState: "visible" }, navigator: { userAgent: "fictional" }, PopStateEvent: class {},
      Date: class extends Date { static now() { return wall; } }, performance: { now: () => mono },
      setTimeout: schedule, clearTimeout: id => timers.delete(id), crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } },
      console: { error: () => logs.push("error"), warn: () => logs.push("warn"), log: () => logs.push("log") },
      require: name => {
        if (boundary[name]) return boundary[name]; assert.ok(name.startsWith("."));
        return load(resolve(dirname(file), name.endsWith(".ts") ? name : `${name}.ts`));
      },
    }, { filename: file });
    if (file.endsWith("nativeVoiceController.ts")) {
      const create = module.exports.createNativeVoiceController;
      module.exports.createNativeVoiceController = deps => { runtime = create(deps); return runtime; };
    }
    return module.exports;
  }
  const calls = load(resolve(root, "lib/platform/nativeVoiceCalls.ts"));
  const flush = async () => {
    for (let i = 0; i < 10; ++i) {
      await tick(); const due = [...timers].filter(([, t]) => t.at <= mono);
      for (const [id, t] of due) if (timers.delete(id)) t.work();
      if (!due.length) break;
    }
    await tick();
  };
  return {
    effects, state, logs, requests, makeSession, flush, calls, ticks: tick, captureDispose: () => dispose,
    start: async () => { dispose = calls.startNativeVoiceCalls(); await flush(); }, stop: () => dispose?.(),
    status: () => calls.nativeVoicePushSnapshot()?.status, verified: () => plain(verified), sdkReads: () => sessionReads,
    preview: () => plain(calls.nativeMessagePreviewBindingSnapshot()),
    nativeCandidate: () => load(resolve(root, "lib/platform/nativeMessagePreviews.ts")).readNativeMessagePreviewCandidate(),
    of: name => effects.filter(e => e.name === name), store: update => { Object.assign(state, update); changed?.(); },
    change: value => {
      const claims = value && JSON.parse(Buffer.from(value.access_token.split(".")[1], "base64url"));
      state.accountEpoch++; state.currentUser = value ? { id: value.user.id } : null;
      state.authSessionIdentity = value ? { userId: value.user.id, sessionId: claims.session_id } : null;
      changed?.(); session = value; auth("SIGNED_IN", value);
    },
    signal: value => { session = value; auth("TOKEN_REFRESHED", value); }, sdk: value => { session = value; },
    invalidate: () => runtime.invalidate(),
    rotate: value => { sdkToken = value; for (const work of listeners.get("registration") ?? []) work({ value }); },
    advance: async (ms, wallDelta = ms) => { mono += ms; wall += wallDelta; await flush(); },
    direct: overrides => load(resolve(root, "lib/platform/nativeMessagePreviewVerification.ts")).createNativeMessagePreviewVerification({
      bridge: load(resolve(root, "lib/platform/nativeMessagePreviews.ts")).nativeMessagePreviewVerificationBridge,
      currentOwner: () => state.authSessionIdentity && ({ recipientId: state.authSessionIdentity.userId,
        recipientSessionId: state.authSessionIdentity.sessionId, accountEpoch: state.accountEpoch }),
      currentBinding: () => directBinding, getSession: async () => ({ data: { session }, error: null }),
      publicApiKey: () => options.key ?? "sb_publishable_fictional", now: () => wall, monotonicNow: () => mono, ...overrides,
    }),
    directBinding: value => { directBinding = value; },
  };
}

async function positive(h) {
  await h.start(); assert.equal(h.status(), "native_active");
  assert.equal(h.of("voice").length, 1, "ordinary voice ACK remains successful");
  assert.equal(h.of("verify").length, 1, "published sidecar must hand off to separate native verifier");
  assert.deepEqual(h.verified(), tuple());
  assert.deepEqual(plain(await h.nativeCandidate()), { protocol: 0 }, "verification is never consent/capability");
  assert.deepEqual(Object.keys(h.of("begin")[0].args).sort(), ["accountEpoch", "recipientId", "recipientSessionId", "revision"].sort(),
    "Capacitor begin methodData must not contain bearer, public key or caller options");
}
test("baseline RED publication hands exact SDK access/public key to separate native verifier", async () => {
  const h = fixture(); try { await positive(h);
    const { args } = h.of("verify")[0];
    assert.deepEqual(Object.keys(args).sort(), ["accessToken", "accountEpoch", "deviceId", "epoch", "publicApiKey", "recipientId", "recipientSessionId", "revision"].sort());
    assert.equal(args.accountEpoch, 1); assert.equal(args.publicApiKey, "sb_publishable_fictional"); assert.equal(args.accessToken, h.makeSession().access_token);
    assert.equal("refreshToken" in args, false); assert.equal("url" in args, false);
  } finally { h.stop(); }
});
test("baseline RED retirement sends a strictly newer clear immediately", async () => {
  const h = fixture(); try { await h.start(); const count = h.of("clear").length; h.change(null);
    assert.ok(h.of("clear").length > count, "logout must close native pending/verified state synchronously");
    await h.flush(); assert.equal(h.verified(), null);
  } finally { h.stop(); }
});
test("baseline control ordinary voice/push survives held optional begin", async () => {
  const pending = held(), h = fixture({ begin: () => pending.promise }); try {
    await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.of("voice").length, 1); assert.equal(h.of("verify").length, 0);
  } finally { h.stop(); pending.resolve({ epoch: "retired" }); await h.flush(); }
});
test("baseline control legacy ordinary success does not begin verification", async () => {
  const h = fixture({ legacy: true }); try { await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.of("begin").length, 0); } finally { h.stop(); }
});
test("baseline control browser does no native registration or verification", async () => {
  const h = fixture({ browser: true }); try { await h.start(); assert.equal(h.requests.length, 0); assert.equal(h.effects.length, 0); } finally { h.stop(); }
});

for (const order of ["old-first", "new-first"]) {
  test(`held begin ACK owner switch ${order}: only B can dispatch verification`, async () => {
    const old = held(), next = held(); let a, b;
    const h = fixture({ begin: (_args, index, apply) => {
      if (index === 0) { a = apply(); return old.promise; }
      b = apply(); return next.promise;
    } });
    try {
      await h.start(); h.change(h.makeSession(B, T)); await h.flush();
      if (order === "old-first") { old.resolve(a); await h.flush(); assert.equal(h.of("verify").length, 0); next.resolve(b); }
      else { next.resolve(b); await h.flush(); old.resolve(a); }
      await h.flush(); assert.equal(h.of("verify").length, 1); assert.deepEqual(h.verified(), tuple(B, T, E));
    } finally { h.stop(); }
  });
  test(`held verify completion ${order}: old ACK cannot clear or replace B`, async () => {
    const old = held(), next = held(); let applyA, applyB;
    const h = fixture({ verify: (_args, index, apply) => {
      if (index === 0) { applyA = apply; return old.promise.then(apply); }
      applyB = apply; return next.promise.then(apply);
    } });
    try {
      await h.start(); assert.equal(h.status(), "native_active"); h.change(h.makeSession(B, T)); await h.flush();
      assert.ok(applyA && applyB);
      if (order === "old-first") { old.resolve(); await h.flush(); next.resolve(); }
      else { next.resolve(); await h.flush(); old.resolve(); }
      await h.flush(); assert.deepEqual(h.verified(), tuple(B, T, E)); assert.equal(h.of("verify").length, 2);
    } finally { h.stop(); }
  });
}
test("delayed native delivery of A begin refuses after B verification", async () => {
  const pending = held(), h = fixture({ begin: (_args, index, apply) => index === 0 ? pending.promise.then(apply) : apply() });
  try { await h.start(); h.change(h.makeSession(B, T)); await h.flush(); assert.deepEqual(h.verified(), tuple(B, T, E));
    pending.resolve(); await h.flush(); assert.deepEqual(h.verified(), tuple(B, T, E)); assert.equal(h.of("verify").length, 1);
  } finally { h.stop(); }
});
test("delayed A clear delivery and ACK cannot close newer B", async () => {
  const pending = held(); let armed = false, heldOnce = false;
  const h = fixture({ clear: (_args, _index, apply) => {
    if (armed && !heldOnce) { heldOnce = true; return pending.promise.then(apply); } return apply();
  } });
  try { await positive(h); armed = true; h.change(h.makeSession(B, T)); await h.flush(); assert.deepEqual(h.verified(), tuple(B, T, E));
    pending.resolve(); await h.flush(); assert.deepEqual(h.verified(), tuple(B, T, E));
    const revisions = h.effects.filter(e => e.name === "clear" || e.name === "begin").map(e => e.args.revision);
    assert.ok(revisions.every((n, i) => Number.isSafeInteger(n) && (i === 0 || n > revisions[i - 1])));
  } finally { h.stop(); }
});
async function restart(transform) {
  const h = fixture({ transform }); let oldStop;
  try { await positive(h); oldStop = h.captureDispose(); const first = h.of("begin")[0].args.revision;
    await h.start(); assert.deepEqual(h.verified(), tuple()); assert.ok(h.of("begin").at(-1).args.revision > first);
    const count = h.of("clear").length; oldStop(); await h.flush();
    assert.equal(h.of("clear").length, count, "old controller teardown cannot acquire the new verifier revision domain");
    assert.deepEqual(h.verified(), tuple());
  } finally { h.stop(); }
}
test("module-global revisions survive restart; old controller teardown cannot clear replacement", () => restart());

for (const [name, ack] of [["null", null], ["empty", {}], ["empty epoch", { epoch: "" }],
  ["extra key", { epoch: "ticket", extra: true }], ["numeric", { epoch: 1 }]]) {
  test(`unknown begin ${name} advances clear, never fetches access or retries registration`, async () => {
    const h = fixture({ begin: (_args, _index, apply) => { apply(); return ack; } });
    try { await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.of("verify").length, 0); assert.equal(h.verified(), null);
      assert.ok(h.of("clear").at(-1).args.revision > h.of("begin")[0].args.revision);
      assert.equal(h.sdkReads(), 1, "unknown begin cannot acquire SDK access beyond the existing boot read");
      assert.equal(h.requests.filter(r => r.name === "register_push_device").length, 1); assert.deepEqual(h.logs, []);
    } finally { h.stop(); }
  });
}
for (const [name, ack] of [["false", { verified: false }], ["extra", { verified: true, extra: 1 }],
  ["string", { verified: "true" }], ["null", null]]) {
  test(`verify ${name} ACK remains closed and cannot impersonate capabilities`, async () => {
    const h = fixture({ verify: (_args, _index, apply) => { apply(); return ack; } });
    try { await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.verified(), null);
      assert.ok(h.of("clear").at(-1).args.revision > h.of("begin")[0].args.revision);
      assert.deepEqual(plain(await h.nativeCandidate()), { protocol: 0 });
    } finally { h.stop(); }
  });
}
test("absent old-APK MessagePreviews never affects ordinary success", async () => {
  const h = fixture({ plugin: false }); try { await h.start(); assert.equal(h.status(), "native_active");
    assert.equal(h.of("begin").length, 0); assert.equal(await h.nativeCandidate(), null);
  } finally { h.stop(); }
});
test("native begin logging refusal forwards zero credentials and never acquires SDK access", async () => {
  const h = fixture({ begin: () => { throw new Error("fictional logging-enabled refusal"); } });
  try { await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.of("voice").length, 1);
    assert.equal(h.of("begin").length, 1); assert.equal(h.of("verify").length, 0); assert.equal(h.sdkReads(), 1);
    assert.deepEqual(Object.keys(h.of("begin")[0].args).sort(), ["accountEpoch", "recipientId", "recipientSessionId", "revision"].sort());
    assert.deepEqual(h.logs, []);
  } finally { h.stop(); }
});
test("malformed real-ticket begin ACK forwards zero credential-bearing verify calls", async () => {
  const h = fixture({ begin: (_args, _index, apply) => ({ ...apply(), unexpected: true }) });
  try { await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.of("verify").length, 0);
    assert.equal(h.sdkReads(), 1); assert.equal(h.verified(), null); assert.deepEqual(h.logs, []);
  } finally { h.stop(); }
});
for (const boundary of ["logout", "same-user SID", "epoch", "disable", "invalidate", "dispose", "rotation"]) {
  test(`published verification retires synchronously on ${boundary}`, async () => {
    const h = fixture(); try { await positive(h); const revision = h.of("begin").at(-1).args.revision;
      if (boundary === "logout") h.change(null);
      if (boundary === "same-user SID") h.change(h.makeSession(A, T));
      if (boundary === "epoch") h.store({ accountEpoch: 2 });
      if (boundary === "disable") void h.calls.disableNativeVoicePush();
      if (boundary === "invalidate") h.invalidate();
      if (boundary === "dispose") h.stop();
      if (boundary === "rotation") h.rotate("fictional-two");
      assert.ok(h.of("clear").at(-1).args.revision > revision); assert.equal(h.verified(), null);
    } finally { h.stop(); }
  });
}
test("queued rotation immediately clears even while old registration ACK is held", async () => {
  const old = held(); let count = 0;
  const h = fixture({ register: () => ++count === 1 ? old.promise : { data: [{ recipient_id: A, recipient_session_id: S }], error: null } });
  try { await h.start(); const before = h.of("clear").at(-1).args.revision; h.rotate("fictional-two");
    assert.ok(h.of("clear").at(-1).args.revision > before); old.resolve({ data: [{ recipient_id: A, recipient_session_id: S }], error: null });
    await h.flush(); assert.equal(count, 2); assert.equal(h.of("begin").length, 1); assert.equal(h.of("verify").length, 1);
    assert.equal(h.status(), "native_active");
  } finally { h.stop(); }
});
test("same-session refresh reacquires verification without changing accountEpoch", async () => {
  const h = fixture(); try { await positive(h); const before = h.of("begin").at(-1).args.revision;
    h.signal(h.makeSession(A, S, undefined, { nonce: "refresh" })); assert.equal(h.verified(), null); await h.flush();
    assert.equal(h.state.accountEpoch, 1); assert.ok(h.of("begin").at(-1).args.revision > before); assert.deepEqual(h.verified(), tuple());
  } finally { h.stop(); }
});
async function sameTupleRotation(transform, order = "new-first") {
  const old = held(), next = held();
  const h = fixture({ transform, verify: (_args, index, apply) => (index === 0 ? old : next).promise.then(apply) });
  try { await h.start(); h.rotate("fictional-two"); await h.flush(); assert.equal(h.of("verify").length, 2);
    if (order === "old-first") { old.resolve(); await h.flush(); next.resolve(); }
    else { next.resolve(); await h.flush(); old.resolve(); }
    await h.flush(); assert.deepEqual(h.verified(), tuple(), "same row/UID/SID does not authorize a retired token operation ACK");
  } finally { h.stop(); }
}
for (const order of ["old-first", "new-first"]) test(`same-tuple token rotation held verification ${order} preserves latest`, () => sameTupleRotation(undefined, order));
test("held SDK session read is optional; owner switch never forwards A access", async () => {
  const pending = held(); let oldSession;
  const h = fixture({ sessionRead: (session, index) => {
    if (index === 2) { oldSession = session; return pending.promise; } return { data: { session }, error: null };
  } });
  try { await h.start(); assert.equal(h.status(), "native_active"); h.change(h.makeSession(B, T)); await h.flush();
    pending.resolve({ data: { session: oldSession }, error: null }); await h.flush();
    assert.equal(h.of("verify").length, 1); assert.equal(h.of("verify")[0].args.recipientId, B); assert.deepEqual(h.verified(), tuple(B, T, E));
  } finally { h.stop(); }
});
test("malformed clear ACK is not proof; only a new exact begin/verify can reacquire", async () => {
  const h = fixture({ clear: (_args, _index, apply) => { apply(); return { applied: "true" }; } });
  try { await positive(h); h.change(null); assert.equal(h.verified(), null); h.change(h.makeSession(B, T)); await h.flush();
    assert.deepEqual(h.verified(), tuple(B, T, E)); assert.deepEqual(plain(await h.nativeCandidate()), { protocol: 0 });
  } finally { h.stop(); }
});
test("held resolver after owner retirement cannot hand off a stale tuple", async () => {
  const pending = held(); let count = 0;
  const h = fixture({ resolver: () => ++count === 1 ? pending.promise : { data: [{ binding_v: 1, recipient_id: B, session_id: T, device_id: E }], error: null } });
  try { await h.start(); h.change(h.makeSession(B, T)); await h.flush(); pending.resolve({
    data: [{ binding_v: 1, recipient_id: A, session_id: S, device_id: D }], error: null,
  }); await h.flush(); assert.equal(h.of("begin").length, 1); assert.deepEqual(h.verified(), tuple(B, T, E)); }
  finally { h.stop(); }
});
for (const name of ["foreign owner", "foreign SID", "expired", "anonymous", "service access", "SDK error", "SDK throw"]) {
  test(`SDK ${name} refuses optional handoff without changing ordinary success`, async () => {
    let h;
    h = fixture({ sessionRead: session => {
      if (name === "SDK throw") throw new Error("fictional-private-error");
      if (name === "SDK error") return { data: { session }, error: { message: "fictional-private-error" } };
      const value = name === "foreign owner" ? h.makeSession(B, T) : name === "foreign SID" ? h.makeSession(A, T)
        : name === "expired" ? h.makeSession(A, S, 1000) : name === "anonymous" ? h.makeSession(A, S, undefined, { is_anonymous: true })
          : name === "service access" ? h.makeSession(A, S, undefined, { role: "service_role" }) : session;
      return { data: { session: value }, error: null };
    } });
    try { await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.of("verify").length, 0); assert.deepEqual(h.logs, []); }
    finally { h.stop(); }
  });
}
for (const key of ["sb_secret_fictional", "", `e30.${Buffer.from('{"role":"service_role"}').toString("base64url")}.fictional`]) {
  test(`nonpublic key refuses before native credential dispatch: ${key.startsWith("sb_") ? "secret" : key ? "service" : "empty"}`, async () => {
    const h = fixture({ key }); try { await h.start(); assert.equal(h.status(), "native_active"); assert.equal(h.of("verify").length, 0); } finally { h.stop(); }
  });
}
test("legacy anon public config is supplied privately, never URL or refresh token", async () => {
  const h = fixture({ key: `e30.${Buffer.from('{"role":"anon"}').toString("base64url")}.fictional` });
  try { await positive(h); assert.equal("url" in h.of("verify")[0].args, false); } finally { h.stop(); }
});
async function deadlineControl(transform) {
  const pending = held(), h = fixture({ transform, begin: () => pending.promise });
  try { await h.start(); const before = h.of("clear").length; await h.advance(10_000, -10_000);
    assert.ok(h.of("clear").length > before, "literal 10s deadline closes unknown begin even after wall rollback");
    pending.resolve({ epoch: "late" }); await h.flush(); assert.equal(h.of("verify").length, 0); assert.equal(h.status(), "native_active");
  } finally { h.stop(); }
}
test("bounded unknown begin timeout closes, no retries, wall rollback cannot extend it", () => deadlineControl());
test("held verify expires without delaying ordinary push and late worker cannot revive", async () => {
  const pending = held(), h = fixture({ verify: (_args, _index, apply) => pending.promise.then(apply) });
  try { await h.start(); assert.equal(h.status(), "native_active"); await h.advance(10_000);
    pending.resolve(); await h.flush(); assert.equal(h.verified(), null); assert.equal(h.of("verify").length, 1);
  } finally { h.stop(); }
});
test("published access expiry sends clear and never creates native capability", async () => {
  const h = fixture(); try { await positive(h); await h.advance(60_000, -60_000); assert.equal(h.verified(), null);
    assert.deepEqual(plain(await h.nativeCandidate()), { protocol: 0 });
  } finally { h.stop(); }
});

async function liveFence(kind, transform) {
  const pending = held(), h = fixture({ transform });
  const adapter = h.direct({ getSession: () => pending.promise });
  try {
    adapter.bindingChanged(tuple()); await h.ticks();
    if (kind === "owner") h.state.authSessionIdentity = { userId: B, sessionId: S };
    if (kind === "SID") h.state.authSessionIdentity = { userId: A, sessionId: T };
    if (kind === "epoch") h.state.accountEpoch++;
    if (kind === "device") h.directBinding(tuple(A, S, E));
    pending.resolve({ data: { session: h.makeSession() }, error: null }); await h.flush();
    assert.equal(h.of("verify").length, 0, "held SDK cannot forward access after live tuple/owner changes without callback");
  } finally { adapter.dispose(); }
}
for (const kind of ["owner", "SID", "epoch", "device"]) test(`actual adapter rechecks live ${kind} after held SDK read`, () => liveFence(kind));
async function expiryFence(monotonic, transform) {
  const pending = held(), h = fixture({ transform, verify: (_args, _index, apply) => pending.promise.then(apply) });
  h.sdk(h.makeSession(A, S, 1001)); const adapter = h.direct();
  try { adapter.bindingChanged(tuple()); await h.flush(); assert.equal(h.of("verify").length, 1);
    await h.advance(monotonic ? 1000 : 0, monotonic ? -10_000 : 1000);
    pending.resolve(); await h.ticks();
    assert.equal(h.verified(), null, "late ACK must be retired before any expiry timer can mask the missing fence");
  } finally { adapter.dispose(); }
}
test("actual adapter rejects ACK past wall expiry even before timers run", () => expiryFence(false));
test("actual adapter rejects ACK past monotonic expiry during wall rollback", () => expiryFence(true));

function mutation(file, needle, replacement) {
  const target = resolve(root, "lib/platform", file);
  assert.equal(readFileSync(target, "utf8").split(needle).length, 2, "unique actual-source mutation required");
  return (path, source) => path === target ? source.replace(needle, replacement) : source;
}
for (const [name, file, needle, replacement, verify] of [
  ["publication callback", "nativeVoiceController.ts", "deps.messagePreviewBinding?.onChanged?.({ ...candidate })", "undefined", async transform => {
    const h = fixture({ transform }); try { await positive(h); } finally { h.stop(); }
  }],
  ["retirement callback", "nativeVoiceController.ts", "deps.messagePreviewBinding?.onChanged?.(null)", "undefined", async transform => {
    const h = fixture({ transform }); try { await positive(h); h.store({ accountEpoch: 2 }); assert.equal(h.verified(), null); } finally { h.stop(); }
  }],
  ["restart revision", "nativeMessagePreviewVerification.ts", "export function createNativeMessagePreviewVerification(deps: VerificationDependencies) {", "export function createNativeMessagePreviewVerification(deps: VerificationDependencies) { revision = 0;", restart],
  ["credential-free begin", "nativeMessagePreviewVerification.ts", "const owner = { ...op.owner, revision: op.revision };", 'const owner = { ...op.owner, revision: op.revision, accessToken: "fictional-bearer", publicApiKey: deps.publicApiKey() };', async transform => {
    const h = fixture({ transform }); try { await positive(h); } finally { h.stop(); }
  }],
  ["operation revision", "nativeMessagePreviewVerification.ts", "operation === op && revision === op.revision", "true", sameTupleRotation],
  ["live owner", "nativeMessagePreviewVerification.ts", "owner.recipientId === op.owner.recipientId", "true", transform => liveFence("owner", transform)],
  ["live SID", "nativeMessagePreviewVerification.ts", "owner.recipientSessionId === op.owner.recipientSessionId", "true", transform => liveFence("SID", transform)],
  ["live epoch", "nativeMessagePreviewVerification.ts", "owner.accountEpoch === op.owner.accountEpoch", "true", transform => liveFence("epoch", transform)],
  ["live device", "nativeMessagePreviewVerification.ts", "binding.deviceId === op.binding.deviceId", "true", transform => liveFence("device", transform)],
  ["wall expiry", "nativeMessagePreviewVerification.ts", "deps.now() >= op.expiresAt", "false", transform => expiryFence(false, transform)],
  ["monotonic expiry", "nativeMessagePreviewVerification.ts", "deps.monotonicNow() >= op.monotonicExpiry", "false", transform => expiryFence(true, transform)],
  ["10s timeout", "nativeMessagePreviewVerification.ts", "}, 10_000);", "}, 10_001);", deadlineControl],
  ["strict verify ACK", "nativeMessagePreviewVerification.ts", '!exactAck(ack, "verified") || ack.verified !== true', "false", async transform => {
    const h = fixture({ transform, verify: (_args, _index, apply) => { apply(); return { verified: true, extra: 1 }; } });
    try { await h.start(); assert.equal(h.verified(), null); } finally { h.stop(); }
  }],
  ["strict begin ACK", "nativeMessagePreviewVerification.ts", '!exactAck(began, "epoch")', "false", async transform => {
    const h = fixture({ transform, begin: (_args, _index, apply) => ({ ...apply(), extra: 1 }) });
    try { await h.start(); assert.equal(h.of("verify").length, 0); assert.equal(h.sdkReads(), 1); } finally { h.stop(); }
  }],
  ["exact ticket", "nativeMessagePreviewVerification.ts", "dispatch(op, began.epoch, response)", 'dispatch(op, "wrong-ticket", response)', async transform => {
    const h = fixture({ transform }); try { await positive(h); } finally { h.stop(); }
  }],
  ["SDK owner", "nativeMessagePreviewVerification.ts", "identity.recipientId !== op.owner.recipientId", "false", async transform => {
    let h; h = fixture({ transform, sessionRead: () => ({ data: { session: h.makeSession(B, S) }, error: null }) });
    try { await h.start(); assert.equal(h.of("verify").length, 0); } finally { h.stop(); }
  }],
  ["SDK session", "nativeMessagePreviewVerification.ts", "identity.recipientSessionId !== op.owner.recipientSessionId", "false", async transform => {
    let h; h = fixture({ transform, sessionRead: () => ({ data: { session: h.makeSession(A, T) }, error: null }) });
    try { await h.start(); assert.equal(h.of("verify").length, 0); } finally { h.stop(); }
  }],
]) test(`compiled literal omission killed: ${name}`, async () => {
  await verify(); await assert.rejects(() => verify(mutation(file, needle, replacement)), { code: "ERR_ASSERTION" });
});
