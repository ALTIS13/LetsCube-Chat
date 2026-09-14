/**
 * Every word the channel management surfaces say.
 *
 * `lib/serverChannels.ts` holds the arrangement and the rules — what the rail
 * draws, who may manage it, how a name is cut, how a reorder is written. This
 * module holds the other half: the labels, the questions asked before something
 * is removed, and the sentences a refusal is allowed to be. They are separated
 * because the first is shared with the rail and the second is not, and because
 * a sentence somebody reads is a part of the product that must not change
 * silently.
 *
 * Its only import is `plainMessages.ts`, which imports nothing either — the
 * same arrangement `lib/personalModeration.ts` and `lib/settingsRows.ts` use,
 * and for the same reason: a decision made of words has no business pulling
 * React into a `node --test` process.
 *
 * `ChannelKind` and `ChatRole` are declared here rather than imported, because
 * of that rule. They are the same two unions `serverChannels.ts` exports and
 * `tests/unit/server-channel-admin.test.mts` assigns one to the other in both
 * directions, so the copy cannot drift without turning a test red.
 *
 * Four facts of the shipped schema decide the wording below, each taken from
 * the migration rather than from a description of it:
 *
 *   1. `topics` and `voice_channels` both carry `archived`, and the product
 *      already removes a topic by setting it (`useTopics.archiveTopic`). So
 *      removing a channel here is archiving it, and the question says «убрать»
 *      and promises the messages stay, because that is what happens. A DELETE
 *      would be a different promise and a worse one.
 *   2. `chat_channel_categories` has **no** `archived` column, so removing a
 *      heading really is a DELETE. Its two foreign keys carry
 *      `on delete set null (category_id)`, so the channels under it survive and
 *      merely lose their heading — which the question has to say out loud,
 *      since «удалить раздел» reads like «удалить всё, что в нём».
 *   3. `chat_channel_categories_name_length` is
 *      `char_length(btrim(name)) between 1 and 64`. The cut that satisfies it is
 *      `normalizeChannelName` in `serverChannels.ts`; what is here is only the
 *      caption and the counter.
 *   4. `speak_role` is the enum `chat_member_role`. It decides who may **speak**
 *      and nothing else: everyone who may read the group may enter the room and
 *      listen. So the options are worded as what they do, and the note under
 *      them says the rest may still come in — a room nobody but an
 *      administrator may speak in is a useful room, not a closed one.
 */

import { plainFailure, plainMessage } from "./plainMessages.ts";

/** The same union `serverChannels.ts` exports. Pinned to it by the unit test. */
export type ChannelKind = "text" | "voice";

/** The same union again: exactly `chat_member_role`, least first. */
export type ChatRole = "member" | "admin" | "owner";

// ---------------------------------------------------------------------------
// Counting in Russian
// ---------------------------------------------------------------------------

/**
 * One, few, many — the three forms Russian takes, chosen the way it chooses.
 *
 * Written once because four of the sentences below count something, and four
 * copies of this arithmetic is four chances to write «1 каналов» on a
 * confirmation nobody can undo.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(Math.trunc(count));
  const tail100 = absolute % 100;
  if (tail100 >= 11 && tail100 <= 14) return many;
  const tail10 = absolute % 10;
  if (tail10 === 1) return one;
  if (tail10 >= 2 && tail10 <= 4) return few;
  return many;
}

/** «1 канал», «2 канала», «5 каналов». */
export function channelCountLabel(count: number): string {
  return `${count} ${plural(count, "канал", "канала", "каналов")}`;
}

/** «1 место», «2 места», «10 мест». */
export function seatCountLabel(count: number): string {
  return `${count} ${plural(count, "место", "места", "мест")}`;
}

/** «1 человек», «2 человека», «5 человек». */
export function personCountLabel(count: number): string {
  return `${count} ${plural(count, "человек", "человека", "человек")}`;
}

// ---------------------------------------------------------------------------
// What the surfaces are called
// ---------------------------------------------------------------------------

/** The settings row that opens all of this, and the value beside it. */
export const CHANNELS_ROW_LABEL = "Каналы";

