import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  ".migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql";
const sql = readFileSync(migrationPath, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ").toLowerCase();
const driftCheck = readFileSync("scripts/check-database-type-drift.mjs", "utf8");
const bindingSpec = readFileSync(
  "docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md",
  "utf8",
);
const dbSmoke = readFileSync("tests/server/bot-platform-db-smoke.sql", "utf8");
const concurrencyProbe = readFileSync(
  "tests/server/bot-platform-db-concurrency-probe.sql",
  "utf8",
);

const publicTables = ["bots", "bot_owners", "bot_commands", "chat_bot_members"];
const privateTables = [
  "bot_tokens",
  "bot_updates",
  "bot_webhooks",
  "bot_delivery_attempts",
  "bot_audit_events",
  "bot_rate_limit_buckets",
  "bot_upload_grants",
  "bot_operation_idempotency",
  "bot_callback_answers",
];
const serviceRoleFunctions = [
  ["bot_create_internal", "uuid,text,text,text,text,text,text"],
  ["bot_list_owned_internal", "uuid"],
  ["bot_creation_eligibility_internal", "uuid"],
  ["bot_management_detail_internal", "uuid,uuid"],
  ["bot_management_diagnostics_internal", "uuid,uuid"],
  ["bot_update_profile_internal", "uuid,uuid,text,text,text"],
  ["bot_management_commands_replace_internal", "uuid,uuid,jsonb,text"],
  ["bot_pause_internal", "uuid,uuid,text"],
  ["bot_resume_internal", "uuid,uuid,text"],
  ["bot_developer_add_internal", "uuid,uuid,text,text"],
  ["bot_developer_remove_internal", "uuid,uuid,uuid,text"],
  ["bot_rotate_token_internal", "uuid,uuid,text,text,text,text"],
  ["bot_revoke_token_internal", "uuid,uuid,text"],
  ["bot_request_deletion_internal", "uuid,uuid,text"],
  ["bot_cancel_deletion_internal", "uuid,uuid,text"],
  ["bot_deletion_finalize_internal", "integer,text"],
  ["bot_privacy_request_internal", "uuid,uuid,uuid,boolean,text"],
  ["bot_management_webhook_set_internal", "uuid,uuid,text,text,text,boolean,text"],
  ["bot_management_webhook_delete_internal", "uuid,uuid,boolean,text"],
  ["bot_admin_list_internal", "uuid"],
  ["bot_suspend_internal", "uuid,uuid,boolean,text"],
  ["bot_token_lookup_internal", "text"],
  ["bot_token_touch_internal", "uuid,timestamptz"],
  ["bot_membership_authorize_internal", "uuid,uuid,text"],
  ["bot_upload_authorize_internal", "uuid,uuid,text,text,text,bigint,integer"],
  ["bot_send_message_internal", "uuid,uuid,text,jsonb,text"],
  ["bot_media_command_preflight_internal", "uuid,uuid,text,text,text"],
  ["bot_get_me_internal", "uuid"],
  ["bot_message_command_internal", "uuid,uuid,text,jsonb,text,text"],
  ["bot_commands_replace_internal", "uuid,jsonb,text,text"],
  ["bot_commands_list_internal", "uuid"],
  ["bot_file_lookup_internal", "uuid,uuid,uuid"],
  ["bot_callback_answer_internal", "uuid,uuid,text,boolean,text,text"],
  ["bot_updates_poll_internal", "uuid,bigint,integer,text[],uuid"],
  ["bot_updates_poll_release_internal", "uuid,uuid"],
  ["bot_updates_ack_internal", "uuid,bigint"],
  ["bot_webhook_set_internal", "uuid,text,text,text,boolean,text,text"],
  ["bot_webhook_delete_internal", "uuid,boolean,text,text"],
  ["bot_webhook_info_internal", "uuid"],
  ["bot_update_enqueue_internal", "uuid,text,uuid,jsonb"],
  ["bot_delivery_claim_internal", "integer,uuid"],
  ["bot_delivery_prepare_internal", "bigint,uuid,bigint"],
  ["bot_delivery_finish_internal", "bigint,uuid,text,text,integer"],
  ["bot_delivery_cleanup_internal", "timestamptz,integer"],
];

function functionBody(name) {
  const start = normalizedSql.indexOf(
    `create or replace function public.${name}(`,
  );
  const end = normalizedSql.indexOf("$function$;", start);
  assert.ok(start >= 0 && end > start, `${name} body must exist`);
  return normalizedSql.slice(start, end);
}

test("bot identities remain separate from auth users and use archive-only lifecycle", () => {
  assert.match(normalizedSql, /create table public\.bots/);
  assert.doesNotMatch(normalizedSql, /insert into auth\.users/);
  assert.match(
    normalizedSql,
    /state text not null default 'active' check \(state in \('active','paused','suspended','pending_delete','deleted'\)\)/,
  );
  assert.match(normalizedSql, /create table public\.bot_owners/);
  assert.match(normalizedSql, /create table public\.bot_commands/);
  assert.match(normalizedSql, /create table public\.chat_bot_members/);
});

test("public bot tables are RLS protected and direct writes stay revoked", () => {
  for (const table of publicTables) {
    assert.match(normalizedSql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(
      normalizedSql,
      new RegExp(
        `revoke all on table public\\.${table} from public, anon, authenticated, service_role`,
      ),
    );
  }
  assert.match(normalizedSql, /grant select on table public\.bots to authenticated/);
  assert.match(normalizedSql, /grant select on table public\.bot_owners to authenticated/);
  assert.match(normalizedSql, /grant select on table public\.chat_bot_members to authenticated/);
  assert.doesNotMatch(normalizedSql, /grant (insert|update|delete).*public\.bots.*authenticated/);
});

test("token, webhook, update and delivery data stay private", () => {
  assert.match(normalizedSql, /create schema if not exists private/);
  assert.match(
    normalizedSql,
    /revoke all on schema private from public, anon, authenticated, service_role/,
  );
  for (const table of privateTables) {
    assert.match(normalizedSql, new RegExp(`create table private\\.${table}`));
    assert.match(
      normalizedSql,
      new RegExp(`revoke all on table private\\.${table}[^;]*from public, anon, authenticated, service_role`),
    );
  }
  assert.match(normalizedSql, /check \(pg_catalog\.octet_length\(payload::text\) <= 65536\)/);
  assert.match(normalizedSql, /expires_at timestamptz not null default \(pg_catalog\.now\(\) \+ interval '24 hours'\)/);
  assert.match(normalizedSql, /check \(payload is null\)/);
  assert.match(normalizedSql, /secret_ciphertext text not null/);
  assert.match(normalizedSql, /secret_fingerprint text not null/);
  assert.doesNotMatch(
    normalizedSql,
    /create table private\.bot_webhooks[\s\S]*?secret_hash text/,
  );
  assert.doesNotMatch(normalizedSql, /grant select on (table )?private\./);
  assert.match(normalizedSql, /bot_update_history_forbidden/);
});

test("creation and token rotation serialize and enforce one active token", () => {
  assert.match(
    normalizedSql,
    /create unique index bot_tokens_one_active_per_bot_idx on private\.bot_tokens\(bot_id\) where revoked_at is null/,
  );
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_create_internal\([\s\S]*from public\.profiles actor_profile[\s\S]*for update of actor_profile/,
  );
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_rotate_token_internal\([\s\S]*from public\.bots bot[\s\S]*for update of bot/,
  );
});

test("due deletion finalization locks and rechecks each bot before disabling access", () => {
  const body = functionBody("bot_deletion_finalize_internal");
  assert.match(body, /p_limit is null/);
  assert.match(body, /for update of bot skip locked/);
  assert.match(body, /select bot\.\* into v_bot[\s\S]*for update of bot/);
  assert.match(body, /v_bot\.state <> 'pending_delete'/);
  assert.match(body, /v_bot\.delete_after is null[\s\S]*v_bot\.delete_after > pg_catalog\.now\(\)/);
  assert.match(body, /set state = 'deleted'/);
  assert.match(body, /update private\.bot_tokens[\s\S]*set revoked_at = coalesce/);
  assert.match(body, /update private\.bot_webhooks[\s\S]*set state = 'disabled'/);
  assert.match(body, /update private\.bot_delivery_attempts[\s\S]*status = 'dead_letter'/);
  assert.match(body, /delete from private\.bot_delivery_leases/);
  assert.match(body, /'bot_deleted'/);
  assert.doesNotMatch(body, /delete from public\.(messages|bots)/);
});

test("management permission is dedicated and seeded only to critical system roles", () => {
  assert.match(
    normalizedSql,
    /insert into public\.permissions \(key, name, description, category\)[\s\S]*'bots\.suspend'/,
  );
  assert.match(
    normalizedSql,
    /join public\.roles role_row[\s\S]*role_row\.key in \('owner','tech_admin'\)[\s\S]*'bots\.suspend'/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /\('admin',\s*'bots\.suspend'\)|\('manager',\s*'bots\.suspend'\)|\('user',\s*'bots\.suspend'\)/,
  );
});

test("management eligibility is current-user-only and exposes each actionable prerequisite", () => {
  const body = functionBody("bot_creation_eligibility_internal");
  assert.match(body, /p_actor_id is not null/);
  assert.match(body, /email_confirmed_at is not null/);
  assert.match(body, /contact\.phone_verified is true/);
  assert.match(body, /interval '24 hours'/);
  assert.match(body, /from public\.bans ban/);
  assert.match(body, /active_bot_count/);
  assert.match(body, /max_bots/);
  assert.match(body, /can_create/);
});

test("every management mutation locks the bot before closed role and state checks", () => {
  const ownerOnly = [
    "bot_update_profile_internal",
    "bot_pause_internal",
    "bot_resume_internal",
    "bot_developer_add_internal",
    "bot_developer_remove_internal",
    "bot_rotate_token_internal",
    "bot_revoke_token_internal",
    "bot_request_deletion_internal",
    "bot_cancel_deletion_internal",
  ];
  const ownerOrDeveloper = [
    "bot_management_commands_replace_internal",
    "bot_privacy_request_internal",
    "bot_management_webhook_set_internal",
    "bot_management_webhook_delete_internal",
  ];
  for (const name of ownerOnly) {
    const body = functionBody(name);
    assert.match(body, /for update of bot/, `${name} must lock the bot row`);
    assert.match(body, /owner_row\.role = 'owner'/, `${name} must require owner`);
    assert.match(body, /insert into private\.bot_audit_events/, `${name} must audit`);
    assert.match(body, /'actor_id'/, `${name} audit must include actor`);
    assert.match(body, /'request_id'/, `${name} audit must include request id`);
    assert.match(body, /'result', 'success'/, `${name} audit must include result`);
  }
  for (const name of ownerOrDeveloper) {
    const body = functionBody(name);
    assert.match(body, /for update of bot/, `${name} must lock the bot row`);
    assert.match(
      body,
      /owner_row\.role in \('owner','developer'\)/,
      `${name} must use the closed developer allowlist`,
    );
  }
});

test("owner lifecycle cannot override suspension or pending deletion", () => {
  assert.match(functionBody("bot_pause_internal"), /v_bot\.state <> 'active'/);
  assert.match(functionBody("bot_resume_internal"), /v_bot\.state <> 'paused'/);
  assert.match(
    functionBody("bot_resume_internal"),
    /from private\.bot_tokens[\s\S]*revoked_at is null/,
  );
  assert.match(
    functionBody("bot_request_deletion_internal"),
    /state = 'pending_delete'[\s\S]*delete_after = pg_catalog\.now\(\) \+ interval '7 days'/,
  );
  assert.match(
    functionBody("bot_request_deletion_internal"),
    /update private\.bot_tokens[\s\S]*revoked_at = pg_catalog\.now\(\)/,
  );
  assert.match(
    functionBody("bot_cancel_deletion_internal"),
    /v_bot\.state <> 'pending_delete'[\s\S]*v_bot\.delete_after <= pg_catalog\.now\(\)[\s\S]*state = 'paused'/,
  );
  assert.doesNotMatch(functionBody("bot_cancel_deletion_internal"), /insert into private\.bot_tokens/);
});

test("rotation has a stale-prefix precondition and raw token material never enters SQL", () => {
  const body = functionBody("bot_rotate_token_internal");
  assert.match(body, /p_expected_token_prefix text/);
  assert.match(body, /is distinct from p_expected_token_prefix/);
  assert.match(body, /bot_token_precondition_failed/);
  assert.doesNotMatch(normalizedSql, /p_raw_token|raw_token text/);
});

test("detail and admin projections are structurally safe", () => {
  const detail = functionBody("bot_management_detail_internal");
  assert.match(detail, /token_prefix/);
  assert.match(detail, /commands/);
  assert.match(detail, /developers/);
  assert.match(detail, /privacy/);
  assert.match(detail, /pending_update_count/);
  assert.doesNotMatch(detail, /token_hash|secret_ciphertext|secret_fingerprint|payload/);

  const admin = functionBody("bot_admin_list_internal");
  assert.match(admin, /public\.has_permission\(p_actor_id, 'bots\.suspend'\)/);
  assert.doesNotMatch(admin, /private\.bot_tokens|private\.bot_webhooks|payload/);

  const suspension = functionBody("bot_suspend_internal");
  assert.match(suspension, /public\.has_permission\(p_actor_id, 'bots\.suspend'\)/);
  assert.match(suspension, /for update of bot/);
  assert.match(suspension, /p_suspend[\s\S]*state = 'suspended'/);
  assert.match(suspension, /not p_suspend[\s\S]*state = 'paused'/);
});

test("per-chat privacy requests never create a global visibility switch", () => {
  const body = functionBody("bot_privacy_request_internal");
  assert.match(body, /p_chat_id uuid/);
  assert.match(body, /from public\.chat_bot_members bot_member/);
  assert.match(body, /bot_member\.removed_at is null/);
  assert.match(body, /full_visibility_requested_at/);
  assert.doesNotMatch(normalizedSql, /global_full_visibility|global_privacy_mode/);
});

test("management audit metadata allowlist contains no secret-bearing values", () => {
  assert.match(normalizedSql, /action in \([^)]+bot_created[^)]+bot_suspended[^)]+\)/);
  assert.doesNotMatch(
    normalizedSql,
    /insert into private\.bot_audit_events[^;]*?(token_hash|raw_token|secret_ciphertext|secret_fingerprint|target_url|payload)/,
  );
});

