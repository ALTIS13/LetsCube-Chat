import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
const COOLDOWN_MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/20260820150904_phone_verification_two_minute_resend.sql",
  import.meta.url,
);
const GLOBAL_ROLLOUT_MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/20260820161957_enable_phone_verification_for_all_accounts.sql",
  import.meta.url,
);
const PHONE_REMOVE_MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/20260821093000_phone_remove_internal.sql",
  import.meta.url,
);
const ADMIN_ONLY_MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/20260821095000_phone_verification_admin_only.sql",
  import.meta.url,
);
const ADMIN_GATEWAY_MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/20260821101000_phone_gateway_admin_only.sql",
  import.meta.url,
);
const SETTINGS_MODAL = new URL(
  "../../artifacts/kub/src/components/sidebar/SettingsModal.tsx",
  import.meta.url,
);
const ADMIN_USERS = new URL(
  "../../artifacts/kub/src/pages/admin/UsersTab.tsx",
  import.meta.url,
);
const ADMIN_PHONE_REMOVE_MIGRATION = new URL(
  "../../.migration-backup/supabase/migrations/20260825190000_admin_phone_remove_audit.sql",
  import.meta.url,
);

test("phone gateway owns four-digit OTP delivery and verification server-side", async () => {
  const source = await readFile(GATEWAY, "utf8");
  assert.match(source, /auth\.getUser\(token\)/u);
  assert.match(source, /if \(!token\)[\s\S]*"unauthorized"[\s\S]*401/iu);
  assert.match(source, /phone_verification_claim_begin_internal/u);
  assert.match(source, /phone_verification_code_prepare_internal/u);
  assert.match(source, /phone_verification_code_verify_internal/u);
  assert.match(source, /phone_verification_profile_finalize_internal/u);
  assert.match(source, /phone_verification_admin_access_internal/u);
  assert.match(source, /adminAccess\.data !== true[\s\S]*"disabled"[\s\S]*403/u);
  assert.match(source, /from\("profile_contacts"\)/u);
  assert.match(source, /eq\("phone_verified", true\)/u);
  assert.match(source, /phone_in_use/u);
  assert.match(source, /PHONE_CLAIM_HMAC_SECRET/u);
  assert.match(source, /P1SMS_API_KEY/u);
  assert.match(source, /SMS_DELIVERY_ENABLED/u);
  assert.match(source, /generateFourDigitOtp/u);
  assert.match(source, /sendP1Sms/u);
  assert.match(source, /auth\.admin\.updateUserById/u);
  assert.doesNotMatch(source, /sms\.ru\/sms\/send/u);
  assert.doesNotMatch(source, /console\.(?:log|debug)\(/u);
});

test("settings use only the server gateway for four-digit delivery and verification", async () => {
  const source = await readFile(PHONE_SECTION, "utf8");
  assert.match(source, /body:\s*\{\s*action:\s*"begin",\s*phone:\s*normalised\s*\}/u);
  assert.match(source, /body:\s*\{\s*action:\s*"verify",\s*phone:\s*normalised,\s*code\s*\}/u);
  assert.match(source, /const cancelPhoneClaim = async[\s\S]*?action:\s*"cancel"/u);
  assert.doesNotMatch(source, /auth\.updateUser\(\{\s*phone/u);
  assert.doesNotMatch(source, /auth\.resend\(\{/u);
  assert.doesNotMatch(source, /auth\.verifyOtp\(\{/u);
  assert.match(source, /RESEND_WAIT_MS\s*=\s*120_000/u);
  assert.match(source, /formatResendCountdown\(resendSeconds\)/u);
  assert.match(source, /auth\.refreshSession\(\)/u);
  assert.match(source, /\^\\d\{4\}\$/u);
});

test("settings restore an already-confirmed Auth phone without claiming a delivery", async () => {
  const source = await readFile(PHONE_SECTION, "utf8");
  const sendCode = source.indexOf("const sendCode = async");
  const authLookup = source.indexOf("supabase.auth.getUser()", sendCode);
  const claim = source.indexOf("phone-verification-gateway", sendCode);
  const verifiedRpc = source.indexOf('supabase.rpc("profile_phone_mark_verified")', authLookup);

  assert.ok(authLookup > sendCode, "send must inspect the confirmed Auth phone");
  assert.ok(authLookup < claim, "same-phone recovery must not create a delivery claim");
  assert.ok(verifiedRpc > authLookup && verifiedRpc < claim);
  assert.match(source, /Код отправлен на номер/u);
  assert.doesNotMatch(source, /Код отправлен в Telegram/u);
});

test("settings preserve structured gateway errors returned with non-2xx responses", async () => {
  const source = await readFile(PHONE_SECTION, "utf8");
  assert.match(
    source,
    /await readPhoneGatewayErrorCode\(claimData, claimError\)/u,
    "the UI must recover the gateway error code from FunctionsHttpError.context",
  );
  assert.match(source, /humanisePhoneGatewayError\(claimErrorCode\)/u);
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
  assert.match(source, /scheduleP1SmsDelivery/u);
  assert.match(source, /EdgeRuntime\.waitUntil/u);
  assert.doesNotMatch(source, /await sendP1Sms/u);
  assert.match(source, /readSendSmsDestination/u);
  assert.match(source, /readSendSmsDestination\(event\.user, event\.sms\)/u);
  assert.doesNotMatch(source, /SMS_RU_API_ID|sendSmsRu|apiUsers|apiSenders|getSms|reject/u);
  assert.doesNotMatch(source, /console\.(?:log|debug)\(/u);
});

test("p1sms runtime adapter can only use the fixed send endpoint", async () => {
  const source = await readFile(ADAPTER, "utf8");
  assert.match(source, /https:\/\/admin\.p1sms\.ru\/apiSms\/create/u);
  assert.match(source, /channel:\s*"telegram_auth"/u);
  assert.match(source, /needStatus:\s*"agg_error"/u);
  assert.match(source, /needStatus:\s*"not_delivered"/u);
  assert.match(source, /needStatus:\s*"error"/u);
  assert.match(source, /needStatus:\s*"not_delivered"[\s\S]{0,180}smstemplate:\s*\{[\s\S]{0,80}channel:\s*"digit"/u);
  assert.doesNotMatch(source, /needStatus:\s*"(?:agg_error|not_delivered|error)"\s*,\s*channel:/u);
  assert.doesNotMatch(source, /cascadeSchemeId/u);
  assert.match(source, /redirect:\s*"error"/u);
  assert.doesNotMatch(source, /P1SMS_TAG|tag:\s*/u);
  assert.doesNotMatch(
    source,
    /apiUsers|apiSenders|getSmsStatus|getSmsList|\/reject|changePlannedTime|phoneBase|blacklist/iu,
  );
  assert.doesNotMatch(source, /console\.(?:log|debug|error)\(/u);
});

test("phone removal clears the trusted Auth phone and profile mirror", async () => {
  const [gateway, settings, migration] = await Promise.all([
    readFile(GATEWAY, "utf8"),
    readFile(PHONE_SECTION, "utf8"),
    readFile(PHONE_REMOVE_MIGRATION, "utf8"),
  ]);
  const removeStart = gateway.indexOf('if (action === "remove")');
  const removeEnd = gateway.indexOf('const phone = normalizeE164', removeStart);
  const removeBranch = gateway.slice(removeStart, removeEnd);

  assert.match(gateway, /action === "remove"/u);
  assert.match(gateway, /rpc\("profile_phone_remove_internal"/u);
  assert.doesNotMatch(removeBranch, /auth\.admin\.updateUserById/u);
  assert.doesNotMatch(gateway, /from\("profile_contacts"\)[\s\S]{0,320}phone:\s*null/u);
  assert.match(migration, /create or replace function public\.profile_phone_remove_internal\(p_user_id uuid\)/iu);
  assert.match(migration, /set_config\('app\.profile_contacts_bypass', 'on', true\)/u);
  assert.match(migration, /update auth\.users[\s\S]*phone\s*=\s*null[\s\S]*phone_confirmed_at\s*=\s*null/u);
  assert.match(migration, /phone_change\s*=\s*''[\s\S]*phone_change_token\s*=\s*''/u);
  assert.match(migration, /delete from auth\.one_time_tokens[\s\S]*phone_change_token/u);
  assert.match(migration, /delete from auth\.identities[\s\S]*provider\s*=\s*'phone'/u);
  assert.match(migration, /update public\.profile_contacts[\s\S]*phone\s*=\s*null/u);
  assert.match(migration, /phone_verified\s*=\s*false/u);
  assert.match(migration, /phone_verified_at\s*=\s*null/u);
  assert.match(migration, /phone_verification_claim_cancel_internal\(p_user_id\)/u);
  assert.match(migration, /revoke all on function public\.profile_phone_remove_internal\(uuid\) from public, anon, authenticated, service_role/iu);
  assert.match(migration, /grant execute on function public\.profile_phone_remove_internal\(uuid\) to service_role/iu);
  assert.match(settings, /body:\s*\{\s*action:\s*"remove"\s*\}/u);
  assert.doesNotMatch(
    settings,
    /from\("profile_contacts"\)[\s\S]{0,240}update\(\{\s*phone:\s*null/u,
  );
});

test("administrator user panel removes a target phone only through the trusted gateway", async () => {
  const [gateway, users, migration] = await Promise.all([
    readFile(GATEWAY, "utf8"),
    readFile(ADMIN_USERS, "utf8"),
    readFile(ADMIN_PHONE_REMOVE_MIGRATION, "utf8"),
  ]);
  // The administrator check guards the admin_remove branch, and only that
  // branch. It used to sit in front of every action, which is what stopped an
  // ordinary user from verifying their own number at all.
  const dispatch = gateway.indexOf("const action = body.action");
  const adminRemove = gateway.indexOf('action === "admin_remove"');
  const accessCheck = gateway.indexOf("phone_verification_admin_access_internal");
  // The call, not the identifier: a comment naming the function would match too.
  const removeCall = gateway.indexOf('rpc("admin_profile_phone_remove_internal"');

  assert.ok(dispatch >= 0, "the gateway no longer dispatches on an action");
  assert.ok(adminRemove > dispatch, "admin_remove must be dispatched, not gated up front");
  assert.ok(
    accessCheck > adminRemove,
    "the administrator check must live inside the admin_remove branch, not in front of every action",
  );
  assert.ok(removeCall > accessCheck, "the administrator check must precede the removal call");
  assert.equal(
    gateway.split("phone_verification_admin_access_internal").length - 1,
    1,
    "a second administrator check would be a blanket gate returning",
  );
  assert.match(gateway, /target_user_id/u);
  assert.match(gateway, /admin_remove[\s\S]{0,700}admin_profile_phone_remove_internal/u);
  assert.match(users, /action:\s*"admin_remove",\s*target_user_id:\s*user\.id/u);
  assert.match(users, /Удалить номер пользователя\?/u);
  assert.match(users, /Удалить номер/u);
  assert.doesNotMatch(users, /rpc\("profile_phone_remove_internal"/u);
  assert.match(migration, /has_permission\(p_actor_id, 'system\.manage'\)/u);
  assert.match(migration, /perform public\.profile_phone_remove_internal\(p_target_user_id\)/u);
  assert.match(migration, /insert into public\.audit_logs/u);
  assert.match(migration, /'admin_phone_removed'/u);
  assert.doesNotMatch(migration, /jsonb_build_object\([^)]*phone/iu);
  assert.match(migration, /grant execute on function public\.admin_profile_phone_remove_internal\(uuid, uuid\)\s+to service_role/iu);
  assert.doesNotMatch(migration, /grant execute[^;]+to (?:anon|authenticated)/iu);
});

test("phone UI keeps provider routing out of user-facing delivery copy", async () => {
  const source = await readFile(PHONE_SECTION, "utf8");
  assert.match(source, /Код отправлен на номер/u);
  assert.match(source, /Код подтверждения \(4 цифры\)/u);
  assert.match(source, /Сервис доставки кода не настроен/u);
  assert.doesNotMatch(source, /Telegram|Телеграм/u);
  assert.doesNotMatch(source, /Код из SMS/u);
  assert.doesNotMatch(source, /SMS-провайдер не настроен/u);
});

test("four-digit OTP schema is private, expiring and attempt-limited", async () => {
  const migrations = await readdir(
    new URL("../../.migration-backup/supabase/migrations/", import.meta.url),
  );
  const migrationName = migrations.find((name) => name.endsWith("phone_verification_four_digit_otp.sql"));
  assert.ok(migrationName, "four-digit OTP migration must exist");
  const sql = await readFile(
    new URL(`../../.migration-backup/supabase/migrations/${migrationName}`, import.meta.url),
    "utf8",
  );
  assert.match(sql, /otp_hmac text/iu);
  assert.match(sql, /otp_expires_at timestamptz/iu);
  assert.match(sql, /verify_attempts integer/iu);
  assert.match(sql, /verify_attempts\s*>=\s*5/iu);
  assert.match(sql, /phone_verification_code_prepare_internal/iu);
  assert.match(sql, /phone_verification_code_verify_internal/iu);
  assert.match(sql, /phone_verification_profile_finalize_internal/iu);
  assert.match(sql, /for update/iu);
  assert.match(sql, /return 'valid'/iu);
  assert.match(
    sql,
    /phone_verification_profile_finalize_internal\(\s*p_user_id uuid,\s*p_phone_hmac text,\s*p_otp_hmac text/iu,
  );
  assert.match(sql, /set status = 'verified',[\s\S]*otp_hmac = null/iu);
  assert.match(sql, /where id = v_claim\.id/iu);
  assert.match(sql, /created_at\s*>\s*now\(\)\s*-\s*interval '120 seconds'/iu);
  assert.match(sql, /grant execute on function public\.phone_verification_code_prepare_internal/iu);
  assert.match(sql, /grant execute on function public\.phone_verification_code_verify_internal/iu);
  assert.match(sql, /grant execute on function public\.phone_verification_profile_finalize_internal\(uuid, text, text\) to service_role/iu);
  assert.doesNotMatch(sql, /grant execute[^;]+to (?:anon|authenticated)/iu);

  const beginStart = sql.indexOf("create or replace function public.phone_verification_claim_begin_internal");
  const beginEnd = sql.indexOf("create or replace function public.phone_verification_claim_cancel_internal");
  const beginSql = sql.slice(beginStart, beginEnd);
  const cooldownGuard = beginSql.indexOf("interval '120 seconds'");
  const activeClaimCancellation = beginSql.indexOf("set status = 'cancelled'");
  assert.ok(cooldownGuard >= 0, "claim begin must enforce the resend cooldown");
  assert.ok(
    cooldownGuard < activeClaimCancellation,
    "a rate-limited resend must not cancel the still-valid code",
  );
});

test("the administrator-only lockdown is recorded as history, not as current behaviour", async () => {
  // These two migrations are immutable history: they are what closed phone
  // verification down to administrators. The assertions describe what those
  // files did, so they stay true. What changed is the live state, which is
  // covered by the test below.
  const [migration, gatewayMigration] = await Promise.all([
    readFile(ADMIN_ONLY_MIGRATION, "utf8"),
    readFile(ADMIN_GATEWAY_MIGRATION, "utf8"),
  ]);

  assert.match(migration, /update public\.phone_verification_policy[\s\S]*enabled\s*=\s*false/iu);
  assert.match(migration, /has_permission\(p_user_id, 'system\.manage'\)/u);
  assert.match(migration, /grant execute on function public\.phone_verification_claim_begin_internal\(uuid, text\) to service_role/iu);
  assert.match(gatewayMigration, /phone_verification_admin_access_internal\(p_user_id uuid\)/iu);
  assert.match(gatewayMigration, /grant execute on function public\.phone_verification_admin_access_internal\(uuid\) to service_role/iu);
});

test("phone verification is reachable by every account, in the UI and in the database", async () => {
  const [settings, phoneSection, migration] = await Promise.all([
    readFile(SETTINGS_MODAL, "utf8"),
    readFile(
      new URL("../../artifacts/kub/src/components/sidebar/PhoneSection.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../.migration-backup/supabase/migrations/20260902120000_phone_verification_open_to_all_users.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  // The section was hidden behind `isAdmin`, which is one of the three places
  // that had to be opened together. Hiding it is also the wrong way to say the
  // feature is off: the gateway answers "disabled" and the section renders it.
  assert.doesNotMatch(
    settings,
    /isAdmin\s*&&\s*\([\s\S]{0,400}<PhoneSection\s*\/>/u,
    "the phone section is hidden from ordinary users again",
  );
  assert.match(settings, /<PhoneSection\s*\/>/u, "the phone section is not rendered at all");
  assert.match(phoneSection, /case "disabled":/u, "the section no longer explains a closed policy");

  // And the database gate the UI depends on is the policy, not a permission.
  assert.match(migration, /phone_verification_available_internal/u);
  assert.match(migration, /set enabled = true/u);
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

test("server resend cooldown matches the two-minute client countdown", async () => {
  const sql = await readFile(COOLDOWN_MIGRATION, "utf8");
  assert.match(sql, /create or replace function public\.phone_verification_claim_authorize_sms/iu);
  assert.match(sql, /last_sms_at > now\(\) - interval '120 seconds'/iu);
  assert.doesNotMatch(sql, /interval '60 seconds'/iu);
});

test("global rollout enables delivery without making phone verification mandatory", async () => {
  const sql = await readFile(GLOBAL_ROLLOUT_MIGRATION, "utf8");
  assert.match(sql, /update public\.phone_verification_policy[\s\S]*enabled\s*=\s*true/iu);
  assert.match(sql, /enforce_data_access is false/iu);
  assert.doesNotMatch(sql, /enforce_data_access\s*=\s*true/iu);
  assert.doesNotMatch(sql, /required_for_created_at_or_after\s*=/iu);
});

test("phone verification is open to every user the policy allows, not only administrators", async () => {
  const [gateway, migration] = await Promise.all([
    readFile(GATEWAY, "utf8"),
    readFile(
      new URL(
        "../../.migration-backup/supabase/migrations/20260902120000_phone_verification_open_to_all_users.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  // Both delivery gates read the policy. Leaving either one on a permission
  // check is how flipping the policy row silently stopped opening anything.
  assert.match(
    migration,
    /function public\.phone_verification_claim_begin_internal[\s\S]*?phone_verification_available_internal/u,
  );
  assert.match(
    migration,
    /function public\.phone_verification_claim_authorize_sms[\s\S]*?phone_verification_available_internal/u,
  );
  assert.doesNotMatch(
    migration,
    /phone_verification_claim_(?:begin_internal|authorize_sms)[\s\S]*?has_permission\(p_user_id, 'system\.manage'\)/u,
  );

  // The predicate is the policy row or a pilot entry, exactly as before the
  // lockdown, so a pilot cohort still works.
  assert.match(migration, /phone_verification_policy[\s\S]*?policy\.enabled/u);
  assert.match(migration, /phone_verification_pilot_users/u);
  assert.match(migration, /update public\.phone_verification_policy\s*\n\s*set enabled = true/u);

  // Opening delivery must not start cutting existing accounts off, and must not
  // quietly switch on an enforcement nothing implements yet.
  assert.doesNotMatch(migration, /set[\s\S]{0,80}enforce_data_access\s*=\s*true/u);
  assert.doesNotMatch(migration, /set[\s\S]{0,120}required_for_created_at_or_after\s*=/u);
  assert.match(migration, /enforce_data_access is false/u);

  // Administrator-only actions stay administrator-only.
  assert.match(migration, /admin_profile_phone_remove_internal[\s\S]*?system\.manage/u);
  assert.match(gateway, /action === "admin_remove"[\s\S]*?phone_verification_admin_access_internal/u);

  // The rate limits are the only thing bounding delivery cost once every user
  // can ask for a code, so they must survive the rewrite.
  for (const limit of [
    /v_user_hour_count >= 5/u,
    /v_user_day_count >= 10/u,
    /v_phone_hour_count >= 5/u,
    /interval '120 seconds'/u,
  ]) {
    assert.match(migration, limit, `rate limit ${limit} was dropped`);
  }
});
