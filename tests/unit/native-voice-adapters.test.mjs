import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const ticks = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

function fixture({ native = true, plugin = true, permission = "granted", providerError = null, onRegister = null, onOpen = null, revalidationMissing = false, pushEnabled = true, preferenceError = null, transformController = (text) => text } = {}) {
  const effects = [], timers = new Map(), pushListeners = new Map(), voiceListeners = new Map(), appListeners = new Map();
  let timerId = 0, authListener, storeListener, pending = null, consumed = null;
  const state = { currentUser: { id: U } };
  const session = { user: { id: U }, access_token: `e30.${Buffer.from(JSON.stringify({ sub: U, session_id: S })).toString("base64url")}.fixture` };
  let epoch = 0;
  let registrationToken = "synthetic-registration";
  let serverPushEnabled = pushEnabled;
  const hookState = []; let hookCursor = 0;
  const addListener = (map, name, listener) => {
    const list = map.get(name) ?? new Set(); list.add(listener); map.set(name, list);
    return Promise.resolve({ remove: async () => { list.delete(listener); effects.push(["removed", name]); } });
  };
  const emit = (map, name, value) => { for (const listener of map.get(name) ?? []) listener(value); };
  const voice = {
    getCapabilities: async () => ({ protocol: 1 }),
    beginBinding: async (value) => { effects.push(["begin", value]); return { epoch: String(++epoch) }; },
    commitBinding: async (value) => { effects.push(["commit", value]); return { applied: value.epoch === String(epoch) }; },
    clearBinding: async () => { ++epoch; consumed = null; effects.push(["clear"]); },
    setCallsAllowed: async (value) => { if (!value.allowed) consumed = null; effects.push(["calls", value.allowed]); },
    setForegroundRing: async (value) => { effects.push(["foreground", value.ringKey]); },
    consumePendingAction: async () => { const event = pending; pending = null; if (event) consumed = event; return { event }; },
    revalidateConsumedAction: async ({ ringKey }) => {
      effects.push(["revalidate", ringKey]);
      if (revalidationMissing) throw new Error("not implemented");
      return { event: consumed?.ring_key === ringKey ? consumed : null };
    },
    addListener: (name, callback) => addListener(voiceListeners, name, callback),
  };
  const push = {
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => { effects.push(["permissionPrompt"]); permission = "granted"; return { receive: "granted" }; },
    createChannel: async () => {},
    register: async () => {
      effects.push(["register"]);
      if (providerError) emit(pushListeners, "registrationError", providerError);
      else emit(pushListeners, "registration", { value: registrationToken });
    },
    unregister: async () => { effects.push(["unregister"]); },
    addListener: (name, callback) => addListener(pushListeners, name, callback),
  };
  const supabase = {
    auth: {
      onAuthStateChange: (callback) => { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session }, error: null }),
    },
    from: (table) => {
      assert.equal(table, "notification_preferences");
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { push_enabled: serverPushEnabled }, error: null }),
        upsert: async (value) => {
          effects.push(["preference", value.user_id, value.push_enabled]);
          if (!preferenceError) serverPushEnabled = value.push_enabled;
          return { error: preferenceError };
        },
      }; return query;
    },
    rpc: async (name, args) => {
      effects.push(["rpc", name, args]);
      if (name === "register_push_device" && onRegister) return onRegister(args);
      return { data: name === "register_push_device" ? [{ recipient_id: U, recipient_session_id: S }] : true, error: null };
    },
  };
  const events = { addEventListener() {}, removeEventListener() {} };
  const window = {
    ...events, androidBridge: { postMessage() {} },
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    history: { pushState: (_state, _title, path) => { effects.push(["navigate", path]); } }, dispatchEvent() {},
  };
  const boundary = {
    react: {
      useCallback: (callback) => callback, useEffect() {}, useRef: (current) => ({ current }),
      useState: (initial) => {
        const index = hookCursor++;
        if (!(index in hookState)) hookState[index] = initial;
        return [hookState[index], (value) => { hookState[index] = typeof value === "function" ? value(hookState[index]) : value; }];
      },
    },
    "@capacitor/core": { registerPlugin: (name) => { assert.equal(name, "VoiceCalls"); return voice; } },
    "@capacitor/app": { App: { addListener: (name, callback) => addListener(appListeners, name, callback) } },
    "@capacitor/push-notifications": { PushNotifications: push },
    [resolve(root, "lib/platform/capabilities.ts")]: { isNativeAndroid: () => native, supportsCapacitorPlugin: () => plugin },
    [resolve(root, "lib/supabase/client.ts")]: { createClient: () => supabase },
    [resolve(root, "lib/monitoring.ts")]: { getBuildMetadata: () => ({ version: null }) },
    [resolve(root, "lib/safeOpenChat.ts")]: { safeOpenChat: async (chatId, options) => { effects.push(["safeOpen", chatId, options.canCommit()]); return onOpen ? onOpen(chatId, options) : options.canCommit(); } },
    [resolve(root, "store/app.store.ts")]: { useAppStore: Object.assign((select) => select(state), { getState: () => state, subscribe: (callback) => { storeListener = callback; return () => {}; } }) },
    [resolve(root, "lib/errors.ts")]: { mapPgError: () => "safe-error" },
    [resolve(root, "lib/chatJumpEvents.ts")]: { requestChatMessageJump() {} },
    [resolve(root, "lib/chatRoute.ts")]: { chatAddressPath: (id) => `/chat/${id}` },
    [resolve(root, "lib/platform/desktop.ts")]: { isDesktopApp: () => false },
    [resolve(root, "lib/platform/desktopNotifications.ts")]: { registerDesktopNotificationNavigationListener() {} },
  };
  const modules = new Map();
  function load(file) {
    if (boundary[file]) return boundary[file];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    let source = readFileSync(file, "utf8").replaceAll("import.meta.env.BASE_URL", '"/"').replaceAll("import.meta.env.VITE_VAPID_PUBLIC_KEY", '""');
    if (file === resolve(root, "lib/platform/nativeVoiceController.ts")) source = transformController(source);
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, {
      exports: module.exports, module, window, document: { ...events, visibilityState: "visible" },
      navigator: { userAgent: "fixture" }, crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } }, TextEncoder, atob, URLSearchParams,
      PopStateEvent: class {}, console: { error: (...args) => effects.push(["log", ...args]) },
      require: (name) => {
        if (boundary[name]) return boundary[name];
        if (name.startsWith("@/")) return load(resolve(root, `${name.slice(2)}.ts`));
        assert.ok(name.startsWith("."), `unexpected dependency ${name}`);
        return load(resolve(dirname(file), name.endsWith(".ts") ? name : `${name}.ts`));
      },
    }, { filename: file });
    return module.exports;
  }
  const calls = load(resolve(root, "lib/platform/nativeVoiceCalls.ts"));
  const nativePush = load(resolve(root, "lib/platform/nativePush.ts"));
  return {
    calls, nativePush, effects, pushListeners, voiceListeners, state,
    get serverPushEnabled() { return serverPushEnabled; },
    renderPush: () => { hookCursor = 0; return load(resolve(root, "hooks/usePush.ts")).usePush(); },
    pending: (event) => { pending = event; if (event) consumed = null; },
    cancelConsumed: () => { consumed = null; },
    resume: () => emit(appListeners, "appStateChange", { isActive: true }),
    auth: (value) => authListener("SIGNED_IN", value),
    action: () => emit(voiceListeners, "actionPending", {}),
    pushAction: (data) => emit(pushListeners, "pushNotificationActionPerformed", { notification: { data } }),
    rotateToken: (value) => { registrationToken = value; emit(pushListeners, "registration", { value }); },
    storeChanged: () => storeListener(),
    flush: async () => {
      await ticks();
      // Reconciliation timers only: registration's deadline is canceled on success.
      for (const [id, work] of [...timers]) { timers.delete(id); work(); await ticks(); }
    },
  };
}

