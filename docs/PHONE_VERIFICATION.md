# Phone Verification

Status: UI foundation is enabled, but real SMS delivery depends on Supabase Auth SMS provider configuration.

## Current flow

1. User enters a phone number in profile settings.
2. The app normalizes the number to E.164-style input.
3. The app calls Supabase Auth phone update, which sends an OTP if the SMS provider is configured.
4. User enters the 6-digit code.
5. The app calls Supabase Auth OTP verification.
6. Only after successful OTP verification, `profile_phone_mark_verified()` mirrors the verified phone into `public.profile_contacts`.

There is no “save without verification” path for changing a phone number.

## Manual Supabase setup

1. Configure a real SMS provider in Supabase Dashboard → Auth → Providers → Phone.
2. Apply the proposal manually if `phone_verified_at` is not present:

```sql
.migration-backup/supabase/migrations/20260528_phone_verification.sql
```

The proposal keeps phone numbers in `profile_contacts` and records `phone_verified_at` after OTP success.

## Friendly missing-provider behavior

If Supabase Auth returns a provider setup error, the UI shows:

```text
SMS-провайдер не настроен. Обратитесь к администратору.
```

Raw provider details are not shown in the UI.

## Manual QA

- With SMS provider disabled, try to verify a phone and confirm the friendly setup message.
- With SMS provider enabled, verify a real test number.
- Confirm `profile_contacts.phone_verified = true` and `phone_verified_at` is set only after OTP success.
- Change the number and confirm it requires a fresh OTP.
