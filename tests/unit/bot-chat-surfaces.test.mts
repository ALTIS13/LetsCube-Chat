// What a bot offers, and what the client is allowed to draw of it
// (D-125, D-126, D-127).
//
// Every limit asserted here was read off
// `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql`
// rather than from the Bot API's zod schemas, because the database is the last
// gate a row passes and the two do not agree everywhere:
//
//   - `private.bot_inline_keyboard_valid` counts the keys of each button and
//     requires exactly two, named `text` and `callback_data`. A `{text, url}`
//     button — which both the register's D-125 proposal and
//     `pages/public/BotDocsPage.tsx` mention — cannot be stored at all.
//   - Postgres `length()` counts characters; zod's `.max(64)` counts UTF-16
//     units. For a string of astral characters zod is the stricter of the two,
//     so anything the API server accepts the database accepts. The parser
//     follows the database.
//
// The module under test imports only `plainMessages.ts`, which imports nothing,
// so all of this runs in a bare `node --test` process with no bundler and no
// browser.
import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_CALLBACK_DONE,
  BOT_CALLBACK_FAILED,
  BOT_CALLBACK_REFUSED,
  BOT_CALLBACK_UNAVAILABLE,
  BOT_START_COMMAND,
  BOT_SURFACE_MESSAGES,
  botButtonKey,
  botCallbackFailureMessage,
  botChatNeedsStart,
  botCommandDraft,
  botCommandQuery,
  botCommandSlash,
  botMessageExplainsInternals,
  chooseBotChat,
  classifyBotCallbackFailure,
  matchBotCommands,
  parseBotCommands,
  parseBotInlineKeyboard,
} from "../../artifacts/kub/src/lib/botChatSurfaces.ts";

const button = (text: string, data: string) => ({ text, callback_data: data });
const markup = (rows: unknown[][]) => ({ inline_keyboard: rows });

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

test("a keyboard is drawn in the rows and the order the bot laid out", () => {
  const parsed = parseBotInlineKeyboard(
    markup([
      [button("Да", "shift:yes"), button("Нет", "shift:no")],
      [button("Отложить", "shift:later")],
    ]),
  );
  assert.deepEqual(parsed, [
    [
      { text: "Да", callbackData: "shift:yes" },
      { text: "Нет", callbackData: "shift:no" },
    ],
    [{ text: "Отложить", callbackData: "shift:later" }],
  ]);
});

test("a URL button is refused, because the database cannot hold one", () => {
  // `bot_inline_keyboard_valid` requires exactly two keys and both of them
  // named. Drawing this would be drawing a shape no bot can send.
  assert.equal(parseBotInlineKeyboard(markup([[{ text: "Открыть", url: "https://example.invalid" }]])), null);
  assert.equal(
    parseBotInlineKeyboard(markup([[{ text: "Открыть", callback_data: "x", url: "https://example.invalid" }]])),
    null,
    "a third key is a third key even when the two required ones are there",
  );
});

test("a keyboard with an unnamed or mistyped button is refused whole", () => {
  assert.equal(parseBotInlineKeyboard(markup([[{ text: "Да", data: "yes" }]])), null);
  assert.equal(parseBotInlineKeyboard(markup([[{ text: 1, callback_data: "yes" }]])), null);
  assert.equal(parseBotInlineKeyboard(markup([[{ text: "Да", callback_data: 1 }]])), null);
  assert.equal(
    parseBotInlineKeyboard(markup([[button("Да", "yes")], [button("Нет", "")]])),
    null,
    "one unusable button loses the whole keyboard; half a question is worse than none",
  );
});

test("rows and buttons are between one and eight", () => {
  const row = [button("a", "a")];
  assert.notEqual(parseBotInlineKeyboard(markup([row, row, row, row, row, row, row, row])), null);
  assert.equal(parseBotInlineKeyboard(markup([])), null);
  assert.equal(parseBotInlineKeyboard(markup([row, row, row, row, row, row, row, row, row])), null);
  assert.equal(parseBotInlineKeyboard(markup([[]])), null);
  const eight = Array.from({ length: 8 }, (_, index) => button(`b${index}`, `b${index}`));
  assert.notEqual(parseBotInlineKeyboard(markup([eight])), null);
  assert.equal(parseBotInlineKeyboard(markup([[...eight, button("b8", "b8")]])), null);
});

test("text is 1..64 characters and callback_data 1..128, counted as Postgres counts them", () => {
  assert.notEqual(parseBotInlineKeyboard(markup([[button("x".repeat(64), "d")]])), null);
  assert.equal(parseBotInlineKeyboard(markup([[button("x".repeat(65), "d")]])), null);
  assert.notEqual(parseBotInlineKeyboard(markup([[button("t", "d".repeat(128))]])), null);
  assert.equal(parseBotInlineKeyboard(markup([[button("t", "d".repeat(129))]])), null);
  // 64 emoji are 64 characters to Postgres and 128 UTF-16 units to zod. The
  // database is the gate the row actually passed, so this is accepted.
  assert.notEqual(parseBotInlineKeyboard(markup([[button("🙂".repeat(64), "d")]])), null);
  assert.equal(parseBotInlineKeyboard(markup([[button("🙂".repeat(65), "d")]])), null);
});

