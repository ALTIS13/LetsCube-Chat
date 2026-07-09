# KUB Deployment Guide

This guide describes a universal production deployment for KUB. It intentionally does not contain a real domain, real server ports, Supabase secrets, service role keys, or private VAPID keys.

Use placeholders such as:

- `https://your-domain.example`
- `app.example.com`
- `<YOUR_DOMAIN>`
- `<YOUR_SUPABASE_URL>`
- `<YOUR_SUPABASE_PUBLISHABLE_KEY>`

## Project Layout

- `artifacts/kub` - React/Vite frontend.
- `docs/deploy/Dockerfile` - builds the frontend and serves it with nginx.
- `docs/deploy/docker-compose.yml` - local container binding for the web app.
- `docs/deploy/docker-compose.coolify.yml` - Coolify-managed proxy compose variant.
- `docs/deploy/Caddyfile.example` - universal Caddy reverse proxy template.
- `.env.production.example` - safe production env template.
- `.migration-backup/supabase/migrations/` - Supabase SQL migrations.

Supabase remains the backend: Auth, database, storage, realtime, and policies are configured in Supabase, not inside the web container.

## 1. Clone The Repository

```bash
git clone <YOUR_REPO_URL>
cd kub-messenger
```

Use a new private repository for KUB. Do not push to an old template remote. See `docs/GIT_SETUP.md` for GitHub setup commands.

## 2. Create The Production Env File

Docker Compose reads `.env` from the directory where `docker compose` is run. The deployment template expects you to run Compose from `docs/deploy`.

```bash
cd docs/deploy
cp ../../.env.production.example .env
```

Edit `docs/deploy/.env`:

```env
VITE_SUPABASE_URL=<YOUR_SUPABASE_URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_PUBLISHABLE_KEY>
VITE_SUPABASE_ANON_KEY=
VITE_VAPID_PUBLIC_KEY=
VITE_AUTH_CAPTCHA_PROVIDER=
VITE_AUTH_CAPTCHA_SITE_KEY=
VITE_AUTH_GATEWAY_URL=
VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=0
BASE_PATH=/
PORT=5173
KUB_WEB_PORT=8080
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SELFHOST_SERVICE_ROLE_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_CONTACT=mailto:admin@example.com
MEDIA_VARIANTS_WORKER_ENABLED=1
MEDIA_VARIANTS_WORKER_TICK_MS=60000
```

Notes:

- `VITE_SUPABASE_PUBLISHABLE_KEY` is the public browser key.
- `VITE_SUPABASE_ANON_KEY` is kept only as a compatibility fallback. Leave it empty if you use the publishable key.
- `VITE_VAPID_PUBLIC_KEY` is optional unless browser push is enabled.
- `VITE_AUTH_CAPTCHA_PROVIDER`, `VITE_AUTH_CAPTCHA_SITE_KEY`, and optional `VITE_AUTH_GATEWAY_URL` are public build-time values for signup/recovery bot protection. For `yandex-smartcaptcha`, provider secret must live only in the `auth-yandex-gateway` Edge Function runtime environment.
- Keep `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=0` until `.migration-backup/supabase/migrations/20260709_chat_list_summaries.sql` is applied manually and verified. Set it to `1` only for the next web rebuild after that verification.
- Do not add private server secrets to frontend env files.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` / `SELFHOST_SERVICE_ROLE_KEY`, `VAPID_*` and `MEDIA_VARIANTS_*` are runtime values for the optional `kub-worker` service only. They must not be sent as Vite build args or exposed in the static web image.

`SUPABASE_SERVICE_ROLE_KEY` must never be passed to the Vite frontend, Docker build args, static web image, or committed files.

## 3. Choose The Local Web Port

The default local container binding is:

```yaml
ports:
  - "127.0.0.1:${KUB_WEB_PORT:-8080}:80"
