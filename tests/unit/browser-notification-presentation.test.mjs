import assert from "node:assert/strict";
import test from "node:test";

import { notificationPresentationTag } from "../../artifacts/kub/src/lib/browserNotificationPresentation.ts";

test("notification presentation tags keep chats, tasks and invites isolated", () => {
  assert.equal(
    notificationPresentationTag({
      kind: "message",
      payload: { chat_id: "chat-1" },
    }),
    "message:chat:chat-1",
  );
  assert.equal(
    notificationPresentationTag({
      kind: "task_assigned",
      payload: { task_id: "task-1" },
    }),
    "task:task-1",
  );
  assert.equal(
    notificationPresentationTag({
      kind: "group_invite",
      payload: { invite_id: "invite-1" },
    }),
    "invite:invite-1",
  );
  assert.equal(
    notificationPresentationTag({
      kind: "system",
      payload: { tag: "system:maintenance" },
    }),
    "system:maintenance",
  );
  assert.equal(
    notificationPresentationTag({ kind: "system", payload: {} }),
    null,
  );
});
