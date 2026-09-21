import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = await import("../../artifacts/kub/src/lib/platform/nativeVoiceController.ts").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const A = "11111111-1111-4111-8111-111111111111";
const B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S = "22222222-2222-4222-8222-222222222222";
const T = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "33333333-3333-4333-8333-333333333333";
const V = "44444444-4444-4444-8444-444444444444";
const session = (user = A, sid = S, nonce = "initial") => ({ user: { id: user }, access_token: `e30.${Buffer.from(JSON.stringify({ sub: user, session_id: sid, nonce })).toString("base64url")}.fixture` });
const row = (user = A, sid = S) => [{ recipient_id: user, recipient_session_id: sid }];
const action = () => ({ protocol_version: "1", type: "voice_call", event: "ring", ring_key: `voice:${V}:1000`, chat_id: C, channel_id: V, caller_id: B, recipient_id: A, recipient_session_id: S, route: `/chat/${C}`, ring_started_at: "1000", expires_at: "46000" });
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { resolve, promise }; };
const ticks = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };

function harness(overrides = {}, implementation = source) {
  assert.equal(typeof implementation.createNativeVoiceController, "function", "actual controller exists");
  const log = [], queue = [], commits = [], routes = [];
  let epoch = 0, bound = null, pending = null, consumed = null, allowed = true;
  const deps = {
    bridge: {
      getCapabilities: async () => ({ protocol: 1 }),
      beginBinding: (candidate) => { bound = null; log.push(["begin", candidate]); return Promise.resolve({ epoch: String(++epoch) }); },
      commitBinding: async (binding) => { commits.push(binding); const applied = binding.epoch === String(epoch); if (applied) bound = binding; return { applied }; },
      clearBinding: async () => { log.push(["clear"]); ++epoch; bound = null; pending = null; consumed = null; },
      setCallsAllowed: async ({ allowed: value }) => { allowed = value; if (!value) consumed = null; log.push(["calls", value]); },
      consumePendingAction: async () => { log.push(["consume"]); const event = pending; pending = null; if (event) consumed = event; return { event }; },
      revalidateConsumedAction: async ({ ringKey }) => { log.push(["revalidate", ringKey]); return { event: bound && allowed && consumed?.ring_key === ringKey ? consumed : null }; },
    },
    loadSettings: async () => ({ pushEnabled: true, callsAllowed: true }),
    registerPush: async (register, interactive) => { log.push(["push", interactive]); return await register("synthetic-token") ?? { status: "native_active", message: "" }; },
    unregisterPush: async () => { log.push(["unregister"]); return { status: "native_inactive", message: "" }; },
    registrationMetadata: async () => ({ tokenHash: null, deviceModel: null, appVersion: null }),
    rpc: async (args) => { log.push(["rpc", args]); return { data: row(), error: null }; },
    openChat: async (id) => { log.push(["open", id]); return true; },
    navigate: (route) => routes.push(route),
    navigationReady: () => true,
    now: () => 1000,
    defer: (fn) => queue.push(fn),
    ...overrides,
  };
  const controller = implementation.createNativeVoiceController(deps);
  return { controller, deps, log, commits, routes, get bound() { return bound; }, get allowed() { return allowed; }, setPending: (value) => { pending = value; if (value) consumed = null; }, cancelConsumed: () => { consumed = null; }, flush: async () => { while (queue.length) queue.shift()(); await ticks(); } };
}

test("auth signal invalidates locally but defers ALL network work outside callback", async () => {
  const h = harness();
  assert.equal(h.controller.signalSession(session()), undefined);
  assert.deepEqual(h.log.map(([name]) => name), ["calls", "begin"]);
  await h.flush();
  assert.equal(h.bound.recipientId, A);
  assert.deepEqual(h.log.find(([name]) => name === "rpc")[1], {
    p_platform: "android", p_provider: "fcm", p_token: "synthetic-token", p_token_hash: null,
    p_device_id: null, p_device_model: null, p_app_version: null, p_voice_call_protocol: 1,
  });
  assert.deepEqual(h.log.find(([name]) => name === "push"), ["push", false]);
});

test("old shell keeps seven args and ordinary push, without voice authority", async () => {
  const h = harness();
  h.deps.bridge.getCapabilities = async () => ({ protocol: 0 });
  h.controller.signalSession(session()); await h.flush();
  assert.equal(Object.keys(h.log.find(([name]) => name === "rpc")[1]).length, 7);
  assert.equal(h.commits.length, 0);
});

