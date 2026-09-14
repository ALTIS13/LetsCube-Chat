import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_MONTH_MARKER_LINGER_MS,
  MEDIA_SWIPE_STEP_PX,
  MEDIA_UNDATED_GROUP_LABEL,
  RUSSIAN_MONTHS_GENITIVE,
  RUSSIAN_MONTHS_NOMINATIVE,
  SHARED_MEDIA_EMPTY,
  SHARED_MEDIA_LOAD_FAILED,
  SHARED_MEDIA_LOAD_FAILED_DETAIL,
  SHARED_MEDIA_MESSAGES,
  SHARED_MEDIA_NO_MORE_AVAILABLE,
  SHARED_MEDIA_PAGE_FAILED,
  SHARED_MEDIA_PAGE_FAILED_ACTION,
  currentMediaMonth,
  groupMediaByMonth,
  mediaDayLabel,
  mediaEmptyState,
  mediaMonthKey,
  mediaMonthLabel,
  mediaMonthMarkerShown,
  mediaPositionLabel,
  mediaStepOffered,
  mediaSwipeStep,
  mediaTailState,
  planMediaStep,
  sharedMediaFailure,
  type DatedMediaRow,
  type MediaSequenceState,
} from "../../artifacts/kub/src/lib/sharedMediaBrowsing.ts";
import { formatMediaCount } from "../../artifacts/kub/src/lib/messageMediaSections.ts";
import { INTERNALS_PATTERN, MAPPER_GENERIC_FAILURE } from "../../artifacts/kub/src/lib/plainMessages.ts";

/**
 * D-171. Where a person is in a chat's shared media, and what the surface says
 * about it.
 *
 * Every stamp below is written as a **local** time with no zone suffix, e.g.
 * `2026-09-14T12:00:00`, which `new Date` reads as this machine's clock. That
 * is deliberate: the grouping is local, because the month a reader is in is the
 * one their own clock is in, and a test written in UTC would pass or fail by
 * the time zone the runner happened to be in.
 *
 * None of the data here is anybody's. The surface this covers is made of
 * people's media; every row is invented.
 */

const NOW = new Date("2026-09-14T12:00:00");

let nextId = 0;
function at(stamp: string | null): DatedMediaRow {
  nextId += 1;
  return { id: `m${nextId}`, created_at: stamp };
}

