import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useMessages.ts");
const CHAT = "30000000-0000-0000-0000-000000000001";
const FIRST = "2026-10-07T00:00:01.123456Z";
const row = (n = 1) => ({ id: `40000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  chat_id: CHAT, user_id: "fictional-peer", bot_id: null, topic_id: null, type: "text", content: "fictional",
  created_at: FIRST, deleted_at: null, sender: { id: "fictional-peer" }, reactions: [], reply_to_id: null });
const fixtures = new Set();
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });

function compile(text, require, globals) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [(context) => {
      const visit = (node) => ts.isMetaProperty(node) ? ts.factory.createIdentifier("testImportMeta")
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  assert.equal(compiled.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require, Error, Date, ...globals });
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Entire hook, receipt adapter/scheduler and pure helpers execute actual source.
// React commits, store transitions, REST/realtime, caches and clocks are fictional.
function fixture({ text = source, holdInitially, visibility = "visible", historyRows = [row()] } = {}) {
  const slots = [], effects = new Map(), cleanups = new Map(), channels = [], calls = [], publications = [];
  const timers = new Map(), gates = new Map(), pending = [], subscribers = new Set(), listeners = new Map(), modules = new Map();
  let cursor = 0, dirty = true, mounted = true, view, nextTimer = 0;
  let props = { chatId: CHAT, topicId: undefined, generalTopicIds: [] };
  let state = { currentUser: { id: "fictional-owner" }, accountEpoch: 1, selectedChatId: CHAT,
    chats: [{ id: CHAT, type: "private", created_by: "fictional-peer", members: [{ user_id: "fictional-owner" }, { user_id: "fictional-peer" }] }], messages: {} };
  const publish = (kind, detail) => publications.push({ kind, detail, mounted, epoch: state.accountEpoch });
  const methods = {
    setMessages(chatId, messages) { publish("messages", chatId); state = { ...state, messages: { ...state.messages, [chatId]: messages } }; dirty = true; },
    addMessage(chatId, message) { publish("add", chatId); state.messages[chatId] = [...(state.messages[chatId] ?? []).filter(item => item.id !== message.id), message]; dirty = true; },
    replaceMessage() { throw new Error("outgoing mutation outside fixture scope"); }, removeMessage() {}, updateChat() {}, updateChatLastMessage() {},
  };
  const useAppStore = Object.assign(select => select({ ...state, ...methods }), {
    getState: () => ({ ...state, ...methods }),
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
  });
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const effect = (layout) => (callback, deps) => {
    const index = cursor++;
    if (!equal(slots[index], deps)) { slots[index] = deps; effects.set(index, { callback, layout }); }
  };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { publish("state", index); slots[index] = next; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useMemo(callback, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { value: callback(), deps }; return slots[index].value; },
    useEffect: effect(false), useLayoutEffect: effect(true),
  };
  const hold = (name) => { const gate = deferred(); gates.set(name, [...(gates.get(name) ?? []), gate]); return gate; };
  if (holdInitially) hold(holdInitially);
  const boundary = (name, answer) => {
    const gate = gates.get(name)?.shift(); if (gate) pending.push(gate);
    return gate?.promise ?? Promise.resolve(answer);
  };
  const client = {
    from(table) {
      const predicates = [], query = {
        select() { return query; }, eq(key, value) { predicates.push([key, value]); return query; },
        in() { return query; }, is() { return query; }, gt() { return query; }, or() { return query; }, order() { return query; },
        lt() { query.older = true; return query; }, limit() { return query; },
        maybeSingle() { query.single = true; return query; }, single() { query.single = true; return query; },
        then(done, fail) {
          const name = table === "chat_members" ? "mark" : table === "message_hidden_for_users" ? "hidden"
            : predicates.some(([key]) => key === "id") ? "joined" : predicates.some(([key]) => key === "pinned") ? "pinned"
              : query.older ? "older" : "history";
          calls.push({ name, table, predicates, epoch: state.accountEpoch });
          const data = name === "mark" ? { cleared_at: null } : name === "history" ? historyRows
            : name === "joined" ? row() : name === "older" ? [row(102)] : [];
          return boundary(name, { data, error: null }).then(done, fail);
        },
      }; return query;
    },
    rpc(fn, args) { calls.push({ name: "rpc", fn, args, epoch: state.accountEpoch }); return boundary(fn, { error: null }); },
  };
  const rt = {
    channel(name) { const channel = { name, bindings: [], on(type, filter, callback) { channel.bindings.push({ type, filter, callback }); return channel; },
      subscribe(callback) { channel.status = callback; return channel; }, send() {} }; channels.push(channel); return channel; },
    removeChannel() { return Promise.resolve("ok"); },
  };
  const events = {
    addEventListener(name, callback) { const entries = listeners.get(name) ?? new Set(); entries.add(callback); listeners.set(name, entries); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event) { publish(event.type, event.detail); for (const callback of listeners.get(event.type) ?? []) callback(event); },
  };
  const setTimeout = (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; };
  const clearTimeout = (id) => timers.delete(id);
  const globals = { testImportMeta: { env: { DEV: false } },
    window: { ...events, setTimeout, clearTimeout }, document: { ...events, visibilityState: visibility },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout, clearTimeout, console: { error() {}, warn() {}, debug() {} },
  };
  const noop = () => {};
  const aliases = {
    react, "@/store/app.store": { useAppStore }, "@/lib/supabase/client": { createClient: () => client, getRealtimeClient: () => rt },
    "@/lib/dev/instrumentation": { bumpFetch: noop, registerChannel: noop, unregisterChannel: noop },
    "@/lib/errors": { mapPgError: () => "fictional error" }, "@/lib/monitoring": { reportError: () => publish("error") },
    "@/lib/channelActivity": { emitChannelActivity: () => publish("activity") },
    "@/lib/messageProjection": { MESSAGE_SELECT_WITH_JOINS: "fixture projection" },
    "@/lib/outbox/appOutbox": { appOutbox: { enqueue() { throw new Error("outbox mutation outside fixture scope"); } } },
    "@/lib/clearedAtCache": { clearedAtCache: {
      hasFresh: () => false, getOrLoad: async (_chat, _user, load) => { const result = await load(); return result.ok ? result.value : undefined; }, evictChat: noop,
    } },
    "@/lib/hiddenMessagesLive": { hiddenMessagesLive: {
      subscribe: () => noop, canSkip: () => false, markVerified: () => publish("verified"),
    } },
    "@/lib/recentReactions": { rememberReactionUse: noop },
  };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const result = compile(name === "hooks/useMessages.ts" ? text : read(name), dependency => {
      if (Object.hasOwn(aliases, dependency)) return aliases[dependency];
      if (dependency.startsWith("@/")) return load(dependency.slice(2) + ".ts");
      assert.ok(dependency.startsWith("."), `unexpected dependency ${dependency}`);
      const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency));
      return load(normalized.endsWith(".ts") ? normalized : normalized + ".ts");
    }, globals);
    modules.set(name, result); return result;
  }
  const hook = load("hooks/useMessages.ts").useMessages;
  function flush() {
    for (let turns = 0; mounted && dirty; turns++) {
      assert.ok(turns < 30, "actual hook render settles"); dirty = false; cursor = 0;
      view = hook(props.chatId, props.topicId, props.generalTopicIds);
      const batch = [...effects].sort((a, b) => Number(b[1].layout) - Number(a[1].layout)); effects.clear();
      for (const [index] of batch) cleanups.get(index)?.();
      for (const [index, { callback }] of batch) cleanups.set(index, callback());
    }
  }
  const drain = async () => { for (let i = 0; i < 50; i++) { await Promise.resolve(); flush(); } };
  flush();
  const f = {
    calls, publications, timers, channels, hold, pending, drain,
    get view() { flush(); return view; }, get state() { return state; },
    clear() { calls.length = 0; publications.length = 0; },
    changeEpoch(render = true) { const previous = state; state = { ...state, accountEpoch: state.accountEpoch + 1 }; dirty = render;
      for (const callback of subscribers) callback(state, previous); if (render) flush(); },
    switchTopic(topicId) { props = { ...props, topicId }; dirty = true; flush(); },
    unmount() { mounted = false; for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); },
    async remount() { slots.length = 0; effects.clear(); mounted = true; dirty = true; flush(); await drain(); },
    async replayEffects() {
      const indexes = [...cleanups.keys()]; for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear();
      for (const index of indexes) delete slots[index]; dirty = true; flush(); await drain();
    },
    async fireTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } await drain(); },
    async close() { f.unmount(); for (const gate of pending) gate.resolve({ data: [], error: null }); await drain(); timers.clear(); },
  };
  fixtures.add(f); return f;
}

async function lateInitial(options = {}, stage = "history", visibility = "visible") {
  const f = fixture({ ...options, holdInitially: stage, visibility }); await f.drain();
  assert.ok(f.calls.some(call => call.name === stage), "initial actual read reaches the held provider boundary");
  const held = f.pending[0]; f.unmount(); f.clear();
  held.resolve({ data: stage === "mark" ? { cleared_at: null } : stage === "history" ? [row()] : [], error: null });
  await f.drain();
  assert.equal(f.calls.length, 0, "unmounted initial fetch cannot issue its next provider read");
  assert.equal(f.timers.size, 0, "unmounted initial fetch cannot schedule a receipt");
  assert.equal(f.publications.length, 0, "unmounted initial fetch cannot publish rows or state");
  await f.fireTimers(); assert.equal(f.calls.length, 0);
}
for (const stage of ["mark", "history", "hidden"]) {
  test(`actual initial fetch is inert after unmount at ${stage} await`, () => lateInitial({}, stage));
}
test("actual hidden-page completion cannot schedule delivered after unmount", () => lateInitial({}, "hidden", "hidden"));

for (const visibility of ["visible", "hidden"]) {
  test(`mounted ${visibility} producer still reports through the actual receipt adapter`, async () => {
    const f = fixture({ visibility }); await f.drain();
    assert.equal(f.state.messages[CHAT].length, 1);
    assert.equal(f.view.messages.length, 1); await f.fireTimers();
    const writes = f.calls.filter(call => call.name === "rpc");
    assert.equal(writes.length, 1); assert.equal(writes[0].fn, visibility === "visible" ? "mark_chat_read_through" : "mark_chat_delivered");
    assert.equal(writes[0].epoch, 1);
  });
}

test("same-user new session still fences a held initial page and starts its own refresh", async () => {
  const f = fixture({ holdInitially: "history" }); await f.drain(); const old = f.pending[0];
  f.changeEpoch(); await f.drain(); assert.equal(f.state.messages[CHAT].length, 1);
  f.clear(); old.resolve({ data: [row(2)], error: null }); await f.drain();
  assert.equal(f.state.messages[CHAT][0].id, row().id); assert.equal(f.publications.length, 0);
});

test("mounted topic change still triggers a fresh page without accepting the old page", async () => {
  const f = fixture({ holdInitially: "history" }); await f.drain(); const old = f.pending[0];
  f.switchTopic("fictional-topic"); await f.drain();
  assert.equal(f.calls.filter(call => call.name === "history").length, 2);
  f.clear(); old.resolve({ data: [row(2)], error: null }); await f.drain(); assert.equal(f.publications.length, 0);
});

async function lateById(options) {
  const f = fixture(options); await f.drain(); await f.fireTimers();
  const held = f.hold("joined"), pending = f.view.ensureMessageLoaded(row().id); await f.drain();
  f.unmount(); f.clear(); held.resolve({ data: row(2), error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, 0, "unmounted exact-message fetch cannot ask for hidden rows");
  assert.equal(f.publications.length, 0);
}
test("actual exact-message continuation is inert after unmount", () => lateById());

async function latePinned(options) {
  const f = fixture(options); await f.drain(); await f.fireTimers();
  const held = f.hold("pinned"), pending = f.view.refetchPinnedMessages(); await f.drain();
  f.unmount(); f.clear(); held.resolve({ data: [row()], error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, 0, "unmounted pinned fetch cannot ask for hidden rows");
  assert.equal(f.publications.length, 0);
}
test("actual pinned-page continuation is inert after unmount", () => latePinned());

async function capturedRefetch(options) {
  const f = fixture(options); await f.drain(); const refetch = f.view.refetch;
  f.unmount(); f.clear(); await refetch(); await f.drain();
  assert.equal(f.calls.length, 0, "captured refetch cannot start after unmount");
  assert.equal(f.publications.length, 0);
}
test("captured actual refetch cannot start provider work after unmount", () => capturedRefetch());

async function oldLifetime(options) {
  const f = fixture({ ...options, holdInitially: "history" }); await f.drain(); const old = f.pending[0];
  f.unmount(); await f.remount(); assert.equal(f.state.messages[CHAT][0].id, row().id);
  f.clear(); old.resolve({ data: [row(2)], error: null }); await f.drain();
  assert.equal(f.publications.length, 0, "retired hook lifetime cannot rejoin a mounted same-account successor");
}
test("same-account remount cannot revive the prior instance's pending page", () => oldLifetime());

async function lateFailure(options) {
  const f = fixture({ ...options, holdInitially: "history" }); await f.drain();
  const old = f.pending[0]; f.unmount(); f.clear(); old.reject(new Error("fictional offline")); await f.drain();
  assert.equal(f.publications.length, 0, "retired history rejection cannot publish monitoring or UI state");
}
test("retired initial fetch rejection is inert", () => lateFailure());

async function lateHiddenBatch(options) {
  const f = fixture({ ...options, historyRows: Array.from({ length: 101 }, (_, n) => ({ ...row(n + 1), reply_to_id: row(n + 1001).id })) });
  await f.drain(); await f.fireTimers();
  const old = f.hold("hidden"), pending = f.view.refetch(); await f.drain();
  assert.ok(f.calls.some(call => call.name === "hidden"), "held hidden batch positive control");
  f.unmount(); f.clear(); old.resolve({ data: [], error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, 0, "retired hidden batch cannot issue another page request");
  assert.equal(f.publications.length, 0);
}
test("hidden-id batches stop between provider awaits after unmount", () => lateHiddenBatch());

async function lateOlder(options) {
  const f = fixture({ ...options, historyRows: Array.from({ length: 101 }, (_, n) => row(n + 1)) });
  await f.drain(); await f.fireTimers(); assert.equal(f.view.hasMoreOlder, true);
  const held = f.hold("older"), pending = f.view.loadOlderMessages(); await f.drain();
  f.unmount(); f.clear(); held.resolve({ data: [row(102)], error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, 0, "retired older page cannot ask for hidden rows");
  assert.equal(f.publications.length, 0);
}
test("actual older-page continuation is inert after unmount", () => lateOlder());

async function replayedPinned(options) {
  const f = fixture(options); await f.drain(); await f.fireTimers();
  const held = f.hold("pinned"), pending = f.view.refetchPinnedMessages(); await f.drain();
  await f.replayEffects(); f.clear(); held.resolve({ data: [row()], error: null }); await pending; await f.drain();
  assert.equal(f.publications.length, 0, "retired pinned request cannot rejoin a replayed hook lifetime");
}
test("effect cleanup/setup on the same hook cells cannot revive a pending pinned request", () => replayedPinned());

async function staleEpochPinned(options) {
  const f = fixture(options); await f.drain(); await f.fireTimers();
  const held = f.hold("pinned"), pending = f.view.refetchPinnedMessages(); await f.drain();
  f.changeEpoch(false); f.clear(); held.resolve({ data: [row()], error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, 0, "retired account epoch cannot request hidden rows before a render");
  assert.equal(f.publications.length, 0);
}
test("live account epoch fences pinned completion before React renders the replacement", () => staleEpochPinned());

test("mounted current exact, pinned and older fetches still publish their results", async () => {
  const f = fixture({ historyRows: Array.from({ length: 101 }, (_, n) => row(n + 1)) });
  await f.drain(); await f.fireTimers();
  const exact = f.hold("joined"), loadingExact = f.view.ensureMessageLoaded(row(103).id); await f.drain();
  exact.resolve({ data: row(103), error: null });
  assert.equal((await loadingExact).ok, true); await f.drain();
  assert.ok(f.state.messages[CHAT].some(message => message.id === row(103).id));
  const pinned = f.hold("pinned"), loadingPinned = f.view.refetchPinnedMessages(); await f.drain();
  pinned.resolve({ data: [row()], error: null }); await loadingPinned; await f.drain();
  assert.equal(f.view.pinnedMessages.length, 1);
  assert.equal((await f.view.loadOlderMessages()).loaded, 1); await f.drain();
  assert.ok(f.state.messages[CHAT].some(message => message.id === row(102).id));
});

test("mounted current initial rejection still publishes the refusal and monitoring", async () => {
  const f = fixture({ holdInitially: "history" }); await f.drain(); f.clear();
  f.pending[0].reject(new Error("fictional offline")); await f.drain();
  assert.equal(f.publications.filter(item => item.kind === "error").length, 1);
  assert.equal(f.view.historyError, "Не удалось загрузить историю чата.");
  assert.equal(f.view.loading, false);
});

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, "literal mutation anchor is unique");
  return text.replace(before, after);
}

const mutations = [
  ["unmount cleanup", () => replaceOnce(source,
    "    return () => { if (hookLifetimeRef.current === lifetime) hookLifetimeRef.current = null; };",
    "    return () => {};"), options => lateInitial(options, "hidden"), "unmounted initial fetch cannot schedule a receipt"],
  ["lifecycle predicate", () => replaceOnce(source,
    "lifetime && lifetimeRef.current === lifetime && userId", "userId"),
    options => lateInitial(options, "hidden"), "unmounted initial fetch cannot schedule a receipt"],
  ["mounted lifetime requirement", () => replaceOnce(source,
    "lifetime && lifetimeRef.current === lifetime && userId", "lifetimeRef.current === lifetime && userId"),
    capturedRefetch, "captured refetch cannot start after unmount"],
  ["replayed lifetime identity", () => replaceOnce(source,
    "lifetime && lifetimeRef.current === lifetime && userId", "lifetime && userId"),
    replayedPinned, "retired pinned request cannot rejoin a replayed hook lifetime"],
  ["fetch rejection guard", () => replaceOnce(source,
    '    } catch (error) {\n      if (!isCurrent()) return;\n      console.error("Messages fetch error:", error);',
    '    } catch (error) {\n      console.error("Messages fetch error:", error);'),
    lateFailure, "retired history rejection cannot publish monitoring or UI state"],
  ["hidden batch continuation guard", () => replaceOnce(source,
    '      .in("message_id", ids.slice(offset, offset + 100));\n    if (!isCurrent()) return null;',
    '      .in("message_id", ids.slice(offset, offset + 100));'),
    lateHiddenBatch, "retired hidden batch cannot issue another page request"],
  ["hidden helper owner propagation", () => replaceOnce(source,
    "fetchHiddenMessageIdSet(supabase, [...checkedIds], isCurrent)",
    "fetchHiddenMessageIdSet(supabase, [...checkedIds], () => true)"),
    lateHiddenBatch, "retired hidden batch cannot issue another page request"],
  ["live account epoch", () => replaceOnce(source,
    "  return () => Boolean(lifetime && lifetimeRef.current === lifetime && userId && useAppStore.getState().currentUser?.id === userId &&\n    useAppStore.getState().accountEpoch === epoch);",
    "  return () => Boolean(lifetime && lifetimeRef.current === lifetime && userId && useAppStore.getState().currentUser?.id === userId);"),
    staleEpochPinned, "retired account epoch cannot request hidden rows before a render"],
];

for (const [name, mutate, scenario, oracle] of mutations) {
  test(`compiled omission mutant is killed: ${name}`, async () => {
    const text = mutate();
    await assert.rejects(() => scenario({ text }), error => error.code === "ERR_ASSERTION" && error.message.includes(oracle));
  });
}
