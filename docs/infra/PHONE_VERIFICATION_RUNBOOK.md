# Phone Verification Runbook

KUB currently has hardened phone verification fallback. A phone number is not
marked verified until Supabase Auth OTP verification succeeds.

## Current status

- No fake verification path.
- No "save without verification" path.
- Missing SMS provider errors are shown as friendly setup messages.
- Raw provider errors are not shown in UI.

## Self-host setup

1. The selected provider is p1sms. Verify current production terms and the
   shared LETSCUBE account balance before activation.
2. Implement a trusted HTTP Send SMS Hook adapter. Supabase Auth generates and
   verifies the OTP; the adapter only submits the phone/code message to the
   selected provider.
3. Verify the hook request signature and reject unsigned/expired requests.
4. Configure phone auth, hook URI and hook secret in the self-hosted Auth
   container environment. Keep SMS autoconfirm disabled.
5. Configure provider credentials in Coolify/server secrets only. Never expose
   them to the browser, Android or Windows clients.
6. Keep profile phone state in the app database only after OTP success and the
   server-side `profile_phone_mark_verified()` Auth check.
7. Reject concurrent pending claims for the same normalized phone and clear
   stale abandoned `auth.users.phone_change` values on a bounded schedule.
8. Add Auth/provider rate limits, resend cooldown, cost alerts and sanitized
   delivery metrics before enabling production traffic.
9. Store `P1SMS_API_KEY` only as a trusted server secret. Runtime code may call
   only `POST /apiSms/create` with one immediate `digit` message and must never
   modify shared account senders, bases, blacklists, schedules or messages
   belonging to other LETSCUBE services.
10. For physical QA, keep the global policy disabled and add only the test user
    ID to `phone_verification_pilot_users`. Remove or disable that row after QA
    if the production rollout is not continuing.

## Required QA

- Invalid local phone number is rejected.
- E.164-style number is accepted.
- OTP send works with real provider.
- Wrong OTP shows friendly error.
- Correct OTP sets verified state.
- Changing phone requires a fresh OTP.
- Missing provider does not mark verified.
- A second account cannot concurrently claim the same pending phone.
- Provider logs and UI contain no raw OTP, full phone, secret or stack trace.
- Exact verified phone search works for `users.view` callers and does not return
  the phone value.

## Privacy

- Do not expose raw phone numbers where role permissions do not allow it.
- Do not put SMS provider credentials into frontend env.
- Do not store OTP codes in KUB tables.