function sequence(partial: Partial<MediaSequenceState> = {}): MediaSequenceState {
  return { index: 0, loaded: 24, total: 24, totalExact: false, hasMore: false, ...partial };
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

test("a month key is the year and the month, so two Septembers never collapse", () => {
  assert.equal(mediaMonthKey("2026-09-14T12:00:00"), "2026-09");
  assert.equal(mediaMonthKey("2025-09-14T12:00:00"), "2025-09");
  // Zero-padded, or `2026-9` would sort after `2026-10`.
  assert.equal(mediaMonthKey("2026-01-31T23:00:00"), "2026-01");
  assert.notEqual(mediaMonthKey("2026-09-14T12:00:00"), mediaMonthKey("2025-09-14T12:00:00"));
});

test("an unreadable stamp has no month rather than a wrong one", () => {
  for (const value of [null, undefined, "", "не дата", "2026-13-45"]) {
    assert.equal(mediaMonthKey(value), null, `${String(value)} produced a month`);
    assert.equal(mediaMonthLabel(value, NOW), null);
    assert.equal(mediaDayLabel(value, NOW), null);
  }
});

test("the marker names the month in the nominative, and drops this year", () => {
  // A heading, not a date in a sentence: «Сентябрь», never «сентября».
  assert.equal(mediaMonthLabel("2026-09-14T12:00:00", NOW), "Сентябрь");
  assert.equal(mediaMonthLabel("2026-01-02T09:00:00", NOW), "Январь");
  // Outside this year the year is the whole point of the marker.
  assert.equal(mediaMonthLabel("2025-09-14T12:00:00", NOW), "Сентябрь 2025");
  assert.equal(mediaMonthLabel("2024-12-31T23:59:00", NOW), "Декабрь 2024");
  // The reference is the clock, passed in: move it and this year moves.
  assert.equal(mediaMonthLabel("2026-09-14T12:00:00", new Date("2027-01-01T00:00:00")), "Сентябрь 2026");
});

test("a day reads in the genitive, which is the other half of the same rule", () => {
  assert.equal(mediaDayLabel("2026-09-14T12:00:00", NOW), "14 сентября");
  assert.equal(mediaDayLabel("2025-03-01T08:00:00", NOW), "1 марта 2025");
  assert.equal(RUSSIAN_MONTHS_NOMINATIVE.length, 12);
  assert.equal(RUSSIAN_MONTHS_GENITIVE.length, 12);
  assert.equal(new Set(RUSSIAN_MONTHS_NOMINATIVE).size, 12);
  assert.equal(new Set(RUSSIAN_MONTHS_GENITIVE).size, 12);
  // The two lists are the same twelve months in the same order, which is what
  // makes indexing by `getMonth()` safe in both. Checked through the two
  // functions rather than by comparing stems: «Май» and «мая» share two
  // letters and «июня» and «июля» share three, so a stem comparison would
  // pass over exactly the swap it is there to catch.
  for (let month = 0; month < 12; month += 1) {
    const stamp = new Date(2026, month, 15, 12, 0, 0).toISOString();
    const heading = mediaMonthLabel(stamp, NOW)!;
    const day = mediaDayLabel(stamp, NOW)!;
    assert.equal(heading, RUSSIAN_MONTHS_NOMINATIVE[month]);
    assert.equal(day, `15 ${RUSSIAN_MONTHS_GENITIVE[month]}`);
  }
});

test("the grid is divided by month, newest first, in the order the rows arrived", () => {
  const rows = [
    at("2026-09-14T12:00:00"),
    at("2026-09-02T09:30:00"),
    at("2026-08-30T21:00:00"),
    at("2025-12-24T18:00:00"),
  ];
  const groups = groupMediaByMonth(rows, NOW);
  assert.deepEqual(groups.map((group) => group.key), ["2026-09", "2026-08", "2025-12"]);
  assert.deepEqual(groups.map((group) => group.label), ["Сентябрь", "Август", "Декабрь 2025"]);
  assert.deepEqual(groups[0].items.map((item) => item.id), [rows[0].id, rows[1].id]);
  assert.equal(groups[1].items.length, 1);
  assert.equal(groups[2].items.length, 1);
});

test("grouping never re-sorts, so a paging fault shows instead of hiding", () => {
  // Rows handed over out of order stay out of order. The panel fetches
  // `created_at desc`; a function that quietly repaired the order here would
  // make a broken cursor look correct on screen.
  const older = at("2026-07-01T10:00:00");
  const newer = at("2026-09-09T10:00:00");
  const groups = groupMediaByMonth([older, newer], NOW);
  assert.deepEqual(groups.map((group) => group.key), ["2026-07", "2026-09"]);
});

test("a row whose date cannot be read is shown, under a group that says so", () => {
  const rows = [at("2026-09-14T12:00:00"), at(null), at("2026-09-01T12:00:00")];
  const groups = groupMediaByMonth(rows, NOW);
  // Three rows in, three rows out. Dropping the undated one would make the grid
  // disagree with the count on the row that opened it.
  assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), 3);
  const undated = groups.find((group) => group.key === "");
  assert.ok(undated, "the undated row was dropped or folded into a month");
  assert.equal(undated.label, MEDIA_UNDATED_GROUP_LABEL);
  assert.deepEqual(undated.items.map((item) => item.id), [rows[1].id]);
});

test("an empty list has no groups at all", () => {
  assert.deepEqual(groupMediaByMonth([], NOW), []);
});

// ---------------------------------------------------------------------------
// The floating month marker
// ---------------------------------------------------------------------------

const ANCHORS = [
  { key: "2026-09", label: "Сентябрь", top: 0 },
  { key: "2026-08", label: "Август", top: 420 },
  { key: "2026-07", label: "Июль", top: 980 },
];

