import type { Db } from "#pf/store/db";
import type { SavedKind } from "#pf/store/saved";

/**
 * What a button refers to — see `migrations/002_inbox_candidates.sql` for why
 * this exists at all.
 *
 * Every read is scoped to the owner, and there is deliberately no unscoped
 * read in this module: a handler cannot reach somebody else's candidate even
 * by mistake, which is stronger than remembering to check.
 */

export type InboxCandidate = {
  id: string;
  ownerId: string;
  chatId: string;
  sourceMessageId: string;
  kind: SavedKind;
  content: string;
  fileId: string | null;
};

type Row = {
  id: string;
  owner_id: string;
  chat_id: string;
  source_message_id: string;
  kind: string;
  content: string;
  file_id: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An offer is worth acting on for this long. Longer than anybody hesitates, shorter than a day. */
export const CANDIDATE_TTL_MINUTES = 120;

export async function rememberCandidate(
  db: Db,
  input: {
    ownerId: string;
    chatId: string;
    sourceMessageId: string;
    kind: SavedKind;
    content: string;
    fileId?: string | null;
  },
  ttlMinutes = CANDIDATE_TTL_MINUTES,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into pf_inbox_candidates
       (owner_id, chat_id, source_message_id, kind, content, file_id, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)
     returning id`,
    [
      input.ownerId,
      input.chatId,
      input.sourceMessageId,
      input.kind,
      input.content,
      input.fileId ?? null,
      String(Math.max(1, Math.trunc(ttlMinutes))),
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("rememberCandidate returned no id");
  return id;
}

/**
 * The candidate this button refers to, or null.
 *
 * Null covers three different situations on purpose — not this person's, not a
 * real id, expired — because the caller's answer is the same in all three and
 * distinguishing them in a message would tell somebody whether an id they
 * guessed exists.
 */
export async function readCandidate(
  db: Db,
  ownerId: string,
  id: string,
): Promise<InboxCandidate | null> {
  if (!UUID.test(id)) return null;
  const result = await db.query<Row>(
    `select id, owner_id, chat_id, source_message_id, kind, content, file_id
     from pf_inbox_candidates
     where id = $1 and owner_id = $2 and expires_at > now()`,
    [id, ownerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    chatId: row.chat_id,
    sourceMessageId: row.source_message_id,
    kind: row.kind as SavedKind,
    content: row.content,
    fileId: row.file_id,
  };
}

export async function pruneCandidates(db: Db): Promise<number> {
  const result = await db.query(`delete from pf_inbox_candidates where expires_at < now()`);
  return result.rowCount ?? 0;
}
