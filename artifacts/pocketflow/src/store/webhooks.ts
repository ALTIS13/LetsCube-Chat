import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import type { Db } from "#pf/store/db";

/**
 * The generic webhook inbox (§5), on the storage side.
 *
 * A row here is a URL somebody can POST to and a chat the result lands in. The
 * interesting part is the secret, and the interesting decision about the secret
 * is that this module cannot read one: `pf_webhooks.secret_hash` is the only
 * column, and it is a KDF output. The secret itself exists in exactly two
 * places for exactly two moments — the reply to «Создать» and the reply to
 * «Перевыпустить» — and nowhere after that.
 *
 * **Why a KDF and not a SHA.** A webhook secret is a bearer credential: whoever
 * holds it can put text into somebody's chat. `sha256(secret)` would be fine
 * against a brute force of 256 random bits and useless against the realistic
 * failure, which is a secret that is *not* 256 random bits — a person who
 * rotates and then types `my-grafana-2026` into the header because they were
 * debugging. Storing a KDF output costs one derivation per delivery and
 * removes the whole class.
 *
 * scrypt with N=2^14, r=8, p=1 is ~16 MiB and a few tens of milliseconds per
 * verification. That is deliberately affordable *because the rate limiter runs
 * first*: `http/hookRoute.ts` takes a token before it ever reaches this module,
 * so the cost per attacker is bounded by the bucket rather than by the CPU.
 * The parameters are written into the stored string rather than assumed, so
 * raising them later re-verifies old rows instead of locking everyone out.
 */

export type Webhook = {
  id: string;
  ownerId: string;
  chatId: string;
  displayName: string;
  secretHash: string;
  enabled: boolean;
  eventCount: number;
  createdAt: Date;
  lastUsedAt: Date | null;
};

type Row = {
  id: string;
  owner_id: string;
  chat_id: string;
  display_name: string;
  secret_hash: string;
  enabled: boolean;
  event_count: string | number;
  created_at: Date;
  last_used_at: Date | null;
};

const COLUMNS =
  "id, owner_id, chat_id, display_name, secret_hash, enabled, event_count, created_at, last_used_at";

