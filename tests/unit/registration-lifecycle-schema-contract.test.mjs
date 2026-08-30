import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  ".migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql",
  "utf8",
);
const driftCheck = readFileSync("scripts/check-database-type-drift.mjs", "utf8");
const lowerSql = sql.toLowerCase();

const publicRpcs = [
  ["registration_lifecycle_register_internal", "uuid,text,text"],
  ["registration_lifecycle_extend_by_email_internal", "text"],
  ["registration_cleanup_claim", "integer,uuid,timestamptz"],
  ["registration_cleanup_recheck", "uuid,uuid,timestamptz"],
  ["registration_cleanup_delete", "uuid,uuid,timestamptz"],
  ["registration_cleanup_finish", "uuid,uuid,text,text"],
  ["registration_cleanup_report", "timestamptz,timestamptz"],
  ["registration_cleanup_recover_dead_letter", "uuid,text"],
  ["registration_cleanup_purge_audit", "integer,timestamptz"],
  ["registration_lifecycle_backfill_internal", "integer,timestamptz"],
];

function functionDefinition(qualifiedName) {
  const marker = `create or replace function ${qualifiedName.toLowerCase()}(`;
  const start = lowerSql.indexOf(marker);
  assert.ok(start >= 0, `missing function ${qualifiedName}`);
  const next = lowerSql.indexOf(
    "\ncreate or replace function ",
    start + marker.length,
  );
  return sql.slice(start, next < 0 ? sql.length : next);
}

function functionBody(qualifiedName) {
  const definition = functionDefinition(qualifiedName);
  const match = definition.match(/\bas\s+\$([a-z0-9_]*)\$([\s\S]*?)\$\1\$;/i);
  assert.ok(match, `missing delimited body for ${qualifiedName}`);
  return match[2];
}

test("registration lifecycle tables and private predicates are defined", () => {
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /create table private\.registration_lifecycles/i);
  assert.match(sql, /create table private\.registration_cleanup_audit/i);
  assert.match(sql, /create table private\.registration_location_provenance/i);
  functionBody("private.registration_identity_requires_hold");
  functionBody("private.registration_has_product_activity");
  functionBody("private.registration_location_membership_requires_hold");
  functionBody("private.registration_record_invite_location_provenance");
  functionBody("private.registration_location_membership_guard");
  functionBody("private.registration_cleanup_guard_auth_user_delete");
});

test("due, retry, dead-letter and retention paths have bounded indexes", () => {
  for (const index of [
    "registration_lifecycles_due_idx",
    "registration_lifecycles_retry_idx",
    "registration_lifecycles_dead_letter_idx",
    "registration_cleanup_audit_retention_idx",
  ]) {
    assert.match(sql, new RegExp(`create index ${index}\\b`, "i"), index);
  }
  assert.match(
    sql,
    /registration_lifecycles_retry_idx[\s\S]+next_attempt_at[\s\S]+where admin_hold_at is null\s+and dead_lettered_at is null\s+and next_attempt_at is not null/i,
  );
});

