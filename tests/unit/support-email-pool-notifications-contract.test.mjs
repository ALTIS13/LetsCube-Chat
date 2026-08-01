import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDir = new URL(
  "../../.migration-backup/supabase/migrations/",
  import.meta.url,
);

async function readMigration() {
  const names = await readdir(migrationDir);
  const name = names.find((candidate) =>
    candidate.endsWith("_support_email_pool_notifications.sql"),
  );
  assert.ok(name, "missing support email pool notification migration");
  return readFile(new URL(name, migrationDir), "utf8");
}

test("direct email tickets create one PII-free ticket-created event", async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /create or replace function public\._support_email_ticket_after_insert\(\)/i,
  );
  assert.match(sql, /public\._support_append_event\([\s\S]+?'ticket_created'/i);
  assert.match(
    sql,
    /after insert on public\.support_tickets[\s\S]+when \(new\.source = 'email'\)/i,
  );
  assert.match(sql, /jsonb_build_object\('source', 'email'\)/i);
  assert.doesNotMatch(sql, /new\.(subject|requester_user_id)/i);
});

test("internal support notification helpers are not client-callable", async () => {
  const sql = await readMigration();

  for (const helper of [
    "_support_email_ticket_after_insert",
    "_support_notify_after_event",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${helper}\\(\\)[\\s\\S]+?from public, anon, authenticated, service_role`,
        "i",
      ),
    );
  }
});

test("unassigned follow-ups notify the eligible pool without first-message duplication", async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /new\.event_type = 'requester_message'[\s\S]+?v_ticket\.assigned_operator_id is null/i,
  );
  assert.match(
    sql,
    /exists \([\s\S]+?previous_event\.event_type in \([\s\S]+?'requester_message'[\s\S]+?'operator_message'/i,
  );
  assert.match(sql, /public\.has_permission\(profile\.id, 'support\.view'\)/i);
  assert.match(sql, /coalesce\(preference\.notify_new_pool, true\)/i);
  assert.match(sql, /coalesce\(preference\.notify_urgent_only, false\)/i);
});
