import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const source = read("hooks/usePush.ts").replaceAll("\r\n", "\n");
const defaults = { push_enabled: false, message_push_enabled: true, task_push_enabled: true, invite_push_enabled: true };
const aChoices = { push_enabled: false, message_push_enabled: false, task_push_enabled: false, invite_push_enabled: true };
const bChoices = { push_enabled: false, message_push_enabled: true, task_push_enabled: true, invite_push_enabled: false };
const plain = (value) => JSON.parse(JSON.stringify(value));
const fixtures = new Set();
test.afterEach(async () => {
  for (const fixture of fixtures) await fixture.close();
  fixtures.clear();
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function compile(text, imports, globals) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [(context) => {
      const visit = (node) => ts.isMetaProperty(node) ? ts.factory.createIdentifier("testImportMeta")
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name]; },
    ...globals,
  });
  return module.exports;
}

// Stable hook slots, dependency-aware effects/cleanup and controlled await boundaries.
// Only React scheduling and external providers are synthetic; the hook and both
// preference/subscription projection modules are actually transpiled and executed.
function fixture({ text = source, native = false, holds = [], preferences = aChoices, bPreferences = bChoices } = {}) {
  const frame = () => ({ slots: [], effects: new Map(), cleanups: new Map(), cursor: 0, dirty: true, mounted: true, view: null });
  const main = frame(), frames = [main]; let active = main;
  const requests = [], calls = [], timers = new Map();
  const gates = new Map(holds.map((name) => [name, [deferred()]]));
  const choices = { A: preferences, B: bPreferences };
  const state = { currentUser: { id: "A" }, accountEpoch: 1 };
  const listeners = new Map();
  let pressing = false, timerId = 0;
  let nativeListener;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const target = active, index = target.cursor++;
      if (!(index in target.slots)) target.slots[index] = typeof initial === "function" ? initial() : initial;
      return [target.slots[index], (value) => {
        const next = typeof value === "function" ? value(target.slots[index]) : value;
        if (!Object.is(next, target.slots[index])) { target.slots[index] = next; target.dirty = true; }
      }];
    },
    useRef(initial) { const index = active.cursor++; return active.slots[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = active.cursor++;
      if (!depsEqual(active.slots[index]?.deps, deps)) active.slots[index] = { deps, callback };
      return active.slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = active.cursor++;
      if (!depsEqual(active.slots[index], deps)) { active.slots[index] = deps; active.effects.set(index, effect); }
    },
  };
  const hold = (name) => {
    const gate = deferred(); gates.set(name, [...(gates.get(name) ?? []), gate]); return gate;
  };
  const boundary = (name, fallback, details = {}) => {
    const gate = gates.get(name)?.shift();
    if (gate) requests.push({ name, gate, ...details });
    return gate ? gate.promise : Promise.resolve(fallback);
  };
  const client = {
    from(table) {
      const filters = []; let value, kind;
      const query = {
        select() { return query; }, eq(key, item) { filters.push([key, item]); return query; },
        maybeSingle() {
          const owner = filters.find(([key]) => key === "user_id")?.[1];
          calls.push({ name: "read", owner });
          return boundary("read", { data: choices[owner] ? { ...choices[owner] } : null, error: null }, { owner });
        },
        upsert(row) {
          calls.push({ name: `${table}-upsert`, value: plain(row) });
          return boundary(`${table}-upsert`, { error: null }, { value: plain(row) }).then((result) => {
            if (table === "notification_preferences" && !result.error) {
              choices[row.user_id] = Object.fromEntries(Object.keys(defaults).map((key) => [key, row[key]]));
            }
            return result;
          });
        },
        update(row) { value = row; kind = `${table}-update`; return query; },
        then(done, fail) {
          calls.push({ name: kind, value: plain(value), filters: plain(filters) });
          return boundary(kind, { error: null }, { filters: plain(filters) }).then(done, fail);
        },
      };
      return query;
    },
  };
  const key = Uint8Array.from([4, 1, 2, 3]);
  const newSubscription = () => ({
    endpoint: "https://push.fixture.invalid/synthetic", options: { applicationServerKey: key.buffer },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "synthetic-key", auth: "synthetic-auth" } }; },
    unsubscribe() {
      calls.push({ name: "unsubscribe" });
      return boundary("unsubscribe", true).then(ok => { if (ok) subscription = null; return ok; });
    },
  });
  let subscription = newSubscription();
  const registration = { pushManager: {
    getSubscription() { calls.push({ name: "get-subscription" }); return boundary("get-subscription", subscription); },
    subscribe() {
      calls.push({ name: "subscribe", pressing });
      subscription ??= newSubscription();
      return boundary("subscribe", subscription);
    },
  } };
  const serviceWorker = {
    ready: boundary("ready", registration),
    register() { return Promise.resolve(registration); },
    getRegistration() { calls.push({ name: "get-registration" }); return boundary("get-registration", registration); },
    addEventListener(name, callback) { listeners.set(`sw:${name}`, callback); },
    removeEventListener(name, callback) { if (listeners.get(`sw:${name}`) === callback) listeners.delete(`sw:${name}`); },
  };
  const events = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    dispatchEvent(event) { calls.push({ name: "event", type: event.type }); },
  };
  let nativeEpoch = 0;
  const nativeContext = () => state.currentUser ? { recipientId: state.currentUser.id, epoch: state.accountEpoch + nativeEpoch } : null;
  const globals = {
    testImportMeta: { env: { BASE_URL: "/", VITE_VAPID_PUBLIC_KEY: Buffer.from(key).toString("base64url") } },
    window: events, document: { ...events, visibilityState: "visible" },
    navigator: { serviceWorker, userAgent: "synthetic", platform: "synthetic" },
    Notification: { permission: "granted" },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
    Event: class { constructor(type) { this.type = type; } }, Date, URL, atob, Uint8Array, ArrayBuffer,
    console: { error() {} },
  };
  const imports = {
    react, "@/store/app.store": { useAppStore: Object.assign((select) => select(state), { getState: () => state }) },
    "@/lib/supabase/client": { createClient: () => client }, "@/lib/errors": { mapPgError: () => "synthetic-error" },
    "@/lib/chatJumpEvents": {}, "@/lib/safeOpenChat": {}, "@/lib/chatRoute": {},
    "@/lib/platform/capabilities": { isNativeAndroid: () => native, isNativeApp: () => native, supportsBrowserPush: () => !native, nativePushPendingMessage: () => "native-pending" },
    "@/lib/plainMessages": { BROWSER_PUSH_UNAVAILABLE: "browser-unavailable", PUSH_UNAVAILABLE: "push-unavailable" },
    "@/lib/platform/desktop": { isDesktopApp: () => false }, "@/lib/platform/desktopNotifications": {},
    "@/lib/platform/nativePush": { getNativePushPermissionStatus: () => boundary("native-permission", { status: "native_inactive", message: null }) },
    "@/lib/platform/nativeVoiceCalls": {
      nativeVoiceContext: nativeContext,
      isCurrentNativeVoiceContext: (owner) => owner?.recipientId === state.currentUser?.id && owner?.epoch === state.accountEpoch + nativeEpoch,
      enableNativeVoicePush() { calls.push({ name: "native-enable" }); return boundary("native-enable", { status: "native_active", message: null }); },
      disableNativeVoicePush() { calls.push({ name: "native-disable" }); return boundary("native-disable", { status: "native_inactive", message: null }); },
      nativeVoicePushSnapshot: () => null,
      subscribeNativeVoicePush(callback) { nativeListener = callback; return () => { nativeListener = null; }; },
    },
    "@/lib/pushNavigationQueue": {},
    "@/lib/browserPushSubscription": compile(read("lib/browserPushSubscription.ts"), {}, globals),
    "@/lib/pushPreferences": compile(read("lib/pushPreferences.ts"), {}, globals),
  };
  const hook = compile(text, imports, globals).usePush;
  function render(target = main) { active = target; target.cursor = 0; target.dirty = false; target.view = hook(); return target.view; }
  function commit(target = main) {
    const work = [...target.effects]; target.effects.clear();
    for (const [index] of work) target.cleanups.get(index)?.();
    for (const [index, effect] of work) target.cleanups.set(index, effect());
  }
  async function drain() {
    for (let i = 0; i < 40; i++) {
      await Promise.resolve();
      for (const target of frames) {
        if (target.mounted && target.dirty) render(target);
        if (target.mounted && target.effects.size) commit(target);
      }
    }
  }
  render(); commit();
  const fixture = {
    calls, requests, state, registration, hold, drain,
    get view() { return main.view; },
    get subscription() { return subscription; },
    switchOwner(id, renderNow = true) {
      state.currentUser = id ? { id } : null; state.accountEpoch++;
      if (renderNow) for (const target of frames) { render(target); commit(target); }
    },
    render,
    press(action = main.view.enable) { pressing = true; const pending = action(); pressing = false; return pending; },
    event(name) { listeners.get(name)?.({ data: { type: "KUB_PUSH_SUBSCRIPTION_CHANGED" } }); },
    staleKey() { subscription.options.applicationServerKey = Uint8Array.from([9]).buffer; },
    setSubscription(value) { subscription = value; },
    unmount() { for (const target of frames) { target.mounted = false; for (const cleanup of target.cleanups.values()) cleanup?.(); target.cleanups.clear(); } },
    newInstance() {
      const target = frame(); frames.push(target); render(target); commit(target);
      return { get view() { return target.view; } };
    },
    async close() {
      fixture.unmount();
      for (const request of requests) {
        const value = request.name === "read" ? { data: choices[request.owner] ?? null, error: null }
          : request.name === "subscribe" || request.name === "get-subscription" || request.name === "ready" ? subscription
          : request.name === "get-registration" ? registration
          : request.name.startsWith("native-") ? { status: "native_inactive", message: null }
          : request.name === "unsubscribe" ? true : { error: null };
        request.gate.resolve(value);
      }
      await drain(); timers.clear();
    },
    timer() { for (const callback of timers.values()) callback(); timers.clear(); },
    nativeUpdate() { nativeListener?.(); },
    rotateNativeContext() { nativeEpoch++; },
  };
  fixtures.add(fixture);
  return fixture;
}

