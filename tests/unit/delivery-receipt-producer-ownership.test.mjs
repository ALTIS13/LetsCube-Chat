import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useChats.ts");
const CHAT = "8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
const ROW = { id: "83b36491-4fb2-40aa-a3b6-e6ca8f8d820b", chat_id: CHAT, user_id: "peer", bot_id: null,
  type: "text", content: "fictional", created_at: "2026-10-07T00:00:01.123456Z", deleted_at: null };
const chat = () => ({ id: CHAT, type: "private", name: "fictional", created_by: "A", updated_at: ROW.created_at,
  unread_count: 0, members: [{ user_id: "A" }, { user_id: "B" }], last_message: null });
const membership = { chat_id: CHAT, joined_at: "2026-10-01T00:00:00Z", last_read_at: null,
  last_delivered_at: null, hidden_at: null, cleared_at: null, pinned: false };
const fixtures = new Set();
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });

function compile(text, require, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [(context) => {
      const visit = (node) => ts.isMetaProperty(node) ? ts.factory.createIdentifier("testImportMeta") : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports, require, Error, Date, console, ...globals });
  return module.exports;
}

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

// Execute the complete hook, actual receipt adapter/scheduler and pure projections.
// Only React scheduling, auth-store transitions, providers and local caches are fictional.
function fixture({ text = source } = {}) {
  const slots = [], effects = new Map(), cleanups = new Map(), timers = new Map(), channels = [], calls = [], publications = [], listeners = new Map();
  const held = new Map(), pending = [], subscribers = new Set(), modules = new Map();
  let cursor = 0, dirty = true, mounted = true, view, nextTimer = 0;
  let state = { currentUser: { id: "A" }, accountEpoch: 1, chats: [chat()], messages: {}, selectedChatId: null };
  const publish = (kind, detail) => publications.push({ kind, owner: state.currentUser?.id, epoch: state.accountEpoch, detail });
  const setChats = (chats) => { publish("chats", chats); state = { ...state, chats }; dirty = true; };
  const storeMethods = { setChats, setSelectedChatId(value) { publish("selection", value); state.selectedChatId = value; },
    setMessages(id, messages) { publish("messages", id); state.messages[id] = messages; }, removeMessage(id) { publish("remove-message", id); } };
  const useAppStore = Object.assign((select) => select({ ...state, ...storeMethods }), {
    getState: () => ({ ...state, ...storeMethods }),
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
  });
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useMemo(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { value: callback(), deps }; return slots[index].value; },
    useEffect(callback, deps) { const index = cursor++; if (!same(slots[index], deps)) { slots[index] = deps; effects.set(index, callback); } },
  };
  const hold = (name) => { const gate = deferred(); held.set(name, [...(held.get(name) ?? []), gate]); return gate; };
  const boundary = (name, answer) => {
    const gate = held.get(name)?.shift();
    if (gate) pending.push(gate);
    return gate?.promise ?? Promise.resolve(answer);
  };
  const client = {
    rpc(fn, args) { calls.push({ kind: "rpc", fn, args, owner: state.currentUser?.id, epoch: state.accountEpoch });
      return boundary(fn, fn === "chat_list_summaries" ? { data: [{ chat_id: CHAT, last_message: ROW, unread_count: 1 }], error: null } : { error: null }); },
    from(table) {
      let selection = "", single = false;
      const query = {
        select(value) { selection = value; return query; }, eq() { return query; }, in() { return query; }, order() { return query; },
        is() { return query; }, gt() { return query; }, or() { return query; }, limit() { return query; },
        maybeSingle() { single = true; return query; },
        then(done, fail) {
          const kind = table === "chat_members" ? "members" : table === "messages" ? (single ? "joined" : selection === "id" ? "unread" : "last") : table;
          calls.push({ kind, owner: state.currentUser?.id, epoch: state.accountEpoch });
          const data = table === "chat_members" ? [] : table === "chats" ? [chat()] : table === "messages" ? (single ? { ...ROW, bot_id: "fictional-bot", user_id: null, bot: { id: "fictional-bot", display_name: "fictional bot" } } : [ROW]) : [];
          return boundary(kind, { data, count: 1, error: null }).then(done, fail);
        },
      };
      return query;
    },
  };
  const rt = {
    channel(name) { const channel = { name, bindings: [], removed: false,
      on(type, filter, callback) { channel.bindings.push({ type, filter, callback }); return channel; },
      subscribe(callback) { channel.status = callback; return channel; } };
      channels.push(channel); return channel; },
    removeChannel(channel) { channel.removed = true; return Promise.resolve(); },
  };
  let currentRealtime = rt;
  const events = {
    addEventListener(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event) { publish(event.type, event.detail); for (const callback of listeners.get(event.type) ?? []) callback(event); },
  };
  const setTimeout = (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; };
  const clearTimeout = (id) => timers.delete(id);
  const globals = { testImportMeta: { env: { DEV: false, VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED: "1" } },
    window: { ...events, setTimeout }, document: { ...events, visibilityState: "visible", title: "" },
    setTimeout, clearTimeout, console: { warn() {}, error() {}, debug() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  };
  const noop = () => {};
  const cache = (kind, value) => (...args) => { publish(kind, args); return value; };
  const chatTree = ts.createSourceFile("chatDisplay.ts", read("lib/chatDisplay.ts"), ts.ScriptTarget.Latest, true);
  const saved = compile(chatTree.statements.filter((node) => ts.isFunctionDeclaration(node) && ["isSavedChat", "isSavedChatLikeName"].includes(node.name?.text))
    .map((node) => node.getText(chatTree)).join("\n"), () => { throw new Error("unexpected dependency"); });
  const aliases = {
    react, "@/store/app.store": { useAppStore }, "@/lib/supabase/client": { createClient: () => client, getRealtimeClient: () => currentRealtime },
    "@/lib/dev/instrumentation": { bumpFetch: noop, registerChannel: noop, unregisterChannel: noop },
    "@/lib/chatBotMembership": { fetchChatBots: () => boundary("bots", new Map()) },
    "@/lib/chatDisplay": saved, "@/lib/errors": { mapPgError: () => "fictional error" },
    "@/lib/messageProjection": { MESSAGE_LAST_MESSAGE_SELECT: "fixture projection" },
    "@/lib/clearedAtCache": { clearedAtCache: { beginMembershipRead: () => 1, seedFromMembershipRead: cache("seed-members"), evictChat: cache("evict-chat"), setLive: cache("live") } },
    "@/lib/hiddenMessagesLive": { hiddenMessagesLive: { lost: cache("hidden-lost"), pingReturned: cache("ping"), heard: cache("hide"), joined: cache("hidden-joined") }, readHideEvent: (event) => event },
    "@/lib/channelActivity": { emitChannelActivity: cache("activity") },
    "@/lib/channelPreviewCache": { channelPreviewCache: { hearUpdate: cache("preview-update"), evict: cache("preview-evict") } },
    "@/lib/realtimeRevival": { CONNECTION_REVIVED_EVENT: "fixture-revived" },
  };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const result = compile(name === "hooks/useChats.ts" ? text : read(name), (dependency) => {
      if (Object.hasOwn(aliases, dependency)) return aliases[dependency];
      if (dependency.startsWith("@/")) return load(dependency.slice(2) + ".ts");
      assert.ok(dependency.startsWith("."), `unexpected dependency ${dependency}`);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)));
    }, globals);
    modules.set(name, result); return result;
  }
  const hook = load("hooks/useChats.ts").useChats;
  function flush() {
    for (let turns = 0; mounted && dirty; turns++) {
      assert.ok(turns < 30, "hook render settles"); dirty = false; cursor = 0; view = hook();
      const batch = [...effects]; effects.clear();
      for (const [index, callback] of batch) { cleanups.get(index)?.(); cleanups.set(index, callback()); }
    }
  }
  const drain = async () => { for (let i = 0; i < 24; i++) { await Promise.resolve(); flush(); } };
  flush();
  const f = {
    calls, publications, channels, timers, hold, drain,
    get view() { flush(); return view; },
    get state() { return state; },
    seed() { state = { ...state, chats: [chat()] }; dirty = true; flush(); },
    clear() { calls.length = 0; publications.length = 0; },
    replaceRealtime() { currentRealtime = { ...rt }; dirty = true; flush(); },
    change(id, render = true) {
      const previous = state; state = { ...state, currentUser: id ? { id } : null, accountEpoch: state.accountEpoch + 1 };
      for (const callback of subscribers) callback(state, previous);
      dirty = true; if (render) flush();
    },
    async fireTimers(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback(); } await drain(); },
    unmount() { mounted = false; for (const callback of cleanups.values()) callback?.(); cleanups.clear(); },
    async close() { f.unmount(); for (const gate of pending) gate.resolve({ data: [], error: null }); await drain(); timers.clear(); },
  };
  fixtures.add(f); return f;
}

