import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useNotifications.ts");
const UID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002";
const SESSION = "20000000-0000-4000-8000-000000000001", SESSION2 = "20000000-0000-4000-8000-000000000002";
const A = "30000000-0000-4000-8000-000000000001", B = "30000000-0000-4000-8000-000000000002";
const CHAT = "50000000-0000-4000-8000-000000000001", CHAT2 = "50000000-0000-4000-8000-000000000002";
const SENDER = "60000000-0000-4000-8000-000000000001";
const FIRST = "2026-10-17T00:00:01.000Z", READ = "2026-10-17T00:00:02.000Z";
const plain = value => JSON.parse(JSON.stringify(value));
function notice(id = A, changes = {}) {
  return { id, user_id: UID, kind: "message", read_at: null, alert_suppressed_at: null, feed_revision: 1, created_at: FIRST,
    payload: { chat_id: CHAT, message_id: id, sender_id: SENDER, sender_kind: "user", bot_id: null,
      chat_type: "private", sender_name: "Fictional sender", preview: "Fictional body", group_tag: `message:chat:${CHAT}` }, ...changes };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function events() {
  const callbacks = new Map();
  return { addEventListener(name, fn) { if (!callbacks.has(name)) callbacks.set(name, new Set()); callbacks.get(name).add(fn); },
    removeEventListener(name, fn) { callbacks.get(name)?.delete(fn); },
    emit(name, detail) { for (const fn of [...(callbacks.get(name) ?? [])]) fn({ detail }); } };
}
function compile(text, imports = {}, globals = {}, dev = false) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [context => tree => {
      const visit = node => ts.isPropertyAccessExpression(node) && node.getText(tree) === "import.meta.env.DEV"
        ? dev ? context.factory.createTrue() : context.factory.createFalse() : ts.visitEachChild(node, visit, context);
      return ts.visitNode(tree, visit);
    }] } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, Object, JSON, Promise, Map, Set, Date,
    require(name) { assert.ok(Object.hasOwn(imports, name), `uncontrolled import ${name}`); return imports[name]; }, ...globals });
  return module.exports;
}