test("actual native bridge/runtime wires protocol1, deferred auth and canCommit navigation", async () => {
  const h = fixture(); const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  assert.equal(h.effects.filter(([name]) => name === "commit").length, 1);
  assert.equal(h.effects.find(([name, fn]) => name === "rpc" && fn === "register_push_device")[2].p_voice_call_protocol, 1);
  const now = Date.now();
  h.pending({ protocol_version: "1", type: "voice_call", event: "ring", ring_key: `voice:${S}:${now}`, chat_id: C, channel_id: S, caller_id: C, recipient_id: U, recipient_session_id: S, route: `/chat/${C}`, ring_started_at: String(now), expires_at: String(now + 45000) });
  h.action(); await ticks();
  assert.deepEqual(h.effects.filter(([name]) => name === "safeOpen"), [["safeOpen", C, true]]);
  assert.deepEqual(h.effects.filter(([name]) => name === "navigate"), [["navigate", `/chat/${C}`]]);
  const before = h.effects.filter(([name]) => name === "rpc").length;
  assert.equal(h.auth(null), undefined);
  assert.equal(h.effects.filter(([name]) => name === "rpc").length, before);
  assert.equal(h.effects.some(([name]) => name === "clear"), true);
  dispose(); await ticks();
  assert.equal([...h.pushListeners.values(), ...h.voiceListeners.values()].every((set) => set.size === 0), true);
});

