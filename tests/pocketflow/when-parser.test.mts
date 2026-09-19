/**
 * `parseWhen`, which is the only place in PocketFlow that turns words into a
 * moment, and therefore the only place that can be wrong by three hours
 * without anything looking broken.
 *
 * Every expectation below is an **exact ISO instant**, never «about now plus
 * twenty minutes». Two reasons, and the second is the one that matters:
 *
 *   - an exact instant pins the zone arithmetic. «+20 минут» from a fixed
 *     `now` is the same in every zone and proves nothing about zones at all,
 *     while «завтра 18:00» is a different instant in Moscow and in New York
 *     and the test says which;
 *   - an exact instant proves the function does not read the clock. If
 *     `parseWhen` ever called `Date.now()` — the single change that would make
 *     it untestable — every row here would fail, because the fixed `now` they
 *     are computed from is a date in the past.
 *
 * The DST expectations were taken from `Intl` directly rather than from the
 * parser: 18:00 on 8 March 2026 in New York is 22:00 UTC because the clocks
 * went forward that morning, and 18:00 the previous day is 23:00 UTC. A test
 * that computed its own expectation with the same helper the parser uses would
 * agree with any bug they shared.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DAY_HOUR,
  TIME_OF_DAY_HOURS,
  describeWhenFailure,
  formatWhen,
  instantFromZonedParts,
  isKnownTimeZone,
  parseWhen,
  zonedPartsOf,
  type WhenResult,
} from "../../artifacts/pocketflow/src/lib/whenParser.ts";

const MSK = "Europe/Moscow";
const NY = "America/New_York";

/** Thursday 19 September 2026, 12:00 in Moscow / 05:00 in New York. */
const NOW = new Date("2026-09-19T09:00:00.000Z");

function parsed(result: WhenResult): { at: string; body: string; assumed: boolean } {
  assert.equal(result.ok, true, `expected a time, got ${result.ok ? "" : result.code}`);
  if (!result.ok) throw new Error("unreachable");
  return { at: result.at.toISOString(), body: result.body, assumed: result.assumedTimeOfDay };
}

function failure(result: WhenResult): string {
  assert.equal(result.ok, false, "expected a refusal, got a time");
  if (result.ok) throw new Error("unreachable");
  return result.code;
}

// ---------------------------------------------------------------------------

test("relative forms, Russian and English, land on the exact instant", () => {
  const cases: [string, string, string][] = [
    ["20m Проверить сервер", "2026-09-19T09:20:00.000Z", "Проверить сервер"],
    ["20м Проверить сервер", "2026-09-19T09:20:00.000Z", "Проверить сервер"],
    ["30 мин Проверить", "2026-09-19T09:30:00.000Z", "Проверить"],
    ["20 минут Проверить", "2026-09-19T09:20:00.000Z", "Проверить"],
    ["2h Проверить", "2026-09-19T11:00:00.000Z", "Проверить"],
    ["2 часа Проверить", "2026-09-19T11:00:00.000Z", "Проверить"],
    ["через час Позвонить", "2026-09-19T10:00:00.000Z", "Позвонить"],
    ["через полчаса Чай", "2026-09-19T09:30:00.000Z", "Чай"],
    ["через 20 минут пинг", "2026-09-19T09:20:00.000Z", "пинг"],
    ["in 20 minutes ping", "2026-09-19T09:20:00.000Z", "ping"],
    ["in an hour call mom", "2026-09-19T10:00:00.000Z", "call mom"],
    ["in half an hour tea", "2026-09-19T09:30:00.000Z", "tea"],
    ["3d Через три дня", "2026-09-22T09:00:00.000Z", "Через три дня"],
    ["1 неделю Отпуск", "2026-09-26T09:00:00.000Z", "Отпуск"],
  ];
  for (const [input, at, body] of cases) {
    assert.deepEqual(
      parsed(parseWhen(input, NOW, MSK)),
      { at, body, assumed: false },
      `for input ${JSON.stringify(input)}`,
    );
  }
});

test("a compound delay is one delay, not a delay and a stray number", () => {
  // `1h30m` is the case that breaks if a unit is required to end its word:
  // the `3` after the `h` is a digit, and rejecting it silently turned the
  // whole expression into «unrecognized» and sent the person to the buttons.
  for (const input of ["1h30m Проверить", "1 h 30 m Проверить", "2ч30м Проверить"]) {
    const result = parsed(parseWhen(input, NOW, MSK));
    assert.equal(result.body, "Проверить", input);
  }
  assert.equal(parsed(parseWhen("1h30m x", NOW, MSK)).at, "2026-09-19T10:30:00.000Z");
  assert.equal(parsed(parseWhen("2ч30м x", NOW, MSK)).at, "2026-09-19T11:30:00.000Z");
});