test("invite location provenance stores the exact invite-created membership snapshot", () => {
  assert.match(
    sql,
    /create table private\.registration_location_provenance\s*\([\s\S]+user_id uuid[\s\S]+references auth\.users\s*\(id\) on delete cascade[\s\S]+location_id uuid[\s\S]+invite_id uuid[\s\S]+role_id uuid[\s\S]+legacy_role text[\s\S]+primary_admin_id uuid[\s\S]+is_primary boolean[\s\S]+primary key \(user_id, location_id\)/i,
  );

  const body = functionBody(
    "private.registration_record_invite_location_provenance",
  );
  for (const source of [
    "registration_invite_uses",
    "registration_invites",
    "location_members",
    "roles",
  ]) {
    assert.match(body, new RegExp(`(?:from|join) public\\.${source}\\b`, "i"));
  }
  assert.match(body, /extensions\.digest\(ri\.code,\s*'sha256'\)/i);
  assert.match(body, /ri\.location_role_id\s*=\s*lm\.role_id/i);
  assert.match(body, /lm\.role\s*=\s*case r\.key/i);
  assert.match(body, /lm\.primary_admin_id\s+is not distinct from/i);
  assert.match(body, /lm\.is_primary\s*=\s*false/i);
  assert.match(
    body,
    /lm\.updated_at\s*=\s*riu\.used_at/i,
    "only the membership write from the invite-consumption transaction is provisional",
  );
});

test("new invite signup records provenance before identity hold classification", () => {
  const body = functionBody("public.registration_lifecycle_register_internal");
  const provenance = body.indexOf(
    "private.registration_record_invite_location_provenance",
  );
  const hold = body.indexOf("private.registration_identity_requires_hold");

  assert.ok(provenance >= 0, "expected invite provenance recording");
  assert.ok(hold > provenance, "expected provenance before hold classification");
  assert.match(body, /p_invite_code_hash/i);
});

test("backfill records only exact invite provenance before classifying holds", () => {
  const body = functionBody("public.registration_lifecycle_backfill_internal");
  const provenance = body.indexOf(
    "private.registration_record_invite_location_provenance",
  );
  const hold = body.lastIndexOf("private.registration_identity_requires_hold");

  assert.ok(provenance >= 0, "expected backfill provenance recording");
  assert.ok(hold > provenance, "expected provenance before hold classification");
  assert.match(body, /from public\.registration_invite_uses/i);
});

test("every current membership without an exact provenance snapshot requires a hold", () => {
  const body = functionBody(
    "private.registration_location_membership_requires_hold",
  );
  assert.match(body, /from public\.location_members lm/i);
  assert.match(body, /private\.registration_location_provenance provenance/i);
  assert.match(body, /provenance\.role_id\s+is not distinct from\s+lm\.role_id/i);
  assert.match(body, /provenance\.legacy_role\s*=\s*lm\.role/i);
  assert.match(
    body,
    /provenance\.primary_admin_id\s+is not distinct from\s+lm\.primary_admin_id/i,
  );
  assert.match(body, /provenance\.is_primary\s*=\s*lm\.is_primary/i);

  const identityBody = functionBody(
    "private.registration_identity_requires_hold",
  );
  assert.match(
    identityBody,
    /private\.registration_location_membership_requires_hold\(p_user_id\)/i,
  );
});

test("location membership insert or role change invalidates provenance and durably holds lifecycle", () => {
  assert.match(
    sql,
    /create trigger trg_registration_location_membership_guard\s+after insert or update on public\.location_members[\s\S]+execute function private\.registration_location_membership_guard\(\)/i,
  );
  const body = functionBody("private.registration_location_membership_guard");
  assert.match(body, /delete from private\.registration_location_provenance/i);
  assert.match(body, /update private\.registration_lifecycles/i);
  assert.match(body, /admin_hold_at\s*=\s*coalesce\(l\.admin_hold_at,/i);
  assert.match(body, /new\.user_id/i);
});

test("explicit same-value reassignment still invalidates invite provenance", () => {
  const definition = functionDefinition(
    "private.registration_location_membership_guard",
  );
  const body = functionBody("private.registration_location_membership_guard");

  assert.match(
    sql,
    /create trigger trg_registration_location_membership_guard\s+after insert or update on public\.location_members/i,
  );
  assert.doesNotMatch(definition, /\bwhen\s*\(/i);
  assert.doesNotMatch(body, /old\.(?:role|role_id|primary_admin_id|is_primary)/i);
  assert.match(body, /delete from private\.registration_location_provenance/i);
  assert.match(body, /admin_hold_at\s*=\s*coalesce/i);
});

test("product activity is filtered before the bounded cleanup claim", () => {
  const body = functionBody("public.registration_cleanup_claim");
  const claimCandidates = body.match(
    /locked_candidates\s+as\s*\(([\s\S]*?)\),\s*claimed\s+as/i,
  );

  assert.ok(claimCandidates, "expected a dedicated bounded claim candidate CTE");
  const candidateBody = claimCandidates[1];
  assert.match(candidateBody, /not private\.registration_has_product_activity/i);
  assert.ok(
    candidateBody.indexOf("registration_has_product_activity") <
      candidateBody.indexOf("limit p_limit"),
    "activity filtering must happen before LIMIT",
  );
});

test("protected identities are durably held in a separate bounded pass", () => {
  const body = functionBody("public.registration_cleanup_claim");
  const holdCandidates = body.match(
    /hold_candidates\s+as\s*\(([\s\S]*?)\),\s*held\s+as/i,
  );

  assert.ok(holdCandidates, "expected a dedicated protected-identity CTE");
  assert.match(holdCandidates[1], /private\.registration_identity_requires_hold/i);
  assert.match(holdCandidates[1], /limit p_limit/i);
  assert.match(holdCandidates[1], /for update of l skip locked/i);
  assert.match(body, /admin_hold_at\s*=\s*p_now/i);
});

for (const [name, signature] of publicRpcs) {
  test(`${name} is service-role-only with a fixed search path`, () => {
    const definition = functionDefinition(`public.${name}`);
    const escapedSignature = signature.replaceAll(",", "\\s*,\\s*");
    assert.match(
      definition,
      /set search_path = pg_catalog, public, private, auth, storage/i,
    );
    assert.match(
      definition,
      new RegExp(
        `revoke all on function public\\.${name}\\(${escapedSignature}\\)\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
    assert.match(
      definition,
      new RegExp(
        `grant execute on function public\\.${name}\\(${escapedSignature}\\)\\s+to service_role`,
        "i",
      ),
    );
    assert.doesNotMatch(
      definition,
      /grant execute[\s\S]+to (?:anon|authenticated)/i,
    );
  });
}

test("registration validates invite hashes and records durable exemptions", () => {
  const body = functionBody("public.registration_lifecycle_register_internal");
  assert.match(body, /p_user_id is null/i);
  assert.match(body, /p_invite_code_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(
    body,
    /p_signup_kind = 'public'[\s\S]+p_invite_code_hash is not null/i,
  );
  assert.match(
    body,
    /private\.registration_identity_requires_hold\(p_user_id\)/i,
  );
  assert.match(body, /admin_hold_at/i);
});

test("resend is bounded and never moves an old backfill grace deadline backward", () => {
  const body = functionBody(
    "public.registration_lifecycle_extend_by_email_internal",
  );
  assert.match(body, /octet_length\(v_email\)[\s\S]+254/i);
  assert.match(body, /v_email[\s\S]+\^\[\^\[:space:\]@\]\+@/i);
  assert.match(
    body,
    /eligible_at\s*=\s*greatest\(\s*l\.eligible_at,\s*least\([\s\S]+interval '14 days'[\s\S]+interval '7 days'[\s\S]+interval '72 hours'[\s\S]+\)\s*\)/i,
  );
  assert.doesNotMatch(body, /eligible_at\s*=\s*least\(/i);
});

test("backfill classifies authoritative invite uses and preserves rollout grace", () => {
  const body = functionBody("public.registration_lifecycle_backfill_internal");
  assert.match(body, /from public\.registration_invite_uses/i);
  assert.match(body, /case when[\s\S]+then 'invite'[\s\S]+else 'public'/i);
  assert.match(
    body,
    /case when[\s\S]+signup_kind = 'invite'[\s\S]+interval '7 days'[\s\S]+interval '72 hours'/i,
  );
  assert.match(body, /p_enabled_at \+ interval '24 hours'/i);
  assert.match(body, /private\.registration_identity_requires_hold\(/i);
  assert.match(body, /admin_hold_at/i);
});

test("identity exemption covers legacy, dynamic and operational account indicators", () => {
  const body = functionBody("private.registration_identity_requires_hold");
  assert.match(body, /from public\.profiles/i);
  assert.match(body, /role::text\s*<>\s*'user'/i);
  assert.match(body, /from public\.user_global_roles/i);
  assert.match(body, /from public\.user_roles/i);
  assert.match(body, /join public\.roles/i);
  assert.match(body, /r\.key\s*<>\s*'user'/i);
  assert.match(body, /public\.profile_reserved_username_key/i);
  assert.match(body, /public\.profile_reserved_username_keys/i);
});

test("product activity is centralized and covers every authoritative source", () => {
  const body = functionBody("private.registration_has_product_activity");
  for (const source of [
    "messages",
    "reactions",
    "message_hidden_for_users",
    "tasks",
    "task_events",
    "task_recurrences",
    "task_recurrence_events",
    "profile_contacts",
    "chats",
    "chat_members",
    "group_invites",
    "folders",
    "locations",
    "topics",
    "audit_logs",
    "bans",
    "mutes",
    "push_subscriptions",
    "user_push_devices",
    "push_foreground_sessions",
    "notification_preferences",
    "chat_notification_preferences",
    "support_tickets",
    "support_ticket_messages",
    "support_ticket_events",
    "support_operator_preferences",
    "privacy_acceptances",
    "phone_verification_claims",
    "phone_verification_sms_events",
    "registration_invites",
  ]) {
    assert.match(body, new RegExp(`from public\\.${source}\\b`, "i"), source);
  }
  assert.match(body, /from storage\.objects/i);
  assert.match(body, /owner_id\s*=\s*p_user_id::text/i);
  assert.match(body, /storage\.foldername\(/i);
  assert.match(body, /pc\.phone_verified/i);
  assert.doesNotMatch(
    body,
    /registration_invite_uses|user_global_roles|user_roles|location_members/i,
  );
});

for (const name of [
  "registration_cleanup_claim",
  "registration_cleanup_recheck",
]) {
  test(`${name} rechecks identity, hold, auth and centralized activity`, () => {
    const body = functionBody(`public.${name}`);
    assert.match(body, /email_confirmed_at is null/i);
    assert.match(body, /phone_confirmed_at is null/i);
    assert.match(body, /last_sign_in_at is null/i);
    assert.match(body, /admin_hold_at is null/i);
    assert.match(body, /private\.registration_identity_requires_hold\(/i);
    assert.match(body, /private\.registration_has_product_activity\(/i);
  });
}

test("claim locks lifecycle rows without locking auth users", () => {
  const body = functionBody("public.registration_cleanup_claim");
  assert.match(body, /for update of l skip locked/i);
  assert.doesNotMatch(body, /for update skip locked/i);
});

test("claim bounds protected holds and eligible claims before updates", () => {
  const body = functionBody("public.registration_cleanup_claim");
  const holdCandidates = body.indexOf("hold_candidates as");
  const held = body.indexOf("held as", holdCandidates);
  const lockedCandidates = body.indexOf("locked_candidates as", held);
  const claimed = body.indexOf("claimed as", lockedCandidates);
  const lifecycleUpdates = [
    ...body.matchAll(/update private\.registration_lifecycles/gi),
  ];

  assert.ok(holdCandidates >= 0, "expected hold candidates");
  assert.ok(held > holdCandidates, "expected bounded hold update");
  assert.ok(lockedCandidates > held, "expected independent eligible candidates");
  assert.ok(claimed > lockedCandidates, "expected bounded claim update");
  assert.equal(lifecycleUpdates.length, 2);
  assert.match(
    body.slice(holdCandidates, held),
    /limit p_limit[\s\S]+for update of l skip locked/i,
  );
  assert.match(
    body.slice(lockedCandidates, claimed),
    /limit p_limit[\s\S]+for update of l skip locked/i,
  );
});

test("recheck durably holds identities that become exempt after registration", () => {
  const body = functionBody("public.registration_cleanup_recheck");
  assert.match(
    body,
    /registration_identity_requires_hold[\s\S]+update private\.registration_lifecycles[\s\S]+admin_hold_at/i,
  );
});

test("cleanup deletion is atomic and claim-token-specific", () => {
  const body = functionBody("public.registration_cleanup_delete");
  assert.match(body, /l\.claim_token\s*=\s*p_claim_token/i);
  assert.match(body, /l\.claimed_at\s*>\s*p_now\s*-\s*interval '15 minutes'/i);
  assert.match(body, /private\.registration_identity_requires_hold/i);
  assert.match(body, /private\.registration_has_product_activity/i);
  assert.match(body, /set_config\(\s*'letscube\.registration_cleanup_claim_token'/i);
  assert.match(body, /delete from auth\.users/i);
  assert.doesNotMatch(sql, /delete_authorization_token uuid/i);
});

test("atomic cleanup delete serializes every identity and product activity writer", () => {
  const body = functionBody("public.registration_cleanup_delete");

  assert.match(body, /set_config\(\s*'lock_timeout',\s*'500ms',\s*true\s*\)/i);
  assert.match(body, /lock table[\s\S]+in share row exclusive mode/i);
  for (const relation of [
    "public.profiles",
    "public.user_global_roles",
    "public.roles",
    "public.location_members",
    "public.messages",
    "storage.objects",
    "public.reactions",
    "public.message_hidden_for_users",
    "public.tasks",
    "public.task_events",
    "public.task_recurrences",
    "public.task_recurrence_events",
    "public.profile_contacts",
    "public.chats",
    "public.chat_members",
    "public.group_invites",
    "public.folders",
    "public.locations",
    "public.topics",
    "public.audit_logs",
    "public.bans",
    "public.mutes",
    "public.push_subscriptions",
    "public.user_push_devices",
    "public.push_foreground_sessions",
    "public.notification_preferences",
    "public.chat_notification_preferences",
    "public.support_tickets",
    "public.support_ticket_messages",
    "public.support_ticket_events",
    "public.support_operator_preferences",
    "public.privacy_acceptances",
    "public.phone_verification_claims",
    "public.phone_verification_sms_events",
    "public.registration_invites",
  ]) {
    assert.match(body, new RegExp(relation.replace(".", "\\."), "i"), relation);
  }
  assert.match(body, /to_regclass\(\s*'public\.user_roles'\s*\)/i);
  assert.match(body, /lock table public\.user_roles in share row exclusive mode/i);
});

test("auth user delete guard rechecks cleanup eligibility in the delete statement", () => {
  assert.match(
    sql,
    /create trigger trg_registration_cleanup_guard_auth_user_delete\s+before delete on auth\.users[\s\S]+execute function private\.registration_cleanup_guard_auth_user_delete\(\)/i,
  );
  const body = functionBody("private.registration_cleanup_guard_auth_user_delete");
  assert.match(
    body,
    /current_setting\(\s*'letscube\.registration_cleanup_claim_token',\s*true\s*\)/i,
  );
  assert.match(
    body,
    /from private\.registration_lifecycles l[\s\S]+where l\.user_id = old\.id[\s\S]+for update/i,
  );
  assert.match(
    body,
    /cleanup_claim_token is null[\s\S]+return old/i,
  );
  assert.match(body, /v_lifecycle\.claim_token::text\s*<>\s*v_cleanup_claim_token/i);
  assert.match(
    body,
    /eligible_at\s*(?:>\s*pg_catalog\.clock_timestamp\(\)|<=\s*pg_catalog\.clock_timestamp\(\))/i,
  );
  assert.match(body, /admin_hold_at is not null/i);
  assert.match(body, /private\.registration_identity_requires_hold\(old\.id\)/i);
  assert.match(body, /private\.registration_has_product_activity\(old\.id\)/i);
  assert.match(body, /old\.email_confirmed_at is not null/i);
  assert.match(body, /old\.phone_confirmed_at is not null/i);
  assert.match(body, /old\.last_sign_in_at is not null/i);
  assert.match(body, /raise exception 'registration_cleanup_delete_rejected'/i);
  assert.match(
    body,
    /insert into private\.registration_cleanup_audit[\s\S]+values \(old\.id,\s*'deleted',\s*'expired_unconfirmed'\)/i,
  );
});

test("report-only completion clears a claim without creating an administrative hold", () => {
  const body = functionBody("public.registration_cleanup_finish");

  assert.match(body, /admin_hold_at\s*=\s*l\.admin_hold_at/i);
  assert.doesNotMatch(
    body,
    /when\s+p_action\s*=\s*'reported'[\s\S]{0,160}admin_hold_at/i,
  );
  assert.match(body, /claim_token\s*=\s*null/i);
  assert.match(body, /claimed_at\s*=\s*null/i);
  assert.match(body, /insert into private\.registration_cleanup_audit/i);
  assert.doesNotMatch(body, /p_action\s*=\s*'deleted'/i);
});

test("failed completion backs off and dead-letters exactly on the fifth failure", () => {
  assert.match(sql, /failure_count integer not null default 0/i);
  assert.match(sql, /next_attempt_at timestamptz null/i);
  assert.match(sql, /dead_lettered_at timestamptz null/i);

  const body = functionBody("public.registration_cleanup_finish");
  assert.match(
    body,
    /failure_count\s*=\s*case[\s\S]+p_action = 'failed'[\s\S]+least\(5,\s*l\.failure_count\s*\+\s*1\)/i,
  );
  assert.match(body, /l\.failure_count\s*\+\s*1\s*>=\s*5[\s\S]+dead_lettered_at/i);
  assert.match(body, /least\(\s*interval '24 hours'/i);
  assert.match(body, /power\(\s*2,/i);
  assert.match(body, /when p_action = 'reported' then l\.failure_count/i);
  assert.match(body, /when p_action = 'reported' then l\.next_attempt_at/i);
});

test("claim excludes delayed retries and dead letters without old-failure starvation", () => {
  const body = functionBody("public.registration_cleanup_claim");
  assert.match(body, /l\.dead_lettered_at is null/i);
  assert.match(body, /coalesce\(l\.next_attempt_at,\s*l\.eligible_at\)\s*<=\s*p_now/i);
  assert.match(
    body,
    /order by\s+coalesce\(l\.next_attempt_at,\s*l\.eligible_at\),\s*l\.eligible_at,\s*l\.user_id/i,
  );
});

test("dead-letter recovery resets one row and stays service-role-only", () => {
  const body = functionBody("public.registration_cleanup_recover_dead_letter");
  assert.match(body, /p_user_id is null/i);
  assert.match(body, /p_reason_code\s*!~/i);
  assert.match(body, /where l\.user_id\s*=\s*p_user_id/i);
  assert.match(body, /and l\.dead_lettered_at is not null/i);
  assert.match(body, /failure_count\s*=\s*0/i);
  assert.match(body, /next_attempt_at\s*=\s*null/i);
  assert.match(body, /dead_lettered_at\s*=\s*null/i);
});

test("audit purge is bounded to rows older than ninety days", () => {
  const body = functionBody("public.registration_cleanup_purge_audit");
  assert.match(body, /p_limit not between 1 and 10000/i);
  assert.match(
    body,
    /created_at\s*<\s*least\(\s*p_now,\s*pg_catalog\.clock_timestamp\(\)\s*\)\s*-\s*interval '90 days'/i,
  );
  assert.match(body, /order by[\s\S]+limit p_limit[\s\S]+for update skip locked/i);
  assert.match(body, /delete from private\.registration_cleanup_audit/i);
  assert.match(body, /return v_deleted/i);
});

test("database type drift keeps every private operational RPC out of frontend types", () => {
  for (const [name] of publicRpcs) {
    assert.match(
      driftCheck,
      new RegExp(`["']${name}["']`),
      `${name} missing from service-role-only allowlist`,
    );
  }
});

test("registration cleanup report is bounded, aggregate-only and service-role-only", () => {
  const definition = functionDefinition("public.registration_cleanup_report");
  const body = functionBody("public.registration_cleanup_report");

  assert.match(
    definition,
    /returns table\(\s*report_scope text,\s*signup_kind text,\s*reason_code text,\s*item_count bigint\s*\)/i,
  );
  assert.match(definition, /security definer/i);
  assert.match(
    definition,
    /set search_path = pg_catalog, public, private, auth, storage/i,
  );
  assert.match(body, /p_now is null or p_audit_since is null/i);
  assert.match(body, /p_audit_since > p_now/i);
  assert.match(body, /p_audit_since < p_now - interval '31 days'/i);
  assert.match(body, /registration_cleanup_report_invalid_window/i);

  const expectedReasons = [
    "claimed_unsafe_identity",
    "claimed_unsafe_email_confirmed",
    "claimed_unsafe_phone_confirmed",
    "claimed_unsafe_signed_in",
    "claimed_unsafe_product_activity",
    "admin_hold",
    "identity_exempt",
    "email_confirmed",
    "phone_confirmed",
    "signed_in",
    "product_activity",
    "dead_lettered",
    "not_due",
    "retry_wait",
    "eligible_due",
  ];
  for (const reason of expectedReasons) {
    assert.match(body, new RegExp(`'${reason}'`, "i"), reason);
  }

  assert.match(
    body,
    /claim_token is not null[\s\S]+claimed_unsafe_identity[\s\S]+claimed_unsafe_email_confirmed[\s\S]+claimed_unsafe_phone_confirmed[\s\S]+claimed_unsafe_signed_in[\s\S]+claimed_unsafe_product_activity/i,
  );
  assert.match(body, /'audit'::text as report_scope/i);
  assert.match(body, /'all'::text as signup_kind/i);
  assert.match(body, /a\.action\s*\|\|\s*':'\s*\|\|\s*a\.reason_code/i);
  assert.match(body, /count\(\*\)::bigint as item_count/i);
  assert.match(
    body,
    /select\s+lifecycle_aggregates\.report_scope,\s+lifecycle_aggregates\.signup_kind,\s+lifecycle_aggregates\.reason_code,\s+lifecycle_aggregates\.item_count\s+from lifecycle_aggregates\s+union all\s+select\s+audit_aggregates\.report_scope,\s+audit_aggregates\.signup_kind,\s+audit_aggregates\.reason_code,\s+audit_aggregates\.item_count\s+from audit_aggregates/i,
  );
});
