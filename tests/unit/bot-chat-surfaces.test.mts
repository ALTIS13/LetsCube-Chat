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
  addressTypedBotCommand,
  botCommandAddress,
  botCommandDraft,
  botCommandMentionRuns,
  botCommandRunText,
  botCommandQuery,
  botCommandSlash,
  botMessageExplainsInternals,
  chooseBotChat,
  chooseChatBot,
  readChatBotMembership,
  classifyBotCallbackFailure,
  isBotPartnerChat,
  matchBotCommands,
  parseBotCommands,
  readBotCommandMention,
  parseBotInlineKeyboard,
  parseBotReplyMarkup,
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

test("an input prompt extends the keyboard without changing its buttons", () => {
  const value = { ...markup([[button("Открыть", "open")]]), input_field_placeholder: "Вставьте ссылку" };
  assert.deepEqual(parseBotReplyMarkup(value), {
    keyboard: [[{ text: "Открыть", callbackData: "open" }]],
    inputFieldPlaceholder: "Вставьте ссылку",
  });
  assert.deepEqual(parseBotInlineKeyboard(value), [[{ text: "Открыть", callbackData: "open" }]]);
  for (const placeholder of ["", "x".repeat(65), 42, null]) {
    assert.equal(parseBotReplyMarkup({ ...value, input_field_placeholder: placeholder }), null);
  }
});

