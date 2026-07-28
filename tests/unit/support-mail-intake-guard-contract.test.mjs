import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDir = new URL(
  "../../.migration-backup/supabase/migrations/",
  import.meta.url,
);

async function readIntakeGuardMigration() {
  const names = await readdir(migrationDir).catch(() => []);
  const name = names.find((candidate) =>
    candidate.endsWith("_support_mail_intake_guard.sql"),
  );
  assert.ok(name, "missing support mail intake guard migration");
  return readFile(new URL(name, migrationDir), "utf8");
}

test("direct email intake observes support closure and persistent limits", async () => {
  const sql = await readIntakeGuardMigration();

  assert.match(
    sql,
    /alter function public\.support_email_ingest_inbound\([\s\S]+rename to _support_email_ingest_inbound_core/i,
  );
  assert.match(
    sql,
    /create or replace function public\.support_email_ingest_inbound\(/i,
  );
  assert.match(sql, /from public\.support_settings/i);
  assert.match(sql, /not v_settings\.intake_enabled/i);
  assert.match(sql, /ticket_limit_15m/i);
  assert.match(sql, /ticket_limit_day/i);
  assert.match(sql, /from public\.support_rate_limit_signals/i);
  assert.match(sql, /scope_hash = p_sender_hash/i);
  assert.match(
    sql,
    /last_error_code[\s\S]+intake_closed|p_quarantine_code[\s\S]+intake_closed/i,
  );
  assert.match(sql, /p_quarantine_code[\s\S]+rate_limited/i);
  assert.match(sql, /insert into public\.support_rate_limit_signals/i);
});

test("email replies bypass only the new-ticket gate and core remains private", async () => {
  const sql = await readIntakeGuardMigration();

  assert.match(sql, /from public\.support_email_routes/i);
  assert.match(sql, /from public\.support_email_messages/i);
  assert.match(sql, /direction = 'outbound'/i);
  assert.match(sql, /_support_email_ingest_inbound_core\(/i);
  assert.match(
    sql,
    /revoke all on function public\._support_email_ingest_inbound_core\([\s\S]+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.support_email_ingest_inbound\([\s\S]+to service_role/i,
  );
});
