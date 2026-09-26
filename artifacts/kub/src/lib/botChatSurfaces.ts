/**
 * What a bot offers, and how the client decides to show it (D-125, D-126, D-127).
 *
 * The three register entries are one gap seen three ways: a bot can be talked
 * to, and almost nothing it offers reaches the person it is offering it to. An
 * inline keyboard is stored and never drawn, commands are stored and never
 * listed, and a bot found in search leads to a modal saying it cannot be
 * opened. The words and the decisions behind all three live here.
 *
 * Its only import is `plainMessages.ts`, which imports nothing either — the
 * arrangement `personalModeration.ts` and `serverChannels.ts` use, and for the
 * same reason: a decision made of words has no business pulling React into a
 * `node --test` process, and a check that cannot be reached from a test is a
 * gap in the module boundary rather than a gap in the suite.
 *
 * Four facts about the shipped schema are load-bearing here. Each was read off
 * `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql`,
 * which CLAUDE.md records as byte-identical to what was applied, rather than
 * assumed from the Bot API's own types:
 *
 *   1. **A button is exactly `{text, callback_data}` and nothing else.**
 *      `private.bot_inline_keyboard_valid` counts the keys of each button and
 *      refuses anything but two, then requires both of those names. A URL
 *      button — `{text, url}` — cannot be stored, so it cannot arrive, so
 *      `parseBotInlineKeyboard` refuses it rather than drawing a shape the
 *      product has no way to produce. The register's proposal and the public
 *      bot documentation both mention URL buttons; the database does not allow
 *      one, and this module follows the database.
 *   2. **Rows and buttons are 1..8, text 1..64, callback_data 1..128**, and the
 *      whole markup at most 16384 bytes. The same function again.
 *   3. **`public.bot_commands` is readable by an ordinary account** —
 *      `grant select … to authenticated`, under the policy «members and owners
 *      read bot commands», which allows it to whoever owns the bot or shares a
 *      live chat with it. So the command menu needs nothing new from the
 *      server, and it is only reachable once the person is already in a chat
 *      with the bot.
 *   4. **A button press and its answer have different authorities.**
 *      `bot_callback_press` takes `auth.uid()` and returns a callback UUID;
 *      the internal queue writer stays service-only. The answer stays in
 *      `private.bot_callback_answers`, with only the pressing account allowed
 *      to retrieve it through `bot_callback_answer_for_actor`. Both client
 *      calls tolerate a server that has not taken the corresponding migration.
 */

import { INTERNALS_PATTERN, plainFailure } from "./plainMessages.ts";

// ---------------------------------------------------------------------------
// The inline keyboard (D-125)
// ---------------------------------------------------------------------------

export interface BotInlineButton {
  readonly text: string;
  readonly callbackData: string;
}

export type BotInlineKeyboard = readonly (readonly BotInlineButton[])[];

/** `jsonb_array_length(...) not between 1 and 8`, for rows and for buttons. */
const MIN_KEYBOARD_ROWS = 1;
const MAX_KEYBOARD_ROWS = 8;
const MIN_ROW_BUTTONS = 1;
const MAX_ROW_BUTTONS = 8;
/** `length(v_button->>'text') not between 1 and 64`. Postgres counts characters. */
const MAX_BUTTON_TEXT = 64;
/** `length(v_button->>'callback_data') not between 1 and 128`. */
const MAX_CALLBACK_DATA = 128;
/** `octet_length(p_markup::text) > 16384`. */
const MAX_MARKUP_BYTES = 16384;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Postgres `length()` counts characters, not UTF-16 units.
 *
 * The Bot API's zod schema uses `.max(64)`, which counts UTF-16 units and is
 * therefore the stricter of the two for anything outside the basic plane. The
 * database is the last gate a row passes, so this mirrors the database; the
 * disagreement is recorded rather than reconciled, because reconciling it means
 * changing the API server, which this change does not own.
 */
function characterLength(value: string): number {
  return Array.from(value).length;
}