test("the markup accepts only known keys, and not an oversized value", () => {
  assert.equal(
    parseBotInlineKeyboard({ inline_keyboard: [[button("a", "a")]], keyboard: [] }),
    null,
    "unknown top-level keys are refused",
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

const PRIVATE = { chatType: "private", botUsername: "shiftbot" } as const;
const GROUP = { chatType: "group", botUsername: "shiftbot" } as const;

test("choosing a command fills the field and leaves room for an argument", () => {
  const command = { command: "shift", description: "Смена" };
  assert.equal(botCommandSlash(command), "/shift");
  assert.equal(botCommandDraft(command, PRIVATE), "/shift ");
  assert.ok(
    botCommandDraft(command, PRIVATE).endsWith(" "),
    "without the space, «/shift 12» has to be repaired before it can be typed",
  );
  assert.equal(botCommandDraft(command, PRIVATE).includes("\n"), false, "a newline here would send it");
});

// ---------------------------------------------------------------------------
// D-244: a command in a group has to name the bot, or it is never delivered
// ---------------------------------------------------------------------------

/**
 * `private.bot_can_receive_message`'s restricted branch, as Postgres runs it.
 *
 * Both patterns are transcribed from the live function, read off production
 * read-only on 2026-09-19 and byte-identical to
 * `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql`.
 * Postgres lowercases the content first and interpolates the username raw;
 * `bots_username_check` is `^[a-z][a-z0-9_]{4,31}$`, so the username can carry
 * no regex metacharacter and needs no escaping here either.
 *
 * `[[:space:]]` has no JavaScript spelling, so it is written `\s`. The two
 * differ only on characters `\s` also admits — no ASCII character separates
 * them — and every string asserted below was additionally run against the real
 * function on production before this test was written.
 */
function databaseWouldDeliver(content: string, username: string): boolean {
  const lowered = content.toLocaleLowerCase("en-US");
  const asCommand = new RegExp(`^/[a-z][a-z0-9_]{0,31}@${username}(\\s|$)`);
  const asMention = new RegExp(`(^|[^a-z0-9_])@${username}([^a-z0-9_]|$)`);
  return asCommand.test(lowered) || asMention.test(lowered);
}

test("in a group the chosen command names the bot, which is the only form delivered (D-244)", () => {
  const command = { command: "shift", description: "Смена" };
  const draft = botCommandDraft(command, GROUP);
  assert.equal(draft, "/shift@shiftbot ");
  // The composer trims before it sends (`MessageInput.handleSend`), so what
  // the database sees is the trimmed draft. That is the string the rule is
  // measured against.
  assert.equal(
    databaseWouldDeliver(draft.trim(), "shiftbot"),
    true,
    "the delivery rule admits it",
  );
  assert.equal(
    databaseWouldDeliver(`${draft.trim()} завтра`, "shiftbot"),
    true,
    "and still admits it once an argument is typed after the space",
  );
  assert.equal(
    databaseWouldDeliver("/shift", "shiftbot"),
    false,
    "the control: the bare command this used to produce reaches nothing",
  );
  assert.equal(
    databaseWouldDeliver("/shift завтра", "shiftbot"),
    false,
    "and an argument does not rescue it",
  );
});

test("a conversation with the bot is addressed to nobody, because it needs no address", () => {
  const command = { command: "shift", description: "Смена" };
  assert.equal(
    botCommandDraft(command, PRIVATE),
    "/shift ",
    "`chat.type = 'private'` short-circuits the whole restricted branch",
  );
  assert.equal(botCommandAddress(PRIVATE), "");
  assert.equal(botCommandAddress(GROUP), "@shiftbot");
  assert.equal(isBotPartnerChat("private"), true);
  assert.equal(isBotPartnerChat("group"), false);
  assert.equal(isBotPartnerChat("channel"), false);
  assert.equal(isBotPartnerChat(null), false);
  assert.equal(isBotPartnerChat(undefined), false);
});

test("a chat whose type is not known yet is addressed rather than left silent", () => {
  const command = { command: "shift", description: "Смена" };
  // Addressing costs a few characters in a private chat and nothing at all in
  // a group; not addressing costs the whole message in a group. The unknown
  // side is therefore the addressed one.
  assert.equal(botCommandDraft(command, { chatType: null, botUsername: "shiftbot" }), "/shift@shiftbot ");
  assert.equal(botCommandDraft(command, { chatType: undefined, botUsername: "shiftbot" }), "/shift@shiftbot ");
});

test("an unknown username invents none", () => {
  const command = { command: "shift", description: "Смена" };
  assert.equal(botCommandDraft(command, { chatType: "group", botUsername: null }), "/shift ");
  assert.equal(botCommandDraft(command, { chatType: "group", botUsername: "  " }), "/shift ");
  assert.equal(botCommandDraft(command, { chatType: "group", botUsername: undefined }), "/shift ");
});

test("the address ends where the username ends, so a longer name is not answered for", () => {
  const command = { command: "shift", description: "Смена" };
  // `([[:space:]]|$)` after the username is what stops `@botone` matching
  // `@botonetwo`; the client's job is only to write the whole name.
  const draft = botCommandDraft(command, { chatType: "group", botUsername: "botone" }).trim();
  assert.equal(draft, "/shift@botone");
  assert.equal(databaseWouldDeliver(draft, "botone"), true);
  assert.equal(
    databaseWouldDeliver(draft, "botonetwo"),
    false,
    "the other bot in the group is not addressed by a name it merely starts with",
  );
  assert.equal(
    databaseWouldDeliver("/shift@botonetwo", "botone"),
    false,
    "and neither is this one by the longer name",
  );
});

test("the longest command a bot may register still fits the addressed form", () => {
  // `bot_commands.command` is `^[a-z][a-z0-9_]{0,31}$`; the delivery rule reads
  // `^/[a-z][a-z0-9_]{0,31}@`. The two agree at 32 characters and nowhere past
  // it, so the boundary is asserted rather than trusted.
  const longest = "a".repeat(32);
  assert.equal(longest.length, 32);
  const draft = botCommandDraft({ command: longest, description: "Граница" }, GROUP).trim();
  assert.equal(databaseWouldDeliver(draft, "shiftbot"), true);
  assert.equal(
    databaseWouldDeliver(`/${"a".repeat(33)}@shiftbot`, "shiftbot"),
    false,
    "one character more and the database stops recognising it as a command",
  );
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
  const base = { hasBot: true, chatType: "private", currentUserId: ME, historyComplete: true };
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
    "somebody else in the conversation is not this person starting the bot",
  );
});

test("an incomplete history never offers to start a bot", () => {
  assert.equal(
    botChatNeedsStart({ hasBot: true, chatType: "private", currentUserId: ME, messages: [], historyComplete: false }),
    false,
    "older pages unloaded means the chat has been used; there is no column saying otherwise",
  );
});

test("a chat with no bot, and a reader with no session, never show the button", () => {
  assert.equal(botChatNeedsStart({ hasBot: false, chatType: "private", currentUserId: ME, messages: [], historyComplete: true }), false);
  assert.equal(botChatNeedsStart({ hasBot: true, chatType: "private", currentUserId: null, messages: [], historyComplete: true }), false);
});

// ---------------------------------------------------------------------------
// D-243: «Запустить» belongs to a conversation with a bot and nowhere else
// ---------------------------------------------------------------------------

test("a group holding a bot never replaces the composer with «Запустить» (D-243)", () => {
  // Every other fact is the one that made the button appear before 2026-09-19:
  // a bot is in the chat, the whole history is loaded, and this member has been
  // reading rather than writing. In a group that is a reader, not an unstarted
  // bot, and taking the field, the attach button and the recorder away from
  // them is what D-243 records.
  const reading = {
    hasBot: true,
    currentUserId: ME,
    messages: [{ user_id: "22222222-2222-4222-8222-222222222222" }],
    historyComplete: true,
  };
  assert.equal(botChatNeedsStart({ ...reading, chatType: "group" }), false);
  assert.equal(botChatNeedsStart({ ...reading, chatType: "channel" }), false);
  assert.equal(
    botChatNeedsStart({ ...reading, chatType: null }),
    false,
    "a chat whose type is not known yet keeps its composer; nothing is guessed",
  );
  assert.equal(
    botChatNeedsStart({ ...reading, chatType: undefined }),
    false,
    "and neither is an absent one",
  );
  assert.equal(
    botChatNeedsStart({ ...reading, chatType: "private" }),
    true,
    "the control: the same chat as a conversation with the bot still offers it",
  );
});

test("«Запустить» sends exactly the command bots answer to", () => {
  assert.equal(BOT_START_COMMAND, "/start");
  // It carries no address, and may not until the button can appear outside a
  // private chat: `chat.type = 'private'` is what makes a bare `/start`
  // deliverable at all. `botChatNeedsStart` is the guard, so it is asserted
  // here rather than assumed.
  assert.equal(
    botChatNeedsStart({
      hasBot: true,
      chatType: "group",
      currentUserId: ME,
      messages: [],
      historyComplete: true,
    }),
    false,
    "an unaddressed /start must never be reachable from a group",
  );
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
// Which bot a chat holds, and whether it is one worth offering (D-247)
// ---------------------------------------------------------------------------

/**
 * The decision lives here rather than in `useBotChat` for exactly one reason:
 * that hook reaches `import.meta.env` through `createClient` and pulls in
 * supabase-js, so nothing in it can be mutated from a `node --test` process.
 * Moving the decision was cheaper than building a harness around it — the
 * lesson `lib/supabase/config.ts` already carries.
 *
 * `bots.state` is a five-way CHECK: `active`, `paused`, `suspended`,
 * `pending_delete`, `deleted`. `private.bot_can_receive_message` joins the row
 * and requires `= 'active'`, so the other four are bots whose messages are
 * dropped without a word to the sender.
 */
const MEMBER_ROW = {
  bot_id: "33333333-3333-4333-8333-000000000001",
  joined_at: "2026-09-01T10:00:00.000Z",
  removed_at: null,
  bot: { username: "shiftbot", state: "active" },
};

test("a membership with an active bot is read, with the username from the same row", () => {
  const row = readChatBotMembership(MEMBER_ROW);
  assert.equal(row?.botId, MEMBER_ROW.bot_id);
  assert.equal(row?.username, "shiftbot");
  assert.equal(row?.joinedAt, MEMBER_ROW.joined_at);
});

test("PostgREST answering the embed as an array of one is read the same way", () => {
  // Some versions do. Guessing wrong turns every bot chat into a chat with no
  // bot, which is why `fetchChatBots` reads both shapes too.
  const row = readChatBotMembership({ ...MEMBER_ROW, bot: [MEMBER_ROW.bot] });
  assert.equal(row?.username, "shiftbot");
});

test("a bot in any state but active is no bot at all here", () => {
  // The composer would otherwise offer commands the authoriser refuses in
  // silence: they send, and nothing arrives.
  for (const state of ["paused", "suspended", "pending_delete", "deleted"]) {
    assert.equal(
      readChatBotMembership({ ...MEMBER_ROW, bot: { username: "shiftbot", state } }),
      null,
      `a ${state} bot was still offered`,
    );
  }
  // Fail closed rather than open: a row that did not carry the column is not a
  // row that proved the bot deliverable, and the same rule is what `readBot` in
  // `chatBotMembership.ts` applies to the sidebar's «Бот» mark.
  assert.equal(readChatBotMembership({ ...MEMBER_ROW, bot: { username: "shiftbot" } }), null);
  assert.equal(readChatBotMembership({ ...MEMBER_ROW, bot: { username: "shiftbot", state: null } }), null);
  assert.equal(readChatBotMembership({ ...MEMBER_ROW, bot: null }), null, "and a row with no bot embedded");
  assert.equal(readChatBotMembership({ ...MEMBER_ROW, bot_id: null }), null);
  assert.equal(readChatBotMembership(null), null);
});

test("the chat speaks to the bot that joined first, and skips the ones it cannot reach", () => {
  const first = { ...MEMBER_ROW, joined_at: "2026-09-01T10:00:00.000Z" };
  const later = {
    bot_id: "33333333-3333-4333-8333-000000000002",
    joined_at: "2026-09-02T10:00:00.000Z",
    removed_at: null,
    bot: { username: "secondbot", state: "active" },
  };
  assert.equal(chooseChatBot([later, first])?.username, "shiftbot");

  // The one that joined first being disabled must not empty the menu of a
  // group that still holds a live bot — the filter picks, it does not truncate.
  assert.equal(
    chooseChatBot([{ ...first, bot: { username: "shiftbot", state: "paused" } }, later])?.username,
    "secondbot",
  );

  // Two memberships written in one transaction share a timestamp; the username
  // breaks the tie so the same bot answers on every load rather than whichever
  // row Postgres handed back that time.
  const sameInstant = { ...later, joined_at: first.joined_at };
  assert.equal(chooseChatBot([sameInstant, first])?.username, "secondbot");
  assert.equal(chooseChatBot([first, sameInstant])?.username, "secondbot");

  assert.equal(chooseChatBot([]), null);
  assert.equal(chooseChatBot(null), null, "a failed read is a chat with no bot, not a crash");
  assert.equal(
    chooseChatBot([{ ...first, bot: { username: "shiftbot", state: "deleted" } }]),
    null,
    "the only bot in the chat being deleted leaves an ordinary composer",
  );
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
  assert.equal(BOT_CALLBACK_DONE, "Запрос передан боту");
});

// ---------------------------------------------------------------------------
// A command already in the conversation, and one typed whole (D-263)
// ---------------------------------------------------------------------------
//
// Every boundary below is `private.bot_can_receive_message`'s own, not the Bot
// API's prose. Its restricted branch is
//
//   lower(content) ~ '^/[a-z][a-z0-9_]{0,31}@' || username || '([[:space:]]|$)'
//
// so the anchor is position 0, the terminator is whitespace or end of string,
// and the whole content is lowered before the match. A reader of a command that
// answered differently from that function would draw a control the server then
// refuses, which is the shape this register keeps re-filing.

const SHIFT_COMMANDS = [
  { command: "shift", description: "Ближайшая смена" },
  { command: "shifts", description: "Все смены" },
];
const IN_GROUP = { chatType: "group", botUsername: "shiftbot" };
const IN_PRIVATE = { chatType: "private", botUsername: "shiftbot" };

test("a command token is read exactly where the authoriser would look for one", () => {
  assert.deepEqual(readBotCommandMention("/shift"), { command: "shift", address: null, length: 6 });
  assert.deepEqual(readBotCommandMention("/shift 12"), { command: "shift", address: null, length: 6 });
  assert.deepEqual(readBotCommandMention("/shift@shiftbot"), {
    command: "shift",
    address: "shiftbot",
    length: 15,
  });
  assert.deepEqual(readBotCommandMention("/shift@shiftbot 12"), {
    command: "shift",
    address: "shiftbot",
    length: 15,
  });

  // Lowered, because the function lowers the content before it matches.
  assert.deepEqual(readBotCommandMention("/SHIFT@ShiftBot"), {
    command: "shift",
    address: "shiftbot",
    length: 15,
  });

  // `/shiftmore` is a command called «shiftmore», not «shift» with a tail: the
  // authoriser's terminator is `([[:space:]]|$)`, so the name runs to the end.
  assert.deepEqual(readBotCommandMention("/shiftmore"), {
    command: "shiftmore",
    address: null,
    length: 10,
  });
});

test("what is not a command is not read as one", () => {
  assert.equal(readBotCommandMention("/shift,"), null, "a comma is not the authoriser's terminator");
  assert.equal(readBotCommandMention("/shift."), null);
  assert.equal(readBotCommandMention(" /shift"), null, "the anchor is position 0");
  assert.equal(readBotCommandMention("привет /shift"), null);
  assert.equal(readBotCommandMention("/"), null, "a slash alone names nothing");
  assert.equal(readBotCommandMention("/1shift"), null, "a command starts with a letter");
  assert.equal(readBotCommandMention("//shift"), null);
  assert.equal(readBotCommandMention("/shift@"), null, "an address that names nobody is not the bare form");
  assert.equal(readBotCommandMention("/shift@ab"), null, "a username is at least five characters");
  assert.equal(readBotCommandMention("/shift@shiftbot!"), null);
  assert.equal(readBotCommandMention(""), null);
  assert.equal(
    readBotCommandMention(`/${"a".repeat(33)}`),
    null,
    "a command is at most 32 characters, exactly as the CHECK says",
  );
  assert.deepEqual(readBotCommandMention(`/${"a".repeat(32)}`), {
    command: "a".repeat(32),
    address: null,
    length: 33,
  });
});

test("a command runs only when this chat's bot answers to it", () => {
  const bare = readBotCommandMention("/shift")!;
  const addressed = readBotCommandMention("/shift@shiftbot")!;
  const other = readBotCommandMention("/shift@otherbot")!;
  const unknown = readBotCommandMention("/lol")!;

  assert.equal(botCommandMentionRuns(bare, SHIFT_COMMANDS, IN_GROUP), true);
  assert.equal(botCommandMentionRuns(addressed, SHIFT_COMMANDS, IN_GROUP), true);
  assert.equal(
    botCommandMentionRuns(other, SHIFT_COMMANDS, IN_GROUP),
    false,
    "a message addressed to another bot is that bot's, and this one never sees it",
  );
  assert.equal(
    botCommandMentionRuns(unknown, SHIFT_COMMANDS, IN_GROUP),
    false,
    "a command nothing registered would be a pressable control with nothing behind it",
  );
  assert.equal(botCommandMentionRuns(bare, [], IN_GROUP), false);
  assert.equal(
    botCommandMentionRuns(addressed, SHIFT_COMMANDS, { chatType: "group", botUsername: null }),
    false,
    "without a username there is nothing to compare the address against",
  );
  assert.equal(
    botCommandMentionRuns(addressed, SHIFT_COMMANDS, { chatType: "group", botUsername: "  ShiftBot " }),
    true,
    "the username is compared lowered and trimmed, as the authoriser has it",
  );
});

test("pressing a command sends the token, and in a group it names the bot", () => {
  const bare = readBotCommandMention("/shift 12")!;
  assert.equal(
    botCommandRunText(bare, IN_GROUP),
    "/shift@shiftbot",
    "the token is what was pressed; the argument beside it was not",
  );
  assert.equal(botCommandRunText(bare, IN_PRIVATE), "/shift");
  const addressed = readBotCommandMention("/shift@shiftbot")!;
  assert.equal(botCommandRunText(addressed, IN_GROUP), "/shift@shiftbot", "addressed once, not twice");
});

test("a command typed whole in a group is addressed rather than dropped", () => {
  assert.equal(addressTypedBotCommand("/shift", IN_GROUP, SHIFT_COMMANDS), "/shift@shiftbot");
  assert.equal(
    addressTypedBotCommand("/shift 12", IN_GROUP, SHIFT_COMMANDS),
    "/shift@shiftbot 12",
    "the argument survives, and the authoriser's own terminator is what makes that form deliverable",
  );
  assert.equal(
    addressTypedBotCommand("/SHIFT", IN_GROUP, SHIFT_COMMANDS),
    "/SHIFT@shiftbot",
    "the words stay the person's; only the address is added",
  );
});

test("the three refusals that keep the address from rewriting what people wrote", () => {
  assert.equal(
    addressTypedBotCommand("/lol", IN_GROUP, SHIFT_COMMANDS),
    "/lol",
    "a command the bot never registered stays a joke",
  );
  assert.equal(
    addressTypedBotCommand("привет /shift", IN_GROUP, SHIFT_COMMANDS),
    "привет /shift",
    "position 0 is the only place the authoriser looks",
  );
  assert.equal(
    addressTypedBotCommand("/shift@otherbot", IN_GROUP, SHIFT_COMMANDS),
    "/shift@otherbot",
    "somebody who named a bot meant that bot",
  );
  assert.equal(
    addressTypedBotCommand("/shift@shiftbot", IN_GROUP, SHIFT_COMMANDS),
    "/shift@shiftbot",
    "addressed once",
  );
});

test("nothing is addressed where the authoriser does not require it", () => {
  assert.equal(
    addressTypedBotCommand("/shift", IN_PRIVATE, SHIFT_COMMANDS),
    "/shift",
    "a private chat short-circuits the branch; an address there is noise in front of the bot's parser",
  );
  assert.equal(
    addressTypedBotCommand("/shift", { chatType: "group", botUsername: null }, SHIFT_COMMANDS),
    "/shift",
    "no username, no address invented",
  );
  assert.equal(addressTypedBotCommand("/shift", { chatType: "group", botUsername: "shiftbot" }, []), "/shift");
  assert.equal(addressTypedBotCommand("обычное сообщение", IN_GROUP, SHIFT_COMMANDS), "обычное сообщение");
  assert.equal(addressTypedBotCommand("", IN_GROUP, SHIFT_COMMANDS), "");
});

test("the address a command gets is the one the menu already writes", () => {
  // One rule, two doors. If these ever disagree, the person who types a command
  // and the person who picks it from the menu reach different bots.
  const [first] = SHIFT_COMMANDS;
  assert.equal(
    addressTypedBotCommand(`/${first.command}`, IN_GROUP, SHIFT_COMMANDS),
    botCommandDraft(first, IN_GROUP).trimEnd(),
  );
});