test("bot uploads require a private scoped grant and never storage RLS", () => {
  assert.match(normalizedSql, /create table private\.bot_upload_grants/);
  assert.match(normalizedSql, /bot_id uuid not null references public\.bots\(id\) on delete restrict/);
  assert.match(normalizedSql, /chat_id uuid not null references public\.chats\(id\) on delete cascade/);
  assert.match(normalizedSql, /bucket_id text not null/);
  assert.match(normalizedSql, /object_path text not null/);
  assert.match(normalizedSql, /consumed_message_id uuid null references public\.messages\(id\) on delete restrict/);
  assert.match(normalizedSql, /create or replace function public\.bot_upload_authorize_internal\(/);
  assert.match(
    normalizedSql,
    /from private\.bot_upload_grants upload_grant[\s\S]*for update of upload_grant/,
  );
  assert.match(normalizedSql, /from storage\.objects stored_object/);
  assert.match(normalizedSql, /p_bucket_id is null/);
  assert.match(normalizedSql, /p_object_path is null/);
  assert.match(normalizedSql, /p_content_type is null/);
  assert.match(normalizedSql, /p_byte_size is null/);
  assert.match(normalizedSql, /p_expires_in_seconds is null/);
  assert.match(
    normalizedSql,
    /delete from private\.bot_upload_grants stale_grant[\s\S]*stale_grant\.expires_at <= pg_catalog\.now\(\)/,
  );
  assert.match(normalizedSql, /bot_upload_grant_attribute_conflict/);
  assert.match(
    normalizedSql,
    /v_grant\.content_type = p_content_type[\s\S]*v_grant\.byte_size = p_byte_size[\s\S]*v_grant\.expires_at - v_grant\.created_at = pg_catalog\.make_interval/,
  );
  assert.match(normalizedSql, /'upload_grants_deleted', v_upload_grants/);
  assert.doesNotMatch(
    sql,
    /^\s*grant\b[^;\r\n]*\bstorage\.objects\b[^;\r\n]*\b(bot|anon|authenticated)\b/im,
  );
});

test("updates use authoritative safe projections and real triggers", () => {
  assert.match(
    normalizedSql,
    /create or replace function private\.bot_message_update_payload\( p_bot_id uuid, p_message_id uuid \)/,
  );
  assert.match(normalizedSql, /from public\.messages message_row/);
  assert.match(normalizedSql, /from public\.profiles profile/);
  assert.match(normalizedSql, /public\.bots sender_bot/);
  assert.match(normalizedSql, /bot_update_context_invalid/);
  assert.match(normalizedSql, /bot_update_not_eligible/);
  assert.match(
    normalizedSql,
    /create trigger trg_enqueue_bot_message_updates_after_insert after insert on public\.messages/,
  );
  assert.match(
    normalizedSql,
    /create trigger trg_enqueue_bot_message_updates_after_update after update of content, media_bucket, media_path, media_metadata, topic_id, reply_to_id, bot_reply_markup on public\.messages/,
  );
  assert.match(
    normalizedSql,
    /create or replace function private\.enqueue_bot_message_updates_after_update\(\)[\s\S]*row\(\s*old\.content, old\.media_bucket, old\.media_path, old\.media_metadata, old\.topic_id, old\.reply_to_id, old\.bot_reply_markup \) is not distinct from row\( new\.content, new\.media_bucket, new\.media_path, new\.media_metadata, new\.topic_id, new\.reply_to_id, new\.bot_reply_markup \)/,
  );
  assert.match(
    normalizedSql,
    /create trigger trg_enqueue_bot_membership_updates after insert or update of privacy_mode, removed_at on public\.chat_bot_members/,
  );
  assert.match(
    normalizedSql,
    /old\.removed_at is not null and new\.removed_at is null[\s\S]*v_action := 'added'/,
  );
  assert.match(
    normalizedSql,
    /from public\.bots bot where bot\.id = new\.bot_id and bot\.state = 'active'/,
  );
  assert.match(normalizedSql, /restricted_command_or_mention_required/);
  assert.doesNotMatch(
    normalizedSql,
    /insert into private\.bot_updates\([^;]*payload\)[^;]*p_context/,
  );
});

test("message projection caps every variable-width scalar below the queue limit", () => {
  const caps = [
    ["type", /'type', nullif\(pg_catalog\.left\(message_row\.type, 32\), ''\)/],
    ["text", /pg_catalog\.left\(message_row\.content, 4096\)/],
    [
      "display_name",
      /'display_name', nullif\(pg_catalog\.left\(\s*coalesce\(profile\.full_name, sender_bot\.display_name\), 128\s*\), ''\)/,
    ],
    [
      "username",
      /'username', nullif\(pg_catalog\.left\(\s*coalesce\(profile\.username, sender_bot\.username\), 64\s*\), ''\)/,
    ],
    ["chat_type", /'type', nullif\(pg_catalog\.left\(chat\.type, 32\), ''\)/],
    ["chat_name", /'name', nullif\(pg_catalog\.left\(chat\.name, 256\), ''\)/],
    ["kind", /'kind', nullif\(pg_catalog\.left\(message_row\.type, 32\), ''\)/],
    [
      "mime_type",
      /'mime_type', nullif\(pg_catalog\.left\(\s*message_row\.media_metadata->>'mime_type', 128\s*\), ''\)/,
    ],
    [
      "file_name",
      /'file_name', nullif\(pg_catalog\.left\(\s*message_row\.media_metadata->>'file_name', 255\s*\), ''\)/,
    ],
    [
      "byte_size",
      /'byte_size', nullif\(pg_catalog\.left\(\s*message_row\.media_metadata->>'size', 32\s*\), ''\)/,
    ],
    ["width", /'width', nullif\(pg_catalog\.left\(\s*message_row\.media_metadata->>'width', 16\s*\), ''\)/],
    ["height", /'height', nullif\(pg_catalog\.left\(\s*message_row\.media_metadata->>'height', 16\s*\), ''\)/],
    [
      "duration",
      /'duration', nullif\(pg_catalog\.left\(\s*message_row\.media_metadata->>'duration', 32\s*\), ''\)/,
    ],
  ];
  for (const [field, pattern] of caps) {
    assert.match(normalizedSql, pattern, `${field} projection must be bounded`);
  }
  assert.match(bindingSpec, /bot message projection caps/i);
  assert.match(bindingSpec, /64 kib/i);
});

test("bot inline keyboards are durable, closed, bounded and edit-visible", () => {
  assert.match(
    normalizedSql,
    /add column if not exists bot_reply_markup jsonb null/,
  );
  assert.match(
    normalizedSql,
    /create or replace function private\.bot_inline_keyboard_valid\(p_markup jsonb\)/,
  );
  assert.match(normalizedSql, /pg_catalog\.octet_length\(p_markup::text\) > 16384/);
  assert.match(normalizedSql, /pg_catalog\.jsonb_array_length\(p_markup->'inline_keyboard'\) not between 1 and 8/);
  assert.match(normalizedSql, /pg_catalog\.length\(v_button->>'text'\) not between 1 and 64/);
  assert.match(normalizedSql, /pg_catalog\.length\(v_button->>'callback_data'\) not between 1 and 128/);
  assert.doesNotMatch(
    normalizedSql,
    /constraint messages_bot_reply_markup_check check \(private\.bot_inline_keyboard_valid/,
  );
  assert.match(
    normalizedSql,
    /constraint messages_bot_reply_markup_check check \( bot_reply_markup is null or \( bot_id is not null[\s\S]*pg_catalog\.jsonb_typeof\(bot_reply_markup\) = 'object'[\s\S]*pg_catalog\.octet_length\(bot_reply_markup::text\) <= 16384/,
  );
  assert.match(
    normalizedSql,
    /create trigger trg_validate_bot_reply_markup before insert or update of bot_id, bot_reply_markup on public\.messages/,
  );
  assert.match(
    normalizedSql,
    /create or replace function private\.validate_bot_reply_markup\(\)[\s\S]*security definer[\s\S]*private\.bot_inline_keyboard_valid\(new\.bot_reply_markup\)/,
  );
  assert.match(normalizedSql, /'reply_markup', message_row\.bot_reply_markup/);
  assert.match(
    normalizedSql,
    /after update of content, media_bucket, media_path, media_metadata, topic_id, reply_to_id, bot_reply_markup on public\.messages/,
  );
});

test("all core mutations use a private input-bound idempotency ledger", () => {
  assert.match(normalizedSql, /create table private\.bot_operation_idempotency/);
  assert.match(normalizedSql, /request_fingerprint text not null check \(request_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(normalizedSql, /check \(pg_catalog\.octet_length\(result::text\) <= 32782\)/);
  assert.match(
    normalizedSql,
    /method in \( 'sendmessage','sendphoto','sendvideo','senddocument','sendvoice',[\s\S]*'sendchataction','editmessagetext','deletemessage'/,
  );
  assert.match(normalizedSql, /create index bot_operation_idempotency_retention_idx/);
  assert.match(normalizedSql, /bot_operation_idempotency_conflict/);
  assert.match(normalizedSql, /'operation_idempotency_deleted', v_operation_idempotency/);
});

test("core RPCs enforce identity, commands, file and callback boundaries", () => {
  assert.match(normalizedSql, /create or replace function public\.bot_get_me_internal\(/);
  assert.match(normalizedSql, /create or replace function public\.bot_message_command_internal\(/);
  assert.match(normalizedSql, /message_row\.bot_id = p_bot_id/);
  assert.match(normalizedSql, /message_row\.deleted_at is null/);
  assert.match(normalizedSql, /set deleted_at = pg_catalog\.now\(\)/);
  assert.match(normalizedSql, /set content = v_text,[\s\S]*bot_reply_markup = v_reply_markup,[\s\S]*edited_at = pg_catalog\.now\(\)/);
  assert.match(normalizedSql, /create or replace function public\.bot_commands_replace_internal\(/);
  assert.match(normalizedSql, /with ordinality/);
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_commands_replace_internal\([\s\S]*select bot\.id[\s\S]*from public\.bots bot[\s\S]*for update/,
  );
  assert.match(normalizedSql, /create or replace function public\.bot_file_lookup_internal\(/);
  assert.match(normalizedSql, /private\.bot_can_receive_message\(p_bot_id, message_row\.id\)/);
  assert.match(normalizedSql, /message_row\.chat_id = p_chat_id/);
  assert.match(normalizedSql, /message_row\.media_bucket is not null/);
  assert.match(normalizedSql, /create table private\.bot_callback_answers/);
  assert.match(
    normalizedSql,
    /source_update_id bigint null references private\.bot_updates\(id\) on delete set null/,
  );
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_callback_answer_internal\([\s\S]*private\.bot_operation_idempotency_lookup\([\s\S]*select queued\.id/,
  );
  assert.match(normalizedSql, /queued\.update_type = 'callback_query'/);
  assert.match(normalizedSql, /queued\.expires_at > pg_catalog\.now\(\)/);
  assert.match(normalizedSql, /queued\.created_at >= pg_catalog\.now\(\) - interval '10 minutes'/);
});

test("message command RPC independently enforces method-specific send payloads", () => {
  assert.match(normalizedSql, /p_method = 'sendmessage'[\s\S]*payload_key not in \('text','topic_id','reply_to_id','reply_markup'\)/);
  assert.match(normalizedSql, /p_method = 'sendphoto'[\s\S]*image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp[\s\S]*image\/gif/);
  assert.match(normalizedSql, /p_method = 'sendvideo'[\s\S]*video\/mp4[\s\S]*video\/webm/);
  assert.match(normalizedSql, /p_method = 'senddocument'[\s\S]*application\/pdf/);
  assert.match(normalizedSql, /p_method = 'sendvoice'[\s\S]*audio\/webm[\s\S]*audio\/ogg[\s\S]*audio\/mpeg/);
  assert.match(normalizedSql, /p_payload->'media_metadata'->>'kind' <> v_expected_media_kind/);
  assert.match(
    normalizedSql,
    /private\.bot_operation_idempotency_lookup\( p_bot_id, p_idempotency_key, p_method, p_request_fingerprint \)[\s\S]*public\.bot_send_message_internal/,
  );
  assert.match(
    normalizedSql,
    /public\.bot_send_message_internal\([\s\S]*private\.bot_operation_idempotency_store\( p_bot_id, p_idempotency_key, p_method, p_request_fingerprint, v_result \)/,
  );
});

test("media preflight validates active membership and resolves completed idempotency read-only", () => {
  const start = normalizedSql.indexOf(
    "create or replace function public.bot_media_command_preflight_internal(",
  );
  const end = normalizedSql.indexOf("$function$;", start);
  assert.ok(start >= 0 && end > start, "media preflight function must exist");
  const body = normalizedSql.slice(start, end);

  assert.match(
    body,
    /p_method not in \( 'sendphoto','sendvideo','senddocument','sendvoice' \)/,
  );
  const activeBot = body.indexOf("from public.bots bot");
  const membership = body.indexOf("public.bot_membership_authorize_internal(");
  const lookup = body.indexOf("private.bot_operation_idempotency_lookup(");
  assert.ok(activeBot >= 0 && activeBot < membership);
  assert.ok(membership >= 0 && membership < lookup);
  assert.doesNotMatch(body, /(insert into|update|delete from) private\.bot_upload_grants/);
  assert.match(body, /'result', v_existing->'result', 'duplicate', true/);
  assert.match(body, /'result', null, 'duplicate', false/);
});

test("automatic message fanout isolates every bot while direct RPC remains strict", () => {
  for (const functionName of [
    "enqueue_bot_message_updates_after_insert",
    "enqueue_bot_message_updates_after_update",
  ]) {
    const start = normalizedSql.indexOf(`create or replace function private.${functionName}()`);
    const end = normalizedSql.indexOf("$function$;", start);
    assert.ok(start >= 0 && end > start, `${functionName} body must exist`);
    const body = normalizedSql.slice(start, end);
    assert.match(body, /loop begin if private\.bot_can_receive_message\(v_bot_id, new\.id\) is true then/);
    assert.match(body, /exception when others then null; end; end loop/);
    assert.doesNotMatch(body, /raise (notice|warning|log)/);
  }
  assert.match(normalizedSql, /raise exception 'bot_update_not_eligible'/);
});

test("removed membership privacy changes persist without lifecycle delivery", () => {
  assert.match(
    normalizedSql,
    /elsif old\.removed_at is not null and new\.removed_at is not null then return null; elsif new\.privacy_mode is distinct from old\.privacy_mode then/,
  );
  const start = normalizedSql.indexOf(
    "create or replace function private.enqueue_bot_membership_update()",
  );
  const end = normalizedSql.indexOf("$function$;", start);
  const body = normalizedSql.slice(start, end);
  assert.match(
    body,
    /begin perform public\.bot_update_enqueue_internal[\s\S]*exception when others then null; end/,
  );
});

test("stale delivery claims are recovered atomically and boundedly", () => {
  assert.match(normalizedSql, /attempt\.status = 'claimed'/);
  assert.match(normalizedSql, /attempt\.claimed_at <= pg_catalog\.now\(\) - interval '2 minutes'/);
  assert.match(normalizedSql, /status = case when attempt\.attempt_count >= 12 then 'dead_letter' else 'retry' end/);
  assert.match(normalizedSql, /for update of attempt skip locked/);
  assert.match(normalizedSql, /limit least\(p_limit, 100\)/);
});

test("polling filters eligible updates before limit and releases only the owning lease", () => {
  assert.match(normalizedSql, /p_allowed_updates text\[\]/);
  assert.match(normalizedSql, /queued\.update_type = any\(p_allowed_updates\)/);
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_updates_poll_release_internal\( p_bot_id uuid, p_timeout_marker uuid \)/,
  );
  assert.match(normalizedSql, /lease\.lease_token = p_timeout_marker/);
});

test("webhook mutations bind claims to an epoch and prepare before dispatch", () => {
  assert.match(normalizedSql, /webhook_epoch bigint not null default 1/);
  assert.match(normalizedSql, /status in \('pending','claimed','dispatching','retry','succeeded','dead_letter'\)/);
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_delivery_prepare_internal\(/,
  );
  assert.match(normalizedSql, /attempt\.status = 'dispatching'/);
  assert.match(normalizedSql, /attempt\.webhook_epoch = p_webhook_epoch/);
  assert.match(normalizedSql, /bot_delivery_in_flight/);
});

test("claim selection excludes every later active update for the same bot", () => {
  assert.match(
    normalizedSql,
    /earlier\.bot_id = attempt\.bot_id[\s\S]*earlier\.update_id < attempt\.update_id[\s\S]*earlier\.status in \('pending','claimed','dispatching','retry'\)/,
  );
  assert.match(normalizedSql, /for update of attempt skip locked/);
});

test("webhook mutation drop and finish metadata are transactional and bounded", () => {
  assert.match(normalizedSql, /p_drop_pending_updates boolean/);
  assert.match(normalizedSql, /delete from private\.bot_updates queued[\s\S]*queued\.acknowledged_at is null/);
  assert.match(normalizedSql, /p_http_status integer/);
  assert.match(normalizedSql, /http_status = p_http_status/);
  assert.match(normalizedSql, /interval '14 days'/);
  assert.match(normalizedSql, /interval '90 days'/);
});

test("webhook info counts only a bounded pending-update subquery", () => {
  const body = functionBody("bot_webhook_info_internal");
  assert.match(
    body,
    /select pg_catalog\.count\(\*\)[\s\S]*from \([\s\S]*from private\.bot_updates queued[\s\S]*limit 1000001[\s\S]*\) bounded_pending/,
  );
  assert.doesNotMatch(
    body,
    /select least\(pg_catalog\.count\(\*\), 1000000\)::integer[\s\S]*from private\.bot_updates queued/,
  );
});

test("two-session concurrency probe covers delivery plus management authorization races", () => {
  const normalizedProbe = concurrencyProbe.replace(/\s+/g, " ").toLowerCase();
  assert.match(normalizedProbe, /dblink_connect\('claim_session_a'/);
  assert.match(normalizedProbe, /dblink_connect\('claim_session_b'/);
  assert.match(normalizedProbe, /bot_delivery_claim_internal/);
  assert.match(normalizedProbe, /claim_session_b_bypassed_per_bot_ordering_or_skip_locked/);
  assert.match(normalizedProbe, /dblink_is_busy\('claim_session_b'\)/);
  assert.match(normalizedProbe, /webhook_mutation_did_not_wait_for_polling_lease_lock/);
  assert.match(normalizedProbe, /developer_removal_race/);
  assert.match(normalizedProbe, /suspend_resume_race/);
  assert.match(normalizedProbe, /rotate_delete_race/);
  assert.match(normalizedProbe, /cancel_finalize_race/);
  assert.match(normalizedProbe, /bot_deletion_finalize_internal/);
  assert.match(normalizedProbe, /dblink_is_busy\('management_session_b'\)/);
  assert.match(normalizedProbe, /bot_platform_db_concurrency_probe_ok/);
});

test("webhook disable result does not depend on delivery lease cleanup", () => {
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_webhook_delete_internal\([\s\S]*v_webhook_rows integer := 0;[\s\S]*get diagnostics v_webhook_rows = row_count;[\s\S]*v_result := pg_catalog\.to_jsonb\(v_webhook_rows > 0\)/,
  );
});

test("message sender rules preserve legacy tombstones but reject new anonymous messages", () => {
  assert.match(
    normalizedSql,
    /add column if not exists bot_id uuid null references public\.bots\(id\) on delete restrict/,
  );
  assert.match(
    normalizedSql,
    /constraint messages_sender_shape_check check \( \(type = 'system' and user_id is null and bot_id is null\) or \( coalesce\(type, 'text'\) <> 'system' and not \(user_id is not null and bot_id is not null\) \) \) not valid/,
  );
  assert.match(normalizedSql, /create or replace function private\.enforce_message_sender_on_insert\(\)/);
  assert.match(
    normalizedSql,
    /if coalesce\(new\.type, 'text'\) = 'system' then[\s\S]*new\.user_id is not null or new\.bot_id is not null[\s\S]*elsif \(new\.user_id is null\) = \(new\.bot_id is null\) then/,
  );
  assert.match(
    normalizedSql,
    /create trigger trg_messages_sender_on_insert before insert on public\.messages/,
  );
  assert.match(normalizedSql, /legacy tombstone/);
  assert.match(
    normalizedSql,
    /create trigger trg_profiles_mark_message_tombstones before delete on public\.profiles/,
  );
  assert.match(
    normalizedSql,
    /pg_catalog\.current_setting\( 'letscube\.profile_delete_tombstone_user_ids', true \)/,
  );
  assert.match(normalizedSql, /pg_catalog\.string_to_array\(/);
  assert.match(normalizedSql, /old\.user_id::text = any/);
  assert.doesNotMatch(normalizedSql, /pg_trigger_depth\(\)/);
  assert.doesNotMatch(
    sql,
    /^\s*update\s+public\.messages\s+set\s+(user_id|bot_id)\b/im,
  );
});

test("ordinary authenticated clients cannot forge bot-authored messages", () => {
  assert.match(
    normalizedSql,
    /drop policy if exists "chat members can send messages" on public\.messages/,
  );
  assert.match(
    normalizedSql,
    /create policy "chat members can send messages" on public\.messages for insert to authenticated with check \( \(select auth\.uid\(\)\) = user_id and bot_id is null/,
  );
  assert.match(normalizedSql, /insert into public\.messages[^;]*bot_id/);
});

test("bot replies are constrained to the target chat as well as visibility", () => {
  assert.match(
    normalizedSql,
    /replied_message\.id = v_reply_to_id and replied_message\.chat_id = p_chat_id and private\.bot_can_receive_message\( p_bot_id, replied_message\.id \)/,
  );
});

test("all gateway RPCs are fixed-search-path and service-role only", () => {
  for (const [name, signature] of serviceRoleFunctions) {
    const escapedSignature = signature
      .split(",")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(",\\s*");
    assert.match(
      normalizedSql,
      new RegExp(`create or replace function public\\.${name}\\(`),
      `${name} must exist`,
    );
    assert.match(
      normalizedSql,
      new RegExp(`function public\\.${name}\\(${escapedSignature}\\)[^;]*from public, anon, authenticated, service_role`),
      `${name} must be revoked from every role before its narrow grant`,
    );
    assert.match(
      normalizedSql,
      new RegExp(`grant execute on function public\\.${name}\\(${escapedSignature}\\) to service_role`),
      `${name} must be executable only by service_role`,
    );
    assert.match(driftCheck, new RegExp(`"${name}"`));
  }

  const definitions = normalizedSql.split("create or replace function public.").slice(1);
  for (const definition of definitions) {
    const name = definition.match(/^([a-z0-9_]+)/)?.[1];
    if (!name?.startsWith("bot_")) continue;
    assert.match(definition, /security definer/);
    assert.match(
      definition,
      /set search_path = ''/,
      `${name} must use an empty search path`,
    );
  }
});

test("bounded internal RPC inputs fail closed on null values", () => {
  assert.match(normalizedSql, /p_username is null/);
  assert.match(normalizedSql, /p_display_name is null/);
  assert.ok((normalizedSql.match(/p_token_prefix is null/g) ?? []).length >= 2);
  assert.ok((normalizedSql.match(/p_token_hash is null/g) ?? []).length >= 2);
  assert.match(normalizedSql, /p_operation is null/);
  assert.match(normalizedSql, /p_method is null/);
  assert.match(normalizedSql, /p_idempotency_key is null/);
  assert.match(normalizedSql, /p_update_type is null/);
  assert.match(normalizedSql, /p_offset is null/);
  assert.match(normalizedSql, /p_through_update_id is null/);
  assert.ok((normalizedSql.match(/p_limit is null/g) ?? []).length >= 3);
  assert.match(normalizedSql, /p_status is null/);
});

test("webhook claims return encrypted material for trusted worker decryption", () => {
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_webhook_set_internal\( p_bot_id uuid, p_url text, p_secret_ciphertext text, p_secret_fingerprint text, p_drop_pending_updates boolean, p_idempotency_key text, p_request_fingerprint text \)/,
  );
  assert.match(normalizedSql, /p_secret_ciphertext !~ '\^enc:v1:/);
  assert.match(normalizedSql, /p_secret_ciphertext is null/);
  assert.match(normalizedSql, /p_secret_fingerprint is null/);
  assert.match(normalizedSql, /secret_ciphertext = excluded\.secret_ciphertext/);
  assert.match(normalizedSql, /'secret_ciphertext', v_webhook\.secret_ciphertext/);
  assert.doesNotMatch(normalizedSql, /target_url text, secret_hash text/);
});

test("notification fanout projects bot identity without changing human exclusion", () => {
  assert.match(normalizedSql, /create or replace function public\.enqueue_message_notifications\(\)/);
  assert.match(normalizedSql, /from public\.bots b where b\.id = new\.bot_id/);
  assert.match(normalizedSql, /'sender_kind', v_sender_kind/);
  assert.match(normalizedSql, /'bot_id', new\.bot_id/);
  assert.match(
    normalizedSql,
    /and \(new\.user_id is null or member_row\.user_id <> new\.user_id\)/,
  );
  assert.match(
    normalizedSql,
    /push mutes and notification preferences remain enforced by public\._notification_push_allowed/,
  );
});

test("public bot discovery is authenticated, active-only, bounded, and metadata-only", () => {
  const body = functionBody("search_public_bots");
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(body, /pg_catalog\.btrim\(pg_catalog\.left\(coalesce\(p_query, ''\), 80\)\)/);
  assert.match(body, /bot\.state = 'active'/);
  assert.match(body, /v_limit integer := least\(greatest\(coalesce\(p_limit, 20\), 1\), 40\)/);
  assert.match(body, /limit v_limit/);
  assert.match(
    normalizedSql,
    /returns table \( id uuid, username text, display_name text, description text, avatar_url text \)/,
  );
  assert.match(
    normalizedSql,
    /revoke all on function public\.search_public_bots\(text,integer\) from public, anon/,
  );
  assert.match(
    normalizedSql,
    /grant execute on function public\.search_public_bots\(text,integer\) to authenticated/,
  );
  assert.doesNotMatch(body, /bot_owners|bot_tokens|bot_webhooks|bot_updates|delivery|delete_after/);
});

test("inactive bot identities require ownership or a shared chat", () => {
  assert.doesNotMatch(
    normalizedSql,
    /create policy "authenticated users read bot identities" on public\.bots for select to authenticated using \(true\)/,
  );
  assert.match(normalizedSql, /bots\.state = 'active'/);
  assert.match(normalizedSql, /from public\.bot_owners owner_row/);
  assert.match(normalizedSql, /from public\.chat_bot_members bot_member/);
  assert.match(normalizedSql, /join public\.chat_members human_member/);
});

test("chat summaries project explicit bot identity and count only valid incoming senders", () => {
  const body = functionBody("chat_list_summaries");
  assert.match(
    body,
    /jsonb_build_object\( 'id', bot\.id, 'username', bot\.username, 'display_name', bot\.display_name, 'description', bot\.description, 'avatar_url', bot\.avatar_url, 'state', bot\.state, 'created_at', bot\.created_at, 'updated_at', bot\.updated_at \)/,
  );
  assert.match(body, /left join public\.bots as bot on bot\.id = message\.bot_id/);
  assert.match(
    body,
    /message\.type <> 'system'[\s\S]*\( \(message\.user_id is not null and message\.bot_id is null and message\.user_id <> \(select auth\.uid\(\)\)\) or \(message\.bot_id is not null and message\.user_id is null\) \)/,
  );
});

test("deleted bot chat search masks former identity in display, filters, and rank", () => {
  const body = functionBody("search_chat_messages");
  assert.match(
    body,
    /when bot\.id is null or bot\.state = 'deleted' then 'Удалённый бот'/i,
  );
  assert.match(body, /bot_identity\.sender_name/);
  assert.match(body, /bot_identity\.search_text/);
  assert.doesNotMatch(
    body,
    /similarity\(pg_catalog\.lower\(coalesce\(bot\.(display_name|username)/,
  );
  assert.doesNotMatch(
    body,
    /or pg_catalog\.lower\(coalesce\(bot\.(display_name|username)/,
  );
});

test("notification projection keeps exact routing fields and a bounded safe actor avatar", () => {
  const body = functionBody("enqueue_message_notifications");
  assert.match(body, /'sender_avatar_url', v_sender_avatar_url/);
  assert.match(body, /'group_tag', 'message:chat:' \|\| new\.chat_id::text/);
  assert.match(body, /'route', '\/\?chat=' \|\| new\.chat_id::text \|\| '&message=' \|\| new\.id::text/);
  assert.match(body, /v_sender_kind := 'bot'/);
  assert.match(body, /new\.user_id is null or member_row\.user_id <> new\.user_id/);
  assert.match(
    body,
    /v_sender_avatar_url := public\._sanitize_notification_avatar_url\(v_sender_avatar_url\)/,
  );

  const pushBody = functionBody("_notification_push_payload");
  for (const key of [
    "sender_kind",
    "sender_id",
    "bot_id",
    "sender_name",
    "sender_avatar_url",
    "chat_id",
    "message_id",
    "group_tag",
    "route",
  ]) {
    assert.match(pushBody, new RegExp(`'${key}'`), `${key} must survive push projection`);
  }
  assert.match(
    pushBody,
    /public\._sanitize_notification_avatar_url\(\s*nullif\(p_payload->>'sender_avatar_url', ''\)\s*\)/,
  );

  const avatarBody = functionBody("_sanitize_notification_avatar_url");
  assert.match(avatarBody, /v_value like '\/%' and v_value not like '\/\/%'/);
  assert.match(avatarBody, /https:\/\/app\.letscube\.ru\//);
  assert.match(avatarBody, /https:\/\/api\.letscube\.ru\//);
  for (const sensitivePattern of [
    "/storage/v1/",
    "/object/sign/",
    "token=",
    "password=",
    "authorization=",
    "signedurl",
    "signed_url",
  ]) {
    assert.match(avatarBody, new RegExp(sensitivePattern.replaceAll("/", "\\/")));
  }
});

test("binding spec documents the tombstone-safe sender invariant", () => {
  assert.match(bindingSpec, /legacy tombstone/i);
  assert.match(bindingSpec, /before insert/i);
  assert.match(bindingSpec, /system/i);
  assert.doesNotMatch(bindingSpec, /never both and never\s+neither/i);
});

test("database smoke preserves history and rolls every probe back", () => {
  const normalizedSmoke = dbSmoke.replace(/\s+/g, " ").trim().toLowerCase();
  assert.match(normalizedSmoke, /^\\set on_error_stop on begin;/);
  assert.match(normalizedSmoke, /legacy_tombstone_count/);
  assert.match(normalizedSmoke, /message_sender_required/);
  assert.match(normalizedSmoke, /bot_send_message_internal/);
  assert.match(normalizedSmoke, /bot_idempotency_failed/);
  assert.match(normalizedSmoke, /bot_webhook_disable_depended_on_lease/);
  assert.match(normalizedSmoke, /authenticated_bot_forgery_succeeded/);
  assert.match(normalizedSmoke, /authenticated_human_message_insert_failed/);
  assert.match(normalizedSmoke, /authenticated_human_markup_insert_succeeded/);
  assert.match(normalizedSmoke, /authenticated_human_markup_update_succeeded/);
  assert.match(normalizedSmoke, /restricted_plain_message_was_projected/);
  assert.match(normalizedSmoke, /restricted_mention_not_projected/);
  assert.match(normalizedSmoke, /full_message_not_projected/);
  assert.match(normalizedSmoke, /stale_claim_not_recovered/);
  assert.match(normalizedSmoke, /active_token_count_invalid/);
  assert.match(normalizedSmoke, /bot_owner_limit_not_enforced/);
  assert.match(normalizedSmoke, /bot_management_eligibility_invalid/);
  assert.match(normalizedSmoke, /bot_stale_rotation_succeeded/);
  assert.match(normalizedSmoke, /bot_developer_command_update_failed/);
  assert.match(normalizedSmoke, /bot_developer_owner_action_succeeded/);
  assert.match(normalizedSmoke, /bot_owner_resumed_suspended_bot/);
  assert.match(normalizedSmoke, /bot_pending_delete_rotation_succeeded/);
  assert.match(normalizedSmoke, /bot_cancel_delete_token_or_state_invalid/);
  assert.match(normalizedSmoke, /bot_admin_projection_exposed_private_data/);
  assert.match(normalizedSmoke, /bot_suspend_permission_seed_invalid/);
  assert.match(normalizedSmoke, /bot_media_without_grant_succeeded/);
  assert.match(normalizedSmoke, /bot_media_grant_not_consumed/);
  assert.match(normalizedSmoke, /bot_reply_markup_projection_missing/);
  assert.match(normalizedSmoke, /bot_reply_markup_validation_failed/);
  assert.match(normalizedSmoke, /bot_media_method_allowlist_failed/);
  assert.match(normalizedSmoke, /bot_edit_idempotency_failed/);
  assert.match(normalizedSmoke, /bot_edit_without_markup_failed/);
  assert.match(normalizedSmoke, /bot_edit_idempotency_conflict_missing/);
  assert.match(normalizedSmoke, /cross_chat_edit_succeeded/);
  assert.match(normalizedSmoke, /cross_chat_delete_succeeded/);
  assert.match(normalizedSmoke, /bot_command_replace_failed/);
  assert.match(normalizedSmoke, /bot_command_maximum_replay_failed/);
  assert.match(normalizedSmoke, /bot_file_cross_chat_lookup_succeeded/);
  assert.match(normalizedSmoke, /bot_file_pre_join_lookup_succeeded/);
  assert.match(normalizedSmoke, /bot_callback_wrong_owner_succeeded/);
  assert.match(normalizedSmoke, /bot_callback_idempotency_failed/);
  assert.match(normalizedSmoke, /bot_callback_retry_after_source_cleanup_failed/);
  assert.match(normalizedSmoke, /bot_callback_answer_cascade_deleted/);
  assert.match(normalizedSmoke, /expired_upload_grant_not_replaced/);
  assert.match(normalizedSmoke, /bot_upload_exact_retry_failed/);
  assert.match(normalizedSmoke, /bot_upload_attribute_conflict_missing/);
  assert.match(normalizedSmoke, /bot_media_preflight_inactive_membership_succeeded/);
  assert.match(normalizedSmoke, /bot_media_preflight_changed_retry_missing/);
  assert.match(normalizedSmoke, /bot_media_preflight_changed_method_retry_missing/);
  assert.match(normalizedSmoke, /bot_media_preflight_changed_retry_created_grant/);
  assert.match(normalizedSmoke, /bot_media_preflight_exact_retry_failed/);
  assert.match(normalizedSmoke, /bot_media_preflight_new_request_failed/);
  assert.match(normalizedSmoke, /bot_media_command_final_authority_failed/);
  assert.match(normalizedSmoke, /bot_send_fingerprint_conflict_missing/);
  assert.match(normalizedSmoke, /bot_send_method_conflict_missing/);
  assert.match(normalizedSmoke, /cross_chat_reply_succeeded/);
  assert.match(normalizedSmoke, /v_other_chat_id, v_bot_id, 'full'/);
  assert.match(normalizedSmoke, /cross_chat_topic_succeeded/);
  assert.match(normalizedSmoke, /bulk_profile_delete_tombstones_not_preserved/);
  assert.match(normalizedSmoke, /nested_sender_rewrite_succeeded/);
  assert.match(normalizedSmoke, /inactive_membership_update_was_queued/);
  assert.match(normalizedSmoke, /suspended_membership_update_was_queued/);
  assert.match(normalizedSmoke, /active_membership_readd_not_projected/);
  assert.match(normalizedSmoke, /restricted_message_edit_not_projected/);
  assert.match(normalizedSmoke, /restricted_plain_message_edit_was_projected/);
  assert.match(normalizedSmoke, /message_edit_noop_or_internal_update_was_projected/);
  assert.match(normalizedSmoke, /full_message_edit_not_projected/);
  assert.match(normalizedSmoke, /oversized_metadata_message_not_persisted/);
  assert.match(normalizedSmoke, /oversized_metadata_projection_not_bounded/);
  assert.match(normalizedSmoke, /broken_bot_unsafe_insert_update_queued/);
  assert.match(normalizedSmoke, /direct_bot_enqueue_failure_was_swallowed/);
  assert.match(normalizedSmoke, /oversized_metadata_edit_not_persisted/);
  assert.match(normalizedSmoke, /broken_bot_unsafe_edit_update_queued/);
  assert.match(normalizedSmoke, /removed_membership_privacy_update_was_queued/);
  assert.match(normalizedSmoke, /removed_membership_privacy_update_not_persisted/);
  assert.match(normalizedSmoke, /membership_enqueue_failure_rolled_back_source/);
  assert.match(normalizedSmoke, /muted_bot_notification_enqueued_push/);
  assert.match(normalizedSmoke, /bot_public_search_role_grants_invalid/);
  assert.match(normalizedSmoke, /active_bot_search_failed/);
  assert.match(normalizedSmoke, /inactive_shared_bot_visibility_or_search_invalid/);
  assert.match(normalizedSmoke, /inactive_owner_bot_visibility_missing/);
  assert.match(normalizedSmoke, /inactive_bot_visible_to_unrelated_authenticated_user/);
  assert.match(normalizedSmoke, /bot_notification_projection_invalid/);
  assert.match(normalizedSmoke, /bot_notification_push_projection_invalid/);
  assert.match(normalizedSmoke, /human_notification_raw_avatar_not_sanitized/);
  assert.match(normalizedSmoke, /bot_notification_raw_avatar_not_sanitized/);
  assert.match(normalizedSmoke, /bot_chat_summary_or_unread_invalid/);
  assert.match(normalizedSmoke, /bot_chat_message_search_failed/);
  assert.match(normalizedSmoke, /deleted_bot_chat_search_identity_leaked/);
  assert.match(normalizedSmoke, /deleted_bot_old_identity_searchable/);
  assert.match(normalizedSmoke, /profile_delete_tombstone_not_preserved/);
  assert.match(normalizedSmoke, /anon_can_access_private_bot_table/);
  assert.match(normalizedSmoke, /authenticated_can_execute_bot_internal_rpc/);
  assert.match(normalizedSmoke, /bot_history_delete_not_restricted/);
  assert.match(
    normalizedSmoke,
    /to_regclass\('public\.registration_invite_settings'\)/,
  );
  assert.match(
    normalizedSmoke,
    /execute 'update public\.registration_invite_settings set invite_only_enabled = false where id = true'/,
  );
  assert.equal(
    normalizedSmoke.match(/on conflict \(id\) do update set/g)?.length,
    3,
    "restored auth profile triggers require all smoke profiles to be upserted",
  );
  assert.match(
    normalizedSmoke,
    /insert into public\.chat_members\(chat_id, user_id, role\)[\s\S]*values \(v_delete_chat_id, v_recipient_id, 'owner'::public\.chat_member_role\)[\s\S]*on conflict \(chat_id, user_id\) do update set[\s\S]*role = excluded\.role/,
    "the profile tombstone probe must preserve a second chat owner",
  );
  assert.equal(
    normalizedSmoke.match(
      /insert into public\.chat_members\([^)]+\)[\s\S]*?on conflict \(chat_id, user_id\) do update set/g,
    )?.length,
    6,
    "restored chat-creation triggers require every smoke membership fixture to be idempotent",
  );
  assert.match(normalizedSmoke, /rollback;$/);
  assert.doesNotMatch(normalizedSmoke, /delete from public\.messages/);
  assert.match(
    normalizedSmoke,
    /update public\.messages set user_id = null where id = v_other_message_id/,
  );
});
