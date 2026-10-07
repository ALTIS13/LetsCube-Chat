import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useNotifications.ts");
const syncSource = read("lib/notificationReadSync.ts");
const CHAT = "8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
const OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const FIRST = "2026-10-07T00:00:01.000Z";
const SECOND = "2026-10-07T00:00:02.000Z";
const ACK = "2026-10-07T00:00:03.000Z";
const plain = (value) => JSON.parse(JSON.stringify(value));
const activeFixtures = new Set();
test.afterEach(() => { for (const f of activeFixtures) f.unmount(); });

function compile(text, imports, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name]; }, ...globals });
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function notice(id = OLD, owner = "A", readAt = null) {
  return { id, user_id: owner, kind: "message", read_at: readAt,
    // Notification chronology intentionally differs from message chronology.
    created_at: id === OLD ? "2026-10-07T00:00:04.000Z" : "2026-10-07T00:00:05.000Z",
    payload: { chat_id: CHAT, message_id: id, sender_kind: "user", sender_id: "fictional-sender", bot_id: null } };
}

// React scheduling and external providers are controlled; the hook, read helper,
// row merge and notification projection execute actual transpiled source.
function fixture({ hook = source, sync = syncSource, native = false, nativeResult = "settled" } = {}) {
  let state = { currentUser: { id: "A" }, accountEpoch: 1, mutedChatIds: [] };
  let cursor = 0, dirty = true, mounted = true, view;
  const slots = [], effects = new Map(), cleanups = new Map(), channels = [], calls = [], closed = [];
  const rows = new Map(), messages = new Map([[OLD, FIRST], [NEW, SECOND]]), gates = new Map();
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++; if (!equal(slots[index], deps)) { slots[index] = deps; effects.set(index, effect); } },
  };
  const hold = (name) => { const gate = deferred(); gates.set(name, [...(gates.get(name) ?? []), gate]); return gate; };
  const boundary = (name, fallback) => gates.get(name)?.shift()?.promise ?? Promise.resolve(fallback);
  const client = {
    from(table) {
      const predicates = [], ids = [], query = {
        select(columns) { query.columns = columns; return query; },
        eq(key, value) { predicates.push([key, value]); return query; },
        in(key, values) { ids.push([key, [...values]]); return query; },
        lte(key, value) { query.horizon = [key, value]; return query; },
        order() { return query; }, limit() { query.refresh = true; return query; },
        then(done, fail) {
          const owner = predicates.find(([key]) => key === "user_id")?.[1];
          const selected = ids.find(([key]) => key === "id")?.[1];
          const name = table === "messages" ? "message-horizon" : query.refresh ? "refresh" : "notification-states";
          calls.push({ name, table, owner, columns: query.columns, ids: selected, horizon: query.horizon, predicates: plain(predicates) });
          const data = table === "messages"
            ? [...messages].filter(([id, createdAt]) => (!selected || selected.includes(id)) && (!query.horizon || createdAt <= query.horizon[1])).map(([id]) => ({ id }))
            : [...rows.values()].filter(row => (!owner || row.user_id === owner) && (!selected || selected.includes(row.id)));
          return boundary(name, { data, error: null }).then(done, fail);
        },
      }; return query;
    },
    rpc(fn, args) {
      const owner = state.currentUser?.id; calls.push({ name: "rpc", fn, owner, args });
      return boundary(fn, { error: null }).then(result => {
        if (!result.error) for (const [id, row] of rows) {
          if (row.user_id !== owner) continue;
          const matches = fn === "notifications_mark_read" ? id === args.p_id
            : fn === "notifications_mark_all_read" || (row.payload.chat_id === args.p_chat_id
              && (!args.p_read_until || messages.get(row.payload.message_id) <= args.p_read_until));
          if (matches) rows.set(id, { ...row, read_at: row.read_at ?? ACK });
        }
        return result;
      });
    },
    channel() { const channel = { handlers: [], on(type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
      subscribe(callback) { channel.active = true; channel.status = callback; callback("SUBSCRIBED"); return channel; } }; channels.push(channel); return channel; },
    removeChannel(channel) { channel.active = false; },
  };
  let time = Date.parse(ACK);
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const imports = {
    react, "@/store/app.store": { useAppStore: Object.assign(select => select(state), { getState: () => state }) },
    "@/lib/supabase/client": { createClient: () => client }, "@/lib/errors": { mapPgError: () => "fictional read error" },
    "@/hooks/useCallSound": { playNotificationSoundFor() {} }, "@/hooks/useOwnPresence": { ownAlertPolicySnapshot: () => "allow" },
    "@/lib/dev/instrumentation": { bumpFetch() {}, registerChannel() {}, unregisterChannel() {} }, "@/lib/chatEvents": { dispatchChatsRefresh() {} },
    "@/lib/notificationEvents": { KUB_CHAT_NOTIFICATIONS_READ_EVENT: "kub:chat-notifications-read" },
    "@/lib/notificationReadSync": compile(sync, {}), "@/lib/notificationRows": compile(read("lib/notificationRows.ts"), {}),
    "@/lib/rpcAvailability": compile(read("lib/rpcAvailability.ts"), {}, { console: { warn() {} } }),
    "@/lib/messageNotificationProjection": compile(read("lib/messageNotificationProjection.ts"), {}),
    "@/lib/browserNotificationPresentation": { notificationPresentationTag: row => row.kind.includes("message") ? `message:chat:${row.payload.chat_id}` : null,
      async closeBrowserNotification(tag) { closed.push(tag); }, async updateBrowserAppBadge() {} },
    "@/lib/platform/desktop": { isDesktopApp: () => false, getDesktopBridge: () => null },
    "@/lib/platform/capabilities": { isNativeAndroid: () => native },
    "@/lib/platform/nativePush": { async closeNativeChatNotification(read, current) {
      assert.ok(native, "native outside fixture scope"); closed.push({ read, current });
      return boundary("native-cleanup", nativeResult);
    } },
    "@/lib/platform/desktopNotifications": { desktopMessageOverflowRows: () => [] },
  };
  const events = { addEventListener() {}, removeEventListener() {} };
  const hookFn = compile(hook, imports, { Date: FixedDate, window: events, document: { ...events, visibilityState: "visible" } }).useNotifications;
  function render() { cursor = 0; dirty = false; view = hookFn(); }
  function commit() { const work = [...effects]; effects.clear(); for (const [id] of work) cleanups.get(id)?.(); for (const [id, effect] of work) cleanups.set(id, effect()); }
  async function drain() { for (let i = 0; i < 40; i++) { await Promise.resolve(); if (mounted && dirty) render(); if (mounted && effects.size) commit(); } }
  render(); commit();
  const f = { calls, closed, hold, drain, client, channels, advance(ms) { time += ms; },
    get view() { return view; },
    async insert(row) { rows.set(row.id, row); for (const channel of channels.filter(ch => ch.active)) for (const h of channel.handlers)
      if (h.filter.event === "INSERT" && h.filter.filter === `user_id=eq.${row.user_id}`) h.callback({ new: row }); await drain(); },
    async confirm(row) { rows.set(row.id, row); for (const channel of channels.filter(ch => ch.active)) for (const h of channel.handlers)
      if (h.filter.event === "UPDATE" && h.filter.filter === `user_id=eq.${row.user_id}`) h.callback({ new: row }); await drain(); },
    async change(owner, renderNow = true, advanceEpoch = true) { state = { ...state, currentUser: owner ? { id: owner } : null,
      accountEpoch: state.accountEpoch + (advanceEpoch ? 1 : 0) };
      if (renderNow) { render(); commit(); await drain(); } },
    unmount() { mounted = false; for (const cleanup of cleanups.values()) cleanup?.(); cleanups.clear(); activeFixtures.delete(f); },
  };
  activeFixtures.add(f);
  return f;
}
async function loaded(options) { const f = fixture(options); await f.drain(); return f; }