/**
 * The dialog's own title.
 *
 * One word, not «Каналы группы»: `KubModal` truncates its `h2`, and a title
 * that has run out of room has stopped saying which dialog this is — the same
 * measurement that shortened `reportDialogTitle`. Which group it is goes in the
 * dialog's description line, which wraps.
 */
export const CHANNELS_DIALOG_TITLE = "Каналы";

/** What a row is, by kind, in the singular. */
export function channelKindLabel(kind: ChannelKind): string {
  return kind === "voice" ? "Голосовая комната" : "Текстовый канал";
}

/** The two buttons of the kind picker. Short, because they stand side by side. */
export const CHANNEL_KIND_OPTIONS: readonly { readonly id: ChannelKind; readonly label: string }[] = [
  { id: "text", label: "Текстовый" },
  { id: "voice", label: "Голосовой" },
];

export const CHANNEL_ADD_LABEL = "Новый канал";
export const CATEGORY_ADD_LABEL = "Новый раздел";
export const CHANNEL_NAME_LABEL = "Название";
export const CATEGORY_NAME_LABEL = "Название раздела";
export const CHANNEL_KIND_LABEL = "Тип";
export const CHANNEL_CATEGORY_LABEL = "Раздел";
export const CHANNEL_CREATE_SUBMIT = "Создать";
export const CHANNEL_SAVE_SUBMIT = "Сохранить";
export const CANCEL_LABEL = "Отмена";

/**
 * The group every channel without a heading falls into.
 *
 * It is a real group and not an absence: a channel whose heading was just
 * deleted lands here, and `buildChannelTree` draws it above every heading for
 * exactly that reason.
 */
export const UNCATEGORIZED_LABEL = "Без раздела";

/** The placeholder of the name field, by kind. Examples, never a default. */
export function channelNamePlaceholder(kind: ChannelKind): string {
  return kind === "voice" ? "Переговорная, Отдых…" : "Общий, Релизы, Оффтоп…";
}

export const CATEGORY_NAME_PLACEHOLDER = "Работа, Голос, Архив…";

/** What the list says when the group has no channels and no headings at all. */
export const CHANNELS_EMPTY = "В этой группе пока нет каналов.";

/** And the one line under the title, which is the whole screen in a sentence. */
export const CHANNELS_HINT =
  "Каналы видят все участники группы. Разделы нужны только для того, чтобы их было удобно читать.";

// ---------------------------------------------------------------------------
// A voice room's two settings
// ---------------------------------------------------------------------------

export const SPEAK_ROLE_LABEL = "Кто может говорить";
export const SEAT_LIMIT_LABEL = "Сколько мест";

/**
 * The three values of `speak_role`, worded as what they do.
 *
 * Not «member / admin / owner» and not «Участник / Администратор / Владелец»:
 * the column does not name who the room is *for*, it names who may switch a
 * microphone on in it. A picker offering three ranks leaves the reader to guess
 * which way the rank points, and the guess that «Администратор» means «только
 * для администраторов, остальным нельзя войти» is the wrong one.
 */
export const SPEAK_ROLE_OPTIONS: readonly { readonly id: ChatRole; readonly label: string }[] = [
  { id: "member", label: "Все участники" },
  { id: "admin", label: "Только администраторы" },
  { id: "owner", label: "Только владелец" },
];

/** The label for one value, defaulting to the column's own default. */
export function speakRoleLabel(role: ChatRole | null | undefined): string {
  const found = SPEAK_ROLE_OPTIONS.find((option) => option.id === role);
  return (found ?? SPEAK_ROLE_OPTIONS[0]).label;
}

/**
 * The sentence that keeps a restricted room from reading as a closed one.
 *
 * Shown whenever speaking is narrower than the group. `voiceJoinVerdict`
 * already separates «full» from «listen-only» for the same reason, and this is
 * that distinction said to the person setting it rather than to the person
 * refused by it.
 */
export const SPEAK_ROLE_LISTENERS_NOTE = "Остальные смогут зайти и слушать.";

