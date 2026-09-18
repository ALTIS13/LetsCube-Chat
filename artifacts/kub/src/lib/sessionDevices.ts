/**
 * Where somebody is signed in, and which of those places may ring.
 *
 * Slice F of `docs/proposals/2026-09-18-one-to-one-calls.md`, client half. The
 * database half is `supabase/migrations/20260918290000_a_device_can_refuse_calls.sql`,
 * applied and rehearsed on production; this file is the mirror of everything
 * that migration leaves to the reader — what a row is called, when it was last
 * seen, which one is «this» one, and whether a ring may be drawn at all.
 *
 * This module imports nothing on purpose. The lesson is in CLAUDE.md and again
 * at the head of `lib/micGate.ts`, `lib/voiceRing.ts` and `lib/callRecord.ts`:
 * a decision inside a `"use client"` module is a decision with no test, and
 * moving the decision is cheaper than building a harness around it.
 * `tests/unit/session-devices.test.mts` holds everything here.
 *
 * ## The shape the owner chose, and the one they refused
 *
 * Shape **B** — a registry visible and changeable from any device, which is
 * Telegram's «Активные сеансы» — rather than shape A, a switch stored on the
 * device it silences. A can only be operated *from* the device it governs,
 * which is the lesser function wearing the larger one's name.
 *
 * ## What is deliberately not here
 *
 * **Ending a session.** Telegram's list has it; this one does not, and that is
 * the migration's decision rather than an omission — signing another device out
 * is a security action with its own failure modes, and what was asked for is
 * the call switch. There is no vocabulary for it below, so a surface cannot
 * grow the button without somebody writing the words on purpose.
 *
 * **The IP address is carried but never printed by anything except the one
 * person's own screen.** `session_devices_list` returns it because «where» is
 * half of what makes such a list useful. It is never to appear in a screenshot,
 * a fixture or a report.
 */

/* ── A row, read defensively ───────────────────────────────────────────────── */

/** One authorisation, as `session_devices_list()` answers it. */
export interface SessionDeviceRow {
  readonly sessionId: string;
  /** Arbitrary text a browser sent. Never trusted to mean anything. */
  readonly userAgent: string;
  /** The reader's own address, as `host(s.ip)` renders it. May be empty. */
  readonly ip: string;
  readonly createdAt: number | null;
  /** When this authorisation last came back for a token. */
  readonly refreshedAt: number | null;
  readonly callsEnabled: boolean;
  /**
   * Whether this is the device doing the reading.
   *
   * **False for every row is a state that has to work.** It is what the whole
   * list looks like if the access token carries no `session_id` claim — the one
   * assumption the migration rests on — and the feature is then «you can see
   * your devices and silence any of them», losing only the ability to point at
   * this one.
   */
  readonly isCurrent: boolean;
}

function readInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * The rows, out of whatever PostgREST returned.
 *
 * A row without a session id is dropped rather than repaired: the id is the
 * only thing the switch can be aimed at, and a row without one would draw a
 * control whose press cannot go anywhere.
 *
 * `calls_enabled` absent reads as **true**, which is `coalesce(st.calls_enabled,
 * true)` in the function and the same direction `voice_calls_allowed_here`
 * takes. A device whose preference cannot be read rings.
 */
export function readSessionDeviceRows(rows: unknown): SessionDeviceRow[] {
  if (!Array.isArray(rows)) return [];
  const out: SessionDeviceRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const sessionId = typeof record.session_id === "string" ? record.session_id : null;
    if (!sessionId) continue;
    out.push({
      sessionId,
      userAgent: typeof record.user_agent === "string" ? record.user_agent : "",
      ip: typeof record.ip === "string" ? record.ip : "",
      createdAt: readInstant(record.created_at),
      refreshedAt: readInstant(record.refreshed_at),
      callsEnabled: record.calls_enabled !== false,
      isCurrent: record.is_current === true,
    });
  }
  return out;
}