test("the marker names the last month at or above the scroll line", () => {
  assert.equal(currentMediaMonth(ANCHORS, 0)?.key, "2026-09");
  assert.equal(currentMediaMonth(ANCHORS, 418)?.key, "2026-09");
  // The one-pixel tolerance commits a pixel early rather than a pixel late,
  // which is the direction that cannot leave the marker naming a month whose
  // heading has already gone past the top of the scroller.
  assert.equal(currentMediaMonth(ANCHORS, 419)?.key, "2026-08");
  assert.equal(currentMediaMonth(ANCHORS, 420)?.key, "2026-08");
  assert.equal(currentMediaMonth(ANCHORS, 978)?.key, "2026-08");
  assert.equal(currentMediaMonth(ANCHORS, 980)?.key, "2026-07");
  assert.equal(currentMediaMonth(ANCHORS, 5000)?.key, "2026-07");
});

test("a half pixel does not flip the marker between two months", () => {
  // Both the heading's offset and the scroll offset are fractional on a scaled
  // display. 419.6 is inside August's heading for any reader looking at it.
  assert.equal(currentMediaMonth(ANCHORS, 419.6)?.key, "2026-08");
  assert.equal(currentMediaMonth(ANCHORS, 418.5)?.key, "2026-09");
});

test("above the first heading the marker still names a month", () => {
  // Overscroll, or a scroller whose content starts below zero. The reader is in
  // September either way; an empty marker there would be a fourth meaning.
  assert.equal(currentMediaMonth(ANCHORS, -60)?.key, "2026-09");
  const shuffled = [ANCHORS[2], ANCHORS[0], ANCHORS[1]];
  assert.equal(currentMediaMonth(shuffled, -60)?.key, "2026-09");
  assert.equal(currentMediaMonth(shuffled, 500)?.key, "2026-08");
});

test("with nothing to name there is no marker", () => {
  assert.equal(currentMediaMonth([], 0), null);
});

test("the marker appears with the scroll and fades when it stops", () => {
  assert.equal(mediaMonthMarkerShown(null, 10_000), false);
  assert.equal(mediaMonthMarkerShown(10_000, 10_000), true);
  assert.equal(mediaMonthMarkerShown(10_000, 10_000 + MEDIA_MONTH_MARKER_LINGER_MS - 1), true);
  assert.equal(mediaMonthMarkerShown(10_000, 10_000 + MEDIA_MONTH_MARKER_LINGER_MS), false);
  assert.equal(mediaMonthMarkerShown(10_000, 60_000), false);
});

// ---------------------------------------------------------------------------
// A place in a sequence
// ---------------------------------------------------------------------------

test("the viewer says which of how many, one-based", () => {
  assert.equal(mediaPositionLabel(sequence({ index: 0, loaded: 8, total: 1543, totalExact: true })), "1 из 1543");
  assert.equal(mediaPositionLabel(sequence({ index: 11, loaded: 24, total: 1543, totalExact: true })), "12 из 1543");
});

test("a guessed total is hedged exactly as the counted row hedges it", () => {
  assert.equal(mediaPositionLabel(sequence({ index: 2, loaded: 24, total: 24, totalExact: false })), "3 из 24+");
  // The same hedge the row that opened this sub-view already printed, and the
  // two live in different modules: pinned here so neither can drift alone.
  assert.equal(formatMediaCount(24, true), "24+");
  assert.equal(formatMediaCount(1543, false), "1543");
  assert.ok(mediaPositionLabel(sequence({ index: 2, loaded: 24, total: 24, totalExact: false })).endsWith(formatMediaCount(24, true)));
  assert.ok(mediaPositionLabel(sequence({ index: 2, loaded: 24, total: 1543, totalExact: true })).endsWith(formatMediaCount(1543, false)));
});

test("a total the reader can disprove by looking is raised to what is on screen", () => {
  // A server count is a snapshot; the loaded rows are the present. «25 из 24»
  // is a number somebody can count.
  assert.equal(mediaPositionLabel(sequence({ index: 24, loaded: 40, total: 24, totalExact: true })), "25 из 40");
  assert.equal(mediaPositionLabel(sequence({ index: 30, loaded: 31, total: 5, totalExact: true })), "31 из 31");
});

test("left and right move through what the grid holds", () => {
  const state = sequence({ index: 5, loaded: 24, total: 24, totalExact: true });
  assert.deepEqual(planMediaStep(state, -1), { kind: "move", index: 4 });
  assert.deepEqual(planMediaStep(state, 1), { kind: "move", index: 6 });
});