test("a unit may not eat the start of a word", () => {
  // Each of these contains a number next to something that begins like a unit.
  // Reading any of them as a delay would create a reminder nobody asked for,
  // at a time nobody chose, from a shopping list.
  for (const input of [
    "Купить 2 кг муки",
    "Встреча в 5 минутах ходьбы",
    "Заказать 3 дня отпуска",
    "Найти 4 дома рядом",
  ]) {
    assert.equal(failure(parseWhen(input, NOW, MSK)), "unrecognized", input);
  }
});

test("a false unit at the very start of the input is refused too", () => {
  // The four above are all saved by a second rule — a trailing expression must
  // consume the whole tail — so they stay red even without the unit guard.
  // These do not: the false unit is at the head, where it would be accepted
  // and the rest of the word left behind as the reminder's text. «5 минутах
  // ходьбы до метро» would become «ах ходьбы до метро», in five minutes.
  for (const input of [
    "3 дома посмотреть",
    "5 минутах ходьбы до метро",
    "2 часовых пояса проверить",
    "4 днища отчистить",
  ]) {
    assert.equal(failure(parseWhen(input, NOW, MSK)), "unrecognized", input);
  }
});

test("сегодня вечером / tonight resolve to the documented hour, in the person's zone", () => {
  assert.equal(TIME_OF_DAY_HOURS.evening, 19);
  // 19:00 Moscow is 16:00 UTC; 19:00 New York on the same date is 23:00 UTC.
  assert.equal(parsed(parseWhen("сегодня вечером Позвонить", NOW, MSK)).at, "2026-09-19T16:00:00.000Z");
  assert.equal(parsed(parseWhen("вечером Позвонить", NOW, MSK)).at, "2026-09-19T16:00:00.000Z");
  assert.equal(parsed(parseWhen("tonight call", NOW, MSK)).at, "2026-09-19T16:00:00.000Z");
  assert.equal(parsed(parseWhen("tonight call", NOW, NY)).at, "2026-09-19T23:00:00.000Z");

  // «сегодня утром» at noon is behind us and is refused rather than rolled.
  assert.equal(TIME_OF_DAY_HOURS.morning, 9);
  assert.equal(failure(parseWhen("сегодня утром зарядка", NOW, MSK)), "in_the_past");
  const dawn = new Date("2026-09-19T04:00:00.000Z"); // 07:00 Moscow
  assert.equal(parsed(parseWhen("сегодня утром зарядка", dawn, MSK)).at, "2026-09-19T06:00:00.000Z");
});

test("завтра / tomorrow with a clock, in the person's zone", () => {
  assert.equal(parsed(parseWhen("завтра 18:00 Позвонить", NOW, MSK)).at, "2026-09-20T15:00:00.000Z");
  assert.equal(parsed(parseWhen("tomorrow 18:00 call", NOW, MSK)).at, "2026-09-20T15:00:00.000Z");
  assert.equal(parsed(parseWhen("tomorrow at 18:00 call", NOW, MSK)).at, "2026-09-20T15:00:00.000Z");
  assert.equal(parsed(parseWhen("завтра, 18:00 Позвонить", NOW, MSK)).at, "2026-09-20T15:00:00.000Z");
  assert.equal(parsed(parseWhen("завтра 18.00 Позвонить", NOW, MSK)).at, "2026-09-20T15:00:00.000Z");
  assert.equal(parsed(parseWhen("послезавтра 09:30 Встреча", NOW, MSK)).at, "2026-09-21T06:30:00.000Z");
  // The same words, a different zone: this is the assertion that would go red
  // if the parser ever resolved a wall time against the server's own clock.
  assert.equal(parsed(parseWhen("завтра 18:00 Позвонить", NOW, NY)).at, "2026-09-20T22:00:00.000Z");
});

test("завтра alone takes a default hour and says that it did", () => {
  const result = parsed(parseWhen("завтра Позвонить", NOW, MSK));
  assert.equal(DEFAULT_DAY_HOUR, 9);
  assert.equal(result.at, "2026-09-20T06:00:00.000Z");
  assert.equal(result.body, "Позвонить");
  // The flag is the whole contract of a guessed hour: the caller echoes the
  // absolute time back so the guess is visible, and a caller that wanted to
  // refuse guesses instead can.
  assert.equal(result.assumed, true);
});

