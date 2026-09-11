import assert from "node:assert/strict";
import test from "node:test";

import {
  DELETE_FOR_EVERYONE_BATCH,
  deletionBatches,
  keepsDeletedPlaceholder,
  markMessagesDeleted,
  parseDeletedIds,
  splitForPreviousDeletion,
  visibleConversation,
} from "../../artifacts/kub/src/lib/deletedMessages.ts";

/**
 * Delete for both in a private chat leaves no trace, as in Telegram; a group
 * keeps «Сообщение удалено» where a message was.
 */

const message = (id: string, deleted = false, user = "me") => ({ id, user_id: user, deleted_at: deleted ? "2026-09-11T10:00:00Z" : null });

test("a private chat draws no deleted message; a group, a channel and an unknown chat keep the placeholder", () => {
  assert.equal(keepsDeletedPlaceholder("private"), false);
  assert.equal(keepsDeletedPlaceholder("group"), true);
  assert.equal(keepsDeletedPlaceholder("channel"), true);
  assert.equal(keepsDeletedPlaceholder(undefined), true, "an unknown chat is not assumed private");

  const messages = [message("a"), message("b", true), message("c")];
  assert.deepEqual(visibleConversation(messages, "private").map((row) => row.id), ["a", "c"]);
  assert.equal(visibleConversation(messages, "group"), messages);
});

test("the same array when nothing is taken out, so a memoised conversation does not render again", () => {
  const messages = [message("a"), message("c")];
  assert.equal(visibleConversation(messages, "private"), messages);
});

test("ids go in batches of the server's size, once each, and never a local send", () => {
  const ids = Array.from({ length: DELETE_FOR_EVERYONE_BATCH + 5 }, (_, index) => `m${index}`);
  const batches = deletionBatches([...ids, "m0", "tmp:abc", ""]);
  assert.deepEqual(batches.map((batch) => batch.length), [DELETE_FOR_EVERYONE_BATCH, 5]);
  assert.equal(batches.flat().includes("tmp:abc"), false);
  assert.deepEqual(deletionBatches([]), []);
});

test("marking deleted keeps a deletion the server already made, and the array when nothing changes", () => {
  const messages = [message("a"), message("b", true), message("c")];
  const marked = markMessagesDeleted(messages, new Set(["a", "b"]), "2026-09-11T11:00:00Z");
  assert.equal(marked[0].deleted_at, "2026-09-11T11:00:00Z");
  assert.equal(marked[1], messages[1], "an already deleted message was rewritten");
  assert.equal(marked[2], messages[2]);
  assert.equal(markMessagesDeleted(messages, new Set(["b", "zz"]), "2026-09-11T11:00:00Z"), messages);
});

test("without the server's delete for both, own messages go for everyone and the rest are hidden", () => {
  const { own, others } = splitForPreviousDeletion([message("a"), message("b", false, "anya"), message("c")], (row) => row.user_id === "me");
  assert.deepEqual(own.map((row) => row.id), ["a", "c"]);
  assert.deepEqual(others.map((row) => row.id), ["b"]);
});

test("the ids the server answers with", () => {
  assert.deepEqual(parseDeletedIds(["a", "b"]), ["a", "b"]);
  assert.equal(parseDeletedIds([1]), null);
  assert.equal(parseDeletedIds(null), null);
});
