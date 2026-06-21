# LETSCUBE Auth CAPTCHA Setup

Status: prepared frontend path, Yandex SmartCaptcha gateway path added, provider
secret not configured in repo.

## What Is Implemented

The web app can render CAPTCHA on:

- registration;
- password recovery.

The CAPTCHA widget is disabled by default. It appears only when public Vite
build-time variables are present:

```env
VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
VITE_AUTH_GATEWAY_URL=https://core.letscube.ru/functions/v1/auth-yandex-gateway
```

`VITE_AUTH_GATEWAY_URL` is optional if the gateway is served from the same
Supabase URL: the app falls back to
`<VITE_SUPABASE_URL>/functions/v1/auth-yandex-gateway`.

For `yandex-smartcaptcha`, the app sends signup/recovery requests to the
`auth-yandex-gateway` Edge Function. The function verifies the SmartCaptcha
token server-side before calling Supabase Auth.

Cloudflare Turnstile remains supported as a fallback provider:

```env
VITE_AUTH_CAPTCHA_PROVIDER=turnstile
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
```

For Turnstile, the app passes the token to Supabase Auth through
`captchaToken`, which requires Supabase Auth/GoTrue CAPTCHA support to be
enabled server-side.

## What Must Stay Server-Side

The provider secret must never be added to the frontend, docs, Docker build
args, APK, service worker, or git.

For Yandex SmartCaptcha, configure the secret only in the Edge Function runtime:

```env
YANDEX_SMARTCAPTCHA_SECRET=<provider secret>
SUPABASE_ANON_KEY=<public anon key>
KUB_AUTH_ALLOWED_REDIRECT_ORIGINS=https://app.letscube.ru
```

Do not print or log the SmartCaptcha secret or response token.

For Turnstile/hCaptcha through self-hosted Supabase Auth / GoTrue, configure
the secret only in the Auth service environment:

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

After the server-side Yandex gateway secret is configured, set these public
values in the Coolify `letscube-web` app and redeploy:

```env
VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
VITE_AUTH_GATEWAY_URL=https://core.letscube.ru/functions/v1/auth-yandex-gateway
```

These are build-time values. Restart is not enough; rebuild/redeploy the web
app.

## Provider Choice

Preferred provider for LETSCUBE is Yandex SmartCaptcha because the production
stack is Russian-hosted. Supabase Auth does not currently expose Yandex as a
native `GOTRUE_SECURITY_CAPTCHA_PROVIDER`, so the app uses a separate
server-side Edge Function gateway for this provider.

Important hardening note: a frontend gateway only protects the official app UI.
For full anti-bot protection, public direct calls to `/auth/v1/signup` and
password recovery must be restricted or routed through the gateway at the
Supabase/Kong/Caddy layer. Until that is done, bots that know the public Auth
endpoint can bypass the frontend.

## Manual QA

1. Open `https://app.letscube.ru/register`.
2. Confirm the Yandex SmartCaptcha widget is visible.
3. Submit without completing CAPTCHA: the app should show a friendly prompt.
4. Complete CAPTCHA and register a test account.
5. Confirm the request goes to `/functions/v1/auth-yandex-gateway`, not directly
   to `/auth/v1/signup`.
6. Confirm Supabase Auth sends a confirmation email only after CAPTCHA passes.
7. Repeat for `https://app.letscube.ru/login?reset=1`.
8. Confirm no raw provider errors, tokens, or debug payloads appear in the UI.
