import type { Db } from "#pf/store/db";

/**
 * Reminders, and the claim that stops two processes firing the same one.
 *
 * Two rules run through every query in this file and both are §19's.
 *
 * **Parameterised, always.** Not one identifier, interval or limit is spliced
 * into a statement. The interval in `snoozeReminder` is the tempting exception
 * — Postgres will not take a parameter where an interval literal goes — and it
 * is handled by computing the instant in TypeScript and passing a timestamp,
 * rather than by building `now() + interval '10 minutes'` out of a number
 * somebody pressed a button to choose.
 *
 * **Owner-scoped in the SQL, not only in the handler.** Every mutation a person
 * can reach carries `owner_id = $2` in its WHERE clause. The handlers in
 * `app/reminders.ts` also re-read the row and check the presser, so this is the
 * second of two independent gates — and it is the one that still holds if a
 * handler is later edited by somebody who has not read §19. A forged
 * `callback_data` naming another person's reminder id therefore changes no row
 * even if every check above it were removed.
 *
 * The id itself needs a third piece of care. It reaches us from a button, so it
 * is a client-controlled string; handing `'; drop` to a `uuid` column raises
 * `22P02` inside the handler, which is a crash rather than a refusal. `isReminderId`
 * decides the shape before Postgres is asked.
 */

export type ReminderState = "pending" | "fired" | "done" | "cancelled";

export type Reminder = {
  id: string;
  ownerId: string;
  chatId: string;
  body: string;
  dueAt: Date;
  state: ReminderState;
  snoozeCount: number;
  firedMessageId: string | null;
  createdAt: Date;
  firedAt: Date | null;
  completedAt: Date | null;
  claimedAt: Date | null;
  claimToken: string | null;
};

type Row = {
  id: string;
  owner_id: string;
  chat_id: string;
  body: string;
  due_at: Date | string;
  state: string;
  snooze_count: number | string;
  fired_message_id: string | null;
  created_at: Date | string;
  fired_at: Date | string | null;
  completed_at: Date | string | null;
  claimed_at: Date | string | null;
  claim_token: string | null;
};

const COLUMNS = `id, owner_id, chat_id, body, due_at, state, snooze_count,
                 fired_message_id, created_at, fired_at, completed_at,
                 claimed_at, claim_token`;

/** The same list, qualified, for the one statement that joins the table to itself. */
const TARGET_COLUMNS = `target.id, target.owner_id, target.chat_id, target.body,
                        target.due_at, target.state, target.snooze_count,
                        target.fired_message_id, target.created_at, target.fired_at,
                        target.completed_at, target.claimed_at, target.claim_token`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether this string could be a reminder id at all. */
export function isReminderId(value: string): boolean {
  return UUID.test(value);
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
}

function toState(value: string): ReminderState {
  return value === "fired" || value === "done" || value === "cancelled" ? value : "pending";
}

function toReminder(row: Row): Reminder {
  return {
    id: row.id,
    ownerId: row.owner_id,
    chatId: row.chat_id,
    body: row.body,
    dueAt: toDate(row.due_at),
    state: toState(row.state),
    snoozeCount: Number(row.snooze_count),
    firedMessageId: row.fired_message_id,
    createdAt: toDate(row.created_at),
    firedAt: toDateOrNull(row.fired_at),
    completedAt: toDateOrNull(row.completed_at),
    claimedAt: toDateOrNull(row.claimed_at),
    claimToken: row.claim_token,
  };
}

// ---------------------------------------------------------------------------
// Writing and reading
// ---------------------------------------------------------------------------

