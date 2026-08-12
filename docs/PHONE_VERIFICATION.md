# Phone Verification

Status: the verified-only UI/database flow and privacy-safe exact phone search are deployed. A p1sms production pilot is prepared for an explicit server-managed allowlist; global SMS rollout and enforcement remain disabled.

## Current flow

1. User enters a phone number in profile settings.
2. The app requires an explicit international E.164-style number with `+` and country code, for example `+79991234567`. Spaces, dashes and parentheses are removed for convenience, but local numbers without `+` are not accepted.
3. The app creates a short-lived server-side HMAC claim before calling Supabase Auth phone update. The claim contains no raw phone number.
4. Supabase Auth generates the OTP and invokes the signed LETSCUBE Send SMS Hook. A repeated send uses the dedicated `phone_change` resend endpoint.
5. User enters the 6-digit code.
6. The app calls Supabase Auth OTP verification.
7. Only after successful OTP verification, `profile_phone_mark_verified()` mirrors the verified phone into `public.profile_contacts`.

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
  is the payload produced by the deployed GoTrue `v2.189.0`. A guarded
  `user.new_phone` / `user.phone` fallback is retained only for older payloads.

## Recommended production delivery path

Use the [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook) with a trusted server-side LETSCUBE adapter. Supabase Auth must continue to generate and verify the OTP; the adapter only sends the generated code and must not expose or persist it in frontend-accessible storage.

Selected provider: p1sms. Production activation uses server-only `P1SMS_API_KEY`, `SEND_SMS_HOOK_SECRET` and `PHONE_CLAIM_HMAC_SECRET`. Global policy remains disabled during the first physical QA; only records in the private `phone_verification_pilot_users` allowlist may create a delivery claim.

The p1sms account is shared by LETSCUBE services. The runtime adapter therefore has a deliberately narrow contract: it calls only `POST https://admin.p1sms.ru/apiSms/create`, submits one immediate `digit` message tagged `letscube-otp`, blocks HTTP redirects and never calls account, balance, sender, history, scheduling, reject, phone-base or blacklist endpoints. The API key is read only after `SMS_DELIVERY_ENABLED=true`, remains in trusted Edge Function/Coolify secrets and is never placed in a URL, frontend bundle, log or database row.

The exact production template is `LETSCUBE: код 123456. Никому его не сообщайте.`. It is 46 characters for a six-digit code and the adapter rejects any SMS longer than 65 characters before contacting the provider.

The schema keeps concurrent webhook retries idempotent and applies server-side cost/abuse ceilings across replacement claims: no more than 5 authorized attempts per user per hour, 10 per user per 24 hours, and 5 per target-phone HMAC per hour. Client resend cooldown matches the server's 60-second minimum.

Current implementation files:

- `supabase/functions/auth-send-sms/` - signed Send SMS Hook and narrow p1sms adapter;
- `supabase/functions/phone-verification-gateway/` - authenticated HMAC claim gateway;
- `.migration-backup/supabase/migrations/20260810_smsru_phone_verification_foundation.sql` - schema/RLS source with rollout flags disabled by default and a private pilot allowlist.

The provider and Auth hook are configured for the allowlisted physical test.
Delivery remains fail-closed for every account outside that private allowlist.
Do not enable the global policy, new-account cutoff or restrictive onboarding
RLS until the controlled test and post-test database audit are complete.

Self-hosted Auth configuration belongs in server/Coolify secrets and the Auth container environment. Required configuration includes phone auth enablement and the Send SMS Hook URI/secret. Keep SMS autoconfirm disabled. Do not put provider keys or hook secrets in frontend env.

Before production enablement, add protection for the [documented `phone_change` ambiguity](https://supabase.com/docs/guides/troubleshooting/unexpected-behavior-with-authupdateuser-phone-phone-linked-to-incorrect-user-id-45368f): concurrent pending claims for one normalized phone must be rejected, and abandoned pending changes must be cleared after a bounded grace period.

## Friendly missing-provider behavior

If Supabase Auth returns a provider setup error, the UI shows:

```text
SMS-провайдер не настроен. Обратитесь к администратору.
```

Raw provider details are not shown in the UI.

The app does not mark the phone as verified and does not save a changed phone number into `profile_contacts` when SMS delivery is unavailable.

## Manual QA

- With SMS provider disabled, try to verify a phone and confirm the friendly setup message.
- Confirm a local number such as `89991234567` is rejected and `+79991234567` is accepted as input.
- With SMS provider enabled, verify a real test number.
- Confirm `profile_contacts.phone_verified = true` and `phone_verified_at` is set only after OTP success.
- Change the number and confirm it requires a fresh OTP.
- Confirm the resend action is delayed by the countdown and that there is no “save without verification” action.
- Confirm a second account cannot start or complete a concurrent verification for the same phone.
- Confirm a verified phone is found only for a caller with `users.view`, and the search result never reveals the phone number.
