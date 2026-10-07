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
function compile(text = source, imports = {}) {
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, { module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected import ${name}`); return imports[name]; } });
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
function fixture(text = source, cap = { protocol: 1, instanceId: INSTANCE }) {
  let owner = { ownerId: OWNER, accountEpoch: 1 };
  const listeners = new Set(), calls = [], holds = [];
  const client = {
    async getCapabilities() { calls.push({ method: "cap" }); return cap; },
    setOwner(input) {
      calls.push({ method: "bind", input: plain(input) });
      const hold = holds.shift();
      return hold ? hold.promise : Promise.resolve({ ...input, applied: true });
    },
    async removeRead(input) { calls.push({ method: "remove", input: plain(input) }); },
  };
  const clean = compile(text).createNativeChatReadCleaner(client, {
    getOwner: () => owner,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  return { calls, client, clean: (read = { chatId: CHAT, confirmed }, current = () => true) => clean(read, current),
    holdBind() { const hold = deferred(); holds.push(hold); return hold; },
    change(id = OWNER) { owner = { ownerId: id, accountEpoch: owner.accountEpoch + 1 }; for (const listener of listeners) listener(); },
  };
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
  ["!await (binding ?? bind()) || !current()", "!await (binding ?? bind())", disposedBeforeAck, "DISPOSED_CLEANUP_INERT"],
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
