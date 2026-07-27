import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../.migration-backup/supabase/migrations/20260727_privacy_support_ticketing_foundation.sql",
  import.meta.url,
);

const requiredTables = [
  "privacy_policy_versions",
  "privacy_acceptances",
  "support_settings",
  "support_tickets",
  "support_ticket_contacts",
  "support_guest_sessions",
  "support_ticket_messages",
  "support_ticket_events",
  "support_operator_preferences",
  "support_rate_limit_signals",
  "support_email_messages",
];

const requiredPermissions = [
  "support.view",
  "support.claim",
  "support.reply",
  "support.transfer",
  "support.escalate",
  "support.lookup_customer",
  "support.manage",
  "support.settings",
];

const requiredRpcs = [
  "support_ticket_claim",
  "support_ticket_transfer",
  "support_ticket_return_to_pool",
  "support_ticket_escalate",
  "support_ticket_mark_waiting",
  "support_ticket_resolve",
  "support_ticket_close",
  "support_ticket_reopen",
  "support_ticket_lookup_customer",
  "support_settings_update",
];

async function readMigration() {
  return readFile(migrationUrl, "utf8");
}

test("support proposal creates every approved table and bounded workflow state", async () => {
  const sql = await readMigration();

  for (const table of requiredTables) {
    assert.match(
      sql,
      new RegExp(`create table if not exists public\\.${table}\\s*\\(`, "i"),
      `missing table ${table}`,
    );
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      `RLS must be enabled on ${table}`,
    );
  }

  for (const status of [
    "new",
    "in_progress",
    "waiting_user",
    "waiting_support",
    "escalated",
    "resolved",
    "closed",
    "spam",
  ]) {
    assert.match(sql, new RegExp(`'${status}'`, "i"), `missing status ${status}`);
  }

  assert.match(sql, /constraint support_tickets_status_check[\s\S]+status in \(/i);
  assert.match(
    sql,
    /public_reference text not null unique default public\._support_generate_public_reference\(\)/i,
  );
  assert.match(
    sql,
    /constraint support_tickets_public_reference_check[\s\S]+LC-/i,
  );
  for (const category of [
    "account",
    "access",
    "technical",
    "messages",
    "media",
    "tasks",
    "privacy",
    "other",
  ]) {
    assert.match(sql, new RegExp(`'${category}'`, "i"), `missing category ${category}`);
  }
  assert.match(sql, /constraint support_ticket_messages_body_length_check/i);
  assert.match(sql, /constraint support_ticket_events_payload_size_check/i);
  assert.match(sql, /constraint support_ticket_events_visibility_check/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+schema\b/i);
});

test("support proposal generates non-sequential safe public references", async () => {
  const sql = await readMigration();
  const generator =
    sql.match(
      /create or replace function public\._support_generate_public_reference[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";

  assert.ok(generator, "missing public reference generator");
  assert.match(generator, /gen_random_bytes/i);
  assert.match(generator, /LC-/i);
  assert.doesNotMatch(generator, /nextval|sequence|serial/i);
  assert.match(
    sql,
    /revoke all on function public\._support_generate_public_reference\(\)[\s\S]+from public, anon, authenticated/i,
  );
});

test("support proposal separates private contact and guest-session data", async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /create table if not exists public\.support_ticket_contacts[\s\S]+email_normalized[\s\S]+phone_e164[\s\S]+email_hash[\s\S]+phone_hash/i,
  );
  assert.match(
    sql,
    /create table if not exists public\.support_guest_sessions[\s\S]+secret_hash[\s\S]+idle_expires_at[\s\S]+absolute_expires_at[\s\S]+revoked_at/i,
  );
  assert.doesNotMatch(
    sql,
    /create table if not exists public\.support_guest_sessions[\s\S]{0,1200}\bsecret\s+text\b/i,
  );
  assert.doesNotMatch(sql, /captcha_token\s+text/i);
  assert.match(
    sql,
    /revoke all on table public\.support_ticket_contacts from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on table public\.support_guest_sessions from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on table public\.support_rate_limit_signals from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on table public\.support_email_messages from public, anon, authenticated/i,
  );
});

test("support permissions are seeded only into owner and tech_admin by default", async () => {
  const sql = await readMigration();

  for (const permission of requiredPermissions) {
    assert.match(sql, new RegExp(`'${permission.replace(".", "\\.")}'`, "i"));
  }

  assert.match(
    sql,
    /insert into public\.role_permissions[\s\S]+r\.key in \('owner', 'tech_admin'\)[\s\S]+p\.key like 'support\.%'/i,
  );
  assert.doesNotMatch(
    sql,
    /r\.key in \([^)]*(?:'admin'|'manager'|'user')[^)]*\)[\s\S]{0,500}p\.key like 'support\.%'/i,
  );
});

