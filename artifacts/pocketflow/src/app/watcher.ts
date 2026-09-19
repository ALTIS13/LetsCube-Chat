import { createHash, randomUUID } from "node:crypto";

import { button, keyboard, type AppContext } from "#pf/app/context";
import type { CallbackContext, CommandContext, Feature } from "#pf/app/router";
import { clampMessage, untrusted } from "#pf/lib/render";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  SafeFetchError,
  safeFetch,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "#pf/lib/safeFetch";
import { SsrfError, resolveSafeTarget, type DnsResolver } from "#pf/lib/ssrf";
import { readCandidate, rememberCandidate } from "#pf/store/candidates";
import { getUser } from "#pf/store/users";
import {
  DEFAULT_INTERVAL_SECONDS,
  MAX_URL_LENGTH,
  MAX_WATCHERS_PER_OWNER,
  WATCHER_KINDS,
  claimDueWatchers,
  countWatchers,
  createWatcher,
  deleteWatcher,
  listWatchers,
  readOwnedWatcher,
  recordWatcherResult,
  releaseWatcherClaim,
  scheduleWatcherNow,
  setWatcherEnabled,
  type Watcher,
  type WatcherKind,
} from "#pf/store/watchers";

/**
 * §6: watch a URL, and say something only when the answer changed.
 *
 * Three rules shape everything below.
 *
 * **A notification is a transition, not a poll.** A watcher on a five-minute
 * interval produces 288 observations a day; a bot that sends 288 messages is a
 * bot people mute. So the row carries what the last check saw, every check is
 * compared against it, and a message is sent only when they differ. The first
 * check has nothing to differ from, so it records a baseline and says nothing —
 * which is also why «я поставил наблюдатель и он молчит» is the correct
 * behaviour rather than a bug report.
 *
 * **A dead host is not checked harder.** Consecutive failures push the next
 * check out exponentially to an hour. A watcher is a courtesy to the site being
 * watched as much as to the person watching it.
 *
 * **`callback_data` is not authorization.** Every handler here re-reads its row
 * through an owner-scoped query and acts on what comes back, never on the id in
 * the button. `store/watchers.ts` has no unscoped read for a handler to reach
 * for by mistake; see its file comment.
 */

const NEWLINE = String.fromCharCode(10);

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/**
 * Russian labels, deliberately.
 *
 * The brief names the four buttons in English (`[Availability] [HTTP Status]
 * [Content Change] [RSS/Atom]`); it is naming which four kinds exist rather
 * than dictating the glyphs, and every other string this bot sends is Russian.
 * Four English buttons in a Russian bot would be the visual defect. `RSS/Atom`
 * stays as it is because it is a proper noun.
 */
const KIND_LABELS: Readonly<Record<WatcherKind, string>> = {
  availability: "Доступность",
  http_status: "HTTP-статус",
  content_change: "Изменение содержимого",
  feed: "RSS/Atom",
};

/** One character each, because `callback_data` is capped at 128 bytes. */
const KIND_CODES: Readonly<Record<WatcherKind, string>> = {
  availability: "a",
  http_status: "s",
  content_change: "c",
  feed: "f",
};

const KIND_BY_CODE: ReadonlyMap<string, WatcherKind> = new Map(
  WATCHER_KINDS.map((kind) => [KIND_CODES[kind], kind]),
);

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** After this many consecutive failures, say so once and then stay quiet. */
export const FAILURE_NOTICE_AT = 5;
/** The interval doubles per failure, up to this many times. */
const MAX_BACKOFF_DOUBLINGS = 6;
export const MAX_BACKOFF_SECONDS = 3_600;

const AVAILABILITY_MAX_BYTES = 64 * 1_024;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_LEASE_SECONDS = 120;
export const WATCHER_TICK_INTERVAL_MS = 30_000;

export type SafeFetcher = (
  url: string,
  options?: SafeFetchOptions,
) => Promise<SafeFetchResult>;

export type WatcherDeps = {
  /** Injected so a test never opens a socket. Defaults to the real guarded client. */
  fetch?: SafeFetcher;
  /** Injected so a test never touches DNS. Threaded into `safeFetch` and into creation. */
  resolver?: DnsResolver;
  newClaimToken?: () => string;
  timeoutMs?: number;
  maxBytes?: number;
  batchSize?: number;
  leaseSeconds?: number;
};

