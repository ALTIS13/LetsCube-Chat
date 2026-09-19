/**
 * «Когда» — one string from a person, one instant, or a named reason there is
 * no instant.
 *
 * A pure function of `(input, now, timeZone)` and nothing else. No `Date.now()`,
 * no ambient zone, no database. That is not tidiness: a reminder parser is
 * entirely about time, and one that reads the clock itself can only be tested
 * by waiting, which means in practice it is tested at one time of day on one
 * machine and the interesting cases — the 23:50 «сегодня вечером», the
 * `31.12 23:59`, the DST night — are never run at all.
 *
 * **The rule the shape enforces: never a silently wrong time.** Every failure
 * is a named code rather than a fallback, and in particular a time that has
 * already passed is `in_the_past` rather than «fire immediately» or «assume
 * they meant tomorrow». Rolling `18:00` forward to tomorrow when it is 19:00
 * today is the single most tempting convenience here and the one that produces
 * a reminder nobody asked for, twenty-three hours late, with no way to tell it
 * was guessed. Where a default is unavoidable — `завтра` with no time — the
 * result says so in `assumedTimeOfDay`, and the caller is expected to echo the
 * resolved absolute time back so the person can see the assumption.
 *
 * Two conventions worth stating because they resolve real ambiguity:
 *
 *   - `01.02` is the first of February, never one minute past one. A bare clock
 *     at the start of the input must use a colon (`01:02`); a dot there is
 *     always a date. After a day word or a date the separator may be either,
 *     because `завтра 18.00` cannot be anything but a time.
 *   - A time expression is read from the front of the input, and failing that
 *     from the end — `Позвонить завтра 18:00` is as natural as
 *     `завтра 18:00 Позвонить`. A trailing expression is accepted only when it
 *     consumes the whole tail, so `Заказать 3 дня отпуска` does not become a
 *     reminder in three days: «3 дня» parses but «отпуска» is left over, and a
 *     partial match at the end is refused rather than truncated.
 */

/** Wall-clock hours the word forms resolve to, in the person's own zone. */
export const TIME_OF_DAY_HOURS = {
  morning: 9,
  afternoon: 14,
  evening: 19,
  night: 22,
} as const;

/** `завтра` with no time of day. Echoed back, never silent. */
export const DEFAULT_DAY_HOUR = 9;

/** Beyond this a «reminder» is a calendar entry and almost always a typo. */
export const MAX_HORIZON_DAYS = 5 * 366;

export type WhenKind = "relative" | "time_of_day" | "clock" | "date";

export type ParsedWhen = {
  ok: true;
  /** The instant to fire at. */
  at: Date;
  /** Whatever was not the time expression, trimmed. May be empty. */
  body: string;
  /** The substring that was read as a time, for an echo in the reply. */
  matched: string;
  kind: WhenKind;
  /** True when the hour came from a default rather than from the person. */
  assumedTimeOfDay: boolean;
};

export type WhenFailure =
  | { ok: false; code: "empty" }
  | { ok: false; code: "unrecognized"; input: string }
  | { ok: false; code: "missing_body"; at: Date }
  | { ok: false; code: "in_the_past"; at: Date }
  | { ok: false; code: "out_of_range"; at: Date }
  | { ok: false; code: "invalid_clock"; hour: number; minute: number }
  | { ok: false; code: "invalid_date"; day: number; month: number }
  | { ok: false; code: "unknown_time_zone"; timeZone: string };

