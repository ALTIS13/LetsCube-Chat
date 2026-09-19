import assert from "node:assert/strict";
import test from "node:test";

import { getChatDisplayInfo, memberCountLabel } from "../../artifacts/kub/src/lib/chatDisplay.ts";

/**
 * D-093: a group's member count was always written in the form for many —
 * «4 участников» — in the chat list's second line, the chat header and the
 * chat's info panel. Russian takes the form from the last two digits.
 */

test("a member count takes the form Russian gives it", () => {
  const cases: Array<[number, string]> = [
    [1, "1 участник"],
    [2, "2 участника"],
    [4, "4 участника"],
    [5, "5 участников"],
    [11, "11 участников"],
    [12, "12 участников"],
    [14, "14 участников"],
    [21, "21 участник"],
    [22, "22 участника"],
    [111, "111 участников"],
    [0, "0 участников"],
  ];
  for (const [count, label] of cases) assert.equal(memberCountLabel(count), label, `for ${count}`);
});

test("a group without a description counts its members in that form, and one without members says it is a group", () => {
  const group = (memberCount: number, description: string | null = null) => ({
    id: "chat",
    name: "Команда",
    type: "group" as const,
    description,
    created_by: "owner",
    members: Array.from({ length: memberCount }, (_, index) => ({ user_id: `user-${index}` })),
    other_user: null,
  });
  assert.equal(getChatDisplayInfo(group(3) as never, "user-0").subtitle, "3 участника");
  assert.equal(getChatDisplayInfo(group(0) as never, "user-0").subtitle, "Группа");
  assert.equal(getChatDisplayInfo(group(3, "Проект на осень") as never, "user-0").subtitle, "Проект на осень");
});

/**
 * D-236: a conversation with a bot looked exactly like a conversation with a
 * person, and this is the function every one of those surfaces already called.
 *
 * The title was right by accident before this: a bot has no `chat_members` row,
 * so `other_user` is null, so the private branch fell back to `chat.name` —
 * which `open_or_create_bot_chat` happens to set to the bot's display name. The
 * name was correct and nothing said what it was.
 */

const HELPER = {
  id: "bbbb1111-1111-4111-8111-000000000001",
  username: "helper_bot",
  display_name: "Помощник",
  description: "Напоминает о встречах",
  avatar_url: null,
  state: "active",
};

test("a private chat holding a bot is titled and marked as a bot", () => {
  const chat = {
    id: "chat",
    name: "Помощник",
    type: "private" as const,
    description: null,
    created_by: "me",
    members: [{ user_id: "me", profile: null }],
    other_user: null,
    bots: [HELPER],
  };
  const info = getChatDisplayInfo(chat as never, "me");
  assert.equal(info.isBot, true);
  assert.equal(info.title, "Помощник");
  assert.equal(info.subtitle, "Бот");
  assert.equal(info.typeLabel, "Бот");
  assert.equal(info.isSaved, false);
});

test("a bot chat takes its title from the bot, not from the chat row", () => {
  // The two can disagree: `chats.name` is written once, when the chat is made,
  // and a bot may be renamed afterwards. The bot is the authority on its name.
  const chat = {
    id: "chat",
    name: "Старое имя",
    type: "private" as const,
    description: null,
    created_by: "me",
    members: [{ user_id: "me", profile: null }],
    other_user: null,
    bots: [{ ...HELPER, display_name: "Новое имя" }],
  };
  assert.equal(getChatDisplayInfo(chat as never, "me").title, "Новое имя");
});

test("a group that holds a bot is still a group", () => {
  const chat = {
    id: "chat",
    name: "Команда",
    type: "group" as const,
    description: null,
    created_by: "me",
    members: [{ user_id: "me" }, { user_id: "other" }],
    other_user: null,
    bots: [HELPER],
  };
  const info = getChatDisplayInfo(chat as never, "me");
  assert.equal(info.isBot, false);
  assert.equal(info.title, "Команда");
  assert.equal(info.subtitle, "2 участника");
});

test("a conversation with a person is never marked as a bot", () => {
  const chat = {
    id: "chat",
    name: null,
    type: "private" as const,
    description: null,
    created_by: "me",
    members: [
      { user_id: "me", profile: { id: "me", full_name: "Я" } },
      { user_id: "other", profile: { id: "other", full_name: "Ольга Мишина" } },
    ],
    other_user: { id: "other", full_name: "Ольга Мишина" },
    bots: [],
  };
  const info = getChatDisplayInfo(chat as never, "me");
  assert.equal(info.isBot, false);
  assert.equal(info.title, "Ольга Мишина");
  assert.equal(info.subtitle, "Личный чат");
});

test("«Избранное» wins over everything, and is not a bot", () => {
  const chat = {
    id: "chat",
    name: "Избранное",
    type: "private" as const,
    description: null,
    created_by: "me",
    members: [{ user_id: "me" }],
    other_user: null,
    bots: [HELPER],
  };
  const info = getChatDisplayInfo(chat as never, "me");
  assert.equal(info.isSaved, true);
  assert.equal(info.isBot, false);
  assert.equal(info.title, "Избранное");
});