// Same mounted-hook/effect scheduler as notification-read-ownership. The whole
// hook, v2 controller/parsers, read helper, sound player and Windows adapter run
// actual TS. Only React scheduling, SDK, AudioContext and native I/O are ports.
function fixture({ hook = source, initial = [], desktop = false, native = false, autoMarker = true } = {}) {
  let state = { currentUser: { id: UID }, authSessionIdentity: { userId: UID, sessionId: SESSION },
    accountEpoch: 1, mutedChatIds: [], selectedChatId: CHAT2 };
  let cursor = 0, dirty = true, mounted = true, view, time = Date.parse(READ), sequence = 0;
  let policy = "allow", allow = true;
  const slots = [], effects = new Map(), cleanups = new Map(), channels = [], calls = [], gates = new Map();
  const rows = new Map(initial.map(row => [row.id, row])), sounds = [], cards = [], removals = [], nativeReads = [], timers = new Map();
  const window = events(), document = { ...events(), hidden: false, visibilityState: "visible", querySelector: () => null };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next;
        if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i], deps)) { slots[i] = deps; effects.set(i, fn); } },
  };
  function hold(name) { const d = deferred(); gates.set(name, [...(gates.get(name) ?? []), d]); return d; }
  function boundary(name, value) { return gates.get(name)?.shift()?.promise ?? Promise.resolve(value); }
  const ownRows = who => [...rows.values()].filter(row => row.user_id === who)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const page = who => ({ v: 2, rows: plain(ownRows(who).slice(0, 30)), next: null });
  const lookup = (who, ids) => ({ v: 2, rows: plain(ownRows(who).filter(row => ids.includes(row.id))),
    unavailable_ids: ids.filter(id => !rows.has(id) || rows.get(id).user_id !== who) });
  function emit(kind, id, extra = {}) {
    const event = { event_id: `40000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      recipient_id: state.currentUser?.id ?? UID, notification_id: id, event_kind: kind, created_at: FIRST, ...extra };
    for (const ch of channels.filter(ch => ch.active)) for (const h of ch.handlers)
      if (h.filter.table === "notification_feed_events_v2" && h.filter.event === "INSERT"
        && h.filter.filter === `recipient_id=eq.${event.recipient_id}`) h.callback({ new: event });
  }
  const client = {
    from(table) {
      const request = { type: "raw", table, ids: null, horizon: null }, query = {
        select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return query; },
        in(key, ids) { request.ids = ids; return query; }, lte(key, horizon) { request.horizon = horizon; return query; },
        then(done, fail) { calls.push(request); const data = table === "messages"
          ? (request.ids ?? []).map(id => ({ id })) : ownRows(state.currentUser?.id);
          return boundary("legacy-read", { data, error: null }).then(done, fail); },
      }; return query;
    },
    rpc(name, args = {}) {
      const who = state.currentUser?.id; calls.push({ type: "rpc", name, args: plain(args), who });
      let value = { data: null, error: null };
      if (name === "notification_feed_page_v2") value.data = page(who);
      if (name === "notification_feed_lookup_v2") {
        assert.ok(args.p_ids.length >= 1 && args.p_ids.length <= 100); value.data = lookup(who, args.p_ids);
      }
      if (name === "notification_feed_open_v2") value.data = { v: 2,
        barrier_event_id: `40000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        page: page(who), lookup: lookup(who, args.p_held_ids) };
      if (name === "message_notification_alert_decisions") value.data = args.p_notification_ids.map(id => ({ notification_id: id,
        allowed: allow, scope_key: "general", revision: 0 }));
      // A held write response is a delayed ACK after the server command,
      // not permission to retroactively include later notifications.
      if (name.startsWith("notifications_mark_")) for (const [id, row] of rows) {
          if (row.user_id !== who) continue;
          if (name === "notifications_mark_all_read" || (name === "notifications_mark_read" && id === args.p_id)
            || (name === "notifications_mark_chat_messages_read" && row.payload.chat_id === args.p_chat_id
              && (!args.p_read_until || row.created_at <= args.p_read_until))) {
            if (!row.read_at) rows.set(id, { ...row, read_at: READ, feed_revision: row.feed_revision + 1 });
          }
      }
      return boundary(name, value).then(result => {
        if (!result.error && name === "notification_feed_open_v2" && autoMarker)
          emit("invalidate", null, { event_id: result.data?.barrier_event_id, recipient_id: who });
        return result;
      });
    },
    channel(name) { const ch = { name, active: true, handlers: [], on(type, filter, callback) { ch.handlers.push({ filter, callback }); return ch; },
      subscribe(status) { ch.status = status; return ch; } }; channels.push(ch); return ch; },
    removeChannel(ch) { ch.active = false; return Promise.resolve("ok"); },
  };
  const bridge = { async isMainForeground() { return boundary("foreground", false); },
    async notify(card) { cards.push(plain(card)); return boundary("notify", true); },
    async removeNotification(card) { removals.push(plain(card)); return boundary("remove", true); } };
  let timerNo = 0;
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const globals = { window, document, navigator: { onLine: true }, Date: FixedDate,
    performance: { now: () => time }, setTimeout(fn, ms) { const id = ++timerNo; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const parameter = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {}, cancelScheduledValues() {} });
  class AudioContext {
    state = "suspended"; currentTime = 0; destination = {};
    async resume() { await boundary("audio-resume"); this.state = "running"; }
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
    createOscillator() { return { frequency: parameter(), connect() {}, disconnect() {}, stop() {}, onended: null,
      start() { sounds.push("oscillator"); } }; }
  }
  window.__letscubeAudioContext = AudioContext;
  const app = Object.assign(select => select(state), { getState: () => state });
  const projection = compile(read("lib/messageNotificationProjection.ts"));
  const presentation = compile(read("lib/browserNotificationPresentation.ts"), { "./messageNotificationProjection.ts": projection }, globals);
  const platform = { isDesktopApp: () => desktop, getDesktopBridge: () => desktop ? bridge : null };
  const desktopApi = compile(read("lib/platform/desktopNotifications.ts"), { "./desktop.ts": platform,
    "../browserNotificationPresentation.ts": presentation, "../messageNotificationProjection.ts": projection,
    "../support/notifications.ts": compile(read("lib/support/notifications.ts")) }, globals);
  const soundRules = compile(read("lib/callSounds.ts"));
  const player = compile(read("lib/callSoundPlayer.ts"), { "./callSounds.ts": soundRules }, globals, true);
  const soundHook = compile(read("hooks/useCallSound.ts"), { react, "@/store/app.store": { useAppStore: app },
    "@/lib/callSounds": soundRules, "@/lib/callSoundPlayer": player,
    "@/hooks/useAudioSettings": { getAudioSettings: () => ({ notificationSoundEnabled: true }) },
    "@/hooks/useOwnPresence": { ownAlertPolicySnapshot: () => policy }, "@/hooks/useVoiceCall": { voiceCallSnapshot: () => ({ phase: "idle" }) } }, globals);
  const imports = { react, "@/store/app.store": { useAppStore: app }, "@/lib/supabase/client": { createClient: () => client },
    "@/lib/errors": { mapPgError: () => "fictional refusal" }, "@/hooks/useCallSound": soundHook,
    "@/hooks/useOwnPresence": { ownAlertPolicySnapshot: () => policy },
    "@/lib/dev/instrumentation": { bumpFetch() {}, registerChannel() {}, unregisterChannel() {} }, "@/lib/chatEvents": { dispatchChatsRefresh() {} },
    "@/lib/notificationEvents": { KUB_CHAT_NOTIFICATIONS_READ_EVENT: "kub:chat-notifications-read" },
    "@/lib/notificationReadSync": compile(read("lib/notificationReadSync.ts")), "@/lib/notificationRows": compile(read("lib/notificationRows.ts")),
    "@/lib/notificationFeedV2": compile(read("lib/notificationFeedV2.ts"), {}, globals),
    "@/lib/realtimeRevival": compile(read("lib/realtimeRevival.ts"), {}, globals),
    "@/lib/rpcAvailability": compile(read("lib/rpcAvailability.ts"), {}, { console: { warn() {} } }),
    "@/lib/messageNotificationProjection": projection, "@/lib/messageAlertDecisions": compile(read("lib/messageAlertDecisions.ts")),
    "@/lib/browserNotificationPresentation": presentation, "@/lib/platform/desktop": platform,
    "@/lib/platform/capabilities": { isNativeAndroid: () => native }, "@/lib/platform/desktopNotifications": desktopApi,
    "@/lib/platform/nativePush": { async closeNativeChatNotification(value, current) { nativeReads.push({ value: plain(value), current }); return boundary("native-cleanup", "settled"); } },
  };
  const useHook = compile(hook, imports, globals).useNotifications;
  function render() { cursor = 0; dirty = false; view = useHook(); }
  function commit() { const work = [...effects]; effects.clear(); for (const [i] of work) cleanups.get(i)?.(); for (const [i, effect] of work) cleanups.set(i, effect()); }
  async function drain() { for (let i = 0; i < 90; i++) { await Promise.resolve(); if (mounted && dirty) render(); if (mounted && effects.size) commit(); } }
  render(); commit();
  return { calls, channels, rows, sounds, cards, removals, nativeReads, hold, drain, emit, window, document,
    get view() { return view; }, get state() { return state; }, get timers() { return timers; },
    async ready() { channels.at(-1)?.status("SUBSCRIBED"); await drain(); },
    async insert(row) { time += 500; rows.set(row.id, row); emit("created", row.id); await drain(); },
    async update(row) { rows.set(row.id, { ...row, feed_revision: (rows.get(row.id)?.feed_revision ?? 0) + 1 }); emit("changed", row.id); await drain(); },
    async remove(id) { rows.delete(id); emit("removed", id); await drain(); },
    async advance(ms) { time += ms; for (const [id, item] of [...timers]) if (item.at <= time) { timers.delete(id); item.fn(); } await drain(); },
    async change({ userId = UID, sessionId = SESSION2, epoch = state.accountEpoch + 1, renderNow = true } = {}) {
      state = { ...state, currentUser: userId ? { id: userId } : null, authSessionIdentity: userId ? { userId, sessionId } : null, accountEpoch: epoch };
      if (renderNow) { render(); commit(); await drain(); }
    },
    quiet() { policy = "quiet"; }, deny() { allow = false; },
    async mute(ids) { state = { ...state, mutedChatIds: ids }; render(); commit(); await drain(); },
    async network(online) { globals.navigator.onLine = online; window.emit(online ? "online" : "offline"); await drain(); },
    unmount() { mounted = false; for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); },
  };
}

