import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_ADD_FAILED,
  BOT_REMOVE_FAILED,
  BOT_VISIBILITY_NOTE,
  CHAT_BOT_MESSAGES,
  botAddedMessage,
  botDisplayName,
  botMembershipFailureMessage,
  botSecondaryLine,
  chatBotMembers,
  chatBotPartner,
  isBotDoorMissing,
} from "../../artifacts/kub/src/lib/chatBots.ts";
import { INTERNALS_PATTERN } from "../../artifacts/kub/src/lib/plainMessages.ts";

/**
 * D-235 and D-236, in the part that is made of words and decisions.
 *
 * Every assertion here is about something a surface would otherwise decide for
 * itself — which is how D-236 happened in the first place: one file invented a
 * bot mark, the other five never asked.
 */

const BOT = {
  id: "bbbb1111-1111-4111-8111-000000000001",
  username: "helper_bot",
  display_name: "Помощник",
  description: "Напоминает о встречах",
  avatar_url: null,
  state: "active",
};

const OTHER_BOT = { ...BOT, id: "bbbb1111-1111-4111-8111-000000000002", username: "second_bot" };

// ---------------------------------------------------------------------------
// Which conversation is with a bot
// ---------------------------------------------------------------------------

test("a private chat holding one bot has that bot as its counterpart", () => {
  assert.equal(chatBotPartner({ type: "private", bots: [BOT] })?.id, BOT.id);
});

test("a group is never a conversation with a bot, however many bots are in it", () => {
  // The mark D-236 asks for is about the thing you think you are talking to. A
  // group with a bot in it is still a group, and marking its row «Бот» would
  // rename the room after one of its occupants.
  assert.equal(chatBotPartner({ type: "group", bots: [BOT] }), null);
  assert.equal(chatBotPartner({ type: "channel", bots: [BOT] }), null);
  // But the bots are still readable, which is what the members list needs.
  assert.equal(chatBotMembers({ type: "group", bots: [BOT, OTHER_BOT] }).length, 2);
});

test("a private chat with no bot, or with more than one, answers nothing", () => {
  assert.equal(chatBotPartner({ type: "private", bots: [] }), null);
  // `open_or_create_bot_chat` puts exactly one bot in a private chat, so two is
  // a shape the product cannot make. Guessing which one it is would be worse
  // than saying nothing.
  assert.equal(chatBotPartner({ type: "private", bots: [BOT, OTHER_BOT] }), null);
});

test("a chat whose bots were never read is not a bot chat", () => {
  // `bots` absent means «not asked», and a list that could not read bot
  // memberships must look exactly like a list with no bots in it.
  assert.equal(chatBotPartner({ type: "private" }), null);
  assert.equal(chatBotPartner(null), null);
  assert.equal(chatBotMembers(undefined).length, 0);
});

// ---------------------------------------------------------------------------
// The sentence D-235 requires at the moment of adding
// ---------------------------------------------------------------------------

test("the visibility note says what a bot will see and what it will not", () => {
  // Read off `private.bot_can_receive_message`'s `restricted` branch, which is
  // the function the gateway's delivery goes through. Three claims have to
  // survive any rewording, because each is a thing somebody would otherwise
  // assume wrongly:
  //
  //   1. only what is addressed to it — the branch admits a message only on a
  //      mention, a command carrying the никнейм, or a reply to the bot;
  //   2. the rest of the conversation is not included;
  //   3. `messages.created_at >= chat_bot_members.joined_at` — the history
  //      before the bot arrived is not included either, which is the clause
  //      nobody guesses.
  const note = BOT_VISIBILITY_NOTE.toLocaleLowerCase("ru-RU");
  assert.ok(note.includes("@никнейм"), "the note does not say how a bot is addressed");
  assert.ok(note.includes("ответы на его сообщения"), "the note does not mention replies");
  assert.ok(note.includes("не увидит"), "the note never says what the bot will NOT see");
  assert.ok(note.includes("историю"), "the note does not say the history before joining is excluded");
});

test("the note promises nothing about raising a bot to full visibility", () => {
  // `chat_bot_members_visibility_approval_check` forbids a `full` row without
  // an approver, and the two-party flow that would supply one does not exist.
  // A sentence offering it would be a promise the product cannot keep.
  const note = BOT_VISIBILITY_NOTE.toLocaleLowerCase("ru-RU");
  for (const promise of ["полный доступ", "все сообщения", "разрешить", "настроить"]) {
    assert.ok(!note.includes(promise), `the note offers «${promise}», which nothing implements`);
  }
});