async function ready(options) { const f = fixture(options); await f.drain(); f.seed(); f.clear(); return f; }
const messages = (f) => f.channels.filter((item) => item.name.endsWith(":messages")).at(-1);
const insert = (channel) => channel.bindings.find((item) => item.filter.event === "INSERT").callback;
const delivered = (f) => f.calls.filter((item) => item.fn === "mark_chat_delivered");

async function retiredInsert(options, { sameUser = false, beforeRender = false, unmount = false } = {}) {
  const f = await ready(options); const old = insert(messages(f));
  if (unmount) f.unmount(); else { f.change(sameUser ? "A" : "B", !beforeRender); if (!beforeRender) { await f.drain(); f.seed(); } }
  f.clear(); old({ new: ROW });
  assert.equal(f.publications.length, 0, "retired callback must not publish account-dependent effects");
  await f.fireTimers(2500);
  assert.equal(delivered(f).length, 0, "retired producer must not create a receipt for the current owner");
}

async function epochRegistration(options) {
  const f = await ready(options); const old = messages(f);
  f.change("A"); await f.drain(); f.seed();
  assert.notEqual(messages(f), old, "same-user session epoch must re-register the producer");
  assert.equal(old.removed, true);
  f.clear(); insert(messages(f))({ new: ROW }); await f.fireTimers(2500);
  assert.equal(delivered(f).length, 1); assert.equal(delivered(f)[0].epoch, 2);
}

