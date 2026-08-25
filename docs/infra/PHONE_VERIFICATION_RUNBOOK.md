# Phone Verification Runbook

LETSCUBE has an administrator-only four-digit phone verification flow. A phone
number is not marked verified until the trusted gateway validates the code and
Supabase Auth confirms the number.

## Current status

- No fake verification path.
- No "save without verification" path.
- Missing code-delivery provider errors are shown as friendly setup messages.
- Raw provider errors are not shown in UI.

## Self-host setup

1. The selected provider is p1sms. Verify current production terms and the
   shared LETSCUBE account balance before activation.
2. Keep verification in the authenticated `phone-verification-gateway`. It
   generates a four-digit code, stores only a domain-separated HMAC, and calls
   the narrow p1sms adapter from the trusted Edge runtime.
3. Keep the legacy Send SMS Hook fail-closed and signature-verified, but do not
   route the profile phone flow through GoTrue OTP. GoTrue `v2.189.0` supports
   only 6-10 digits, while the p1sms digital channel requires four.
4. Keep SMS autoconfirm disabled in the self-hosted Auth environment. The
   gateway may update Auth only after its own code verification succeeds.
5. Configure provider credentials in Coolify/server secrets only. Never expose
   them to the browser, Android or Windows clients.
6. Keep profile phone state in the app database only after code success and an
   Auth-confirmed phone. Final claim consumption and profile mirroring must be
   one database transaction.
7. Reject concurrent pending claims for the same normalized phone and clear
   expired/cancelled HMAC material.
8. Add Auth/provider rate limits, resend cooldown, cost alerts and sanitized
   delivery metrics before enabling production traffic.
9. Store `P1SMS_API_KEY` only as a trusted server secret. Runtime code may call
   only `POST /apiSms/create` with one immediate `digit` message and one inline
   `agg_error -> telegram_auth`, `not_delivered -> telegram_auth` and `error -> telegram_auth` fallbacks. P1SMS owns status evaluation and
   fallback creation; LETSCUBE must not poll, create a second provider request,
   or manage shared senders, bases, blacklists, schedules or messages belonging
   to other LETSCUBE services.
10. For physical QA, keep the global policy disabled and add only the test user
    ID to `phone_verification_pilot_users`. Remove or disable that row after QA
    if the production rollout is not continuing.

## Required QA

- Invalid local phone number is rejected.
- E.164-style number is accepted.
- OTP delivery uses digital SMS first and falls back to Telegram only after `agg_error`, `not_delivered` or a terminal provider error. P1SMS support confirmed that `agg_error` is a separate not-sent status and must be matched explicitly.
- An administrator with `system.manage` can create a claim; a regular account receives `disabled` and does not contact the provider.
- Wrong OTP shows friendly error.
- The OTP is exactly four digits, expires after 10 minutes and is cancelled on
  the fifth failed attempt.
- Correct OTP sets verified state.
- Changing phone requires a fresh OTP.
- Removing phone clears both the trusted Supabase Auth value and the private profile mirror.
- Missing provider does not mark verified.
- A second account cannot concurrently claim the same pending phone.
- Provider logs and UI contain no raw OTP, full phone, secret or stack trace.
- Exact verified phone search works for `users.view` callers and does not return
  the phone value.

## Privacy

- Do not expose raw phone numbers where role permissions do not allow it.
- Do not put SMS provider credentials into frontend env.
- Do not store raw OTP codes in LETSCUBE tables or logs; store only server-HMAC values.
