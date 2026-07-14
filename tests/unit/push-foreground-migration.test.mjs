import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../.migration-backup/supabase/migrations/20260714_push_foreground_sessions.sql",
  import.meta.url,
);

const currentChatIndexMigrationUrl = new URL(
  "../../.migration-backup/supabase/migrations/20260714055443_push_foreground_sessions_current_chat_index.sql",
  import.meta.url,
);

test("foreground push migration isolates sessions and atomically claims the outbox", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create table if not exists public\.push_foreground_sessions/i);
  assert.match(sql, /alter table public\.push_foreground_sessions enable row level security/i);
  assert.match(
    sql,
    /revoke all on table public\.push_foreground_sessions from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /expires_at\s*=\s*now\(\)\s*\+\s*interval '20 seconds'/i,
  );
  assert.match(sql, /create or replace function public\.push_outbox_claim/i);
  assert.match(sql, /for update[\s\S]*skip locked/i);
  assert.match(
    sql,
    /grant execute on function public\.push_outbox_claim\(integer, uuid\) to service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.push_outbox_claim[^;]+authenticated/i,
  );
});

test("foreground push migration restores chat read sync and hardens internal helpers", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /create or replace function public\.notifications_mark_chat_messages_read/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.notifications_mark_chat_messages_read\(uuid, timestamptz\)\s+to authenticated/i,
  );
  for (const helper of [
    "_enqueue_push_after_notification_insert",
    "_notification_push_allowed",
    "_notification_push_payload",
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${helper.replaceAll("_", "_")}\\(`, "i"),
    );
  }
});

test("foreground session current-chat foreign key has a covering index", async () => {
  const sql = await readFile(currentChatIndexMigrationUrl, "utf8");

  assert.match(
    sql,
    /create index if not exists push_foreground_sessions_current_chat_idx\s+on public\.push_foreground_sessions \(current_chat_id\)/i,
  );
});
