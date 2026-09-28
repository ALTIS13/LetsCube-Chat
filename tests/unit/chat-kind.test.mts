import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_KIND_FILTERS,
  chatKind,
  chatKindStorageKey,
  chatsOfKind,
  effectiveChatKind,
  offeredChatKinds,
  readStoredChatKind,
  unreadByChatKind,
} from "../../artifacts/kub/src/lib/chatKind.ts";

// Tracker item 47: the capsule that separates people, groups and bots in one list.

const BOT = { id: "b1", username: "helper_bot", display_name: "Помощник" };
const person = (id: string, unread = 0) => ({ id, type: "private", bots: [], unread_count: unread });
const group = (id: string, unread = 0) => ({ id, type: "group", bots: [], unread_count: unread });
const channel = (id: string) => ({ id, type: "channel", bots: [] });
const botChat = (id: string, unread = 0) => ({ id, type: "private", bots: [BOT], unread_count: unread });

test("a conversation's kind: a bot's is private by type and still a bot", () => {
  assert.equal(chatKind(person("a")), "person");
  assert.equal(chatKind(group("b")), "group");
  assert.equal(chatKind(channel("c")), "channel");
  assert.equal(chatKind(botChat("d")), "bot");
  // A group a bot is in is still a group.
  assert.equal(chatKind({ id: "e", type: "group", bots: [BOT] }), "group");
  // Two bots in a private chat is not one bot's conversation.
  assert.equal(chatKind({ id: "f", type: "private", bots: [BOT, { ...BOT, id: "b2" }] }), "person");
});

test("the pills are «Все» and the kinds present, and none for a list of one kind", () => {
  assert.deepEqual(offeredChatKinds([person("a"), group("b"), botChat("c")]), ["all", "person", "group", "bot"]);
  assert.deepEqual(offeredChatKinds([person("a"), channel("c")]), ["all", "person", "channel"]);
  assert.deepEqual(offeredChatKinds([person("a"), person("b")]), []);
  assert.deepEqual(offeredChatKinds([]), []);
});

test("a choice whose kind emptied is not in force, and comes back when it returns", () => {
  const offered = offeredChatKinds([person("a"), group("b")]);
  assert.equal(effectiveChatKind("bot", offered), "all");
  assert.equal(effectiveChatKind("group", offered), "group");
  assert.equal(effectiveChatKind("bot", offeredChatKinds([person("a"), botChat("c")])), "bot");
});

test("the list narrows to one kind, and «Все» is everything", () => {
  const chats = [person("a"), group("b"), botChat("c"), person("d")];
  assert.deepEqual(chatsOfKind(chats, "person").map((chat) => chat.id), ["a", "d"]);
  assert.deepEqual(chatsOfKind(chats, "bot").map((chat) => chat.id), ["c"]);
  assert.equal(chatsOfKind(chats, "all"), chats, "«Все» is the same array, so nothing renders for it");
});

test("each pill counts what is unread in its kind", () => {
  const counts = unreadByChatKind([person("a", 2), group("b", 5), botChat("c", 1), person("d")]);
  assert.deepEqual(counts, { all: 8, person: 2, group: 5, channel: 0, bot: 1 });
});

test("the kept choice is per account and read without trusting it", () => {
  assert.notEqual(chatKindStorageKey("u1"), chatKindStorageKey("u2"));
  for (const filter of CHAT_KIND_FILTERS) assert.equal(readStoredChatKind(filter.id), filter.id);
  assert.equal(readStoredChatKind(null), "all");
  assert.equal(readStoredChatKind("servers"), "all");
  assert.equal(readStoredChatKind('"group"'), "all");
});