test("the markup is exactly one key, and not an oversized one", () => {
  assert.equal(
    parseBotInlineKeyboard({ inline_keyboard: [[button("a", "a")]], keyboard: [] }),
    null,
    "a second top-level key is refused, as jsonb_object_keys counting one is",
  );
  assert.equal(parseBotInlineKeyboard({ keyboard: [[button("a", "a")]] }), null);
  const fat = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => button("я".repeat(64), "д".repeat(128))),
  );
  assert.ok(new TextEncoder().encode(JSON.stringify(markup(fat))).length > 16384);
  assert.equal(parseBotInlineKeyboard(markup(fat)), null);
});

test("anything that is not a markup object is nothing to draw", () => {
  for (const value of [null, undefined, 0, "", "{}", [], [[button("a", "a")]], true]) {
    assert.equal(parseBotInlineKeyboard(value), null, `${JSON.stringify(value)} parsed as a keyboard`);
  }
});

test("a button is identified by where it is, never by what it says", () => {
  // Two buttons may carry the same words and the same data and mean different
  // things; the pending state has to follow the one that was pressed.
  assert.equal(botButtonKey(0, 0), "0:0");
  assert.equal(botButtonKey(1, 0), "1:0");
  assert.notEqual(botButtonKey(0, 1), botButtonKey(1, 0));
});

// ---------------------------------------------------------------------------
// Why a press failed
// ---------------------------------------------------------------------------

test("a door that is not there is told apart from a press that was refused", () => {
  assert.equal(classifyBotCallbackFailure({ code: "PGRST202" }), "missing");
  assert.equal(classifyBotCallbackFailure({ code: "42883" }), "missing");
  assert.equal(
    classifyBotCallbackFailure({ message: "Could not find the function public.bot_callback_press" }),
    "missing",
  );
  assert.equal(classifyBotCallbackFailure({ code: "42501" }), "refused");
  assert.equal(classifyBotCallbackFailure({ message: "permission denied for function" }), "refused");
  assert.equal(classifyBotCallbackFailure({ code: "08006", message: "network" }), "failed");
  assert.equal(classifyBotCallbackFailure(null), "failed");
  assert.equal(classifyBotCallbackFailure(undefined), "failed");
});

test("the sentence for a press matches the reason, and only one of them takes the server's words", () => {
  assert.equal(botCallbackFailureMessage("missing", "function does not exist"), BOT_CALLBACK_UNAVAILABLE);
  assert.equal(botCallbackFailureMessage("refused", "permission denied"), BOT_CALLBACK_REFUSED);
  assert.equal(botCallbackFailureMessage("failed"), BOT_CALLBACK_FAILED);
  assert.equal(
    botCallbackFailureMessage("failed", "Сессия не найдена. Войдите снова."),
    "Сессия не найдена. Войдите снова.",
    "a failure somebody can act on is worth more than the generic sentence",
  );
  assert.equal(
    botCallbackFailureMessage("failed", "не удалось прочитать таблицу messages"),
    BOT_CALLBACK_FAILED,
    "a server sentence naming an internal is replaced, not shown",
  );
});

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

test("commands keep the order they arrive in", () => {
  const parsed = parseBotCommands([
    { command: "start", description: "Начать" },
    { command: "about", description: "О боте" },
  ]);
  assert.deepEqual(
    parsed.map((entry) => entry.command),
    ["start", "about"],
    "sorting here would overrule the only ordering decision a bot author can make",
  );
});

test("a row the table's own CHECKs would refuse is not shown", () => {
  const parsed = parseBotCommands([
    { command: "ok_1", description: "  Годится  " },
    { command: "1bad", description: "starts with a digit" },
    { command: "Bad", description: "uppercase" },
    { command: "x".repeat(33), description: "too long" },
    { command: "", description: "empty" },
    { command: "nodesc", description: "   " },
    { command: "longdesc", description: "d".repeat(257) },
    { command: "notstring", description: 5 },
    "not an object",
  ]);
  assert.deepEqual(parsed, [{ command: "ok_1", description: "Годится" }]);
});

test("a duplicate command keeps the first", () => {
  const parsed = parseBotCommands([
    { command: "start", description: "Первое" },
    { command: "start", description: "Второе" },
  ]);
  assert.deepEqual(parsed, [{ command: "start", description: "Первое" }]);
});

test("nothing readable is an empty list, never a throw", () => {
  assert.deepEqual(parseBotCommands(null), []);
  assert.deepEqual(parseBotCommands(undefined), []);
  assert.deepEqual(parseBotCommands({}), []);
});

