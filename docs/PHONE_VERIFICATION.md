# Phone Verification

Status: the verified-only UI/database flow is restricted to administrators with `system.manage`; privacy-safe exact phone search remains available to authorized staff. P1SMS delivery uses digital SMS first and an inline Telegram fallback after the provider reports `agg_error`, `not_delivered` or a terminal delivery `error`. Mandatory phone enforcement remains disabled.

## Current flow

1. An administrator enters a phone number in profile settings. The phone section is hidden for other accounts, and the server rejects their delivery claims.
2. The app requires an explicit international E.164-style number with `+` and country code, for example `+79991234567`. Spaces, dashes and parentheses are removed for convenience, but local numbers without `+` are not accepted.
3. The trusted phone gateway creates a short-lived claim and a cryptographically random four-digit code. The claim contains only server-side HMAC values, never the raw phone or code.
4. The gateway submits one `digit` message to p1sms with inline `agg_error`, `not_delivered` and `error` fallbacks to `telegram_auth`. P1SMS evaluates the delivery status and creates the fallback; LETSCUBE does not poll or issue a second request.
5. The administrator enters the four-digit code. The gateway accepts at most five attempts during the 10-minute code lifetime.
6. After a valid code, the trusted gateway confirms the phone in Supabase Auth and atomically consumes the claim while mirroring the confirmed phone into `public.profile_contacts`.

There is no “save without verification” path for changing a phone number.

## Production pilot (2026-08-12)

- Self-hosted Auth image: `supabase/gotrue:v2.189.0`.
- Phone auth and the signed Send SMS Hook are enabled for the controlled pilot.
- `GOTRUE_SMS_AUTOCONFIRM=false`.
- The hook uses the TLS endpoint at `core.letscube.ru`; its signing secret and
  the p1sms API key exist only in root-readable server configuration.
- `phone_verified_at` and `profile_phone_mark_verified()` exist in production.
- `search_profiles_by_phone(text, integer)` exists in production.
- Global SMS policy and data-access enforcement remain disabled.
- One expiring server-side pilot allowlist entry is active for physical OTP QA.
- No SMS was sent during deployment or automated validation.
- The hook reads the requested phone-change destination from `sms.phone`, which
  is the payload produced by the deployed GoTrue `v2.189.0`. GoTrue removes the
  leading `+` during E.164 validation, so the hook restores it before HMAC and
  provider checks. A guarded `user.new_phone` / `user.phone` fallback is
  retained only for older payloads.

## Recommended production delivery path

P1SMS digital delivery is configured for four-digit codes. The deployed Supabase Auth `v2.189.0` accepts only OTP lengths from 6 to 10 and resets lower values to 6, so LETSCUBE does not force an unsupported GoTrue setting or maintain a private Auth fork. The authenticated server gateway owns this administrator-only four-digit verification flow. It generates the code with Web Crypto, stores only a domain-separated HMAC, and updates Supabase Auth through the service-only Admin API after verification.

Selected provider: p1sms. Production activation uses server-only `P1SMS_API_KEY`, `SEND_SMS_HOOK_SECRET` and `PHONE_CLAIM_HMAC_SECRET`. Only accounts with the global `system.manage` permission may create a delivery claim. `enforce_data_access` remains disabled, so phone verification is not mandatory for registration or normal application access.