test("native cleanup call carries exact server-confirmed notification/message pair", async () => {
  const f = await loaded({ native: true }); await f.insert(notice());
  await f.view.markReadIds([OLD]); await f.drain();
  assert.deepEqual(plain(f.closed.map(call => call.read)), [{ chatId: CHAT, confirmed: [{ notificationId: OLD, messageId: OLD }] }]);
  assert.equal(f.closed[0].current(), true);
  await f.change("A", false); assert.equal(f.closed[0].current(), false, "retired same-owner epoch predicate");
  f.unmount();
});
test("native cleanup call does not blanket-dismiss a chat containing a newer unread message", async () => {
  const f = await loaded({ native: true }); await f.insert(notice()); await f.insert(notice(NEW));
  await f.view.markMessageNotificationsForChatRead(CHAT, FIRST); await f.drain();
  assert.deepEqual(plain(f.closed.map(call => call.read)), [{ chatId: CHAT, confirmed: [{ notificationId: OLD, messageId: OLD }] }]);
  assert.equal(f.view.items.find(row => row.id === NEW).read_at, null); f.unmount();
});
test("native cleanup call predicate retires on hook unmount", async () => {
  const f = await loaded({ native: true }); await f.insert(notice());
  await f.view.markReadIds([OLD]); await f.drain();
  const current = f.closed[0].current; f.unmount(); assert.equal(current(), false);
});

