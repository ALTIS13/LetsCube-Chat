import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  ".migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql",
  "utf8",
);
const lowerSql = sql.toLowerCase();

const publicRpcs = [
  ["registration_lifecycle_register_internal", "uuid,text,text"],
  ["registration_lifecycle_extend_by_email_internal", "text"],
  ["registration_cleanup_claim", "integer,uuid,timestamptz"],
  ["registration_cleanup_recheck", "uuid,uuid,timestamptz"],
  ["registration_cleanup_finish", "uuid,uuid,text,text"],
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
  functionBody("private.registration_identity_requires_hold");
  functionBody("private.registration_has_product_activity");
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

test("claim bounds and locks candidates before classification or updates", () => {
  const body = functionBody("public.registration_cleanup_claim");
  const lockedCandidates = body.search(/\bwith\s+locked_candidates\s+as\s*\(/i);
  const ordered = body.indexOf("order by", lockedCandidates);
  const limited = body.indexOf("limit p_limit", ordered);
  const locked = body.indexOf("for update of l skip locked", limited);
  const classified = body.indexOf("classified as", locked);
  const held = body.indexOf("held as", classified);
  const claimed = body.indexOf("claimed as", held);
  const firstUpdate = body.indexOf(
    "update private.registration_lifecycles",
    lockedCandidates,
  );
  const lifecycleUpdates = [
    ...body.matchAll(/update private\.registration_lifecycles/gi),
  ];

  assert.ok(lockedCandidates >= 0, "expected a locked_candidates CTE");
  assert.ok(ordered > lockedCandidates, "expected candidate ordering");
  assert.ok(limited > ordered, "expected LIMIT p_limit after ordering");
  assert.ok(locked > limited, "expected lifecycle row locking after LIMIT");
  assert.ok(classified > locked, "expected classification after locking");
  assert.ok(
    held > classified,
    "expected hold persistence after classification",
  );
  assert.ok(claimed > held, "expected claiming after hold persistence");
  assert.ok(firstUpdate > locked, "expected updates only after locking");
  assert.match(body.slice(classified, firstUpdate), /from locked_candidates/i);
  assert.equal(lifecycleUpdates.length, 2);
  assert.match(
    body.slice(held, claimed),
    /update private\.registration_lifecycles[\s\S]+from classified candidate[\s\S]+where l\.user_id = candidate\.user_id[\s\S]+candidate\.requires_hold/i,
  );
  assert.match(
    body.slice(claimed),
    /update private\.registration_lifecycles[\s\S]+from classified candidate[\s\S]+where l\.user_id = candidate\.user_id/i,
  );
  assert.doesNotMatch(
    body.slice(0, locked),
    /update private\.registration_lifecycles/i,
  );
  assert.doesNotMatch(body, /\bexempted\s+as\s*\(\s*update/i);
});

test("recheck durably holds identities that become exempt after registration", () => {
  const body = functionBody("public.registration_cleanup_recheck");
  assert.match(
    body,
    /registration_identity_requires_hold[\s\S]+update private\.registration_lifecycles[\s\S]+admin_hold_at/i,
  );
});
