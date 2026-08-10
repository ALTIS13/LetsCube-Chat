# Phone Verification

Status: the verified-only UI/database flow and privacy-safe exact phone search are deployed. Real SMS delivery is not configured yet.

## Current flow

1. User enters a phone number in profile settings.
2. The app requires an explicit international E.164-style number with `+` and country code, for example `+79991234567`. Spaces, dashes and parentheses are removed for convenience, but local numbers without `+` are not accepted.
3. The app calls Supabase Auth phone update, which sends an OTP if the SMS provider is configured.
4. User enters the 6-digit code.
5. The app calls Supabase Auth OTP verification.
6. Only after successful OTP verification, `profile_phone_mark_verified()` mirrors the verified phone into `public.profile_contacts`.

There is no “save without verification” path for changing a phone number.

## Production audit (2026-08-01)

- Self-hosted Auth image: `supabase/gotrue:v2.189.0`.
- `GOTRUE_EXTERNAL_PHONE_ENABLED=false`.
- `GOTRUE_SMS_AUTOCONFIRM=false`.
- Send SMS Hook is not configured.
- `phone_verified_at` and `profile_phone_mark_verified()` exist in production.
- `search_profiles_by_phone(text, integer)` exists in production.
- There are currently no verified phone contacts, so phone search cannot return a real result yet.
- There are no pending, duplicate, or stale `auth.users.phone_change` rows at the time of the audit.

## Recommended production delivery path

Use the [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook) with a trusted server-side LETSCUBE adapter. Supabase Auth must continue to generate and verify the OTP; the adapter only sends the generated code and must not expose or persist it in frontend-accessible storage.

Selected provider: [SMS.RU](https://sms.ru/api). The repository contains a provider-disabled server adapter and a schema proposal, but the provider is not connected to Supabase Auth and no real SMS has been sent. Production activation requires provider approval, an approved sender name, server-only `SMS_RU_API_ID`, `SEND_SMS_HOOK_SECRET` and `PHONE_CLAIM_HMAC_SECRET` secrets, followed by controlled physical delivery QA. The account login/password pair is not used by the runtime adapter.

The exact production template is `LETSCUBE: код 123456. Никому его не сообщайте.`. It is 46 characters for a six-digit code and the adapter rejects any SMS longer than 65 characters before contacting the provider.

The disabled schema proposal also keeps concurrent webhook retries idempotent and applies server-side cost/abuse ceilings across replacement claims: no more than 5 authorized attempts per user per hour, 10 per user per 24 hours, and 5 per target-phone HMAC per hour. These are foundation defaults to re-check against the approved provider contract before activation.

Current implementation files:

- `supabase/functions/auth-send-sms/` - signed Send SMS Hook and SMS.RU adapter;
- `supabase/functions/phone-verification-gateway/` - authenticated HMAC claim gateway;
- `.migration-backup/supabase/migrations/20260810_smsru_phone_verification_foundation.sql` - unapplied schema/RLS proposal with rollout flags disabled by default.

Do not deploy/enable the Auth hook, set `SMS_DELIVERY_ENABLED=true`, enable the new-account cutoff or apply restrictive onboarding RLS until provider approval and backup/rehearsal are complete.

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
