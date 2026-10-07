import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CHAT_A = "message:chat:8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
const CHAT_B = "message:chat:783ae853-eec6-4bdf-8f71-59a8b537f179";
const OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const INSTANCE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

test("Android read sync requests only the exact confirmed chat/card identity", async () => {
  const { createNativeChatReadCleaner } = await import("../../artifacts/kub/src/lib/platform/nativePushReadSync.ts");
  const removed = [];
  const push = {
    async getCapabilities() { return { protocol: 1, instanceId: INSTANCE }; },
    async setOwner(input) { return { ...input, applied: true }; },
    async removeRead(input) { removed.push(input); },
  };
  const close = createNativeChatReadCleaner(push, { getOwner: () => ({ ownerId: OWNER, accountEpoch: 1 }), subscribe: () => () => {} });
  await close({ chatId: CHAT_A.slice(13), confirmed: [{ notificationId: ID, messageId: ID }] }, () => true);
  assert.deepEqual(removed, [{ chatId: CHAT_A.slice(13), confirmed: [{ notificationId: ID, messageId: ID }],
    instanceId: INSTANCE, revision: 1, ownerId: OWNER, accountEpoch: 1 }]);
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

test("chat read reconciliation uses confirmed rows for shared native cleanup", () => {
  const hook = readFileSync(new URL("../../artifacts/kub/src/hooks/useNotifications.ts", import.meta.url), "utf8");
  assert.ok(/batch.push\(\{ notificationId: item.id, messageId \}\)[\s\S]*?closeNativeChatNotification\([\s\S]*?isCurrentReadOwner/.test(hook), "exact remote-read cleanup missing");
  assert.ok(hook.includes("markChatMessageNotificationsRead(supabase, chatId, readUntil, undefined, current)"), "local read must not close the whole chat directly");
  assert.ok(hook.includes("await applyConfirmedReadRows(matchingIds, current)"), "local read must reconcile exact confirmed rows before shared cleanup");
});
