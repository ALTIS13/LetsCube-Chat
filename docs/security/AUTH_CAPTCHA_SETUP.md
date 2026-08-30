# LETSCUBE Auth CAPTCHA Setup

Status: trusted gateway supports Yandex SmartCaptcha and Cloudflare Turnstile;
provider secrets are not configured in the repository.

## What Is Implemented

The web app can render CAPTCHA on:

- registration;
- confirmation-email resend;
- password recovery.

All three operations use `auth-yandex-gateway`; normal password login remains a
direct Supabase Auth operation. There is no direct browser fallback to
`/auth/v1/signup` or `/auth/v1/recover`. If a supported provider and public site
key are absent, registration, resend, and recovery fail closed with the existing
friendly unavailable-protection message.

The CAPTCHA widget appears only when public Vite build-time variables are
present:

```env
VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
VITE_AUTH_GATEWAY_URL=https://core.letscube.ru/functions/v1/auth-yandex-gateway
```

`VITE_AUTH_GATEWAY_URL` is optional if the gateway is served from the same
Supabase URL: the app falls back to
`<VITE_SUPABASE_URL>/functions/v1/auth-yandex-gateway`.

The client sends the public provider identifier with the token. The gateway
accepts only a supported provider that matches its server configuration and
verifies the token before calling Supabase Auth. Legacy Yandex clients that omit
`captchaProvider` use the configured server provider, or Yandex when no provider
name was previously configured.

Cloudflare Turnstile remains supported as a fallback provider:

```env
VITE_AUTH_CAPTCHA_PROVIDER=turnstile
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
```

Turnstile uses the same trusted gateway and is verified against Cloudflare's
server-side Siteverify endpoint. Its secret never enters Supabase Auth payloads
or frontend code.

## What Must Stay Server-Side

The provider secret must never be added to the frontend, docs, Docker build
args, APK, service worker, or git.

Configure exactly one matching provider and secret in the Edge Function runtime.
Yandex production configuration:

```env
KUB_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha
YANDEX_SMARTCAPTCHA_SECRET=<provider secret>
SUPABASE_ANON_KEY=<public anon key>
KUB_AUTH_ALLOWED_REDIRECT_ORIGINS=https://app.letscube.ru
```

Turnstile configuration:

```env
KUB_AUTH_CAPTCHA_PROVIDER=turnstile
TURNSTILE_SECRET_KEY=<provider secret>
SUPABASE_ANON_KEY=<public anon key>
KUB_AUTH_ALLOWED_REDIRECT_ORIGINS=https://app.letscube.ru
```

Do not configure both providers for one deployment. Do not print or log a
provider secret or response token.

Optional gateway rate-limit knobs:

```env
KUB_AUTH_GATEWAY_RATE_WINDOW_SECONDS=900
KUB_AUTH_GATEWAY_EMAIL_LIMIT=5
KUB_AUTH_GATEWAY_IP_LIMIT=30
```

These values are not secrets. They tune the Edge Function limiter for signup,
resend, and recovery. Login brute-force protection remains on GoTrue/proxy rate
limits because normal password login does not go through this CAPTCHA gateway.

## Coolify Frontend Env

After the matching server-side gateway secret is configured, set the same public
provider and its public site key in the Coolify `letscube-web` app and redeploy:

```env
VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha
VITE_AUTH_CAPTCHA_SITE_KEY=<public site key>
VITE_AUTH_GATEWAY_URL=https://core.letscube.ru/functions/v1/auth-yandex-gateway
```

These are build-time values. Restart is not enough; rebuild/redeploy the web
app.

## Provider Choice

Preferred production provider for LETSCUBE is Yandex SmartCaptcha because the
production stack is Russian-hosted. Turnstile remains a documented supported
alternative through the same server-side gateway contract.

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
7. Repeat for confirmation resend and `https://app.letscube.ru/login?reset=1`.
8. Confirm each request includes the public provider identifier and no provider
   secret.
9. Confirm no raw provider errors, tokens, or debug payloads appear in the UI.
10. Optional smoke: send repeated valid-shape signup/recovery gateway requests
   without a CAPTCHA token and confirm the gateway eventually returns HTTP 429
   `rate_limited` before any Supabase Auth call.
