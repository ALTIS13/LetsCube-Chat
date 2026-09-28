import assert from "node:assert/strict";
import test from "node:test";

import {
  quickSwitchOrder,
  quickSwitchSections,
  recordRecentChat,
  RECENT_CHATS_LIMIT,
} from "../../artifacts/kub/src/lib/quickSwitch.ts";

/**
 * Tracker item 36, c: the search offers where to go before anything is typed,
 * as Discord's quick switcher does — where the reader was, drafts, unread.
 */

const chat = (id: string, unread = 0, muted = false) => ({ id, unread, muted });

test("a visit moves the conversation to the front, once, and the list keeps twenty", () => {
  assert.deepEqual(recordRecentChat(["b", "a", "c"], "a"), ["a", "b", "c"]);
  const many = Array.from({ length: RECENT_CHATS_LIMIT }, (_, index) => `c${index}`);
  const next = recordRecentChat(many, "new");
  assert.equal(next.length, RECENT_CHATS_LIMIT);
  assert.equal(next[0], "new");
  assert.ok(!next.includes(`c${RECENT_CHATS_LIMIT - 1}`));
});

test("where the reader was: the conversation on screen skipped, seven when alone", () => {
  const chats = Array.from({ length: 10 }, (_, index) => chat(`c${index}`));
  const sections = quickSwitchSections({
    recent: ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    currentChatId: "c0",
    chats,
    draftChatIds: new Set(),
  });
  assert.deepEqual(sections.map((section) => section.id), ["recent"]);
  assert.deepEqual(sections[0].chatIds, ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
});

test("three when a draft or an unread conversation follows, each conversation once", () => {
  const chats = [chat("a"), chat("b", 2), chat("c"), chat("d", 1, true), chat("e"), chat("f", 4)];
  const sections = quickSwitchSections({
    recent: ["a", "b", "c", "e", "f"],
    currentChatId: null,
    chats,
    draftChatIds: new Set(["e", "c"]),
  });
  assert.deepEqual(
    sections.map((section) => [section.id, section.chatIds]),
    [
      ["recent", ["a", "b", "c"]],
      // «c» already stands under «Недавние».
      ["drafts", ["e"]],
      // «b» already listed; «d» is muted, and a muted conversation is not waiting.
      ["unread", ["f"]],
    ],
  );
  assert.deepEqual(quickSwitchOrder(sections), ["a", "b", "c", "e", "f"]);
});

test("a remembered conversation the reader can no longer see is not offered", () => {
  const sections = quickSwitchSections({
    recent: ["gone", "a"],
    currentChatId: null,
    chats: [chat("a")],
    draftChatIds: new Set(["gone"]),
  });
  assert.deepEqual(quickSwitchOrder(sections), ["a"]);
});

test("nothing to offer is no section at all", () => {
  assert.deepEqual(quickSwitchSections({ recent: [], currentChatId: null, chats: [chat("a")], draftChatIds: new Set() }), []);
});