export type WhenResult = ParsedWhen | WhenFailure;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Guards the suffix scan and the regex engine against a pathological input. */
const MAX_INPUT_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Time zones, without a library
// ---------------------------------------------------------------------------

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** What a clock in `timeZone` reads at `instant`. */
export function zonedPartsOf(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return {
    year: read.year ?? 1970,
    month: read.month ?? 1,
    day: read.day ?? 1,
    // Some engines still say 24 for midnight under an h23 request.
    hour: read.hour === 24 ? 0 : (read.hour ?? 0),
    minute: read.minute ?? 0,
    second: read.second ?? 0,
  };
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = zonedPartsOf(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // The clock in the zone, minus the clock in UTC, is the offset. Both are read
  // from the same instant, so there is nothing to get wrong about the date.
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which a clock in `timeZone` reads the given wall time.
 *
 * Two passes, which is the standard way to invert a zone without a table: guess
 * that the wall time is UTC, ask what the offset is near that guess, and
 * correct. A candidate is right when the offset *at* it is the offset used to
 * compute it; anything else means the guess crossed a transition.
 *
 * Two wall times are not instants at all, and the handling of each is a
 * decision rather than an accident:
 *
 *   - **Fall-back overlap.** 01:30 on the November Sunday in New York happens
 *     twice. The first candidate is already self-consistent, so the earlier of
 *     the two is returned — the same choice Temporal makes.
 *   - **Spring-forward gap.** 02:30 on the March Sunday never happens. Neither
 *     candidate reads back as what was asked, and the later one is taken, so
 *     02:30 becomes 03:30 rather than 01:30. Taking the earlier would fire the
 *     reminder an hour *before* a person who wrote «02:30» could possibly have
 *     meant, and would do it only on two days a year in half the world's
 *     zones — which is to say, it would be found in production or not at all.
 */
export function instantFromZonedParts(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const firstOffset = zoneOffsetMs(asUtc, timeZone);
  const firstCandidate = asUtc - firstOffset;
  const secondOffset = zoneOffsetMs(firstCandidate, timeZone);
  if (secondOffset === firstOffset) return new Date(firstCandidate);

  const secondCandidate = asUtc - secondOffset;
  if (zoneOffsetMs(secondCandidate, timeZone) === secondOffset) {
    return new Date(secondCandidate);
  }
  // Neither reads back: the wall time is inside a gap. Forward, always.
  return new Date(Math.max(firstCandidate, secondCandidate));
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

type UnitName = "minute" | "hour" | "day" | "week";

const UNIT_MS: Record<UnitName, number> = {
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: DAY_MS,
  week: 7 * DAY_MS,
};

/**
 * Longest first, because alternation is first-match: `мин` must be tried
 * before `м`, or «20 минут» reads as 20 minutes followed by the word «инут».
 */
const UNIT_PATTERNS: ReadonlyArray<readonly [RegExp, UnitName]> = [
  [/^(?:minutes|minute|mins|min|m)/i, "minute"],
  [/^(?:минуток|минутку|минуты|минуту|минут|мин|м)/i, "minute"],
  [/^(?:hours|hour|hrs|hr|h)/i, "hour"],
  [/^(?:часов|часа|час|ч)/i, "hour"],
  [/^(?:days|day|d)/i, "day"],
  [/^(?:дней|дня|день|дн|д)/i, "day"],
  [/^(?:weeks|week|w)/i, "week"],
  [/^(?:недель|недели|неделю|неделя|нед|н)/i, "week"],
];

/** A word may not run on: «18:000» is not 18:00, «завтраки» is not «завтра». */
const WORD_CONTINUES = /^[\p{L}\p{N}]/u;

/**
 * A unit may be followed by a digit but not by a letter.
 *
 * Both halves are load-bearing and were measured rather than guessed: barring
 * digits rejects `1h30m`, and allowing letters accepts «5 минутах ходьбы» as
 * five minutes.
 */
const LETTER_CONTINUES = /^\p{L}/u;

/** Between a day word and its time: «завтра 18:00» and «завтра, 18:00». */
const DAY_TIME_GAP = /^[\s,]+/;

const DAY_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^послезавтра/i, 2],
  [/^day\s+after\s+tomorrow/i, 2],
  [/^завтра/i, 1],
  [/^tomorrow/i, 1],
  [/^сегодня/i, 0],
  [/^today/i, 0],
];

const TIME_OF_DAY_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:утром|утра)/i, TIME_OF_DAY_HOURS.morning],
  [/^(?:this\s+)?morning/i, TIME_OF_DAY_HOURS.morning],
  [/^(?:днём|днем|дня)/i, TIME_OF_DAY_HOURS.afternoon],
  [/^(?:this\s+)?afternoon/i, TIME_OF_DAY_HOURS.afternoon],
  [/^(?:вечером|вечера)/i, TIME_OF_DAY_HOURS.evening],
  [/^(?:this\s+)?evening/i, TIME_OF_DAY_HOURS.evening],
  [/^tonight/i, TIME_OF_DAY_HOURS.evening],
  [/^(?:ночью|ночи)/i, TIME_OF_DAY_HOURS.night],
  [/^(?:at\s+)?night/i, TIME_OF_DAY_HOURS.night],
];