test("a day word does not override a clock written later in the sentence", () => {
  // «завтра Позвонить в 18:00» read as a bare day word gives 09:00 — a
  // reminder nine hours early, with a confirmation that correctly says
  // «завтра», which is why nobody notices. The day word yields to the clock.
  const result = parsed(parseWhen("завтра Позвонить в 18:00", NOW, MSK));
  assert.equal(result.at, "2026-09-20T15:00:00.000Z");
  assert.equal(result.body, "Позвонить");
  assert.equal(result.assumed, false);

  const evening = parsed(parseWhen("завтра Позвонить вечером", NOW, MSK));
  assert.equal(evening.at, "2026-09-20T16:00:00.000Z");
  assert.equal(evening.body, "Позвонить");

  const dated = parsed(parseWhen("05.10 Забрать в 18:00", NOW, MSK));
  assert.equal(dated.at, "2026-10-05T15:00:00.000Z");
  assert.equal(dated.body, "Забрать");
});

test("an explicit date, with and without a year", () => {
  assert.equal(parsed(parseWhen("05.10 18:00 Забрать", NOW, MSK)).at, "2026-10-05T15:00:00.000Z");
  assert.equal(parsed(parseWhen("05.10.2027 18:00 Забрать", NOW, MSK)).at, "2027-10-05T15:00:00.000Z");
  assert.equal(parsed(parseWhen("05.10.27 18:00 Забрать", NOW, MSK)).at, "2027-10-05T15:00:00.000Z");
  // A day already past this year is next year, not last year. This is the one
  // place a floating year is allowed to make a decision, and it only ever
  // moves forward.
  const rolled = parsed(parseWhen("01.02 Дата", NOW, MSK));
  assert.equal(rolled.at, "2027-02-01T06:00:00.000Z");
  assert.equal(rolled.assumed, true);
});

test("a dot at the start of the input is a date, a colon is a clock", () => {
  // The documented disambiguation. `01.02` must not become one minute past
  // one, and `18:00` must not become the eighteenth of some month.
  assert.equal(parsed(parseWhen("01.02 x", NOW, MSK)).at, "2027-02-01T06:00:00.000Z");
  assert.equal(parsed(parseWhen("18:00 x", NOW, MSK)).at, "2026-09-19T15:00:00.000Z");
  assert.equal(parsed(parseWhen("в 18:00 Позвонить", NOW, MSK)).at, "2026-09-19T15:00:00.000Z");
});

test("a time expression at the end of a sentence is read, a partial one is not", () => {
  const trailing = parsed(parseWhen("Проверить сервер через 20 минут", NOW, MSK));
  assert.equal(trailing.at, "2026-09-19T09:20:00.000Z");
  assert.equal(trailing.body, "Проверить сервер");

  assert.equal(parsed(parseWhen("Позвонить завтра 18:00", NOW, MSK)).body, "Позвонить");
  assert.equal(parsed(parseWhen("Позвонить в 18:00", NOW, MSK)).body, "Позвонить");

  // «3 дня» parses but «отпуска» is left over, so the tail is not a time.
  // Accepting a partial tail here is what would turn a shopping list into a
  // reminder three days out.
  assert.equal(failure(parseWhen("Заказать 3 дня отпуска", NOW, MSK)), "unrecognized");
});

test("every refusal has its own name", () => {
  assert.equal(failure(parseWhen("", NOW, MSK)), "empty");
  assert.equal(failure(parseWhen("   ", NOW, MSK)), "empty");
  assert.equal(failure(parseWhen("Проверить сервер", NOW, MSK)), "unrecognized");
  assert.equal(failure(parseWhen("20m", NOW, MSK)), "missing_body");
  assert.equal(failure(parseWhen("завтра", NOW, MSK)), "missing_body");
  assert.equal(failure(parseWhen("завтра 25:70 Ошибка", NOW, MSK)), "invalid_clock");
  assert.equal(failure(parseWhen("31.02 10:00 Никогда", NOW, MSK)), "invalid_date");
  assert.equal(failure(parseWhen("31.04 10:00 Никогда", NOW, MSK)), "invalid_date");
  assert.equal(failure(parseWhen("40.13 10:00 Никогда", NOW, MSK)), "invalid_date");
  assert.equal(failure(parseWhen("99999 дней Долго", NOW, MSK)), "out_of_range");
  assert.equal(failure(parseWhen("20m Проверить", NOW, "Mars/Olympus")), "unknown_time_zone");
});

