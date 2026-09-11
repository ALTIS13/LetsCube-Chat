import assert from "node:assert/strict";
import test from "node:test";

import { copiedMessagesText } from "../../artifacts/kub/src/lib/messageActions.ts";
import { formatMessageMoment } from "../../artifacts/kub/src/lib/format.ts";

/**
 * What «Копировать» puts on the clipboard for selected messages, and how
 * «Детали» names a moment.
 */

test("one message copies as its own text", () => {
  assert.equal(copiedMessagesText([{ name: "Аня", time: "09:20", text: "Привет" }]), "Привет");
});

test("one author's messages copy as their texts, a blank line apart", () => {
  assert.equal(
    copiedMessagesText([
      { name: "Вы", time: "09:20", text: "Первое" },
      { name: "Вы", time: "09:21", text: "Второе" },
    ]),
    "Первое\n\nВторое",
  );
});

test("a conversation keeps who said what and when", () => {
  assert.equal(
    copiedMessagesText([
      { name: "Аня", time: "09:20", text: "Вопрос" },
      { name: "Вы", time: "09:21", text: "Ответ" },
    ]),
    "Аня, [09:20]\nВопрос\n\nВы, [09:21]\nОтвет",
  );
});

test("messages with nothing to copy are skipped, and nothing at all copies as nothing", () => {
  assert.equal(copiedMessagesText([{ name: "Аня", time: "09:20", text: "  " }]), "");
  assert.equal(
    copiedMessagesText([
      { name: "Аня", time: "09:20", text: "" },
      { name: "Вы", time: "09:21", text: "Только это" },
    ]),
    "Только это",
  );
});

test("«Детали» name a moment in calendar days, with the year only when it differs", () => {
  const now = new Date(2026, 8, 11, 18, 0);
  assert.equal(formatMessageMoment(new Date(2026, 8, 11, 9, 20).toISOString(), now), "Сегодня в 09:20");
  assert.equal(formatMessageMoment(new Date(2026, 8, 10, 23, 50).toISOString(), now), "Вчера в 23:50");
  assert.match(formatMessageMoment(new Date(2026, 8, 3, 9, 5).toISOString(), now), /^3 сентября в 09:05$/);
  assert.match(formatMessageMoment(new Date(2025, 11, 31, 12, 0).toISOString(), now), /^31 декабря 2025.* в 12:00$/);
  // Just after midnight a message from late last night is «Вчера», not «Сегодня».
  assert.equal(formatMessageMoment(new Date(2026, 8, 10, 23, 55).toISOString(), new Date(2026, 8, 11, 0, 5)), "Вчера в 23:55");
});
