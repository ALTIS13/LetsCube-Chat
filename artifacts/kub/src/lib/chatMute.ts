/**
 * Muting a chat: the rules, the durations and the words (D-167).
 *
 * The server half of this has been live since `20260527_push_notifications_foundation.sql`
 * and nothing has ever used it. `public.chat_notification_preferences` holds a
 * row per person per chat with `push_enabled` and `muted_until`, four own-row
 * policies scoped to the caller, and `public._notification_push_allowed` — the
 * gate every push passes through — already reads it:
 *
 *     if found then
 *       if v_chat_pref.push_enabled is not true then return false; end if;
 *       if v_chat_pref.muted_until is not null
 *          and v_chat_pref.muted_until > now() then return false; end if;
 *     end if;
 *
 * Three facts follow from those six lines, and every one of them is a contract
 * this module keeps rather than a preference it expresses:
 *
 *   1. **No row is no mute.** `if found` guards both conditions, so a chat with
 *      no preference row is not muted, and asking for one is not a state.
 *   2. **The two conditions are checked in that order.** A row carrying
 *      `push_enabled = false` is refused before `muted_until` is looked at, so
 *      a mute with no end wins over any timestamp beside it. A client that
 *      ordered them the other way would draw a chat as muted-until-Tuesday
 *      while the server silences it forever.
 *   3. **`muted_until` in the past is not muted.** The comparison is
 *      `> now()`, and a client that treated any non-null value as a mute would
 *      show a silenced chat that is in fact delivering.
 *
 * What the interface used to do instead: `localStorage['ng_muted']`, a bare
 * array of chat ids with nobody's name on it. So a chat muted on a phone read
 * as unmuted on a computer, clearing the browser's data wiped every mute from
 * the screen while the server kept them, and a failed write left a mute that
 * worked on one device and nowhere else with nothing anywhere saying so.
 *
 * This module holds the half of the repair that is made of decisions rather
 * than of network: whether a row means muted *now*, what the durations are,
 * the sentence naming when a mute ends, the precedence between a cached answer
 * and a server one, and the sentences a refusal is allowed to say. Its only
 * import is `plainMessages.ts`, which imports nothing either — the arrangement
 * `personalModeration.ts` and `chatSettings.ts` use, and for the same reason: a
 * decision made of words has no business pulling React into a `node --test`
 * process, and a check that cannot be reached from a test is a gap in the
 * module boundary rather than a gap in the suite.
 */

import { plainFailure } from "./plainMessages.ts";

// ---------------------------------------------------------------------------
// What a preference row is
// ---------------------------------------------------------------------------

/**
 * The two columns that decide delivery, and nothing else.
 *
 * `created_at` and `updated_at` are the table's own bookkeeping — the
 * `before update` trigger rewrites the second whatever the client sends — and
 * the primary key is how the row was found. Neither is a decision.
 */
export interface ChatMutePreference {
  readonly pushEnabled: boolean;
  /** ISO 8601, or null for a mute with no end and for no mute at all. */
  readonly mutedUntil: string | null;
}

/** What the interface asks: is this chat silent now, and until when. */
export interface ChatMuteState {
  readonly muted: boolean;
  /** When it lifts, in milliseconds. Null both for «навсегда» and for «не отключены». */
  readonly until: number | null;
}

const NOT_MUTED: ChatMuteState = Object.freeze({ muted: false, until: null });
const MUTED_FOREVER: ChatMuteState = Object.freeze({ muted: true, until: null });

/** The row an unmute writes: delivery on, no end date left behind. */
export const CHAT_MUTE_OFF: ChatMutePreference = Object.freeze({ pushEnabled: true, mutedUntil: null });

/** A timestamp the client can compare, or null when there is nothing to compare. */
function untilMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The same two conditions the database applies, in the same order.
 *
 * Written as three returns rather than one boolean expression because the
 * order is the contract: swapping them changes what a row with
 * `push_enabled = false` and a past `muted_until` means, and a single `||`
 * would hide that behind short-circuit evaluation nobody reads.
 */
export function chatMuteState(
  pref: ChatMutePreference | null | undefined,
  nowMs: number,
): ChatMuteState {
  // `if found then` — a chat nobody has set a preference for is not muted.
  if (!pref) return NOT_MUTED;
  // `if v_chat_pref.push_enabled is not true then return false`.
  if (pref.pushEnabled !== true) return MUTED_FOREVER;
  // `if v_chat_pref.muted_until is not null and v_chat_pref.muted_until > now()`.
  const until = untilMs(pref.mutedUntil);
  if (until !== null && until > nowMs) return { muted: true, until };
  return NOT_MUTED;
}

