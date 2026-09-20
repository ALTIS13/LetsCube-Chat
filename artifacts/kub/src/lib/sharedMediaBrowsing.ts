/**
 * Where you are in a chat's shared media, and what the surface says about it.
 *
 * D-171. The media sub-view had no dates, no month marker and no fast scroll,
 * and the viewer took a single item — `media: MediaViewerItem | null` — so
 * there was no next, no previous, no index and no count. Opening the third
 * photo of eight hundred told a person nothing about where they were and left
 * them no way to move. Paging was an observer sentinel doubling as a
 * «Загрузить ещё» button, 24 items at a time, and a page that failed to arrive
 * removed that button — so a dead network and the end of the list were drawn
 * as the same thing.
 *
 * Three mechanics are answered here, and the point of each is that it is a
 * decision about **place**, not a label bolted onto the old structure:
 *
 *   1. a viewer item is a position in a sequence, so «12 из 1543» is the
 *      answer to a question the reader actually has, and stepping past the end
 *      of what is loaded is a request for more rather than a wall;
 *   2. the grid is divided by month, and the month a reader is currently in is
 *      shown while they scroll and fades when they stop;
 *   3. the end of the list is a state with five distinct answers, one of which
 *      is «this failed» — because an empty answer and an answer nobody could
 *      get are different facts (D-140, D-193) and the surface has to say which.
 *
 * Its only import is `plainMessages.ts`, which imports nothing either — the
 * arrangement `personalModeration.ts` and `serverChannels.ts` use. A decision
 * made of words has no business pulling React into a `node --test` process, and
 * a check that cannot be reached from a test is a gap in the module boundary
 * rather than a gap in the suite.
 *
 * Two things this module deliberately does **not** do:
 *
 *   - it does not import `messageMediaSections.ts`, even though that module
 *     also imports nothing and already owns `formatMediaCount`. The brief asked
 *     for one import and this file keeps to it; the hedging rule the two share
 *     — a `+` only on a guessed total — is pinned equal by the unit test, which
 *     calls both, so the two cannot drift without turning something red.
 *   - it does not reach for `Intl`. The twelve month names are written out
 *     below, so the marker reads the same on a machine with trimmed ICU data as
 *     on one without, and the test does not depend on the runtime's locale.
 */

import { plainFailure } from "./plainMessages.ts";

// ---------------------------------------------------------------------------
// The shape this module needs from a row
// ---------------------------------------------------------------------------

/**
 * Structural on purpose, exactly as `MessageMediaRow` is: `Message` from the
 * generated database types satisfies it and nothing has to be imported here.
 * `created_at` is optional because a row that has not been stamped yet is a
 * state the grid can be in for a frame, and grouping must not throw over it.
 */
