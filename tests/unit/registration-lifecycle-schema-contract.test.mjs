import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  ".migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql",
  "utf8",
);

test("registration lifecycle stays private and service-role-only", () => {
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /create table private\.registration_lifecycles/i);
  assert.match(sql, /revoke all on function public\.registration_cleanup_claim/i);
  assert.match(sql, /grant execute on function public\.registration_cleanup_claim[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to anon/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to authenticated/i);
});

test("cleanup requires an unconfirmed and unused auth account", () => {
  assert.match(sql, /email_confirmed_at is null/i);
  assert.match(sql, /phone_confirmed_at is null/i);
  assert.match(sql, /last_sign_in_at is null/i);
  assert.match(sql, /from public\.messages/i);
  assert.match(sql, /for update skip locked/i);
});