test("choosing a command fills the field and leaves room for an argument", () => {
  const command = { command: "shift", description: "Смена" };
  assert.equal(botCommandSlash(command), "/shift");
  assert.equal(botCommandDraft(command), "/shift ");
  assert.ok(
    botCommandDraft(command).endsWith(" "),
    "without the space, «/shift 12» has to be repaired before it can be typed",
  );
  assert.equal(botCommandDraft(command).includes("\n"), false, "a newline here would send it");
});

test("«/» asks only while the whole field is one unfinished command", () => {
  assert.equal(botCommandQuery("/"), "");
  assert.equal(botCommandQuery("/pi"), "pi");
  assert.equal(botCommandQuery("/PI"), "pi");
  assert.equal(botCommandQuery("  /pi"), "pi");
  assert.equal(botCommandQuery("/ping "), null, "a command with an argument has finished asking");
  assert.equal(botCommandQuery("/ping\n"), null);
  assert.equal(botCommandQuery("привет /pi"), null, "a slash inside a sentence is a slash");
  assert.equal(botCommandQuery(""), null);
  assert.equal(botCommandQuery("ping"), null);
});

test("«/» filters by the name's prefix, in the bot's order", () => {
  const commands = [
    { command: "ping", description: "Проверка" },
    { command: "pause", description: "Пауза" },
    { command: "about", description: "ping это проверка" },
  ];
  assert.deepEqual(matchBotCommands(commands, null), []);
  assert.deepEqual(matchBotCommands(commands, ""), commands);
  assert.deepEqual(
    matchBotCommands(commands, "p").map((entry) => entry.command),
    ["ping", "pause"],
    "the bot's order, not an alphabetical one",
  );
  assert.deepEqual(
    matchBotCommands(commands, "ing").map((entry) => entry.command),
    [],
    "prefix, not substring: it is how a command is typed",
  );
  assert.deepEqual(
    matchBotCommands(commands, "ping").map((entry) => entry.command),
    ["ping"],
    "a description is not searched; «about» mentions ping and must not answer",
  );
});

// ---------------------------------------------------------------------------
// Starting a bot, and opening one
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-111111111111";

test("«Запустить» stands in for the composer until the person has said something", () => {
  const base = { hasBot: true, currentUserId: ME, historyComplete: true };
  assert.equal(botChatNeedsStart({ ...base, messages: [] }), true);
  assert.equal(
    botChatNeedsStart({ ...base, messages: [{ user_id: null }, { user_id: null }] }),
    true,
    "a bot greeting first is not the person having started it",
  );
  assert.equal(botChatNeedsStart({ ...base, messages: [{ user_id: ME }] }), false);
  assert.equal(
    botChatNeedsStart({ ...base, messages: [{ user_id: "22222222-2222-4222-8222-222222222222" }] }),
    true,
    "somebody else writing in a group the bot is in is not this person starting it",
  );
});

test("an incomplete history never offers to start a bot", () => {
  assert.equal(
    botChatNeedsStart({ hasBot: true, currentUserId: ME, messages: [], historyComplete: false }),
    false,
    "older pages unloaded means the chat has been used; there is no column saying otherwise",
  );
});

test("a chat with no bot, and a reader with no session, never show the button", () => {
  assert.equal(botChatNeedsStart({ hasBot: false, currentUserId: ME, messages: [], historyComplete: true }), false);
  assert.equal(botChatNeedsStart({ hasBot: true, currentUserId: null, messages: [], historyComplete: true }), false);
});

test("«Запустить» sends exactly the command bots answer to", () => {
  assert.equal(BOT_START_COMMAND, "/start");
});

test("a bot opens the chat the reader is in, and a private one before a group", () => {
  const candidates = [
    { chatId: "group", type: "group" },
    { chatId: "direct", type: "private" },
  ];
  assert.equal(chooseBotChat(candidates, new Set(["group", "direct"])), "direct");
  assert.equal(chooseBotChat(candidates, new Set(["group"])), "group");
  assert.equal(
    chooseBotChat(candidates, new Set()),
    null,
    "an owner sees every chat their bot is in; opening one they are not in is not on offer",
  );
  assert.equal(chooseBotChat([], new Set(["direct"])), null);
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test("no sentence on these surfaces explains the machine", () => {
  const offenders = BOT_SURFACE_MESSAGES.filter((message) => botMessageExplainsInternals(message));
  assert.deepEqual(offenders, [], "a sentence here names a table, a function or a migration");
});

test("every sentence is one the person is meant to read", () => {
  for (const message of BOT_SURFACE_MESSAGES) {
    assert.ok(message.trim().length > 0, "an empty sentence reaches the screen as silence");
    assert.equal(message, message.trim());
  }
  assert.equal(BOT_CALLBACK_DONE, "Готово");
});
