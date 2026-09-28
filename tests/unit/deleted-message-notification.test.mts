import assert from "node:assert/strict";
import test from "node:test";

import { parseMessageNotificationProjection } from "../../artifacts/kub/src/lib/messageNotificationProjection.ts";

// D-103. When a message is deleted for everyone the database keeps the
// recipients' notifications and scrubs their words: `preview` becomes null and
// `deleted` true (`20260928210000_deleted_message_keeps_nothing.sql`). The bell
// then says what happened rather than the generic «Сообщение» a missing
// preview would read as.

const CHAT = "22222222-2222-4222-8222-000000000001";
const MESSAGE = "55555555-5555-4555-8555-000000000001";
const SENDER = "11111111-1111-4111-8111-000000000002";

const payload = (over: Record<string, unknown>) => ({
  chat_id: CHAT,
  message_id: MESSAGE,
  sender_kind: "user",
  sender_id: SENDER,
  bot_id: null,
  sender_name: "Анна Смирнова",
  chat_name: "Команда",
  chat_type: "group",
  message_type: "text",
  ...over,
});

test("a scrubbed notification reads «Сообщение удалено»", () => {
  const projection = parseMessageNotificationProjection(payload({ preview: null, deleted: true }));
  assert.equal(projection?.preview, "Сообщение удалено");
});

test("the words the database scrubbed cannot come back through a stale preview", () => {
  // Belt and braces: a payload that still carried words beside the flag reads
  // as deleted, because the flag is the database's statement about the message.
  const projection = parseMessageNotificationProjection(payload({ preview: "секрет", deleted: true }));
  assert.equal(projection?.preview, "Сообщение удалено");
});

test("a live message's notification is untouched, and a missing preview still reads «Сообщение»", () => {
  assert.equal(parseMessageNotificationProjection(payload({ preview: "Привет" }))?.preview, "Привет");
  assert.equal(parseMessageNotificationProjection(payload({ preview: null }))?.preview, "Сообщение");
  // Only `true` is the flag; a string that says so is not.
  assert.equal(parseMessageNotificationProjection(payload({ preview: "Привет", deleted: "true" }))?.preview, "Привет");
});
