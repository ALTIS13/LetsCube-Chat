import assert from "node:assert/strict";
import test from "node:test";

import { markChatMessageNotificationsRead } from "../../artifacts/kub/src/lib/notificationReadSync.ts";

test("chat notification read sync calls the server even without locally loaded notification rows", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { error: null };
    },
  };

  const error = await markChatMessageNotificationsRead(
    client,
    "chat-1",
    "2026-07-11T21:30:00.000Z",
  );

  assert.equal(error, null);
  assert.deepEqual(calls, [
    {
      name: "notifications_mark_chat_messages_read",
      args: {
        p_chat_id: "chat-1",
        p_read_until: "2026-07-11T21:30:00.000Z",
      },
    },
  ]);
});