export async function createReminder(
  db: Db,
  input: { ownerId: string; chatId: string; body: string; dueAt: Date },
): Promise<Reminder> {
  const result = await db.query<Row>(
    `insert into pf_reminders (owner_id, chat_id, body, due_at)
     values ($1, $2, $3, $4)
     returning ${COLUMNS}`,
    [input.ownerId, input.chatId, input.body, input.dueAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("createReminder returned no row");
  return toReminder(row);
}

/**
 * One reminder, scoped to its owner.
 *
 * There is deliberately no unscoped read in this module. A handler that wants
 * «the reminder this button names» cannot accidentally obtain somebody else's,
 * because the only function that exists requires the owner — which is a
 * stronger guarantee than remembering to compare `ownerId` afterwards.
 *
 * Null covers three cases at once — not a real id, not this person's, deleted —
 * because the caller's answer is the same for all three, and an answer that
 * distinguished them would tell a guesser which ids exist.
 */
export async function readReminder(db: Db, ownerId: string, id: string): Promise<Reminder | null> {
  if (!isReminderId(id)) return null;
  const result = await db.query<Row>(
    `select ${COLUMNS} from pf_reminders where id = $1 and owner_id = $2`,
    [id, ownerId],
  );
  const row = result.rows[0];
  return row ? toReminder(row) : null;
}

/** What is still going to happen, soonest first. */
export async function listPending(db: Db, ownerId: string, limit = 20): Promise<Reminder[]> {
  const result = await db.query<Row>(
    `select ${COLUMNS} from pf_reminders
     where owner_id = $1 and state in ('pending', 'fired')
     order by due_at asc
     limit $2`,
    [ownerId, Math.max(1, Math.min(100, Math.trunc(limit)))],
  );
  return result.rows.map(toReminder);
}

export async function countPending(db: Db, ownerId: string): Promise<number> {
  const result = await db.query<{ count: string | number }>(
    `select count(*)::int as count from pf_reminders
     where owner_id = $1 and state in ('pending', 'fired')`,
    [ownerId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// The claim
// ---------------------------------------------------------------------------

/** How long a claim is honoured before another process may take the work. */
export const CLAIM_TTL_MS = 5 * 60_000;

/**
 * Takes ownership of everything due, and returns what was taken.
 *
 * One statement, and that is the whole of the «two processes must not fire the
 * same reminder twice» requirement. Three things make it work together and
 * removing any one of them reintroduces a double send:
 *
 *   - `for update skip locked` — a second transaction running at the same
 *     instant passes over the rows the first is holding instead of blocking on
 *     them and then claiming them a moment later;
 *   - `claimed_at is null or claimed_at < $3` — a second *tick*, after the
 *     first has committed, sees the claim and leaves it alone;
 *   - the update and the select are one statement, so there is no window
 *     between deciding and claiming.
 *
 * The TTL is the counterweight: a process that claims a reminder and then dies
 * would otherwise hold it for ever. After `CLAIM_TTL_MS` the work is free
 * again, which is why `markFired` is conditional on the token — the dead
 * process coming back to life must not be able to finish a job that has since
 * been given to somebody else.
 */
export async function claimDue(
  db: Db,
  input: { now: Date; claimToken: string; limit?: number; claimTtlMs?: number },
): Promise<Reminder[]> {
  const staleBefore = new Date(input.now.getTime() - (input.claimTtlMs ?? CLAIM_TTL_MS));
  const result = await db.query<Row>(
    `update pf_reminders as target
        set claimed_at = $1, claim_token = $2
       from (
         select id from pf_reminders
          where state = 'pending'
            and due_at <= $1
            and (claimed_at is null or claimed_at < $3)
          order by due_at asc
          limit $4
          for update skip locked
       ) as due
      where target.id = due.id
     returning ${TARGET_COLUMNS}`,
    [input.now, input.claimToken, staleBefore, Math.max(1, Math.min(500, Math.trunc(input.limit ?? 50)))],
  );
  return result.rows.map(toReminder);
}

/**
 * Records that the reminder was delivered, if we still hold the claim.
 *
 * Returns false when the token no longer matches or the state has moved on —
 * the reminder was cancelled while in flight, or the claim expired and another
 * process took it. False is a normal outcome and not an error: the caller's
 * only correct response is to leave the row alone.
 */
export async function markFired(
  db: Db,
  input: { id: string; claimToken: string; firedMessageId: string | null; firedAt: Date },
): Promise<boolean> {
  if (!isReminderId(input.id)) return false;
  const result = await db.query(
    `update pf_reminders
        set state = 'fired',
            fired_at = $3,
            fired_message_id = $4,
            claimed_at = null,
            claim_token = null
      where id = $1 and claim_token = $2 and state = 'pending'`,
    [input.id, input.claimToken, input.firedAt, input.firedMessageId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Puts the work back for the next tick, after a delivery that may yet succeed. */
export async function releaseClaim(db: Db, id: string, claimToken: string): Promise<void> {
  if (!isReminderId(id)) return;
  await db.query(
    `update pf_reminders set claimed_at = null, claim_token = null
      where id = $1 and claim_token = $2 and state = 'pending'`,
    [id, claimToken],
  );
}

/**
 * Gives up on a reminder that can never be delivered.
 *
 * Reached only for a transport failure that retrying cannot fix — the chat is
 * gone, the bot was removed from it. Without this, `releaseClaim` would hand
 * the same undeliverable row to every tick for ever, and the schema has no
 * attempt counter to bound that with. Cancelling is the honest record: the
 * reminder will not happen, and the row says so rather than silently retrying.
 */
export async function abandonReminder(
  db: Db,
  input: { id: string; claimToken: string; now: Date },
): Promise<boolean> {
  if (!isReminderId(input.id)) return false;
  const result = await db.query(
    `update pf_reminders
        set state = 'cancelled',
            completed_at = $3,
            claimed_at = null,
            claim_token = null
      where id = $1 and claim_token = $2 and state = 'pending'`,
    [input.id, input.claimToken, input.now],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// What a person does to a reminder
// ---------------------------------------------------------------------------

/** Marks it done. Returns the row as it now is, or null if it was not theirs. */
export async function completeReminder(
  db: Db,
  ownerId: string,
  id: string,
  now: Date,
): Promise<Reminder | null> {
  if (!isReminderId(id)) return null;
  const result = await db.query<Row>(
    `update pf_reminders
        set state = 'done', completed_at = $3, claimed_at = null, claim_token = null
      where id = $1 and owner_id = $2 and state in ('pending', 'fired')
     returning ${COLUMNS}`,
    [id, ownerId, now],
  );
  const row = result.rows[0];
  return row ? toReminder(row) : null;
}

export async function cancelReminder(
  db: Db,
  ownerId: string,
  id: string,
  now: Date,
): Promise<Reminder | null> {
  if (!isReminderId(id)) return null;
  const result = await db.query<Row>(
    `update pf_reminders
        set state = 'cancelled', completed_at = $3, claimed_at = null, claim_token = null
      where id = $1 and owner_id = $2 and state in ('pending', 'fired')
     returning ${COLUMNS}`,
    [id, ownerId, now],
  );
  const row = result.rows[0];
  return row ? toReminder(row) : null;
}

/**
 * Pushes it back to `dueAt` and makes it pending again.
 *
 * `fired_message_id` is cleared on purpose. That message has just been edited
 * to say «отложено», so it is no longer the reminder — the next firing must
 * send a new one rather than overwrite a line the person has already read past.
 */
export async function snoozeReminder(
  db: Db,
  ownerId: string,
  id: string,
  dueAt: Date,
): Promise<Reminder | null> {
  if (!isReminderId(id)) return null;
  const result = await db.query<Row>(
    `update pf_reminders
        set state = 'pending',
            due_at = $3,
            snooze_count = snooze_count + 1,
            fired_message_id = null,
            fired_at = null,
            claimed_at = null,
            claim_token = null
      where id = $1 and owner_id = $2 and state in ('pending', 'fired')
     returning ${COLUMNS}`,
    [id, ownerId, dueAt],
  );
  const row = result.rows[0];
  return row ? toReminder(row) : null;
}

// ---------------------------------------------------------------------------
// Half-finished conversations
// ---------------------------------------------------------------------------

/**
 * «Пришлите дату», and anything else that waits for the next message.
 *
 * Keyed by (chat, user) and expiring, both from the schema: a flow somebody
 * abandoned must not silently eat their next unrelated message an hour later,
 * and two people in the same group must be able to be mid-flow at once.
 *
 * These three functions are not reminder-specific and are only here because
 * this module is the first to need them. They belong in a `store/prompts.ts`
 * as soon as a second feature wants one — see the report accompanying this
 * work; the shape is deliberately generic so that move is a cut and paste.
 */
export type PendingPrompt<Context = Record<string, unknown>> = {
  chatId: string;
  userId: string;
  kind: string;
  context: Context;
  expiresAt: Date;
};

export const PROMPT_TTL_MINUTES = 15;

export async function setPendingPrompt(
  db: Db,
  input: {
    chatId: string;
    userId: string;
    kind: string;
    context: Record<string, unknown>;
    expiresAt: Date;
  },
): Promise<void> {
  await db.query(
    `insert into pf_pending_prompts (chat_id, user_id, kind, context, expires_at)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (chat_id, user_id) do update
       set kind = excluded.kind,
           context = excluded.context,
           expires_at = excluded.expires_at,
           created_at = now()`,
    [input.chatId, input.userId, input.kind, JSON.stringify(input.context), input.expiresAt],
  );
}

export async function readPendingPrompt<Context = Record<string, unknown>>(
  db: Db,
  chatId: string,
  userId: string,
  now: Date,
): Promise<PendingPrompt<Context> | null> {
  const result = await db.query<{
    chat_id: string;
    user_id: string;
    kind: string;
    context: unknown;
    expires_at: Date | string;
  }>(
    `select chat_id, user_id, kind, context, expires_at
     from pf_pending_prompts
     where chat_id = $1 and user_id = $2 and expires_at > $3`,
    [chatId, userId, now],
  );
  const row = result.rows[0];
  if (!row) return null;
  // `jsonb` arrives parsed from `pg` and from PGlite alike, but a driver that
  // hands back text must not take the handler down with a parse error.
  let context: unknown = row.context;
  if (typeof context === "string") {
    try {
      context = JSON.parse(context);
    } catch {
      context = {};
    }
  }
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    kind: row.kind,
    context: (context ?? {}) as Context,
    expiresAt: toDate(row.expires_at),
  };
}

export async function clearPendingPrompt(db: Db, chatId: string, userId: string): Promise<void> {
  await db.query(`delete from pf_pending_prompts where chat_id = $1 and user_id = $2`, [
    chatId,
    userId,
  ]);
}

export async function prunePendingPrompts(db: Db, now: Date): Promise<number> {
  const result = await db.query(`delete from pf_pending_prompts where expires_at < $1`, [now]);
  return result.rowCount ?? 0;
}