test("new shell falls back only missing overload and stays cleared", async () => {
  let count = 0;
  const h = harness({ rpc: async (args) => {
    ++count;
    if (count === 1) { assert.equal(args.p_voice_call_protocol, 1); return { data: null, error: { code: "PGRST202", message: "Could not find public.register_push_device(p_voice_call_protocol) in the schema cache" } }; }
    assert.equal(Object.keys(args).length, 7); return { data: null, error: null };
  } });
  h.controller.signalSession(session()); await h.flush();
  assert.equal(count, 2); assert.equal(h.bound, null); assert.equal(h.commits.length, 0);
});

test("auth/network/permission errors never trigger fallback", async () => {
  for (const error of [{ code: "42501" }, { code: "PGRST301" }, { message: "network" }, { code: "PGRST202", message: "another function" }]) {
    let count = 0;
    const h = harness({ rpc: async () => { count++; return { data: null, error }; } });
    h.controller.signalSession(session()); await h.flush();
    assert.equal(count, 1); assert.equal(h.bound, null);
  }
});

test("only an exact singleton server response can commit a binding", async () => {
  for (const data of [null, [], [...row(), ...row()], row(B, S), row(A, T)]) {
    const h = harness({ rpc: async () => ({ data, error: null }) });
    h.controller.signalSession(session()); await h.flush();
    assert.equal(h.commits.length, 0); assert.equal(h.bound, null);
  }
});

test("stale RPC after account switch cannot commit or clear the new account", async () => {
  const old = deferred(); let count = 0;
  const h = harness({ rpc: async () => ++count === 1 ? old.promise : { data: row(B, T), error: null } });
  h.controller.signalSession(session()); await h.flush();
  h.controller.signalSession(session(B, T)); await h.flush();
  old.resolve({ data: row(), error: null }); await ticks();
  assert.equal(h.commits.length, 1); assert.equal(h.bound.recipientId, B);
});

test("same session token refresh and late begin callback cannot reuse the old epoch", async () => {
  const old = deferred(); const h = harness();
  const begin = h.deps.bridge.beginBinding; let count = 0;
  h.deps.bridge.beginBinding = (binding) => { const value = begin(binding); return ++count === 1 ? old.promise : value; };
  h.controller.signalSession(session()); await h.flush();
  h.controller.signalSession(session(A, S, "refresh")); await h.flush();
  old.resolve({ epoch: "1" }); await ticks();
  assert.equal(h.commits.length, 1); assert.equal(h.bound.epoch, "2");
  assert.equal(h.log.filter(([name]) => name === "clear").length, 0, "matching pending taps are not cleared on refresh");
});

test("logout immediately clears and late push callback cannot register", async () => {
  let callback;
  const h = harness({ registerPush: async (register) => { callback = register; return new Promise(() => {}); } });
  h.controller.signalSession(session()); await h.flush();
  h.controller.signalSession(null);
  assert.equal(h.log.at(-1)[0], "clear");
  await callback("late-synthetic-token");
  assert.equal(h.log.some(([name]) => name === "rpc"), false);
});

test("push disabled and denied permission leave no binding", async () => {
  const off = harness({ loadSettings: async () => ({ pushEnabled: false, callsAllowed: true }) });
  off.controller.signalSession(session()); await off.flush();
  assert.equal(off.log.some(([name]) => name === "push"), false); assert.equal(off.bound, null);
  const denied = harness({ registerPush: async () => ({ status: "native_denied", message: "" }) });
  denied.controller.signalSession(session()); await denied.flush();
  assert.equal(denied.bound, null); assert.equal(denied.log.at(-1)[0], "clear");
});

test("resume and explicit enable use one registrar, only enable requests permission", async () => {
  const h = harness(); h.controller.signalSession(session()); await h.flush();
  h.controller.refresh(); await h.flush();
  await h.controller.enable();
  assert.deepEqual(h.log.filter(([name]) => name === "push").map((entry) => entry[1]), [false, false, true]);
  assert.equal(h.commits.length, 3);
});

test("disable clears before unregister network and stale calls preference cannot affect another account", async () => {
  const wait = deferred();
  const h = harness({ unregisterPush: async () => wait.promise });
  h.controller.signalSession(session()); await h.flush();
  const before = h.controller.context();
  const disabled = h.controller.disable(); assert.equal(h.bound, null);
  h.controller.signalSession(session(B, T)); await h.flush();
  h.controller.setCallsAllowed(false, before);
  assert.equal(h.allowed, true);
  wait.resolve({ status: "native_inactive", message: "" }); await disabled;
});