/**
 * This device first, then the most recently seen.
 *
 * The function already orders by `refreshed_at desc nulls last`; this adds the
 * one thing SQL cannot know is worth doing — putting the row somebody is
 * looking *from* at the top, which is where Telegram puts it and where the eye
 * goes first. With no current row the order is the server's, unchanged.
 *
 * Ties break on the session id rather than being left to sort stability,
 * because a list that reorders itself between two evaluations of the same facts
 * is a surface that moves a switch out from under a thumb.
 */
export function orderSessionDevices(rows: readonly SessionDeviceRow[]): SessionDeviceRow[] {
  return [...rows].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const left = a.refreshedAt ?? Number.NEGATIVE_INFINITY;
    const right = b.refreshedAt ?? Number.NEGATIVE_INFINITY;
    if (left !== right) return right - left;
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  });
}

/* ── Naming a device, which is guesswork and has to read as guesswork ──────── */

/** How much of a user agent was recognised. */
export type SessionDeviceLabelKind = "known" | "partial" | "unknown";

export interface SessionDeviceLabel {
  /** What the row is called. Never empty. */
  readonly title: string;
  readonly kind: SessionDeviceLabelKind;
  /**
   * The user agent itself, trimmed and bounded.
   *
   * Carried for every row so a surface can offer it as a tooltip, and **shown**
   * only when nothing was recognised: an unreadable string the person may still
   * recognise is worth more to them than a confident wrong name, and it is
   * their own device's string rather than anybody else's.
   */
  readonly raw: string;
}

/** Shown where the string recognised nothing, and where there was no string. */
export const SESSION_DEVICE_UNKNOWN_TITLE = "Неизвестное устройство";

/** Marks the row the reader is looking from. */
export const SESSION_DEVICE_CURRENT_LABEL = "Это устройство";

/**
 * Said under the list when no row is marked.
 *
 * The honest sentence for the case the migration designed for: the access
 * token carried no `session_id` claim, so nothing can point at this device. The
 * list is still exactly right and every switch still works, which is what this
 * says rather than apologising.
 */
export const SESSION_DEVICE_NO_CURRENT_HINT =
  "Не удалось определить, с какого устройства вы смотрите. Звонки можно выключить на любом из списка.";

/** The one line that says what the switches are for. */
export const SESSION_DEVICE_CALLS_HINT =
  "Звонок приходит сразу на все устройства. Выключите звонки там, где они не нужны — запись о пропущенном звонке всё равно останется в переписке.";

/** The label beside every switch. */
export const SESSION_DEVICE_CALLS_LABEL = "Принимать звонки";

const MAX_RAW = 96;

function flatten(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The bound is for the **row**, and is applied after the reading rather than
 * before it.
 *
 * Written the other way round first, and its own test caught it: a real user
 * agent puts the mark that names the browser at the *end* — «… Chrome/141.0.0.0
 * Safari/537.36 Edg/141.0.0.0» is 130 characters — so parsing a string cut at
 * 96 named Edge as Chrome and Safari on an iPhone as nothing at all. A display
 * limit that quietly changes an answer is the worst kind.
 */
function bound(value: string): string {
  return value.length > MAX_RAW ? `${value.slice(0, MAX_RAW - 1)}…` : value;
}

/**
 * Which operating system sent this, as far as anybody can tell.
 *
 * The order is not alphabetical and cannot be reordered safely: Android's own
 * user agent contains the word `Linux`, and an iPad's may contain `Macintosh`
 * when «Request Desktop Site» is on — which is exactly why the narrower name is
 * asked for first in both pairs.
 */
function readPlatform(ua: string): string | null {
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/X11|Linux/i.test(ua)) return "Linux";
  return null;
}

