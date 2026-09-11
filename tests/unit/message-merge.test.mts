import assert from "node:assert/strict";
import test from "node:test";

import { chooseMergedMessage, mergeMessagesById } from "../../artifacts/kub/src/lib/messageMerge.ts";

/**
 * D-090: revalidating a conversation the store kept brings back what changed
 * while it was closed, without undoing what Realtime changed after the fetch
 * was taken.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-09-11T10:00:00.000Z";
const T1 = "2026-09-11T10:01:00.000Z";
const T2 = "2026-09-11T10:02:00.000Z";

type Message = {
  id: string;
  chat_id: string;
  user_id: string | null;
  bot_id: string | null;
  content: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  client_message_id: string | null;
  reactions: { emoji: string; user_id: string }[];
  pending?: boolean;
  failed?: boolean;
};

function message(id: string, createdAt: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    chat_id: "chat-1",
    user_id: ME,
    bot_id: null,
    content: `text ${id}`,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    client_message_id: null,
    reactions: [],
    ...extra,
  };
}

test("an edit made while the chat was closed replaces the text the store held", () => {
  const held = [message("m1", T0)];
  const fetched = [message("m1", T0, { content: "edited", edited_at: T1 })];
  const [result] = mergeMessagesById(fetched, held);
  assert.equal(result.content, "edited");
  assert.equal(result.edited_at, T1);
});

test("a deletion made while the chat was closed replaces the copy the store held", () => {
  const held = [message("m1", T0)];
  const fetched = [message("m1", T0, { deleted_at: T1 })];
  assert.equal(mergeMessagesById(fetched, held)[0].deleted_at, T1);
});

test("reactions come from the fetch", () => {
  const held = [message("m1", T0)];
  const fetched = [message("m1", T0, { reactions: [{ emoji: "❤️", user_id: ME }] })];
  assert.deepEqual(mergeMessagesById(fetched, held)[0].reactions, [{ emoji: "❤️", user_id: ME }]);
});

test("a deletion Realtime applied after the fetch was taken is kept", () => {
  const held = [message("m1", T0, { deleted_at: T2 })];
  const fetched = [message("m1", T0)];
  assert.equal(mergeMessagesById(fetched, held)[0].deleted_at, T2);
});

test("an edit newer than the fetched copy is kept", () => {
  const held = [message("m1", T0, { content: "second edit", edited_at: T2 })];
  const fetched = [message("m1", T0, { content: "first edit", edited_at: T1 })];
  assert.equal(mergeMessagesById(fetched, held)[0].content, "second edit");
});

test("a local send gives way to its server copy, matched by the client id", () => {
  const held = [message("tmp:1", T1, { client_message_id: "c-1", pending: true })];
  const fetched = [message("m9", T1, { client_message_id: "c-1" })];
  assert.deepEqual(mergeMessagesById(fetched, held).map((item) => item.id), ["m9"]);
});

test("a failed local copy never replaces the server's, whichever side it is on", () => {
  const server = message("m9", T1, { client_message_id: "c-1" });
  const failed = message("tmp:1", T1, { client_message_id: "c-1", failed: true });
  assert.equal(chooseMergedMessage(server, failed), server);
  assert.equal(chooseMergedMessage(failed, server), server);
});

test("messages on one side only are kept, in time order", () => {
  const held = [message("m1", T0), message("m3", T2)];
  const fetched = [message("m2", T1), message("m3", T2)];
  assert.deepEqual(mergeMessagesById(fetched, held).map((item) => item.id), ["m1", "m2", "m3"]);
});

test("with nothing held, the fetched page is returned as it is", () => {
  const fetched = [message("m1", T0)];
  assert.equal(mergeMessagesById(fetched, []), fetched);
});