async function nativeLatestCleanup(hook = source) {
  const f = await loaded({ native: true, hook }); await f.insert(notice()); await f.insert(notice(NEW));
  await f.view.markReadIds([NEW]); await f.drain();
  assert.deepEqual(plain(f.closed.map(call => call.read)), [{ chatId: CHAT, confirmed: [{ notificationId: NEW, messageId: NEW }] }], "LATEST_CONFIRMED_PAIR_FORWARDED");
  assert.equal(f.view.items.find(row => row.id === OLD).read_at, null);
  await f.confirm(notice(NEW, "A", ACK)); assert.equal(f.closed.length, 1, "same read pair must not repeat IPC"); f.unmount();
}
test("native cleanup call removes latest confirmed pair despite older unread same-chat row", () => nativeLatestCleanup());
async function nativeInitialCleanup(hook = source) {
  const f = fixture({ native: true, hook }), held = f.hold("refresh");
  held.resolve({ data: [notice(OLD, "A", ACK), notice(NEW, "A", ACK)], error: null }); await f.drain();
  assert.deepEqual(plain(f.closed.map(call => call.read)), [{ chatId: CHAT,
    confirmed: [{ notificationId: NEW, messageId: NEW }, { notificationId: OLD, messageId: OLD }] }], "INITIAL_CONFIRMED_BATCH_FORWARDED");
  await f.confirm(notice(NEW, "A", ACK)); assert.equal(f.closed.length, 1); f.unmount();
}
test("native cleanup call batches initial server-confirmed pairs without prior unread render", () => nativeInitialCleanup());

async function pendingHookRetry(hook = source, rejected = false) {
  const f = await loaded({ native: true, hook }); await f.insert(notice(NEW));
  const held = f.hold("native-cleanup"); await f.view.markReadIds([NEW]); await f.drain();
  await f.confirm(notice(NEW, "A", ACK)); assert.equal(f.closed.length, 1, "PENDING_HOOK_INFLIGHT_COALESCED");
  await f.view.refresh(); await f.drain(); assert.equal(f.closed.length, 1, "PENDING_HOOK_INFLIGHT_COALESCED");
  if (rejected) held.reject(Error("fictional native ACK rejected")); else held.resolve("retry"); await f.drain();
  f.advance(4999); await f.view.refresh(); await f.drain();
  assert.equal(f.closed.length, 1, "PENDING_HOOK_COOLDOWN");
  f.advance(1); await f.confirm(notice(NEW, "A", ACK)); await f.drain();
  assert.equal(f.closed.length, 1, "PENDING_HOOK_REALTIME_NOT_RETRY_TRIGGER");
  const failedFetch = f.hold("refresh"); failedFetch.resolve({ data: null, error: { code: "42501" } });
  await f.view.refresh(); await f.drain(); await f.confirm(notice(NEW, "A", ACK));
  assert.equal(f.closed.length, 1, "PENDING_HOOK_FAILED_FETCH_NOT_RETRY_TRIGGER");
  await f.view.refresh(); await f.drain();
  assert.equal(f.closed.length, 2, "PENDING_HOOK_FETCH_RETRIES_UNSETTLED_PAIR");
  f.advance(5000); await f.view.refresh(); await f.drain();
  assert.equal(f.closed.length, 2, "PENDING_HOOK_SETTLED_PAIR_STAYS_DEDUPED"); f.unmount();
}
test("native cleanup pending result: timeout releases dedup only for paced successful fetch", () => pendingHookRetry());
test("native cleanup pending result: rejected cleanup uses paced fetch recovery", () => pendingHookRetry(source, true));
async function pendingHookRetirement(hook = source) {
  const f = await loaded({ native: true, hook }); await f.insert(notice(NEW)); const held = f.hold("native-cleanup");
  await f.view.markReadIds([NEW]); await f.drain(); await f.change("A");
  assert.ok(f.closed.length >= 2, "PENDING_HOOK_NEW_EPOCH_RECONCILES_OWN_ROWS"); const before = f.closed.length;
  held.resolve("retry"); await f.drain(); f.advance(5000); await f.view.refresh(); await f.drain();
  assert.equal(f.closed.length, before, "PENDING_HOOK_RETIRED_ACK_CANNOT_CLOBBER_SUCCESSOR"); f.unmount();
}
test("native cleanup pending result: retired epoch ACK cannot release successor settled dedup", () => pendingHookRetirement());
for (const [before, after, oracle] of [
  ["const NATIVE_READ_RETRY_MS = 5000;", "const NATIVE_READ_RETRY_MS = 4999;", "PENDING_HOOK_COOLDOWN"],
  [" || !fetched", "", "PENDING_HOOK_REALTIME_NOT_RETRY_TRIGGER"],
  ['status === "settled" ? "settled" : "retry"', '"settled"', "PENDING_HOOK_FETCH_RETRIES_UNSETTLED_PAIR"],
  ['previous.status !== "retry"', 'previous.status === "settled"', "PENDING_HOOK_INFLIGHT_COALESCED"],
]) {
  test(`native cleanup pending result: compiled mutation ${oracle}`, async () => {
    assert.equal(source.split(before).length - 1, 1);
    await assert.rejects(pendingHookRetry(source.replace(before, after)), error => error.code === "ERR_ASSERTION" && error.message.includes(oracle));
  });
}

