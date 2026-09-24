import assert from "node:assert/strict";
import test from "node:test";

import { withChatDisplayTitles } from "../../artifacts/kub/src/lib/searchResultChatDisplay.ts";

const me = "user-me";
const other = "user-other";

const privateChat = {
  id: "private-chat",
  name: "Старое имя",
  type: "private",
  created_by: me,
  members: [
    { user_id: me, profile: { id: me, full_name: "Я" } },
    { user_id: other, profile: { id: other, full_name: "Новое имя" } },
  ],
  other_user: { id: other, full_name: "Новое имя" },
  bots: [],
};

test("message search uses the loaded private-chat counterpart, not the generic RPC title", () => {
  const result = {
    resultType: "message",
    id: "message-1",
    chatId: privateChat.id,
    title: "Сообщение",
    subtitle: "Автор сообщения",
  };
  const [display] = withChatDisplayTitles([result], [privateChat] as never, me);

  assert.equal(display.title, "Новое имя");
  assert.equal(display.subtitle, "Автор сообщения");
  assert.equal(result.title, "Сообщение", "RPC result remains untouched");
});

test("chat search uses the same identity as chat rows for bots and Saved Messages", () => {
  const bot = {
    ...privateChat,
    id: "bot-chat",
    bots: [{ id: "bot-1", username: "helper_bot", display_name: "Помощник", state: "active" }],
    other_user: null,
  };
  const saved = {
    ...privateChat,
    id: "saved-chat",
    name: "Избранное",
    members: [{ user_id: me, profile: { id: me, full_name: "Я" } }],
    other_user: null,
  };
  const results = [
    { resultType: "chat", id: bot.id, chatId: bot.id, title: "Личный чат", subtitle: "Личный чат" },
    { resultType: "message", id: "message-2", chatId: bot.id, title: "Сообщение", subtitle: "Автор" },
    { resultType: "chat", id: saved.id, chatId: saved.id, title: "Личный чат", subtitle: "Личный чат" },
  ];
  const [botChat, botMessage, savedChat] = withChatDisplayTitles(results, [bot, saved] as never, me);

  assert.equal(botChat.title, "Помощник");
  assert.equal(botChat.subtitle, "Бот");
  assert.equal(botMessage.title, "Помощник");
  assert.equal(botMessage.subtitle, "Автор");
  assert.equal(savedChat.title, "Избранное");
  assert.equal(savedChat.subtitle, "Личное пространство");
});

test("search never invents names when a chat is not loaded or the user is absent", () => {
  const results = [
    { resultType: "message", id: "message-3", chatId: "unloaded", title: "Сообщение" },
    { resultType: "user", id: other, title: "Пользователь" },
  ];

  assert.deepEqual(withChatDisplayTitles(results, [privateChat] as never, me), results);
  assert.deepEqual(withChatDisplayTitles(results, [privateChat] as never, null), results);
});

test("search titles follow a refreshed chat list without changing the RPC results", () => {
  const result = { resultType: "message", id: "message-4", chatId: privateChat.id, title: "Сообщение" };
  const first = withChatDisplayTitles([result], [privateChat] as never, me);
  const renamed = {
    ...privateChat,
    other_user: { id: other, full_name: "Новое имя после обновления" },
  };
  const second = withChatDisplayTitles([result], [renamed] as never, me);

  assert.equal(first[0].title, "Новое имя");
  assert.equal(second[0].title, "Новое имя после обновления");
  assert.equal(result.title, "Сообщение");
});
