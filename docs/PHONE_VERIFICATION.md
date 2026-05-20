# Phone Verification

Status: UI foundation is enabled, but real SMS delivery depends on Supabase Auth SMS provider configuration.

## Current flow

1. User enters a phone number in profile settings.
2. The app requires an explicit international E.164-style number with `+` and country code, for example `+79991234567`. Spaces, dashes and parentheses are removed for convenience, but local numbers without `+` are not accepted.
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

Without the proposal applied, the app still avoids fake verification, but the verified timestamp cannot be stored in `profile_contacts`.

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
