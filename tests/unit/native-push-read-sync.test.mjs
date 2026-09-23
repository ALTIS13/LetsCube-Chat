import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CHAT_A = "message:chat:8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
const CHAT_B = "message:chat:783ae853-eec6-4bdf-8f71-59a8b537f179";

test("Android read sync dismisses only the matching chat card", async () => {
  const { closeDeliveredChatNotification } = await import("../../artifacts/kub/src/lib/platform/nativePushReadSync.ts");
  const removed = [];
  const push = {
    async getDeliveredNotifications() {
      return { notifications: [
        { id: 0, tag: CHAT_A, data: {} },
        { id: 0, tag: CHAT_B, data: {} },
        { id: 2147483647, tag: CHAT_A, groupSummary: true, data: {} },
      ] };
    },
    async removeDeliveredNotifications({ notifications }) {
      removed.push(notifications);
    },
  };

  await closeDeliveredChatNotification(push, CHAT_A);

  assert.deepEqual(removed, [[{ id: 0, tag: CHAT_A, data: {} }]]);
});

test("Android read sync does not remove cards for an absent or invalid chat tag", async () => {
  const { closeDeliveredChatNotification } = await import("../../artifacts/kub/src/lib/platform/nativePushReadSync.ts");
  let removed = 0;
  const push = {
    async getDeliveredNotifications() {
      return { notifications: [{ id: 0, tag: CHAT_B, data: {} }] };
    },
    async removeDeliveredNotifications() {
      removed += 1;
    },
  };

  await closeDeliveredChatNotification(push, CHAT_A);
  await closeDeliveredChatNotification(push, "system:security");

  assert.equal(removed, 0);
});

test("chat read reconciliation uses native cleanup on both local and remote read paths", () => {
  const hook = readFileSync(new URL("../../artifacts/kub/src/hooks/useNotifications.ts", import.meta.url), "utf8");
  assert.ok(/previousTag && !currentUnreadTagCounts\.has\(previousTag\)[\s\S]*?closeNativeChatNotification\(previousTag\)/.test(hook), "remote-read cleanup missing");
  assert.ok(/markChatMessageNotificationsRead\([\s\S]*?closeNativeChatNotification\(tag\)/.test(hook), "local-read cleanup missing");
});
