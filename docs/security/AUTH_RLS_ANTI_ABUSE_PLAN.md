# LETSCUBE Auth, RLS And Anti-Abuse Plan

Status: working plan, 2026-06-21. No secrets. No SQL applied by this file.

## Current Findings

- Public email registration is enabled on self-hosted Supabase.
- Email autoconfirm is disabled, so users must confirm email before normal sign-in.
- Repeated signup for an existing confirmed email returns no access token or refresh token.
- The frontend signup form uses a non-persisted Supabase Auth client, so a signup response cannot create an app session.
- All inspected `public` tables have RLS enabled.
- No public views were found.
- Two existing `SECURITY DEFINER` functions need explicit `search_path` hardening:
  - `public.get_my_chat_ids()`
  - `public.handle_new_user()`

Migration proposal:

- `.migration-backup/supabase/migrations/20260621_auth_rls_security_hardening.sql`

## Immediate Auth Hardening

1. Keep email confirmation required.
2. Keep signup UI generic after submit:
   - Do not reveal whether an email already exists.
   - Tell the user to check email or use password recovery.
3. Keep signup on a non-persisted Auth client.
4. Keep recovery and signup email templates link-based; do not require users to paste OTP codes into the app.
5. Review GoTrue rate limit env values for:
   - signup confirmation requests;
   - password recovery requests;
   - OTP/magic-link requests;
   - token refresh;
   - verification attempts.

## Anti-Bruteforce Stage

Goal: slow password guessing without blocking normal staff use.

Recommended controls:

- Server-side Auth rate limits in self-hosted GoTrue.
- Reverse proxy request throttling for `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/verify`.
- Friendly frontend messages for `429 Too Many Requests`.
- Audit dashboard query for repeated failed login activity by IP/user agent if available in Auth logs.

Do not implement brute-force protection only in the frontend. Frontend cooldowns are helpful UX, but not security boundaries.

## Anti-Spam / Multi-Account Stage

Goal: prevent unlimited bot-created accounts while still allowing real new users.

Recommended layered approach:

- CAPTCHA or equivalent bot check on signup if supported in the current self-hosted Auth deployment.
- Optional club invite / registration code for public signup.
- Optional admin approval state for newly created profiles before chat/task access.
- Rate limits and proxy throttling on signup and recovery.
- Monitoring for many new accounts from one IP / ASN / user agent.

If strict staff-only access is required later, prefer an invite-code or admin-created-account flow over fully open public signup.

## RLS Audit Follow-Up

Next read-only checks:

- List all `SECURITY DEFINER` functions callable by `anon`.
- Confirm each callable function validates `auth.uid()` / role permissions internally.
- Verify storage policies for chat media, avatars, and task attachments.
- Verify no policies depend on user-editable `raw_user_meta_data`.
- Verify task/admin RPCs are not executable by `anon`.

Do not revoke execute privileges broadly without mapping frontend/RPC usage first.

