import assert from "node:assert/strict";
import test from "node:test";

import * as everything from "../../artifacts/kub/src/lib/sessionDevices.ts";
import {
  CALLS_GATE_FRESH_MS,
  SESSION_DEVICE_CURRENT_LABEL,
  SESSION_DEVICE_UNKNOWN_TITLE,
  classifySessionDeviceError,
  describeLastSeen,
  describeUserAgent,
  incomingRingVerdict,
  orderSessionDevices,
  readCallsAllowed,
  readSessionDeviceRows,
  sessionDeviceRefusalText,
  sessionDevicesSummary,
  type SessionDeviceRefusal,
  type SessionDeviceRow,
} from "../../artifacts/kub/src/lib/sessionDevices.ts";

/**
 * «Активные сеансы», and the switch that decides whether a telephone rings.
 *
 * Slice F of `docs/proposals/2026-09-18-one-to-one-calls.md`. The database half
 * is applied and rehearsed on production; what is asserted here is the client's
 * reading of it — which row is which, what a row is called, and the one
 * decision that has an audible consequence.
 *
 * **Every user agent below is invented or is a published generic string.** None
 * came off production, and neither did any address: `session_devices_list`
 * returns an IP because it is the reader's own, and it is never to appear in a
 * fixture, a screenshot or a report.
 */

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const S1 = "aaaaaaaa-1111-4111-8111-000000000001";
const S2 = "bbbbbbbb-2222-4222-8222-000000000002";
const S3 = "cccccccc-3333-4333-8333-000000000003";