test("support RLS denies anonymous table access and scopes users and operators", async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /revoke all on table public\.support_tickets from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /create policy "support tickets requester select"[\s\S]+to authenticated[\s\S]+requester_user_id = \(select auth\.uid\(\)\)/i,
  );
  assert.match(
    sql,
    /create policy "support tickets operator select"[\s\S]+public\.has_permission\(\(select auth\.uid\(\)\), 'support\.view'\)/i,
  );
  assert.match(
    sql,
    /create policy "support contacts assigned operator select"[\s\S]+assigned_operator_id = \(select auth\.uid\(\)\)[\s\S]+support\.manage/i,
  );
  assert.match(
    sql,
    /create policy "support messages scoped select"[\s\S]+requester_user_id = \(select auth\.uid\(\)\)[\s\S]+support\.view/i,
  );
  assert.match(
    sql,
    /create policy "support events scoped select"[\s\S]+requester_user_id = \(select auth\.uid\(\)\)[\s\S]+visibility = 'requester'[\s\S]+support\.view/i,
  );
  assert.doesNotMatch(
    sql,
    /create policy[^;]+(?:support_ticket_contacts|support_guest_sessions)[^;]+to anon/i,
  );
});

test("support proposal exposes only atomic authenticated transition RPCs", async () => {
  const sql = await readMigration();

  for (const rpc of requiredRpcs) {
    assert.match(
      sql,
      new RegExp(`create or replace function public\\.${rpc}\\s*\\(`, "i"),
      `missing RPC ${rpc}`,
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${rpc}\\([^;]+from public, anon, authenticated`,
        "i",
      ),
      `${rpc} must revoke default execution`,
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${rpc}\\([^;]+to authenticated`,
        "i",
      ),
      `${rpc} must be authenticated-only`,
    );
  }

  assert.match(
    sql,
    /create or replace function public\.support_ticket_claim[\s\S]+for update skip locked[\s\S]+assigned_operator_id is null/i,
  );
  assert.match(
    sql,
    /create or replace function public\.support_ticket_transfer[\s\S]+support\.transfer/i,
  );
  const returnToPoolFunction =
    sql.match(
      /create or replace function public\.support_ticket_return_to_pool[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";
  assert.match(returnToPoolFunction, /p_reason text/i);
  assert.match(returnToPoolFunction, /support\.transfer/i);

  const escalateFunction =
    sql.match(
      /create or replace function public\.support_ticket_escalate[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";
  assert.match(escalateFunction, /p_reason text/i);
  assert.match(escalateFunction, /support\.escalate/i);
  assert.match(
    sql,
    /create or replace function public\.support_settings_update[\s\S]+support\.settings/i,
  );
  assert.match(
    sql,
    /create or replace function public\.support_ticket_reopen[\s\S]+requester_user_id is distinct from v_actor/i,
  );
});

test("support gateway RPCs use fixed signatures and service-role-only execution", async () => {
  const sql = await readMigration();
  const rpcSignatures = [
    {
      name: "support_guest_ticket_create",
      args:
        "text, text, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text",
      returns: "jsonb",
    },
    {
      name: "support_guest_ticket_get",
      args: "uuid, text",
      returns: "jsonb",
    },
    {
      name: "support_guest_message_create",
      args: "uuid, text, text",
      returns: "jsonb",
    },
    {
      name: "support_guest_session_revoke",
      args: "uuid, text, text",
      returns: "boolean",
    },
  ];

  for (const { name, args, returns } of rpcSignatures) {
    assert.match(
      sql,
      new RegExp(
        `create or replace function public\\.${name}\\s*\\([\\s\\S]+?\\)\\s*returns ${returns}`,
        "i",
      ),
      `missing gateway RPC ${name}`,
    );
    const escapedArgs = args
      .split(", ")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*,\\s*");
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${name}\\(\\s*${escapedArgs}\\s*\\)\\s*from public, anon, authenticated`,
        "i",
      ),
      `${name} must revoke client execution`,
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${name}\\(\\s*${escapedArgs}\\s*\\)\\s*to service_role`,
        "i",
      ),
      `${name} must be service-role-only`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(
        `grant execute on function public\\.${name}[^;]+to (?:anon|authenticated)`,
        "i",
      ),
    );
  }

  const createRpc =
    sql.match(
      /create or replace function public\.support_guest_ticket_create[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";
  for (const parameter of [
    "p_contact_name text",
    "p_email_original text",
    "p_email_normalized text",
    "p_phone_original text",
    "p_phone_e164 text",
    "p_email_hash text",
    "p_phone_hash text",
    "p_category text",
    "p_subject text",
    "p_message text",
    "p_secret_hash text",
    "p_idle_expires_at timestamptz",
    "p_absolute_expires_at timestamptz",
    "p_policy_version text",
    "p_subject_reference_hash text",
    "p_ip_hash text",
    "p_ip_prefix_hash text",
    "p_user_agent_hash text",
  ]) {
    assert.match(createRpc, new RegExp(parameter.replace(".", "\\."), "i"));
  }
  assert.match(createRpc, /pg_advisory_xact_lock/i);
  assert.match(createRpc, /ticket_limit_15m/i);
  assert.match(createRpc, /ticket_limit_day/i);
  assert.match(createRpc, /support_rate_limit_signals/i);
  assert.match(createRpc, /privacy_acceptances/i);
  assert.match(createRpc, /support_ticket_messages/i);

  const messageRpc =
    sql.match(
      /create or replace function public\.support_guest_message_create[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";
  assert.match(messageRpc, /scope_kind = 'session'/i);
  assert.match(messageRpc, /support_rate_limit_signals/i);

  const sessionTouch =
    sql.match(
      /create or replace function public\._support_guest_session_touch[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";
  assert.match(sessionTouch, /idle_expires_at/i);
  assert.match(sessionTouch, /absolute_expires_at/i);
  assert.match(sessionTouch, /revoked_at is null/i);
  assert.match(sessionTouch, /last_seen_at = clock_timestamp\(\)/i);

  const getRpc =
    sql.match(
      /create or replace function public\.support_guest_ticket_get[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";
  assert.match(getRpc, /_support_guest_session_touch/i);
});

test("guest RPC projections are bounded camelCase and exclude secrets and contacts", async () => {
  const sql = await readMigration();
  const projection =
    sql.match(
      /create or replace function public\._support_guest_ticket_projection[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";

  assert.ok(projection, "missing bounded guest projection helper");
  for (const key of [
    "publicReference",
    "authorType",
    "createdAt",
    "updatedAt",
    "messages",
  ]) {
    assert.match(projection, new RegExp(`'${key}'`, "i"));
  }
  assert.match(projection, /limit 200/i);
  assert.doesNotMatch(
    projection,
    /email_original|email_normalized|phone_e164|secret_hash|email_hash|phone_hash|ip_hash|user_agent_hash/i,
  );

  const createRpc =
    sql.match(
      /create or replace function public\.support_guest_ticket_create[\s\S]+?\$function\$;/i,
    )?.[0] ?? "";
  assert.match(createRpc, /'ticket'[\s\S]+_support_guest_ticket_projection/i);
  assert.match(createRpc, /'session'/i);
  assert.match(createRpc, /'ticketId'/i);
  assert.match(createRpc, /'idleExpiresAt'/i);
  assert.match(createRpc, /'absoluteExpiresAt'/i);
  assert.match(createRpc, /'updatedAt'/i);
  assert.doesNotMatch(createRpc, /jsonb_build_object\([^)]*'secret'/i);
});

test("support events are append-only and customer lookup is bounded and audited", async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /revoke (?:insert, update, delete|all) on table public\.support_ticket_events from authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /create policy[^;]+support_ticket_events[^;]+for (?:insert|update|delete)[^;]+to authenticated/i,
  );
  assert.match(
    sql,
    /create or replace function public\._support_append_event\(/i,
  );
  assert.match(
    sql,
    /create or replace function public\.support_ticket_lookup_customer[\s\S]+support\.lookup_customer[\s\S]+limit 20[\s\S]+_support_append_event/i,
  );
  assert.match(sql, /event_type[\s\S]+'customer_lookup'/i);
});

test("support notifications contain routing metadata but no PII or message body", async () => {
  const sql = await readMigration();
  const notificationFunction =
    sql.match(
      /create or replace function public\._support_notify[\s\S]+?\$\$;/i,
    )?.[0] ?? "";

  assert.ok(notificationFunction, "missing support notification helper");
  assert.match(notificationFunction, /public\._notify\(/i);
  assert.match(notificationFunction, /ticket_id/i);
  assert.match(notificationFunction, /route/i);
  assert.match(notificationFunction, /support_event/i);
  assert.doesNotMatch(
    notificationFunction,
    /\b(email|phone|contact_name|message_body|body|secret_hash)\b/i,
  );
  assert.match(
    sql,
    /create trigger trg_support_ticket_notifications[\s\S]+execute function public\._support_notify_after_event\(\)/i,
  );
});

test("support proposal adds operational indexes, retention helpers and realtime safely", async () => {
  const sql = await readMigration();

  for (const indexName of [
    "support_tickets_pool_idx",
    "support_tickets_assignee_activity_idx",
    "support_tickets_requester_activity_idx",
    "support_guest_sessions_expiry_idx",
    "support_ticket_messages_ticket_created_idx",
    "support_ticket_events_ticket_created_idx",
    "support_rate_limit_signals_scope_created_idx",
  ]) {
    assert.match(sql, new RegExp(`create index if not exists ${indexName}`, "i"));
  }

  assert.match(
    sql,
    /create or replace function public\.support_retention_candidates\(/i,
  );
  assert.match(sql, /interval '3 years'/i);
  assert.match(sql, /interval '90 days'/i);
  assert.match(
    sql,
    /if exists \(\s*select 1 from pg_publication where pubname = 'supabase_realtime'\s*\)/i,
  );
  for (const table of [
    "support_tickets",
    "support_ticket_messages",
    "support_ticket_events",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `alter publication supabase_realtime add table public\\.${table}`,
        "i",
      ),
    );
  }
});