/**
 * Which application sent this, as far as anybody can tell — and here the order
 * is the whole of the guess.
 *
 * Every Chromium browser says `Chrome` somewhere in its string, and most say
 * `Safari` too, so asking about `Chrome` first would name Edge, Opera and
 * Яндекс as Chrome and Safari as nothing. The narrow marks are asked for first
 * and `Chrome` is the fallback among them, which is the convention every user
 * agent parser converges on and is still only a convention.
 *
 * **`; wv` is the one inference rather than a lookup**, and it is worth naming.
 * It marks an Android WebView, not a browser — and the only WebView that can
 * hold a session here is this product's own APK. That is a sound inference and
 * not a certainty: somebody who signed in inside another application's built-in
 * browser would be named the same way. «приложение» rather than «LETSCUBE»
 * because of exactly that, and the honest half of the label is the platform
 * beside it.
 */
function readApp(ua: string): string | null {
  if (/YaBrowser/i.test(ua)) return "Яндекс Браузер";
  if (/Edg[A-Za-z]{0,3}\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS/i.test(ua)) return "Firefox";
  if (/;\s*wv[;)]/i.test(ua)) return "приложение";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/Chrome\/|CriOS/i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return "Safari";
  return null;
}

/**
 * What to call a device, given the only thing there is to go on.
 *
 * A user agent is arbitrary text a client chose to send. Nothing below is a
 * fact about a device; all of it is a reading of a string, and the three kinds
 * say how much of it was read:
 *
 *  - **`known`** — both halves recognised, «Windows · Chrome»;
 *  - **`partial`** — one of them, «Android» or «Firefox» alone. Half a name is
 *    better than a whole guess, and it is what an unusual browser on a known
 *    system honestly comes to;
 *  - **`unknown`** — neither. The title is «Неизвестное устройство» and `raw`
 *    carries the string itself, because a person may well recognise what no
 *    pattern here does.
 *
 * What this deliberately will **not** do is name the Windows shell. Tauri draws
 * in WebView2, whose user agent is Microsoft Edge's, so «LETSCUBE для Windows»
 * and «Edge on Windows» are the same string — and a label that cannot be wrong
 * is worth more than one that is right most of the time.
 */
export function describeUserAgent(userAgent: string | null | undefined): SessionDeviceLabel {
  const full = flatten(typeof userAgent === "string" ? userAgent : "");
  if (!full) return { title: SESSION_DEVICE_UNKNOWN_TITLE, kind: "unknown", raw: "" };
  const raw = bound(full);
  const platform = readPlatform(full);
  const app = readApp(full);
  if (platform && app) return { title: `${platform} · ${app}`, kind: "known", raw };
  if (platform || app) return { title: (platform ?? app) as string, kind: "partial", raw };
  return { title: SESSION_DEVICE_UNKNOWN_TITLE, kind: "unknown", raw };
}

/* ── When it was last seen ────────────────────────────────────────────────── */