/** Whether that note belongs on screen for this value. */
export function speakRoleNarrowsSpeech(role: ChatRole | null | undefined): boolean {
  return role === "admin" || role === "owner";
}

/**
 * The bounds of the seat field.
 *
 * `max_participants` is `smallint not null default 10` and carries **no CHECK**,
 * so these two numbers are the product's rule rather than the database's, and
 * that is said here rather than left to be inferred. Two, because a room for
 * one person is not a room. Ninety-nine, because the column would accept 32767
 * and no voice server in this deployment would, and a field that offers a
 * number the call cannot honour is a field that lies.
 *
 * Zero is deliberately **not** offered as «без ограничения». `voiceJoinVerdict`
 * reads a limit of 0 as unbounded, but the gateway compares the same column
 * before it mints a token and nothing here has measured which way it reads a
 * zero. Writing one to find out would be an experiment on a live room.
 */
export const SEAT_LIMIT_MIN = 2;
export const SEAT_LIMIT_MAX = 99;
export const SEAT_LIMIT_DEFAULT = 10;

/**
 * The seat count as the update may carry it.
 *
 * A field a person is typing into passes through every intermediate state,
 * including the empty string and a lone minus sign, so anything that is not a
 * finite number falls back to the column's own default rather than to zero —
 * which would be the one value whose meaning is not known.
 */
export function normalizeSeatLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return SEAT_LIMIT_DEFAULT;
  return Math.min(SEAT_LIMIT_MAX, Math.max(SEAT_LIMIT_MIN, Math.trunc(parsed)));
}

/** What a voice row says about itself on the right: «10 мест», and who speaks. */
export function voiceChannelSummaryLine(input: {
  maxParticipants: number | null | undefined;
  speakRole: ChatRole | null | undefined;
}): string {
  const seats = seatCountLabel(normalizeSeatLimit(input.maxParticipants));
  if (!speakRoleNarrowsSpeech(input.speakRole)) return seats;
  return `${seats} · ${speakRoleLabel(input.speakRole)}`;
}

/** «Сейчас в комнате 3 человека», or nothing when it is empty. */
export function voiceOccupancyNote(participantCount: number | null | undefined): string | null {
  const inside = Math.max(0, Math.trunc(participantCount ?? 0));
  if (inside <= 0) return null;
  return `Сейчас в комнате ${personCountLabel(inside)}.`;
}

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

