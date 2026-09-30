import assert from "node:assert/strict";
import test from "node:test";

import { chatKind } from "../../artifacts/kub/src/lib/chatKind.ts";

// Tracker item 47: what kind of conversation a row is. The folders built on it
// are `system-folders.test.mts`.

const BOT = { id: "b1", username: "helper_bot", display_name: "Помощник" };
const person = (id: string) => ({ id, type: "private", bots: [] });
const group = (id: string) => ({ id, type: "group", bots: [] });
const channel = (id: string) => ({ id, type: "channel", bots: [] });
const botChat = (id: string) => ({ id, type: "private", bots: [BOT] });

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