for (const [name, gate, run, oracle] of [
  ["browser unread gate", ' || currentUnreadTagCounts.has(notificationPresentationTag(item) ?? "")', nativeLatestCleanup, "LATEST_CONFIRMED_PAIR_FORWARDED"],
  ["prior-unread gate", " || !previousUnread.has(item.id)", nativeInitialCleanup, "INITIAL_CONFIRMED_BATCH_FORWARDED"],
]) {
  test(`native cleanup call compiled mutation: ${name}`, async () => {
    const before = "item.user_id !== userId || !item.read_at || !isMessageNotification(item)";
    assert.equal(source.split(before).length - 1, 1);
    await assert.rejects(run(source.replace(before, before + gate)), error => error.code === "ERR_ASSERTION" && error.message.includes(oracle));
  });
}

async function retiredChat(options, aba = false) {
  const f = await loaded(options); await f.insert(notice());
  const held = f.hold("notifications_mark_chat_messages_read"), pending = f.view.markMessageNotificationsForChatRead(CHAT, FIRST);
  await f.drain();
  if (aba) { await f.change(null); await f.change("A"); } else await f.change("B");
  await f.insert(notice(NEW, aba ? "A" : "B")); const before = f.calls.length;
  held.resolve({ error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, before, "retired chat ACK cannot issue extra requests");
  assert.equal(f.closed.length, 0, "retired chat ACK cannot dispatch cleanup");
  assert.equal(f.view.items.find(row => row.id === NEW).read_at, null, "retired chat ACK cannot mark current owner rows"); f.unmount();
}
test("actual hook: chat ACK loses to account replacement", () => retiredChat());
test("actual hook: chat ACK loses to same-owner epoch ABA", () => retiredChat(undefined, true));

async function boundedChat(options, fallback = false) {
  const f = await loaded(options); await f.insert(notice()); await f.insert(notice(NEW));
  const held = f.hold("notifications_mark_chat_messages_read"), pending = f.view.markMessageNotificationsForChatRead(CHAT, FIRST);
  held.resolve({ error: fallback ? { code: "PGRST202" } : null }); await pending; await f.drain();
  assert.equal(f.view.items.find(row => row.id === NEW).read_at, null, "bounded read preserves the newer message notification");
  assert.ok(f.view.items.find(row => row.id === OLD).read_at, "old message read positive control despite later notification timestamp");
  assert.equal(f.closed.length, 0, "bounded read cannot close a chat with a newer unread row");
  if (fallback) {
    assert.equal(f.calls.find(call => call.name === "message-horizon").horizon[1], FIRST);
    assert.deepEqual(f.calls.filter(call => call.fn === "notifications_mark_read").map(call => call.args.p_id), [OLD]);
  }
  f.unmount();
}
test("actual hook: bounded chat success applies server-confirmed read rows", () => boundedChat());
test("actual hook: missing chat RPC fallback uses message horizon, not notification date", () => boundedChat(undefined, true));
test("actual hook: a row arriving during chat ACK remains unread", async () => {
  const f = await loaded(); await f.insert(notice());
  const held = f.hold("notifications_mark_chat_messages_read"), pending = f.view.markMessageNotificationsForChatRead(CHAT, FIRST);
  await f.insert(notice(NEW)); held.resolve({ error: null }); await pending; await f.drain();
  assert.equal(f.view.items.find(row => row.id === NEW).read_at, null, "chat ACK cannot mark a newer arrival wholesale"); f.unmount();
});

for (const all of [false, true]) {
  test(`actual hook: ${all ? "all" : "individual"} failure preserves same-valued realtime confirmation`, async () => {
    const f = await loaded(); await f.insert(notice()); const held = f.hold(all ? "notifications_mark_all_read" : "notifications_mark_read");
    const pending = all ? f.view.markAllRead() : f.view.markReadIds([OLD]); await f.drain();
    await f.confirm(notice(OLD, "A", ACK)); held.resolve({ error: { code: "42501" } }); await pending; await f.drain();
    assert.equal(f.view.items[0].read_at, ACK, "failed read cannot undo a same-valued realtime confirmation"); f.unmount();
  });
  test(`actual hook: ${all ? "all" : "individual"} read stays pending until ACK`, async () => {
    const f = await loaded(); await f.insert(notice()); const held = f.hold(all ? "notifications_mark_all_read" : "notifications_mark_read");
    const pending = all ? f.view.markAllRead() : f.view.markReadIds([OLD]); await f.drain();
    const readAt = f.view.items[0].read_at, closes = f.closed.length;
    held.resolve({ error: null }); await pending; await f.drain();
    assert.equal(readAt, null, "read presentation must wait for server ACK"); assert.equal(closes, 0, "pending read cannot close an OS card");
    assert.ok(f.view.items[0].read_at, "current ACK read positive control"); f.unmount();
  });
}
test("actual hook: retired individual ACK stops the remaining ID requests", async () => {
  const f = await loaded(); await f.insert(notice()); await f.insert(notice(NEW));
  const held = f.hold("notifications_mark_read"), pending = f.view.markReadIds([OLD, NEW]); await f.drain();
  await f.change("B"); const before = f.calls.filter(call => call.name === "rpc").length;
  held.resolve({ error: null }); await pending; await f.drain();
  assert.equal(f.calls.filter(call => call.name === "rpc").length, before, "retired ID loop cannot issue the next request"); f.unmount();
});
test("actual hook: retired catch cannot publish an error", async () => {
  const f = await loaded(); await f.insert(notice()); const held = f.hold("notifications_mark_all_read"), pending = f.view.markAllRead();
  await f.change("B"); held.resolve({ error: { code: "42501" } }); await pending; await f.drain();
  assert.equal(f.view.error, null, "retired error cannot publish into B"); f.unmount();
});
test("actual hook: captured old callback is fenced before React commits", async () => {
  const f = await loaded(); const old = f.view.markAllRead; await f.change("B", false); const before = f.calls.length;
  await old(); assert.equal(f.calls.length, before, "captured old callback cannot start a current-account read"); f.unmount();
});
test("actual hook: unmounted chat ACK cannot start cleanup or readback", async () => {
  const f = await loaded(); await f.insert(notice()); const held = f.hold("notifications_mark_chat_messages_read"), pending = f.view.markMessageNotificationsForChatRead(CHAT);
  f.unmount(); const before = f.calls.length; held.resolve({ error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, before, "unmounted ACK cannot request readback"); assert.equal(f.closed.length, 0, "unmounted ACK cannot dispatch cleanup");
});
test("actual hook: thrown individual RPC releases dedupe and can retry", async () => {
  const f = await loaded(); await f.insert(notice()); const held = f.hold("notifications_mark_read"), pending = f.view.markReadIds([OLD]);
  held.reject(new Error("fictional offline")); await pending; await f.drain();
  assert.equal(f.view.items[0].read_at, null, "failed request leaves row unread");
  await f.view.markReadIds([OLD]); await f.drain();
  assert.ok(f.view.items[0].read_at, "retry after rejection reaches the current RPC"); f.unmount();
});

async function precommitEpoch(options) {
  const f = await loaded(options); const old = f.view.markAllRead;
  await f.change("A", false); const before = f.calls.length;
  await old();
  assert.equal(f.calls.length, before, "same-owner epoch must fence callbacks before React commits"); f.unmount();
}
test("actual hook: same-owner new epoch fences a captured callback before commit", () => precommitEpoch());

async function retiredNullRefresh(options) {
  const f = await loaded(options); await f.change(null); const old = f.view.refresh;
  await f.change("B"); await f.insert(notice(NEW, "B")); const before = f.calls.length;
  await old(); await f.drain();
  assert.equal(f.view.items.length, 1, "retired logged-out refresh cannot clear B's rows");
  assert.equal(f.calls.length, before, "retired refresh cannot issue requests"); f.unmount();
}
test("actual hook: captured logged-out refresh cannot clear a successor's rows", () => retiredNullRefresh());

async function retiredReadback(options, thrown = false) {
  const f = await loaded(options); await f.insert(notice());
  const held = f.hold("notification-states"), pending = f.view.markAllRead(); await f.drain();
  assert.equal(f.calls.filter(call => call.name === "notification-states").length, 1, "readback reached control");
  await f.change("A", false); const before = f.calls.length;
  if (thrown) held.reject(Error("fictional readback offline"));
  else held.resolve({ data: [{ id: OLD, read_at: ACK }], error: null });
  await pending; await f.drain();
  assert.equal(f.view.items[0].read_at, null, "retired readback cannot update state before commit");
  assert.equal(f.view.error, null, "retired readback cannot publish an error");
  assert.equal(f.closed.length, 0, "retired readback cannot close a card");
  assert.equal(f.calls.length, before, "retired readback cannot issue extra requests"); f.unmount();
}
test("actual hook: held metadata readback loses to epoch before React commit", () => retiredReadback());
test("actual hook: held metadata rejection loses to epoch before React commit", () => retiredReadback(undefined, true));

async function metadataBoundary(options, failed = false) {
  const f = await loaded(options); await f.insert(notice());
  const held = f.hold("notification-states"), pending = f.view.markAllRead(); await f.drain();
  const call = f.calls.find(call => call.name === "notification-states");
  assert.equal(call.columns, "id, read_at", "readback needs only read metadata");
  assert.equal(call.owner, "A", "readback is exact-owner scoped");
  assert.deepEqual(call.ids, [OLD], "readback requests exact captured notification IDs");
  held.resolve(failed ? { data: null, error: { code: "42501" } } : { data: [{ id: OLD, read_at: null }, { id: NEW, read_at: ACK }], error: null });
  await pending; await f.drain();
  assert.equal(f.view.items[0].read_at, null, "ACK without confirmed own row cannot fabricate a read");
  assert.equal(f.closed.length, 0, "unconfirmed read cannot close a card"); f.unmount();
}
test("actual hook: readback is exact-owner minimal metadata and requires non-null confirmation", () => metadataBoundary());
test("actual hook: failed readback cannot fabricate a read ACK", () => metadataBoundary(undefined, true));

test("actual hook: mark-all ACK does not mark a post-command arrival", async () => {
  const f = await loaded(); await f.insert(notice());
  const held = f.hold("notifications_mark_all_read"), pending = f.view.markAllRead();
  await f.insert(notice(NEW)); held.resolve({ error: null }); await pending; await f.drain();
  assert.equal(f.view.items.find(row => row.id === NEW).read_at, null, "mark-all applies only captured confirmed IDs"); f.unmount();
});

async function chatRefusal(options) {
  const f = await loaded(options); await f.insert(notice());
  const held = f.hold("notifications_mark_chat_messages_read"), pending = f.view.markMessageNotificationsForChatRead(CHAT, FIRST);
  held.resolve({ error: { code: "42501" } }); await pending; await f.drain();
  assert.equal(f.calls.filter(call => call.name === "rpc").length, 1, "permission error cannot invoke per-ID fallback");
  assert.equal(f.calls.filter(call => call.name === "message-horizon").length, 0, "permission error cannot start horizon lookup");
  assert.equal(f.view.items[0].read_at, null); f.unmount();
}
test("actual hook: permission error does not enter missing-RPC fallback", () => chatRefusal());

test("actual hook: held message horizon cannot start per-ID writes after retirement", async () => {
  const f = await loaded(); await f.insert(notice());
  const rpc = f.hold("notifications_mark_chat_messages_read"), horizon = f.hold("message-horizon");
  const pending = f.view.markMessageNotificationsForChatRead(CHAT, FIRST);
  rpc.resolve({ error: { code: "PGRST202" } }); await f.drain();
  assert.equal(f.calls.filter(call => call.name === "message-horizon").length, 1, "horizon reached control");
  await f.change("A", false); const before = f.calls.length;
  horizon.resolve({ data: [{ id: OLD }], error: null }); await pending; await f.drain();
  assert.equal(f.calls.length, before, "retired fallback cannot start ID requests");
  assert.equal(f.view.items[0].read_at, null); f.unmount();
});

test("actual hook: retired pending-ID settlement cannot release the successor's dedupe", async () => {
  const f = await loaded(); await f.insert(notice());
  const old = f.hold("notifications_mark_read"), oldWork = f.view.markReadIds([OLD]); await f.drain();
  await f.change("A"); await f.insert(notice());
  const next = f.hold("notifications_mark_read"), nextWork = f.view.markReadIds([OLD]); await f.drain();
  old.resolve({ error: null }); await oldWork; await f.drain(); const before = f.calls.length;
  await f.view.markReadIds([OLD]); await f.drain();
  assert.equal(f.calls.length, before, "old finally cannot delete the successor pending-ID lease");
  next.resolve({ error: null }); await nextWork; await f.drain();
  assert.ok(f.view.items[0].read_at, "successor write completes control"); f.unmount();
});

async function helperLifecycle(options, before = false) {
  const helper = compile(options?.sync ?? syncSource, {}); const held = deferred();
  let current = !before, calls = 0, callbacks = 0;
  const pending = helper.markChatMessageNotificationsRead({ rpc() { calls++; return held.promise; } }, CHAT, FIRST,
    () => { callbacks++; }, () => current);
  current = false; held.resolve({ error: null }); await pending;
  assert.equal(calls, before ? 0 : 1, "retired helper cannot start a request");
  assert.equal(callbacks, 0, "retired helper ACK cannot invoke cleanup");
}
test("actual helper: retired-before-start skips the RPC", () => helperLifecycle(undefined, true));
test("actual helper: retired held ACK skips the callback", () => helperLifecycle());

for (const retired of [false, true]) {
  test(`actual hook: ${retired ? "retired" : "current"} refresh rejection is settled and guarded`, async () => {
    const f = await loaded(); await f.insert(notice());
    const held = f.hold("refresh"), pending = f.view.refresh(); await f.drain();
    if (retired) await f.change("A", false);
    held.reject(Error("fictional refresh offline")); await pending; await f.drain();
    assert.equal(f.view.error, retired ? null : "fictional read error", "refresh rejection respects the live epoch");
    if (!retired) assert.equal(f.view.loading, false, "current rejected refresh settles loading");
    f.unmount();
  });
}
test("actual hook: retired realtime and subscription callbacks are inert before commit", async () => {
  const f = await loaded(); await f.insert(notice()); const channel = f.channels.at(-1);
  const before = f.calls.length; await f.change("A", false);
  channel.handlers.find(h => h.filter.event === "UPDATE").callback({ new: notice(OLD, "A", ACK) });
  channel.handlers.find(h => h.filter.event === "INSERT").callback({ new: notice(NEW) });
  channel.status("SUBSCRIBED");
  await f.drain();
  assert.equal(f.view.items.length, 1, "retired insert is inert");
  assert.equal(f.view.items[0].read_at, null, "retired update is inert");
  assert.equal(f.calls.length, before, "retired callback cannot issue requests");
  assert.equal(f.closed.length, 0); f.unmount();
});
test("actual hook: bounded missing-RPC fallback refuses message-less legacy rows", async () => {
  const f = await loaded(); const row = notice(); row.payload.message_id = "legacy-id"; await f.insert(row);
  const held = f.hold("notifications_mark_chat_messages_read"), pending = f.view.markMessageNotificationsForChatRead(CHAT, FIRST);
  held.resolve({ error: { code: "PGRST202" } }); await pending; await f.drain();
  assert.equal(f.calls.filter(call => call.name === "rpc").length, 1, "legacy row cannot be guessed from notification timestamp");
  assert.equal(f.view.items[0].read_at, null); f.unmount();
});
test("actual hook: unbounded missing-RPC fallback still marks captured own rows", async () => {
  const f = await loaded(); await f.insert(notice());
  const held = f.hold("notifications_mark_chat_messages_read"), pending = f.view.markMessageNotificationsForChatRead(CHAT);
  held.resolve({ error: { code: "PGRST202" } }); await pending; await f.drain();
  assert.ok(f.view.items[0].read_at, "unbounded fallback positive control");
  assert.deepEqual(f.calls.filter(call => call.fn === "notifications_mark_read").map(call => call.args.p_id), [OLD]);
  assert.deepEqual(f.closed, [`message:chat:${CHAT}`], "confirmed complete chat can close its presentation"); f.unmount();
});

function replaceOnce(text, anchor, replacement) {
  assert.equal(text.split(anchor).length - 1, 1, `mutation anchor must be unique: ${anchor}`);
  return text.replace(anchor, replacement);
}
const mutations = [
  ["live epoch guard", "hook", " && state.accountEpoch === readOwner.accountEpoch", "", precommitEpoch,
    "same-owner epoch must fence callbacks before React commits"],
  ["live owner guard", "hook", "state.currentUser?.id === readOwner.userId && ", "", async options => {
    const f = await loaded(options); const captured = f.view.markAllRead;
    // Owner must refuse even if the store has not yet advanced its epoch.
    await f.change("B", false, false); const start = f.calls.length; await captured();
    assert.equal(f.calls.length, start, "old owner identity cannot start a read"); f.unmount();
  }, "old owner identity cannot start a read"],
  ["readback owner", "hook", '.eq("user_id", readOwner.userId).in("id", ids)', '.in("id", ids)', metadataBoundary,
    "readback is exact-owner scoped"],
  ["readback metadata", "hook", '.select("id, read_at")', '.select("*")', metadataBoundary,
    "readback needs only read metadata"],
  ["readback exact IDs", "hook", '.eq("user_id", readOwner.userId).in("id", ids)', '.eq("user_id", readOwner.userId)', metadataBoundary,
    "readback requests exact captured notification IDs"],
  ["missing RPC only", "hook", 'if (!isMissingRpcError(rpcError)) { setError((prev) => current() ? mapPgError(rpcError) : prev); return; }', '', chatRefusal,
    "permission error cannot invoke per-ID fallback"],
  ["actual message horizon", "hook", '.lte("created_at", readUntil)', '', options => boundedChat(options, true),
    "bounded read preserves the newer message notification"],
  ["no whole-chat mark", "hook", 'await applyConfirmedReadRows(matchingIds, current);', 'setItems((prev) => prev.map((row) => ({ ...row, read_at: new Date().toISOString() })));', boundedChat,
    "bounded read preserves the newer message notification"],
  ["retired null refresh", "hook", 'const refresh = useCallback(async (options: { presentNewDesktop?: boolean } = {}) => {\n    if (!isCurrentReadOwner()) return;',
    'const refresh = useCallback(async (options: { presentNewDesktop?: boolean } = {}) => {\n    if (!userId) { setItems([]); return; }\n    if (!isCurrentReadOwner()) return;', retiredNullRefresh,
    "retired logged-out refresh cannot clear B's rows"],
  ["helper startup guard", "sync", 'if (!isCurrent()) return null;', '', options => helperLifecycle(options, true),
    "retired helper cannot start a request"],
  ["helper ACK guard", "sync", 'onMarkedRead && isCurrent()', 'onMarkedRead', helperLifecycle,
    "retired helper ACK cannot invoke cleanup"],
];
for (const [name, target, anchor, replacement, oracle, expected] of mutations) {
  test(`compiled mutant rejected by behavior: ${name}`, async () => {
    // Control must pass; transpilation/dependency/setup failures are not kills.
    await oracle();
    const changed = replaceOnce(target === "hook" ? source : syncSource, anchor, replacement);
    await assert.rejects(() => oracle({ [target]: changed }), error => {
      assert.equal(error.code, "ERR_ASSERTION", "compile/setup failures cannot kill a mutant");
      assert.equal(error.message.split("\n")[0], expected, "mutant must fail its literal behavioral oracle");
      return true;
    });
  });
}
