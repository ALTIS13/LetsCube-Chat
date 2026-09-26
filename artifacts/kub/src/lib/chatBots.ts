/**
 * A bot in a chat: what to call it, what it will see, and what a refusal means
 * (D-235, D-236).
 *
 * Imports nothing, so a `node --test` process can reach every decision in it.
 * That is the same rule `botChatSurfaces.ts` follows and for the same measured
 * reason: a check that cannot be reached from a test is a gap in the module
 * boundary, not a gap in the suite.
 *
 * Two questions live here.
 *
 * ── «Is this conversation with a bot?» ────────────────────────────────────
 *
 * Nothing on a chat row answered it before this change. `chats` has no bot
 * column, a bot is not a `chat_members` row — its membership lives in
 * `public.chat_bot_members` — and `last_message.bot` is about the newest
 * message, which is null in a fresh bot chat and non-null in a group a bot
 * happens to have spoken in. So `useChats` now reads the live memberships for
 * the chats it just fetched and hangs them on each chat as `bots`, and every
 * surface asks these functions rather than inventing its own test.
 *
 * `chatBotPartner` is deliberately narrower than «this chat has a bot»: a group
 * with a bot in it is still a group, and the mark D-236 asks for is about the
 * person you think you are talking to. Only a private chat holding exactly one
 * bot has a bot as its counterpart.
 *
 * ── «What will a bot see once it is added?» ───────────────────────────────
 *
 * `BOT_VISIBILITY_NOTE` is not a paraphrase. It is read off
 * `private.bot_can_receive_message`, the function the gateway's delivery
 * actually goes through, whose `restricted` branch admits a message only when
 *
 *   - it is the bot's own message, or
 *   - its text begins `/command@username` addressed to this bot, or
 *   - its text mentions `@username`, or
 *   - it is a reply to one of the bot's own messages,
 *
 * and in every branch only when `messages.created_at >= chat_bot_members.joined_at`.
 * That last clause is why the note ends with the history: a bot added today
 * cannot read yesterday, and nobody would guess it from the other three.
 *
 * A bot enters a group `restricted`. A group administrator may opt in to full
 * visibility for future messages; switching modes resets the readable boundary.
 *
 * ── «Who is told, and where?» (D-276) ─────────────────────────────────────
 *
 * Until D-276 the answer was «the person who added it, once». `BOT_VISIBILITY_NOTE`
 * is shown while the add is being decided, which is right, and then the fact
 * had no home: a group member who arrived later, or who never opened the invite
 * screen, had no way to find out what any bot in the room could read.
 *
 * Telegram's answer is the one taken here, and it is a mechanic rather than a
 * sentence: the bot's privacy state is drawn **on the bot's own row in the
 * member list**, in words, for every member — «Users can always see a bot's
 * current privacy setting in the list of group members»
 * (core.telegram.org/bots/features#privacy-mode), shown there as «has access to
 * messages» / «has no access to messages» (telegram.org/faq).
 *
 * **Three things about how they draw it, measured in their sources rather than
 * taken from the documentation**, because each one decides something here:
 *
 *   1. It is a **status string in the slot where «last seen…» would go**, not a
 *      badge and not an extra line. `lng_status_bot_reads_all` /
 *      `lng_status_bot_not_reads_all` on Desktop, `BotStatusRead` /
 *      `BotStatusCantRead` on Android, `Bot.GroupStatusReadsHistory` /
 *      `…DoesNotReadHistory` on iOS. So `botMemberStatusLine` replaces the
 *      bot's status line rather than adding a third one: a row that is taller
 *      than every person's row, with the fact on a line no other row uses, puts
 *      it where the eye is not looking.
 *   2. **Both Telegram web clients have none of it** — the same greps return
 *      nothing across Web A and Web K. That is recorded here so nobody
 *      «corrects» this surface later by reading the web client: their web is
 *      behind their native, and this follows the native.
 *   3. **No Telegram client draws a «bot» badge at all.** Ours does, beside the
 *      name and again over the first message in a group. That divergence is
 *      D-263's and is deliberate; it is named here only so that this file is
 *      not later read as claiming Telegram for it.
 *
 * The line is per bot and not per group deliberately. A paragraph over the list
 * can only state one rule, and a group is allowed to hold two bots in two
 * states; before D-276 the group panel had exactly such a paragraph, and it was
 * true only because `full` happened to be unreachable.
 * `BOT_MEMBERS_HISTORY_NOTE` is what is left of it — the one clause that holds
 * for every bot in every mode, and the one nobody guesses.
 */

/** The smallest shape every surface here needs of a bot. */
export interface BotLike {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly description?: string | null;
  readonly avatar_url?: string | null;
  readonly state?: string | null;
}

/** The smallest shape of a chat these decisions read. */
export interface ChatBotHost {
  readonly type?: string | null;
  readonly bots?: readonly BotLike[] | null;
}

