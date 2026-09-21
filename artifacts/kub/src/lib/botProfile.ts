/**
 * What a bot's card says, and the three things a person's card says that it
 * must not (D-263, third complaint).
 *
 * ## Where the shape comes from
 *
 * Both reference clients were read on the device on 2026-09-21 —
 * `P212C6000159`, Telegram 12.10.3 and Discord 345.9 — and they disagree about
 * what a bot's profile is **for**, which is the whole of the decision here.
 *
 * **Telegram's** (a published demo bot, so nobody's data was read): an avatar,
 * the name, a count of users where a person's card has a last-seen line, a row
 * of four round actions — «Чат», «Звук», «Ссылка», «Стоп» — and one card
 * carrying the description under «О себе» and the handle under «Имя
 * пользователя». **It lists no commands at all.** It answers «what is this
 * bot».
 *
 * **Discord's**: a banner, the avatar, the name with a «БОТ» badge, the handle,
 * mutual servers, «+ Добавить приложение» (992 x 99 px = 378 x 37.7 dp at 16.8
 * dp margins) and «Сообщение», then one card of the same 378 dp carrying
 * «Биография», «В числе участников с» — and **«Команды»: the bot's commands as
 * chips, with «Посмотреть все команды» opening a sheet that lists every one
 * with its description**. It answers «what can this bot do».
 *
 * **Ours takes Discord's**, and the reason is the owner's own: he rates
 * Discord's bots highest «из-за большей кастомизации и удобства их
 * реализации», and `CLAUDE.md` §7 makes Discord the default reference for
 * functions and interaction. A card that named a bot and stopped would have
 * left D-263's complaint — «a bot's profile answers nothing» — answered with a
 * name.
 *
 * ## The one place we differ from Discord deliberately
 *
 * Discord's command sheet splits its rows: a command that takes no argument
 * gets an explicit «Отправить ➤» (285 x ? px = 109 dp wide, right-aligned) and
 * one that takes arguments gets a chevron opening a form. **We cannot make
 * that split honestly**: `public.bot_commands` holds a name and a description
 * and no argument schema, so this product cannot tell the two apart. Taking
 * the send branch for everything would make every command that takes an
 * argument unusable from the card — which is the exact reason D-126 decided
 * the composer's own menu fills the field instead of sending.
 *
 * So the card's rows do what the menu's rows do. That is also why they are the
 * same decision (`botCommandDraft`) rather than two: one list behaving two
 * ways, depending on which door you came through, is the drift
 * `BotCommandMenu` was written as a single component to avoid.
 *
 * ## What is refused, and why each refusal is an absence
 *
 * §8 of `docs/operations/reference-clients.md`: a control that cannot work is
 * absent, not drawn and inert. A bot has no presence, no standing in this
 * chat, and no groups you are both in that mean anything — so none of those
 * lines exists on this card rather than existing empty. Telegram's card makes
 * the same three refusals; what it puts in their place is a user count, which
 * we do not have and do not invent.
 */

import {
  botCommandDraft,
  botCommandSlash,
  type BotChatAddressing,
  type BotCommand,
} from "./botChatSurfaces.ts";

/**
 * The identity half of the card — everything but the commands.
 *
 * The same field names `public.bots` uses, because the commonest opener hands
 * the row straight over: a bot's message carries its whole `bots` row, and
 * `resolveMessageActor` refuses a message whose embedded bot is not the one it
 * names, so what arrives has already been checked against the message.
 */
export interface BotProfileSeed {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly description?: string | null;
  readonly avatar_url?: string | null;
  readonly state?: string | null;
}

/** What the card draws, once the seed and the read have been reconciled. */
export interface BotProfileCardModel {
  readonly botId: string;
  /** `bots.display_name`, or the handle when a bot was created without one. */
  readonly name: string;
  /** With the «@», because that is how it is written everywhere else. */
  readonly handle: string;
  /** The description, trimmed, or null when the bot set none. */
  readonly description: string | null;
  /** `bots.avatar_url`, or null. The face falls back to the glyph (D-145). */
  readonly avatarUrl: string | null;
  /** `bot_commands`, in the bot's own order. */
  readonly commands: readonly BotCommand[];
  /** Whether the commands read has answered, so «none» can be told from «not yet». */
  readonly commandsSettled: boolean;
  /**
   * Whether this bot can be sent anything at all.
   *
   * `bots.state = 'active'` is the only state `private.bot_can_receive_message`
   * admits; the SELECT policy hands the row over whatever the state, which is
   * what lets a disabled bot's name stay readable to the people it was talking
   * to (D-247). So the card still names it — and offers nothing to press.
   */
  readonly reachable: boolean;
}

