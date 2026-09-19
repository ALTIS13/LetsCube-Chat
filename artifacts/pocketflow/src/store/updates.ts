import type { Db } from "#pf/store/db";

/**
 * Idempotent update processing (§19 of the brief).
 *
 * **Why this is not optional.** Both transports redeliver. A webhook that times
 * out is retried by the platform even though PocketFlow handled it; a long poll
 * that is interrupted between the fetch and the acknowledgement re-offers the
 * same `update_id`. Without this table, a retried «Сохранить» saves twice and a
 * retried reminder fires twice — and both look like the bot being flaky rather
 * than like a delivery guarantee working as designed.
 *
 * The claim is an INSERT, not a SELECT-then-INSERT: two concurrent workers
 * reading «not seen» at the same moment is exactly the race this exists to
 * close, and only the unique index can decide it. `on conflict do nothing`
 * makes the loser's `rowCount` zero, which is the answer.
 */

export async function claimUpdate(db: Db, updateId: number, kind: string): Promise<boolean> {
  const result = await db.query(
    `insert into pf_processed_updates (update_id, kind)
     values ($1, $2)
     on conflict (update_id) do nothing`,
    [updateId, kind],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Releases a claim so the update can be handled again.
 *
 * Called when handling threw. Keeping the claim would turn one transient
 * failure — a database blip, a rate limit — into an update that is lost for
 * good, which is the wrong side to err on: a duplicated «Сохранить» is a
 * nuisance, a dropped message is the bot ignoring somebody.
 */
export async function releaseUpdate(db: Db, updateId: number): Promise<void> {
  await db.query(`delete from pf_processed_updates where update_id = $1`, [updateId]);
}

/**
 * Forgets claims older than the retention window.
 *
 * The window has to outlive the platform's own retry schedule, or the table
 * stops doing its job on exactly the deliveries it exists for. Seven days is
 * far longer than any redelivery and still bounds the table.
 */
export async function pruneProcessedUpdates(db: Db, olderThanDays = 7): Promise<number> {
  const result = await db.query(
    `delete from pf_processed_updates where processed_at < now() - ($1 || ' days')::interval`,
    [String(Math.max(1, Math.trunc(olderThanDays)))],
  );
  return result.rowCount ?? 0;
}

/**
 * The highest update id handled, or 0.
 *
 * This is the polling offset after a restart. The platform's `getUpdates`
 * treats `offset` as «everything below this is acknowledged», so starting from
 * 0 after a restart would re-deliver the whole retained queue — handled
 * correctly thanks to `claimUpdate`, but a pointless storm.
 */
export async function highestProcessedUpdateId(db: Db): Promise<number> {
  const result = await db.query<{ max: string | null }>(
    `select max(update_id)::text as max from pf_processed_updates`,
  );
  const value = result.rows[0]?.max;
  return value === null || value === undefined ? 0 : Number(value);
}