async function heldFetch(options, unmount = false) {
  const f = await ready(options); const old = f.hold("members");
  const pending = f.view.refetch(); await f.drain();
  if (unmount) f.unmount(); else { f.change("A"); await f.drain(); f.seed(); }
  f.clear();
  old.resolve({ data: [membership], error: null }); await pending; await f.drain(); await f.fireTimers(2500);
  assert.equal(f.calls.length, 0, "retired full-fetch continuation must not read or report under the new session");
  assert.equal(f.publications.length, 0, "retired full-fetch continuation must not replace the current list");
}

async function retiredRegistration(options) {
  const f = await ready(options); const old = insert(messages(f));
  f.replaceRealtime(); await f.drain(); f.clear(); old({ new: ROW });
  assert.equal(f.publications.length, 0, "cleanup must synchronously retire a replaced registration of the same owner");
  await f.fireTimers(2500); assert.equal(delivered(f).length, 0);
}

async function retiredChatsRefetch(options) {
  const f = await ready(options); const old = f.channels.find((item) => item.name.endsWith(":chats"));
  f.replaceRealtime(); await f.drain(); f.clear();
  for (const binding of old.bindings) binding.callback({ new: { id: CHAT }, old: { id: CHAT } });
  await f.fireTimers(350);
  assert.equal(f.calls.length, 0, "retired table callback must not schedule a read for the current registration");
}

async function overlappingFetch(options) {
  const f = await ready(options); const old = f.hold("members"); const oldRead = f.view.refetch(); await f.drain();
  const current = f.hold("members"); const before = f.calls.filter((item) => item.kind === "members").length;
  f.change("A"); await f.drain();
  assert.equal(f.calls.filter((item) => item.kind === "members").length, before + 1, "new owner starts its own read while old one is held");
  old.resolve({ data: [], error: null }); await oldRead; await f.drain();
  f.view.refetch(); await f.drain();
  assert.equal(f.calls.filter((item) => item.kind === "members").length, before + 1, "retired finally must not clear the new in-flight guard");
  current.resolve({ data: [], error: null }); await f.drain();
}

async function heldJoined(options) {
  const f = await ready(options); const old = f.hold("joined");
  insert(messages(f))({ new: { ...ROW, user_id: null, bot_id: "fictional-bot" } }); await f.drain();
  assert.ok(f.calls.some((item) => item.kind === "joined"), "actual bot enrichment is held");
  f.change("A"); await f.drain(); f.seed(); f.clear();
  old.resolve({ data: { ...ROW, user_id: null, bot_id: "fictional-bot", bot: { id: "fictional-bot", display_name: "fictional" } }, error: null });
  await f.drain();
  assert.equal(f.publications.length, 0, "retired joined-row continuation must not publish into the current session");
}

async function heldPing(options) {
  const f = await ready(options); const old = f.hold("hides_live_ping");
  const channel = f.channels.find((item) => item.name === "hides:A"); channel.status("SUBSCRIBED"); await f.drain();
  f.change("A"); await f.drain(); f.clear(); old.resolve({ error: { code: "fictional" } }); await f.drain();
  assert.equal(f.publications.length, 0, "retired ping failure must not mark the current live cache lost");
}