/**
 * The byte size of the markup, as close as a browser can measure it.
 *
 * Deliberately not the same number Postgres checked: `octet_length(x::text)`
 * measures jsonb's own canonical rendering — its key order, its spacing — and
 * `JSON.stringify` measures ours. The two differ by a handful of bytes. This is
 * a refusal of the absurd, not a second enforcement of the constraint: the row
 * already passed the trigger, and what this catches is a row written before the
 * trigger existed.
 */
function markupByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function parseButton(value: unknown): BotInlineButton | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  // Exactly two, both named. A `url` button fails here, which is the point.
  if (keys.length !== 2) return null;
  const text = value.text;
  const callbackData = value.callback_data;
  if (typeof text !== "string" || typeof callbackData !== "string") return null;
  const textLength = characterLength(text);
  const dataLength = characterLength(callbackData);
  if (textLength < 1 || textLength > MAX_BUTTON_TEXT) return null;
  if (dataLength < 1 || dataLength > MAX_CALLBACK_DATA) return null;
  return { text, callbackData };
}

/**
 * `messages.bot_reply_markup` as rows of buttons, or null.
 *
 * Null for everything that is not exactly the one shape the database stores —
 * absent, the wrong type, an extra key beside `inline_keyboard`, an empty row,
 * a ninth button, a button carrying anything but `text` and `callback_data`.
 * There is no partial result: a keyboard the product cannot have produced is
 * not drawn at all, because half of a bot's question is worse than none of it.
 */
export function parseBotInlineKeyboard(value: unknown): BotInlineKeyboard | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "inline_keyboard") return null;
  if (markupByteLength(value) > MAX_MARKUP_BYTES) return null;
  const rows = value.inline_keyboard;
  if (!Array.isArray(rows)) return null;
  if (rows.length < MIN_KEYBOARD_ROWS || rows.length > MAX_KEYBOARD_ROWS) return null;

  const parsed: BotInlineButton[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return null;
    if (row.length < MIN_ROW_BUTTONS || row.length > MAX_ROW_BUTTONS) return null;
    const buttons: BotInlineButton[] = [];
    for (const button of row) {
      const parsedButton = parseButton(button);
      if (!parsedButton) return null;
      buttons.push(parsedButton);
    }
    parsed.push(buttons);
  }
  return parsed;
}

/**
 * Which button a press is about, when several carry the same words.
 *
 * A bot may lay out «Да» twice in two rows and mean different things by them,
 * so the identity of a button is its position, never its text and never its
 * `callback_data`: two buttons are allowed to send the same data.
 */
export function botButtonKey(rowIndex: number, buttonIndex: number): string {
  return `${rowIndex}:${buttonIndex}`;
}

// ---------------------------------------------------------------------------
// Delivering a press (D-125)
// ---------------------------------------------------------------------------

/**
 * Why a press did not reach the bot.
 *
 *   - `missing` — the door is not there. Nothing about this bot, this chat or
 *     this person; the deployment has no `bot_callback_press`. It is the same
 *     state for every keyboard on the screen, so the surface remembers it.
 *   - `refused` — the door is there and said no to this press. About this press
 *     alone, so nothing else is switched off.
 *   - `failed` — anything else, including a dead network. Worth pressing again.
 */
export type BotCallbackFailure = "missing" | "refused" | "failed";

export function classifyBotCallbackFailure(
  error: { code?: unknown; message?: unknown; details?: unknown } | null | undefined,
): BotCallbackFailure {
  const text = `${String(error?.code ?? "")} ${String(error?.message ?? "")} ${String(error?.details ?? "")}`
    .toLocaleLowerCase("en-US");
  // PostgREST answers PGRST202 for a function it cannot find in the schema
  // cache, Postgres 42883 for one that does not exist. Both mean the wrapper
  // was never created.
  if (
    text.includes("pgrst202") ||
    text.includes("42883") ||
    text.includes("could not find the function") ||
    text.includes("does not exist")
  ) {
    return "missing";
  }
  // 42501 is the grant, or a check inside the function. Either way this press,
  // not every press.
  if (text.includes("42501") || text.includes("permission denied")) return "refused";
  return "failed";
}