/** Dropped from the head of the body: «20m — Проверить сервер». */
const BODY_LEAD = /^[\s,:;.–—-]+/;

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

/** What a matcher produces: a wall time to resolve, or a named refusal. */
type Match =
  | {
      kind: WhenKind;
      consumed: number;
      assumedTimeOfDay: boolean;
      /** Either an offset from `now`, or a wall-clock target in the zone. */
      offsetMs?: number;
      wall?: { year?: number; month: number; day: number; hour: number; minute: number };
      /** `wall` without a year: pick this year, or the next if it has passed. */
      floatingYear?: boolean;
      /**
       * A second region of the input that was also the time, to be cut out of
       * the body.
       *
       * This exists for one sentence: «завтра Позвонить в 18:00». The day is at
       * the front and the hour is in the middle, and without this the day word
       * would win alone and the reminder would fire at the default 09:00 — a
       * silently wrong time of exactly the kind this module refuses to produce,
       * and the one a person is least likely to notice, because the bot did
       * reply and did say «завтра».
       */
      cut?: { start: number; end: number };
    }
  | { failure: WhenFailure; consumed: number };

function isFailure(match: Match): match is { failure: WhenFailure; consumed: number } {
  return "failure" in match;
}

function matchUnit(text: string): { unit: UnitName; length: number } | null {
  for (const [pattern, unit] of UNIT_PATTERNS) {
    const found = pattern.exec(text);
    if (!found) continue;
    const rest = text.slice(found[0].length);
    if (LETTER_CONTINUES.test(rest)) continue;
    return { unit, length: found[0].length };
  }
  return null;
}

/** `20m`, `2h30m`, `30 мин`, `через час`, `in half an hour`. */
function matchRelative(text: string): Match | null {
  let cursor = 0;
  let sawPrefix = false;

  const prefix = /^(?:через|in)\s+/i.exec(text);
  if (prefix) {
    cursor = prefix[0].length;
    sawPrefix = true;
  }

  const half = /^(?:полчаса|пол\s*часа|half\s+an\s+hour)/i.exec(text.slice(cursor));
  if (half && !WORD_CONTINUES.test(text.slice(cursor + half[0].length))) {
    return {
      kind: "relative",
      consumed: cursor + half[0].length,
      assumedTimeOfDay: false,
      offsetMs: 30 * MINUTE_MS,
    };
  }

  let total = 0;
  let pairs = 0;
  while (cursor < text.length) {
    const rest = text.slice(cursor);
    const article = /^(?:an?|один|одну|одна)\s+/i.exec(rest);
    const digits = /^(\d{1,9})\s*/.exec(rest);

    let count: number | null = null;
    let countLength = 0;
    if (digits) {
      count = Number(digits[1]);
      countLength = digits[0].length;
    } else if (article) {
      count = 1;
      countLength = article[0].length;
    } else if (sawPrefix && pairs === 0) {
      // «через час», «через неделю» — the count is the word itself.
      count = 1;
      countLength = 0;
    }
    if (count === null) break;

    const unit = matchUnit(rest.slice(countLength));
    if (!unit) break;

    total += count * UNIT_MS[unit.unit];
    pairs += 1;
    cursor += countLength + unit.length;

    // `1h30m` and `1h 30m` continue; anything else ends the expression.
    const gap = /^\s*/.exec(text.slice(cursor));
    const next = text.slice(cursor + (gap ? gap[0].length : 0));
    if (!/^\d/.test(next)) break;
    cursor += gap ? gap[0].length : 0;
  }

  if (pairs === 0) return null;
  return { kind: "relative", consumed: cursor, assumedTimeOfDay: false, offsetMs: total };
}