test("the first item has no previous and the last of everything has no next", () => {
  assert.deepEqual(planMediaStep(sequence({ index: 0, loaded: 24 }), -1), { kind: "none" });
  assert.equal(mediaStepOffered(sequence({ index: 0, loaded: 24 }), -1), false);
  const last = sequence({ index: 23, loaded: 24, total: 24, totalExact: true, hasMore: false });
  assert.deepEqual(planMediaStep(last, 1), { kind: "none" });
  assert.equal(mediaStepOffered(last, 1), false);
});

test("reaching the end of what is loaded loads more rather than stopping", () => {
  const end = sequence({ index: 23, loaded: 24, total: 1543, totalExact: true, hasMore: true });
  assert.deepEqual(planMediaStep(end, 1), { kind: "load" });
  assert.equal(mediaStepOffered(end, 1), true);
});

test("a step is refused while a page is in flight, and the control stays put", () => {
  const waiting = sequence({ index: 23, loaded: 24, total: 1543, totalExact: true, hasMore: true, loading: true });
  assert.deepEqual(planMediaStep(waiting, 1), { kind: "none" });
  // Offered all the same. A control that vanishes for the second a request
  // takes is a control that moves under the finger reaching for it — which is
  // why this is not `planMediaStep(...).kind !== "none"`.
  assert.equal(mediaStepOffered(waiting, 1), true);
  // And moving backwards is never blocked by a page coming in.
  assert.deepEqual(planMediaStep(waiting, -1), { kind: "move", index: 22 });
});

test("a single item is a sequence of one and offers no step at all", () => {
  const alone = sequence({ index: 0, loaded: 1, total: 1, totalExact: true, hasMore: false });
  assert.equal(mediaStepOffered(alone, -1), false);
  assert.equal(mediaStepOffered(alone, 1), false);
  assert.deepEqual(planMediaStep(alone, 1), { kind: "none" });
  assert.equal(mediaPositionLabel(alone), "1 из 1");
});

test("a swipe moves the run, and only when it is a swipe", () => {
  // The picture follows the finger: a drag to the left turns the page forward,
  // exactly as a page turns.
  assert.equal(mediaSwipeStep(-120, 4), 1);
  assert.equal(mediaSwipeStep(120, -4), -1);
  // Under the threshold it is a tap or a wobble, not a page turn. `TAP_SLOP_PX`
  // in `mediaZoom.ts` is 8, so the two can never both claim one finger.
  assert.equal(mediaSwipeStep(-MEDIA_SWIPE_STEP_PX + 1, 0), null);
  assert.equal(mediaSwipeStep(-MEDIA_SWIPE_STEP_PX, 0), 1);
  assert.equal(mediaSwipeStep(0, 0), null);
  // Mostly vertical is somebody scrolling or dismissing, and answering it with
  // a step is what makes a gallery feel like it is fighting the hand.
  assert.equal(mediaSwipeStep(-120, 200), null);
  assert.equal(mediaSwipeStep(-120, -200), null);
  // Equal is not dominant: a 45-degree drag is not a page turn either.
  assert.equal(mediaSwipeStep(-120, 120), null);
  assert.equal(mediaSwipeStep(-120, 119), 1);
});

// ---------------------------------------------------------------------------
// The end of the list
// ---------------------------------------------------------------------------

test("the end of the list has five distinct answers", () => {
  assert.deepEqual(mediaTailState({ hasMore: false, loading: false, failed: false, stalled: false }), { kind: "complete" });
  assert.deepEqual(mediaTailState({ hasMore: true, loading: false, failed: false, stalled: false }), { kind: "more" });
  assert.deepEqual(mediaTailState({ hasMore: true, loading: true, failed: false, stalled: false }), { kind: "loading" });
  assert.deepEqual(mediaTailState({ hasMore: true, loading: false, failed: false, stalled: true }), {
    kind: "exhausted",
    message: SHARED_MEDIA_NO_MORE_AVAILABLE,
  });
  assert.deepEqual(mediaTailState({ hasMore: true, loading: false, failed: true, stalled: false }), {
    kind: "failed",
    message: SHARED_MEDIA_PAGE_FAILED,
    action: SHARED_MEDIA_PAGE_FAILED_ACTION,
  });
});

