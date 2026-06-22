# LETSCUBE Auth, RLS And Anti-Abuse Plan

Status: applied baseline, 2026-06-21. No secrets.

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
- Live self-host read-only audit on 2026-06-21 found two existing `SECURITY DEFINER` functions without explicit `search_path`:
  - `public.get_my_chat_ids()`
  - `public.handle_new_user()`
- Applied live on 2026-06-21 from proposal `.migration-backup/supabase/migrations/20260621_auth_rls_security_hardening.sql`:
  - `public.get_my_chat_ids()` now has `search_path=public`.
  - `public.handle_new_user()` now has `search_path=public`.
  - Pre-apply function definition backup: `/srv/letscube/backups/config/function-defs-pre-search-path-20260621-202946.sql`.
- Initial live self-host auth env audit on 2026-06-21 did not show explicit `GOTRUE_RATE_LIMIT_*` values. The email throttles below were then configured on the self-hosted GoTrue service.
- Server config update on 2026-06-21 enabled low-risk Auth email throttles on self-hosted GoTrue:
  - `GOTRUE_RATE_LIMIT_EMAIL_SENT=60`
  - `GOTRUE_SMTP_MAX_FREQUENCY=60s`
  The auth container was recreated and returned healthy. `/auth/v1/settings` returned 200 with the public anon key, `external.email = true`, `disable_signup = false`.
- Reverse proxy update on 2026-06-21 added a dedicated Traefik router for sensitive Auth endpoints on `core.letscube.ru`:
  - paths: `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/verify`, `/auth/v1/otp`, `/auth/v1/resend`;
  - middleware: `letscube-auth-sensitive-rate`;
  - limits: average `20/min`, burst `40`, period `1m`;
  - router priority: `200`;
  - config backup: `/srv/letscube/backups/config/supabase-traefik-pre-auth-throttle-20260621-203230.yml`.
- Edge Function update on 2026-06-22 added an in-function rate limiter to
  `auth-yandex-gateway` for signup and password recovery before CAPTCHA
  verification or Supabase Auth calls. Defaults:
  - `KUB_AUTH_GATEWAY_RATE_WINDOW_SECONDS=900`
  - `KUB_AUTH_GATEWAY_EMAIL_LIMIT=5`
  - `KUB_AUTH_GATEWAY_IP_LIMIT=30`
  The values are runtime environment knobs; no secrets are stored in repo.

Applied migration proposal:

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

Configured controls:

- Server-side Auth rate limits in self-hosted GoTrue.
- Reverse proxy request throttling for `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/verify`.
- Edge Function request throttling inside `auth-yandex-gateway` for signup and
  recovery before CAPTCHA/Auth work.
- Friendly frontend messages for `429 Too Many Requests`.

Recommended next controls:

- Audit dashboard query for repeated failed login activity by IP/user agent if available in Auth logs.

Do not implement brute-force protection only in the frontend. Frontend cooldowns are helpful UX, but not security boundaries.

Supabase Auth documentation confirms that exceeded auth limits return HTTP 429 and that Auth uses rate limiting on authentication endpoints. For self-hosted LETSCUBE, explicit GoTrue email throttles and Traefik request throttling are now configured as the first production baseline.

Initial self-host targets configured and verified:

- Project-wide email send budget: `GOTRUE_RATE_LIMIT_EMAIL_SENT=60`.
- Minimum SMTP send interval: `GOTRUE_SMTP_MAX_FREQUENCY=60s`.
- Traefik auth endpoint throttle: `20/min` average, `40` burst for sensitive `/auth/v1/*` endpoints listed above.
- `supabase-kong`, `supabase-auth`, `supabase-rest`, `realtime-dev.supabase-realtime`, and `supabase-storage` returned healthy after the proxy update.
- `/auth/v1/settings` and `/login` returned HTTP 200 after the proxy update.
- UI: generic signup/recovery copy is in place and 429 maps to a friendly "too many attempts" message.
- 2026-06-22 regression coverage:
  - Yandex SmartCaptcha signup uses `auth-yandex-gateway`, not direct `/auth/v1/signup`.
  - Yandex SmartCaptcha recovery uses `auth-yandex-gateway`, not direct `/auth/v1/recover`.
  - Gateway HTTP 429 / `rate_limited` / `too_many_requests` responses show the friendly Russian rate-limit copy.
  - Login token endpoint HTTP 429 / `over_request_rate_limit` responses show the same friendly Russian rate-limit copy through the shared error mapper.