test("the success message repeats the restriction rather than only the fact", () => {
  const said = botAddedMessage("Помощник");
  assert.ok(said.includes("Помощник"), "the confirmation does not name the bot");
  assert.ok(
    said.toLocaleLowerCase("ru-RU").includes("только обращённые к нему"),
    "the confirmation drops the restriction the screen had just stated",
  );
});

// ---------------------------------------------------------------------------
// What a refusal means
// ---------------------------------------------------------------------------

test("each refusal the door raises gets its own sentence", () => {
  // The six names are the `raise exception` strings of
  // `20260919010000_a_bot_can_be_put_in_a_group.sql`.
  const cases: Array<[string, string]> = [
    ["not_a_group", "Бота можно добавить только в группу."],
    ["not_an_admin", "Добавлять и убирать ботов может только администратор группы."],
    ["bot_not_active", "Этот бот сейчас отключён."],
    ["no_such_bot", "Такого бота больше нет."],
    ["no_such_chat", "Этой группы больше нет."],
    ["not_authenticated", "Войдите в аккаунт ещё раз."],
  ];
  for (const [raised, said] of cases) {
    assert.equal(
      botMembershipFailureMessage({ message: raised, code: "P0001" }, BOT_ADD_FAILED),
      said,
      `for ${raised}`,
    );
  }
});

test("a refusal is recognised wherever PostgREST put it", () => {
  assert.equal(
    botMembershipFailureMessage({ details: "not_an_admin" }, BOT_REMOVE_FAILED),
    "Добавлять и убирать ботов может только администратор группы.",
  );
  assert.equal(
    botMembershipFailureMessage({ hint: "bot_not_active" }, BOT_REMOVE_FAILED),
    "Этот бот сейчас отключён.",
  );
});

test("an unrecognised failure falls back rather than showing the machine", () => {
  const raw = { code: "57014", message: "canceling statement due to statement timeout" };
  assert.equal(botMembershipFailureMessage(raw, BOT_ADD_FAILED), BOT_ADD_FAILED);
  assert.equal(botMembershipFailureMessage(null, BOT_REMOVE_FAILED), BOT_REMOVE_FAILED);
});

// ---------------------------------------------------------------------------
// A deployment without the door
// ---------------------------------------------------------------------------

test("a missing function is recognised, in both the shapes it arrives in", () => {
  assert.ok(isBotDoorMissing({ code: "PGRST202", message: "Could not find the function public.chat_bots_available in the schema cache" }));
  assert.ok(isBotDoorMissing({ code: "42883", message: "function public.chat_bot_add(uuid, uuid) does not exist" }));
});

test("a refusal is not an absence", () => {
  // The distinction is the whole point: an absent function means «draw no bot
  // section», a refused call means something went wrong and must not be
  // silenced. Reading 42501 as absence would hide every real failure.
  assert.equal(isBotDoorMissing({ code: "42501", message: "permission denied for function chat_bot_add" }), false);
  assert.equal(isBotDoorMissing({ code: "P0001", message: "not_an_admin" }), false);
  assert.equal(isBotDoorMissing(null), false);
});

// ---------------------------------------------------------------------------
// How a bot is written down
// ---------------------------------------------------------------------------

test("a bot without a display name is shown by its никнейм", () => {
  assert.equal(botDisplayName(BOT), "Помощник");
  assert.equal(botDisplayName({ ...BOT, display_name: "   " }), "@helper_bot");
});

test("the second line carries the никнейм first, because that is what addresses it", () => {
  assert.equal(botSecondaryLine(BOT), "@helper_bot · Напоминает о встречах");
  assert.equal(botSecondaryLine({ ...BOT, description: "  " }), "@helper_bot");
  assert.equal(botSecondaryLine({ ...BOT, description: null }), "@helper_bot");
});

test("nothing this module shows explains the machine", () => {
  for (const message of CHAT_BOT_MESSAGES) {
    assert.ok(
      !INTERNALS_PATTERN.test(message),
      `«${message}» explains the machine rather than the situation`,
    );
  }
});