test("empty current feed refresh calls page but never the 1..100 lookup RPC", async t => {
  const f = owned(t); await f.ready(); await f.view.refresh(); await f.drain();
  assert.equal(f.calls.filter(c => c.name === "notification_feed_page_v2").length, 1);
  assert.equal(f.calls.filter(c => c.name === "notification_feed_lookup_v2").length, 0);
  assert.equal(f.view.loading, false); assert.equal(f.view.error, null);
});

test("chat read with no locally retained IDs still reconciles fresh confirmed rows after ACK", async t => {
  const f = owned(t, { native: true }); await f.ready();
  f.rows.set(A, notice());
  await f.view.markMessageNotificationsForChatRead(CHAT, READ); await f.drain();
  assert.equal(f.view.items.length, 1); assert.equal(f.view.items[0].read_at, READ);
  assert.equal(f.view.items[0].feed_revision, 2); assert.equal(f.nativeReads.length, 1);
});

test("mark-all ACK never marks a post-command arrival; late read error never overwrites current feed", async t => {
  const f = owned(t, { initial: [notice()] }); await f.ready();
  const held = f.hold("notifications_mark_all_read"); const write = f.view.markAllRead(); await f.drain();
  await f.insert(notice(B)); held.resolve({ data: null, error: null }); await write; await f.drain();
  assert.equal(f.view.items.find(row => row.id === A).read_at, READ);
  assert.equal(f.view.items.find(row => row.id === B).read_at, null);
});