The p1sms account is shared by LETSCUBE services. The runtime adapter therefore has a deliberately narrow contract: it calls only `POST https://admin.p1sms.ru/apiSms/create`, submits one immediate `digit` message with message-scoped `agg_error -> telegram_auth`, `not_delivered -> telegram_auth` and `error -> telegram_auth` fallback branches, and follows the current p1sms schema by using singular `sms[].text` for the message being sent and `smstemplate.texts[]` plus `smstemplate.channel` for fallback templates. P1SMS support confirmed that `agg_error` means the initial message was not sent and must be matched as its own expected cascade status. The plural top-level template form belongs to the separate `createCascadeScheme` configuration endpoint and is intentionally not used at runtime. Undocumented request fields are not sent. The adapter blocks HTTP redirects and never calls account, balance, sender, history, scheduling, reject, phone-base, blacklist or cascade-management endpoints. The forced account-level cascade is disabled; this message-scoped cascade cannot alter templates or delivery rules of other LETSCUBE services. The API key is read only after `SMS_DELIVERY_ENABLED=true`, remains in trusted Edge Function/Coolify secrets and is never placed in a URL, frontend bundle, log or database row.

The exact production template is `LETSCUBE: код 1234. Никому его не сообщайте.`. It is 44 characters for a four-digit code and the adapter rejects any SMS longer than 65 characters before contacting the provider.

The schema keeps concurrent webhook retries idempotent and applies server-side cost/abuse ceilings across replacement claims: no more than 5 authorized attempts per user per hour, 10 per user per 24 hours, and 5 per target-phone HMAC per hour. Client and server resend cooldowns are both 120 seconds so primary delivery and any provider fallback have time to finish before another OTP can be requested.

Current implementation files:

- `supabase/functions/auth-send-sms/` - legacy signed Send SMS Hook compatibility guard and shared narrow p1sms adapter;
- `supabase/functions/phone-verification-gateway/` - authenticated four-digit delivery and verification gateway;
- `.migration-backup/supabase/migrations/20260810_smsru_phone_verification_foundation.sql` - schema/RLS source with rollout flags disabled by default and a private pilot allowlist.
- `.migration-backup/supabase/migrations/20260825093000_phone_verification_four_digit_otp.sql` - service-only HMAC code preparation, five-attempt verification and atomic profile finalization.

The provider and Auth hook remain active for administrators after the
controlled physical test. Migration `20260821095000_phone_verification_admin_only.sql`
disables the global rollout flag and enforces `system.manage` in the internal
claim function. The new-account cutoff and restrictive onboarding RLS remain
disabled, so phone verification is not mandatory for registration or ordinary application access.

Self-hosted Auth configuration belongs in server/Coolify secrets and the Auth container environment. Keep SMS autoconfirm disabled. The current GoTrue OTP length remains at its supported value; the profile flow does not invoke GoTrue phone OTP. Do not put provider keys or HMAC secrets in frontend env.

Before production enablement, add protection for the [documented `phone_change` ambiguity](https://supabase.com/docs/guides/troubleshooting/unexpected-behavior-with-authupdateuser-phone-phone-linked-to-incorrect-user-id-45368f): concurrent pending claims for one normalized phone must be rejected, and abandoned pending changes must be cleared after a bounded grace period.

## Friendly missing-provider behavior

If the trusted gateway reports unavailable delivery configuration, the UI shows:

```text
Сервис доставки кода не настроен. Обратитесь к администратору.
```

Raw provider details are not shown in the UI.

The app does not mark the phone as verified and does not save a changed phone number into `profile_contacts` when SMS delivery is unavailable.

## Manual QA

- With provider delivery disabled, try to verify a phone and confirm the friendly setup message.
- Confirm a local number such as `89991234567` is rejected and `+79991234567` is accepted as input.
- With provider delivery enabled, verify primary digital-SMS delivery and the Telegram fallback after real `agg_error`, `not_delivered` and provider-error results.
- Remove a verified phone and confirm both Supabase Auth and `profile_contacts` no longer retain it before requesting a fresh OTP.
- Confirm `profile_contacts.phone_verified = true` and `phone_verified_at` is set only after OTP success.
- Change the number and confirm it requires a fresh OTP.
- Confirm the resend action is delayed by the countdown and that there is no “save without verification” action.
- Confirm a second account cannot start or complete a concurrent verification for the same phone.
- Confirm a verified phone is found only for a caller with `users.view`, and the search result never reveals the phone number.