test("Browser and Windows runtime wrappers do nothing", async () => {
  const h = fixture({ native: false }); const dispose = h.calls.startNativeVoiceCalls();
  h.calls.ownNativeForegroundRing(`voice:${S}:1000`, U)(); await h.flush();
  assert.deepEqual(h.effects, []); dispose();
});

test("old Android shell still registers ordinary push using exactly seven RPC args", async () => {
  const h = fixture({ plugin: false }); const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  const registration = h.effects.find(([name, fn]) => name === "rpc" && fn === "register_push_device");
  assert.equal(Object.keys(registration[2]).length, 7);
  assert.equal(h.effects.some(([name]) => name === "commit" || name === "begin"), false);
  dispose();
});

test("actual permission adapter is silent on restore and prompts only explicit enable", async () => {
  const h = fixture({ permission: "prompt" }); const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  assert.equal(h.effects.some(([name]) => name === "permissionPrompt"), false);
  assert.equal(h.effects.some(([name]) => name === "commit"), false);
  const result = await h.calls.enableNativeVoicePush();
  assert.equal(result.status, "native_active");
  assert.equal(h.effects.filter(([name]) => name === "permissionPrompt").length, 1);
  dispose();
});

test("provider text is classified but never logged, returned or stored in the public status", async () => {
  const h = fixture({ providerError: { error: "Firebase private-provider-token-and-payload" } });
  const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  assert.equal(h.calls.nativeVoicePushSnapshot().status, "native_setup_missing");
  assert.doesNotMatch(JSON.stringify(h.effects.filter(([name]) => name === "log")), /private-provider/);
  assert.doesNotMatch(JSON.stringify(h.calls.nativeVoicePushSnapshot()), /private-provider/);
  dispose();
});

test("actual generic navigation retains ordinary routes but rejects reserved malformed voice data", async () => {
  const h = fixture(); const routes = [];
  const dispose = await h.nativePush.registerNativePushNavigationListeners((target) => routes.push(target));
  h.pushAction({ route: "/tasks?task=fixture" });
  h.pushAction({ type: "voice_call", route: `/chat/${C}` });
  h.pushAction({ protocol_version: "99", route: `/chat/${C}` });
  assert.deepEqual(routes, ["/tasks?task=fixture"]); dispose();
});

