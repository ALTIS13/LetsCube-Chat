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

// D-322: a message deleted for both while its private chat was closed came
// back on the reopen and stayed until a reload — the list's socket heard the
// change but never laid it over the held copy, and the reopen's page, which
// does not return deleted rows in a private chat, left the held copy standing.
test("the list's socket row is laid over a closed conversation's held copy, joins kept", async () => {
  const { patchHeldMessage } = await import("../../artifacts/kub/src/lib/messageMerge.ts");
  const held = [
    { id: "m1", created_at: "2026-09-28T10:00:00.000Z", content: "Первое", sender: { id: "anna" } },
    { id: "m2", created_at: "2026-09-28T10:01:00.000Z", content: "Второе", sender: { id: "anna" } },
  ];
  const deleted = patchHeldMessage(held, { id: "m2", deleted_at: "2026-09-28T11:00:00.000Z", content: "" });
  assert.ok(deleted);
  assert.equal(deleted[1].deleted_at, "2026-09-28T11:00:00.000Z");
  assert.deepEqual(deleted[1].sender, { id: "anna" });
  assert.equal(deleted[0], held[0]);
  // Not held, or nothing new: no new array, so nothing renders.
  assert.equal(patchHeldMessage(held, { id: "m9", content: "чужое" }), null);
  assert.equal(patchHeldMessage(held, { id: "m1", content: "Первое" }), null);
  // A send still on its way is not a server copy.
  assert.equal(patchHeldMessage([{ id: "tmp:1", created_at: "2026-09-28T10:02:00.000Z", pending: true }], { id: "tmp:1", content: "x" }), null);
});

test("a held row inside the fetched page's window and missing from it is gone", async () => {
  const { heldRowsGoneFromPage } = await import("../../artifacts/kub/src/lib/messageMerge.ts");
  const at = (minute: number) => `2026-09-28T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const existing = [
    { id: "old", created_at: at(1) },
    { id: "kept", created_at: at(5) },
    { id: "deleted", created_at: at(6) },
    { id: "arrived-during-read", created_at: at(8) },
    { id: "tmp:sending", created_at: at(9), pending: true },
  ];
  const fetched = [{ id: "kept", created_at: at(5) }, { id: "newest", created_at: at(7) }];
  const heldAtStart = new Set(["old", "kept", "deleted", "tmp:sending"]);
  // «old» is before the page and not judged by it; «arrived-during-read» came
  // after the read began; a pending send is never judged.
  assert.deepEqual([...heldRowsGoneFromPage(existing, fetched, heldAtStart)], ["deleted"]);
  // An empty page means nothing after the clear mark is left on the server.
  assert.deepEqual([...heldRowsGoneFromPage(existing, [], heldAtStart)].sort(), ["deleted", "kept", "old"]);
});