```

This keeps the container reachable only from the server itself. Caddy will be the public HTTPS entry point.

If `8080` is busy, set any free local port:

```env
KUB_WEB_PORT=<FREE_LOCAL_PORT>
```

Then proxy Caddy to the same port:

```caddyfile
reverse_proxy 127.0.0.1:<FREE_LOCAL_PORT>
```

## 4. Build And Start Docker

Run from `docs/deploy`:

```bash
docker compose up -d --build
docker compose ps
```

Check the local container:

```bash
curl -I http://127.0.0.1:${KUB_WEB_PORT:-8080}
```

If you change any `VITE_*` value, rebuild the image:

```bash
docker compose up -d --build
```

Restart alone is not enough because Vite embeds `VITE_*` values at build time.

## 5. Configure Caddy

Copy the universal template:

```bash
sudo cp Caddyfile.example /etc/caddy/Caddyfile
```

Edit `/etc/caddy/Caddyfile`:

- Replace `your-domain.example` with your domain, for example `app.example.com`.
- Replace `8080` with your `KUB_WEB_PORT` value if you changed it.

Template:

```caddyfile
your-domain.example {
    encode zstd gzip

    reverse_proxy 127.0.0.1:8080 {
        header_up Host {host}
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-For {remote_host}
        header_up X-Real-IP {remote_host}
    }

    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }
}
```

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 6. Configure Supabase Auth URLs

In Supabase Dashboard open Authentication -> URL Configuration.

Set:

```text
Site URL: https://your-domain.example
```

Add Redirect URLs for every environment you use:

```text
https://your-domain.example/
https://your-domain.example/**
https://your-domain.example/auth/callback
http://localhost:5173/**
http://localhost:5173/auth/callback
```

If your production domain is `<YOUR_DOMAIN>`, use:

```text
https://<YOUR_DOMAIN>/
https://<YOUR_DOMAIN>/**
https://<YOUR_DOMAIN>/auth/callback
```

The configured Supabase URLs must match the domain users open in the browser. Otherwise login redirects and magic links can fail.

Current temporary test deployment example:

```text
Site URL:
https://kub.apollot.ru

Redirect URLs:
https://kub.apollot.ru/
https://kub.apollot.ru/**
https://kub.apollot.ru/auth/callback
http://localhost:5173/**
http://localhost:5173/auth/callback
```

Do not hardcode the test domain in source code. The frontend builds email
confirmation redirects from the current browser origin and `BASE_PATH`. When
the domain changes later, update Supabase Auth URL Configuration, DNS/proxy
settings, and deployment environment values only.

## 7. Apply Supabase Migrations

SQL migration files are stored in:

```text
.migration-backup/supabase/migrations/
```

Apply them to your own Supabase project before production. Review migrations before applying them to an existing database.
Apply migrations in filename order. The current order and integration notes are documented in `docs/SUPABASE_AUDIT.md`.

## 8. Local Adaptation Example

This example uses placeholders only:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_PUBLISHABLE_KEY>
VITE_AUTH_CAPTCHA_PROVIDER=
VITE_AUTH_CAPTCHA_SITE_KEY=
VITE_AUTH_GATEWAY_URL=
BASE_PATH=/
KUB_WEB_PORT=8080
```

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

If you use a different local port, change both `KUB_WEB_PORT` and the Caddy `reverse_proxy` target.

## 9. Pre-Push Safety Checklist

Before creating the first release commit, verify:

```bash
git status
git remote -v
git ls-files .env .env.local .env.production attached_assets node_modules dist build
```

The last command should not show local env files, attachments, dependencies, or build outputs.

Search for hardcoded deployment values:

```bash
git grep -n "your real domain" -- .
git grep -n "service_role" -- .
```

Do not commit real Supabase URL/key pairs, `SUPABASE_SERVICE_ROLE_KEY`, VAPID private keys, real production `.env` files, local server settings, or private Caddy files.

## 10. Update Existing Deployment

On the server:

```bash
git pull
cd docs/deploy
docker compose up -d --build
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

When changing domains, also update Supabase Auth URL Configuration.

For Coolify deployments, see `docs/COOLIFY.md`. For production smoke testing, use `docs/SMOKE_TESTS.md`.
