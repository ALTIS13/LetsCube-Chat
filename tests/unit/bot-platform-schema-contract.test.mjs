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

const publicTables = ["bots", "bot_owners", "bot_commands", "chat_bot_members"];
const privateTables = [
  "bot_tokens",
  "bot_updates",
  "bot_webhooks",
  "bot_delivery_attempts",
  "bot_rate_limit_buckets",
  "bot_upload_grants",
];
const serviceRoleFunctions = [
  ["bot_create_internal", "uuid,text,text,text,text,text"],
  ["bot_list_owned_internal", "uuid"],
  ["bot_rotate_token_internal", "uuid,uuid,text,text"],
  ["bot_token_lookup_internal", "text"],
  ["bot_token_touch_internal", "uuid,timestamptz"],
  ["bot_membership_authorize_internal", "uuid,uuid,text"],
  ["bot_upload_authorize_internal", "uuid,uuid,text,text,text,bigint,integer"],
  ["bot_send_message_internal", "uuid,uuid,text,jsonb,text"],
  ["bot_updates_poll_internal", "uuid,bigint,integer,uuid"],
  ["bot_updates_ack_internal", "uuid,bigint"],
  ["bot_webhook_set_internal", "uuid,text,text,text"],
  ["bot_webhook_delete_internal", "uuid"],
  ["bot_update_enqueue_internal", "uuid,text,uuid,jsonb"],
  ["bot_delivery_claim_internal", "integer,uuid"],
  ["bot_delivery_finish_internal", "bigint,uuid,text,text"],
  ["bot_delivery_cleanup_internal", "timestamptz,integer"],
];

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
    /create trigger trg_enqueue_bot_membership_updates after insert or update of privacy_mode, removed_at on public\.chat_bot_members/,
  );
  assert.match(normalizedSql, /restricted_command_or_mention_required/);
  assert.doesNotMatch(
    normalizedSql,
    /insert into private\.bot_updates\([^;]*payload\)[^;]*p_context/,
  );
});

test("stale delivery claims are recovered atomically and boundedly", () => {
  assert.match(normalizedSql, /attempt\.status = 'claimed'/);
  assert.match(normalizedSql, /attempt\.claimed_at <= pg_catalog\.now\(\) - interval '2 minutes'/);
  assert.match(normalizedSql, /status = case when attempt\.attempt_count >= 12 then 'dead_letter' else 'retry' end/);
  assert.match(normalizedSql, /for update of attempt skip locked/);
  assert.match(normalizedSql, /limit least\(p_limit, 100\)/);
});

test("webhook disable result does not depend on delivery lease cleanup", () => {
  assert.match(
    normalizedSql,
    /create or replace function public\.bot_webhook_delete_internal\([\s\S]*v_webhook_rows integer := 0;[\s\S]*get diagnostics v_webhook_rows = row_count;[\s\S]*return v_webhook_rows > 0/,
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
    /pg_catalog\.current_setting\( 'letscube\.profile_delete_tombstone_user_id', true \)/,
  );
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

test("all gateway RPCs are fixed-search-path and service-role only", () => {
  for (const [name, signature] of serviceRoleFunctions) {
    const escapedSignature = signature.replaceAll(",", ",\\s*");
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
    /create or replace function public\.bot_webhook_set_internal\( p_bot_id uuid, p_url text, p_secret_ciphertext text, p_secret_fingerprint text \)/,
  );
  assert.match(normalizedSql, /p_secret_ciphertext !~ '\^enc:v1:/);
  assert.match(normalizedSql, /p_secret_ciphertext is null/);
  assert.match(normalizedSql, /p_secret_fingerprint is null/);
  assert.match(normalizedSql, /secret_ciphertext = excluded\.secret_ciphertext/);
  assert.match(normalizedSql, /webhook\.secret_ciphertext/);
  assert.match(normalizedSql, /webhook\.secret_fingerprint/);
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
  assert.match(normalizedSmoke, /restricted_plain_message_was_projected/);
  assert.match(normalizedSmoke, /restricted_mention_not_projected/);
  assert.match(normalizedSmoke, /full_message_not_projected/);
  assert.match(normalizedSmoke, /stale_claim_not_recovered/);
  assert.match(normalizedSmoke, /active_token_count_invalid/);
  assert.match(normalizedSmoke, /bot_owner_limit_not_enforced/);
  assert.match(normalizedSmoke, /bot_media_without_grant_succeeded/);
  assert.match(normalizedSmoke, /bot_media_grant_not_consumed/);
  assert.match(normalizedSmoke, /expired_upload_grant_not_replaced/);
  assert.match(normalizedSmoke, /cross_chat_reply_succeeded/);
  assert.match(normalizedSmoke, /cross_chat_topic_succeeded/);
  assert.match(normalizedSmoke, /muted_bot_notification_enqueued_push/);
  assert.match(normalizedSmoke, /profile_delete_tombstone_not_preserved/);
  assert.match(normalizedSmoke, /anon_can_access_private_bot_table/);
  assert.match(normalizedSmoke, /authenticated_can_execute_bot_internal_rpc/);
  assert.match(normalizedSmoke, /bot_history_delete_not_restricted/);
  assert.match(normalizedSmoke, /rollback;$/);
  assert.doesNotMatch(normalizedSmoke, /delete from public\.messages/);
  assert.match(
    normalizedSmoke,
    /update public\.messages set user_id = null where id = v_other_message_id/,
  );
});
