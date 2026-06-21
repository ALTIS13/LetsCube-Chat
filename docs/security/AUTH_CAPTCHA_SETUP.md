# LETSCUBE Auth CAPTCHA Setup

Status: prepared frontend path, server-side provider not enabled yet.

## What Is Implemented

The web app can now render Cloudflare Turnstile on:

- registration;
- password recovery.

The CAPTCHA widget is disabled by default. It appears only when public Vite
build-time variables are present:

```env
VITE_AUTH_CAPTCHA_PROVIDER=turnstile
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
```

When enabled, the app passes the resulting token to Supabase Auth through
`captchaToken` for signup and recovery requests.

## What Must Stay Server-Side

The provider secret must never be added to the frontend, docs, Docker build
args, APK, service worker, or git.

For self-hosted Supabase Auth / GoTrue, configure the secret only in the Auth
service environment:

```env
GOTRUE_SECURITY_CAPTCHA_ENABLED=true
GOTRUE_SECURITY_CAPTCHA_PROVIDER=turnstile
GOTRUE_SECURITY_CAPTCHA_SECRET=<provider secret>
GOTRUE_SECURITY_CAPTCHA_TIMEOUT=10s
```

Then recreate only the Auth container:

```bash
cd /srv/letscube/platform/supabase-docker
docker compose up -d --force-recreate --no-deps auth
```

## Coolify Frontend Env

After the server-side Auth secret is configured, set these public values in the
Coolify `letscube-web` app and redeploy:

```env
VITE_AUTH_CAPTCHA_PROVIDER=turnstile
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
```

These are build-time values. Restart is not enough; rebuild/redeploy the web
app.

## Provider Choice

Supabase Auth supports hCaptcha and Cloudflare Turnstile. If foreign CAPTCHA
providers are not acceptable for production reliability, keep CAPTCHA disabled
and use an invite/admin-approval registration model instead.

## Manual QA

1. Open `https://app.letscube.ru/register`.
2. Confirm the CAPTCHA widget is visible.
3. Submit without completing CAPTCHA: the app should show a friendly prompt.
4. Complete CAPTCHA and register a test account.
5. Confirm Supabase Auth sends a confirmation email only after CAPTCHA passes.
6. Repeat for `https://app.letscube.ru/login?reset=1`.
7. Confirm no raw provider errors, tokens, or debug payloads appear in the UI.
