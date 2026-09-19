import type { Db } from "#pf/store/db";

/**
 * Watchers, as rows.
 *
 * Two properties this module is responsible for, and both are security
 * properties rather than tidiness:
 *
 *   - **Every read and every write that a button can reach is scoped to an
 *     owner.** There is no `getWatcher(db, id)` here — not because nobody
 *     needs one, but because the moment it exists a handler will use it and
 *     the check will move to the caller, where it is one forgotten line away
 *     from not happening. The only unscoped read is `claimDueWatchers`, which
 *     the scheduler calls and no button can.
 *
 *   - **Parameters, never interpolation.** `Db.query` is the only door and it
 *     takes values separately. An id that arrives in `callback_data` is a
 *     string somebody typed.
 *
 * A malformed id is answered with `null` rather than allowed to reach
 * Postgres: `id = $1` against a `uuid` column raises `invalid input syntax for
 * type uuid` on anything that is not one, and a button that can raise a
 * database error is a button that can be used to probe.
 */

export type WatcherKind = "availability" | "http_status" | "content_change" | "feed";

export const WATCHER_KINDS: readonly WatcherKind[] = [
  "availability",
  "http_status",
  "content_change",
  "feed",
];

const KIND_SET: ReadonlySet<string> = new Set(WATCHER_KINDS);

export function isWatcherKind(value: string): value is WatcherKind {
  return KIND_SET.has(value);
}

/** Below a minute a watcher is a load generator; above a day it is not a watcher. */
export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 86_400;
export const DEFAULT_INTERVAL_SECONDS = 300;

/** One person cannot turn the bot into a crawler. */
export const MAX_WATCHERS_PER_OWNER = 20;

export const MAX_URL_LENGTH = 2_048;

export type Watcher = {
  id: string;
  ownerId: string;
  chatId: string;
  kind: WatcherKind;
  url: string;
  intervalSeconds: number;
  enabled: boolean;
  lastStatus: number | null;
  lastContentHash: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextCheckAt: Date;
  createdAt: Date;
  claimToken: string | null;
};

type Row = {
  id: string;
  owner_id: string;
  chat_id: string;
  kind: string;
  url: string;
  interval_seconds: number;
  enabled: boolean;
  last_status: number | string | null;
  last_content_hash: string | null;
  last_checked_at: Date | string | null;
  last_error: string | null;
  consecutive_failures: number | string;
  next_check_at: Date | string;
  created_at: Date | string;
  claim_token: string | null;
};

const COLUMNS =
  "id, owner_id, chat_id, kind, url, interval_seconds, enabled, last_status, " +
  "last_content_hash, last_checked_at, last_error, consecutive_failures, " +
  "next_check_at, created_at, claim_token";

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toInteger(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function toWatcher(row: Row): Watcher {
  return {
    id: row.id,
    ownerId: row.owner_id,
    chatId: row.chat_id,
    // A kind the code does not know cannot be checked, so it is read as the
    // least surprising one rather than crashing a scheduler tick.
    kind: isWatcherKind(row.kind) ? row.kind : "availability",
    url: row.url,
    intervalSeconds: toInteger(row.interval_seconds) ?? DEFAULT_INTERVAL_SECONDS,
    enabled: row.enabled === true,
    lastStatus: toInteger(row.last_status),
    lastContentHash: row.last_content_hash,
    lastCheckedAt: toDate(row.last_checked_at),
    lastError: row.last_error,
    consecutiveFailures: toInteger(row.consecutive_failures) ?? 0,
    nextCheckAt: toDate(row.next_check_at) ?? new Date(0),
    createdAt: toDate(row.created_at) ?? new Date(0),
    claimToken: row.claim_token,
  };
}

const UUID_LENGTH = 36;

/** Cheap, exact, and no regex: 8-4-4-4-12 lowercase or uppercase hex. */
export function looksLikeUuid(value: string): boolean {
  if (value.length !== UUID_LENGTH) return false;
  for (let index = 0; index < UUID_LENGTH; index += 1) {
    const character = value[index] as string;
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (character !== "-") return false;
      continue;
    }
    const isDigit = character >= "0" && character <= "9";
    const isLower = character >= "a" && character <= "f";
    const isUpper = character >= "A" && character <= "F";
    if (!isDigit && !isLower && !isUpper) return false;
  }
  return true;
}

export function clampInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_INTERVAL_SECONDS;
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.trunc(seconds)));
}