/** `bots.state` the authoriser admits. Read off the foundation migration. */
const BOT_STATE_REACHABLE = "active";

/**
 * A card from what is known, with the read winning over the seed.
 *
 * The seed is the first paint and never more than that: a row read a second
 * ago beats one that travelled with a message from an hour of scrollback. When
 * neither is present there is no card, which the container draws as a failure
 * rather than as a bot with no name.
 */
export function botProfileCardModel({
  seed,
  row,
  commands,
  commandsSettled,
}: {
  seed: BotProfileSeed | null;
  row: BotProfileSeed | null;
  commands: readonly BotCommand[];
  commandsSettled: boolean;
}): BotProfileCardModel | null {
  const source = row ?? seed;
  if (!source) return null;
  const username = source.username.trim();
  const name = source.display_name.trim() || `@${username}`;
  const description = source.description?.trim() ?? "";
  return {
    botId: source.id,
    name,
    handle: `@${username}`,
    description: description.length > 0 ? description : null,
    avatarUrl: source.avatar_url ?? null,
    commands,
    commandsSettled,
    reachable: (source.state ?? BOT_STATE_REACHABLE) === BOT_STATE_REACHABLE,
  };
}

/**
 * Whether a command row on this card can be pressed.
 *
 * A bot the authoriser will not deliver to has a card — its name is still
 * worth reading — and no working control on it. Drawing the rows and letting
 * them write a draft nothing answers is the inert control §8 refuses, and it
 * is the same rule that keeps a paused bot's menu out of the composer (D-247).
 */
export function botProfileCommandsPressable(model: BotProfileCardModel): boolean {
  return model.reachable && model.commands.length > 0;
}

/**
 * What choosing a command on the card puts in the composer.
 *
 * `botCommandDraft`, unchanged and unwrapped, so the card and the composer's
 * own menu cannot drift: the trailing space an argument goes after, and in a
 * group the bot's name, which is the only form `private.bot_can_receive_message`
 * delivers (D-244).
 *
 * The addressing is **this bot's**, not the chat's chosen one. That is the one
 * thing the card can do that the menu cannot: `chooseChatBot` gives the
 * composer a single bot, so in a group holding two the menu reaches only the
 * first, while a card is opened from a particular face and knows which.
 */
export function botProfileCommandDraft(
  model: BotProfileCardModel,
  command: BotCommand,
  chatType: string | null | undefined,
): string {
  const addressing: BotChatAddressing = {
    chatType,
    botUsername: model.handle.slice(1),
  };
  return botCommandDraft(command, addressing);
}

/** «/ping», as the card writes a row's name. The menu's own spelling. */
export function botProfileCommandLabel(command: BotCommand): string {
  return botCommandSlash(command);
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** The card's title, where the container needs one. */
export const BOT_PROFILE_TITLE = "Бот";
/**
 * The description's heading.
 *
 * «Описание» rather than Telegram's «О себе» or Discord's «Биография»: it is
 * the word this product already prints over the same field, in
 * `BotSettingsPanel` and `BotCreateModal`, and an owner who wrote the text
 * under one heading should find it under the same one.
 */
export const BOT_PROFILE_DESCRIPTION_LABEL = "Описание";
export const BOT_PROFILE_COMMANDS_LABEL = "Команды";
/** The read did not answer. Not «no such bot», which it cannot tell from it. */
export const BOT_PROFILE_UNAVAILABLE = "Не удалось загрузить бота.";
/** Named on the card so a reader knows why nothing there can be pressed. */
export const BOT_PROFILE_UNREACHABLE = "Бот отключён и не отвечает на команды.";

export const BOT_PROFILE_MESSAGES: readonly string[] = [
  BOT_PROFILE_TITLE,
  BOT_PROFILE_DESCRIPTION_LABEL,
  BOT_PROFILE_COMMANDS_LABEL,
  BOT_PROFILE_UNAVAILABLE,
  BOT_PROFILE_UNREACHABLE,
];