export function isChatMuted(pref: ChatMutePreference | null | undefined, nowMs: number): boolean {
  return chatMuteState(pref, nowMs).muted;
}

// ---------------------------------------------------------------------------
// The durations
// ---------------------------------------------------------------------------

export type ChatMuteOptionId = "hour" | "workday" | "tomorrow" | "forever";

export interface ChatMuteOption {
  readonly id: ChatMuteOptionId;
  readonly label: string;
}

/**
 * Four, and the argument for each.
 *
 * A list of durations is easy to pad and every extra one costs a person a
 * choice they did not want to make, so each of these answers a situation people
 * actually name out loud:
 *
 *   - **час** — a meeting, a call, a queue. The shortest span worth the two
 *     presses it takes.
 *   - **8 часов** — a working day, or a night. The one duration that covers
 *     «до вечера» and «до утра» without asking which.
 *   - **до завтра** — the only one people say in words rather than in hours,
 *     and the reason `muted_until` has to be computed from the wall clock
 *     instead of added to it.
 *   - **навсегда** — the state the product already had. Taking it away to make
 *     room for durations would be a feature removed in the name of adding one.
 *
 * There is deliberately no «на 2 дня» and no «настроить». The first is a span
 * nobody reaches for between «до завтра» and «навсегда»; the second is a date
 * picker, which is a screen, and a screen for this is worth building when
 * somebody asks for it rather than before.
 */
export const CHAT_MUTE_OPTIONS: readonly ChatMuteOption[] = Object.freeze([
  Object.freeze({ id: "hour", label: "На 1 час" }),
  Object.freeze({ id: "workday", label: "На 8 часов" }),
  Object.freeze({ id: "tomorrow", label: "До завтра" }),
  Object.freeze({ id: "forever", label: "Навсегда" }),
]) as readonly ChatMuteOption[];

const HOUR_MS = 60 * 60 * 1000;

/**
 * What «до завтра» ends at: nine in the morning of the next calendar day,
 * local time.
 *
 * The next calendar day and not «the next time it is 09:00», which would make
 * an option labelled «До завтра» end this morning for somebody who pressed it
 * at three. The cost of that choice is its mirror image — pressed at 00:10 it
 * runs thirty-three hours — and it is paid in the open: every surface that
 * offers this prints the moment it ends beside it, so the long night is a thing
 * the person reads before pressing rather than discovers afterwards.
 */
const TOMORROW_HOUR = 9;

/** The row to write for a choice. Local time throughout; `muted_until` is timestamptz. */
export function chatMutePreferenceFor(option: ChatMuteOptionId, nowMs: number): ChatMutePreference {
  if (option === "forever") return { pushEnabled: false, mutedUntil: null };
  if (option === "hour") return { pushEnabled: true, mutedUntil: new Date(nowMs + HOUR_MS).toISOString() };
  if (option === "workday") return { pushEnabled: true, mutedUntil: new Date(nowMs + 8 * HOUR_MS).toISOString() };
  const now = new Date(nowMs);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, TOMORROW_HOUR, 0, 0, 0);
  return { pushEnabled: true, mutedUntil: tomorrow.toISOString() };
}

/**
 * The next instant at which any of these rows stops meaning what it means now.
 *
 * A timed mute is the one piece of interface state that changes with nothing
 * happening, and a screen left open across the moment it lifts would go on
 * claiming a chat is silent. One timer to the earliest future end is enough —
 * a per-second tick would re-render the list sixty times a minute to change
 * nothing.
 */