function matchClock(text: string, allowDot: boolean): { hour: number; minute: number; length: number } | null {
  const pattern = allowDot
    ? /^(?:в|at|@)?\s*(\d{1,2})[:.](\d{2})/i
    : /^(?:в|at|@)?\s*(\d{1,2}):(\d{2})/i;
  const found = pattern.exec(text);
  if (!found) return null;
  if (WORD_CONTINUES.test(text.slice(found[0].length))) return null;
  return { hour: Number(found[1]), minute: Number(found[2]), length: found[0].length };
}

/**
 * A clock or a time-of-day word anywhere later in the text, at a word start.
 *
 * Only reached when a day word was found with no time beside it. The colon is
 * required — `5.10` in a tail is a date somebody is writing about, not an hour
 * — and the first match wins, so a reminder body mentioning two times takes the
 * earlier one rather than guessing.
 */
function findTimeInTail(tail: string): { hour: number; minute: number; start: number; end: number } | null {
  for (let index = 0; index < tail.length; index += 1) {
    if (index > 0 && !/\s/.test(tail[index - 1] ?? "")) continue;
    const rest = tail.slice(index);
    const clock = matchClock(rest, false);
    if (clock && clock.hour <= 23 && clock.minute <= 59) {
      return { hour: clock.hour, minute: clock.minute, start: index, end: index + clock.length };
    }
    for (const [pattern, hour] of TIME_OF_DAY_WORDS) {
      const found = pattern.exec(rest);
      if (!found) continue;
      if (WORD_CONTINUES.test(rest.slice(found[0].length))) continue;
      return { hour, minute: 0, start: index, end: index + found[0].length };
    }
  }
  return null;
}

/** `завтра`, `завтра 18:00`, `сегодня вечером`, `tomorrow at 18:00`. */
function matchDayWord(text: string, now: Date, timeZone: string): Match | null {
  for (const [pattern, offsetDays] of DAY_WORDS) {
    const found = pattern.exec(text);
    if (!found) continue;
    if (WORD_CONTINUES.test(text.slice(found[0].length))) continue;

    const cursor = found[0].length;
    const gap = DAY_TIME_GAP.exec(text.slice(cursor));
    const afterGap = cursor + (gap ? gap[0].length : 0);

    const clock = matchClock(text.slice(afterGap), true);
    if (clock) {
      if (clock.hour > 23 || clock.minute > 59) {
        return {
          failure: { ok: false, code: "invalid_clock", hour: clock.hour, minute: clock.minute },
          consumed: afterGap + clock.length,
        };
      }
      const day = shiftZonedDay(now, timeZone, offsetDays);
      return {
        kind: "clock",
        consumed: afterGap + clock.length,
        assumedTimeOfDay: false,
        wall: { ...day, hour: clock.hour, minute: clock.minute },
      };
    }

    for (const [wordPattern, hour] of TIME_OF_DAY_WORDS) {
      const word = wordPattern.exec(text.slice(afterGap));
      if (!word) continue;
      if (WORD_CONTINUES.test(text.slice(afterGap + word[0].length))) continue;
      const day = shiftZonedDay(now, timeZone, offsetDays);
      return {
        kind: "time_of_day",
        consumed: afterGap + word[0].length,
        assumedTimeOfDay: false,
        wall: { ...day, hour, minute: 0 },
      };
    }

    const day = shiftZonedDay(now, timeZone, offsetDays);
    const later = findTimeInTail(text.slice(cursor));
    if (later) {
      return {
        kind: "clock",
        consumed: cursor,
        assumedTimeOfDay: false,
        wall: { ...day, hour: later.hour, minute: later.minute },
        cut: { start: cursor + later.start, end: cursor + later.end },
      };
    }
    return {
      kind: "time_of_day",
      consumed: cursor,
      assumedTimeOfDay: true,
      wall: { ...day, hour: DEFAULT_DAY_HOUR, minute: 0 },
    };
  }
  return null;
}