test("R3: real global and per-registration listeners preserve a distinct token during backend wait", async () => {
  let finish; const first = new Promise((resolve) => { finish = resolve; }); const tokens = [];
  const accepted = { data: [{ recipient_id: U, recipient_session_id: S }], error: null };
  const h = fixture({ onRegister: async (args) => {
    tokens.push(args.p_token); return tokens.length === 1 ? first : accepted;
  } });
  const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  assert.equal(h.pushListeners.get("registration").size, 2, "both real listeners receive rotation");
  h.rotateToken("synthetic-next"); h.rotateToken("synthetic-next");
  finish(accepted); await ticks(); await h.flush();
  assert.deepEqual(tokens, ["synthetic-registration", "synthetic-next"]);
  assert.equal(h.calls.nativeVoicePushSnapshot().status, "native_active"); dispose();
});

async function firstEnableWithRotation({ stop = null, preferenceError = null, transformController } = {}) {
  let finish; const first = new Promise((resolve) => { finish = resolve; }); const tokens = [];
  const accepted = { data: [{ recipient_id: U, recipient_session_id: S }], error: null };
  const h = fixture({ pushEnabled: false, permission: "prompt", preferenceError, transformController, onRegister: async (args) => {
    tokens.push(args.p_token); return tokens.length === 1 ? first : accepted;
  } });
  const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  const hook = h.renderPush();
  const enabling = hook.enable(); await ticks();
  assert.deepEqual(tokens, ["synthetic-registration"]);
  assert.equal(h.pushListeners.get("registration").size, 2);
  h.rotateToken("synthetic-next"); h.rotateToken("synthetic-next");
  if (stop === "logout") h.auth(null);
  if (stop === "disable") await hook.disable();
  if (stop === "session") h.auth({ user: { id: U }, access_token: `e30.${Buffer.from(JSON.stringify({ sub: U, session_id: C })).toString("base64url")}.fixture` });
  if (stop === "account") h.auth({ user: { id: C }, access_token: `e30.${Buffer.from(JSON.stringify({ sub: C, session_id: S })).toString("base64url")}.fixture` });
  finish(accepted); await enabling; await ticks(); await h.flush();
  const view = h.renderPush();
  const bound = h.effects.filter(([name]) => name === "begin" || name === "commit" || name === "clear").at(-1)?.[0] === "commit";
  dispose(); await ticks();
  return { h, tokens, view, bound };
}

test("R3: first explicit usePush enable retains preference ownership while its token rotates", async () => {
  const { h, tokens, view, bound } = await firstEnableWithRotation();
  assert.deepEqual(h.effects.filter(([name]) => name === "preference"), [["preference", U, true]]);
  assert.equal(h.serverPushEnabled, true);
  assert.deepEqual(tokens, ["synthetic-registration", "synthetic-next"]);
  assert.equal(h.effects.filter(([name]) => name === "permissionPrompt").length, 1);
  assert.equal(view.status, "active"); assert.equal(view.preferences.push_enabled, true); assert.equal(bound, true);
});

for (const stop of ["logout", "disable", "session", "account"]) {
  test(`R3: first explicit enable cannot persist or drain rotation after ${stop}`, async () => {
    const { h, tokens, bound } = await firstEnableWithRotation({ stop });
    assert.equal(h.effects.some(([name, _user, value]) => name === "preference" && value), false);
    assert.equal(h.serverPushEnabled, false); assert.equal(bound, false);
    assert.deepEqual(tokens, ["synthetic-registration"]);
  });
}

test("R3: rotated first enable still clears native binding if preference persistence fails", async () => {
  const { h, view, bound } = await firstEnableWithRotation({ preferenceError: { code: "42501" } });
  assert.deepEqual(h.effects.filter(([name]) => name === "preference"), [["preference", U, true]]);
  assert.equal(h.serverPushEnabled, false); assert.equal(bound, false);
  assert.equal(view.preferences.push_enabled, false); assert.equal(view.status, "native_unavailable");
  assert.equal(h.effects.some(([name]) => name === "unregister"), true);
});