type Resolved = Required<Pick<WatcherDeps, "fetch" | "newClaimToken">> &
  Required<Pick<WatcherDeps, "timeoutMs" | "maxBytes" | "batchSize" | "leaseSeconds">> & {
    resolver: DnsResolver | undefined;
  };

function resolveDeps(deps?: WatcherDeps): Resolved {
  return {
    fetch: deps?.fetch ?? safeFetch,
    resolver: deps?.resolver,
    newClaimToken: deps?.newClaimToken ?? randomUUID,
    timeoutMs: deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: deps?.maxBytes ?? DEFAULT_MAX_BYTES,
    batchSize: deps?.batchSize ?? DEFAULT_BATCH_SIZE,
    leaseSeconds: deps?.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Reading a body without believing it
// ---------------------------------------------------------------------------

const WHITESPACE_CODES: ReadonlySet<number> = new Set([32, 9, 10, 13, 12, 11]);

/** Whitespace runs collapse to one space. Written without a regex on purpose. */
export function collapseWhitespace(text: string): string {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    if (WHITESPACE_CODES.has(text.charCodeAt(index))) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += text[index];
  }
  if (current.length > 0) parts.push(current);
  return parts.join(" ");
}

function removeBlocks(text: string, open: string, close: string): string {
  let out = text;
  for (;;) {
    const start = out.toLowerCase().indexOf(open);
    if (start === -1) return out;
    const end = out.toLowerCase().indexOf(close, start + open.length);
    if (end === -1) return out.slice(0, start);
    out = out.slice(0, start) + out.slice(end + close.length);
  }
}

/**
 * What "the content" means for a change detector.
 *
 * A page with a clock, a CSRF token or a rotating advertisement changes on
 * every poll, and a watcher that reports each one is worse than no watcher.
 * Scripts, styles and comments are where most of that lives, so they go, and
 * whitespace is collapsed so a reformat is not a change.
 *
 * This is a heuristic and is documented as one: it will still fire on a page
 * that prints the time in its body. A watcher on such a page is a watcher on
 * the wrong page, and the honest answer is to say so rather than to build a
 * diffing engine into a reference bot.
 */
export function normalizeContent(body: string, contentType: string | null): string {
  const markup =
    contentType === null ||
    contentType.includes("html") ||
    contentType.includes("xml") ||
    contentType.includes("svg");
  let text = body;
  if (markup) {
    text = removeBlocks(text, "<script", "</script>");
    text = removeBlocks(text, "<style", "</style>");
    text = removeBlocks(text, "<!--", "-->");
  }
  return collapseWhitespace(text);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// A very small feed reader
// ---------------------------------------------------------------------------

export type FeedEntry = { id: string; title: string | null; link: string | null };

function decodeEntities(text: string): string {
  return text
    .split("&lt;")
    .join("<")
    .split("&gt;")
    .join(">")
    .split("&quot;")
    .join('"')
    .split("&apos;")
    .join("'")
    .split("&#39;")
    .join("'")
    // Last, so that "&amp;lt;" decodes to "&lt;" and not to "<".
    .split("&amp;")
    .join("&");
}

function stripCdata(text: string): string {
  const open = "<![CDATA[";
  const close = "]]>";
  let out = text;
  for (;;) {
    const start = out.indexOf(open);
    if (start === -1) return out;
    const end = out.indexOf(close, start + open.length);
    if (end === -1) return out.slice(0, start) + out.slice(start + open.length);
    out = out.slice(0, start) + out.slice(start + open.length, end) + out.slice(end + close.length);
  }
}

type Block = { inner: string; attrs: string };

/** The first `<tag …>…</tag>` or `<tag …/>`, matched on a real tag boundary. */
function tagBlock(xml: string, tag: string): Block | null {
  const open = `<${tag}`;
  let at = xml.indexOf(open);
  while (at !== -1) {
    const next = xml[at + open.length];
    // `<item>` must not be found by looking for `<i`, and `<items>` is not `<item>`.
    if (next === ">" || next === "/" || (next !== undefined && WHITESPACE_CODES.has(next.charCodeAt(0)))) {
      break;
    }
    at = xml.indexOf(open, at + 1);
  }
  if (at === -1) return null;
  const openEnd = xml.indexOf(">", at + open.length);
  if (openEnd === -1) return null;
  const selfClosing = xml[openEnd - 1] === "/";
  const attrs = xml.slice(at + open.length, selfClosing ? openEnd - 1 : openEnd);
  if (selfClosing) return { inner: "", attrs };
  const closeAt = xml.indexOf(`</${tag}`, openEnd);
  if (closeAt === -1) return null;
  return { inner: xml.slice(openEnd + 1, closeAt), attrs };
}

function tagText(xml: string, tag: string): string | null {
  const block = tagBlock(xml, tag);
  if (!block) return null;
  const text = decodeEntities(stripCdata(block.inner)).trim();
  return text.length > 0 ? text : null;
}

function attrValue(attrs: string, name: string): string | null {
  const at = attrs.indexOf(`${name}=`);
  if (at === -1) return null;
  const quote = attrs[at + name.length + 1];
  if (quote !== '"' && quote !== "'") return null;
  const end = attrs.indexOf(quote, at + name.length + 2);
  if (end === -1) return null;
  const value = decodeEntities(attrs.slice(at + name.length + 2, end)).trim();
  return value.length > 0 ? value : null;
}

/**
 * The newest entry of an RSS or Atom feed, identified.
 *
 * Both formats put the newest item first in practice, and neither guarantees
 * it — which is a real limitation and is why the message says «новая запись»
 * rather than claiming a count. The identity is `guid`, then `id`, then the
 * link, then the title: the first two are meant for exactly this and the last
 * two are what is left when a feed omits them.
 *
 * Deliberately not an XML parser. A reference bot that pulls in a parser to
 * read four fields has taught the reader the wrong lesson, and an XML parser
 * fed an attacker-supplied document is its own security topic (entity
 * expansion, external entities) that this avoids by not having one.
 */
export function firstFeedEntry(xml: string): FeedEntry | null {
  const item = tagBlock(xml, "item") ?? tagBlock(xml, "entry");
  if (!item) return null;
  const inner = item.inner;
  const title = tagText(inner, "title");
  let link = tagText(inner, "link");
  if (link === null) {
    const linkTag = tagBlock(inner, "link");
    if (linkTag) link = attrValue(linkTag.attrs, "href");
  }
  const id = tagText(inner, "guid") ?? tagText(inner, "id") ?? link ?? title;
  if (id === null) return null;
  return { id, title, link };
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export type Check =
  | {
      ok: true;
      status: number;
      contentHash: string | null;
      entry: FeedEntry | null;
    }
  | { ok: false; errorCode: string };

export type Transition =
  | { kind: "baseline" }
  | { kind: "unchanged" }
  | { kind: "down"; from: number | null; to: number | null }
  | { kind: "recovered"; from: number | null; to: number }
  | { kind: "status"; from: number; to: number }
  | { kind: "content" }
  | { kind: "feed"; entry: FeedEntry }
  | { kind: "failing"; failures: number; errorCode: string };

type Availability = "up" | "down" | "unknown";

/**
 * Whether the last check found the site up.
 *
 * Derived from the columns the schema already has rather than from a column of
 * its own, which is what makes `last_status` survivable across a failure: a
 * network error keeps the previous status so the next message can say
 * «200 → нет ответа» instead of «→ нет ответа».
 */
export function lastAvailability(watcher: Watcher): Availability {
  if (watcher.lastCheckedAt === null) return "unknown";
  if (watcher.lastError !== null) return "down";
  if (watcher.lastStatus === null) return "unknown";
  return watcher.lastStatus >= 500 ? "down" : "up";
}

function currentAvailability(check: Check): Availability {
  if (!check.ok) return "down";
  return check.status >= 500 ? "down" : "up";
}

/** What this check means, given what the last one saw. Pure. */
export function decideTransition(watcher: Watcher, check: Check): Transition {
  // Nothing to have changed from. §6: the first check notifies nobody.
  if (watcher.lastCheckedAt === null) return { kind: "baseline" };

  if (watcher.kind === "availability") {
    const before = lastAvailability(watcher);
    const now = currentAvailability(check);
    if (before === "unknown" || before === now) return { kind: "unchanged" };
    if (now === "down") {
      return { kind: "down", from: watcher.lastStatus, to: check.ok ? check.status : null };
    }
    return { kind: "recovered", from: watcher.lastStatus, to: check.ok ? check.status : 0 };
  }

  if (!check.ok) {
    // For the other three kinds a failed fetch says nothing about the thing
    // being watched, so it is not a transition — until it has said nothing
    // often enough to be worth mentioning, exactly once.
    const failures = watcher.consecutiveFailures + 1;
    return failures === FAILURE_NOTICE_AT
      ? { kind: "failing", failures, errorCode: check.errorCode }
      : { kind: "unchanged" };
  }

  if (watcher.kind === "http_status") {
    if (watcher.lastStatus === null) return { kind: "baseline" };
    if (watcher.lastStatus === check.status) return { kind: "unchanged" };
    return { kind: "status", from: watcher.lastStatus, to: check.status };
  }

  if (watcher.lastContentHash === null || check.contentHash === null) {
    return { kind: "baseline" };
  }
  if (watcher.lastContentHash === check.contentHash) return { kind: "unchanged" };
  if (watcher.kind === "feed") {
    return check.entry ? { kind: "feed", entry: check.entry } : { kind: "content" };
  }
  return { kind: "content" };
}

/** What the row should say after this check. Pure. */
export function nextRowState(
  watcher: Watcher,
  check: Check,
): { status: number | null; contentHash: string | null; error: string | null; failures: number } {
  if (check.ok) {
    return {
      status: check.status,
      contentHash: check.contentHash ?? watcher.lastContentHash,
      error: null,
      failures: 0,
    };
  }
  return {
    // Kept, not cleared: the transition message needs the status it was at.
    status: watcher.lastStatus,
    contentHash: watcher.lastContentHash,
    error: check.errorCode,
    failures: watcher.consecutiveFailures + 1,
  };
}

/**
 * When to look again.
 *
 * Exponential on consecutive failures, capped at an hour, and never shorter
 * than the interval the person chose. Deterministic, with no jitter, because a
 * jittered schedule cannot be pinned by a test and this bot watches tens of
 * URLs rather than tens of thousands — the thundering herd jitter exists to
 * prevent is not a problem it has.
 */
export function backoffSeconds(intervalSeconds: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return intervalSeconds;
  const doublings = Math.min(consecutiveFailures, MAX_BACKOFF_DOUBLINGS);
  return Math.min(MAX_BACKOFF_SECONDS, intervalSeconds * 2 ** doublings);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}

export function formatTime(at: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(at);
  }
}

function statusWord(status: number | null): string {
  return status === null ? "нет ответа" : String(status);
}

/**
 * The message a transition produces, or null when it produces none.
 *
 * The shape is the brief's, literally: «🔴 example.com недоступен / 200 → 503 /
 * 18:42». Each piece is included only when there is something to put in it, so
 * a first-ever outage reads «🔴 example.com недоступен / 18:42» rather than
 * inventing a status it never saw.
 */
export function renderTransition(
  watcher: Watcher,
  transition: Transition,
  at: Date,
  timeZone: string,
): string | null {
  const host = hostOf(watcher.url);
  const time = formatTime(at, timeZone);
  const join = (...parts: (string | null)[]): string =>
    parts.filter((part): part is string => part !== null && part.length > 0).join(" / ");

  switch (transition.kind) {
    case "baseline":
    case "unchanged":
      return null;
    case "down":
      return join(
        `🔴 ${host} недоступен`,
        transition.from === null ? null : `${transition.from} → ${statusWord(transition.to)}`,
        time,
      );
    case "recovered":
      return join(
        `🟢 ${host} снова доступен`,
        transition.from === null ? null : `${transition.from} → ${transition.to}`,
        time,
      );
    case "status":
      return join(`🟡 ${host}`, `${transition.from} → ${transition.to}`, time);
    case "content":
      return join(`📝 ${host} изменился`, time);
    case "feed": {
      const head = join(`📰 ${host} — новая запись`, time);
      const title = transition.entry.title;
      const link = transition.entry.link;
      // The title comes from a document somebody else controls, so it is
      // rendered so that it cannot reformat the line it is on (G-5).
      const lines = [head];
      if (title) lines.push(untrusted(title));
      if (link) lines.push(untrusted(link));
      return lines.join(NEWLINE);
    }
    case "failing":
      return join(
        `⚠️ ${host}: не удаётся проверить`,
        `${transition.failures} раз подряд`,
        time,
      );
    default:
      return null;
  }
}

function watcherLine(watcher: Watcher): string {
  const dot = !watcher.enabled ? "⚪" : lastAvailability(watcher) === "down" ? "🔴" : "🟢";
  const minutes = Math.round(watcher.intervalSeconds / 60);
  const parts = [`${dot} ${hostOf(watcher.url)}`, KIND_LABELS[watcher.kind], `${minutes} мин`];
  if (watcher.lastStatus !== null) parts.push(String(watcher.lastStatus));
  if (!watcher.enabled) parts.push("выключен");
  return parts.join(" · ");
}

export function renderList(watchers: readonly Watcher[]): {
  text: string;
  keyboard: ReturnType<typeof keyboard>;
} {
  if (watchers.length === 0) {
    return {
      text: [
        "Наблюдателей пока нет.",
        "",
        "Пришлите /watch и адрес, например:",
        "/watch https://example.com/status",
      ].join(NEWLINE),
      keyboard: keyboard(),
    };
  }
  const header = `Наблюдатели (${watchers.length} из ${MAX_WATCHERS_PER_OWNER})`;
  const text = [header, "", ...watchers.map(watcherLine)].join(NEWLINE);
  return {
    text: clampMessage(text),
    keyboard: keyboard(
      ...watchers.map((watcher) => [
        button(hostOf(watcher.url).slice(0, 32), "watch.open", watcher.id),
      ]),
    ),
  };
}

function renderCard(watcher: Watcher, timeZone: string): {
  text: string;
  keyboard: ReturnType<typeof keyboard>;
} {
  const lines = [
    untrusted(watcher.url),
    "",
    `Тип: ${KIND_LABELS[watcher.kind]}`,
    `Интервал: ${Math.round(watcher.intervalSeconds / 60)} мин`,
    `Состояние: ${watcher.enabled ? "включён" : "выключен"}`,
  ];
  if (watcher.lastCheckedAt) {
    lines.push(`Проверен: ${formatTime(watcher.lastCheckedAt, timeZone)}`);
  } else {
    lines.push("Проверен: ещё ни разу");
  }
  if (watcher.lastStatus !== null) lines.push(`Последний статус: ${watcher.lastStatus}`);
  if (watcher.lastError !== null) lines.push(`Последняя ошибка: ${watcher.lastError}`);
  return {
    text: clampMessage(lines.join(NEWLINE)),
    keyboard: keyboard(
      [
        button("Проверить сейчас", "watch.check", watcher.id),
        button(watcher.enabled ? "Выключить" : "Включить", "watch.toggle", watcher.id),
      ],
      [button("Удалить", "watch.delete", watcher.id), button("← Назад", "watch.list")],
    ),
  };
}

function kindOffer(candidateId: string, url: string): {
  text: string;
  keyboard: ReturnType<typeof keyboard>;
} {
  return {
    text: [`Что наблюдать по адресу ${untrusted(url)}?`].join(NEWLINE),
    keyboard: keyboard(
      [
        button(KIND_LABELS.availability, "watch.kind", candidateId, KIND_CODES.availability),
        button(KIND_LABELS.http_status, "watch.kind", candidateId, KIND_CODES.http_status),
      ],
      [
        button(KIND_LABELS.content_change, "watch.kind", candidateId, KIND_CODES.content_change),
        button(KIND_LABELS.feed, "watch.kind", candidateId, KIND_CODES.feed),
      ],
    ),
  };
}

// ---------------------------------------------------------------------------
// Creating one
// ---------------------------------------------------------------------------

/**
 * The guard, at the moment somebody types an address.
 *
 * Running it here and not only in the tick is the difference between «этот
 * адрес наблюдать нельзя» and a watcher that is created, looks fine in the
 * list, and silently never reports anything. It is a full check — parse,
 * resolve, judge every answer — because a name is the thing being judged and a
 * name can only be judged by resolving it.
 */
async function validateWatchTarget(
  rawUrl: string,
  resolver: DnsResolver | undefined,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, message: "Нужен адрес вида https://example.com/status." };
  }
  try {
    const target = await resolveSafeTarget(trimmed, resolver ? { resolver } : undefined);
    return { ok: true, url: target.url.href };
  } catch (error) {
    if (error instanceof SsrfError) return { ok: false, message: error.publicMessage };
    return { ok: false, message: "Этот адрес проверить не удалось." };
  }
}

