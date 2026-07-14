import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const messagesHookUrl = new URL(
  "../../artifacts/kub/src/hooks/useMessages.ts",
  import.meta.url,
);

const migrationUrl = new URL(
  "../../.migration-backup/supabase/migrations/20260714090000_chat_read_notification_sync.sql",
  import.meta.url,
);

test("a visible realtime message schedules read before optional joined enrichment", async () => {
  const source = await readFile(messagesHookUrl, "utf8");
  const handlerStart = source.indexOf("const provisional = buildRealtimeMessage(payload.new)");
  const joinedFetch = source.indexOf(".select(MESSAGE_SELECT_WITH_JOINS)", handlerStart);
  const readReceipt = source.indexOf(
    "scheduleMarkChatRead(supabase, payload.new.chat_id, payload.new.created_at)",
    handlerStart,
  );

  assert.notEqual(handlerStart, -1);
  assert.notEqual(joinedFetch, -1);
  assert.notEqual(readReceipt, -1);
  assert.ok(
    readReceipt < joinedFetch,
    "read receipt must not depend on the lag-prone joined message fetch",
  );
});

test("mark_chat_read atomically advances receipts and reads matching notifications", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create or replace function public\.mark_chat_read/i);
  assert.match(sql, /update public\.chat_members/i);
  assert.match(
    sql,
    /perform public\.notifications_mark_chat_messages_read\(p_chat_id,\s*v_now\)/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.mark_chat_read\(uuid\)\s+to authenticated/i,
  );
});