test("retired per-ID ACK cannot request the remaining IDs or publish a successor error", async t => {
  const f = owned(t, { initial: [notice(), notice(B)] }); await f.ready();
  const held = f.hold("notifications_mark_read"); const write = f.view.markReadIds([A, B]); await f.drain();
  await f.change({ renderNow: false }); held.resolve({ data: null, error: { code: "fictional_error" } }); await write; await f.drain();
  assert.equal(f.calls.filter(c => c.name === "notifications_mark_read").length, 1); assert.equal(f.view.error, null);
});

test("native cleanup timeout retries only after a paced new successful v2 frame, never in-flight storms", async t => {
  const f = owned(t, { initial: [notice(A, { read_at: READ })], native: true });
  const held = f.hold("native-cleanup"); await f.ready();
  await f.view.refresh(); await f.drain(); assert.equal(f.nativeReads.length, 1);
  held.resolve("retry"); await f.drain(); await f.view.refresh(); await f.drain(); assert.equal(f.nativeReads.length, 1);
  await f.advance(5000); assert.equal(f.nativeReads.length, 1);
  await f.view.refresh(); await f.drain(); assert.equal(f.nativeReads.length, 2);
  await f.view.refresh(); await f.drain(); assert.equal(f.nativeReads.length, 2);
});