/** `вечером`, `tonight`, `утром` — today, in the person's zone. */
function matchTimeOfDay(text: string, now: Date, timeZone: string): Match | null {
  for (const [pattern, hour] of TIME_OF_DAY_WORDS) {
    const found = pattern.exec(text);
    if (!found) continue;
    if (WORD_CONTINUES.test(text.slice(found[0].length))) continue;
    const day = shiftZonedDay(now, timeZone, 0);
    return {
      kind: "time_of_day",
      consumed: found[0].length,
      assumedTimeOfDay: false,
      wall: { ...day, hour, minute: 0 },
    };
  }
  return null;
}

/** `05.10 18:00`, `05.10.2026 18:00`, `05.10`. */
function matchExplicitDate(text: string): Match | null {
  const found = /^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/.exec(text);
  if (!found) return null;
  if (WORD_CONTINUES.test(text.slice(found[0].length))) return null;

  const day = Number(found[1]);
  const month = Number(found[2]);
  const yearRaw = found[3] === undefined ? null : Number(found[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return { failure: { ok: false, code: "invalid_date", day, month }, consumed: found[0].length };
  }
  const year = yearRaw === null ? null : yearRaw < 100 ? 2000 + yearRaw : yearRaw;

  const cursor = found[0].length;
  const gap = DAY_TIME_GAP.exec(text.slice(cursor));
  const afterGap = cursor + (gap ? gap[0].length : 0);
  const clock = matchClock(text.slice(afterGap), true);
  if (clock) {
    if (clock.hour > 23 || clock.minute > 59) {
      return {
        failure: { ok: false, code: "invalid_clock", hour: clock.hour, minute: clock.minute },
        consumed: afterGap + clock.length,
      };
    }
    return {
      kind: "date",
      consumed: afterGap + clock.length,
      assumedTimeOfDay: false,
      wall: { ...(year === null ? {} : { year }), month, day, hour: clock.hour, minute: clock.minute },
      floatingYear: year === null,
    };
  }
  const later = findTimeInTail(text.slice(cursor));
  if (later) {
    return {
      kind: "date",
      consumed: cursor,
      assumedTimeOfDay: false,
      wall: { ...(year === null ? {} : { year }), month, day, hour: later.hour, minute: later.minute },
      floatingYear: year === null,
      cut: { start: cursor + later.start, end: cursor + later.end },
    };
  }
  return {
    kind: "date",
    consumed: cursor,
    assumedTimeOfDay: true,
    wall: { ...(year === null ? {} : { year }), month, day, hour: DEFAULT_DAY_HOUR, minute: 0 },
    floatingYear: year === null,
  };
}

/** `18:00` on its own: today, and never rolled forward (see the file comment). */
function matchBareClock(text: string, now: Date, timeZone: string): Match | null {
  const clock = matchClock(text, false);
  if (!clock) return null;
  if (clock.hour > 23 || clock.minute > 59) {
    return {
      failure: { ok: false, code: "invalid_clock", hour: clock.hour, minute: clock.minute },
      consumed: clock.length,
    };
  }
  const day = shiftZonedDay(now, timeZone, 0);
  return {
    kind: "clock",
    consumed: clock.length,
    assumedTimeOfDay: false,
    wall: { ...day, hour: clock.hour, minute: clock.minute },
  };
}

/**
 * The calendar day `offsetDays` away from today in `timeZone`.
 *
 * Stepping by 24h and re-reading the clock, rather than adding to the day
 * number, so a month end and a DST day both come out right: the only thing
 * that has to be true is that no zone shifts by more than 12 hours in a day.
 */
function shiftZonedDay(
  now: Date,
  timeZone: string,
  offsetDays: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + offsetDays * DAY_MS);
  const parts = zonedPartsOf(shifted, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

const MATCHERS: ReadonlyArray<(text: string, now: Date, timeZone: string) => Match | null> = [
  (text) => matchExplicitDate(text),
  (text, now, timeZone) => matchDayWord(text, now, timeZone),
  (text, now, timeZone) => matchTimeOfDay(text, now, timeZone),
  (text) => matchRelative(text),
  (text, now, timeZone) => matchBareClock(text, now, timeZone),
];

function matchAt(text: string, now: Date, timeZone: string): Match | null {
  for (const matcher of MATCHERS) {
    const match = matcher(text, now, timeZone);
    if (match) return match;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function resolve(match: Match, now: Date, timeZone: string): { at: Date } | WhenFailure {
  if (isFailure(match)) return match.failure;

  if (match.offsetMs !== undefined) {
    return { at: new Date(now.getTime() + match.offsetMs) };
  }

  const wall = match.wall;
  if (!wall) return { ok: false, code: "unrecognized", input: "" };

  const startYear = wall.year ?? zonedPartsOf(now, timeZone).year;
  for (const year of match.floatingYear ? [startYear, startYear + 1] : [startYear]) {
    const at = instantFromZonedParts({ ...wall, year }, timeZone);
    // A day that does not exist — 31.02, 31.04 — lands in the next month once
    // Date.UTC normalises it. Reading the instant back in the zone is the only
    // check that catches that without a calendar table of its own.
    const readBack = zonedPartsOf(at, timeZone);
    if (readBack.day !== wall.day || readBack.month !== wall.month) {
      return { ok: false, code: "invalid_date", day: wall.day, month: wall.month };
    }
    if (!match.floatingYear || at.getTime() > now.getTime()) return { at };
  }
  // Both candidate years are behind us, which only happens for an explicit
  // year; the floating loop above returns on the first future one.
  return { at: instantFromZonedParts({ ...wall, year: startYear }, timeZone) };
}

function cleanBody(raw: string): string {
  return raw.replace(BODY_LEAD, "").replace(/\s{2,}/g, " ").trim();
}

/** The input minus the time expression, including a `cut` region in the middle. */
function bodyOf(text: string, match: Match): string {
  const rest = text.slice(match.consumed);
  if (isFailure(match) || !match.cut) return cleanBody(rest);
  const start = match.cut.start - match.consumed;
  const end = match.cut.end - match.consumed;
  if (start < 0 || end > rest.length || start >= end) return cleanBody(rest);
  return cleanBody(`${rest.slice(0, start)} ${rest.slice(end)}`);
}

function matchedTextOf(text: string, match: Match): string {
  const head = text.slice(0, match.consumed);
  if (isFailure(match) || !match.cut) return head.trim();
  return `${head.trim()} ${text.slice(match.cut.start, match.cut.end).trim()}`.trim();
}

function finish(
  match: Match,
  matchedText: string,
  body: string,
  now: Date,
  timeZone: string,
): WhenResult {
  const resolved = resolve(match, now, timeZone);
  if ("ok" in resolved) return resolved;
  const at = resolved.at;

  if (at.getTime() <= now.getTime()) return { ok: false, code: "in_the_past", at };
  if (at.getTime() - now.getTime() > MAX_HORIZON_DAYS * DAY_MS) {
    return { ok: false, code: "out_of_range", at };
  }
  if (body.length === 0) return { ok: false, code: "missing_body", at };

  return {
    ok: true,
    at,
    body,
    matched: matchedText,
    kind: isFailure(match) ? "relative" : match.kind,
    assumedTimeOfDay: isFailure(match) ? false : match.assumedTimeOfDay,
  };
}

/**
 * Reads a time expression out of `input`.
 *
 * Tried from the front first, then — only if the front is not a time at all —
 * from the start of each later word, taking the earliest one that runs to the
 * end of the input. «Позвонить завтра 18:00» therefore works, while
 * «Заказать 3 дня отпуска» does not: a trailing expression must consume the
 * whole tail or it is not a time.
 */
export function parseWhen(input: string, now: Date, timeZone: string): WhenResult {
  if (!isKnownTimeZone(timeZone)) {
    return { ok: false, code: "unknown_time_zone", timeZone };
  }
  const text = input.trim().slice(0, MAX_INPUT_LENGTH);
  if (text.length === 0) return { ok: false, code: "empty" };

  const head = matchAt(text, now, timeZone);
  if (head) {
    return finish(head, matchedTextOf(text, head), bodyOf(text, head), now, timeZone);
  }

  // Word starts, left to right: the earliest tail that is entirely a time wins,
  // which keeps as much of the sentence as possible in the body.
  for (let index = 1; index < text.length; index += 1) {
    const previous = text[index - 1] ?? "";
    if (!/\s/.test(previous)) continue;
    const tail = text.slice(index);
    const match = matchAt(tail, now, timeZone);
    if (!match) continue;
    if (match.consumed !== tail.length) continue;
    const body = cleanBody(text.slice(0, index));
    if (body.length === 0) continue;
    return finish(match, tail, body, now, timeZone);
  }

  return { ok: false, code: "unrecognized", input: text };
}

// ---------------------------------------------------------------------------
// Saying it back
// ---------------------------------------------------------------------------

const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = DATE_FORMATTERS.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "long" });
  DATE_FORMATTERS.set(timeZone, made);
  return made;
}

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = TIME_FORMATTERS.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  TIME_FORMATTERS.set(timeZone, made);
  return made;
}