test("pending tap waits for binding and loaded matching profile, then opens only normal chat route", async () => {
  let ready = false;
  const h = harness({ navigationReady: () => ready });
  h.controller.signalSession(session()); h.setPending(action());
  await h.controller.actionPending(); assert.equal(h.log.some(([name]) => name === "consume"), false);
  await h.flush(); assert.equal(h.log.some(([name]) => name === "consume"), false);
  ready = true; await h.controller.actionPending();
  assert.deepEqual(h.routes, [`/chat/${C}`]);
  assert.deepEqual(h.log.filter(([name]) => name === "open"), [["open", C]]);
});

test("late consume callback and late chat access response cannot navigate after auth change", async () => {
  for (const boundary of ["consume", "open"]) {
    const wait = deferred(); const h = harness();
    h.controller.signalSession(session()); await h.flush();
    if (boundary === "consume") h.deps.bridge.consumePendingAction = () => wait.promise;
    else { h.setPending(action()); h.deps.openChat = () => wait.promise; }
    const operation = h.controller.actionPending(); await ticks();
    h.controller.signalSession(session(B, T));
    wait.resolve(boundary === "consume" ? { event: action() } : true);
    await operation; assert.deepEqual(h.routes, []);
  }
});

test("pending expiry and local calls-off block navigation even after asynchronous chat access", async () => {
  for (const change of ["expired", "off"]) {
    let now = 1000; const wait = deferred();
    const h = harness({ openChat: () => wait.promise, now: () => now });
    h.controller.signalSession(session()); await h.flush(); h.setPending(action());
    const operation = h.controller.actionPending(); await ticks();
    if (change === "expired") now = 46000;
    else h.controller.setCallsAllowed(false, h.controller.context());
    wait.resolve(true); await operation; assert.deepEqual(h.routes, []);
  }
});

test("a stale commit callback cannot authorize or navigate the replacement session", async () => {
  const old = deferred(); const h = harness();
  h.deps.bridge.commitBinding = () => old.promise;
  h.controller.signalSession(session()); await h.flush();
  h.controller.signalSession(session(A, T));
  old.resolve({ applied: true }); await ticks(); h.setPending(action());
  await h.controller.actionPending(); assert.deepEqual(h.routes, []);
});

test("timed-out registration invalidates a backend callback still waiting for RPC", async () => {
  const old = deferred(); const timeout = deferred(); let callbackResult;
  const h = harness({
    rpc: () => old.promise,
    registerPush: async (register) => {
      callbackResult = register("synthetic");
      return timeout.promise;
    },
  });
  h.controller.signalSession(session()); await h.flush();
  timeout.resolve({ status: "native_setup_missing", message: "" }); await ticks();
  old.resolve({ data: row(), error: null }); await callbackResult;
  assert.equal(h.commits.length, 0); assert.equal(h.bound, null);
});

test("late settings cannot undo a local calls-off change", async () => {
  const pending = deferred(); const h = harness({ loadSettings: () => pending.promise });
  h.controller.signalSession(session()); await h.flush();
  h.controller.setCallsAllowed(false, h.controller.context());
  pending.resolve({ pushEnabled: true, callsAllowed: true }); await ticks();
  assert.equal(h.allowed, false); h.setPending(action()); await h.controller.actionPending();
  assert.deepEqual(h.routes, []);
});

async function rotatedWhileRegistering(implementation = source, stop = null) {
  const old = deferred(); const backend = []; let latest = "synthetic-A";
  const h = harness({
    registerPush: async (register) => await register(latest) ?? { status: "native_active", message: "" },
    rpc: async (args) => { backend.push(args.p_token); return backend.length === 1 ? old.promise : { data: row(), error: null }; },
  }, implementation);
  h.controller.signalSession(session()); await h.flush();
  latest = "synthetic-B"; h.controller.tokenChanged(latest);
  latest = "synthetic-C"; h.controller.tokenChanged(latest); h.controller.tokenChanged(latest);
  if (stop === "logout") h.controller.signalSession(null);
  if (stop === "disable") await h.controller.disable();
  old.resolve({ data: row(), error: null }); await ticks(); await h.flush();
  return { h, backend };
}

