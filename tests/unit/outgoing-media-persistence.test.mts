import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelAllOutgoing,
  cancelOutgoing,
  forgetOutgoing,
  outgoingEntriesForChat,
  persistOutgoingWith,
  rememberOutgoing,
  type OutgoingMediaEntry,
} from "../../artifacts/kub/src/lib/outgoingMedia.ts";
import {
  PERSIST_LIMIT_BYTES,
  memoryOutgoingMediaStorage,
  persistable,
  toPersisted,
} from "../../artifacts/kub/src/lib/outbox/outgoingMediaStorage.ts";

/**
 * Tracker item 52, its second half: «если у тебя голосовуха не отправляется —
 * перезаписать вообще». A file on its way lived only in memory, so a restart
 * lost it. It is now written to the device at the press and removed when its
 * row is in or its placeholder is taken away.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const OTHER = "11111111-1111-4111-8111-000000000002";
const CHAT = "22222222-2222-4222-8222-000000000001";

function entry(id: string, size = 1_000, chatId = CHAT): OutgoingMediaEntry {
  const file = { size, name: `voice-${id}.webm`, type: "audio/webm" } as unknown as File;
  return {
    tempId: `tmp:${id}`,
    chatId,
    topicId: null,
    replyToId: null,
    caption: null,
    clientSentAt: "2026-09-28T09:00:00.000Z",
    attachment: {
      id: `att-${id}`,
      file,
      kind: "voice",
      previewUrl: `blob:local/${id}`,
      name: "Голосовое сообщение",
      size,
      mimeType: "audio/webm",
      status: "failed",
      progress: null,
      error: null,
      clientMessageId: id,
      uploaded: null,
      durationMs: 3_000,
    },
  };
}

test("a voice note is kept; a file larger than the limit is left to memory", () => {
  assert.equal(persistable(entry("a", 1_500_000)), true);
  assert.equal(persistable(entry("b", PERSIST_LIMIT_BYTES)), true);
  assert.equal(persistable(entry("c", PERSIST_LIMIT_BYTES + 1)), false);
});

test("what is written carries the file and not the preview's address, which dies with the page", () => {
  const written = toPersisted(ME, entry("a"));
  assert.equal(written.userId, ME);
  assert.equal(written.tempId, "tmp:a");
  assert.equal(written.entry.attachment.previewUrl, null);
  assert.equal(written.entry.attachment.file.size, 1_000);
  assert.equal(written.entry.attachment.durationMs, 3_000);
});

test("each account finds only its own waiting files", async () => {
  const storage = memoryOutgoingMediaStorage();
  await storage.save(ME, entry("a"));
  await storage.save(OTHER, entry("x"));
  assert.deepEqual((await storage.list(ME)).map((kept) => kept.tempId), ["tmp:a"]);
  await storage.drop("tmp:a");
  assert.deepEqual(await storage.list(ME), []);
  assert.equal((await storage.list(OTHER)).length, 1);
});

test("the device follows memory: kept at the press, dropped when sent or taken away", () => {
  const saved: string[] = [];
  const dropped: string[] = [];
  persistOutgoingWith({ save: (kept) => saved.push(kept.tempId), drop: (tempId) => dropped.push(tempId) });
  try {
    rememberOutgoing(entry("a"));
    rememberOutgoing(entry("b"));
    rememberOutgoing(entry("c"), { persist: false });
    assert.deepEqual(saved, ["tmp:a", "tmp:b"], "a restored entry was written again");

    forgetOutgoing("tmp:a"); // its row is in
    cancelOutgoing("tmp:b"); // «Отменить»
    assert.deepEqual(dropped, ["tmp:a", "tmp:b"]);

    // An account change takes them out of memory and off the screen, and
    // leaves them on the device for the account that sent them.
    rememberOutgoing(entry("d"));
    const before = dropped.length;
    cancelAllOutgoing();
    assert.equal(dropped.length, before, "an account change deleted another account's waiting files");
    assert.deepEqual(outgoingEntriesForChat(CHAT), []);
  } finally {
    persistOutgoingWith(null);
    cancelAllOutgoing();
  }
});