export interface DatedMediaRow {
  id: string;
  created_at?: string | null;
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

/**
 * Nominative, because a marker standing on its own is a heading and not a
 * date in a sentence. «14 сентября» is the genitive and belongs to
 * `mediaDayLabel` below; «Сентябрь 2026» is what a heading says.
 */
export const RUSSIAN_MONTHS_NOMINATIVE: readonly string[] = Object.freeze([
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]);

/** Genitive, for a day: «14 сентября». */
export const RUSSIAN_MONTHS_GENITIVE: readonly string[] = Object.freeze([
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]);

/**
 * A stamp as a local date, or null when there is nothing usable.
 *
 * Local rather than UTC deliberately: the reader's month is the one their
 * clock is in, and a photo sent at 01:00 on the first of October in Moscow
 * belongs under «Октябрь» for the person who sent it, not under «Сентябрь».
 */
function localDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `2026-09`, the key a month group is held under.
 *
 * A key rather than the label, so two months with the same name in different
 * years can never collapse into one group — which is what sorting or grouping
 * on «Сентябрь» alone would do to a chat older than a year.
 */
export function mediaMonthKey(value: string | null | undefined): string | null {
  const date = localDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * «Сентябрь» inside the current year, «Сентябрь 2026» outside it.
 *
 * The year is dropped only where it carries nothing: a reader scrolling this
 * year's photos does not need 2026 repeated over every group, and a reader who
 * has scrolled back past New Year needs it on every group that is not this
 * year's. `reference` is the clock, passed in rather than read, so the rule is
 * testable without pinning a machine's date.
 */
export function mediaMonthLabel(value: string | null | undefined, reference: Date | number = Date.now()): string | null {
  const date = localDate(value);
  if (!date) return null;
  const now = reference instanceof Date ? reference : new Date(reference);
  const month = RUSSIAN_MONTHS_NOMINATIVE[date.getMonth()];
  return date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

/** «14 сентября», and «14 сентября 2025» outside the current year. */
export function mediaDayLabel(value: string | null | undefined, reference: Date | number = Date.now()): string | null {
  const date = localDate(value);
  if (!date) return null;
  const now = reference instanceof Date ? reference : new Date(reference);
  const day = `${date.getDate()} ${RUSSIAN_MONTHS_GENITIVE[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** The month a group of rows stands under, and the rows themselves. */
export interface MediaMonthGroup<TRow extends DatedMediaRow> {
  /** `2026-09`, or `""` for the rows whose date could not be read. */
  key: string;
  /** «Сентябрь 2026», or the undated group's own heading. */
  label: string;
  items: TRow[];
}

/**
 * What an undated row stands under.
 *
 * Not silently dropped and not silently folded into the newest month. A row
 * whose stamp cannot be read is a row the surface knows nothing about, and
 * hiding it would make the grid disagree with the count on the row that opened
 * it — this entry's own defect pointing the other way.
 */
export const MEDIA_UNDATED_GROUP_LABEL = "Без даты";

/**
 * The rows divided into months, newest first, each month's rows kept in the
 * order they arrived.
 *
 * The order of the rows is the caller's: the panel fetches
 * `created_at desc`, so a stable pass preserves it and this function never
 * re-sorts. Re-sorting here would hide a paging bug rather than show it.
 */
export function groupMediaByMonth<TRow extends DatedMediaRow>(
  rows: readonly TRow[],
  reference: Date | number = Date.now(),
): MediaMonthGroup<TRow>[] {
  const groups: MediaMonthGroup<TRow>[] = [];
  const byKey = new Map<string, MediaMonthGroup<TRow>>();
  for (const row of rows) {
    const key = mediaMonthKey(row.created_at) ?? "";
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: key === "" ? MEDIA_UNDATED_GROUP_LABEL : mediaMonthLabel(row.created_at, reference)!,
        items: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(row);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// The floating month marker
// ---------------------------------------------------------------------------

/** Where a month group's heading sits. */
export interface MediaMonthAnchor {
  key: string;
  label: string;
  /**
   * The heading's offset, in pixels, in whatever frame `line` below is measured
   * in. The panel measures both against the top of the scroller's viewport, so
   * `top` is negative for a heading that has already scrolled past it and
   * `line` is 0; a caller working in content coordinates would pass the
   * heading's offset from the top of the content and the scroll offset as the
   * line. The arithmetic is the same either way and neither reads a scroll
   * position out of this module.
   */
  top: number;
}

/**
 * Which month the reader is currently in.
 *
 * The last heading at or above the reading line wins, which is what a sticky
 * heading would show if one were drawn. Above the first heading the answer is
 * the first month rather than nothing: a scroller resting at the top is still
 * *in* a month, and a marker that reads as empty there would be a fourth
 * meaning for an absent marker.
 *
 * A tolerance of one pixel, because a heading's measured offset and the scroll
 * offset are both fractional on a scaled display, and a marker that flickers
 * between two months on a half-pixel is worse than one that commits early.
 *
 * The lowest heading at or above the line is found by comparing, not by
 * stopping at the first one that is below it. The caller hands these over in
 * DOM order and they are therefore already ascending, but a search that
 * depends on that would answer confidently and wrongly the first time a
 * measurement arrived out of order — and the wrong month is exactly the kind of
 * thing nobody notices in a screenshot.
 */
export function currentMediaMonth(
  anchors: readonly MediaMonthAnchor[],
  line: number,
): MediaMonthAnchor | null {
  if (anchors.length === 0) return null;
  let found: MediaMonthAnchor | null = null;
  for (const anchor of anchors) {
    if (anchor.top > line + 1) continue;
    if (!found || anchor.top > found.top) found = anchor;
  }
  if (found) return found;
  // Above every heading: the first month, which is the one the reader is
  // looking at. An empty answer here would be a fourth meaning for a missing
  // marker.
  let first = anchors[0];
  for (const anchor of anchors) if (anchor.top < first.top) first = anchor;
  return first;
}

/**
 * How long the marker stays after the scrolling stops.
 *
 * It appears *with* the scroll and fades when it stops, so it is never chrome
 * standing over the pictures of a person who is reading rather than looking.
 */
export const MEDIA_MONTH_MARKER_LINGER_MS = 900;

/**
 * Whether the marker is shown, given when the scroller last moved.
 *
 * A function rather than a constant the component compares against, so the
 * rule itself is what the test pins: changing the number changes what this
 * answers, and the component asks this rather than doing the arithmetic.
 */
export function mediaMonthMarkerShown(lastScrollAt: number | null, now: number): boolean {
  if (lastScrollAt === null) return false;
  return now - lastScrollAt < MEDIA_MONTH_MARKER_LINGER_MS;
}

// ---------------------------------------------------------------------------
// A place in a sequence
// ---------------------------------------------------------------------------

/** Everything the decisions below need to know about where the reader is. */
export interface MediaSequenceState {
  /** Zero-based, among the rows that are loaded. */
  index: number;
  /** How many rows are loaded. */
  loaded: number;
  /** How many this kind holds in the chat, where the server counted them. */
  total: number;
  /** Whether `total` is the server's count or a lower bound from the loaded page. */
  totalExact: boolean;
  /** More exist on the server than are loaded. */
  hasMore: boolean;
  /** A page is on its way. */
  loading?: boolean;
  /**
   * Which end of the loaded run the unloaded ones are at.
   *
   * `"end"` — the default and the grid's case: «Общие медиа» is newest-first
   * and its next page is appended, so the far end is the forward one.
   *
   * `"start"` — the conversation's case (D-288). Its media are chronological
   * and the next page of history is *prepended*, so the far end is the backward
   * one. Without this the two surfaces would have to disagree about what
   * «forward» means, which is how a reader ends up walking up a conversation
   * they were reading down.
   */
  moreAt?: "start" | "end";
}

/**
 * «12 из 1543», and «12 из 24+» while the total is only a lower bound.
 *
 * The hedge is the one the counted rows already use — `24+` reads as «at least
 * 24» — so the sub-view and the row that opened it speak the same way about the
 * same uncertainty. `formatMediaCount` in `messageMediaSections.ts` is the
 * other half of that rule and the unit test pins the two equal.
 *
 * The total is raised to the position whenever the position is past it. A
 * server total is a snapshot and the loaded rows are the present, so «25 из 24»
 * is a number the reader can disprove by looking; `buildMessageMediaSections`
 * takes the same `Math.max` for the same reason.
 */
export function mediaPositionLabel(state: MediaSequenceState): string {
  const position = Math.max(1, Math.trunc(state.index) + 1);
  const total = Math.max(Math.trunc(state.total), position, Math.trunc(state.loaded));
  return `${position} из ${total}${state.totalExact ? "" : "+"}`;
}

/** What pressing «next» or «previous» actually does. */
export type MediaStepPlan =
  /** Show the item at `index`. */
  | { kind: "move"; index: number }
  /** There is nothing loaded to move to, but the server has more: ask for it. */
  | { kind: "load" }
  /** The end, in that direction. */
  | { kind: "none" };

/**
 * Where a step lands.
 *
 * Reaching the end of what has been loaded loads more rather than stopping,
 * which is mechanic 1: a sequence whose last loaded item is a wall is the same
 * defect as a grid whose last loaded row is the end of the chat. A step is
 * refused while a page is already in flight, so holding the arrow down cannot
 * queue a request per press.
 */
export function planMediaStep(state: MediaSequenceState, delta: -1 | 1): MediaStepPlan {
  const index = Math.trunc(state.index);
  const loaded = Math.trunc(state.loaded);
  // Whether the far end in this direction is the one with unloaded items behind
  // it. `moreAt` defaults to `"end"`, so a caller that never heard of it — the
  // shared-media grid — is answered exactly as before.
  const moreThisWay = state.hasMore && (delta === -1 ? state.moreAt === "start" : (state.moreAt ?? "end") === "end");
  if (delta === -1) {
    if (index > 0) return { kind: "move", index: index - 1 };
    return moreThisWay ? (state.loading ? { kind: "none" } : { kind: "load" }) : { kind: "none" };
  }
  if (index + 1 < loaded) return { kind: "move", index: index + 1 };
  return moreThisWay ? (state.loading ? { kind: "none" } : { kind: "load" }) : { kind: "none" };
}

/**
 * Whether a control is offered at all.
 *
 * Deliberately not `planMediaStep(...).kind !== "none"`: a step that is
 * refused *because a page is in flight* must still leave the control on
 * screen — a button that disappears for the second and a half a request takes
 * is a button that moves under the finger reaching for it. So a control is
 * offered whenever the direction has anywhere to go, loaded or loadable, and
 * `planMediaStep` decides what the press does.
 */
export function mediaStepOffered(state: MediaSequenceState, delta: -1 | 1): boolean {
  const index = Math.trunc(state.index);
  const moreThisWay = state.hasMore && (delta === -1 ? state.moreAt === "start" : (state.moreAt ?? "end") === "end");
  if (delta === -1) return index > 0 || moreThisWay;
  return index + 1 < Math.trunc(state.loaded) || moreThisWay;
}

/**
 * How far a finger has to travel sideways before it is a step.
 *
 * `TAP_SLOP_PX` in `mediaZoom.ts` is 8, so anything at or below that is still a
 * tap; 56 is comfortably clear of it and of the vertical wobble a thumb adds to
 * a horizontal drag on a phone held one-handed.
 */
export const MEDIA_SWIPE_STEP_PX = 56;

/**
 * Which way a swipe moves, or null when it moves nothing.
 *
 * Direction, not just distance: a drag that is mostly vertical is somebody
 * scrolling or dismissing, and answering it with a step is the thing that makes
 * a gallery feel like it is fighting the hand. The picture follows the finger,
 * so a drag to the **left** goes forward, exactly as a page turns.
 *
 * Only reached at rest. Zoomed, `claimsDrag` in `mediaZoom.ts` takes the drag
 * for panning and stops it propagating, which is the arrangement that keeps a
 * pan and a swipe from ever answering the same finger.
 */
export function mediaSwipeStep(dx: number, dy: number): -1 | 1 | null {
  if (Math.abs(dx) < MEDIA_SWIPE_STEP_PX) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// The end of the list, and what is at it
// ---------------------------------------------------------------------------

/**
 * A page that never arrived.
 *
 * Plain, and about the reader's situation rather than the request: they can
 * try again and that really may work, which is the one case where «ещё раз»
 * is not a false promise.
 */
export const SHARED_MEDIA_PAGE_FAILED = "Не удалось загрузить дальше.";
export const SHARED_MEDIA_PAGE_FAILED_ACTION = "Повторить";

/**
 * The first page never arrived, so the list is empty for a reason the list
 * cannot show by being empty (D-140, D-193).
 */
export const SHARED_MEDIA_LOAD_FAILED = "Не удалось загрузить медиа этого чата.";
export const SHARED_MEDIA_LOAD_FAILED_DETAIL = "Проверьте соединение и попробуйте ещё раз.";

/** The list really is empty, and was read successfully to establish it. */
export const SHARED_MEDIA_EMPTY = "Медиа пока нет";

/**
 * The server answered, and answered with nothing, while its own total still
 * says there is more.
 *
 * A stale count, or rows deleted since they were counted. It is not a failure
 * and not the end either, and the old surface drew it as the end: the sentinel
 * simply vanished. What is true is that nothing further arrived, so that is
 * what it says.
 */
export const SHARED_MEDIA_NO_MORE_AVAILABLE = "Больше ничего не удалось загрузить.";

/** What stands at the end of the list. */
export type MediaTailState =
  /** Nothing at all: everything this kind holds is on screen. */
  | { kind: "complete" }
  /** A page is on its way. */
  | { kind: "loading" }
  /** More exists and the reader has not reached it yet. */
  | { kind: "more" }
  /** The last request failed, and can be repeated. */
  | { kind: "failed"; message: string; action: string }
  /** The server had nothing further to give despite its own total. */
  | { kind: "exhausted"; message: string };

export interface MediaTailInput {
  /** More exist on the server than are loaded. */
  hasMore: boolean;
  /** A page is in flight. */
  loading: boolean;
  /** The last page request came back as an error. */
  failed: boolean;
  /** A page came back empty while `hasMore` still said otherwise. */
  stalled: boolean;
}

/**
 * The end of the list, as one answer.
 *
 * The order is the order of precedence and every step of it was a way the old
 * surface lied. A failure outranks «more», because a list that still offers to
 * load after a refusal says nothing about the refusal. «Loading» outranks
 * «more» so the reader is told a request is out rather than invited to make a
 * second one. `stalled` outranks `hasMore` because `hasMore` is the thing that
 * turned out to be wrong.
 */
export function mediaTailState(input: MediaTailInput): MediaTailState {
  if (input.failed) {
    return { kind: "failed", message: SHARED_MEDIA_PAGE_FAILED, action: SHARED_MEDIA_PAGE_FAILED_ACTION };
  }
  if (input.loading) return { kind: "loading" };
  if (input.stalled) return { kind: "exhausted", message: SHARED_MEDIA_NO_MORE_AVAILABLE };
  if (input.hasMore) return { kind: "more" };
  return { kind: "complete" };
}

/** What stands where the rows would be, when there are none. */
export interface MediaEmptyState {
  title: string;
  detail?: string;
  /** Whether a control to try again belongs beside it. */
  retry: boolean;
}

/**
 * Empty, or unreadable — and never the two drawn as one thing.
 *
 * «Медиа пока нет» is a claim about the chat. A surface that prints it after a
 * refused query is making that claim having read nothing, which is exactly the
 * defect D-172 found in the invitations block and D-140 and D-193 found
 * elsewhere. `failed` is the caller's answer to «did the read succeed», and it
 * is a third state rather than a flag on the other two.
 */
export function mediaEmptyState(failed: boolean): MediaEmptyState {
  if (!failed) return { title: SHARED_MEDIA_EMPTY, retry: false };
  return { title: SHARED_MEDIA_LOAD_FAILED, detail: SHARED_MEDIA_LOAD_FAILED_DETAIL, retry: true };
}

/**
 * A refusal from the database, as a sentence for this surface.
 *
 * `plainFailure` keeps anything a person can act on — a dead network, an
 * expired session, missing rights — and replaces the mapper's generic sentence
 * and anything naming an internal with this surface's own words. Which is why
 * this module imports `plainMessages.ts` and nothing else.
 */
export function sharedMediaFailure(message: string | null | undefined): string {
  return plainFailure(message, SHARED_MEDIA_LOAD_FAILED);
}

/**
 * Every sentence this module shows, for the test that asserts none of them
 * explains the machine. The same list `plainMessages.ts` keeps, for the same
 * reason.
 */
export const SHARED_MEDIA_MESSAGES: readonly string[] = [
  SHARED_MEDIA_PAGE_FAILED,
  SHARED_MEDIA_PAGE_FAILED_ACTION,
  SHARED_MEDIA_LOAD_FAILED,
  SHARED_MEDIA_LOAD_FAILED_DETAIL,
  SHARED_MEDIA_EMPTY,
  SHARED_MEDIA_NO_MORE_AVAILABLE,
  MEDIA_UNDATED_GROUP_LABEL,
];