// ---------------------------------------------------------------------------
// One check
// ---------------------------------------------------------------------------

function fetchOptionsFor(watcher: Watcher, deps: Resolved): SafeFetchOptions {
  const wantsBody = watcher.kind === "content_change" || watcher.kind === "feed";
  return {
    method: "GET",
    timeoutMs: deps.timeoutMs,
    // A status-only watcher reads the body solely to drain the socket, so
    // cutting it short is free. A content watcher must not be truncated: a
    // stable hash of the first N bytes would report «не изменилось» for ever.
    maxBytes: wantsBody ? deps.maxBytes : AVAILABILITY_MAX_BYTES,
    onOversize: wantsBody ? "error" : "truncate",
    ...(deps.resolver ? { resolver: deps.resolver } : {}),
  };
}

export async function performCheck(watcher: Watcher, rawDeps?: WatcherDeps): Promise<Check> {
  const deps = resolveDeps(rawDeps);
  try {
    const response = await deps.fetch(watcher.url, fetchOptionsFor(watcher, deps));
    if (watcher.kind === "availability" || watcher.kind === "http_status") {
      return { ok: true, status: response.status, contentHash: null, entry: null };
    }
    const contentType = response.headers["content-type"] ?? null;
    const body = response.body.toString("utf8");
    if (watcher.kind === "feed") {
      const entry = firstFeedEntry(body);
      return {
        ok: true,
        status: response.status,
        contentHash: entry ? sha256(entry.id) : null,
        entry,
      };
    }
    return {
      ok: true,
      status: response.status,
      contentHash: sha256(normalizeContent(body, contentType)),
      entry: null,
    };
  } catch (error) {
    // The code, never the body and never the URL's query. `SsrfError.message`
    // is already `ssrf_denied:<reason>` and carries nothing else.
    if (error instanceof SsrfError) return { ok: false, errorCode: `denied:${error.reason}` };
    if (error instanceof SafeFetchError) return { ok: false, errorCode: error.code };
    return { ok: false, errorCode: "unknown" };
  }
}

