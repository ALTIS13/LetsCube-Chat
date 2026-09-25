import assert from "node:assert/strict";
import test from "node:test";

import { groupVisibleMediaAlbums } from "../../artifacts/kub/src/lib/mediaAlbum.ts";
import type { MessageWithSender } from "../../artifacts/kub/src/types/database.ts";

const ALBUM = "a-message";
const SENDER = { id: "u1" };

function media(id: string, index: unknown, overrides: Record<string, unknown> = {}): MessageWithSender {
  return {
    id,
    chat_id: "chat-1",
    type: "image",
    user_id: "u1",
    bot_id: null,
    sender: SENDER,
    bot: null,
    media_url: `/media/${id}.jpg`,
    media_metadata: { album_id: ALBUM, album_index: index, album_count: 3 },
    deleted_at: null,
    ...overrides,
  } as MessageWithSender;
}

function groups(messages: MessageWithSender[], breakBeforeIds?: ReadonlySet<string>): string[][] {
  return groupVisibleMediaAlbums(messages, breakBeforeIds).map((group) => group.messages.map((item) => item.id));
}

test("adjacent visual rows with an opaque sender album ID make one ordered group", () => {
  const rows = [media("one", 0), media("two", 1, { type: "video" }), media("three", 2)];
  assert.deepEqual(groups(rows), [["one", "two", "three"]]);
  assert.equal(groupVisibleMediaAlbums(rows)[0]?.kind, "album");
  assert.equal(groupVisibleMediaAlbums(rows)[0]?.albumId, "a-message");
});

test("missing and failed items leave only adjacent surviving pairs grouped", () => {
  assert.deepEqual(groups([media("one", 0), media("two", 1, { failed: true }), media("three", 2)]), [
    ["one"], ["two"], ["three"],
  ]);
  assert.deepEqual(groups([media("one", 0), media("two", 1), media("three", 2, { failed: true })]), [
    ["one", "two"], ["three"],
  ]);
  assert.deepEqual(groups([media("two", 1), media("three", 2)]), [["two", "three"]]);
});

test("optimistic media joins the same album before ACK, while failed media keeps its own row", () => {
  const first = media("tmp:first", 0, { pending: true, client_message_id: "first" });
  const second = media("tmp:second", 1, { checking: true, client_message_id: "second" });
  const third = media("confirmed", 2);
  assert.deepEqual(groups([first, second, third]), [["tmp:first", "tmp:second", "confirmed"]]);
  assert.deepEqual(groups([first, { ...second, checking: false, failed: true }, third]), [
    ["tmp:first"], ["tmp:second"], ["confirmed"],
  ]);
});

test("a retried first item after the second is displayed first without crossing another row", () => {
  assert.deepEqual(groups([media("second", 1), media("retried-first", 0)]), [["retried-first", "second"]]);
  assert.deepEqual(groups([media("second", 1)]), [["second"]]);
  assert.deepEqual(groups([media("second", 1), media("note", 0, { type: "text" }), media("retried-first", 0)]), [
    ["second"], ["note"], ["retried-first"],
  ]);
  assert.deepEqual(groups([media("second", 1), media("duplicate", 1), media("retried-first", 0)]), [
    ["second"], ["retried-first", "duplicate"],
  ]);
});

test("other chats, senders, text, deletion and display boundaries stop merging", () => {
  assert.deepEqual(groups([media("one", 0), media("two", 1, { chat_id: "chat-2" })]), [["one"], ["two"]]);
  assert.deepEqual(groups([media("one", 0), media("two", 1, { user_id: "u2", sender: { id: "u2" } })]), [["one"], ["two"]]);
  assert.deepEqual(groups([media("one", 0), media("note", 1, { type: "text" }), media("three", 2)]), [["one"], ["note"], ["three"]]);
  assert.deepEqual(groups([media("one", 0), media("two", 1, { deleted_at: "2026-09-13T09:00:00Z" }), media("three", 2)]), [["one"], ["two"], ["three"]]);
  assert.deepEqual(groups([media("one", 0), media("two", 1)], new Set(["two"])), [["one"], ["two"]]);
});

test("untrusted album tuples never merge unrelated rows", () => {
  const invalid = [
    { album_id: "short", album_index: 0, album_count: 2 },
    { album_id: "a-message!", album_index: 0, album_count: 2 },
    { album_id: "a-message", album_index: "0", album_count: 2 },
    { album_id: "a-message", album_index: 0.5, album_count: 2 },
    { album_id: "a-message", album_index: -1, album_count: 2 },
    { album_id: "a-message", album_index: 0, album_count: 11 },
    { album_id: "a-message", album_index: 2, album_count: 2 },
    ["a-message", 0, 2],
  ];
  for (const metadata of invalid) {
    assert.deepEqual(groups([media("one", 0, { media_metadata: metadata }), media("two", 1)]), [["one"], ["two"]]);
  }
  assert.deepEqual(groups([media("one", 0), media("two", 2)]), [["one", "two"]]);
  assert.deepEqual(groups([media("one", 0), media("two", 1, { media_metadata: { album_id: ALBUM, album_index: 1, album_count: 2 } })]), [["one"], ["two"]]);
  assert.deepEqual(groups([media("one", 0), media("two", 1, { media_url: null })]), [["one"], ["two"]]);
  assert.deepEqual(groups([
    media("one", 0, { media_metadata: { album_id: "-album-id", album_index: 0, album_count: 2 } }),
    media("two", 1, { media_metadata: { album_id: "-album-id", album_index: 1, album_count: 2 } }),
  ]), [["one"], ["two"]]);
  assert.deepEqual(groups([
    media("one", 0, { media_metadata: { album_id: "album-id-", album_index: 0, album_count: 2 } }),
    media("two", 1, { media_metadata: { album_id: "album-id-", album_index: 1, album_count: 2 } }),
  ]), [["one"], ["two"]]);
});

test("ten items are the maximum and keep their individual IDs in album order", () => {
  const rows = Array.from({ length: 10 }, (_, index) => media(`item-${index}`, 9 - index, {
    media_metadata: { album_id: "x".repeat(80), album_index: 9 - index, album_count: 10 },
  }));
  assert.deepEqual(groups(rows), [Array.from({ length: 10 }, (_, index) => `item-${9 - index}`)]);
  assert.deepEqual(groups([media("bad-1", 0, {
    media_metadata: { album_id: ALBUM, album_index: 0, album_count: 11 },
  }), media("bad-2", 1, {
    media_metadata: { album_id: ALBUM, album_index: 1, album_count: 11 },
  })]), [["bad-1"], ["bad-2"]]);
});
