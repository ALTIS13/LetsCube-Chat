import type { Db } from "#pf/store/db";

/**
 * What a chat is in the middle of — «пришлите дату», «как назвать webhook».
 *
 * Keyed by (chat, user) and expiring, both from the schema: a flow somebody
 * abandoned must not silently eat their next unrelated message an hour later,
 * and two people in the same group must be able to be mid-flow at once.
 *
 * This lived in `store/reminders.ts` while reminders were the only feature
 * that waited for an answer. Settings and webhooks want one too, and a second
 * copy of a table’s access rules is how two features end up disagreeing about
 * whose prompt is whose.
 */

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}
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

/**
 * Reads a prompt and clears it in one statement, or answers null.
 *
 * The atomic form, and the one a feature should reach for. Read-then-clear
 * looks equivalent and is not: two messages arriving together are both read as
 * the answer, and the flow runs twice — a reminder created twice, a webhook
 * named twice. `delete … returning` lets exactly one of them win.
 *
 * `kinds` is required rather than optional. The row is one per (chat, user),
 * so a feature that took whatever was there would cancel another feature’s
 * half-finished question and answer it with somebody’s unrelated message.
 */
export async function takePendingPrompt<Context = Record<string, unknown>>(
  db: Db,
  chatId: string,
  userId: string,
  kinds: readonly string[],
  now: Date,
): Promise<PendingPrompt<Context> | null> {
  if (kinds.length === 0) return null;
  const result = await db.query<{
    chat_id: string;
    user_id: string;
    kind: string;
    context: unknown;
    expires_at: Date | string;
  }>(
    `delete from pf_pending_prompts
     where chat_id = $1 and user_id = $2 and kind = any($3::text[]) and expires_at > $4
     returning chat_id, user_id, kind, context, expires_at`,
    [chatId, userId, [...kinds], now],
  );
  const row = result.rows[0];
  if (!row) return null;
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

/**
 * Clears a prompt only if it is one of `kinds`.
 *
 * `clearPendingPrompt` does not filter, and the row is one per (chat, user),
 * so a feature abandoning its own flow would otherwise cancel whatever
 * another feature was in the middle of asking. Returns whether it removed
 * anything, which is occasionally worth knowing and never worth guessing.
 */
export async function clearPendingPromptOfKind(
  db: Db,
  chatId: string,
  userId: string,
  kinds: readonly string[],
): Promise<boolean> {
  if (kinds.length === 0) return false;
  const result = await db.query(
    `delete from pf_pending_prompts
     where chat_id = $1 and user_id = $2 and kind = any($3::text[])`,
    [chatId, userId, [...kinds]],
  );
  return (result.rowCount ?? 0) > 0;
}
