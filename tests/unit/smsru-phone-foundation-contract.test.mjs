import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GATEWAY = new URL("../../supabase/functions/phone-verification-gateway/index.ts", import.meta.url);
const HOOK = new URL("../../supabase/functions/auth-send-sms/index.ts", import.meta.url);
const MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/20260810_smsru_phone_verification_foundation.sql",
  import.meta.url,
);

test("phone claim gateway is authenticated and never owns OTP delivery", async () => {
  const source = await readFile(GATEWAY, "utf8");
  assert.match(source, /auth\.getUser\(token\)/u);
  assert.match(source, /phone_verification_claim_begin_internal/u);
  assert.match(source, /PHONE_CLAIM_HMAC_SECRET/u);
  assert.doesNotMatch(source, /sms\.ru\/sms\/send/u);
  assert.doesNotMatch(source, /console\.(?:log|debug)\(/u);
});

test("Send SMS hook remains fail-closed and verifies Standard Webhooks first", async () => {
  const source = await readFile(HOOK, "utf8");
  const signatureCheck = source.indexOf("new Webhook");
  const deliveryGate = source.indexOf('SMS_DELIVERY_ENABLED") !== "true"');
  assert.ok(signatureCheck >= 0);
  assert.ok(deliveryGate > signatureCheck);
  assert.match(source, /phone_verification_claim_authorize_sms/u);
  assert.doesNotMatch(source, /console\.(?:log|debug)\(/u);
});

test("schema proposal defaults rollout off and keeps internal tables private", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /enabled boolean not null default false/iu);
  assert.match(sql, /enforce_data_access boolean not null default false/iu);
  assert.match(sql, /phone_discoverable boolean not null default false/iu);
  assert.match(sql, /enable row level security/iu);
  assert.match(sql, /revoke all on table public\.phone_verification_claims from (?:public, )?anon, authenticated/iu);
  assert.match(sql, /revoke all on function public\.phone_verification_claim_begin_internal/iu);
});

test("schema proposal keeps webhook retries idempotent and caps sends across replacement claims", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /if exists \([\s\S]*event\.webhook_id = p_webhook_id[\s\S]*\) then[\s\S]*return 'duplicate';[\s\S]*for update;[\s\S]*if exists \([\s\S]*event\.webhook_id = p_webhook_id/iu);
  assert.match(sql, /event\.user_id = p_user_id[\s\S]*interval '1 hour'[\s\S]*>= 5/iu);
  assert.match(sql, /event\.user_id = p_user_id[\s\S]*interval '24 hours'[\s\S]*>= 10/iu);
});
