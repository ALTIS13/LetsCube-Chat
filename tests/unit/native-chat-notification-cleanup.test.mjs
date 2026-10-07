import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../../artifacts/kub/src/lib/platform/nativePushReadSync.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8").replaceAll("\r\n", "\n");
const CHAT = "8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
const TAG = `message:chat:${CHAT}`;
const OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const INSTANCE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const confirmed = [{ notificationId: OLD, messageId: OLD }];
const plain = value => JSON.parse(JSON.stringify(value));
function compile(text = source, imports = {}, globals = {}) {
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, { module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected import ${name}`); return imports[name]; }, ...globals });
  return module.exports;
}

// Characterizes the shipped SDK tag/id cancellation against actual helper source.
// The new bridge deliberately never falls back to this non-atomic interface.
for (const replacement of ["before-snapshot", "after-snapshot"]) {
  test(`legacy SDK preserves unconfirmed same-tag replacement ${replacement}`, async () => {
    const helper = compile();
    let card = { id: 0, tag: TAG, data: { notification_id: replacement === "before-snapshot" ? NEW : OLD } };
    let snapshots = 0;
    const push = {
      async getDeliveredNotifications() {
        snapshots++;
        const snapshot = [{ ...card }];
        if (replacement === "after-snapshot") card = { ...card, data: { notification_id: NEW } };
        return { notifications: snapshot };
      },
      async removeDeliveredNotifications({ notifications }) {
        if (notifications.some(item => item.tag === card?.tag && item.id === card?.id)) card = null;
      },
    };
    if (helper.createNativeChatReadCleaner) {
      const clean = helper.createNativeChatReadCleaner(push, { getOwner: () => ({ ownerId: OWNER, accountEpoch: 1 }), subscribe: () => () => {} });
      await clean({ chatId: CHAT, confirmed }, () => true);
    } else {
      await helper.closeDeliveredChatNotification(push, TAG, confirmed, () => true);
    }
    assert.equal(card?.data.notification_id, replacement === "after-snapshot" && !snapshots ? OLD : NEW, "NEWER_CARD_RETAINED");
  });
}

test("legacy invalid tag is a calibrated refusal control", async () => {
  const helper = compile();
  let removed = 0;
  const push = { async getDeliveredNotifications() { return { notifications: [] }; },
    async removeDeliveredNotifications() { removed++; } };
  if (helper.createNativeChatReadCleaner) {
    const clean = helper.createNativeChatReadCleaner(push, { getOwner: () => ({ ownerId: OWNER, accountEpoch: 1 }), subscribe: () => () => {} });
    await clean({ chatId: "system:security", confirmed }, () => true);
  } else await helper.closeDeliveredChatNotification(push, "system:security", confirmed, () => true);
  assert.equal(removed, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(text = source, cap = { protocol: 1, instanceId: INSTANCE }, globals = {}) {
  let owner = { ownerId: OWNER, accountEpoch: 1 };
  const listeners = new Set(), calls = [], holds = [];
  const client = {
    async getCapabilities() { calls.push({ method: "cap" }); return cap; },
    setOwner(input) {
      calls.push({ method: "bind", input: plain(input) });
      const hold = holds.shift();
      return hold ? hold.promise : Promise.resolve({ ...input, applied: true });
    },
    async removeRead(input) { calls.push({ method: "remove", input: plain(input) }); return { removed: 0, pending: false }; },
  };
  const clean = compile(text, {}, globals).createNativeChatReadCleaner(client, {
    getOwner: () => owner,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  return { calls, client, clean: (read = { chatId: CHAT, confirmed }, current = () => true) => clean(read, current),
    holdBind() { const hold = deferred(); holds.push(hold); return hold; },
    change(id = OWNER) { owner = { ownerId: id, accountEpoch: owner.accountEpoch + 1 }; for (const listener of listeners) listener(); },
  };
}

function pendingFixture(text = source) {
  let now = 0;
  const timers = [], reads = [];
  const f = fixture(text, undefined, { setTimeout(callback, delay) { timers.push({ callback, delay, due: now + delay }); } });
  f.client.removeRead = async input => { reads.push(plain(input)); return { removed: 0, pending: true }; };
  return { ...f, reads, timers,
    async tick(ms) { now += ms; const due = timers.filter(timer => timer.due <= now);
      for (const timer of due) { timers.splice(timers.indexOf(timer), 1); timer.callback(); } await settle(); },
  };
}
async function pendingRecovery(text = source) {
  const f = pendingFixture(text), operation = f.clean(); await settle();
  assert.equal(f.reads.length, 1);
  await f.tick(249); assert.equal(f.reads.length, 1, "PENDING_RETRY_PACED");
  f.client.removeRead = async input => { f.reads.push(plain(input)); return { removed: 1, pending: false }; };
  await f.tick(1);
  assert.equal(await operation, "settled", "PENDING_VISIBLE_SETTLED");
  assert.equal(f.reads.length, 2, "PENDING_RETRIED_ONCE_VISIBLE");
}
test("pending reconciliation: visible card is retried after 250ms", () => pendingRecovery());
async function pendingTimeout(text = source) {
  const f = pendingFixture(text), operation = f.clean(); await settle();
  await f.tick(250); await f.tick(250); await f.tick(250);
  assert.equal(await operation, "retry", "PENDING_TIMEOUT_RETRY_ELIGIBLE");
  assert.equal(f.reads.length, 4, "PENDING_FOUR_ATTEMPTS");
  assert.equal(f.timers.length, 0, "PENDING_NO_UNBOUNDED_TIMER");
  f.client.removeRead = async () => ({ removed: 1, pending: false });
  assert.equal(await f.clean(), "settled", "PENDING_TIMEOUT_RELEASES_INFLIGHT");
}
test("pending reconciliation: four attempts timeout releases the operation", () => pendingTimeout());
async function pendingRetirement(text = source, disposed = false) {
  const f = pendingFixture(text); let mounted = true;
  const operation = f.clean(undefined, () => mounted); await settle();
  if (disposed) mounted = false; else f.change();
  await f.tick(250);
  assert.equal(await operation, "retired", "PENDING_RETIRED_INERT");
  assert.equal(f.reads.length, 1, "PENDING_RETIRED_NO_EXTRA_IPC");
}
async function pendingHeldAckRetirement(text = source) {
  const f = pendingFixture(text), held = deferred(); f.client.removeRead = () => held.promise;
  const operation = f.clean(); await settle(); f.change(); held.resolve({ removed: 0, pending: true }); await settle();
  assert.equal(f.timers.length, 0, "PENDING_RETIRED_ACK_NO_TIMER");
  assert.equal(await operation, "retired");
}
test("pending reconciliation: retired pending ACK cannot schedule a retry", () => pendingHeldAckRetirement());
test("pending reconciliation: same-owner epoch retires a waiting retry", () => pendingRetirement());
test("pending reconciliation: disposal retires a waiting retry", () => pendingRetirement(source, true));
test("pending reconciliation: newer unread replacement settles without further polling", async () => {
  const f = pendingFixture(), operation = f.clean(); await settle();
  f.client.removeRead = async input => { f.reads.push(plain(input)); return { removed: 0, pending: false }; };
  await f.tick(250); assert.equal(await operation, "settled");
  assert.equal(f.reads.length, 2); assert.equal(f.timers.length, 0);
});
async function pendingDuplicate(text = source) {
  const f = pendingFixture(text); let firstMounted = true;
  const first = f.clean(undefined, () => firstMounted), second = f.clean(); await settle();
  assert.equal(f.reads.length, 1, "PENDING_DUPLICATE_COALESCED"); firstMounted = false;
  f.client.removeRead = async input => { f.reads.push(plain(input)); return { removed: 1, pending: false }; };
  await f.tick(250);
  assert.equal(await first, "retired"); assert.equal(await second, "settled", "PENDING_LIVE_WAITER_RECOVERS");
  assert.equal(f.reads.length, 2);
}
test("pending reconciliation: duplicate callers share native I/O while a live waiter remains", () => pendingDuplicate());
for (const ack of [undefined, {}, { removed: 0 }, { removed: 1, pending: true }, { removed: 2, pending: false }, { removed: 0, pending: "false" }]) {
  test(`pending reconciliation: malformed ACK is retry eligible without polling ${JSON.stringify(ack)}`, async () => {
    const f = pendingFixture(); f.client.removeRead = async input => { f.reads.push(input); return ack; };
    assert.equal(await f.clean(), "retry", "PENDING_MALFORMED_ACK_NOT_SETTLED");
    assert.equal(f.reads.length, 1); assert.equal(f.timers.length, 0);
  });
}
test("pending reconciliation: rejected ACK releases coalescing and can recover", async () => {
  const f = pendingFixture(); f.client.removeRead = async () => { throw new Error("fictional unavailable"); };
  assert.equal(await f.clean(), "retry");
  f.client.removeRead = async () => ({ removed: 0, pending: false }); assert.equal(await f.clean(), "settled");
});

async function rejectedCapabilityRecovery(text = source) {
  const f = fixture(text); let working = false, reads = 0;
  f.client.getCapabilities = async () => { reads++; if (!working) throw Error("fictional transient capability failure");
    return { protocol: 1, instanceId: INSTANCE }; };
  assert.equal(await f.clean(), "retry");
  assert.equal(reads, 1); assert.equal(f.calls.length, 0, "CAPABILITY_FAILURE_NO_BINDING");
  working = true;
  assert.equal(await f.clean(), "settled", "REJECTED_CAPABILITY_NEXT_CLEAN_RECOVERS");
  assert.equal(reads, 2); assert.equal(f.calls.filter(call => call.method === "remove").length, 1);
}
test("rejected capability retry: next eligible clean renegotiates and settles", () => rejectedCapabilityRecovery());
test("rejected capability retry: concurrent failed readers coalesce without immediate polling", async () => {
  const f = fixture(), held = deferred(); let reads = 0, working = false;
  f.client.getCapabilities = () => { reads++; return working ? Promise.resolve({ protocol: 1, instanceId: INSTANCE }) : held.promise; };
  const first = f.clean(), second = f.clean(); await settle(); assert.equal(reads, 1);
  held.reject(Error("fictional transient capability failure"));
  assert.deepEqual(await Promise.all([first, second]), ["retry", "retry"]);
  assert.equal(reads, 1, "CAPABILITY_REJECTION_NO_IMMEDIATE_POLL"); assert.equal(f.calls.length, 0);
  working = true; assert.equal(await f.clean(), "settled", "COALESCED_CAPABILITY_RECOVERY"); assert.equal(reads, 2);
});
test("rejected capability retry: static malformed capability remains cached and fail closed", async () => {
  const f = fixture(); let reads = 0;
  f.client.getCapabilities = async () => { reads++; return { protocol: 0, instanceId: INSTANCE }; };
  assert.equal(await f.clean(), "retry"); assert.equal(await f.clean(), "retry");
  assert.equal(reads, 1, "MALFORMED_CAPABILITY_NOT_RENEGOTIATED"); assert.equal(f.calls.length, 0);
});
async function retiredRejectedCapability(text = source) {
  const f = fixture(text), held = deferred(); let reads = 0;
  f.client.getCapabilities = () => { reads++; return reads === 1 ? held.promise : Promise.resolve({ protocol: 1, instanceId: INSTANCE }); };
  const old = f.clean(); await settle(); f.change(); held.reject(Error("fictional retired capability failure"));
  assert.equal(await old, "retired"); assert.equal(f.calls.length, 0);
  assert.equal(await f.clean(), "retry", "RETIRED_CAPABILITY_CANNOT_RESET_CACHE"); assert.equal(reads, 1);
  assert.equal(await f.clean(), "settled", "CURRENT_READER_RELEASES_REJECTED_CACHE"); assert.equal(reads, 2);
}
test("rejected capability retry: retired rejection cannot mutate capability cache", () => retiredRejectedCapability());
for (const [before, after, run, oracle] of [
  ["if (capabilities === pending) capabilities = null;", "", rejectedCapabilityRecovery, "REJECTED_CAPABILITY_NEXT_CLEAN_RECOVERS"],
  ['try { instance = await pending; } catch {\n        if (!current()) return "retired";',
    'try { instance = await pending; } catch {', retiredRejectedCapability, "RETIRED_CAPABILITY_CANNOT_RESET_CACHE"],
]) {
  test(`rejected capability retry: compiled omission ${oracle}`, async () => {
    assert.equal(source.split(before).length - 1, 1);
    await assert.rejects(run(source.replace(before, after)), error => error.code === "ERR_ASSERTION" && error.message.includes(oracle));
  });
}
for (const [before, after, run, oracle] of [
  ["const READ_ATTEMPTS = 4;", "const READ_ATTEMPTS = 3;", pendingTimeout, "PENDING_FOUR_ATTEMPTS"],
  ["const READ_RETRY_MS = 250;", "const READ_RETRY_MS = 249;", pendingRecovery, "PENDING_RETRY_PACED"],
  ["let operation = operations.get(key);", "let operation = undefined;", pendingDuplicate, "PENDING_DUPLICATE_COALESCED"],
  ['return "retry";\n    } catch', 'return "settled";\n    } catch', pendingTimeout, "PENDING_TIMEOUT_RETRY_ELIGIBLE"],
  ['const ack = record(await client.removeRead({ ...expected, instanceId: instance, ...read }));\n        if (!current()) return "retired";',
    'const ack = record(await client.removeRead({ ...expected, instanceId: instance, ...read }));', pendingHeldAckRetirement, "PENDING_RETIRED_ACK_NO_TIMER"],
]) {
  test(`pending reconciliation: compiled mutation ${oracle}`, async () => {
    assert.equal(source.split(before).length - 1, 1);
    await assert.rejects(run(source.replace(before, after)), error => error.code === "ERR_ASSERTION" && error.message.includes(oracle));
  });
}

async function exactPair(text = source) {
  const f = fixture(text); await f.clean();
  assert.deepEqual(f.calls.at(-1), { method: "remove", input: {
    ownerId: OWNER, accountEpoch: 1, revision: 1, instanceId: INSTANCE, chatId: CHAT,
    confirmed: [{ notificationId: OLD, messageId: OLD }],
  } }, "EXACT_PAIR_AND_OWNER");
}
test("bridge sends only the exact confirmed ID/message pair and owner lease", () => exactPair());

for (const cap of [null, {}, { protocol: 0, instanceId: INSTANCE }, { protocol: "1", instanceId: INSTANCE }, { protocol: 1, instanceId: "invalid" }]) {
  test(`unavailable or malformed capability never binds/removes: ${JSON.stringify(cap)}`, async () => {
    const f = fixture(source, cap); await f.clean();
    assert.deepEqual(f.calls, [{ method: "cap" }], "CAPABILITY_REFUSED");
  });
}
for (const input of [ { chatId: "wrong", confirmed }, { chatId: CHAT, confirmed: [] },
  { chatId: CHAT, confirmed: [{ notificationId: "wrong", messageId: OLD }] },
  { chatId: CHAT, confirmed: [{ notificationId: OLD, messageId: "wrong" }] },
  { chatId: CHAT, confirmed: Array.from({ length: 31 }, () => confirmed[0]) } ]) {
  test(`invalid exact read request refuses bridge I/O: ${JSON.stringify(input).slice(0, 90)}`, async () => {
    const f = fixture(); await f.clean(input); assert.deepEqual(f.calls, [], "INVALID_READ_REFUSED");
  });
}
async function retiredBinding(text = source, aba = false) {
  const f = fixture(text), held = f.holdBind(), pending = f.clean(); await settle();
  const first = f.calls.find(call => call.method === "bind").input;
  f.change(null); if (aba) f.change(OWNER);
  held.resolve({ ...first, applied: true }); await pending;
  assert.equal(f.calls.filter(call => call.method === "remove").length, 0, "RETIRED_BINDING_INERT");
  if (aba) {
    await f.clean(); assert.equal(f.calls.at(-1).input.accountEpoch, 3, "current owner ABA recovery control");
    assert.equal(f.calls.at(-1).input.revision, 3);
  }
}
test("held binding ACK loses to logout before any cleanup", () => retiredBinding());
test("batched A/null/A changes retire old binding independent of React", () => retiredBinding(source, true));
async function retiredCapability(text = source) {
  const f = fixture(text), held = deferred(); f.client.getCapabilities = () => held.promise;
  const pending = f.clean(); await settle(); f.change();
  held.resolve({ protocol: 1, instanceId: INSTANCE }); await pending;
  assert.equal(f.calls.length, 0, "RETIRED_CAPABILITY_INERT");
}
test("capability load cannot publish or bind a retired epoch", () => retiredCapability());
async function disposedBeforeAck(text = source) {
  const f = fixture(text), held = f.holdBind(); let mounted = true;
  const pending = f.clean(undefined, () => mounted); await settle(); mounted = false;
  held.resolve({ ...f.calls.at(-1).input, applied: true }); await pending;
  assert.equal(f.calls.some(call => call.method === "remove"), false, "DISPOSED_CLEANUP_INERT");
}
test("caller disposal during binding makes its late ACK inert", () => disposedBeforeAck());
test("rejected binding retries without false cleanup acknowledgement", async () => {
  const f = fixture(), held = f.holdBind(), pending = f.clean(); await settle();
  held.reject(new Error("fictional binding rejected")); await pending;
  assert.equal(f.calls.some(call => call.method === "remove"), false);
  await f.clean(); assert.equal(f.calls.at(-1).method, "remove");
});
test("wrong binding ACK identity cannot authorize cleanup", async () => {
  const f = fixture(), held = f.holdBind(), pending = f.clean(); await settle();
  held.resolve({ ...f.calls.at(-1).input, applied: true, accountEpoch: 2 }); await pending;
  assert.equal(f.calls.some(call => call.method === "remove"), false, "WRONG_BINDING_ACK_REFUSED");
});
test("read request is copied before awaiting bridge input", async () => {
  const f = fixture(), held = f.holdBind(), pairs = [{ notificationId: OLD, messageId: OLD }];
  const pending = f.clean({ chatId: CHAT, confirmed: pairs }); await settle(); pairs[0].notificationId = NEW;
  held.resolve({ ...f.calls.at(-1).input, applied: true }); await pending;
  assert.equal(f.calls.at(-1).input.confirmed[0].notificationId, OLD);
});

for (const [before, after, run, oracle] of [
  ["owner === expected && isCurrent()", "isCurrent()", retiredBinding, "RETIRED_BINDING_INERT"],
  ["!instance || !current()", "!instance", retiredCapability, "RETIRED_CAPABILITY_INERT"],
  ['for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {\n        if (!current()) return "retired";',
    'for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {', pendingRetirement, "PENDING_RETIRED_NO_EXTRA_IPC"],
  ["cap?.protocol === 1", "cap?.protocol !== undefined", async text => {
    const f = fixture(text, { protocol: 0, instanceId: INSTANCE }); await f.clean();
    assert.equal(f.calls.some(call => call.method === "remove"), false, "CAPABILITY_REFUSED");
  }, "CAPABILITY_REFUSED"],
]) {
  test(`compiled read-cleaner mutation: ${before}`, async () => {
    assert.equal(source.split(before).length - 1, 1);
    await assert.rejects(run(source.replace(before, after)), error => error.code === "ERR_ASSERTION" && error.message.includes(oracle));
  });
}
