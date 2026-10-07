import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createNativeChatReadCleaner } from "../../artifacts/kub/src/lib/platform/nativePushReadSync.ts";

const CHAT_A = "message:chat:8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
const CHAT_B = "message:chat:783ae853-eec6-4bdf-8f71-59a8b537f179";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const INSTANCE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const adapterSource = readFileSync(new URL("../../artifacts/kub/src/lib/platform/nativePush.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("Android read sync requests only the exact confirmed chat/card identity", async () => {
  const { createNativeChatReadCleaner } = await import("../../artifacts/kub/src/lib/platform/nativePushReadSync.ts");
  const removed = [];
  const push = {
    async getCapabilities() { return { protocol: 1, instanceId: INSTANCE }; },
    async setOwner(input) { return { ...input, applied: true }; },
    async removeRead(input) { removed.push(input); return { removed: 0, pending: false }; },
  };
  const close = createNativeChatReadCleaner(push, { getOwner: () => ({ ownerId: OWNER, accountEpoch: 1 }), subscribe: () => () => {} });
  assert.equal(await close({ chatId: CHAT_A.slice(13), confirmed: [{ notificationId: ID, messageId: ID }] }, () => true), "settled");
  assert.deepEqual(removed, [{ chatId: CHAT_A.slice(13), confirmed: [{ notificationId: ID, messageId: ID }],
    instanceId: INSTANCE, revision: 1, ownerId: OWNER, accountEpoch: 1 }]);
});

function adapter(text = adapterSource, supported = true) {
  const calls = [], client = {
    async getCapabilities() { return { protocol: 1, instanceId: INSTANCE }; },
    async setOwner(input) { return { applied: true, ...input }; },
    async removeRead(input) { calls.push(input); return { removed: 1, pending: false }; },
  };
  const dependencies = {
    "@capacitor/push-notifications": {}, "./capabilities": { isNativeAndroid: () => true, supportsCapacitorPlugin: () => supported },
    "../plainMessages": {}, "../messageNotificationProjection": {}, "./nativeVoiceContract": {}, "./nativePushRegistration": {},
    "./nativePushReadSync": { createNativeChatReadCleaner },
    "@capacitor/core": { registerPlugin(name) { assert.equal(name, "ChatNotifications"); return client; } },
    "../../store/app.store": { useAppStore: { getState: () => ({ currentUser: { id: OWNER }, accountEpoch: 1 }), subscribe: () => () => {} } },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, window: { androidBridge: { postMessage() {} } }, require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected adapter dependency ${name}`); return dependencies[name];
    } });
  return { calls, client, close: current => module.exports.closeNativeChatNotification(
    { chatId: CHAT_A.slice(13), confirmed: [{ notificationId: ID, messageId: ID }] }, current ?? (() => true)) };
}
async function adapterResult(text = adapterSource) {
  const f = adapter(text); assert.equal(await f.close(), "settled", "ADAPTER_FORWARDS_TERMINAL_STATUS");
  f.client.removeRead = async input => { f.calls.push(input); return { removed: 0 }; };
  assert.equal(await f.close(), "retry", "ADAPTER_FORWARDS_UNKNOWN_ACK_RETRY"); assert.equal(f.calls.length, 2);
}
test("native cleanup adapter forwards settled and retry status from actual cleaner", () => adapterResult());
test("native cleanup adapter old shell and retired caller never claim settlement", async () => {
  const f = adapter(adapterSource, false); assert.equal(await f.close(), "retry"); assert.equal(f.calls.length, 0);
  assert.equal(await f.close(() => false), "retired"); assert.equal(f.calls.length, 0);
});
test("native cleanup adapter compiled mutation: omission of result forwarding", async () => {
  const before = 'return isCurrent() ? await clean(read, isCurrent) : "retired" as const;';
  assert.equal(adapterSource.split(before).length - 1, 1);
  await assert.rejects(adapterResult(adapterSource.replace(before, 'if (isCurrent()) await clean(read, isCurrent);')),
    error => error.code === "ERR_ASSERTION" && error.message.includes("ADAPTER_FORWARDS_TERMINAL_STATUS"));
});

test("Android read sync refuses missing capability and invalid chat identity", async () => {
  const { createNativeChatReadCleaner } = await import("../../artifacts/kub/src/lib/platform/nativePushReadSync.ts");
  let removed = 0;
  const push = {
    async getCapabilities() { return { protocol: 0 }; },
    async setOwner() { removed += 1; }, async removeRead() { removed += 1; },
  };
  const close = createNativeChatReadCleaner(push, { getOwner: () => ({ ownerId: OWNER, accountEpoch: 1 }), subscribe: () => () => {} });
  await close({ chatId: CHAT_B.slice(13), confirmed: [{ notificationId: ID, messageId: ID }] }, () => true);
  await close({ chatId: "system:security", confirmed: [{ notificationId: ID, messageId: ID }] }, () => true);
  assert.equal(removed, 0);
});

test("Android read sync does not acknowledge a legacy response without pending status", async () => {
  const { createNativeChatReadCleaner } = await import("../../artifacts/kub/src/lib/platform/nativePushReadSync.ts");
  let calls = 0;
  const push = { async getCapabilities() { return { protocol: 1, instanceId: INSTANCE }; },
    async setOwner(input) { return { ...input, applied: true }; }, async removeRead() { calls++; return { removed: 0 }; } };
  const close = createNativeChatReadCleaner(push, { getOwner: () => ({ ownerId: OWNER, accountEpoch: 1 }), subscribe: () => () => {} });
  assert.equal(await close({ chatId: CHAT_A.slice(13), confirmed: [{ notificationId: ID, messageId: ID }] }, () => true), "retry");
  assert.equal(calls, 1);
});