- 2026-06-22 live check:
  - direct external `POST /auth/v1/signup` with anon headers returned HTTP 403.
  - direct external `POST /auth/v1/recover` with anon headers returned HTTP 403.
  - repeated valid-shape `auth-yandex-gateway` signup requests without CAPTCHA
    returned five `captcha_required` responses followed by HTTP 429
    `rate_limited`.
  - Real brute-force load was not generated against production Auth; login 429 UX is covered by deterministic Playwright routing.

Next self-host targets to configure and validate:

- GoTrue IP-based rate limit header: configure only after the proxy chain strips/spoof-proofs client-supplied forwarding headers. Do not point Auth at an untrusted `X-Forwarded-For`.

## Anti-Spam / Multi-Account Stage

Goal: prevent unlimited bot-created accounts while still allowing real new users.

Recommended layered approach:

- CAPTCHA or equivalent bot check on signup/recovery if supported in the current self-hosted Auth deployment.
- Optional club invite / registration code for public signup.
- Optional admin approval state for newly created profiles before chat/task access.
- Rate limits and proxy throttling on signup and recovery.
- Monitoring for many new accounts from one IP / ASN / user agent.

Preferred LETSCUBE CAPTCHA provider is Yandex SmartCaptcha. Supabase Auth does
not expose Yandex as a native GoTrue CAPTCHA provider, so the secure path is an
Edge Function gateway that verifies the Yandex token server-side before calling
Supabase Auth.

Frontend support is prepared behind optional public build-time env:

- `VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha`
- `VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>`
- `VITE_AUTH_GATEWAY_URL=https://core.letscube.ru/functions/v1/auth-yandex-gateway`

Do not add CAPTCHA frontend-only; it must be enabled and verified server-side.
For Yandex SmartCaptcha the relevant secret-side Edge Function env names are:

- `YANDEX_SMARTCAPTCHA_SECRET=<provider secret>`
- `SUPABASE_ANON_KEY=<public anon key>`
- `KUB_AUTH_ALLOWED_REDIRECT_ORIGINS=https://app.letscube.ru`

Optional non-secret gateway rate-limit env names:

- `KUB_AUTH_GATEWAY_RATE_WINDOW_SECONDS=900`
- `KUB_AUTH_GATEWAY_EMAIL_LIMIT=5`
- `KUB_AUTH_GATEWAY_IP_LIMIT=30`

Full protection also requires blocking or rerouting public direct calls to
`/auth/v1/signup` and password recovery; otherwise bots can bypass the frontend
and hit Supabase Auth directly.

For self-hosted GoTrue Turnstile/hCaptcha fallback the relevant secret-side env
names are:

- `GOTRUE_SECURITY_CAPTCHA_ENABLED=true`
- `GOTRUE_SECURITY_CAPTCHA_PROVIDER=hcaptcha` or `turnstile`
- `GOTRUE_SECURITY_CAPTCHA_SECRET=<provider secret>`
- `GOTRUE_SECURITY_CAPTCHA_TIMEOUT=10s`

If external CAPTCHA providers are not acceptable for the Russian-hosted production posture, prefer invite/admin-approval flow as the next anti-spam layer.

If strict staff-only access is required later, prefer an invite-code or admin-created-account flow over fully open public signup.

## RLS Audit Follow-Up

Next read-only checks:

- List all `SECURITY DEFINER` functions callable by `anon`.
- Confirm each callable function validates `auth.uid()` / role permissions internally.
- Verify storage policies for chat media, avatars, and task attachments.
- Verify no policies depend on user-editable `raw_user_meta_data`.
- Verify task/admin RPCs are not executable by `anon`.

2026-06-21 read-only live audit result:

- `public` tables without RLS: `0`.
- policies referencing `raw_user_meta_data`: `0`.
- storage object policies are authenticated-only and path-scoped for chat/media access.
- many public `SECURITY DEFINER` functions are still callable through the default `anon`/`PUBLIC` execute grants; app-prefixed callable count was `50`.

Do not revoke execute privileges broadly without mapping frontend/RPC usage first.
