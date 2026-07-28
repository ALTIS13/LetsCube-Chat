import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDir = new URL(
  "../../.migration-backup/supabase/migrations/",
  import.meta.url,
);

async function readHardeningMigration() {
  const names = await readdir(migrationDir).catch(() => []);
  const name = names.find((candidate) =>
    candidate.endsWith("_support_mail_delivery_hardening.sql"),
  );
  assert.ok(name, "missing support mail delivery hardening migration");
  return readFile(new URL(name, migrationDir), "utf8");
}

async function readIdempotentAckMigration() {
  const names = await readdir(migrationDir).catch(() => []);
  const name = names.find((candidate) =>
    candidate.endsWith("_support_mail_idempotent_delivery_ack.sql"),
  );
  assert.ok(name, "missing support mail idempotent ack migration");
  return readFile(new URL(name, migrationDir), "utf8");
}

test("closed tickets are quarantined without rolling back the inbound ledger", async () => {
  const sql = await readHardeningMigration();

  assert.match(sql, /join public\.support_tickets[\s\S]+for update of ticket/i);
  assert.match(sql, /status in \('closed', 'spam'\)/i);
  assert.match(
    sql,
    /_support_email_ingest_inbound_core\([\s\S]+?'ticket_not_writable'/i,
  );
  assert.match(sql, /v_existing_ticket_status in \('closed', 'spam'\)/i);
});

test("expired final delivery attempts are swept to dead", async () => {
  const sql = await readHardeningMigration();

  assert.match(sql, /delivery_status = 'processing'/i);
  assert.match(sql, /locked_until <= clock_timestamp\(\)/i);
  assert.match(sql, /attempt_count >= 8/i);
  assert.match(sql, /delivery_status = 'dead'/i);
  assert.match(sql, /last_error_code = 'lease_expired'/i);
});

test("support email ledger has bounded retention cleanup", async () => {
  const sql = await readHardeningMigration();

  assert.match(
    sql,
    /create or replace function public\.support_email_retention_cleanup\(/i,
  );
  assert.match(sql, /delivery_status in \('quarantined', 'dead'\)/i);
  assert.match(sql, /to service_role/i);
});

test("SMTP acknowledgement can be retried without scheduling another send", async () => {
  const sql = await readIdempotentAckMigration();

  assert.match(
    sql,
    /create or replace function public\.support_email_mark_sent\(/i,
  );
  assert.match(sql, /delivery_status = 'sent'/i);
  assert.match(sql, /provider_reference_hash\s+is not distinct from/i);
  assert.match(sql, /return exists/i);
  assert.match(sql, /to service_role/i);
});