export interface ConfirmPrompt {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

/** The name a question uses for a channel somebody never named. */
const UNNAMED_CHANNEL = "Этот канал";
const UNNAMED_CATEGORY = "Этот раздел";

function quoted(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? `«${trimmed}»` : fallback;
}

/**
 * What «Убрать» asks before a channel leaves the rail.
 *
 * «Убрать», not «Удалить», and the difference is the truth: the write is
 * `archived = true`, the row stays, and every message in a text channel stays
 * with it. A question that said «удалить навсегда» would be asking permission
 * for something the product does not do, and the person who agreed to it would
 * have agreed to the wrong thing.
 *
 * A voice room adds one sentence when somebody is inside it. That is the
 * counter on the row — the same number the capsule shows and the same one the
 * gateway decides on — stated as a fact, not as a prediction about what happens
 * to the call: nothing here has measured what the voice server does when the
 * row it is serving is archived under it, so nothing here says.
 */
export function channelRemovalPrompt(input: {
  kind: ChannelKind;
  name: string | null | undefined;
  participantCount?: number | null;
}): ConfirmPrompt {
  const voice = input.kind === "voice";
  const subject = quoted(input.name, voice ? "Эта комната" : UNNAMED_CHANNEL);
  const occupancy = voice ? voiceOccupancyNote(input.participantCount) : null;
  const tail = voice
    ? "Комната перестанет быть видна участникам."
    : "Канал перестанет быть виден участникам, а сообщения в нём не удаляются.";
  return {
    title: voice ? "Убрать комнату?" : "Убрать канал?",
    description: [`${subject} исчезнет из списка каналов.`, tail, occupancy]
      .filter((part): part is string => Boolean(part))
      .join(" "),
    confirmLabel: "Убрать",
    cancelLabel: CANCEL_LABEL,
  };
}

/**
 * What «Удалить раздел» asks.
 *
 * Here «удалить» is the right word — the row really goes — and the second
 * sentence is the one that makes the question answerable. `topics_category_fkey`
 * and `voice_channels_category_fkey` both carry
 * `on delete set null (category_id)`, so the channels under the heading are
 * untouched and land in «Без раздела». Without that sentence a person deleting
 * a heading has to assume the worst, and the worst is not what happens.
 */
export function categoryRemovalPrompt(input: {
  name: string | null | undefined;
  channelCount: number;
}): ConfirmPrompt {
  const subject = quoted(input.name, UNNAMED_CATEGORY);
  const count = Math.max(0, Math.trunc(input.channelCount));
  const fate =
    count > 0
      ? `${channelCountLabel(count)} из него останутся на месте — они просто окажутся без раздела.`
      : "Каналов в нём нет.";
  return {
    title: "Удалить раздел?",
    description: `${subject} исчезнет из списка. ${fate}`,
    confirmLabel: "Удалить",
    cancelLabel: CANCEL_LABEL,
  };
}

/**
 * Whether the removal control belongs on this row at all.
 *
 * `topics.is_general` marks the channel the group started with, and nothing in
 * the product can put a group back to having none. A control that is offered
 * and then refused teaches a person that this screen guesses; so the general
 * channel simply has no «Убрать».
 */
export function canRemoveChannel(channel: {
  kind: ChannelKind;
  isGeneral?: boolean | null;
}): boolean {
  return !(channel.kind === "text" && channel.isGeneral === true);
}

/** Said on the general channel's own row, so its missing control is explained. */
export const GENERAL_CHANNEL_NOTE = "Основной канал группы";

// ---------------------------------------------------------------------------
// What a refusal is allowed to say
// ---------------------------------------------------------------------------

/**
 * What a write against `topics`, `voice_channels` or `chat_channel_categories`
 * did.
 *
 *   - `missing` — this deployment does not have the object the write needs;
 *   - `refused` — a policy said no (42501, or the row-level-security text);
 *   - `failed` — anything else, including a dead network.
 *
 * There is deliberately no `duplicate`: none of the three tables has a unique
 * index on a name, so two channels may share one, and inventing a duplicate
 * branch would be a sentence that can never be shown.
 */
export type ChannelWriteOutcome = "missing" | "refused" | "failed";

export const REFUSED_SQLSTATE = "42501";
/** The three ways PostgREST and Postgres say «that object is not here». */
export const MISSING_SQLSTATES: readonly string[] = ["42P01", "42703", "PGRST205"];

function errorField(error: unknown, key: string): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * Which of the three a caught error is.
 *
 * The code is read first because it is the fact; the message is read only as a
 * fallback, for the same reason `classifyPersonalWriteError` reads it — PostgREST
 * has been known to pass a violation through with the code on a nested field.
 *
 * `42703` («column does not exist») is grouped with the missing table on
 * purpose: on the day the client half of this reaches a deployment whose
 * `20260914140000_channel_categories.sql` has not run, `topics.category_id` is
 * what is absent rather than a whole table, and both are one situation to the
 * person reading the screen.
 */
export function classifyChannelWriteError(error: unknown): ChannelWriteOutcome {
  if (typeof error === "string") return classifyChannelWriteError({ message: error });
  const code = errorField(error, "code").toUpperCase();
  if (MISSING_SQLSTATES.includes(code)) return "missing";
  if (code === REFUSED_SQLSTATE) return "refused";
  const message = errorField(error, "message").toLocaleLowerCase("en-US");
  if (!message) return "failed";
  if (message.includes("row-level security") || message.includes("row level security")) return "refused";
  if (message.includes("does not exist") || message.includes("schema cache")) return "missing";
  return "failed";
}

/** The refusal a policy gives, said as the rule it is rather than as a code. */
export const CHANNELS_REFUSED = "Менять каналы может только владелец или администратор группы.";

/** A deployment that has this screen and not the rest of what it needs. */
export const CHANNELS_UNAVAILABLE = "Управление каналами здесь пока недоступно.";

/** The same, for the headings alone — the one piece that can be missing on its own. */
export const CATEGORIES_UNAVAILABLE = "Разделы здесь пока недоступны. Каналы работают как обычно.";

export const CHANNELS_READ_FAILED = "Не удалось загрузить каналы";
export const CHANNEL_CREATE_FAILED = "Не удалось создать канал";
export const CHANNEL_SAVE_FAILED = "Не удалось сохранить изменения";
export const CHANNEL_REMOVE_FAILED = "Не удалось убрать канал";
export const CHANNEL_MOVE_FAILED = "Не удалось изменить порядок";
export const CATEGORY_CREATE_FAILED = "Не удалось создать раздел";
export const CATEGORY_REMOVE_FAILED = "Не удалось удалить раздел";

/**
 * What the dialog prints when a write did not go through.
 *
 * `mapped` is whatever the product's error mapper made of it, and it is passed
 * through `plainFailure` rather than printed: the mapper answers with the cause
 * for a missing object, and a mapper that learns a new internal must not be
 * able to put a table name on this dialog. Anything a person can act on —
 * «Недостаточно прав», «Нет соединения» — survives untouched, because losing
 * the one failure they could have fixed is the worse trade.
 */
export function channelWriteRefusalText(
  outcome: ChannelWriteOutcome,
  failed: string,
  mapped?: string | null,
): string {
  if (outcome === "refused") return CHANNELS_REFUSED;
  if (outcome === "missing") return CHANNELS_UNAVAILABLE;
  return plainFailure(mapped, `${failed}. Попробуйте ещё раз.`);
}

/** The read's own failure, which is worth a «позже» because a read may succeed later. */
export function channelsReadFailureText(mapped?: string | null): string {
  return plainMessage(mapped, `${CHANNELS_READ_FAILED}. Попробуйте позже.`);
}

/** The line the feedback queue shows once a channel has actually gone. */
export function channelRemovedFeedback(kind: ChannelKind, name: string | null | undefined): {
  title: string;
  detail: string;
} {
  const trimmed = (name ?? "").trim();
  return {
    title: kind === "voice" ? "Комната убрана" : "Канал убран",
    detail: trimmed ? `«${trimmed}» больше не виден участникам.` : "Он больше не виден участникам.",
  };
}

/** And the one for a heading, which says again where its channels went. */
export function categoryRemovedFeedback(channelCount: number): { title: string; detail: string } {
  const count = Math.max(0, Math.trunc(channelCount));
  return {
    title: "Раздел удалён",
    detail: count > 0 ? `${channelCountLabel(count)} остались без раздела.` : "Каналов в нём не было.",
  };
}

/**
 * Every sentence this module can put on screen, for the test that asserts none
 * of them explains the machine. The same shape `plainMessages.ts` uses.
 */
export const SERVER_CHANNEL_MESSAGES: readonly string[] = [
  CHANNELS_HINT,
  CHANNELS_EMPTY,
  CHANNELS_REFUSED,
  CHANNELS_UNAVAILABLE,
  CATEGORIES_UNAVAILABLE,
  GENERAL_CHANNEL_NOTE,
  SPEAK_ROLE_LISTENERS_NOTE,
  channelsReadFailureText(null),
  channelWriteRefusalText("failed", CHANNEL_CREATE_FAILED),
  channelWriteRefusalText("failed", CHANNEL_SAVE_FAILED),
  channelWriteRefusalText("failed", CHANNEL_REMOVE_FAILED),
  channelWriteRefusalText("failed", CHANNEL_MOVE_FAILED),
  channelWriteRefusalText("failed", CATEGORY_CREATE_FAILED),
  channelWriteRefusalText("failed", CATEGORY_REMOVE_FAILED),
  channelRemovalPrompt({ kind: "text", name: "Общий" }).description,
  channelRemovalPrompt({ kind: "voice", name: "Переговорная", participantCount: 3 }).description,
  categoryRemovalPrompt({ name: "Голос", channelCount: 2 }).description,
  categoryRemovalPrompt({ name: "Голос", channelCount: 0 }).description,
];
