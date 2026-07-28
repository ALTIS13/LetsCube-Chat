import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDir = new URL(
  "../../.migration-backup/supabase/migrations/",
  import.meta.url,
);

async function readSupportMailMigration() {
  const names = await readdir(migrationDir).catch(() => []);
  const name = names.find((candidate) =>
    candidate.endsWith("_support_mail_bridge.sql"),
  );
  assert.ok(name, "missing support mail bridge migration");
  return readFile(new URL(name, migrationDir), "utf8");
}

test("support mail migration permits email-only contacts without weakening web intake", async () => {
  const sql = await readSupportMailMigration();

  for (const column of ["phone_original", "phone_e164", "phone_hash"]) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.support_ticket_contacts[\\s\\S]+alter column ${column} drop not null`,
        "i",
      ),
    );
  }
  assert.match(sql, /support_ticket_contacts_phone_bundle_check/i);
  assert.match(
    sql,
    /phone_original is null[\s\S]+phone_e164 is null[\s\S]+phone_hash is null/i,
  );
  assert.match(sql, /phone_e164 ~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'/i);
  assert.doesNotMatch(
    sql,
    /create or replace function public\.support_guest_ticket_create[\s\S]+p_phone_e164[^;]+is null/i,
  );
});

test("support mail ledger has bounded dedupe, retry and lease metadata", async () => {
  const sql = await readSupportMailMigration();

  for (const column of [
    "ticket_message_id",
    "in_reply_to_hash",
    "attempt_count",
    "next_attempt_at",
    "last_attempt_at",
    "locked_by",
    "locked_until",
    "last_error_code",
    "updated_at",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.support_email_messages[\\s\\S]+add column if not exists ${column}`,
        "i",
      ),
    );
  }

  assert.match(sql, /support_email_messages_outbound_message_uidx/i);
  assert.match(sql, /support_email_messages_queue_idx/i);
  assert.match(
    sql,
    /delivery_status in \([\s\S]*'processing'[\s\S]*'retry'[\s\S]*'dead'/i,
  );
  assert.match(sql, /for update skip locked/i);
});

test("support mail routes and RPCs remain server-only", async () => {
  const sql = await readSupportMailMigration();

  assert.match(sql, /create table if not exists public\.support_email_routes/i);
  assert.match(sql, /route_token_hash text not null unique/i);
  assert.match(
    sql,
    /revoke all on table public\.support_email_routes\s+from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /grant select, insert, update, delete on table public\.support_email_routes\s+to service_role/i,
  );

  for (const rpc of [
    "support_email_route_register",
    "support_email_ingest_inbound",
    "support_email_claim_outbound",
    "support_email_mark_sent",
    "support_email_mark_retry",
  ]) {
    assert.match(
      sql,
      new RegExp(`create or replace function public\\.${rpc}\\(`, "i"),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${rpc}\\([\\s\\S]+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${rpc}\\([\\s\\S]+to service_role`,
        "i",
      ),
    );
  }
});

test("operator replies use an authenticated atomic RPC and enqueue outbound email once", async () => {
  const sql = await readSupportMailMigration();

  assert.match(
    sql,
    /create or replace function public\.support_operator_message_create\(\s*p_ticket_id uuid,\s*p_body text\s*\)/i,
  );
  assert.match(sql, /public\._support_require_permission\('support\.reply'\)/i);
  assert.match(sql, /public\._support_actor_controls_ticket\(/i);
  assert.match(sql, /insert into public\.support_ticket_messages/i);
  assert.match(
    sql,
    /grant execute on function public\.support_operator_message_create\(uuid, text\)\s+to authenticated/i,
  );

  assert.match(
    sql,
    /create or replace function public\._support_email_enqueue_after_message\(\)/i,
  );
  assert.match(
    sql,
    /(?:new\.author_kind = 'operator'|new\.author_kind <> 'operator')/i,
  );
  assert.match(
    sql,
    /on conflict \(ticket_message_id\)\s+where ticket_message_id is not null\s+do nothing/i,
  );
});

test("inbound email routing verifies sender ownership before appending to a ticket", async () => {
  const sql = await readSupportMailMigration();

  assert.match(sql, /support_email_ingest_inbound/i);
  assert.match(sql, /route_token_hash/i);
  assert.match(sql, /in_reply_to_hash/i);
  assert.match(sql, /contact\.email_hash = p_sender_hash/i);
  assert.match(sql, /delivery_status = 'quarantined'/i);
  assert.match(sql, /author_kind[\s\S]+requester/i);
  assert.match(sql, /source[\s\S]+email/i);
  assert.doesNotMatch(sql, /requester_user_id[\s\S]{0,160}=.*email/i);
});