test("a time that has already passed is refused, never rolled forward", () => {
  // 23:00 in Moscow. «сегодня вечером» is behind us and «18:00» is behind us.
  // Quietly moving either to tomorrow produces a reminder twenty-three hours
  // late that the person believes they set for tonight.
  const late = new Date("2026-09-19T20:00:00.000Z");
  assert.equal(failure(parseWhen("сегодня вечером Позвонить", late, MSK)), "in_the_past");
  assert.equal(failure(parseWhen("в 18:00 Позвонить", late, MSK)), "in_the_past");
  assert.equal(failure(parseWhen("tonight call", late, MSK)), "in_the_past");
  // …and in a zone where it is still early, the same words are fine.
  assert.equal(parsed(parseWhen("tonight call", late, NY)).at, "2026-09-19T23:00:00.000Z");
});

test("a zero-length delay is in the past, not «now»", () => {
  assert.equal(failure(parseWhen("0m Сейчас", NOW, MSK)), "in_the_past");
});

test("daylight saving is handled by asking the zone, not by adding hours", () => {
  // Clocks go forward in New York on 8 March 2026 at 02:00. An implementation
  // that took «tomorrow» as «+86400000 ms» would be an hour out on this date,
  // and correct on every date a casual test would pick.
  const beforeTransition = new Date("2026-03-07T17:00:00.000Z"); // 12:00 EST
  assert.equal(
    parsed(parseWhen("завтра 18:00 Позвонить", beforeTransition, NY)).at,
    "2026-03-08T22:00:00.000Z",
  );
  assert.equal(
    parsed(parseWhen("сегодня 18:00 Позвонить", beforeTransition, NY)).at,
    "2026-03-07T23:00:00.000Z",
  );
});

test("a wall time inside the spring-forward gap resolves to the instant after it", () => {
  // 02:30 on 8 March does not exist in New York. There is no right answer; the
  // documented one is the instant just after the gap, and it must be stable
  // rather than NaN or a silent day earlier.
  const before = new Date("2026-03-07T17:00:00.000Z");
  const result = parsed(parseWhen("08.03 02:30 Встреча", before, NY));
  assert.equal(result.at, "2026-03-08T07:30:00.000Z");
  assert.equal(zonedPartsOf(new Date(result.at), NY).hour, 3);
});

test("the zone round trip is exact for a zone with no transition in play", () => {
  const instant = instantFromZonedParts(
    { year: 2026, month: 9, day: 19, hour: 18, minute: 30 },
    MSK,
  );
  assert.equal(instant.toISOString(), "2026-09-19T15:30:00.000Z");
  assert.deepEqual(zonedPartsOf(instant, MSK), {
    year: 2026,
    month: 9,
    day: 19,
    hour: 18,
    minute: 30,
    second: 0,
  });
});

test("isKnownTimeZone tells a real zone from a plausible string", () => {
  assert.equal(isKnownTimeZone(MSK), true);
  assert.equal(isKnownTimeZone("UTC"), true);
  assert.equal(isKnownTimeZone("Europe/Moskva"), false);
  assert.equal(isKnownTimeZone(""), false);
});

test("the same input twice is the same answer", () => {
  // Purity, stated as a test: nothing here is memoised against a clock, and a
  // second call cannot drift because the first one warmed a formatter cache.
  const first = parseWhen("завтра 18:00 Позвонить", NOW, MSK);
  const second = parseWhen("завтра 18:00 Позвонить", NOW, MSK);
  assert.deepEqual(parsed(first), parsed(second));
});

test("formatWhen names the day the person would name", () => {
  assert.equal(formatWhen(new Date("2026-09-19T16:00:00.000Z"), NOW, MSK), "сегодня в 19:00");
  assert.equal(formatWhen(new Date("2026-09-20T15:00:00.000Z"), NOW, MSK), "завтра в 18:00");
  assert.equal(formatWhen(new Date("2026-09-21T06:30:00.000Z"), NOW, MSK), "послезавтра в 09:30");
  assert.equal(formatWhen(new Date("2026-10-05T15:00:00.000Z"), NOW, MSK), "5 октября в 18:00");
  assert.equal(
    formatWhen(new Date("2027-02-01T06:00:00.000Z"), NOW, MSK),
    "1 февраля 2027 в 09:00",
  );
  // The same instant, described to somebody five hours west: a confirmation
  // that used the server's zone would tell half the users the wrong hour.
  assert.equal(formatWhen(new Date("2026-09-20T15:00:00.000Z"), NOW, NY), "завтра в 11:00");
});

test("a refusal can be shown to a person without leaking the code", () => {
  const late = new Date("2026-09-19T20:00:00.000Z");
  const result = parseWhen("в 18:00 Позвонить", late, MSK);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  const message = describeWhenFailure(result, MSK);
  assert.match(message, /уже прошло/);
  assert.doesNotMatch(message, /in_the_past/);
});
