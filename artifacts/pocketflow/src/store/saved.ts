import type { Db } from "#pf/store/db";

/**
 * Saved items — the thing PocketFlow is actually for (§3).
 *
 * `kind` is what the inbox decided the object was, and it is stored rather than
 * re-derived on read: the classifier will change, and an item saved as a URL
 * must keep reading as a URL even after somebody teaches the parser a new rule.
 */

export type SavedKind =
  | "text"
  | "url"
  | "json"
  | "photo"
  | "video"
  | "document"
  | "voice"
  | "location";

export type SavedItem = {
  id: string;
  ownerId: string;
  chatId: string;
  kind: SavedKind;
  content: string;
  tags: string[];
  sourceMessageId: string | null;
  fileId: string | null;
  createdAt: Date;
};

type Row = {
  id: string;
  owner_id: string;
  chat_id: string;
  kind: string;
  content: string;
  tags: string[];
  source_message_id: string | null;
  file_id: string | null;
  created_at: Date;
};

const KINDS: ReadonlySet<string> = new Set<SavedKind>([
  "text",
  "url",
  "json",
  "photo",
  "video",
  "document",
  "voice",
  "location",
]);

function toItem(row: Row): SavedItem {
  return {
    id: row.id,
    ownerId: row.owner_id,
    chatId: row.chat_id,
    kind: (KINDS.has(row.kind) ? row.kind : "text") as SavedKind,
    content: row.content,
    tags: row.tags ?? [],
    sourceMessageId: row.source_message_id,
    fileId: row.file_id,
    createdAt: row.created_at,
  };
}

export async function saveItem(
  db: Db,
  input: {
    ownerId: string;
    chatId: string;
    kind: SavedKind;
    content: string;
    tags?: string[];
    sourceMessageId?: string | null;
    fileId?: string | null;
  },
): Promise<SavedItem> {
  const result = await db.query<Row>(
    `insert into pf_saved_items
       (owner_id, chat_id, kind, content, tags, source_message_id, file_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, owner_id, chat_id, kind, content, tags, source_message_id, file_id, created_at`,
    [
      input.ownerId,
      input.chatId,
      input.kind,
      input.content,
      input.tags ?? [],
      input.sourceMessageId ?? null,
      input.fileId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("saveItem returned no row");
  return toItem(row);
}

/**
 * One item, **scoped to its owner**.
 *
 * Every read takes the owner, so there is no function in this module that can
 * return somebody else's item by id. That is deliberate: §19 says
 * `callback_data` is not an authorization proof, and the surest way to honour
 * that is to make the unscoped read impossible to call by accident.
 */
export async function getItem(db: Db, ownerId: string, id: string): Promise<SavedItem | null> {
  // An id that is not a UUID would make Postgres raise 22P02 rather than
  // return nothing, and a malformed callback would surface as a 500. A
  // pressed button carries whatever the client sent, so this is reachable.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const result = await db.query<Row>(
    `select id, owner_id, chat_id, kind, content, tags, source_message_id, file_id, created_at
     from pf_saved_items
     where id = $1 and owner_id = $2`,
    [id, ownerId],
  );
  const row = result.rows[0];
  return row ? toItem(row) : null;
}

export async function listItems(
  db: Db,
  ownerId: string,
  options?: { limit?: number; offset?: number },
): Promise<SavedItem[]> {
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const offset = Math.max(options?.offset ?? 0, 0);
  const result = await db.query<Row>(
    `select id, owner_id, chat_id, kind, content, tags, source_message_id, file_id, created_at
     from pf_saved_items
     where owner_id = $1
     order by created_at desc
     limit $2 offset $3`,
    [ownerId, limit, offset],
  );
  return result.rows.map(toItem);
}

/**
 * Substring search over one person's items.
 *
 * `position(... in lower(content))` rather than `like '%' || $2 || '%'` because
 * the second form makes `%` and `_` in somebody's query into wildcards — not a
 * security hole here, but a search for «50%» that matches everything is a
 * defect a user will report and nobody will reproduce.
 */
export async function searchItems(
  db: Db,
  ownerId: string,
  query: string,
  limit = 10,
): Promise<SavedItem[]> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return listItems(db, ownerId, { limit });
  const result = await db.query<Row>(
    `select id, owner_id, chat_id, kind, content, tags, source_message_id, file_id, created_at
     from pf_saved_items
     where owner_id = $1 and position($2 in lower(content)) > 0
     order by created_at desc
     limit $3`,
    [ownerId, needle, Math.min(Math.max(limit, 1), 50)],
  );
  return result.rows.map(toItem);
}

export async function deleteItem(db: Db, ownerId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  const result = await db.query(`delete from pf_saved_items where id = $1 and owner_id = $2`, [
    id,
    ownerId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function countItems(db: Db, ownerId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from pf_saved_items where owner_id = $1`,
    [ownerId],
  );
  return Number(result.rows[0]?.count ?? "0");
}
