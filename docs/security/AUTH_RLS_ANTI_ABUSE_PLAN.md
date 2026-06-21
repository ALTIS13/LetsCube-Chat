# LETSCUBE Auth, RLS And Anti-Abuse Plan

Status: working plan, 2026-06-21. No secrets. No SQL applied by this file.

## Current Findings

- Public email registration is enabled on self-hosted Supabase.
- Email autoconfirm is disabled, so users must confirm email before normal sign-in.
- Repeated signup for an existing confirmed email returns no access token or refresh token.
- The frontend signup form uses a non-persisted Supabase Auth client, so a signup response cannot create an app session.
- Existing-email signup errors are handled as the same generic "check email or recover access" state, so the registration UI does not reveal whether an email is already registered.
- All inspected `public` tables have RLS enabled.
- No public views were found.
- Live self-host read-only audit on 2026-06-21 confirmed all inspected `public` tables have `relrowsecurity = true`.
- Live self-host read-only audit on 2026-06-21 found no `public` views/materialized views.
- Live self-host read-only audit on 2026-06-21 confirmed two existing `SECURITY DEFINER` functions still need explicit `search_path` hardening:
  - `public.get_my_chat_ids()`
  - `public.handle_new_user()`
- Live self-host auth env on 2026-06-21 did not show explicit `GOTRUE_RATE_LIMIT_*` values. Configure Auth-side limits before relying on public registration at scale.

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

Supabase Auth documentation confirms that exceeded auth limits return HTTP 429 and that Auth uses rate limiting on authentication endpoints. For self-hosted LETSCUBE, the next implementation step is to set explicit GoTrue rate-limit environment values and add proxy throttling in front of `/auth/v1/*`.

Initial self-host targets to configure and validate:

- Signup confirmation/recovery resend window: keep at least 60 seconds per email/user.
- Email send budget: keep conservative because all mail is delivered through the local Mailcow SMTP.
- Password grant `/auth/v1/token`: throttle by client IP at the reverse proxy to slow password guessing.
- `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/verify`: throttle by client IP at the reverse proxy, with separate limits from normal app traffic.
- UI: keep generic signup/recovery copy and map 429 to a friendly "too many attempts" message.

## Anti-Spam / Multi-Account Stage

Goal: prevent unlimited bot-created accounts while still allowing real new users.

Recommended layered approach:

- CAPTCHA or equivalent bot check on signup if supported in the current self-hosted Auth deployment.
- Optional club invite / registration code for public signup.
- Optional admin approval state for newly created profiles before chat/task access.
- Rate limits and proxy throttling on signup and recovery.
- Monitoring for many new accounts from one IP / ASN / user agent.

Supabase Auth supports CAPTCHA tokens on `signUp` and related auth flows. Do not add CAPTCHA frontend-only; it must be enabled and verified by the self-hosted Auth service with the CAPTCHA provider secret stored server-side.

If strict staff-only access is required later, prefer an invite-code or admin-created-account flow over fully open public signup.

## RLS Audit Follow-Up

Next read-only checks:

- List all `SECURITY DEFINER` functions callable by `anon`.
- Confirm each callable function validates `auth.uid()` / role permissions internally.
- Verify storage policies for chat media, avatars, and task attachments.
- Verify no policies depend on user-editable `raw_user_meta_data`.
- Verify task/admin RPCs are not executable by `anon`.

Do not revoke execute privileges broadly without mapping frontend/RPC usage first.