async function loaded(options) { const f = fixture(options); await f.drain(); return f; }
const writes = (f) => f.calls.filter((item) => item.name === "notification_preferences-upsert");

async function lateRead(text = source, error = null) {
  const f = fixture({ text, holds: ["read"] });
  await f.drain();
  assert.equal(f.view.loadingPreferences, true, "held read positive control");
  f.switchOwner("B"); await f.drain();
  assert.deepEqual(plain(f.view.preferences), bChoices, "B read positive control");
  f.requests[0].gate.resolve({ data: aChoices, error }); await f.drain();
  assert.deepEqual(plain(f.view.preferences), bChoices, "old A response cannot publish into B");
  assert.equal(f.view.message, null, "old A error cannot publish into B");
  const pending = f.view.setPreference("invite_push_enabled", true); await f.drain(); await pending;
  assert.equal(writes(f).at(-1).value.message_push_enabled, true, "B upsert cannot copy A choices");
  f.unmount();
}

test("actual hook: delayed A preferences cannot leak into B's next upsert", () => lateRead());
test("actual hook: old account read errors cannot overwrite B feedback", () => lateRead(source, { code: "42501" }));
test("actual hook: logout resets choices and retires pending reads", async () => {
  const f = await loaded(); f.hold("read"); const refresh = f.view.refresh(); await f.drain();
  f.switchOwner(null); await f.drain();
  assert.deepEqual(plain(f.view.preferences), defaults, "logout resets account choices");
  assert.equal(f.view.loadingPreferences, false);
  f.requests.at(-1).gate.resolve({ data: aChoices, error: null }); await refresh; await f.drain();
  assert.deepEqual(plain(f.view.preferences), defaults, "logged-out response is inert"); f.unmount();
});
async function epochRead(text = source) {
  const f = await loaded({ text }); const gate = f.hold("read"); const pending = f.view.refresh(); await f.drain();
  f.switchOwner("A"); await f.drain();
  const edit = f.view.setPreference("message_push_enabled", true); await f.drain(); await edit;
  gate.resolve({ data: aChoices, error: null }); await pending; await f.drain();
  assert.equal(f.view.preferences.message_push_enabled, true, "same actor new epoch retires old reads"); f.unmount();
}
test("actual hook: same user with a replaced accountEpoch retires old reads", () => epochRead());
async function newestRead(text = source) {
  const f = await loaded({ text }); const older = f.hold("read"); const first = f.view.refresh(); await f.drain();
  const latest = f.hold("read"); const second = f.view.refresh(); await f.drain();
  latest.resolve({ data: bChoices, error: null }); await second; await f.drain();
  older.resolve({ data: aChoices, error: null }); await first; await f.drain();
  assert.equal(f.view.preferences.invite_push_enabled, false, "latest preference read owns the row"); f.unmount();
}
test("actual hook: inverse read completion keeps the latest refresh", () => newestRead());
async function draftRead(text = source) {
  const f = await loaded({ text }); const held = f.hold("read"); const refresh = f.view.refresh(); await f.drain();
  const edit = f.view.setPreference("message_push_enabled", true); await f.drain(); await edit;
  held.resolve({ data: aChoices, error: null }); await refresh; await f.drain();
  assert.equal(f.view.preferences.message_push_enabled, true, "a newer draft wins over the pending read"); f.unmount();
}
test("actual hook: a read started before editing cannot replace the newer draft", () => draftRead());
test("actual hook: a captured A callback cannot dispatch after switching without rerender", async () => {
  const f = await loaded(); const old = f.view;
  f.switchOwner("B", false);
  await old.setPreference("invite_push_enabled", false); await f.drain();
  assert.equal(writes(f).length, 0, "actual current owner fences even a stale rendered callback"); f.unmount();
});
test("actual hook: newly rendered B callback never copies A's pre-effect row", async () => {
  const f = await loaded(); f.switchOwner("B", false); const view = f.render();
  const pending = view.setPreference("invite_push_enabled", true); await f.drain(); await pending;
  assert.equal(writes(f).at(-1).value.message_push_enabled, true, "new owner's draft is reset before effects"); f.unmount();
});
async function serializedDraft(text = source) {
  const f = await loaded({ text }); const failed = f.hold("notification_preferences-upsert");
  const old = f.view;
  const first = old.setPreference("message_push_enabled", true); await f.drain();
  const second = old.setPreference("task_push_enabled", true); await f.drain();
  assert.equal(writes(f).length, 1, "preference writes serialize behind an already issued row");
  failed.resolve({ error: { code: "42501" } }); await first; await f.drain(); await second;
  assert.equal(f.view.preferences.message_push_enabled, true, "old failure cannot roll back a newer draft");
  assert.equal(writes(f).at(-1).value.message_push_enabled, true, "second field save retains the latest first field");
  assert.equal(writes(f).at(-1).value.task_push_enabled, true);
  f.unmount();
}
test("actual hook: rapid whole-row saves serialize and old rollback cannot erase a newer field", () => serializedDraft());
test("actual hook: current save failure still rolls back its own draft", async () => {
  const f = await loaded(); const held = f.hold("notification_preferences-upsert");
  const pending = f.view.setPreference("message_push_enabled", true); await f.drain();
  held.resolve({ error: { code: "42501" } }); await pending; await f.drain();
  assert.equal(f.view.preferences.message_push_enabled, false); assert.equal(f.view.message, "synthetic-error"); f.unmount();
});
async function lastAckRollback(text = source, firstAcknowledged = false) {
    const f = await loaded({ text }); const firstGate = f.hold("notification_preferences-upsert");
    const first = f.view.setPreference("message_push_enabled", true); await f.drain();
    const skipped = f.view.setPreference("task_push_enabled", true); await f.drain();
    const lastGate = f.hold("notification_preferences-upsert");
    const latest = f.view.setPreference("invite_push_enabled", false); await f.drain();
    firstGate.resolve({ error: firstAcknowledged ? null : { code: "42501" } });
    await first; await skipped; await f.drain();
    lastGate.resolve({ error: { code: "42501" } }); await latest; await f.drain();
    assert.deepEqual(plain(f.view.preferences), {
      push_enabled: false, message_push_enabled: firstAcknowledged, task_push_enabled: false, invite_push_enabled: true,
    }, "latest failure restores only ACK-confirmed choices"); f.unmount();
}
for (const firstAcknowledged of [false, true]) {
  test(`actual hook: latest failure restores the last ACK, not skipped optimistic drafts (${firstAcknowledged})`, () => lastAckRollback(source, firstAcknowledged));
}
async function multipleInstances(text = source) {
  const f = await loaded({ text }); const other = f.newInstance(); await f.drain();
  const first = f.view.setPreference("message_push_enabled", true); await f.drain(); await first;
  const second = other.view.setPreference("invite_push_enabled", false); await f.drain(); await second;
  assert.equal(writes(f).at(-1).value.message_push_enabled, true, "another hook's stale row must not erase confirmed categories");
  assert.equal(writes(f).at(-1).value.invite_push_enabled, false); f.unmount();
}
test("actual hook: a second instance's category save preserves another instance's confirmed choice", () => multipleInstances());
test("actual hook: retired account write error cannot roll B back or mark migration missing", async () => {
  const f = await loaded(); const held = f.hold("notification_preferences-upsert");
  const pending = f.view.setPreference("message_push_enabled", true); await f.drain();
  f.switchOwner("B"); await f.drain();
  held.resolve({ error: { code: "PGRST205" } }); await pending; await f.drain();
  assert.deepEqual(plain(f.view.preferences), bChoices, "old write rollback cannot replace B choices");
  assert.notEqual(f.view.status, "migration_missing"); f.unmount();
});
async function gesture(text = source) {
  const f = await loaded({ text }); assert.equal(f.view.readyForPrompt, true);
  const pending = f.press();
  assert.equal(f.calls.filter((item) => item.name === "subscribe" && item.pressing).length, 1, "subscribe keeps the original user gesture");
  await pending; await f.drain(); assert.equal(f.view.status, "active"); f.unmount();
}
test("actual hook: enable invokes real subscribe synchronously during the gesture", () => gesture());
async function lateSubscribe(text = source) {
  const f = await loaded({ text }); const held = f.hold("subscribe"); const pending = f.press(); await f.drain();
  f.switchOwner("B"); await f.drain();
  held.resolve(f.subscription); await pending; await f.drain();
  assert.equal(f.calls.filter((item) => item.name === "push_subscriptions-upsert").length, 0, "late subscribe cannot register the retired account");
  assert.deepEqual(plain(f.view.preferences), bChoices); f.unmount();
}
test("actual hook: subscribed result arriving after account switch cannot register or persist", () => lateSubscribe());
test("actual hook: enable persists the latest draft after subscription registration waits", async () => {
  const f = await loaded(); const held = f.hold("push_subscriptions-upsert"); const enable = f.press(); await f.drain();
  const edit = f.view.setPreference("message_push_enabled", true); await f.drain(); await edit;
  held.resolve({ error: null }); await enable; await f.drain();
  assert.equal(writes(f).at(-1).value.message_push_enabled, true, "enable must not persist its captured preference row"); f.unmount();
});
async function latestOperation(text = source) {
  const f = await loaded({ text }); const previous = f.subscription, held = f.hold("subscribe"); const enable = f.press(); await f.drain();
  f.setSubscription(null);
  await f.view.disable(); await f.drain(); const before = writes(f).length;
  held.resolve(previous); await enable; await f.drain();
  assert.equal(writes(f).length, before, "latest browser operation fences the older enable");
  assert.equal(f.view.preferences.push_enabled, false); f.unmount();
}
test("actual hook: newer disable retires an enable still awaiting subscribe", () => latestOperation());
async function lateDisable(text = source) {
  const f = await loaded({ text }); const held = f.hold("push_subscriptions-update"); const pending = f.view.disable(); await f.drain();
  f.switchOwner("B"); await f.drain();
  held.resolve({ error: null }); await pending; await f.drain();
  assert.equal(f.calls.filter((item) => item.name === "unsubscribe").length, 0, "retired disable cannot unsubscribe after its server wait"); f.unmount();
}
test("actual hook: disable cannot unsubscribe B's browser subscription after an A server wait", () => lateDisable());
async function scopedDisable(text = source) {
  const f = await loaded({ text }); await f.view.disable(); await f.drain();
  assert.deepEqual(f.calls.find((item) => item.name === "push_subscriptions-update").filters,
    [["user_id", "A"], ["endpoint", "https://push.fixture.invalid/synthetic"]], "disable update is user scoped"); f.unmount();
}
test("actual hook: disable deactivates only the captured user's endpoint row", () => scopedDisable());
test("actual hook: reconcile cannot write or unsubscribe after account changes during subscription lookup", async () => {
  const f = await loaded(); f.staleKey(); const held = f.hold("get-subscription");
  f.event("sw:message"); await f.drain(); const before = f.calls.length;
  f.switchOwner("B"); await f.drain(); const bEnd = f.calls.length;
  held.resolve(f.subscription); await f.drain();
  assert.equal(f.calls.slice(bEnd).some((item) => item.name === "push_subscriptions-update" || item.name === "unsubscribe"), false,
    "retired reconcile cannot continue provider effects"); assert.ok(before > 0); f.unmount();
});
test("actual hook: old reconcile finally cannot mark B ready while B lookup is held", async () => {
  const f = await loaded(); const old = f.hold("get-subscription"); f.event("sw:message"); await f.drain();
  const current = f.hold("get-subscription"); f.switchOwner("B"); await f.drain();
  old.resolve(f.subscription); await f.drain();
  assert.equal(f.view.readyForPrompt, false, "B readiness belongs to B's own reconcile");
  current.resolve(f.subscription); await f.drain(); assert.equal(f.view.readyForPrompt, true); f.unmount();
});
async function reconciliationAfterDraft(text = source) {
  const f = fixture({ text, holds: ["get-subscription"] }); await f.drain();
  assert.equal(f.view.readyForPrompt, false, "held initial reconcile positive control");
  assert.equal(f.calls.filter((item) => item.name === "get-subscription").length, 1);
  const edit = f.view.setPreference("task_push_enabled", true); await f.drain(); await edit;
  f.requests.find((item) => item.name === "get-subscription").gate.resolve(f.subscription); await f.drain();
  assert.equal(f.view.readyForPrompt, true, "newest same-owner draft gets its own reconcile without another event");
  assert.equal(f.calls.filter((item) => item.name === "get-subscription").length, 2, "exactly one follow-up reconcile");
  await f.drain();
  assert.equal(f.calls.filter((item) => item.name === "get-subscription").length, 2, "settled reconciliation does not loop"); f.unmount();
}
test("actual hook: a category edit during initial reconcile schedules the newest draft once", () => reconciliationAfterDraft());
async function reconciliationAfterRollback(text = source) {
  const f = await loaded({ text });
  const registration = f.hold("push_subscriptions-upsert"), preference = f.hold("notification_preferences-upsert");
  const enable = f.press(); await f.drain();
  const reconcile = f.hold("push_subscriptions-upsert"); registration.resolve({ error: null }); await f.drain();
  assert.equal(f.calls.filter((item) => item.name === "push_subscriptions-upsert").length, 2, "optimistic push reconcile reached its held write");
  preference.resolve({ error: { code: "42501" } }); await enable; await f.drain();
  reconcile.resolve({ error: null }); await f.drain();
  assert.equal(f.view.preferences.push_enabled, false);
  assert.equal(f.view.status, "inactive", "a rolled-back push draft cannot be reactivated by its old reconcile ACK"); f.unmount();
}
test("actual hook: preference rollback retires an optimistic reconcile awaiting server ACK", () => reconciliationAfterRollback());
async function unsubscribeLease(text = source) {
  const f = await loaded({ text }); const held = f.hold("unsubscribe"); const disable = f.view.disable(); await f.drain();
  f.switchOwner("B"); await f.drain(); await f.press();
  assert.equal(f.calls.filter((item) => item.name === "subscribe").length, 0, "subscribe waits for removal via a later user gesture");
  held.resolve(true); await disable; await f.drain(); await f.press(); await f.drain();
  assert.equal(f.calls.filter((item) => item.name === "subscribe").length, 1); f.unmount();
}
test("actual hook: B enable does not replace a browser subscription while old unsubscribe is in flight", () => unsubscribeLease());
async function automaticProviderDeletion(text = source, remount = false) {
  const f = await loaded({ text, preferences: { ...aChoices, push_enabled: true }, bPreferences: { ...bChoices, push_enabled: true } });
  assert.equal(f.view.status, "active", "A active provider positive control");
  const held = f.hold("unsubscribe"), pending = f.view.disable(); await f.drain();
  assert.equal(f.calls.filter(item => item.name === "unsubscribe").length, 1, "old A deletion is actually held");
  let view = () => f.view;
  if (remount) {
    f.switchOwner("B", false); f.unmount();
    const next = f.newInstance(); view = () => next.view;
  } else f.switchOwner("B");
  await f.drain();
  assert.equal(f.calls.filter(item => item.name === "push_subscriptions-upsert" && item.value.user_id === "B").length, 0,
    "B automatic reconcile cannot register a subscription pending deletion");
  assert.notEqual(view().status, "active", "B cannot be active while provider deletion is held");
  assert.equal(view().readyForPrompt, false, "provider deletion must settle before new gesture readiness");
  held.resolve(true); await pending; await f.drain();
  assert.equal(await f.registration.pushManager.getSubscription(), null, "settled provider deletion positive control");
  assert.equal(view().status, "inactive", "B automatically rereads the deleted provider without an external event");
  assert.equal(view().readyForPrompt, true, "fresh provider absence permits a new user gesture");
  assert.equal(f.calls.filter(item => item.name === "push_subscriptions-upsert" && item.value.user_id === "B").length, 0);
  f.unmount();
}
test("actual hook: stored-enabled B waits for old deletion and automatically rereads the settled provider", () => automaticProviderDeletion());
test("actual hook: remounted stored-enabled B observes old hook provider deletion settlement", () => automaticProviderDeletion(source, true));
async function immutableProviderRead(text = source) {
  const f = await loaded({ text, preferences: { ...aChoices, push_enabled: true } });
  const previous = f.subscription, read = f.hold("get-subscription"); f.event("sw:message"); await f.drain();
  const other = f.newInstance(); await f.drain();
  const removal = f.hold("unsubscribe"), pending = other.view.disable(); await f.drain();
  removal.resolve(true); await pending; await f.drain();
  assert.equal(await f.registration.pushManager.getSubscription(), null, "provider is absent before immutable old read arrives");
  const before = f.calls.filter(item => item.name === "push_subscriptions-upsert").length;
  read.resolve(previous); await f.drain();
  assert.equal(f.calls.filter(item => item.name === "push_subscriptions-upsert").length, before,
    "immutable provider snapshot must lose to another hook's deletion revision");
  assert.equal(f.view.status, "inactive"); assert.equal(f.view.readyForPrompt, true); f.unmount();
}
test("actual hook: held immutable provider read loses to a deletion in another same-owner instance", () => immutableProviderRead());
async function providerWriteAck(text = source) {
  const f = await loaded({ text, preferences: { ...aChoices, push_enabled: true } });
  const ack = f.hold("push_subscriptions-upsert"); f.event("sw:message"); await f.drain();
  const other = f.newInstance(); await f.drain();
  const pending = other.view.disable(); await f.drain(); await pending;
  assert.equal(await f.registration.pushManager.getSubscription(), null);
  ack.resolve({ error: null }); await f.drain();
  assert.equal(f.view.status, "inactive", "already issued provider ACK cannot reactivate a deleted subscription");
  assert.equal(f.view.readyForPrompt, true); f.unmount();
}
test("actual hook: held reconcile ACK cannot reactivate a provider deleted by another instance", () => providerWriteAck());
async function heldBrowserSubscribe(text = source) {
  const f = await loaded({ text, preferences: { ...aChoices, push_enabled: true } });
  const previous = f.subscription, held = f.hold("subscribe"), pending = f.press(); await f.drain();
  const other = f.newInstance(); await f.drain();
  const disable = other.view.disable(); await f.drain(); await disable;
  assert.equal(await f.registration.pushManager.getSubscription(), null);
  const before = f.calls.filter(item => item.name === "push_subscriptions-upsert").length;
  held.resolve(previous); await pending; await f.drain();
  assert.equal(f.calls.filter(item => item.name === "push_subscriptions-upsert").length, before,
    "held subscribe result must lose to another instance's deletion revision"); f.unmount();
}
test("actual hook: manual enable refuses its held immutable result after same-owner provider deletion", () => heldBrowserSubscribe());
async function heldBrowserDisable(text = source) {
  const f = await loaded({ text, preferences: { ...aChoices, push_enabled: true } });
  const previous = f.subscription, held = f.hold("get-subscription"), pending = f.view.disable(); await f.drain();
  const other = f.newInstance(); await f.drain();
  const disable = other.view.disable(); await f.drain(); await disable;
  await f.press(other.view.enable); await f.drain();
  assert.ok(f.subscription && f.subscription !== previous, "new instance created a replacement provider");
  const before = f.calls.filter(item => item.name === "unsubscribe").length;
  held.resolve(previous); await pending; await f.drain();
  assert.equal(f.calls.filter(item => item.name === "unsubscribe").length, before,
    "old immutable disable read cannot remove the replacement provider");
  assert.ok(await f.registration.pushManager.getSubscription()); f.unmount();
}
test("actual hook: manual disable refuses an immutable read superseded by replacement in another instance", () => heldBrowserDisable());
test("actual hook: refused stale-key unsubscribe does not create an automatic removal loop", async () => {
  const f = await loaded(); f.staleKey(); const held = f.hold("unsubscribe"); f.event("sw:message"); await f.drain();
  held.resolve(false); await f.drain();
  assert.equal(f.calls.filter(item => item.name === "unsubscribe").length, 1);
  assert.ok(await f.registration.pushManager.getSubscription());
  assert.equal(f.view.status, "inactive"); assert.equal(f.view.readyForPrompt, true);
  await f.drain(); assert.equal(f.calls.filter(item => item.name === "unsubscribe").length, 1); f.unmount();
});
async function refusedRemovalAcrossInstances(text = source) {
  const f = await loaded({ text }); f.newInstance(); await f.drain();
  f.staleKey(); const held = f.hold("unsubscribe"); f.event("sw:message"); await f.drain();
  assert.equal(f.calls.filter(item => item.name === "unsubscribe").length, 1, "first stale-key cleanup is actually held");
  held.resolve(false); await f.drain();
  assert.equal(f.calls.filter(item => item.name === "unsubscribe").length, 1,
    "provider settlement reads cannot bounce refused cleanup between mounted hooks");
  assert.equal(f.view.status, "inactive"); assert.equal(f.view.readyForPrompt, true); f.unmount();
}
test("actual hook: refused cleanup settlement cannot bounce removals between two mounted hooks", () => refusedRemovalAcrossInstances());
test("actual hook: native enable uses current owner choices, not the row before its wait", async () => {
  const f = await loaded({ native: true }); const held = f.hold("native-enable"); const pending = f.press(); await f.drain();
  const edit = f.view.setPreference("message_push_enabled", true); await f.drain(); await edit;
  held.resolve({ status: "native_active", message: null }); await pending; await f.drain();
  assert.equal(writes(f).at(-1).value.message_push_enabled, true, "native enable takes the latest owned draft"); f.unmount();
});
test("actual hook: native context guard still rejects a retired native enable", async () => {
  const f = await loaded({ native: true }); const held = f.hold("native-enable"); const pending = f.press(); await f.drain();
  f.switchOwner("B"); await f.drain(); held.resolve({ status: "native_active", message: null }); await pending; await f.drain();
  assert.equal(writes(f).length, 0); assert.deepEqual(plain(f.view.preferences), bChoices); f.unmount();
});
async function nativeDraftCompletion(text = source) {
  const f = await loaded({ text, native: true }); const held = f.hold("notification_preferences-upsert");
  const enable = f.press(); await f.drain();
  const edit = f.view.setPreference("message_push_enabled", true); await f.drain();
  held.resolve({ error: { code: "42501" } }); await enable; await f.drain(); await edit;
  assert.equal(f.calls.filter((item) => item.name === "native-disable").length, 0, "retired preference ACK must not disable the newest native intent");
  assert.equal(writes(f).at(-1).value.push_enabled, true); assert.equal(writes(f).at(-1).value.message_push_enabled, true); f.unmount();
}
test("actual hook: retired native preference ACK does not undo a newer category draft", () => nativeDraftCompletion());
test("actual hook: native session context guard remains independent of app accountEpoch", async () => {
  const f = await loaded({ native: true }); const held = f.hold("native-enable"); const pending = f.press(); await f.drain();
  f.rotateNativeContext(); held.resolve({ status: "native_active", message: null }); await pending; await f.drain();
  assert.equal(writes(f).length, 0, "native session changes retire native enable persistence"); f.unmount();
});
async function epochCallback(text = source) {
  const f = await loaded({ text }); const old = f.view; f.switchOwner("A", false);
  await old.setPreference("message_push_enabled", true); await f.drain();
  assert.equal(writes(f).length, 0, "actual epoch fences a callback before React rerenders"); f.unmount();
}
test("actual hook: actual accountEpoch fences callbacks before rerender", () => epochCallback());
async function actorCallback(text = source) {
  const f = await loaded({ text }); const old = f.view;
  f.state.currentUser = { id: "B" };
  await old.setPreference("message_push_enabled", true); await f.drain();
  assert.equal(writes(f).length, 0, "actual actor independently fences the captured callback"); f.unmount();
}
test("actual hook: actual current actor is checked independently of the render snapshot", () => actorCallback());
async function unmountedRead(text = source) {
  const f = fixture({ text, holds: ["read"] }); await f.drain(); const before = plain(f.view.preferences); f.unmount();
  f.requests[0].gate.resolve({ data: aChoices, error: null }); await f.drain();
  assert.deepEqual(plain(f.render().preferences), before, "unmounted hook ignores its late read");
}
test("actual hook: unmounted read cannot publish into retained hook state", () => unmountedRead());