function toWebhook(row: Row): Webhook {
  return {
    id: row.id,
    ownerId: row.owner_id,
    chatId: row.chat_id,
    displayName: row.display_name,
    secretHash: row.secret_hash,
    enabled: row.enabled,
    // `bigint` comes back from `pg` as a string, because 2^53 exists. A count
    // of webhook deliveries will never reach it, but reading it as a number
    // here rather than everywhere it is displayed keeps that assumption in one
    // place where it can be found.
    eventCount: Number(row.event_count ?? 0),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** How many inboxes one person may own. A bounded list keeps a keyboard usable. */
export const MAX_WEBHOOKS_PER_OWNER = 20;

export const MAX_DISPLAY_NAME_LENGTH = 64;

/** Longest event key we will store. Anything longer is a payload, not a key. */
export const MAX_EVENT_KEY_LENGTH = 200;

/**
 * What a secret looks like on the wire.
 *
 * Checked before the KDF runs: a 4 KB `Authorization` header is not a secret
 * anybody minted here, and refusing it early keeps a header from becoming CPU.
 */
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

const SECRET_PREFIX = "pfwh_";

/**
 * A new secret.
 *
 * 32 bytes of CSPRNG, base64url so it survives a shell, a YAML file and a
 * header without quoting. The prefix is not decoration: it lets a secret
 * scanner recognise one in a pasted log, and it lets a person tell it apart
 * from the webhook id sitting next to it in the same message.
 */
export function mintSecret(): string {
  return SECRET_PREFIX + randomBytes(32).toString("base64url");
}

type ScryptParams = { n: number; r: number; p: number };

const CURRENT_PARAMS: ScryptParams = { n: 16_384, r: 8, p: 1 };
const KEY_LENGTH = 32;

/** Guards against a tampered row turning a verification into a memory bomb. */
const MAX_N = 1 << 20;

function derive(secret: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      secret,
      salt,
      KEY_LENGTH,
      {
        N: params.n,
        r: params.r,
        p: params.p,
        // The default cap is 32 MiB and N=2^14, r=8 needs 16 MiB; stating it
        // means raising N later fails here rather than in production.
        maxmem: 256 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** `scrypt$N$r$p$salt$key`, all base64url. Self-describing so the cost can be raised. */
export async function hashSecret(secret: string, params: ScryptParams = CURRENT_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt, params);
  return [
    "scrypt",
    String(params.n),
    String(params.r),
    String(params.p),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Whether `secret` is the one this row was created with.
 *
 * Constant time in the part that matters: the comparison is
 * `timingSafeEqual` over two derived keys of equal length. The early `false`
 * results above it are decisions about the *stored* value — its scheme, its
 * parameters — which an attacker who is guessing secrets already cannot vary.
 */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  if (!SECRET_PATTERN.test(secret)) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || n < 2 || n > MAX_N) return false;
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 16) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64url");
    expected = Buffer.from(parts[5] ?? "", "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  const actual = await derive(secret, salt, { n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The id in a `/hook/<id>` URL, or null.
 *
 * Shape-checked before the database is touched, so a scan for `/hook/admin`
 * costs a regex rather than a query. The column is `uuid`, so anything else
 * would be an error from Postgres anyway — and an error is a worse answer than
 * a 404 for a request that was never going to match.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asWebhookId(value: string): string | null {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** Trimmed, collapsed and bounded, or null when there is nothing left. */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

export function normalizeEventKey(raw: string): string | null {
  const key = raw.trim().slice(0, MAX_EVENT_KEY_LENGTH);
  return key.length > 0 ? key : null;
}

/**
 * Creates an inbox and returns its secret — the only time this function's
 * caller ever sees one.
 *
 * The per-owner limit is enforced by the insert rather than by a count taken
 * first: two «Создать» presses racing each other is the ordinary case for a
 * person on a flaky connection, and a check-then-insert would let both through.
 */
export async function createWebhook(
  db: Db,
  input: { ownerId: string; chatId: string; displayName: string },
): Promise<{ webhook: Webhook; secret: string } | null> {
  const secret = mintSecret();
  const secretHash = await hashSecret(secret);
  const result = await db.query<Row>(
    `insert into pf_webhooks (owner_id, chat_id, display_name, secret_hash)
     select $1, $2, $3, $4
     where (select count(*) from pf_webhooks where owner_id = $1) < $5
     returning ${COLUMNS}`,
    [input.ownerId, input.chatId, input.displayName, secretHash, MAX_WEBHOOKS_PER_OWNER],
  );
  const row = result.rows[0];
  return row ? { webhook: toWebhook(row), secret } : null;
}

export async function listWebhooks(db: Db, ownerId: string): Promise<Webhook[]> {
  const result = await db.query<Row>(
    `select ${COLUMNS} from pf_webhooks where owner_id = $1 order by created_at desc`,
    [ownerId],
  );
  return result.rows.map(toWebhook);
}

export async function countWebhooks(db: Db, ownerId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from pf_webhooks where owner_id = $1`,
    [ownerId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * One row by id, with no owner filter.
 *
 * Deliberately unfiltered, and the reason is the rule in `app/context.ts`:
 * `callback_data` is not authorization. The application re-reads the row and
 * compares `ownerId` itself, so the check is a visible line in the handler
 * rather than a WHERE clause somebody can drop while refactoring a query. The
 * delivery path needs the same unfiltered read — an incoming POST has an id
 * and a secret and no idea who owns it.
 */
export async function getWebhook(db: Db, id: string): Promise<Webhook | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from pf_webhooks where id = $1`, [id]);
  const row = result.rows[0];
  return row ? toWebhook(row) : null;
}

/**
 * The mutations, each one filtered by owner as well.
 *
 * Belt and braces on purpose: the handler checks ownership and so does the
 * statement. If one of the two is ever lost, the other still refuses, and a
 * refusal is the failure mode that leaves a person's chat alone.
 */
export async function renameWebhook(
  db: Db,
  input: { id: string; ownerId: string; displayName: string },
): Promise<Webhook | null> {
  const result = await db.query<Row>(
    `update pf_webhooks set display_name = $3
     where id = $1 and owner_id = $2
     returning ${COLUMNS}`,
    [input.id, input.ownerId, input.displayName],
  );
  const row = result.rows[0];
  return row ? toWebhook(row) : null;
}

export async function rotateWebhookSecret(
  db: Db,
  input: { id: string; ownerId: string },
): Promise<{ webhook: Webhook; secret: string } | null> {
  const secret = mintSecret();
  const secretHash = await hashSecret(secret);
  const result = await db.query<Row>(
    `update pf_webhooks set secret_hash = $3
     where id = $1 and owner_id = $2
     returning ${COLUMNS}`,
    [input.id, input.ownerId, secretHash],
  );
  const row = result.rows[0];
  return row ? { webhook: toWebhook(row), secret } : null;
}

export async function setWebhookEnabled(
  db: Db,
  input: { id: string; ownerId: string; enabled: boolean },
): Promise<Webhook | null> {
  const result = await db.query<Row>(
    `update pf_webhooks set enabled = $3
     where id = $1 and owner_id = $2
     returning ${COLUMNS}`,
    [input.id, input.ownerId, input.enabled],
  );
  const row = result.rows[0];
  return row ? toWebhook(row) : null;
}

export async function deleteWebhook(
  db: Db,
  input: { id: string; ownerId: string },
): Promise<boolean> {
  const result = await db.query(`delete from pf_webhooks where id = $1 and owner_id = $2`, [
    input.id,
    input.ownerId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Claims an event key, returning false if this delivery has been seen.
 *
 * An INSERT rather than a SELECT-then-INSERT, for the reason `store/updates.ts`
 * gives: two retries arriving together is exactly the race the table exists to
 * decide, and only the primary key can decide it.
 *
 * The claim is taken *before* the message is sent and released if the send
 * fails, so the guarantee is at-least-once rather than at-most-once. A sender
 * that retries after our gateway was down gets its event delivered; the price
 * is that a send which succeeded and then failed to be recorded could deliver
 * twice. For a notification that is the right side to err on.
 */
export async function claimEvent(db: Db, webhookId: string, eventKey: string): Promise<boolean> {
  const result = await db.query(
    `insert into pf_webhook_events (webhook_id, event_key)
     values ($1, $2)
     on conflict (webhook_id, event_key) do nothing`,
    [webhookId, eventKey],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function releaseEvent(db: Db, webhookId: string, eventKey: string): Promise<void> {
  await db.query(`delete from pf_webhook_events where webhook_id = $1 and event_key = $2`, [
    webhookId,
    eventKey,
  ]);
}

/** Counts a delivered event. Separate from the claim so a duplicate does not inflate it. */
export async function recordDelivery(db: Db, webhookId: string): Promise<void> {
  await db.query(
    `update pf_webhooks set event_count = event_count + 1, last_used_at = now() where id = $1`,
    [webhookId],
  );
}

/**
 * Forgets event keys older than the retention window.
 *
 * The window must outlive the longest retry schedule of any sender, or the
 * table stops working on exactly the deliveries it exists for. GitHub retries
 * for hours, Grafana for minutes; seven days is comfortably past both and
 * still bounds the table.
 */
export async function pruneWebhookEvents(db: Db, olderThanDays = 7): Promise<number> {
  const result = await db.query(
    `delete from pf_webhook_events where received_at < now() - ($1 || ' days')::interval`,
    [String(Math.max(1, Math.trunc(olderThanDays)))],
  );
  return result.rowCount ?? 0;
}