test("R3: rotations during an active RPC coalesce into one latest-token registration", async () => {
  const { h, backend } = await rotatedWhileRegistering();
  assert.deepEqual(backend, ["synthetic-A", "synthetic-C"]);
  assert.equal(h.commits.length, 2);
});

for (const stop of ["logout", "disable"]) {
  test(`R3: ${stop} discards queued token rotation before the held RPC completes`, async () => {
    const { h, backend } = await rotatedWhileRegistering(source, stop);
    assert.deepEqual(backend, ["synthetic-A"]); assert.equal(h.bound, null);
  });
}

async function refreshDuringConsumedTap(implementation = source, invalidate = null, refreshFirst = true) {
  const access = deferred(); let opens = 0; let now = 1000;
  const h = harness({
    openChat: async (_id, canCommit) => { if (++opens === 1) await access.promise; return canCommit(); },
    now: () => now,
  }, implementation);
  h.controller.signalSession(session()); await h.flush(); h.setPending(action());
  const navigation = h.controller.actionPending(); await ticks();
  h.controller.invalidate();
  if (!refreshFirst) { access.resolve(); await navigation; }
  h.controller.signalSession(session(A, S, "refresh")); await h.flush();
  if (invalidate === "cancel") h.cancelConsumed();
  if (invalidate === "expiry") now = 46000;
  if (invalidate === "mute") h.controller.setCallsAllowed(false, h.controller.context());
  if (invalidate === "logout") h.controller.signalSession(null);
  if (invalidate === "session") h.controller.signalSession(session(A, T));
  if (invalidate === "account") h.controller.signalSession(session(B, S));
  access.resolve(); await navigation; await ticks();
  return { h, opens };
}

for (const refreshFirst of [true, false]) {
  test(`R1: consumed tap survives same-session reverification (${refreshFirst ? "binding" : "access"} settles first)`, async () => {
    const { h, opens } = await refreshDuringConsumedTap(source, null, refreshFirst);
    assert.deepEqual(h.routes, [`/chat/${C}`]);
    assert.equal(opens, 2);
    assert.equal(h.log.filter(([name]) => name === "revalidate").length, 1);
  });
}

for (const invalidation of ["cancel", "expiry", "mute", "logout", "session", "account"]) {
  test(`R1: retained consumed tap cannot survive ${invalidation}`, async () => {
    const { h } = await refreshDuringConsumedTap(source, invalidation);
    assert.deepEqual(h.routes, []);
  });
}

test("R1: a consumed bridge callback delayed through same-session refresh is retried natively", async () => {
  const callback = deferred(); const h = harness();
  h.controller.signalSession(session()); await h.flush(); h.setPending(action());
  const consume = h.deps.bridge.consumePendingAction;
  h.deps.bridge.consumePendingAction = async () => { const result = await consume(); await callback.promise; return result; };
  const navigation = h.controller.actionPending(); await ticks();
  h.controller.signalSession(session(A, S, "refresh")); await h.flush();
  callback.resolve(); await navigation;
  assert.deepEqual(h.routes, [`/chat/${C}`]);
  assert.equal(h.log.filter(([name]) => name === "revalidate").length, 1);
});

async function replacedConsumedTap(implementation = source, replacement = true) {
  const access = deferred(); let opens = 0;
  const h = harness({ openChat: async (_id, canCommit) => { if (++opens === 1) await access.promise; return canCommit(); } }, implementation);
  h.controller.signalSession(session()); await h.flush(); h.setPending(action());
  const navigation = h.controller.actionPending(); await ticks();
  h.controller.invalidate(); access.resolve(); await navigation;
  h.cancelConsumed();
  if (replacement) h.setPending({ ...action(), chat_id: B, route: `/chat/${B}`, channel_id: C, ring_key: `voice:${C}:1000` });
  await h.controller.actionPending();
  h.controller.signalSession(session(A, S, "refresh")); await h.flush();
  return h;
}

test("R1: a newer pending tap replaces rejected consumed receipt after same-session rebind", async () => {
  const h = await replacedConsumedTap();
  assert.deepEqual(h.routes, [`/chat/${B}`], "only the new native-authorized tap opens, without another signal");
  assert.equal(h.log.filter(([name]) => name === "consume").length, 3);
  assert.equal(h.log.filter(([name]) => name === "revalidate").length, 1);
});

test("R1: rejected consumed receipt with no replacement drains pending at most once", async () => {
  const h = await replacedConsumedTap(source, false);
  assert.deepEqual(h.routes, []);
  assert.equal(h.log.filter(([name]) => name === "consume").length, 3);
  assert.equal(h.log.filter(([name]) => name === "revalidate").length, 1);
});