test("ACK-only markRead waits for a fresh server revision, not a synthetic timestamp or native clear", async t => {
  const f = owned(t, { initial: [notice()], native: true }); await f.ready();
  const page = f.hold("notification_feed_page_v2"), lookup = f.hold("notification_feed_lookup_v2");
  let done = false; const write = f.view.markRead(A).then(() => { done = true; }); await f.drain();
  assert.equal(done, false); assert.equal(f.view.items[0].read_at, null); assert.equal(f.view.items[0].feed_revision, 1);
  assert.equal(f.nativeReads.length, 0);
  const confirmed = notice(A, { read_at: READ, feed_revision: 2 });
  page.resolve({ error: null, data: { v: 2, rows: [confirmed], next: null } });
  lookup.resolve({ error: null, data: { v: 2, rows: [confirmed], unavailable_ids: [] } });
  await write; await f.drain();
  assert.equal(f.view.items[0].feed_revision, 2); assert.equal(f.view.items[0].read_at, READ);
  assert.equal(f.nativeReads.length, 1);
});

test("late read-confirmation frames cannot restore a removed payload or clear a different native item", async t => {
  const f = owned(t, { initial: [notice()], native: true }); await f.ready();
  const page = f.hold("notification_feed_page_v2"), lookup = f.hold("notification_feed_lookup_v2");
  const write = f.view.markRead(A); await f.drain(); await f.remove(A);
  const stale = notice(A, { read_at: READ, feed_revision: 2 });
  page.resolve({ error: null, data: { v: 2, rows: [stale], next: null } });
  lookup.resolve({ error: null, data: { v: 2, rows: [stale], unavailable_ids: [] } });
  await write; await f.drain(); assert.deepEqual(plain(f.view.items), []); assert.equal(f.nativeReads.length, 0);
});

test("partial page omission retains a separately verified held row; it is not deletion authority", async t => {
  const f = owned(t, { initial: [notice()] }); await f.ready();
  const held = f.hold("notification_feed_page_v2"); const refresh = f.view.refresh(); await f.drain();
  held.resolve({ error: null, data: { v: 2, rows: [], next: null } }); await refresh; await f.drain();
  assert.deepEqual(plain(f.view.items.map(row => row.id)), [A]);
});

test("mute filtering is reversible from the canonical retained view without resubscribe or alert replay", async t => {
  const f = owned(t, { initial: [notice(A, { kind: "chat_added" })] }); await f.ready();
  await f.mute([CHAT]); assert.equal(f.view.items.length, 0);
  await f.mute([]); assert.equal(f.view.items.length, 1); assert.equal(f.channels.length, 1); assert.equal(f.sounds.length, 0);
});

for (const yChange of ["read", "update"]) test(`held real X sound survives unrelated Y ${yChange} without admission replay`, async t => {
  const f = owned(t, { initial: [notice(B)] }); await f.ready();
  const held = f.hold("message_notification_alert_decisions"); await f.insert(notice());
  if (yChange === "read") await f.view.markRead(B);
  else await f.update(notice(B, { payload: { ...notice(B).payload, preview: "changed Y" } }));
  held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
  await f.drain(); assert.equal(f.sounds.length, 4);
  assert.equal(f.calls.filter(c => c.name === "message_notification_alert_decisions").length, 1);
});

