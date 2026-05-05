# KUB Messenger

KUB is a messenger project built as a React/Vite web app that uses Supabase as the backend. The repository also includes Docker/Caddy deployment templates for running the built web app on your own server.

## Stack

- React + Vite frontend in `artifacts/kub`
- Supabase Auth, database, storage, and realtime backend
- Docker image for the static web bundle
- Caddy reverse proxy template for HTTPS

SQL migrations are stored in `.migration-backup/supabase/migrations/`.
Supabase integration notes and migration order are documented in `docs/SUPABASE_AUDIT.md`.

## Local Development

```bash
pnpm install
cp .env.example .env
```

Edit `.env` and set your own Supabase values:

```env
VITE_SUPABASE_URL=<YOUR_SUPABASE_URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_PUBLISHABLE_KEY>
VITE_SUPABASE_ANON_KEY=
VITE_VAPID_PUBLIC_KEY=
BASE_PATH=/
PORT=5173
KUB_WEB_PORT=8080
```

Start the Vite dev server:

```bash
pnpm --filter @workspace/kub run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Build

```bash
pnpm run typecheck
pnpm --filter @workspace/kub run build
```

The frontend build output is created under `artifacts/kub/dist/public`.

## Server Deployment

Clone your private repository and create a local production env file:

```bash
git clone <YOUR_REPO_URL>
cd kub-messenger/docs/deploy
cp ../../.env.production.example .env
```

Edit `docs/deploy/.env` with your values:

```env
VITE_SUPABASE_URL=<YOUR_SUPABASE_URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<YOUR_SUPABASE_PUBLISHABLE_KEY>
KUB_WEB_PORT=8080
```

Build and run the container:

```bash
docker compose up -d --build
```

Before production, configure your own domain, for example `https://your-domain.example`, in Caddy and in Supabase Auth URL Configuration. Use `docs/deploy/Caddyfile.example` as the Caddy template.

If port `8080` is already used on the server, change `KUB_WEB_PORT` to any free local port and proxy Caddy to the same port.

## Supabase

Supabase remains the backend for KUB. Before production:

- Apply the SQL migrations from `.migration-backup/supabase/migrations/`.
- Set your Supabase Site URL to `https://your-domain.example`.
- Add your production and local Redirect URLs, for example `https://your-domain.example/**` and `http://localhost:5173/**`.
- Use only publishable/anon keys in the frontend.

`SUPABASE_SERVICE_ROLE_KEY` must never be placed in frontend env files, Vite build args, committed files, or public Docker images.

Detailed deployment steps are in `docs/DEPLOYMENT.md`.

For Coolify deployments, see `docs/COOLIFY.md`. For production verification, use `docs/SMOKE_TESTS.md`.