// ---------------------------------------------------------------------------
// The command menu, and «/» (D-126)
// ---------------------------------------------------------------------------

export interface BotCommand {
  /** Without the slash, exactly as `bot_commands.command` holds it. */
  readonly command: string;
  readonly description: string;
}

/** `bot_commands` CHECK: `^[a-z][a-z0-9_]{0,31}$`, written without a regex. */
function isCommandName(value: string): boolean {
  if (value.length < 1 || value.length > 32) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const lower = code >= 97 && code <= 122;
    const digit = code >= 48 && code <= 57;
    const underscore = code === 95;
    if (index === 0 ? !lower : !(lower || digit || underscore)) return false;
  }
  return true;
}

/** How long a description may be, from the same table's CHECK. */
const MAX_COMMAND_DESCRIPTION = 256;

/**
 * The rows of `public.bot_commands`, in the order they arrive.
 *
 * The order is the bot's, not ours: `setMyCommands` replaces the whole set and
 * `sort_order` records where each one stood, so the read asks for that column
 * and this function preserves what it is handed. Re-sorting alphabetically here
 * would silently overrule the only ordering decision a bot author can make.
 * Rows that do not match the table's own CHECKs are dropped rather than shown,
 * and a duplicate name keeps the first — a menu listing «/start» twice is a menu
 * nobody trusts.
 */
export function parseBotCommands(rows: unknown): readonly BotCommand[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const parsed: BotCommand[] = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const command = row.command;
    const description = row.description;
    if (typeof command !== "string" || typeof description !== "string") continue;
    if (!isCommandName(command)) continue;
    const trimmed = description.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_COMMAND_DESCRIPTION) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    parsed.push({ command, description: trimmed });
  }
  return parsed;
}

/** «/ping», as the menu writes it. The field may need more — see below. */
export function botCommandSlash(command: BotCommand): string {
  return `/${command.command}`;
}

/**
 * The two facts that decide whether a command has to name the bot (D-244).
 *
 * Both come from the chat that is open: `chats.type`, and the username of the
 * bot whose commands are being offered. The username is deliberately read
 * beside the commands rather than taken from the chat list the sidebar already
 * holds — a bot that has been renamed since that list was fetched would be
 * addressed under a name the delivery rule no longer matches, and the failure
 * is silent.
 */
export interface BotChatAddressing {
  readonly chatType: string | null | undefined;
  /** `bots.username`, of the bot these commands belong to. */
  readonly botUsername: string | null | undefined;
}

/**
 * Whether this is a conversation **with** the bot rather than a room that
 * merely contains one — the same line `chatBotPartner` draws in `chatBots.ts`,
 * restated here because this module imports nothing.
 *
 * It is the fact four surfaces were missing until 2026-09-19, when
 * `chat_bot_add` first made a bot in a group possible: the «Запустить» screen,
 * the command menu, the typed «/» list and the command load all read «this chat
 * holds a bot» and acted as though it read «this chat is a bot».
 */
export function isBotPartnerChat(chatType: string | null | undefined): boolean {
  return chatType === "private";
}

/**
 * «@shiftbot», or nothing at all.
 *
 * Read off `private.bot_can_receive_message`, and measured against the live
 * function on 2026-09-19 rather than inferred from it. A membership created by
 * `chat_bot_add` is always `restricted` — `privacy_mode` defaults to it and
 * `chat_bot_members_visibility_approval_check` forbids `full` without an
 * approver — and the restricted branch admits a message only when
 *
 *   `lower(content) ~ '^/[a-z][a-z0-9_]{0,31}@' || username || '([[:space:]]|$)'`
 *
 * or the text mentions `@username`, or it replies to the bot's own message.
 * A bare `/shift` matches none of the three. `chat.type = 'private'`
 * short-circuits the whole branch, which is why a private chat addresses
 * nothing: there `/shift@shiftbot` would only be noise in front of a bot whose
 * own parser may not strip it.
 *
 * What the regex tolerates, measured: any argument after a space, any case
 * (the content is lowered first), and a username that is a prefix of another
 * bot's — `([[:space:]]|$)` ends the match. What it refuses: leading
 * whitespace, since `^` anchors at position 0. The composer trims before it
 * sends, so that is already true of everything it produces.
 *
 * An unknown username answers «» rather than inventing one. It cannot happen
 * for a chat member — the `bots` SELECT policy admits anyone sharing a live
 * chat with the bot, which is the same reader the membership policy admits —
 * and `useBotChat` reports no bot at all when the row does not come back.
 */