export function nextChatMuteChange(
  prefs: Readonly<Record<string, ChatMutePreference>>,
  nowMs: number,
): number | null {
  let earliest: number | null = null;
  for (const pref of Object.values(prefs)) {
    if (pref.pushEnabled !== true) continue;
    const until = untilMs(pref.mutedUntil);
    if (until === null || until <= nowMs) continue;
    if (earliest === null || until < earliest) earliest = until;
  }
  return earliest;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** «9:00», «21:05» — the wall clock, without a leading zero on the hour. */
function clock(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * «до 21:00», «до завтра, 9:00», «до 17 сентября, 9:00».
 *
 * Built from the Date's own local getters rather than from
 * `toLocaleString("ru-RU", …)`: the locale formatter is a different string on
 * every engine and a different one again in a `node --test` process, and the
 * only thing this has to be is the same sentence everywhere it is printed.
 */
export function muteEndsLabel(untilMsValue: number, nowMs: number): string {
  const end = new Date(untilMsValue);
  const now = new Date(nowMs);
  if (sameDay(end, now)) return `до ${clock(end)}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(end, tomorrow)) return `до завтра, ${clock(end)}`;
  return `до ${end.getDate()} ${MONTHS_GENITIVE[end.getMonth()]}, ${clock(end)}`;
}

/** «до 21:00» / «навсегда» / null when nothing is off. The second line of a menu item. */
export function chatMuteDetail(state: ChatMuteState, nowMs: number): string | null {
  if (!state.muted) return null;
  return state.until === null ? "навсегда" : muteEndsLabel(state.until, nowMs);
}

export const MUTE_ACTION_LABEL = "Отключить уведомления";
export const UNMUTE_ACTION_LABEL = "Включить уведомления";
/** The head of the duration list, so the person can see what they opened. */
export const MUTE_CHOICE_TITLE = "Отключить уведомления";
export const MUTE_CHOICE_BACK = "Назад";

/** The one item a menu shows for this chat before anything is chosen. */
export function chatMuteActionLabel(state: ChatMuteState): string {
  return state.muted ? UNMUTE_ACTION_LABEL : MUTE_ACTION_LABEL;
}

/**
 * What the confirmation says once the write has landed.
 *
 * It names the end, because the moment a person needs to know it is the moment
 * they chose it — and «до завтра, 9:00» after pressing «До завтра» at ten past
 * midnight is the whole reason that option is safe to offer.
 */
export function chatMuteFeedbackTitle(state: ChatMuteState, nowMs: number): string {
  if (!state.muted) return "Уведомления включены";
  const detail = chatMuteDetail(state, nowMs);
  return detail === "навсегда" ? "Уведомления отключены" : `Уведомления отключены ${detail}`;
}

/** The confirmation for a choice, without the caller rebuilding the row first. */
export function chatMuteChoiceTitle(option: ChatMuteOptionId | "off", nowMs: number): string {
  if (option === "off") return chatMuteFeedbackTitle(NOT_MUTED, nowMs);
  return chatMuteFeedbackTitle(chatMuteState(chatMutePreferenceFor(option, nowMs), nowMs), nowMs);
}

// ---------------------------------------------------------------------------
// What the three surfaces offer
// ---------------------------------------------------------------------------

export interface ChatMuteMenuEntry {
  readonly id: "mute" | "unmute" | "back" | ChatMuteOptionId;
  readonly label: string;
  /** A second line: when the mute ends, or null. */
  readonly detail: string | null;
}

/**
 * The rows to draw, for a menu that has not been opened into the durations and
 * for one that has.
 *
 * Three surfaces offer this — the chat header's menu, the contact card and the
 * chat list's row menu — and each draws its own kind of row, so what is shared
 * is the decision rather than the markup. Without this they were three copies
 * of one `isMuted ? … : …`, which is how the header and the card came to say
 * the same thing about two different sources.
 *
 * The muted state is one row and not five: a person who has already silenced a
 * chat wants it back, and offering «на 1 час» to somebody it is already off for
 * is a list of ways to change a decision they did not come to change. Changing
 * the duration is unmute, then mute — two presses, and both of them honest
 * about what the account will hold afterwards.
 */
export function chatMuteMenuEntries(
  state: ChatMuteState,
  choosing: boolean,
  nowMs: number,
): readonly ChatMuteMenuEntry[] {
  if (choosing) {
    return [
      { id: "back", label: MUTE_CHOICE_BACK, detail: null },
      ...CHAT_MUTE_OPTIONS.map((option) => ({ id: option.id, label: option.label, detail: null })),
    ];
  }
  if (state.muted) {
    return [{ id: "unmute", label: UNMUTE_ACTION_LABEL, detail: chatMuteDetail(state, nowMs) }];
  }
  return [{ id: "mute", label: MUTE_ACTION_LABEL, detail: null }];
}

// ---------------------------------------------------------------------------
// What a failure is allowed to say
// ---------------------------------------------------------------------------

export const MUTE_FAILED = "Не удалось отключить уведомления";
export const UNMUTE_FAILED = "Не удалось включить уведомления";
export const MUTES_READ_FAILED = "Не удалось прочитать настройки уведомлений";
/** No session, so there is no row to write and nothing a retry would change. */
export const MUTE_SIGNED_OUT = "Сессия не найдена. Войдите снова.";

/**
 * The sentence for a refused write, in the shape `personalModeration.ts` uses.
 *
 * `plainFailure` keeps whatever the mapper recognised — a dead network, an
 * expired session, missing rights are each worth more than a generic line — and
 * replaces anything naming a table, a function or a migration with the plain
 * one. A raw Postgres message never reaches the screen.
 */
export function muteRefusalText(muting: boolean, mapped?: string | null): string {
  const failed = muting ? MUTE_FAILED : UNMUTE_FAILED;
  return plainFailure(mapped, `${failed}. Попробуйте ещё раз.`);
}

export function mutesReadFailureText(mapped?: string | null): string {
  return plainFailure(mapped, `${MUTES_READ_FAILED}. Попробуйте позже.`);
}

/** Every sentence this module can put on screen, for the test that reads them all. */
export const CHAT_MUTE_MESSAGES: readonly string[] = Object.freeze([
  MUTE_ACTION_LABEL,
  UNMUTE_ACTION_LABEL,
  MUTE_CHOICE_TITLE,
  MUTE_CHOICE_BACK,
  MUTE_SIGNED_OUT,
  muteRefusalText(true),
  muteRefusalText(false),
  mutesReadFailureText(),
  ...CHAT_MUTE_OPTIONS.map((option) => option.label),
]) as readonly string[];

// ---------------------------------------------------------------------------
// Whose answer wins
// ---------------------------------------------------------------------------

/**
 * Where the rows on screen came from.
 *
 * This is the whole of the defect stated as a type. «cache» is what a browser
 * remembered so the first paint is not blank; «server» is what the account
 * actually holds. The one rule that matters is that the second replaces the
 * first and the first never replaces the second — and it is a rule rather than
 * an ordering accident, because a cache read is synchronous and a network read
 * is not, so the two arrive in whichever order the machine feels like.
 */
export type ChatMuteSource = "none" | "cache" | "server";

export interface ChatMuteSnapshot {
  /** Whose rows these are. Null before anybody is signed in. */
  readonly userId: string | null;
  readonly source: ChatMuteSource;
  readonly prefs: Readonly<Record<string, ChatMutePreference>>;
  /** What to say if the read failed, or null. */
  readonly error: string | null;
}

const NO_PREFS: Readonly<Record<string, ChatMutePreference>> = Object.freeze({});

export const EMPTY_CHAT_MUTES: ChatMuteSnapshot = Object.freeze({
  userId: null,
  source: "none",
  prefs: NO_PREFS,
  error: null,
});

/**
 * Reset when the person changes.
 *
 * Signing out empties it rather than leaving the previous account's mutes on
 * screen, and signing in as somebody else does the same: two accounts in one
 * browser must never see each other's silenced chats, which is the half of
 * this defect a cache makes easy to get wrong.
 */
export function chatMutesForUser(state: ChatMuteSnapshot, userId: string | null): ChatMuteSnapshot {
  if (state.userId === userId) return state;
  if (!userId) return EMPTY_CHAT_MUTES;
  return { userId, source: "none", prefs: NO_PREFS, error: null };
}

/**
 * Show what the browser remembered, but only while nothing better has arrived.
 *
 * Two refusals, and neither is belt-and-braces:
 *
 *   - a cache written by another account is ignored, because a shared browser
 *     would otherwise show one person another person's silenced chats;
 *   - a cache is ignored once the server has answered, because the answer is
 *     the account and the cache is a guess about it.
 */
export function applyCachedMutes(
  state: ChatMuteSnapshot,
  cached: { userId: string; prefs: Readonly<Record<string, ChatMutePreference>> } | null,
  userId: string | null,
): ChatMuteSnapshot {
  const base = chatMutesForUser(state, userId);
  if (!cached || !userId) return base;
  if (cached.userId !== userId) return base;
  if (base.source === "server") return base;
  return { userId, source: "cache", prefs: cached.prefs, error: null };
}

/** A row as PostgREST hands it back. */
export interface ChatMutePreferenceRow {
  chat_id?: string | null;
  push_enabled?: boolean | null;
  muted_until?: string | null;
}

/**
 * The account's own answer, which replaces everything.
 *
 * Replaces rather than merges: a row the server did not send is a row the
 * account does not have, and merging would keep a mute alive after it was
 * lifted somewhere else — the same defect as the cache, arriving by a
 * politer road.
 */
export function applyServerMutes(
  state: ChatMuteSnapshot,
  userId: string | null,
  rows: readonly ChatMutePreferenceRow[] | null | undefined,
): ChatMuteSnapshot {
  if (!userId) return EMPTY_CHAT_MUTES;
  const prefs: Record<string, ChatMutePreference> = {};
  for (const row of rows ?? []) {
    const chatId = typeof row?.chat_id === "string" ? row.chat_id : null;
    if (!chatId) continue;
    prefs[chatId] = { pushEnabled: row.push_enabled !== false, mutedUntil: row.muted_until ?? null };
  }
  return { userId, source: "server", prefs: Object.freeze(prefs), error: null };
}

/**
 * One chat's row, changed here.
 *
 * Used for the optimistic write and for putting the old row back when the write
 * is refused, so a failure can never leave the screen claiming a mute the
 * account does not have. It does not promote the source: showing a chat the way
 * this device just set it is not the same as having heard from the account.
 */
export function applyLocalMute(
  state: ChatMuteSnapshot,
  userId: string | null,
  chatId: string,
  pref: ChatMutePreference | null,
): ChatMuteSnapshot {
  if (!userId || state.userId !== userId) return state;
  const prefs: Record<string, ChatMutePreference> = { ...state.prefs };
  if (pref === null) delete prefs[chatId];
  else prefs[chatId] = pref;
  return { ...state, prefs: Object.freeze(prefs) };
}

export function applyMutesError(state: ChatMuteSnapshot, userId: string | null, message: string): ChatMuteSnapshot {
  const base = chatMutesForUser(state, userId);
  return { ...base, error: message };
}

/** This chat's row, or null when the account has none for it. */
export function chatMuteFor(state: ChatMuteSnapshot, chatId: string): ChatMutePreference | null {
  return state.prefs[chatId] ?? null;
}

/**
 * Every chat that is silent at this instant, sorted.
 *
 * Sorted so that two calls a second apart give equal arrays while nothing has
 * changed: the store compares the result against the one it holds and keeps the
 * old array when they match, and the sidebar renders a row per change of that
 * array's identity (D-088).
 */
export function mutedChatIdsAt(state: ChatMuteSnapshot, nowMs: number): string[] {
  const ids: string[] = [];
  for (const [chatId, pref] of Object.entries(state.prefs)) {
    if (chatMuteState(pref, nowMs).muted) ids.push(chatId);
  }
  return ids.sort();
}

// ---------------------------------------------------------------------------
// The offline cache
// ---------------------------------------------------------------------------

/**
 * A new key, and the old one is not read.
 *
 * `ng_muted` was a bare array of chat ids with nobody's name on it, so there is
 * no way to tell whose mutes it holds — and showing them to whoever opens the
 * browser next is the defect, not a migration path. It is left where it is
 * rather than deleted: reading it is what was wrong, and nothing reads it now.
 */
export const CHAT_MUTE_CACHE_KEY = "kub_chat_mutes";

/** Anything unreadable is no cache at all; a first paint without mutes is correct-looking. */
export function readCachedMutes(
  raw: string | null | undefined,
): { userId: string; prefs: Readonly<Record<string, ChatMutePreference>> } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { userId?: unknown; prefs?: unknown };
  if (typeof record.userId !== "string" || !record.userId) return null;
  if (!record.prefs || typeof record.prefs !== "object") return null;
  const prefs: Record<string, ChatMutePreference> = {};
  for (const [chatId, value] of Object.entries(record.prefs as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { pushEnabled?: unknown; mutedUntil?: unknown };
    prefs[chatId] = {
      pushEnabled: entry.pushEnabled !== false,
      mutedUntil: typeof entry.mutedUntil === "string" ? entry.mutedUntil : null,
    };
  }
  return { userId: record.userId, prefs: Object.freeze(prefs) };
}

/** What to write back, or null when there is no account to write it under. */
export function serializeCachedMutes(state: ChatMuteSnapshot): string | null {
  if (!state.userId) return null;
  return JSON.stringify({ userId: state.userId, prefs: state.prefs });
}