async function notify(
  ctx: AppContext,
  watcher: Watcher,
  transition: Transition,
  at: Date,
): Promise<boolean> {
  const user = await getUser(ctx.db, watcher.ownerId);
  const text = renderTransition(
    watcher,
    transition,
    at,
    user?.timeZone ?? ctx.config.defaultTimeZone,
  );
  if (text === null) return false;
  try {
    await ctx.bot.sendText({
      chatId: watcher.chatId,
      text: clampMessage(text),
      keyboard: keyboard([
        button("Проверить сейчас", "watch.check", watcher.id),
        button("Выключить", "watch.toggle", watcher.id),
      ]),
    });
    return true;
  } catch (error) {
    // A chat the bot was removed from must not stop the other watchers, and it
    // must not lose the observation either — the row is written by the caller
    // regardless of whether the message landed.
    ctx.log.warn("watcher.notify_failed", {
      watcher_id: watcher.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

export type TickSummary = {
  checked: number;
  notified: number;
  failed: number;
};

/**
 * One scheduler pass: claim what is due, check it, write it down, say what
 * changed.
 *
 * Written as a plain function rather than registered here, so the scheduler
 * owns the timer and this owns the work. `watcherJob` below packages it in the
 * shape the registry wants.
 */
export async function watcherTick(ctx: AppContext, deps?: WatcherDeps): Promise<TickSummary> {
  const resolved = resolveDeps(deps);
  const now = ctx.now();
  const claimToken = resolved.newClaimToken();
  const summary: TickSummary = { checked: 0, notified: 0, failed: 0 };

  const due = await claimDueWatchers(ctx.db, {
    now,
    limit: resolved.batchSize,
    claimToken,
    leaseSeconds: resolved.leaseSeconds,
  });

  for (const watcher of due) {
    try {
      const check = await performCheck(watcher, resolved);
      const transition = decideTransition(watcher, check);
      const state = nextRowState(watcher, check);
      const checkedAt = ctx.now();
      const delay = backoffSeconds(watcher.intervalSeconds, state.failures);
      const nextCheckAt = new Date(checkedAt.getTime() + delay * 1_000);

      // Written before the message is sent. A send that fails must not cause
      // the same observation to be re-made and re-announced on the next tick.
      const written = await recordWatcherResult(ctx.db, {
        id: watcher.id,
        claimToken,
        checkedAt,
        nextCheckAt,
        status: state.status,
        contentHash: state.contentHash,
        error: state.error,
        consecutiveFailures: state.failures,
      });

      summary.checked += 1;
      if (!check.ok) summary.failed += 1;

      // The claim was taken from us mid-check (we ran past the lease), so
      // somebody else owns this observation now and ours is stale.
      if (!written) {
        ctx.log.warn("watcher.claim_lost", { watcher_id: watcher.id });
        continue;
      }
      if (transition.kind !== "unchanged" && transition.kind !== "baseline") {
        if (await notify(ctx, watcher, transition, checkedAt)) summary.notified += 1;
      }
    } catch (error) {
      // Anything unexpected releases the claim so the watcher is retried,
      // rather than being parked until the lease expires.
      await releaseWatcherClaim(ctx.db, watcher.id, claimToken);
      ctx.log.error("watcher.tick_failed", {
        watcher_id: watcher.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return summary;
}

export function watcherJob(
  ctx: AppContext,
  deps?: WatcherDeps,
): { name: string; intervalMs: number; run: () => Promise<void> } {
  return {
    name: "watcher",
    intervalMs: WATCHER_TICK_INTERVAL_MS,
    run: async () => {
      await watcherTick(ctx, deps);
    },
  };
}

// ---------------------------------------------------------------------------
// The feature
// ---------------------------------------------------------------------------

const NOT_YOURS = "Это не ваш наблюдатель";
const OFFER_EXPIRED = "Это предложение больше не действует";

export function createWatcherFeature(deps?: WatcherDeps): Feature {
  const resolved = resolveDeps(deps);

  async function showList(input: CallbackContext, edit: boolean): Promise<void> {
    const watchers = await listWatchers(input.ctx.db, input.user.userId);
    const view = renderList(watchers);
    if (edit) {
      await input.ctx.bot.editText({
        chatId: input.query.message.chatId,
        messageId: input.query.message.id,
        text: view.text,
        keyboard: view.keyboard,
      });
    } else {
      await input.ctx.bot.sendText({
        chatId: input.query.message.chatId,
        text: view.text,
        keyboard: view.keyboard,
      });
    }
  }

  /**
   * Offer the four kinds for a URL that somebody already owns.
   *
   * Shared by `/watch <url>` and by the inbox's «Следить» button, because they
   * differ only in where the URL came from — and in both cases it has already
   * been through `readCandidate`/`validateWatchTarget` scoped to this person.
   */
  async function offerKinds(
    ctx: AppContext,
    ownerId: string,
    chatId: string,
    sourceMessageId: string,
    url: string,
  ): Promise<{ text: string; keyboard: ReturnType<typeof keyboard> }> {
    const candidateId = await rememberCandidate(ctx.db, {
      ownerId,
      chatId,
      sourceMessageId,
      kind: "url",
      content: url,
    });
    return kindOffer(candidateId, url);
  }

  return {
    name: "watcher",

    commandList: [{ command: "watch", description: "Следить за адресом" }],

    commands: {
      async watch(input: CommandContext): Promise<void> {
        const chatId = input.message.chat.id;
        const raw = input.args.trim();

        if (raw.length === 0) {
          const watchers = await listWatchers(input.ctx.db, input.user.userId);
          const view = renderList(watchers);
          await input.ctx.bot.sendText({
            chatId,
            text: view.text,
            keyboard: view.keyboard,
          });
          return;
        }

        const existing = await countWatchers(input.ctx.db, input.user.userId);
        if (existing >= MAX_WATCHERS_PER_OWNER) {
          await input.ctx.bot.sendText({
            chatId,
            text: `Больше ${MAX_WATCHERS_PER_OWNER} наблюдателей нельзя. Удалите ненужные: /watch`,
          });
          return;
        }

        // The first token only: «/watch https://example.com каждые 5 минут»
        // must not turn the whole sentence into a URL.
        const candidateUrl = raw.split(" ")[0] ?? "";
        const checked = await validateWatchTarget(candidateUrl, resolved.resolver);
        if (!checked.ok) {
          await input.ctx.bot.sendText({ chatId, text: checked.message });
          return;
        }

        const offer = await offerKinds(
          input.ctx,
          input.user.userId,
          chatId,
          input.message.id,
          checked.url,
        );
        await input.ctx.bot.sendText({
          chatId,
          text: offer.text,
          keyboard: offer.keyboard,
          replyToMessageId: input.message.id,
        });
      },
    },

    callbacks: {
      /** The inbox's «Следить» button. The id names a candidate, not a watcher. */
      "watch.from": async (input: CallbackContext): Promise<void> => {
        const candidateId = input.args[0] ?? "";
        const candidate = await readCandidate(input.ctx.db, input.user.userId, candidateId);
        if (!candidate) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: OFFER_EXPIRED });
          return;
        }
        const checked = await validateWatchTarget(candidate.content, resolved.resolver);
        if (!checked.ok) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: checked.message,
            showAlert: true,
          });
          return;
        }
        const offer = kindOffer(candidate.id, checked.url);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: offer.text,
          keyboard: offer.keyboard,
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id);
      },

      "watch.kind": async (input: CallbackContext): Promise<void> => {
        const candidateId = input.args[0] ?? "";
        const kind = KIND_BY_CODE.get(input.args[1] ?? "");
        const candidate = await readCandidate(input.ctx.db, input.user.userId, candidateId);
        if (!candidate || !kind) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: OFFER_EXPIRED });
          return;
        }

        const existing = await countWatchers(input.ctx.db, input.user.userId);
        if (existing >= MAX_WATCHERS_PER_OWNER) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: `Больше ${MAX_WATCHERS_PER_OWNER} наблюдателей нельзя`,
            showAlert: true,
          });
          return;
        }

        // Checked again here, and not only when the offer was made. The offer
        // lives for two hours, and a name can start resolving somewhere else
        // inside those two hours.
        const checked = await validateWatchTarget(candidate.content, resolved.resolver);
        if (!checked.ok) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, {
            text: checked.message,
            showAlert: true,
          });
          return;
        }

        const watcher = await createWatcher(input.ctx.db, {
          ownerId: input.user.userId,
          chatId: input.query.message.chatId,
          kind,
          url: checked.url,
          intervalSeconds: DEFAULT_INTERVAL_SECONDS,
        });
        const view = renderCard(watcher, input.user.timeZone);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: [
            `Слежу: ${KIND_LABELS[kind]}`,
            "Первая проверка запомнит текущее состояние и ничего не пришлёт.",
            "",
            view.text,
          ].join(NEWLINE),
          keyboard: view.keyboard,
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Готово" });
      },

      /** `/start` draws this. The same list, edited in place. */
      "watch.list": async (input: CallbackContext): Promise<void> => {
        await showList(input, true);
        await input.ctx.bot.answerCallbackQuery(input.query.id);
      },

      "watch.open": async (input: CallbackContext): Promise<void> => {
        const watcher = await readOwnedWatcher(input.ctx.db, input.user.userId, input.args[0] ?? "");
        if (!watcher) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: NOT_YOURS });
          return;
        }
        const view = renderCard(watcher, input.user.timeZone);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: view.text,
          keyboard: view.keyboard,
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id);
      },

      "watch.toggle": async (input: CallbackContext): Promise<void> => {
        // Re-read first, scoped to the presser. The row decides what happens
        // next; the button only said which row to look at.
        const current = await readOwnedWatcher(
          input.ctx.db,
          input.user.userId,
          input.args[0] ?? "",
        );
        if (!current) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: NOT_YOURS });
          return;
        }
        const updated = await setWatcherEnabled(
          input.ctx.db,
          input.user.userId,
          current.id,
          !current.enabled,
        );
        if (!updated) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: NOT_YOURS });
          return;
        }
        const view = renderCard(updated, input.user.timeZone);
        await input.ctx.bot.editText({
          chatId: input.query.message.chatId,
          messageId: input.query.message.id,
          text: view.text,
          keyboard: view.keyboard,
        });
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: updated.enabled ? "Включён" : "Выключен",
        });
      },

      "watch.check": async (input: CallbackContext): Promise<void> => {
        const watcher = await readOwnedWatcher(input.ctx.db, input.user.userId, input.args[0] ?? "");
        if (!watcher) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: NOT_YOURS });
          return;
        }
        await scheduleWatcherNow(input.ctx.db, input.user.userId, watcher.id);
        await input.ctx.bot.answerCallbackQuery(input.query.id, {
          text: "Проверю в ближайшую минуту",
        });
      },

      "watch.delete": async (input: CallbackContext): Promise<void> => {
        const watcher = await readOwnedWatcher(input.ctx.db, input.user.userId, input.args[0] ?? "");
        if (!watcher) {
          await input.ctx.bot.answerCallbackQuery(input.query.id, { text: NOT_YOURS });
          return;
        }
        await deleteWatcher(input.ctx.db, input.user.userId, watcher.id);
        await showList(input, true);
        await input.ctx.bot.answerCallbackQuery(input.query.id, { text: "Удалён" });
      },
    },
  };
}