export function botCommandAddress(addressing: BotChatAddressing): string {
  if (isBotPartnerChat(addressing.chatType)) return "";
  const username = addressing.botUsername?.trim();
  return username ? `@${username}` : "";
}

/**
 * What choosing a command puts in the field.
 *
 * A trailing space, and no send: Telegram's menu fills the composer and leaves
 * the person to add an argument or press send. Sending on the choice would make
 * every command that takes an argument unusable from the menu.
 *
 * In a group the command carries the bot's name, because otherwise it is sent,
 * shown in the conversation, and never delivered (D-244).
 */
export function botCommandDraft(command: BotCommand, addressing: BotChatAddressing): string {
  return `${botCommandSlash(command)}${botCommandAddress(addressing)} `;
}

/**
 * What the field is asking for, or null when it is not asking.
 *
 * Telegram offers commands only while the whole field is one unfinished
 * command: the text starts with «/» and has no space in it yet. «/pi» asks for
 * everything beginning «pi»; «/» alone asks for everything; «/ping » has
 * finished asking and is now taking an argument; «привет /pi» is not asking,
 * because a slash in the middle of a sentence is a slash, not a menu.
 */
export function botCommandQuery(draft: string): string | null {
  const text = draft.trimStart();
  if (!text.startsWith("/")) return null;
  const rest = text.slice(1);
  for (const character of rest) {
    if (character.trim() === "") return null;
  }
  return rest.toLocaleLowerCase("en-US");
}

/**
 * The commands a query offers, by prefix, in the bot's own order.
 *
 * Prefix and not substring, and against the name and not the description: it is
 * how a command is typed, and a list that re-ranks while a name is being
 * completed moves the row out from under the finger.
 */
export function matchBotCommands(
  commands: readonly BotCommand[],
  query: string | null,
): readonly BotCommand[] {
  if (query === null) return [];
  if (query === "") return commands;
  return commands.filter((entry) => entry.command.startsWith(query));
}

// ---------------------------------------------------------------------------
// A command that is already in the conversation, and one that was typed whole
// (D-263)
// ---------------------------------------------------------------------------

/**
 * A command token read out of a line of message text.
 *
 * `command` and `address` are lowered, because the authoriser lowers the whole
 * content before it matches: `pg_catalog.lower(coalesce(content, ''))` is the
 * left side of every branch of `private.bot_can_receive_message`. So `/SHIFT`
 * is delivered exactly as `/shift` is, and a reader of this module must not
 * answer differently from the function that decides delivery.
 */
export interface BotCommandMention {
  /** Without the slash, lowered. */
  readonly command: string;
  /** The bot the text names, lowered, or null when it names none. */
  readonly address: string | null;
  /** How many characters of the input the whole token occupies. */
  readonly length: number;
}

/** `bots.username` CHECK: `^[a-z][a-z0-9_]{4,31}$`, so 5..32 characters. */
const MIN_USERNAME_LENGTH = 5;
const MAX_USERNAME_LENGTH = 32;

