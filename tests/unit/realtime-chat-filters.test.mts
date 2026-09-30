// D-327: a departure is heard only from the chats a reader holds.

import assert from "node:assert/strict";
import test from "node:test";

import {
  chatIdInFilters,
  heldChatIdsKey,
  REALTIME_IN_FILTER_MAX,
} from "../../artifacts/kub/src/lib/realtimeChatFilters.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("the same chats give the same key, whatever order the list is in", () => {
  const a = heldChatIdsKey([{ id: id(2) }, { id: id(1) }, { id: id(3) }]);
  const b = heldChatIdsKey([{ id: id(3) }, { id: id(2) }, { id: id(1) }, { id: id(2) }]);
  assert.equal(a, b);
  assert.equal(a, [id(1), id(2), id(3)].join(","));
});

test("a chat joined or left changes the key", () => {
  const before = heldChatIdsKey([{ id: id(1) }, { id: id(2) }]);
  assert.notEqual(heldChatIdsKey([{ id: id(1) }]), before);
  assert.notEqual(heldChatIdsKey([{ id: id(1) }, { id: id(2) }, { id: id(3) }]), before);
});

test("what is not a chat id never reaches a filter's syntax", () => {
  assert.equal(heldChatIdsKey([{ id: "a,b" }, { id: "x)" }, { id: null }, {}, { id: id(7) }]), id(7));
  assert.equal(heldChatIdsKey([{ id: id(7).toUpperCase() }]), id(7), "one spelling per chat");
});

test("no chats is no filter, not a filter that matches everything", () => {
  assert.deepEqual(chatIdInFilters(""), []);
});

test("a hundred chats to a filter, which is what Realtime takes", () => {
  assert.equal(REALTIME_IN_FILTER_MAX, 100);
  const key = heldChatIdsKey(Array.from({ length: 250 }, (_, n) => ({ id: id(n) })));
  const filters = chatIdInFilters(key);
  assert.equal(filters.length, 3);
  const counts = filters.map((filter) => filter.slice("chat_id=in.(".length, -1).split(",").length);
  assert.deepEqual(counts, [100, 100, 50]);
  assert.ok(filters.every((filter) => /^chat_id=in\.\([0-9a-f,-]+\)$/.test(filter)));
  const covered = filters.flatMap((filter) => filter.slice("chat_id=in.(".length, -1).split(","));
  assert.equal(new Set(covered).size, 250, "every chat covered once");
});
