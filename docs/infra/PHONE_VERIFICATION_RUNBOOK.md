# Phone Verification Runbook

KUB currently has hardened phone verification fallback. A phone number is not
marked verified until Supabase Auth OTP verification succeeds.

## Current status

- No fake verification path.
- No "save without verification" path.
- Missing SMS provider errors are shown as friendly setup messages.
- Raw provider errors are not shown in UI.

## Self-host setup

1. Choose SMS provider supported by the self-hosted Supabase Auth setup.
2. Configure provider credentials in Supabase runtime secrets only.
3. Apply the reviewed phone verification migration if the target database does
   not have the required fields/RPC.
4. Keep profile phone state in the app database only after OTP success.

## Required QA

- Invalid local phone number is rejected.
- E.164-style number is accepted.
- OTP send works with real provider.
- Wrong OTP shows friendly error.
- Correct OTP sets verified state.
- Changing phone requires a fresh OTP.
- Missing provider does not mark verified.

## Privacy

- Do not expose raw phone numbers where role permissions do not allow it.
- Do not put SMS provider credentials into frontend env.
- Do not store OTP codes in KUB tables.