export async function countWatchers(db: Db, ownerId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    "select count(*)::text as count from pf_watchers where owner_id = $1",
    [ownerId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function createWatcher(
  db: Db,
  input: {
    ownerId: string;
    chatId: string;
    kind: WatcherKind;
    url: string;
    intervalSeconds?: number;
  },
): Promise<Watcher> {
  const result = await db.query<Row>(
    `insert into pf_watchers (owner_id, chat_id, kind, url, interval_seconds, next_check_at)
     values ($1, $2, $3, $4, $5, now())
     returning ${COLUMNS}`,
    [
      input.ownerId,
      input.chatId,
      input.kind,
      input.url,
      clampInterval(input.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("createWatcher returned no row");
  return toWatcher(row);
}

/**
 * This person's watcher, or null.
 *
 * The only read a callback handler is allowed to make. Null covers "not
 * yours", "not a real id" and "deleted" alike — the answer is the same in all
 * three, and separating them would tell a presser whether an id they invented
 * belongs to somebody.
 */
export async function readOwnedWatcher(
  db: Db,
  ownerId: string,
  id: string,
): Promise<Watcher | null> {
  if (!looksLikeUuid(id)) return null;
  const result = await db.query<Row>(
    `select ${COLUMNS} from pf_watchers where id = $1 and owner_id = $2`,
    [id, ownerId],
  );
  const row = result.rows[0];
  return row ? toWatcher(row) : null;
}

export async function listWatchers(
  db: Db,
  ownerId: string,
  limit = MAX_WATCHERS_PER_OWNER,
): Promise<Watcher[]> {
  const result = await db.query<Row>(
    `select ${COLUMNS} from pf_watchers where owner_id = $1 order by created_at limit $2`,
    [ownerId, Math.max(1, Math.trunc(limit))],
  );
  return result.rows.map(toWatcher);
}

export async function setWatcherEnabled(
  db: Db,
  ownerId: string,
  id: string,
  enabled: boolean,
): Promise<Watcher | null> {
  if (!looksLikeUuid(id)) return null;
  const result = await db.query<Row>(
    `update pf_watchers set enabled = $3, next_check_at = now(), consecutive_failures = 0
     where id = $1 and owner_id = $2
     returning ${COLUMNS}`,
    [id, ownerId, enabled],
  );
  const row = result.rows[0];
  return row ? toWatcher(row) : null;
}

/** Makes this watcher due immediately. Owner-scoped, like everything a button reaches. */
export async function scheduleWatcherNow(
  db: Db,
  ownerId: string,
  id: string,
): Promise<Watcher | null> {
  if (!looksLikeUuid(id)) return null;
  const result = await db.query<Row>(
    `update pf_watchers set next_check_at = now() where id = $1 and owner_id = $2
     returning ${COLUMNS}`,
    [id, ownerId],
  );
  const row = result.rows[0];
  return row ? toWatcher(row) : null;
}

export async function deleteWatcher(db: Db, ownerId: string, id: string): Promise<boolean> {
  if (!looksLikeUuid(id)) return false;
  const result = await db.query(`delete from pf_watchers where id = $1 and owner_id = $2`, [
    id,
    ownerId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * What is due, claimed for one tick.
 *
 * `for update skip locked` is what lets a second process run the scheduler
 * without either duplicating a check or waiting behind the first. The lease is
 * the other half: a process that dies holding a claim must not park a watcher
 * for ever, so a claim older than the lease is taken by whoever is next.
 *
 * `now` is passed in rather than read as `now()` so a test can move time. The
 * cost is that every scheduler process must have a sane clock, which is true
 * of every process that also has to decide when a 300-second interval elapsed.
 */
export async function claimDueWatchers(
  db: Db,
  input: { now: Date; limit: number; claimToken: string; leaseSeconds: number },
): Promise<Watcher[]> {
  const result = await db.query<Row>(
    `update pf_watchers set claimed_at = $1, claim_token = $2
     where id in (
       select id from pf_watchers
       where enabled = true
         and next_check_at <= $1
         and (claimed_at is null or claimed_at < $1 - ($3 || ' seconds')::interval)
       order by next_check_at
       limit $4
       for update skip locked
     )
     returning ${COLUMNS}`,
    [
      input.now,
      input.claimToken,
      String(Math.max(1, Math.trunc(input.leaseSeconds))),
      Math.max(1, Math.trunc(input.limit)),
    ],
  );
  return result.rows.map(toWatcher);
}

/**
 * Writes what a check saw, and only if we still hold the claim.
 *
 * The `claim_token` in the WHERE is not decoration: a tick that took longer
 * than the lease has already had its watcher taken by somebody else, and
 * writing its result would overwrite a newer observation with an older one.
 */
export async function recordWatcherResult(
  db: Db,
  input: {
    id: string;
    claimToken: string;
    checkedAt: Date;
    nextCheckAt: Date;
    status: number | null;
    contentHash: string | null;
    error: string | null;
    consecutiveFailures: number;
  },
): Promise<boolean> {
  if (!looksLikeUuid(input.id)) return false;
  const result = await db.query(
    `update pf_watchers set last_checked_at = $3, next_check_at = $4, last_status = $5,
       last_content_hash = $6, last_error = $7, consecutive_failures = $8,
       claimed_at = null, claim_token = null
     where id = $1 and claim_token = $2`,
    [
      input.id,
      input.claimToken,
      input.checkedAt,
      input.nextCheckAt,
      input.status,
      input.contentHash,
      input.error,
      Math.max(0, Math.trunc(input.consecutiveFailures)),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Hands a claim back untouched, for a tick that could not finish. */
export async function releaseWatcherClaim(
  db: Db,
  id: string,
  claimToken: string,
): Promise<void> {
  if (!looksLikeUuid(id)) return;
  await db.query(
    `update pf_watchers set claimed_at = null, claim_token = null
     where id = $1 and claim_token = $2`,
    [id, claimToken],
  );
}
