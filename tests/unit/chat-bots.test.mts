import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_ACCESS_FULL,
  BOT_ACCESS_RESTRICTED,
  BOT_ADD_FAILED,
  BOT_MEMBERS_HISTORY_NOTE,
  BOT_REMOVE_FAILED,
  BOT_VISIBILITY_NOTE,
  CHAT_BOT_MESSAGES,
  botAccessLabel,
  botAddedMessage,
  botMemberStatusLine,
  botDisplayName,
  botMembershipFailureMessage,
  botSecondaryLine,
  chatBotMembers,
  chatBotPartner,
  isBotDoorMissing,
  readBotPrivacyMode,
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


// ---------------------------------------------------------------------------
// D-276: the privacy state, said on the bot's own row
// ---------------------------------------------------------------------------

test("each privacy mode gets its own words, and the two are not the same sentence", () => {
  // The whole point of the line is that a reader can tell two bots apart at a
  // glance. Two labels that differ only in a word nobody reads would pass a
  // «there is a label» test and fail the person.
  assert.equal(botAccessLabel("restricted"), BOT_ACCESS_RESTRICTED);
  assert.equal(botAccessLabel("full"), BOT_ACCESS_FULL);
  assert.notEqual(BOT_ACCESS_RESTRICTED, BOT_ACCESS_FULL);

  const restricted = BOT_ACCESS_RESTRICTED.toLocaleLowerCase("ru-RU");
  const full = BOT_ACCESS_FULL.toLocaleLowerCase("ru-RU");
  // `restricted` is `bot_can_receive_message`'s narrow branch: only what is
  // addressed to the bot. It must not read as «everything».
  assert.ok(restricted.includes("только"), "the restricted line does not say it is limited");
  assert.ok(!restricted.includes("все сообщения"), "the restricted line reads as full access");
  // `full` is the wide branch, and must not be hedged into sounding limited.
  assert.ok(full.includes("все сообщения"), "the full line does not say it reads everything");
  assert.ok(!full.includes("только"), "the full line reads as limited");
});

test("a row without a privacy mode is read as the narrow one", () => {
  // The column's own default is `restricted`, every live row is in it, and the
  // failure this guards against is a missing or unknown value drawn as «видит
  // все сообщения» — a silent widening on the one line a person would act on.
  for (const value of [undefined, null, "", "unknown", "FULL", 1, {}, ["full"]]) {
    assert.equal(readBotPrivacyMode(value), "restricted", `«${String(value)}» was not read as restricted`);
  }
  // Only the exact string the CHECK admits reads as full.
  assert.equal(readBotPrivacyMode("full"), "full");
  assert.equal(readBotPrivacyMode("restricted"), "restricted");
});

test("the paragraph over the list claims nothing a single bot could contradict", () => {
  // It stands above two rows that are allowed to disagree, so it may only carry
  // the clause every branch of `bot_can_receive_message` shares:
  // `messages.created_at >= chat_bot_members.joined_at`.
  const note = BOT_MEMBERS_HISTORY_NOTE.toLocaleLowerCase("ru-RU");
  assert.ok(note.includes("не видит"), "the paragraph never says what is excluded");
  assert.ok(
    note.includes("до своего добавления") && note.includes("последнего изменения доступа"),
    "the paragraph drops either history boundary",
  );
  // The per-bot claims belong on the rows. A paragraph repeating either of them
  // would be wrong for the other bot in the same group.
  for (const perBot of ["упоминания", "@никнейм", "ответы на его сообщения", "все сообщения"]) {
    assert.ok(
      !note.includes(perBot),
      `the paragraph states «${perBot}», which is true of one bot and not of the next`,
    );
  }
});

test("the invite-time note is untouched, because there it is about one bot being added", () => {
  // `GroupInviteModal` shows `BOT_VISIBILITY_NOTE` while the add is being
  // decided, about a membership `chat_bot_add` hard-codes to `restricted`. That
  // is a decision about one bot, so the long form is right there and stays.
  const note = BOT_VISIBILITY_NOTE.toLocaleLowerCase("ru-RU");
  assert.ok(note.includes("@никнейм"));
  assert.ok(note.includes("историю"));
  assert.notEqual(BOT_VISIBILITY_NOTE, BOT_MEMBERS_HISTORY_NOTE);
});

test("nothing left in this module offers or implies an approval", () => {
  // D-257: «Запрошен полный доступ» was a permanent state that read like a
  // pending one, because no approver existed anywhere. Every word this module
  // can draw is checked, so a sentence added later cannot quietly bring the
  // promise back.
  for (const message of CHAT_BOT_MESSAGES) {
    const text = message.toLocaleLowerCase("ru-RU");
    for (const promise of ["запрос", "одобр", "подтвержд", "рассмотр", "ожида"]) {
      assert.ok(
        !text.includes(promise),
        `«${message}» offers «${promise}», and nothing in this product can answer it`,
      );
    }
  }
});


test("the bot's line in the member list is its status slot: identity, then state", () => {
  // The shape a person's row has one line above — `Владелец группы · был(а)
  // недавно` — so the two read the same way.
  assert.equal(botMemberStatusLine(BOT, "restricted"), "@helper_bot · Видит только обращения к нему");
  assert.equal(botMemberStatusLine(BOT, "full"), "@helper_bot · Видит все сообщения группы");

  // The handle stays, and it is not decoration: this product has no mention
  // autocomplete, `@никнейм` has to be typed for the bot to be delivered
  // anything in a group (D-244), and this row is the only place a member who
  // did not add the bot can read it. Telegram's own status string has no handle
  // because their composer completes it; ours cannot.
  for (const mode of ["restricted", "full"] as const) {
    assert.ok(
      botMemberStatusLine(BOT, mode).startsWith("@helper_bot"),
      "the handle left the one screen a group member can read it from",
    );
    assert.ok(
      botMemberStatusLine(BOT, mode).includes(botAccessLabel(mode)),
      "the status slot stopped carrying the state",
    );
  }

  // The description gives way to the access, even for a bot that has one: a
  // slot that sometimes says what a bot reads and sometimes what it is for is
  // not a status slot. `botSecondaryLine` still carries both, for the screen
  // that picks which bot to add.
  const chatty = { ...BOT, description: "Напоминает о встречах" };
  assert.ok(!botMemberStatusLine(chatty, "restricted").includes("Напоминает"));
  assert.equal(botSecondaryLine(chatty), "@helper_bot · Напоминает о встречах");
});