function isLowerLetter(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isNameTail(code: number): boolean {
  return isLowerLetter(code) || (code >= 48 && code <= 57) || code === 95;
}

/**
 * The command token at the very start of `text`, or null.
 *
 * Written against `private.bot_can_receive_message`'s own regex rather than
 * against the Bot API's prose, because the function is what decides whether the
 * message arrives:
 *
 *   `'^/[a-z][a-z0-9_]{0,31}@' || username || '([[:space:]]|$)'`
 *
 * Three consequences are load-bearing and each is asserted:
 *
 *   - **the anchor is position 0**, so a command after a space is not a command
 *     to that function and is not one here either;
 *   - **what may follow the token is whitespace or nothing**, so `/shiftmore`
 *     and `/shift,` are text, not commands;
 *   - **case does not matter**, because the content is lowered first.
 *
 * `@` is read even when no bot is named after it, and answers null — a bare
 * `/shift@` matches neither the addressed branch nor the bare one, and treating
 * it as the bare command would make the token claim a delivery it will not get.
 */
export function readBotCommandMention(text: string): BotCommandMention | null {
  if (text.charAt(0) !== "/") return null;
  // Lowered once, not per character. The first version called
  // `toLocaleLowerCase` inside both loops, which is quadratic in the length of
  // a message line — and a message line is attacker-supplied.
  const lowered = text.toLocaleLowerCase("en-US");
  let cursor = 1;
  while (cursor < lowered.length) {
    const code = lowered.charCodeAt(cursor);
    const ok = cursor === 1 ? isLowerLetter(code) : isNameTail(code);
    if (!ok) break;
    cursor += 1;
  }
  // `isCommandName` is the only length authority, and deliberately so: it is
  // the CHECK on `bot_commands.command` written out, and a second bound beside
  // it was redundant — a mutation of it stayed green, which is what redundancy
  // looks like from a test's side.
  const command = lowered.slice(1, cursor);
  if (!isCommandName(command)) return null;

  let address: string | null = null;
  let end = cursor;
  if (lowered.charAt(cursor) === "@") {
    let mention = cursor + 1;
    while (mention < lowered.length) {
      const code = lowered.charCodeAt(mention);
      const ok = mention === cursor + 1 ? isLowerLetter(code) : isNameTail(code);
      if (!ok) break;
      mention += 1;
    }
    const named = lowered.slice(cursor + 1, mention);
    if (named.length < MIN_USERNAME_LENGTH || named.length > MAX_USERNAME_LENGTH) return null;
    address = named;
    end = mention;
  }

  const after = text.charAt(end);
  if (after !== "" && after.trim() !== "") return null;
  return { command, address, length: end };
}

/**
 * Whether a command token in the conversation is one this chat can run.
 *
 * Both halves matter and the second is the one that makes the affordance
 * honest. A command the bot never registered is left as text, because a
 * pressable `/lol` would be the inert control §8 of
 * `docs/operations/reference-clients.md` refuses, wearing a link's clothes.
 *
 * **This is where ours deliberately differs from Telegram.** Measured on
 * `P212C6000159` on 2026-09-21: Telegram draws every `/word` as a link and
 * sends it on a tap, whether or not any bot in the chat answers to it. Ours
 * draws only what will be answered, which is the same rule with the failure
 * removed rather than a different one.
 *
 * An address that names a different bot is refused for the same reason: the
 * authoriser would hand that message to the bot named, and this chat's bot —
 * whose commands are the ones on the screen — would never see it.
 */
export function botCommandMentionRuns(
  mention: BotCommandMention,
  commands: readonly BotCommand[],
  addressing: BotChatAddressing,
): boolean {
  if (!commands.some((entry) => entry.command === mention.command)) return false;
  if (mention.address === null) return true;
  const username = addressing.botUsername?.trim().toLocaleLowerCase("en-US");
  return Boolean(username) && mention.address === username;
}

/**
 * What pressing a command in the conversation sends.
 *
 * The token as the authoriser needs it, never the rest of the line: what was
 * highlighted is what the press acts on, and sending words the reader did not
 * press would be a surprise. In a group it carries the bot's name for the same
 * reason the menu's draft does (D-244) — `botCommandAddress` is asked rather
 * than re-derived, so one rule serves both doors.
 *
 * **Measured, and it is the reference's answer too.** Telegram, on the device
 * on 2026-09-21: tapping `/start` inside a bubble sent `/start` again at once,
 * with no confirmation and nothing put in the composer — the whole exchange
 * repeated on screen. Discord's command sheet, same device and day, gives an
 * argument-free command an explicit «Отправить ➤» that also sends with no
 * confirmation. Both make a command in front of you runnable in one act.
 */
export function botCommandRunText(
  mention: BotCommandMention,
  addressing: BotChatAddressing,
): string {
  return `/${mention.command}${botCommandAddress(addressing)}`;
}

/**
 * What a typed command actually goes out as (D-263, second complaint).
 *
 * The complaint is that a hand-typed `/cmd` in a group is **silently dropped**:
 * it is shown in the conversation, the bot never hears it, and nothing anywhere
 * says so. That is not a defect in the authoriser — under `restricted` it
 * admits `/cmd@username`, a mention of the bot, or a reply to it, and refusing
 * the rest is what keeps a group's traffic out of a bot — it is the composer
 * knowing the address and not writing it.
 *
 * So the address is written. The person who types a command whole now gets the
 * delivery the person who picks it from the menu has had since D-244, and the
 * conversation shows `/shift@shiftbot`, which is both what was sent and what
 * will arrive — so nothing is silent about it.
 *
 * The three refusals are what keep this from being a rewrite of people's words:
 *
 *   - **only a command the bot registered.** `/lol` in a group stays a joke.
 *   - **only at position 0**, which is the only place the authoriser looks.
 *   - **only when nothing is addressed already**, whoever is addressed. A
 *     person writing `/shift@otherbot` meant the other bot.
 *
 * Everything after the token is kept, so `/shift 12` becomes
 * `/shift@shiftbot 12` — the authoriser's own `([[:space:]]|$)` is what makes
 * that form deliverable, and an argument is the commonest reason to type a
 * command out instead of picking it.
 */
export function addressTypedBotCommand(
  text: string,
  addressing: BotChatAddressing,
  commands: readonly BotCommand[],
): string {
  const address = botCommandAddress(addressing);
  if (!address) return text;
  const mention = readBotCommandMention(text);
  if (!mention || mention.address !== null) return text;
  if (!commands.some((entry) => entry.command === mention.command)) return text;
  return `${text.slice(0, mention.length)}${address}${text.slice(mention.length)}`;
}

// ---------------------------------------------------------------------------
// Opening a bot, and starting it (D-127)
// ---------------------------------------------------------------------------

/**
 * What «Запустить» sends. Telegram's «Start», and the bot's own convention.
 *
 * Unaddressed, and that is safe for exactly one reason: `botChatNeedsStart`
 * offers the button in a private chat and nowhere else (D-243), and a private
 * chat short-circuits `private.bot_can_receive_message` entirely. Bring the
 * button to a group and this string has to go through `botCommandAddress`
 * first, or the bot never hears the start it is being started with.
 */
export const BOT_START_COMMAND = "/start";
export const BOT_START_LABEL = "Запустить";

export interface BotChatStartInput {
  /** Whether this chat holds a bot at all. A chat without one never starts. */
  readonly hasBot: boolean;
  /**
   * `chats.type`. «Запустить» belongs to a conversation with a bot and nowhere
   * else — see `isBotPartnerChat` and D-243.
   */
  readonly chatType: string | null | undefined;
  readonly currentUserId: string | null;
  readonly messages: readonly { readonly user_id: string | null }[];
  /**
   * Whether `messages` is the whole conversation.
   *
   * There is no column recording that a person started a bot, so this is
   * inferred: nobody has said anything here yet. The inference is only sound
   * over a complete history — a chat with older pages still unloaded has
   * plainly been used — so a partial one never offers the button. Said plainly
   * because it is the one decision in this module that is not read off the
   * schema.
   */
  readonly historyComplete: boolean;
}

/**
 * Whether the composer is replaced by one «Запустить».
 *
 * True only in a **private chat with a bot**, while the person has never
 * written in it and the whole history is loaded. A bot talking first — a
 * greeting, a keyboard — does not count as having started it, which is exactly
 * Telegram's behaviour and the reason this looks for the reader's own `user_id`
 * rather than for an empty conversation.
 *
 * The chat's type is load-bearing and was missing until D-243. «I have not
 * written here» means «I have not started this bot» in a conversation with one
 * and «I have been reading» in a group, and a group member who has been reading
 * lost the message field, the attach button and the recorder to a button that
 * sent `/start` into the room.
 */
export function botChatNeedsStart(input: BotChatStartInput): boolean {
  if (!input.hasBot || !isBotPartnerChat(input.chatType)) return false;
  if (!input.currentUserId || !input.historyComplete) return false;
  return !input.messages.some((message) => message.user_id === input.currentUserId);
}

/**
 * Which of the chats shared with a bot to open.
 *
 * `chat_bot_members` answers with every chat the reader can see the bot in, and
 * for the bot's own owner that includes chats the owner is not a member of —
 * the SELECT policy allows either. So the candidates are intersected with the
 * reader's own memberships before anything is opened, and a private chat wins
 * over a group: tapping a bot in search means «talk to this bot», not «jump to
 * a group it happens to be in».
 */
export function chooseBotChat(
  candidates: readonly { readonly chatId: string; readonly type: string | null }[],
  myChatIds: ReadonlySet<string>,
): string | null {
  const mine = candidates.filter((entry) => myChatIds.has(entry.chatId));
  const priv = mine.find((entry) => entry.type === "private");
  if (priv) return priv.chatId;
  return mine[0]?.chatId ?? null;
}

// ---------------------------------------------------------------------------
// Which bot a chat holds (D-126, D-244, D-247)
// ---------------------------------------------------------------------------

/**
 * The one state in which a bot can be sent anything at all.
 *
 * `private.bot_can_receive_message` joins `public.bots` and requires
 * `receiver_bot.state = 'active'`, read off
 * `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql`
 * line 2630 rather than assumed. Every other state — `paused`, `suspended`,
 * `pending_delete`, `deleted` — is a bot whose messages the authoriser drops
 * without a word to the sender.
 */
const BOT_STATE_REACHABLE = "active";

export interface ChatBotMembership {
  readonly botId: string;
  /** `bots.username` of that same bot, for addressing it (D-244). */
  readonly username: string;
  /** `chat_bot_members.joined_at`; "" when the row did not carry one. */
  readonly joinedAt: string;
}

/**
 * A row of `chat_bot_members` with its bot embedded, or null.
 *
 * PostgREST answers a to-one embed as an object; some versions answer an array
 * of one. Both are read, the way `fetchChatBots` reads them, because guessing
 * wrong turns every bot chat into a chat without a bot.
 *
 * **The state is filtered here rather than on the wire, and that is the whole
 * of D-247.** The `bots` SELECT policy admits a row to anyone sharing a live
 * chat with the bot **whatever its state** — that is its third branch, and it
 * is what makes a disabled bot's name readable to the people it was talking to.
 * So the server will go on handing this row back, and the client is the only
 * place the filter can be. `fetchChatBots` had it and this reader did not, and
 * two readers of one fact disagreeing is how a paused bot kept a command menu
 * whose commands the authoriser refused in silence.
 */
export function readChatBotMembership(value: unknown): ChatBotMembership | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const embedded = Array.isArray(row.bot) ? row.bot[0] : row.bot;
  const bot = typeof embedded === "object" && embedded !== null ? (embedded as Record<string, unknown>) : null;
  const botId = typeof row.bot_id === "string" ? row.bot_id : null;
  const username = typeof bot?.username === "string" ? bot.username : null;
  if (!botId || !username) return null;
  if (bot?.state !== BOT_STATE_REACHABLE) return null;
  return {
    botId,
    username,
    joinedAt: typeof row.joined_at === "string" ? row.joined_at : "",
  };
}