test("R3: queued first-enable retry is timed out and its late response cannot restore binding", async () => {
  const replies = []; const tokens = [];
  const accepted = { data: [{ recipient_id: U, recipient_session_id: S }], error: null };
  const h = fixture({ pushEnabled: false, onRegister: (args) => {
    tokens.push(args.p_token); return new Promise((resolve) => replies.push(resolve));
  } });
  const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  const enabling = h.renderPush().enable(); await ticks();
  h.rotateToken("synthetic-next"); replies[0](accepted); await ticks();
  assert.deepEqual(tokens, ["synthetic-registration", "synthetic-next"]);
  await h.flush(); await enabling;
  assert.equal(h.calls.nativeVoicePushSnapshot().status, "native_setup_missing");
  const commits = h.effects.filter(([name]) => name === "commit").length;
  replies[1](accepted); await ticks(); await h.flush();
  assert.equal(h.effects.filter(([name]) => name === "commit").length, commits);
  assert.equal(h.effects.some(([name]) => name === "preference"), false);
  assert.equal(h.pushListeners.get("registration").size, 1, "only global listener remains");
  dispose();
});

test("mutation killed: queued enable retry cannot create a background registration generation", async () => {
  const needle = "nextToken = queuedRotation.value;";
  assert.equal(readFileSync(resolve(root, "lib/platform/nativeVoiceController.ts"), "utf8").split(needle).length, 2);
  const verify = async (transformController) => {
    const { h, tokens } = await firstEnableWithRotation({ transformController });
    assert.equal(h.serverPushEnabled, true);
    assert.deepEqual(tokens, ["synthetic-registration", "synthetic-next"]);
  };
  await verify();
  await assert.rejects(() => verify((text) => text.replace(needle, "refresh(); break;")), { code: "ERR_ASSERTION" });
});

for (const mode of ["valid", "cancelled", "missing method"]) {
  test(`R1: actual bridge retry after resumed same-session binding is ${mode}`, async () => {
    let finish; const access = new Promise((resolve) => { finish = resolve; }); let opens = 0;
    const h = fixture({
      revalidationMissing: mode === "missing method",
      onOpen: async (_chat, options) => { if (++opens === 1) await access; return options.canCommit(); },
    });
    const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
    const now = Date.now();
    const ringKey = `voice:${S}:${now}`;
    h.pending({ protocol_version: "1", type: "voice_call", event: "ring", ring_key: ringKey, chat_id: C, channel_id: S, caller_id: C, recipient_id: U, recipient_session_id: S, route: `/chat/${C}`, ring_started_at: String(now), expires_at: String(now + 45000) });
    h.action(); await ticks(); h.resume(); await h.flush();
    if (mode === "cancelled") h.cancelConsumed();
    finish(); await ticks();
    assert.deepEqual(h.effects.filter(([name]) => name === "revalidate"), [["revalidate", ringKey]]);
    assert.deepEqual(h.effects.filter(([name]) => name === "navigate"), mode === "valid" ? [["navigate", `/chat/${C}`]] : []);
    dispose();
  });
}

test("R1: actual adapter consumes newer tap signalled during unbound resume without replaying old DTO", async () => {
  let finish; const access = new Promise((resolve) => { finish = resolve; }); let opens = 0;
  const h = fixture({ onOpen: async (_chat, options) => { if (++opens === 1) await access; return options.canCommit(); } });
  const dispose = h.calls.startNativeVoiceCalls(); await h.flush();
  const now = Date.now();
  const original = { protocol_version: "1", type: "voice_call", event: "ring", ring_key: `voice:${S}:${now}`, chat_id: C, channel_id: S, caller_id: C, recipient_id: U, recipient_session_id: S, route: `/chat/${C}`, ring_started_at: String(now), expires_at: String(now + 45000) };
  h.pending(original); h.action(); await ticks();
  h.resume(); finish(); await ticks();
  h.pending({ ...original, chat_id: S, route: `/chat/${S}`, channel_id: C, ring_key: `voice:${C}:${now}` });
  h.action(); await ticks(); await h.flush();
  assert.deepEqual(h.effects.filter(([name]) => name === "revalidate"), [["revalidate", original.ring_key]]);
  assert.deepEqual(h.effects.filter(([name]) => name === "navigate"), [["navigate", `/chat/${S}`]]);
  assert.equal(opens, 2); dispose();
});