/**
 * «сегодня в 19:00», «завтра в 18:00», «5 октября в 09:00».
 *
 * Always absolute enough to catch a wrong guess. A reminder confirmed as «через
 * 20 минут» and nothing else cannot be checked by the person who asked for it;
 * one confirmed with a clock time can.
 */
export function formatWhen(at: Date, now: Date, timeZone: string): string {
  const zone = isKnownTimeZone(timeZone) ? timeZone : "UTC";
  const time = timeFormatter(zone).format(at);
  const today = shiftZonedDay(now, zone, 0);
  const target = zonedPartsOf(at, zone);
  const sameDay = (day: { year: number; month: number; day: number }): boolean =>
    day.year === target.year && day.month === target.month && day.day === target.day;

  if (sameDay(today)) return `сегодня в ${time}`;
  if (sameDay(shiftZonedDay(now, zone, 1))) return `завтра в ${time}`;
  if (sameDay(shiftZonedDay(now, zone, 2))) return `послезавтра в ${time}`;

  const date = dateFormatter(zone).format(at);
  const thisYear = zonedPartsOf(now, zone).year;
  return target.year === thisYear
    ? `${date} в ${time}`
    : `${date} ${target.year} в ${time}`;
}

/** The refusal, in the words the person will see. */
export function describeWhenFailure(failure: WhenFailure, timeZone: string): string {
  switch (failure.code) {
    case "empty":
      return "Не понял, когда напомнить.";
    case "unrecognized":
      return "Не понял, когда напомнить. Например: «20м», «через час», «завтра 18:00», «05.10 18:00».";
    case "missing_body":
      return "Время понял, а о чём напомнить — нет. Например: «/remind 20м Проверить сервер».";
    case "in_the_past":
      return `Это уже прошло (${formatWhen(failure.at, failure.at, timeZone)}). Укажите время в будущем.`;
    case "out_of_range":
      return "Слишком далеко — напоминания ставятся не больше чем на пять лет вперёд.";
    case "invalid_clock":
      return `Такого времени не бывает: ${failure.hour}:${String(failure.minute).padStart(2, "0")}.`;
    case "invalid_date":
      return `Такой даты не бывает: ${failure.day}.${String(failure.month).padStart(2, "0")}.`;
    case "unknown_time_zone":
      return "Не знаю такого часового пояса. Поменяйте его в настройках.";
    default:
      return "Не понял, когда напомнить.";
  }
}