/** Russian counts, the three forms. */
function plural(count: number, one: string, few: string, many: string): string {
  const hundred = Math.abs(count) % 100;
  const ten = hundred % 10;
  if (hundred >= 11 && hundred <= 14) return many;
  if (ten === 1) return one;
  if (ten >= 2 && ten <= 4) return few;
  return many;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago this authorisation last came back for a token.
 *
 * **Relative all the way out, and never a date**, which is a decision the
 * server's own window makes affordable: `session_devices_list` returns nothing
 * whose `refreshed_at` is older than thirty days, so «больше месяца назад» is
 * unreachable through the interface and is here only so that a row arriving
 * through some future widening reads as something rather than as a wrong date.
 *
 * A date would need a timezone, a locale and a month table, and would then be
 * the one thing in this file a test could only assert against the machine it
 * runs on.
 *
 * A negative difference is two clocks disagreeing, not a device seen in the
 * future, and it reads as «только что» — the same clamp `voiceRingState` puts
 * on a negative TTL, and for the same reason.
 */
export function describeLastSeen(refreshedAt: number | null, now: number): string {
  if (refreshedAt === null) return "время последнего входа неизвестно";
  const ago = Math.max(0, now - refreshedAt);
  if (ago < 90_000) return "только что";
  if (ago < HOUR) {
    const minutes = Math.floor(ago / MINUTE);
    return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  }
  if (ago < DAY) {
    const hours = Math.floor(ago / HOUR);
    return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  }
  const days = Math.floor(ago / DAY);
  if (days === 1) return "вчера";
  if (days < 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return "больше месяца назад";
}

/**
 * The value the settings row prints beside «Активные сеансы».
 *
 * The count, and the number that is silenced when any is — a person who turned
 * calls off somewhere wants to see that from the closed row rather than by
 * opening it, and a person who has not is shown one plain number.
 */
export function sessionDevicesSummary(input: {
  readonly count: number;
  readonly silenced: number;
  readonly loading: boolean;
  readonly failed: boolean;
}): string {
  if (input.failed) return "не удалось загрузить";
  if (input.loading && input.count === 0) return "…";
  if (input.count === 0) return "нет";
  const devices = `${input.count} ${plural(input.count, "устройство", "устройства", "устройств")}`;
  if (input.silenced <= 0) return devices;
  return `${devices} · без звонков: ${input.silenced}`;
}

/* ── May this device ring? ────────────────────────────────────────────────── */

/**
 * How long an answer from `voice_calls_allowed_here()` is reused.
 *
 * Fifteen seconds, which in practice means **one request per incoming call**
 * and none at all while nothing is ringing. The alternatives were both worse:
 * a long cache cannot be corrected on a device nobody is looking at — and a
 * device nobody is looking at is exactly the one somebody silences from their
 * phone — while asking on every render would put a round trip behind a
 * re-render.
 *
 * Fifteen rather than something smaller so that a second call arriving in the
 * same breath as the first reuses the answer, and so that a re-render storm
 * during a ring costs nothing.
 */
export const CALLS_GATE_FRESH_MS = 15_000;

/**
 * How long the surface waits for an answer before ringing anyway.
 *
 * The same direction `voice_calls_allowed_here` itself takes when it cannot
 * identify the session: **true**. A call that rings when it should not is a
 * nuisance; one that silently does not is a missed call nobody can explain.
 */
export const CALLS_GATE_WAIT_MS = 2_000;

/** What the incoming-call surface should do about the ring it is holding. */
export type IncomingRingVerdict = "show" | "silence" | "wait";

/**
 * Whether an incoming call may be drawn and sounded on this device.
 *
 * **Only incoming.** A ring this device started is this device's own call: a
 * person who pressed «Позвонить» is owed the surface that lets them cancel,
 * whatever they have said about calls arriving here. Silencing it would also
 * strand the ring, because cancelling is the only thing that clears the row
 * from the caller's side.
 *
 * **The order of the two middle branches is the design.** «Off» is answered
 * before staleness, so a device that is switched off stays silent while the
 * refresh it just triggered is in the air — the alternative flickers a ring
 * onto a silenced telephone for one round trip, which is louder than the
 * problem it solves. «On» is *not* answered before staleness, and that is the
 * same asymmetry seen from its other side: a stale «on» is the one reading that
 * can ring a device somebody has just silenced from their phone, so it waits.
 *
 * `checkedAt === null` — nothing has been asked yet — waits as well. It cannot
 * wait for ever: whoever calls this is expected to have asked, and the asking
 * writes an answer even when it fails or times out.
 */
export function incomingRingVerdict(input: {
  readonly direction: "incoming" | "outgoing" | null;
  /** The last answer `voice_calls_allowed_here()` gave. */
  readonly allowed: boolean;
  /** When that answer was taken, or null when none ever was. */
  readonly checkedAt: number | null;
  readonly now: number;
  readonly freshForMs?: number;
}): IncomingRingVerdict {
  if (input.direction !== "incoming") return "show";
  if (input.checkedAt === null) return "wait";
  if (!input.allowed) return "silence";
  const fresh = Math.max(input.freshForMs ?? CALLS_GATE_FRESH_MS, 0);
  return input.now - input.checkedAt > fresh ? "wait" : "show";
}

/**
 * One answer from `voice_calls_allowed_here()`, read as a boolean.
 *
 * Anything that is not a boolean is **true**: a deployment whose migration has
 * not landed answers `PGRST202`, a fixture with no opinion answers `null`, and
 * neither of them is a person saying «do not ring this telephone».
 */
export function readCallsAllowed(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

/* ── Refusals ─────────────────────────────────────────────────────────────── */

/**
 * Why a read or a write did not happen.
 *
 * The names are the ones the two functions raise, so a refusal that arrives
 * unrecognised is a function that changed its vocabulary rather than a shrug.
 */
export type SessionDeviceRefusal =
  /**
   * Somebody else's session, or none at all — **deliberately the same refusal
   * for both**, so the function cannot be used to discover whether a session id
   * exists. The sentence below must not undo that by guessing which it was.
   */
  | "no_such_device"
  | "not_authenticated"
  | "bad_request"
  | "unsupported"
  | "network"
  | "unknown";

const RAISED: readonly SessionDeviceRefusal[] = [
  "no_such_device",
  "not_authenticated",
  "bad_request",
];

function errorFields(error: unknown): { code: string; message: string } {
  if (typeof error === "string") return { code: "", message: error.toLocaleLowerCase("ru-RU") };
  if (!error || typeof error !== "object") return { code: "", message: "" };
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message.toLocaleLowerCase("ru-RU") : "",
  };
}

/**
 * One PostgREST answer, read as a reason.
 *
 * **The message carries the name, not the code** — the same reading
 * `classifyVoiceRingError` documents. The three SQLSTATEs below are the
 * fallback rather than the evidence, and `PGRST202`/`PGRST205`/`42P01` mean
 * what they mean everywhere else in this product: a deployment whose migration
 * has not landed.
 */
export function classifySessionDeviceError(error: unknown): SessionDeviceRefusal {
  const { code, message } = errorFields(error);
  for (const name of RAISED) {
    if (message.includes(name)) return name;
  }
  if (code === "42P01" || code === "PGRST202" || code === "PGRST205") return "unsupported";
  if (code === "P0002") return "no_such_device";
  if (code === "28000" || code === "PGRST301") return "not_authenticated";
  if (code === "22023") return "bad_request";
  if (
    code === "" &&
    (message.includes("fetch") || message.includes("network") || message.includes("load failed"))
  ) {
    return "network";
  }
  return "unknown";
}

/**
 * What a refusal means to a person.
 *
 * One line, in the voice `voiceRingRefusalText` speaks in: no code, nothing
 * about rows or policies, and nothing the reader cannot act on.
 *
 * `no_such_device` is the one worth reading twice. It is what an id that is not
 * the reader's own gets, and it is also what a session that has since expired
 * gets — the function answers the same thing to both on purpose, so this
 * sentence says the one thing that is true either way and offers the one action
 * that helps.
 */
export function sessionDeviceRefusalText(code: SessionDeviceRefusal): string {
  switch (code) {
    case "no_such_device":
      return "Этого устройства больше нет в списке — обновите страницу.";
    case "not_authenticated":
      return "Войдите в аккаунт, чтобы менять настройки устройств.";
    case "bad_request":
      return "Не удалось изменить настройку.";
    case "unsupported":
      return "Список устройств здесь пока недоступен.";
    case "network":
      return "Нет связи с сервером, проверьте подключение.";
    default:
      return "Не удалось изменить настройку.";
  }
}

/**
 * Said where the list came back empty.
 *
 * Reachable, and not only in theory: `session_devices_list` returns nothing
 * whose `refreshed_at` is null, and a sign-in that has not yet come back for a
 * token has none — so somebody who signed in minutes ago can open this and find
 * their own device missing. Measured on production on 2026-09-18: no session
 * created in the last day was still unrefreshed, so the wait is short. Saying
 * so is better than an empty box that reads as a defect.
 */
export const SESSION_DEVICE_EMPTY_HINT =
  "Список пуст. Устройство появляется здесь не сразу после входа — обычно в течение часа.";