test("a failure to load is never drawn as the end of the list", () => {
  // The defect this closes: a refused page removed the sentinel, so a dead
  // network and a complete list were the same picture.
  const failed = mediaTailState({ hasMore: true, loading: false, failed: true, stalled: false });
  assert.notEqual(failed.kind, "complete");
  assert.notEqual(failed.kind, "more");
  // It outranks everything, including a request that is still out: a list that
  // goes on offering to load after a refusal says nothing about the refusal.
  assert.equal(mediaTailState({ hasMore: true, loading: true, failed: true, stalled: true }).kind, "failed");
  // And it outranks `hasMore: false` too — the total is not what failed.
  assert.equal(mediaTailState({ hasMore: false, loading: false, failed: true, stalled: false }).kind, "failed");
});

test("a page that came back empty against a total that says otherwise says so", () => {
  const stalled = mediaTailState({ hasMore: true, loading: false, failed: false, stalled: true });
  assert.equal(stalled.kind, "exhausted");
  assert.notEqual(stalled.kind, "complete");
  assert.notEqual(stalled.kind, "more");
});

test("an empty list and an unreadable one are different pictures", () => {
  assert.deepEqual(mediaEmptyState(false), { title: SHARED_MEDIA_EMPTY, retry: false });
  assert.deepEqual(mediaEmptyState(true), {
    title: SHARED_MEDIA_LOAD_FAILED,
    detail: SHARED_MEDIA_LOAD_FAILED_DETAIL,
    retry: true,
  });
  // The one that failed offers a way to ask again; the one that is simply
  // empty does not, because there is nothing to ask.
  assert.equal(mediaEmptyState(true).retry, true);
  assert.equal(mediaEmptyState(false).retry, false);
  assert.notEqual(mediaEmptyState(true).title, mediaEmptyState(false).title);
});

test("a refusal keeps what a person can act on and drops what they cannot", () => {
  // Anything naming the machine is replaced by this surface's own sentence.
  assert.equal(
    sharedMediaFailure("Could not find the function public.chat_media_counts in the schema cache (PGRST202)"),
    SHARED_MEDIA_LOAD_FAILED,
  );
  assert.equal(sharedMediaFailure("Таблица сообщений недоступна"), SHARED_MEDIA_LOAD_FAILED);
  assert.equal(sharedMediaFailure("Требуется обновление базы данных"), SHARED_MEDIA_LOAD_FAILED);
  assert.equal(sharedMediaFailure(MAPPER_GENERIC_FAILURE), SHARED_MEDIA_LOAD_FAILED);
  assert.equal(sharedMediaFailure(null), SHARED_MEDIA_LOAD_FAILED);
  assert.equal(sharedMediaFailure("   "), SHARED_MEDIA_LOAD_FAILED);
  // And anything they can is worth more than this module's own words.
  assert.equal(sharedMediaFailure("Нет соединения с сервером."), "Нет соединения с сервером.");
  assert.equal(sharedMediaFailure("Сессия не найдена. Войдите снова."), "Сессия не найдена. Войдите снова.");
});

test("nothing this surface says explains the machine", () => {
  for (const message of SHARED_MEDIA_MESSAGES) {
    assert.equal(
      INTERNALS_PATTERN.test(message),
      false,
      `«${message}» names something the reader cannot act on`,
    );
    assert.equal(message.trim(), message);
    assert.ok(message.length > 0);
  }
  // Every sentence the module can put on screen is in the list, so a new one
  // cannot skip the check above by not being listed.
  for (const message of [
    SHARED_MEDIA_PAGE_FAILED,
    SHARED_MEDIA_PAGE_FAILED_ACTION,
    SHARED_MEDIA_LOAD_FAILED,
    SHARED_MEDIA_LOAD_FAILED_DETAIL,
    SHARED_MEDIA_EMPTY,
    SHARED_MEDIA_NO_MORE_AVAILABLE,
    MEDIA_UNDATED_GROUP_LABEL,
  ]) {
    assert.ok(SHARED_MEDIA_MESSAGES.includes(message), `«${message}» is not in SHARED_MEDIA_MESSAGES`);
  }
});
