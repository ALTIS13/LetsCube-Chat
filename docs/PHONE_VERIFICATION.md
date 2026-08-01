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

Preferred provider: [Yandex Cloud Notification Service SMS](https://yandex.cloud/ru/docs/notifications/concepts/sms). It supports Russian E.164 numbers and an individual registered sender. Production onboarding requires activating the service, creating an SMS channel and registering the sender name. SMSC.ru, SMS Aero and MTS Exolve can be supported through the same adapter contract if Yandex onboarding or delivery is unsuitable.

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