test("valid current producer publishes one delivered RPC for the incoming private message", async () => {
  const f = await ready(); insert(messages(f))({ new: ROW }); await f.fireTimers(2500);
  assert.equal(delivered(f).length, 1); assert.equal(delivered(f)[0].owner, "A"); assert.equal(delivered(f)[0].epoch, 1);
  assert.ok(f.publications.some((item) => item.kind === "activity"));
});
test("old callback is inert after actual hook cleanup without an account change", () => retiredInsert(undefined, { unmount: true }));
test("same-owner realtime registration cleanup is synchronous", () => retiredRegistration());
test("same-owner replaced chats-table callback cannot schedule a current read", () => retiredChatsRefetch());
test("old A producer cannot dispatch into mounted B", () => retiredInsert());
test("live store fences A producer before React handles the account replacement", () => retiredInsert(undefined, { beforeRender: true }));
test("live store fences same-user replaced-session producer before React cleanup", () => retiredInsert(undefined, { sameUser: true, beforeRender: true }));
test("same-user epoch replacement re-registers a working producer", () => epochRegistration());
test("late full-fetch reply cannot cross a same-user session boundary", () => heldFetch());
test("late full-fetch reply cannot publish or report after hook unmount", () => heldFetch(undefined, true));
test("late joined-message reply cannot cross a same-user session boundary", () => heldJoined());
test("late hides ping failure cannot invalidate the current session cache", () => heldPing());

test("new session full fetch does not wait for a retired request, and its state survives the old finally", () => overlappingFetch());

for (const family of ["peer", "membership", "hides", "status", "message-update"]) {
  test(`retired ${family} callback cannot publish into the current owner`, async () => {
    const f = await ready(); const oldChannels = [...f.channels]; f.change("A"); await f.drain(); f.clear();
    const payload = { new: { ...ROW, user_id: "peer", cleared_at: null, last_read_at: ROW.created_at }, old: { chat_id: CHAT, user_id: "peer" }, payload: { chatId: CHAT, messageId: ROW.id, hidden: true } };
    for (const channel of oldChannels) {
      if (family === "status") channel.status?.("SUBSCRIBED");
      else if ((family === "peer" && channel.name.includes(":peers:")) || (family === "membership" && channel.name.startsWith("chat-members:user:"))
        || (family === "hides" && channel.name.startsWith("hides:"))) for (const binding of channel.bindings) binding.callback(payload);
      else if (family === "message-update" && channel.name.endsWith(":messages")) channel.bindings.find((item) => item.filter.event === "UPDATE").callback(payload);
    }
    await f.drain();
    assert.equal(f.publications.length, 0, "retired callback family must not mutate current-owner state");
    assert.equal(f.calls.length, 0, "retired callback family must not issue current-owner requests");
  });
}

function mutate(before, after) {
  assert.equal(source.split(before).length - 1, 1, "literal mutant changes exactly one production block");
  return source.replace(before, after);
}

const mutants = [
  ["live epoch omitted", " &&\n      useAppStore.getState().accountEpoch === accountEpoch", "",
    (options) => retiredInsert(options, { sameUser: true, beforeRender: true }), "retired callback must not publish account-dependent effects"],
  ["unmount lease invalidation omitted", "if (ownerRef.current === owner) ownerRef.current = null;", "",
    (options) => heldFetch(options, true), "retired full-fetch continuation must not read or report under the new session"],
  ["synchronous registration cleanup omitted", "active = false;\n      for (const { name, channel } of channels)", "for (const { name, channel } of channels)",
    retiredRegistration, "cleanup must synchronously retire a replaced registration of the same owner"],
  ["message callback entry omitted", "const handleMessageInsert = (payload: RealtimeRowPayload) => {\n      if (!isCurrent()) return;", "const handleMessageInsert = (payload: RealtimeRowPayload) => {",
    retiredInsert, "retired callback must not publish account-dependent effects"],
  ["chats-table registration fence omitted", "const refetchIfCurrent = () => { if (isCurrent()) scheduleRefetch(); };", "const refetchIfCurrent = () => { scheduleRefetch(); };",
    retiredChatsRefetch, "retired table callback must not schedule a read for the current registration"],
  ["joined continuation fence omitted", "if (!isCurrent() || !data) return;", "if (!data) return;",
    heldJoined, "retired joined-row continuation must not publish into the current session"],
  ["ping continuation fence omitted", 'void supabase.rpc("hides_live_ping").then(({ error }) => {\n          if (!isCurrent()) return;', 'void supabase.rpc("hides_live_ping").then(({ error }) => {',
    heldPing, "retired ping failure must not mark the current live cache lost"],
  ["old finally fence omitted", "} finally {\n      if (isCurrentAccount()) {", "} finally {\n      if (true) {",
    overlappingFetch, "retired finally must not clear the new in-flight guard"],
  ["new-owner in-flight reset omitted", "ownerRef.current = owner;\n    fetchInFlightRef.current = false;", "ownerRef.current = owner;",
    overlappingFetch, "new owner starts its own read while old one is held"],
];
for (const [name, before, after, scenario, oracle] of mutants) {
  test(`compiled omission mutant rejected: ${name}`, async () => {
    const text = mutate(before, after);
    await assert.rejects(() => scenario({ text }), (error) => error.code === "ERR_ASSERTION" && error.message.split("\n")[0] === oracle);
  });
}