test("R3: timeout discards a queued rotation and cannot replay it from a late old RPC", async () => {
  const response = deferred(); const timeout = deferred(); const backend = []; let callback;
  const h = harness({
    rpc: (args) => { backend.push(args.p_token); return response.promise; },
    registerPush: async (register) => { callback = register("synthetic-A"); return timeout.promise; },
  });
  h.controller.signalSession(session()); await h.flush(); h.controller.tokenChanged("synthetic-B");
  timeout.resolve({ status: "native_setup_missing", message: "" }); await ticks(); await h.flush();
  response.resolve({ data: row(), error: null }); await callback; await h.flush();
  assert.deepEqual(backend, ["synthetic-A"]); assert.equal(h.bound, null);
});

for (const [name, needle, replacement, verify] of [
  ["new pending tap after consumed rejection", "actionAgain = true;\n            return;", "return;", async (implementation) => {
    const h = await replacedConsumedTap(implementation);
    assert.deepEqual(h.routes, [`/chat/${B}`]);
  }],
  ["consumed native cancellation", "await deps.bridge.revalidateConsumedAction({ ringKey: retained.event.ring_key })", "({ event: retained.event })", async (implementation) => {
    const { h } = await refreshDuringConsumedTap(implementation, "cancel");
    assert.deepEqual(h.routes, []);
  }],
  ["same-session consumed retention", "const ticket = ++generation;\n    verified = null;", "const ticket = ++generation;\n    verified = null;\n    discardAction();", async (implementation) => {
    const { h } = await refreshDuringConsumedTap(implementation);
    assert.deepEqual(h.routes, [`/chat/${C}`]);
  }],
  ["queued token rotation", "queuedRotation = { value, ticket: generation };", "queuedRotation = null;", async (implementation) => {
    const { backend } = await rotatedWhileRegistering(implementation);
    assert.deepEqual(backend, ["synthetic-A", "synthetic-C"]);
  }],
  ["JS generation", "!stopped && ticket === generation", "!stopped", async (implementation) => {
    const old = deferred(); let count = 0;
    const h = harness({ rpc: async () => ++count === 1 ? old.promise : { data: row(B, T), error: null } }, implementation);
    h.controller.signalSession(session()); await h.flush();
    h.controller.signalSession(session(B, T)); await h.flush();
    old.resolve({ data: row(), error: null }); await ticks();
    assert.equal(h.commits.length, 1);
  }],
  ["missing-RPC-only fallback", "protocol && isMissingVoiceRegistrationRpc(response.error)", "protocol && response.error", async (implementation) => {
    let count = 0;
    const h = harness({ rpc: async () => { count++; return { data: null, error: { code: "42501" } }; } }, implementation);
    h.controller.signalSession(session()); await h.flush(); assert.equal(count, 1);
  }],
  ["native epoch rejection", "if (!committed.applied)", "if (false)", async (implementation) => {
    const h = harness({}, implementation); h.deps.bridge.commitBinding = async () => ({ applied: false });
    h.controller.signalSession(session()); await h.flush(); h.setPending(action()); await h.controller.actionPending();
    assert.deepEqual(h.routes, []);
  }],
  ["post-access validity", "await deps.openChat(action.chat_id, stillValid) && stillValid()", "await deps.openChat(action.chat_id, stillValid)", async (implementation) => {
    let now = 1000; const access = deferred();
    const h = harness({ openChat: () => access.promise, now: () => now }, implementation);
    h.controller.signalSession(session()); await h.flush(); h.setPending(action());
    const operation = h.controller.actionPending(); await ticks(); now = 46000; access.resolve(true); await operation;
    assert.deepEqual(h.routes, []);
  }],
]) {
  test(`mutation killed: ${name}`, async () => {
    const url = new URL("../../artifacts/kub/src/lib/platform/nativeVoiceController.ts", import.meta.url);
    const text = readFileSync(url, "utf8");
    assert.equal(text.split(needle).length, 2, "mutation target is unique");
    await verify(source);
    const js = stripTypeScriptTypes(text.replace(needle, replacement)).replace('"./nativeVoiceContract.ts"', JSON.stringify(new URL("./nativeVoiceContract.ts", url).href));
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    await assert.rejects(() => verify(mutant), { code: "ERR_ASSERTION" });
  });
}
