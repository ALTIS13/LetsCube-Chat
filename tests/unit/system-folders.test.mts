import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_FOLDERS,
  chatsInFolder,
  folderInForce,
  isSystemFolderId,
  offeredSystemFolders,
  systemFolderKind,
} from "../../artifacts/kub/src/lib/systemFolders.ts";

// Tracker items 47 and 69: the kinds of conversation as system folders beside
// «Все», in place of the capsule a tester asked to have removed.

const BOT = { id: "b1", username: "helper_bot", display_name: "Помощник" };
const person = (id: string) => ({ id, type: "private", bots: [] });
const group = (id: string) => ({ id, type: "group", bots: [] });
const channel = (id: string) => ({ id, type: "channel", bots: [] });
const botChat = (id: string) => ({ id, type: "private", bots: [BOT] });

test("a system folder for every kind present, people first, and none for a list of one kind", () => {
  const names = (chats: Parameters<typeof offeredSystemFolders>[0]) => offeredSystemFolders(chats).map((folder) => folder.name);
  assert.deepEqual(names([botChat("c"), group("b"), person("a")]), ["Личные", "Группы", "Боты"]);
  assert.deepEqual(names([person("a"), channel("c")]), ["Личные", "Каналы"]);
  assert.deepEqual(names([person("a"), person("b")]), [], "«Личные» holding what «Все» holds is a second name for one list");
  assert.deepEqual(names([]), []);
});

test("a system folder is a rule: a chat of its kind is in it without being put there", () => {
  const chats = [person("a"), group("b"), botChat("c"), person("d"), group("e")];
  assert.deepEqual(chatsInFolder(chats, "system:person", {}).map((chat) => chat.id), ["a", "d"]);
  assert.deepEqual(chatsInFolder(chats, "system:group", {}).map((chat) => chat.id), ["b", "e"]);
  assert.deepEqual(chatsInFolder(chats, "system:bot", {}).map((chat) => chat.id), ["c"]);
  const tomorrow = [...chats, group("f")];
  assert.deepEqual(chatsInFolder(tomorrow, "system:group", {}).map((chat) => chat.id), ["b", "e", "f"]);
});

test("«Все» is the same array, and a folder of the reader's own is its list", () => {
  const chats = [person("a"), group("b"), botChat("c")];
  assert.equal(chatsInFolder(chats, null, {}), chats, "nothing renders for an event that changed nothing");
  const mine = "7b0d6c1e-0000-4000-8000-000000000001";
  assert.deepEqual(chatsInFolder(chats, mine, { [mine]: new Set(["a", "b"]) }).map((chat) => chat.id), ["a", "b"]);
  assert.deepEqual(chatsInFolder(chats, mine, {}), [], "a folder whose list has not arrived shows nothing rather than everything");
});

test("a system folder whose kind emptied gives way to «Все», and is back when the kind returns", () => {
  const withBots = offeredSystemFolders([person("a"), botChat("c")]);
  const withoutBots = offeredSystemFolders([person("a"), group("b")]);
  assert.equal(folderInForce("system:bot", withBots), "system:bot");
  assert.equal(folderInForce("system:bot", withoutBots), null);
  assert.equal(folderInForce(null, withoutBots), null);
  const mine = "7b0d6c1e-0000-4000-8000-000000000001";
  assert.equal(folderInForce(mine, withoutBots), mine, "a folder of the reader's own is not the rule's to move");
});

test("a system folder's id never passes for a folder of the reader's own", () => {
  for (const folder of SYSTEM_FOLDERS) {
    assert.equal(isSystemFolderId(folder.id), true);
    assert.equal(systemFolderKind(folder.id), folder.kind);
    assert.doesNotMatch(folder.id, /^[0-9a-f]{8}-/, "a uuid is what a stored folder's id looks like");
  }
  assert.equal(isSystemFolderId("7b0d6c1e-0000-4000-8000-000000000001"), false);
  assert.equal(isSystemFolderId("system:servers"), false);
  assert.equal(isSystemFolderId(null), false);
  assert.equal(systemFolderKind("system:servers"), null);
});

test("a folder of the reader's own with a system folder's name keeps the name alone", () => {
  const chats = [person("a"), group("b"), botChat("c")];
  const names = (own: string[]) => offeredSystemFolders(chats, own).map((folder) => folder.name);
  assert.deepEqual(names(["Личные"]), ["Группы", "Боты"]);
  assert.deepEqual(names([" группы "]), ["Личные", "Боты"], "the same name however it was typed");
  assert.deepEqual(names(["Работа"]), ["Личные", "Группы", "Боты"]);
});
