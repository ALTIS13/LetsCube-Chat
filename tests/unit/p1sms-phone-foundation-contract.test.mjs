import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GATEWAY = new URL("../../supabase/functions/phone-verification-gateway/index.ts", import.meta.url);
const HOOK = new URL("../../supabase/functions/auth-send-sms/index.ts", import.meta.url);
const ADAPTER = new URL("../../supabase/functions/auth-send-sms/p1sms.mjs", import.meta.url);
const PHONE_SECTION = new URL(
  "../../artifacts/kub/src/components/sidebar/PhoneSection.tsx",
  import.meta.url,
);
const MIGRATION = new URL(
  // Historical proposal filename is retained to avoid migration-history ambiguity.
  "../../.migration-backup/supabase/migrations/20260810_smsru_phone_verification_foundation.sql",
  import.meta.url,
);

test("phone claim gateway is authenticated and never owns OTP delivery", async () => {
  const source = await readFile(GATEWAY, "utf8");
  assert.match(source, /auth\.getUser\(token\)/u);
  assert.match(source, /if \(!token\)[\s\S]*"unauthorized"[\s\S]*401/iu);
  assert.match(source, /phone_verification_claim_begin_internal/u);
  assert.match(source, /from\("profile_contacts"\)/u);
  assert.match(source, /eq\("phone_verified", true\)/u);
  assert.match(source, /phone_in_use/u);
  assert.match(source, /PHONE_CLAIM_HMAC_SECRET/u);
  assert.doesNotMatch(source, /sms\.ru\/sms\/send/u);
  assert.doesNotMatch(source, /console\.(?:log|debug)\(/u);
});

test("settings create a server claim before asking Supabase Auth to send an OTP", async () => {
  const source = await readFile(PHONE_SECTION, "utf8");
  const claim = source.indexOf("const { data: claimData, error: claimError }");
  const authSend = source.indexOf("auth.updateUser({ phone: normalised })");
  assert.ok(claim >= 0, "phone settings must create a server-side claim");
  assert.ok(authSend > claim, "the claim must exist before Supabase Auth invokes the SMS hook");
  assert.doesNotMatch(source, /if \(!resend\)\s*\{[\s\S]*?phone-verification-gateway/u);
  assert.match(source, /const cancelPhoneClaim = async[\s\S]*?action:\s*"cancel"/u);
  assert.match(source, /if \(claimCreated\) await cancelPhoneClaim\(\)/u);
  assert.match(source, /auth\.resend\(\{/u);
  assert.match(source, /type:\s*"phone_change"/u);
  assert.match(source, /profile_phone_mark_verified[\s\S]*?cancelPhoneClaim/u);
});

test("Send SMS hook remains fail-closed and verifies Standard Webhooks first", async () => {
  const source = await readFile(HOOK, "utf8");
  const signatureCheck = source.indexOf("new Webhook");
  const deliveryGate = source.indexOf('SMS_DELIVERY_ENABLED") !== "true"');
  const providerSecret = source.indexOf('Deno.env.get("P1SMS_API_KEY")');
  assert.ok(signatureCheck >= 0);
  assert.ok(deliveryGate > signatureCheck);
  assert.ok(providerSecret > deliveryGate);
  assert.match(source, /phone_verification_claim_authorize_sms/u);
  assert.match(source, /duplicate_accepted/u);
  assert.match(source, /duplicate_unconfirmed/u);
  assert.match(source, /P1SMS_API_KEY/u);
  assert.match(source, /sendP1Sms/u);
  assert.match(source, /readSendSmsDestination/u);
  assert.doesNotMatch(source, /SMS_RU_API_ID|sendSmsRu|apiUsers|apiSenders|getSms|reject/u);
  assert.doesNotMatch(source, /console\.(?:log|debug)\(/u);
});

test("p1sms runtime adapter can only use the fixed send endpoint", async () => {
  const source = await readFile(ADAPTER, "utf8");
  assert.match(source, /https:\/\/admin\.p1sms\.ru\/apiSms\/create/u);
  assert.match(source, /redirect:\s*"error"/u);
  assert.match(source, /tag:\s*P1SMS_TAG/u);
  assert.doesNotMatch(
    source,
    /apiUsers|apiSenders|getSmsStatus|getSmsList|\/reject|changePlannedTime|phoneBase|blacklist/iu,
  );
  assert.doesNotMatch(source, /console\.(?:log|debug|error)\(/u);
});

test("schema proposal defaults rollout off and keeps internal tables private", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /enabled boolean not null default false/iu);
  assert.match(sql, /create table if not exists public\.phone_verification_pilot_users/iu);
  assert.match(sql, /policy\.enabled[\s\S]*phone_verification_pilot_users/iu);
  assert.match(sql, /enforce_data_access boolean not null default false/iu);
  assert.match(sql, /phone_discoverable boolean not null default false/iu);
  assert.match(sql, /enable row level security/iu);
  assert.match(sql, /revoke all on table public\.phone_verification_claims from (?:public, )?anon, authenticated/iu);
  assert.match(sql, /revoke all on function public\.phone_verification_claim_begin_internal/iu);
  assert.match(sql, /revoke all on table public\.phone_verification_pilot_users from (?:public, )?anon, authenticated/iu);
});

test("schema proposal keeps webhook retries idempotent and caps sends across replacement claims", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /return case when v_existing is true then 'duplicate_accepted' else 'duplicate_unconfirmed' end/iu);
  assert.match(sql, /for update;[\s\S]*select event\.accepted[\s\S]*event\.webhook_id = p_webhook_id/iu);
  assert.match(sql, /event\.user_id = p_user_id[\s\S]*interval '1 hour'[\s\S]*>= 5/iu);
  assert.match(sql, /event\.user_id = p_user_id[\s\S]*interval '24 hours'[\s\S]*>= 10/iu);
});