/** The word the mark carries, everywhere it is drawn. */
export const BOT_MARK_LABEL = "Бот";
/** What the mark says to a screen reader, which cannot see it sits by a name. */
export const BOT_MARK_TITLE = "Это бот, а не человек";

export const BOT_SECTION_HEADING = "Боты";
export const BOT_ADD_LABEL = "Добавить";
export const BOT_ADDED_LABEL = "Добавлен";
export const BOT_ADDING_LABEL = "Добавляем...";
export const BOT_REMOVE_LABEL = "Убрать";
export const BOT_REMOVING_LABEL = "Убираем...";
export const BOT_MEMBERS_HEADING = "Боты в группе";
export const BOT_MEMBERS_EMPTY = "В группе пока нет ботов.";

/**
 * What a bot will and will not see, said before the button is pressed.
 *
 * Every clause is `private.bot_can_receive_message`'s `restricted` branch; see
 * the note at the top of this file.
 */
export const BOT_VISIBILITY_NOTE =
  "Бот получит только обращённые к нему сообщения: упоминания через @никнейм, "
  + "команды с @никнеймом и ответы на его сообщения. Остальную переписку группы "
  + "и историю до добавления он не увидит.";

/**
 * What a bot's privacy state is called in this product.
 *
 * `chat_bot_members.privacy_mode`, whose CHECK admits these two and nothing
 * else. Anything the server did not send, or sent under a third name, is read
 * as `restricted`: that is the column's own default, it is the state every live
 * row is in, and the failure it guards against is a missing value drawn as
 * «видит все сообщения».
 */
export type BotPrivacyMode = "restricted" | "full";

export function readBotPrivacyMode(value: unknown): BotPrivacyMode {
  return value === "full" ? "full" : "restricted";
}

/**
 * The one line on a bot's row that says what it can read (D-276).
 *
 * Both branches are `private.bot_can_receive_message` said in a phrase: `full`
 * takes the whole chat, `restricted` takes a mention, a command carrying the
 * никнейм, or a reply to the bot — which is «обращения к нему» and nothing
 * else. Short enough to sit under a name at 390 beside the remove button; the
 * clause about the history before joining is the row above, because it is true
 * of both and repeating it twice on every row would drown the difference.
 */
export const BOT_ACCESS_RESTRICTED = "Видит только обращения к нему";
export const BOT_ACCESS_FULL = "Видит все сообщения группы";

export function botAccessLabel(mode: BotPrivacyMode): string {
  return mode === "full" ? BOT_ACCESS_FULL : BOT_ACCESS_RESTRICTED;
}

/**
 * The bot's line in the group's member list — its status slot (D-276).
 *
 * Identity then state, the shape a person's row has one line above: theirs is
 * `Владелец группы · был(а) недавно`. **The description gives way to the
 * access** — a slot that sometimes says what a bot reads and sometimes what it
 * is for is not a status slot — and `botSecondaryLine` keeps carrying both for
 * the screen that chooses which bot to add, which is where a description helps.
 *
 * **The handle stays, and that is a divergence from Telegram with a reason.**
 * Their status string is the state alone (`lng_status_bot_reads_all`), because
 * their composer completes `@name` for you. This product has no mention
 * autocomplete at all — measured, not assumed — so in a group `@никнейм` has to
 * be typed, `private.bot_can_receive_message` delivers nothing without it
 * (D-244), and this row is the only place a member who did not add the bot can
 * read it. Dropping it to match Telegram would have taken the handle off the
 * one screen that shows it.
 *
 * **It wraps rather than truncates**, which is the other half of the same
 * decision. The text column here is the panel less its padding, the avatar, the
 * gap and «Убрать»; the pair overruns it at both release widths, and `truncate`
 * would eat the end of the access — the one fact the line exists to carry —
 * with an ellipsis and no error. Measured at 1440 and 390 in
 * `bot-group-membership.spec.ts`, which asserts the rendered element is never
 * clipped.
 */
export function botMemberStatusLine(bot: BotLike, mode: BotPrivacyMode): string {
  return `@${bot.username} · ${botAccessLabel(mode)}`;
}

/**
 * The paragraph over the group's bot list (D-276).
 *
 * All that is left of a note that used to state the whole `restricted` branch
 * for every bot at once. What each bot sees is now on its own row, where it can
 * differ; what stays here is the clause that holds whatever `privacy_mode`
 * says — `bot_can_receive_message` admits a message only when
 * `messages.created_at >= chat_bot_members.joined_at`, in every branch — and
 * which nobody would guess from a label.
 */
export const BOT_MEMBERS_HISTORY_NOTE =
  "Бот не видит сообщения до своего добавления или последнего изменения доступа.";

export const BOT_GRANT_FULL_LABEL = "Дать доступ ко всем сообщениям";
export const BOT_RESTRICT_LABEL = "Ограничить доступ бота";
export const BOT_PRIVACY_FAILED = "Не удалось изменить доступ бота. Попробуйте ещё раз.";