const mutants = [
  ["omit actual account epoch", " && actual.accountEpoch === candidate.accountEpoch", "", epochCallback,
    "actual epoch fences a callback before React rerenders"],
  ["omit actual actor", "actual.currentUser?.id === candidate.userId", "true", actorCallback,
    "actual actor independently fences the captured callback"],
  ["omit mounted owner fence", "mountedRef.current && ownerRef.current === candidate", "ownerRef.current === candidate", unmountedRead,
    "unmounted hook ignores its late read"],
  ["publish retired read", ".maybeSingle();\n      if (!isCurrentOwner(owner) || owner.read !== read) return;",
    ".maybeSingle();", (text) => lateRead(text, { code: "42501" }), "old A error cannot publish into B"],
  ["publish older read", ".maybeSingle();\n      if (!isCurrentOwner(owner) || owner.read !== read) return;",
    ".maybeSingle();\n      if (!isCurrentOwner(owner)) return;", newestRead, "latest preference read owns the row"],
  ["overwrite newer draft with read", "if (owner.draft !== draft || owner.ack !== ack || Object.keys(owner.changes).length > 0) {", "if (false) {",
    draftRead, "a newer draft wins over the pending read"],
  ["bypass whole-row write ordering", "preferenceWrites.get(userId) ?? Promise.resolve()", "Promise.resolve()",
    serializedDraft, "preference writes serialize behind an already issued row"],
  ["rollback optimistic rather than confirmed row", "owner.preferences = owner.confirmed;\n      setPreferences(owner.confirmed);",
    "owner.preferences = next;\n      setPreferences(next);", lastAckRollback, "latest failure restores only ACK-confirmed choices"],
  ["merge stale per-hook category row", "changes = { ...owner.changes };", "changes = { ...owner.preferences };",
    multipleInstances, "another hook's stale row must not erase confirmed categories"],
  ["lose user gesture before subscribe", "const subscriptionOperation = subscribeDuringUserGesture", "await Promise.resolve();\n      const subscriptionOperation = subscribeDuringUserGesture",
    gesture, "subscribe keeps the original user gesture"],
  ["continue after retired subscribe", "const sub = await subscriptionOperation;\n      if (!currentBrowser()) return;", "const sub = await subscriptionOperation;",
    lateSubscribe, "late subscribe cannot register the retired account"],
  ["ignore newer enable-disable operation", "const enable = useCallback(async () => {\n    if (!owner.userId || !isCurrentOwner(owner)) return;\n    const revision = ++owner.operation;\n    const current = () => isCurrentOwner(owner) && owner.operation === revision;",
    "const enable = useCallback(async () => {\n    if (!owner.userId || !isCurrentOwner(owner)) return;\n    const revision = ++owner.operation;\n    const current = () => isCurrentOwner(owner);",
    latestOperation, "latest browser operation fences the older enable"],
  ["remove disable user predicate", '.eq("user_id", owner.userId)\n          .eq("endpoint", sub.endpoint);', '.eq("endpoint", sub.endpoint);',
    scopedDisable, "disable update is user scoped"],
  ["replace pending browser removal", "!browserReconciled || browserUnsubscribes > 0", "false", unsubscribeLease,
    "subscribe waits for removal via a later user gesture"],
  ["disable native binding on retired category ACK", 'if (saved === "retired") return;\n        if (saved === "failed") {', 'if (saved !== "saved") {', nativeDraftCompletion,
    "retired preference ACK must not disable the newest native intent"],
  ["omit newest same-owner reconcile", "else if (isCurrentOwner(owner) && browserUnsubscribes === 0) void reconcileBrowserSubscription(true, settlementRead || providerRevision !== browserProviderRevision);", "", reconciliationAfterDraft,
    "newest same-owner draft gets its own reconcile without another event"],
  ["keep rolled-back draft valid", "owner.draft += 1;", "", reconciliationAfterRollback,
    "a rolled-back push draft cannot be reactivated by its old reconcile ACK"],
  ["lose provider deletion lease", "browserUnsubscribes += 1;", "browserUnsubscribes += 0;", automaticProviderDeletion,
    "B automatic reconcile cannot register a subscription pending deletion"],
  ["omit provider settlement wake", "if (browserUnsubscribes === 0) notifyBrowserProviderObservers();", "", automaticProviderDeletion,
    "fresh provider absence permits a new user gesture"],
  ["omit provider observer registration", "browserProviderObservers.add(providerChanged);", "", text => automaticProviderDeletion(text, true),
    "fresh provider absence permits a new user gesture"],
  ["ignore immutable reconcile provider revision", "owner.draft === draft\n      && browserUnsubscribes === 0 && providerRevision === browserProviderRevision;",
    "owner.draft === draft\n      && browserUnsubscribes === 0;", immutableProviderRead,
    "immutable provider snapshot must lose to another hook's deletion revision"],
  ["ignore immutable manual enable provider revision", "const providerRevision = browserProviderRevision;\n    const currentBrowser = () => current() && browserUnsubscribes === 0 && providerRevision === browserProviderRevision;",
    "const providerRevision = browserProviderRevision;\n    const currentBrowser = () => current() && browserUnsubscribes === 0;", heldBrowserSubscribe,
    "held subscribe result must lose to another instance's deletion revision"],
  ["ignore immutable manual disable provider revision", "let providerRevision = browserProviderRevision;\n      const currentBrowser = () => current() && browserUnsubscribes === 0 && providerRevision === browserProviderRevision;",
    "let providerRevision = browserProviderRevision;\n      const currentBrowser = () => current() && browserUnsubscribes === 0;", heldBrowserDisable,
    "old immutable disable read cannot remove the replacement provider"],
  ["retry failed cleanup on provider settlement", "if (!settlementRead) {", "if (true) {", refusedRemovalAcrossInstances,
    "provider settlement reads cannot bounce refused cleanup between mounted hooks"],
];

for (const [name, before, after, scenario, oracle] of mutants) {
  test(`compiled source mutation refused: ${name}`, async () => {
    assert.equal(source.split(before).length - 1, 1, "mutant must change exactly one owned production boundary");
    await assert.rejects(() => scenario(source.replace(before, after)), (error) => {
      assert.equal(error.code, "ERR_ASSERTION", "compile/setup errors do not kill a mutant");
      assert.equal(error.message.split("\n")[0], oracle, "the independent literal behavior oracle must fail");
      return true;
    });
  });
}
