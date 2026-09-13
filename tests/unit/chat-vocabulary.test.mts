// What the product calls a group-like chat, and the people in it.
//
// D-169. The information card called every group-like chat a group, while the
// chat list's context menu, the conversation header and the settings rows had
// each learned the difference separately and said it differently. The words are
// one module now so that «what is this thing called» can be argued about
// without a browser, and so that no surface can answer it on its own again.

import assert from "node:assert/strict";
import test from "node:test";

import {
  chatKindOf,
  chatVocabulary,
  countedMemberLabel,
} from "../../artifacts/kub/src/lib/chatVocabulary.ts";

test("a channel is a channel and everything else is addressed as a group", () => {
  assert.equal(chatKindOf("channel"), "channel");
  assert.equal(chatKindOf("group"), "group");
  // The card reaches this module only for a chat it has already decided is
  // group-like, so an unexpected type is answered rather than thrown at.
  assert.equal(chatKindOf(null), "group");
  assert.equal(chatKindOf(undefined), "group");
  assert.equal(chatKindOf("private"), "group");
});

test("every title the card wears names the thing it is over", () => {
  const group = chatVocabulary("group");
  const channel = chatVocabulary("channel");

  assert.equal(group.infoTitle, "Информация о группе");
  assert.equal(channel.infoTitle, "Информация о канале");
  assert.equal(group.settingsTitle, "Настройки группы");
  assert.equal(channel.settingsTitle, "Настройки канала");
  assert.equal(group.membersTitle, "Участники");
  assert.equal(channel.membersTitle, "Подписчики");
});

test("leaving and deleting say which of the two you are leaving or deleting", () => {
  const group = chatVocabulary("group");
  const channel = chatVocabulary("channel");

  assert.equal(group.leaveLabel, "Покинуть группу");
  assert.equal(channel.leaveLabel, "Покинуть канал");
  assert.equal(group.leaveTitle, "Покинуть группу?");
  assert.equal(channel.leaveTitle, "Покинуть канал?");
  // «Удалить групповой чат» on the card root against «Удалить группу» on the
  // settings screen was one button named twice.
  assert.equal(group.deleteLabel, "Удалить группу");
  assert.equal(channel.deleteLabel, "Удалить канал");
  assert.equal(group.deleteTitle, "Удалить группу?");
  assert.equal(channel.deleteTitle, "Удалить канал?");
  assert.equal(group.deleteError, "Не удалось удалить группу");
  assert.equal(channel.deleteError, "Не удалось удалить канал");
});

test("the sentences about the other people use the other people's noun", () => {
  const group = chatVocabulary("group");
  const channel = chatVocabulary("channel");

  assert.equal(
    group.leaveDescription,
    "Группа исчезнет из вашего списка. История у других участников останется.",
  );
  assert.equal(
    channel.leaveDescription,
    "Канал исчезнет из вашего списка. История у других подписчиков останется.",
  );
  assert.equal(
    group.deleteDescription,
    "Это действие нельзя отменить. Чат и история исчезнут у всех участников.",
  );
  assert.equal(
    channel.deleteDescription,
    "Это действие нельзя отменить. Чат и история исчезнут у всех подписчиков.",
  );
  assert.equal(group.deleteAftermath, "После удаления группа исчезнет у всех участников.");
  assert.equal(channel.deleteAftermath, "После удаления канал исчезнет у всех подписчиков.");
});

test("the description box asks about the thing it is describing", () => {
  assert.equal(chatVocabulary("group").descriptionPlaceholder, "О чём эта группа");
  assert.equal(chatVocabulary("channel").descriptionPlaceholder, "О чём этот канал");
});

test("the cases are the ones the sentences are built from", () => {
  const channel = chatVocabulary("channel");
  assert.equal(channel.subject, "Канал");
  assert.equal(channel.object, "канал");
  assert.equal(channel.possessive, "канала");
  assert.equal(channel.locative, "канале");

  const group = chatVocabulary("group");
  assert.equal(group.subject, "Группа");
  assert.equal(group.object, "группу");
  assert.equal(group.possessive, "группы");
  assert.equal(group.locative, "группе");
});

test("the people are counted in Russian, in each of the two nouns", () => {
  assert.equal(countedMemberLabel(1, "group"), "1 участник");
  assert.equal(countedMemberLabel(2, "group"), "2 участника");
  assert.equal(countedMemberLabel(5, "group"), "5 участников");
  assert.equal(countedMemberLabel(11, "group"), "11 участников", "eleven is not one");
  assert.equal(countedMemberLabel(21, "group"), "21 участник");
  assert.equal(countedMemberLabel(112, "group"), "112 участников");
  assert.equal(countedMemberLabel(0, "group"), "0 участников");

  assert.equal(countedMemberLabel(1, "channel"), "1 подписчик");
  assert.equal(countedMemberLabel(2, "channel"), "2 подписчика");
  assert.equal(countedMemberLabel(5, "channel"), "5 подписчиков");
  assert.equal(countedMemberLabel(14, "channel"), "14 подписчиков");
  assert.equal(countedMemberLabel(21, "channel"), "21 подписчик");
});