/** The same fact, once it is done, because a success is also a place to say it. */
export function botAddedMessage(name: string): string {
  return `${name} добавлен в группу. Бот видит только обращённые к нему сообщения.`;
}

export function botRemovedMessage(name: string): string {
  return `${name} больше не участвует в этой группе.`;
}

/** The name a bot is shown under, matching `messageActorDisplayName`. */
export function botDisplayName(bot: BotLike): string {
  return bot.display_name.trim() || `@${bot.username}`;
}

/** The second line of a bot's row: its handle, then whatever it says about itself. */
export function botSecondaryLine(bot: BotLike): string {
  const handle = `@${bot.username}`;
  const about = bot.description?.trim();
  return about ? `${handle} · ${about}` : handle;
}

/**
 * The bot this conversation is with, or null.
 *
 * A group is never «a conversation with a bot» however many bots are in it, and
 * a private chat holding more than one bot is a shape the product cannot make —
 * `open_or_create_bot_chat` puts exactly one in — so it is treated as unknown
 * rather than guessed at.
 */
export function chatBotPartner(chat: ChatBotHost | null | undefined): BotLike | null {
  if (!chat || chat.type !== "private") return null;
  const bots = chat.bots ?? [];
  return bots.length === 1 ? bots[0] : null;
}

/** Every bot currently in the chat, in a stable order. */
export function chatBotMembers(chat: ChatBotHost | null | undefined): readonly BotLike[] {
  return chat?.bots ?? [];
}

/**
 * Whether the deployment has the door at all.
 *
 * PostgREST answers PGRST202 for a function missing from its schema cache and
 * Postgres 42883 for one that does not exist. Either way the three functions
 * this feature needs were never created, and the honest surface is the one
 * without a bot section — not one with an error about it. Written the same way
 * `classifyBotCallbackFailure` reads its own absence.
 */
export function isBotDoorMissing(
  error: { code?: unknown; message?: unknown; details?: unknown } | null | undefined,
): boolean {
  const text = `${String(error?.code ?? "")} ${String(error?.message ?? "")} ${String(error?.details ?? "")}`
    .toLocaleLowerCase("en-US");
  return (
    text.includes("pgrst202")
    || text.includes("42883")
    || text.includes("could not find the function")
    || text.includes("does not exist")
  );
}

/**
 * What `chat_bot_add` and `chat_bot_remove` raise, in words.
 *
 * The six names are the `raise exception` strings of
 * `20260919010000_a_bot_can_be_put_in_a_group.sql`, matched against the whole
 * error rather than against one field: PostgREST puts the raised text in
 * `message` and the SQLSTATE in `code`, and a client without the schema cache
 * entry has been seen to put it in `details` instead.
 *
 * Anything unrecognised falls back rather than being shown raw — a Postgres
 * error is a sentence about the machine.
 */
export function botMembershipFailureMessage(
  error: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null | undefined,
  fallback: string,
): string {
  const text = `${String(error?.code ?? "")} ${String(error?.message ?? "")} ${String(error?.details ?? "")} ${String(error?.hint ?? "")}`
    .toLocaleLowerCase("en-US");
  if (text.includes("not_a_group")) return "Бота можно добавить только в группу.";
  if (text.includes("not_an_admin")) return "Добавлять и убирать ботов может только администратор группы.";
  if (text.includes("bot_not_active")) return "Этот бот сейчас отключён.";
  if (text.includes("no_such_bot")) return "Такого бота больше нет.";
  if (text.includes("no_such_chat")) return "Этой группы больше нет.";
  if (text.includes("not_authenticated")) return "Войдите в аккаунт ещё раз.";
  return fallback;
}

export const BOT_ADD_FAILED = "Не удалось добавить бота. Попробуйте ещё раз.";
export const BOT_REMOVE_FAILED = "Не удалось убрать бота. Попробуйте ещё раз.";
export const BOT_LIST_FAILED = "Не удалось загрузить список ботов.";

/**
 * Every sentence this module shows, for the test that asserts none of them
 * explains the machine — the same list `BOT_SURFACE_MESSAGES` keeps next door.
 */
export const CHAT_BOT_MESSAGES: readonly string[] = [
  BOT_MARK_LABEL,
  BOT_MARK_TITLE,
  BOT_SECTION_HEADING,
  BOT_ADD_LABEL,
  BOT_ADDED_LABEL,
  BOT_REMOVE_LABEL,
  BOT_MEMBERS_HEADING,
  BOT_MEMBERS_EMPTY,
  BOT_VISIBILITY_NOTE,
  BOT_MEMBERS_HISTORY_NOTE,
  BOT_GRANT_FULL_LABEL,
  BOT_RESTRICT_LABEL,
  BOT_PRIVACY_FAILED,
  BOT_ACCESS_RESTRICTED,
  BOT_ACCESS_FULL,
  BOT_ADD_FAILED,
  BOT_REMOVE_FAILED,
  BOT_LIST_FAILED,
];