function device(over: Partial<SessionDeviceRow> = {}): SessionDeviceRow {
  return {
    sessionId: S1,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    ip: "198.51.100.7",
    createdAt: NOW - 20 * DAY,
    refreshedAt: NOW - 5 * MINUTE,
    callsEnabled: true,
    isCurrent: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Reading what the function answered
// ---------------------------------------------------------------------------

test("a row is read out of exactly the columns the function returns", () => {
  const rows = readSessionDeviceRows([
    {
      session_id: S1,
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36",
      ip: "198.51.100.7",
      created_at: "2026-09-01T09:00:00.000Z",
      refreshed_at: "2026-09-18T11:55:00.000Z",
      calls_enabled: false,
      is_current: true,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, S1);
  assert.equal(rows[0].ip, "198.51.100.7");
  assert.equal(rows[0].createdAt, Date.parse("2026-09-01T09:00:00.000Z"));
  assert.equal(rows[0].refreshedAt, Date.parse("2026-09-18T11:55:00.000Z"));
  assert.equal(rows[0].callsEnabled, false);
  assert.equal(rows[0].isCurrent, true);
});

test("a row with no session id is dropped rather than repaired", () => {
  // The id is the only thing a switch can be aimed at. A row without one would
  // draw a control whose press cannot go anywhere.
  assert.deepEqual(readSessionDeviceRows([{ user_agent: "x", calls_enabled: true }]), []);
  assert.deepEqual(readSessionDeviceRows(null), []);
  assert.deepEqual(readSessionDeviceRows("nonsense"), []);
  assert.deepEqual(readSessionDeviceRows([null, 7, "x"]), []);
});

test("a device whose preference cannot be read still rings", () => {
  // `coalesce(st.calls_enabled, true)` in the function, and the same direction
  // `voice_calls_allowed_here` takes. Only an explicit `false` silences.
  assert.equal(readSessionDeviceRows([{ session_id: S1 }])[0].callsEnabled, true);
  assert.equal(readSessionDeviceRows([{ session_id: S1, calls_enabled: null }])[0].callsEnabled, true);
  assert.equal(readSessionDeviceRows([{ session_id: S1, calls_enabled: false }])[0].callsEnabled, false);
});

test("«this device» is claimed only by a true, because the claim may be absent", () => {
  // False for every row is the state the migration designed for: an access
  // token with no `session_id` claim. Anything truthy-but-not-true would make
  // the highlight appear on a row that never said it was current.
  assert.equal(readSessionDeviceRows([{ session_id: S1 }])[0].isCurrent, false);
  assert.equal(readSessionDeviceRows([{ session_id: S1, is_current: null }])[0].isCurrent, false);
  assert.equal(readSessionDeviceRows([{ session_id: S1, is_current: "yes" }])[0].isCurrent, false);
  assert.equal(readSessionDeviceRows([{ session_id: S1, is_current: true }])[0].isCurrent, true);
});

test("a timestamp that is not a timestamp is null rather than NaN", () => {
  const row = readSessionDeviceRows([
    { session_id: S1, created_at: "not a date", refreshed_at: 17 },
  ])[0];
  assert.equal(row.createdAt, null);
  assert.equal(row.refreshedAt, null);
});

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

test("this device is first and the rest are newest first", () => {
  const ordered = orderSessionDevices([
    device({ sessionId: S1, refreshedAt: NOW - 2 * DAY }),
    device({ sessionId: S2, refreshedAt: NOW - 9 * DAY, isCurrent: true }),
    device({ sessionId: S3, refreshedAt: NOW - MINUTE }),
  ]);
  assert.deepEqual(
    ordered.map((row) => row.sessionId),
    [S2, S3, S1],
  );
});

test("with nothing marked current the server's own order stands", () => {
  const ordered = orderSessionDevices([
    device({ sessionId: S3, refreshedAt: NOW - MINUTE }),
    device({ sessionId: S1, refreshedAt: NOW - 2 * DAY }),
    device({ sessionId: S2, refreshedAt: null }),
  ]);
  // `refreshed_at desc nulls last`, which is the function's own clause.
  assert.deepEqual(
    ordered.map((row) => row.sessionId),
    [S3, S1, S2],
  );
});

test("two rows seen at the same moment keep one order between evaluations", () => {
  // A list that reorders itself between two evaluations of the same facts is a
  // surface that moves a switch out from under a thumb.
  const rows = [
    device({ sessionId: S3, refreshedAt: NOW - HOUR }),
    device({ sessionId: S1, refreshedAt: NOW - HOUR }),
  ];
  assert.deepEqual(
    orderSessionDevices(rows).map((row) => row.sessionId),
    [S1, S3],
  );
  assert.deepEqual(
    orderSessionDevices([...rows].reverse()).map((row) => row.sessionId),
    [S1, S3],
  );
});

test("ordering hands back a copy, so a caller cannot reorder the store", () => {
  const rows = [device({ sessionId: S1 }), device({ sessionId: S3 })];
  const ordered = orderSessionDevices(rows);
  ordered.length = 0;
  assert.equal(rows.length, 2);
});

// ---------------------------------------------------------------------------
// Naming a device, which is a reading of a string and not a fact about hardware
// ---------------------------------------------------------------------------

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/141.0.0.0`;
const YANDEX_WINDOWS = `${CHROME_WINDOWS.replace("Safari/537.36", "YaBrowser/24.10.0.0 Safari/537.36")}`;
const OPERA_WINDOWS = `${CHROME_WINDOWS} OPR/114.0.0.0`;
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const APK_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

test("a user agent this file recognises gives a system and an application", () => {
  assert.deepEqual(
    [
      describeUserAgent(CHROME_WINDOWS).title,
      describeUserAgent(EDGE_WINDOWS).title,
      describeUserAgent(YANDEX_WINDOWS).title,
      describeUserAgent(OPERA_WINDOWS).title,
      describeUserAgent(CHROME_ANDROID).title,
      describeUserAgent(SAFARI_IPHONE).title,
      describeUserAgent(SAFARI_MAC).title,
      describeUserAgent(FIREFOX_LINUX).title,
    ],
    [
      "Windows · Chrome",
      "Windows · Edge",
      "Windows · Яндекс Браузер",
      "Windows · Opera",
      "Android · Chrome",
      "iPhone · Safari",
      "macOS · Safari",
      "Linux · Firefox",
    ],
  );
  assert.equal(describeUserAgent(CHROME_WINDOWS).kind, "known");
});

test("the narrow marks are read before the wide ones, in both halves", () => {
  // Every Chromium browser says `Chrome` and most say `Safari`; Android's own
  // string says `Linux`. Reorder either list and these four become «Chrome» and
  // «Linux», which is the whole of what a user agent parser gets wrong.
  assert.equal(describeUserAgent(EDGE_WINDOWS).title, "Windows · Edge");
  assert.equal(describeUserAgent(OPERA_WINDOWS).title, "Windows · Opera");
  assert.equal(describeUserAgent(YANDEX_WINDOWS).title, "Windows · Яндекс Браузер");
  assert.equal(describeUserAgent(CHROME_ANDROID).title, "Android · Chrome");
});

test("an Android WebView is called «приложение», which is an inference and not a lookup", () => {
  // `; wv` marks a WebView rather than a browser, and the only WebView that can
  // hold a session here is this product's own APK. It is still a guess —
  // somebody signed in inside another application's built-in browser reads the
  // same — which is why it is not called «LETSCUBE».
  assert.equal(describeUserAgent(APK_ANDROID).title, "Android · приложение");
  assert.equal(describeUserAgent(CHROME_ANDROID).title, "Android · Chrome");
});

test("half a name is given where half was recognised", () => {
  const platformOnly = describeUserAgent("Mozilla/5.0 (Windows NT 10.0) SomeShell/2");
  assert.equal(platformOnly.title, "Windows");
  assert.equal(platformOnly.kind, "partial");

  const appOnly = describeUserAgent("Firefox/130.0");
  assert.equal(appOnly.title, "Firefox");
  assert.equal(appOnly.kind, "partial");
});

test("a string nothing recognises is said to be unrecognised, and is still shown", () => {
  // A confident wrong name is worse than none. The string itself goes back,
  // because a person may well recognise what no pattern here does.
  const odd = describeUserAgent("okhttp/4.12.0");
  assert.equal(odd.title, SESSION_DEVICE_UNKNOWN_TITLE);
  assert.equal(odd.kind, "unknown");
  assert.equal(odd.raw, "okhttp/4.12.0");
});

test("no user agent at all leaves nothing to show", () => {
  for (const value of ["", "   ", null, undefined, 7 as unknown as string]) {
    const label = describeUserAgent(value as string | null | undefined);
    assert.equal(label.title, SESSION_DEVICE_UNKNOWN_TITLE);
    assert.equal(label.kind, "unknown");
    assert.equal(label.raw, "");
  }
});

test("the raw string is bounded and flattened before it can reach a row", () => {
  const long = `Mozilla/5.0 (${"X".repeat(400)})`;
  const label = describeUserAgent(long);
  assert.equal(label.raw.length, 96);
  assert.ok(label.raw.endsWith("…"));
  assert.equal(describeUserAgent("  Chrome/1\n\tSafari/2  ").raw, "Chrome/1 Safari/2");
});

// ---------------------------------------------------------------------------
// When it was last seen
// ---------------------------------------------------------------------------

test("the last-seen line is relative all the way out, and counts in Russian", () => {
  const at = (ago: number) => describeLastSeen(NOW - ago, NOW);
  assert.equal(at(0), "только что");
  assert.equal(at(89_000), "только что");
  assert.equal(at(90_000), "1 минуту назад");
  assert.equal(at(2 * MINUTE), "2 минуты назад");
  assert.equal(at(5 * MINUTE), "5 минут назад");
  assert.equal(at(11 * MINUTE), "11 минут назад");
  assert.equal(at(21 * MINUTE), "21 минуту назад");
  assert.equal(at(59 * MINUTE), "59 минут назад");
  assert.equal(at(HOUR), "1 час назад");
  assert.equal(at(2 * HOUR), "2 часа назад");
  assert.equal(at(5 * HOUR), "5 часов назад");
  assert.equal(at(11 * HOUR), "11 часов назад");
  assert.equal(at(21 * HOUR), "21 час назад");
  assert.equal(at(23 * HOUR), "23 часа назад");
  assert.equal(at(DAY), "вчера");
  assert.equal(at(2 * DAY - 1), "вчера");
  assert.equal(at(2 * DAY), "2 дня назад");
  assert.equal(at(5 * DAY), "5 дней назад");
  assert.equal(at(11 * DAY), "11 дней назад");
  assert.equal(at(21 * DAY), "21 день назад");
  assert.equal(at(29 * DAY), "29 дней назад");
});

test("beyond the server's own window it says so rather than inventing a date", () => {
  // `session_devices_list` returns nothing older than thirty days, so this is
  // unreachable through the interface. It exists so a row arriving through some
  // future widening reads as something rather than as a wrong date — and so
  // that this file never needs a timezone, a locale or a month table.
  assert.equal(describeLastSeen(NOW - 30 * DAY, NOW), "больше месяца назад");
  assert.equal(describeLastSeen(NOW - 400 * DAY, NOW), "больше месяца назад");
});

test("two clocks disagreeing is «только что», not a device seen in the future", () => {
  assert.equal(describeLastSeen(NOW + HOUR, NOW), "только что");
});

test("a session with no refresh at all says so", () => {
  assert.equal(describeLastSeen(null, NOW), "время последнего входа неизвестно");
});

// ---------------------------------------------------------------------------
// The value the closed row prints
// ---------------------------------------------------------------------------

test("the settings row counts the devices, and says when one is silent", () => {
  const summary = (count: number, silenced: number) =>
    sessionDevicesSummary({ count, silenced, loading: false, failed: false });
  assert.equal(summary(1, 0), "1 устройство");
  assert.equal(summary(2, 0), "2 устройства");
  assert.equal(summary(5, 0), "5 устройств");
  assert.equal(summary(11, 0), "11 устройств");
  assert.equal(summary(21, 0), "21 устройство");
  assert.equal(summary(3, 1), "3 устройства · без звонков: 1");
  assert.equal(summary(0, 0), "нет");
});

test("the row says «loading» only while it has nothing, and names a failure", () => {
  assert.equal(sessionDevicesSummary({ count: 0, silenced: 0, loading: true, failed: false }), "…");
  // A refresh over a list that is already on screen must not blank the value.
  assert.equal(
    sessionDevicesSummary({ count: 2, silenced: 0, loading: true, failed: false }),
    "2 устройства",
  );
  assert.equal(
    sessionDevicesSummary({ count: 0, silenced: 0, loading: false, failed: true }),
    "не удалось загрузить",
  );
});

// ---------------------------------------------------------------------------
// The one decision with an audible consequence
// ---------------------------------------------------------------------------

test("a device that refuses calls shows nothing for an incoming one", () => {
  assert.equal(
    incomingRingVerdict({ direction: "incoming", allowed: false, checkedAt: NOW, now: NOW }),
    "silence",
  );
  assert.equal(
    incomingRingVerdict({ direction: "incoming", allowed: true, checkedAt: NOW, now: NOW }),
    "show",
  );
});

test("a device this person is calling **from** always shows its own call", () => {
  // The surface that cancels an outgoing ring is the only thing that clears the
  // row from the caller's side. Silencing it would strand the ring, and it is
  // not what the switch is about: the switch is about calls arriving here.
  assert.equal(
    incomingRingVerdict({ direction: "outgoing", allowed: false, checkedAt: null, now: NOW }),
    "show",
  );
  assert.equal(
    incomingRingVerdict({ direction: null, allowed: false, checkedAt: null, now: NOW }),
    "show",
  );
});

test("«off» is answered before staleness, and «on» is not", () => {
  // The asymmetry is the design. A stale «off» is kept, because flickering a
  // ring onto a silenced telephone for one round trip is louder than the
  // problem it solves. A stale «on» waits, because it is the one reading that
  // can ring a device somebody has just silenced from their phone.
  const stale = NOW - CALLS_GATE_FRESH_MS - 1;
  assert.equal(
    incomingRingVerdict({ direction: "incoming", allowed: false, checkedAt: stale, now: NOW }),
    "silence",
  );
  assert.equal(
    incomingRingVerdict({ direction: "incoming", allowed: true, checkedAt: stale, now: NOW }),
    "wait",
  );
});

test("the freshness boundary is the constant, on both sides of it", () => {
  const at = (age: number) =>
    incomingRingVerdict({ direction: "incoming", allowed: true, checkedAt: NOW - age, now: NOW });
  assert.equal(at(CALLS_GATE_FRESH_MS), "show");
  assert.equal(at(CALLS_GATE_FRESH_MS + 1), "wait");
  assert.equal(
    incomingRingVerdict({
      direction: "incoming",
      allowed: true,
      checkedAt: NOW - 100,
      now: NOW,
      freshForMs: 50,
    }),
    "wait",
  );
});

test("an answer that was never taken waits rather than ringing on a guess", () => {
  assert.equal(
    incomingRingVerdict({ direction: "incoming", allowed: true, checkedAt: null, now: NOW }),
    "wait",
  );
  assert.equal(
    incomingRingVerdict({ direction: "incoming", allowed: false, checkedAt: null, now: NOW }),
    "wait",
  );
});

test("anything that is not a boolean means «this telephone may ring»", () => {
  // A deployment whose migration has not landed answers PGRST202, a fixture
  // with no opinion answers null, and neither of them is a person saying «do
  // not ring this telephone».
  assert.equal(readCallsAllowed(true), true);
  assert.equal(readCallsAllowed(false), false);
  for (const value of [null, undefined, 0, 1, "", "false", {}, []]) {
    assert.equal(readCallsAllowed(value), true, `${JSON.stringify(value) ?? "undefined"} silenced a device`);
  }
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("a refusal is read off the message, with the SQLSTATE as the fallback", () => {
  // `raise exception 'no_such_device' using errcode = 'P0002'` reaches a client
  // as `{code: "P0002", message: "no_such_device"}`. The message carries the
  // name; the code is evidence only when the name is missing.
  assert.equal(
    classifySessionDeviceError({ code: "P0002", message: "no_such_device" }),
    "no_such_device",
  );
  assert.equal(
    classifySessionDeviceError({ code: "28000", message: "not_authenticated" }),
    "not_authenticated",
  );
  assert.equal(classifySessionDeviceError({ code: "22023", message: "bad_request" }), "bad_request");
  assert.equal(classifySessionDeviceError({ code: "P0002", message: "" }), "no_such_device");
  assert.equal(classifySessionDeviceError({ code: "28000", message: "" }), "not_authenticated");
  assert.equal(classifySessionDeviceError({ code: "22023", message: "" }), "bad_request");
});

test("a deployment whose migration has not landed is its own answer", () => {
  for (const code of ["42P01", "PGRST202", "PGRST205"]) {
    assert.equal(classifySessionDeviceError({ code, message: "" }), "unsupported");
  }
});

test("a fetch that reached nothing is a network refusal, not an unknown one", () => {
  assert.equal(classifySessionDeviceError({ message: "Failed to fetch" }), "network");
  assert.equal(classifySessionDeviceError("Load failed"), "network");
  assert.equal(classifySessionDeviceError({ code: "", message: "" }), "unknown");
  assert.equal(classifySessionDeviceError(null), "unknown");
});

test("every refusal has a sentence, and none of them carries a code", () => {
  const codes: readonly SessionDeviceRefusal[] = [
    "no_such_device",
    "not_authenticated",
    "bad_request",
    "unsupported",
    "network",
    "unknown",
  ];
  for (const code of codes) {
    const text = sessionDeviceRefusalText(code);
    assert.ok(text.length > 0, `${code} says nothing`);
    assert.ok(/[.!?]$/.test(text), `${code} is not a sentence`);
    assert.equal(/P0002|PGRST|22023|28000|42P01|null|rpc/i.test(text), false, `${code} leaks a code`);
  }
});

test("the refusal for somebody else's session says nothing about whose it is", () => {
  // The function answers `no_such_device` to an id that does not exist and to
  // one that belongs to somebody else, deliberately and identically, so that it
  // cannot be used to discover whether a session id exists. A sentence that
  // guessed which had happened would undo that in the interface.
  const text = sessionDeviceRefusalText("no_such_device");
  assert.equal(/чуж|другого пользоват|не ваш/i.test(text), false);
  assert.ok(text.includes("списке"));
});

// ---------------------------------------------------------------------------
// What this slice deliberately cannot say
// ---------------------------------------------------------------------------

test("nothing here has the words to end a session", () => {
  // Telegram's «Активные сеансы» ends a session from the list; this does not,
  // and that is the migration's decision rather than an omission. Keeping the
  // vocabulary out is what makes adding the button a thing somebody has to
  // write words for on purpose rather than a thing that drifts in.
  const copy = Object.values(everything)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase("ru-RU");
  for (const forbidden of ["завершить", "выйти", "отключить устройство", "разлогин"]) {
    assert.equal(copy.includes(forbidden), false, `the vocabulary grew «${forbidden}»`);
  }
  assert.ok(copy.includes(SESSION_DEVICE_CURRENT_LABEL.toLocaleLowerCase("ru-RU")));
});