/**
 * Which bot the composer speaks to, out of everything the chat holds.
 *
 * One of them, and always the same one: the one that joined first, with the
 * username as a tie-break so that two memberships written in one transaction
 * still order the same way on every load. The composer has room for a single
 * bot's menu, so this is a choice the product has to make either way; before
 * D-244 it was `limit(1)` with no ordering, which is whichever row Postgres
 * handed back that time. A group with two bots still reaches only one of them
 * from the menu — recorded rather than fixed, because a per-bot menu is a
 * different surface.
 *
 * A membership whose bot row does not come back is no bot rather than a bot
 * without a name: the alternative is a command menu that offers what nothing
 * can deliver, which is the same failure D-247 names from the other end.
 */
export function chooseChatBot(rows: unknown): ChatBotMembership | null {
  const parsed = (Array.isArray(rows) ? rows : [])
    .map(readChatBotMembership)
    .filter((row): row is ChatBotMembership => row !== null)
    .sort((left, right) =>
      left.joinedAt === right.joinedAt
        ? left.username.localeCompare(right.username, "en-US")
        : left.joinedAt.localeCompare(right.joinedAt),
    );
  return parsed[0] ?? null;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** Pressed, and the deployment has no way to deliver it. See fact 4 above. */
export const BOT_CALLBACK_UNAVAILABLE = "Кнопки этого бота пока не работают.";
/** Pressed, and this press was refused. */
export const BOT_CALLBACK_REFUSED = "Эту кнопку нажать нельзя.";
/** Pressed, and it did not go through. Worth pressing again, so it says so. */
export const BOT_CALLBACK_FAILED = "Не удалось нажать кнопку. Попробуйте ещё раз.";
/** The bot took the press and had nothing to say about it. */
export const BOT_CALLBACK_DONE = "Запрос передан боту";

/** The menu button beside the field, and its empty state. */
export const BOT_COMMANDS_LABEL = "Команды";
export const BOT_COMMANDS_EMPTY = "У этого бота пока нет команд.";
/** «/» typed, and nothing the bot registered begins that way. */
export const BOT_COMMANDS_NO_MATCH = "Нет подходящих команд.";

/** Search found a bot and there is no chat with it to open. */
export const BOT_CHAT_UNAVAILABLE = "Чат с ботом пока недоступен.";
export const BOT_CHAT_OPEN_FAILED = "Не удалось открыть чат с ботом. Попробуйте ещё раз.";
/** «Запустить» pressed and the message did not go. */
export const BOT_START_FAILED = "Не удалось запустить бота. Попробуйте ещё раз.";

/**
 * Every sentence this module shows, for the test that asserts none of them
 * explains the machine. `INTERNALS_PATTERN` is imported rather than restated so
 * that a word added to the filter elsewhere applies here on the next run.
 */
export const BOT_SURFACE_MESSAGES: readonly string[] = [
  BOT_CALLBACK_UNAVAILABLE,
  BOT_CALLBACK_REFUSED,
  BOT_CALLBACK_FAILED,
  BOT_CALLBACK_DONE,
  BOT_COMMANDS_LABEL,
  BOT_COMMANDS_EMPTY,
  BOT_COMMANDS_NO_MATCH,
  BOT_CHAT_UNAVAILABLE,
  BOT_CHAT_OPEN_FAILED,
  BOT_START_FAILED,
  BOT_START_LABEL,
];

/** True when a sentence would explain the machine rather than the situation. */
export function botMessageExplainsInternals(message: string): boolean {
  return INTERNALS_PATTERN.test(message);
}

/**
 * What the failure of a press says, given the reason and whatever the server
 * sent back.
 *
 * `plainFailure` is asked for the `failed` branch alone: a dead network or an
 * expired session is worth more than «попробуйте ещё раз», and that is the only
 * branch where the server's own sentence can be about something the person can
 * act on. The other two are this product's statements about its own state, and
 * a server message has nothing to add to either.
 */
export function botCallbackFailureMessage(
  failure: BotCallbackFailure,
  serverMessage?: string | null,
): string {
  if (failure === "missing") return BOT_CALLBACK_UNAVAILABLE;
  if (failure === "refused") return BOT_CALLBACK_REFUSED;
  return plainFailure(serverMessage, BOT_CALLBACK_FAILED);
}