for (const boundary of ["audio-resume", "foreground", "message_notification_alert_decisions"]) {
  for (const loss of ["read", "terminal", "removed", "session", "gap"]) {
    test(`held ${boundary} ${boundary === "audio-resume" ? "sound" : "Windows"} rejects ${loss} at the actual final effect`, async t => {
      const f = owned(t, { desktop: boundary !== "audio-resume" }); await f.ready();
      const held = f.hold(boundary); await f.insert(notice());
      if (loss === "read") await f.view.markRead(A);
      if (loss === "terminal") await f.update(notice(A, { alert_suppressed_at: READ }));
      if (loss === "removed") await f.remove(A);
      if (loss === "session") await f.change({ epoch: 1, renderNow: false });
      if (loss === "gap") f.channels[0].status("CHANNEL_ERROR");
      held.resolve(boundary === "foreground" ? false : boundary === "audio-resume" ? undefined
        : { error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
      await f.drain(); assert.equal(f.sounds.length, 0); assert.equal(f.cards.length, 0);
    });
  }
}

test("Windows final allowed authority uses actual adapter once; changed and unknown rows never alert", async t => {
  const f = owned(t, { desktop: true }); await f.ready(); await f.insert(notice());
  assert.equal(f.cards.length, 1); assert.equal(f.cards[0].body, "Fictional body"); assert.equal(f.sounds.length, 0);
  await f.update(notice()); await f.update(notice(B)); assert.equal(f.cards.length, 1);
  assert.equal(f.calls.filter(c => c.name === "message_notification_alert_decisions").length, 1);
});

test("notify ACK/read removal serialize before a same-identity replacement; stale queued creation cannot send", async t => {
  const card = id => notice(id, { kind: "group_invite", payload: { chat_id: CHAT, invite_id: CHAT } });
  const f = owned(t, { desktop: true }); await f.ready(); const notify = f.hold("notify"); await f.insert(card(A));
  await f.view.markRead(A); await f.drain();
  await f.insert(card(B));
  await f.drain(); assert.equal(f.cards.length, 1, "replacement is queued behind notify ACK");
  await f.update({ ...card(B), alert_suppressed_at: READ }); notify.resolve(true); await f.drain();
  assert.equal(f.removals.length, 1); assert.equal(f.cards.length, 1, "source permit must be checked inside card queue");
});

test("allowed same-identity replacement still sends once after older card removal", async t => {
  const card = id => notice(id, { kind: "group_invite", payload: { chat_id: CHAT, invite_id: CHAT } });
  const f = owned(t, { desktop: true }); await f.ready(); const notify = f.hold("notify"); await f.insert(card(A));
  await f.view.markRead(A); await f.insert(card(B)); assert.equal(f.cards.length, 1);
  notify.resolve(true); await f.drain(); assert.equal(f.removals.length, 1); assert.equal(f.cards.length, 2);
});

test("offline and real revival event invalidate live permits and reopen quietly without replaying gap rows", async t => {
  const f = owned(t); await f.ready(); const held = f.hold("message_notification_alert_decisions"); await f.insert(notice());
  await f.network(false); f.rows.set(B, notice(B)); await f.advance(5000);
  assert.equal(f.channels.length, 1, "offline never retries");
  await f.network(true); await f.ready();
  held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
  await f.drain(); assert.equal(f.sounds.length, 0); assert.equal(f.view.items.length, 2);
  f.window.emit("kub:connection-revived"); await f.ready(); assert.equal(f.channels.length, 3); assert.equal(f.sounds.length, 0);
});

test("missing marker has finite deadline and only one automatic retry; no legacy fallback or busy loop", async t => {
  const f = owned(t, { autoMarker: false }); await f.ready(); assert.equal(f.view.loading, true);
  await f.advance(10000); assert.notEqual(f.view.error, null); await f.advance(1000); await f.ready();
  await f.advance(10000); await f.advance(60000);
  assert.equal(f.channels.length, 2); assert.equal(f.channels.filter(ch => ch.active).length, 0);
  assert.equal(f.calls.filter(c => c.type === "raw").length, 0); assert.equal(f.timers.size, 0);
});

for (const failure of ["missing", "malformed", "transport"]) test(`v2 ${failure} fails closed, never becomes an empty legacy success`, async t => {
  const f = owned(t, { initial: [notice()] }); await f.ready();
  const held = f.hold("notification_feed_page_v2"); const refresh = f.view.refresh(); await f.drain();
  if (failure === "transport") held.reject(new Error("fictional transport failure"));
  else held.resolve(failure === "missing" ? { data: null, error: { code: "PGRST202" } } : { data: { v: 2, rows: [], next: null, extra: true }, error: null });
  await refresh; await f.drain(); assert.notEqual(f.view.error, null); assert.equal(f.view.items.length, 1);
  assert.equal(f.calls.some(c => c.type === "raw"), false); assert.equal(f.sounds.length, 0);
});

test("held snapshot times out and cleanup settles the public refresh promise without restarting an unmounted owner", async t => {
  const f = owned(t); await f.ready(); const held = f.hold("notification_feed_page_v2");
  let settled = false; const refresh = f.view.refresh().then(() => { settled = true; }); await f.drain();
  await f.advance(10000); await refresh; assert.equal(settled, true); assert.notEqual(f.view.error, null);
  f.unmount(); held.resolve({ error: null, data: { v: 2, rows: [], next: null } }); await f.advance(60000);
  assert.equal(f.channels.length, 1); assert.equal(f.timers.size, 0);
});

function mutation(name, needle, replacement, proof) {
  test(`actual compiled hook omission: ${name}`, async () => {
    assert.equal(source.split(needle).length - 1, 1, "select exactly one actual hook boundary");
    await proof(source);
    await assert.rejects(() => proof(source.replace(needle, replacement)), error => error.code === "ERR_ASSERTION",
      "omission must break the literal behavior, not fixture/setup");
  });
}
mutation("INSERT sidecar only", 'event: "INSERT", schema: "public", table: "notification_feed_events_v2"',
  'event: "INSERT", schema: "public", table: "notifications"', async hook => {
    const f = fixture({ hook }); try { await f.drain(); assert.equal(f.channels[0].handlers[0].filter.table, "notification_feed_events_v2"); }
    finally { f.unmount(); }
  });
mutation("ACK is not an authoritative read revision", "// may advance the feed and clear native cards.\n            await refresh();",
  "// may advance the feed and clear native cards.", async hook => {
    const f = fixture({ hook, initial: [notice()] });
    try { await f.ready(); await f.view.markRead(A); await f.drain(); assert.equal(f.view.items[0].feed_revision, 2); assert.equal(f.view.items[0].read_at, READ); }
    finally { f.unmount(); }
  });
mutation("received source change revokes held sound permit even without read/terminal change", "() => current() && allowed()", "() => current()", async hook => {
  const f = fixture({ hook });
  try {
    await f.ready(); const held = f.hold("message_notification_alert_decisions"); await f.insert(notice());
    await f.update(notice(A, { payload: { ...notice().payload, preview: "new payload" } }));
    held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
    await f.drain(); assert.equal(f.sounds.length, 0);
  } finally { f.unmount(); }
});
mutation("same UID session replacement before render revokes a held permit", "state.authSessionIdentity.sessionId === readOwner.sessionId", "true", async hook => {
  const f = fixture({ hook });
  try {
    await f.ready(); const held = f.hold("message_notification_alert_decisions"); await f.insert(notice());
    await f.change({ epoch: 1, renderNow: false });
    held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
    await f.drain(); assert.equal(f.sounds.length, 0);
  } finally { f.unmount(); }
});
mutation("full retained replacement never merges unavailable payload back", "setItems(previous => current() ? visible : previous);", "setItems(previous => current() ? [...previous, ...visible] : previous);", async hook => {
  const f = fixture({ hook, initial: [notice()] });
  try { await f.ready(); await f.remove(A); assert.equal(f.view.items.length, 0); }
  finally { f.unmount(); }
});
mutation("only one automatic retry under sustained failure", "retries++ === 0", "true", async hook => {
  const f = fixture({ hook, autoMarker: false });
  try {
    await f.ready(); await f.advance(10000); await f.advance(1000); await f.ready();
    await f.advance(10000); await f.advance(1000); assert.equal(f.channels.length, 2);
  } finally { f.unmount(); }
});
mutation("offline closes old source admission immediately", 'window.addEventListener("offline", offline);', "", async hook => {
  const f = fixture({ hook });
  try {
    await f.ready(); const held = f.hold("message_notification_alert_decisions"); await f.insert(notice());
    await f.network(false);
    held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
    await f.drain(); assert.equal(f.sounds.length, 0);
  } finally { f.unmount(); }
});
mutation("unrelated dirty state must not recreate or replay the controller", "[userId, sessionId, accountEpoch, supabase, readOwner, isCurrentReadOwner]",
  "[userId, sessionId, accountEpoch, supabase, readOwner, isCurrentReadOwner, mutedChatIds]", async hook => {
    const f = fixture({ hook });
    try { await f.ready(); await f.mute([CHAT]); assert.equal(f.channels.length, 1); }
    finally { f.unmount(); }
  });
function owned(t, options) { const f = fixture(options); t.after(() => f.unmount()); return f; }

test("mounted actual hook never reads raw notifications and waits for subscribe before open", async t => {
  const f = owned(t); await f.drain();
  assert.equal(f.calls.filter(c => c.type === "raw" && c.table === "notifications").length, 0, "legacy raw feed read must disappear");
  assert.equal(f.calls.filter(c => c.name === "notification_feed_open_v2").length, 0);
  await f.ready(); assert.equal(f.calls.filter(c => c.name === "notification_feed_open_v2").length, 1);
});
test("mounted hook subscribes only to INSERT sidecar, never the legacy table", async t => {
  const f = owned(t); await f.drain();
  assert.deepEqual(plain(f.channels[0].handlers.map(h => h.filter)), [{ event: "INSERT", schema: "public",
    table: "notification_feed_events_v2", filter: `recipient_id=eq.${UID}` }]);
});
test("initial/reconnect/focus snapshots remain quiet; actual live creation reaches actual sound authority", async t => {
  const f = owned(t, { initial: [notice()] }); await f.ready();
  assert.equal(f.view.items.length, 1); assert.equal(f.sounds.length, 0);
  await f.insert(notice(B)); assert.equal(f.sounds.length, 4);
  assert.equal(f.calls.filter(c => c.name === "message_notification_alert_decisions").length, 1);
  f.window.emit("focus"); await f.drain(); assert.equal(f.sounds.length, 4);
});
test("authoritative unavailable replaces the full retained view and never merges retired payload back", async t => {
  const f = owned(t, { initial: [notice()] }); await f.ready(); await f.remove(A);
  assert.deepEqual(plain(f.view.items), []); assert.equal(f.view.unreadCount, 0);
  assert.equal(f.calls.some(c => c.name === "notification_feed_lookup_v2" && c.args.p_ids.includes(A)), true);
});
test("read confirmation uses v2 lookup, preserving server read horizon and exact native pair cleanup", async t => {
  const f = owned(t, { initial: [notice(), notice(B, { created_at: "2026-10-17T00:00:03.000Z" })], native: true }); await f.ready();
  await f.view.markMessageNotificationsForChatRead(CHAT, READ); await f.drain();
  assert.equal(f.calls.some(c => c.type === "raw" && c.table === "notifications"), false);
  assert.notEqual(f.view.items.find(r => r.id === A).read_at, null); assert.equal(f.view.items.find(r => r.id === B).read_at, null);
  assert.deepEqual(f.nativeReads.map(c => c.value), [{ chatId: CHAT, confirmed: [{ notificationId: A, messageId: A }] }]);
});
for (const loss of ["changed", "removed", "read", "terminal", "epoch", "gap", "unmount"]) {
  test(`held actual sound authority refuses ${loss} without stale effects`, async t => {
    const f = owned(t); await f.ready(); const held = f.hold("message_notification_alert_decisions"); await f.insert(notice());
    assert.equal(f.calls.filter(c => c.name === "message_notification_alert_decisions").length, 1);
    if (loss === "changed") await f.update(notice(A, { payload: { ...notice().payload, preview: "Changed fiction" } }));
    if (loss === "removed") await f.remove(A);
    if (loss === "read") await f.view.markRead(A);
    if (loss === "terminal") await f.update(notice(A, { alert_suppressed_at: READ }));
    if (loss === "epoch") await f.change({ renderNow: false });
    if (loss === "gap") f.channels[0].status("CHANNEL_ERROR");
    if (loss === "unmount") f.unmount();
    held.resolve({ error: null, data: [{ notification_id: A, allowed: true, scope_key: "general", revision: 0 }] });
    await f.drain(); assert.equal(f.sounds.length, 0);
  });
}
