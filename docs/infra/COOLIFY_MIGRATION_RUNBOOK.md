# Coolify Migration Runbook

This runbook covers the KUB web/PWA deployment layer. Supabase backend
migration is covered separately but must be coordinated with the frontend
environment variables.

## Preflight

- Confirm repository access from Coolify.
- Confirm Docker Compose file:
  - `docs/deploy/docker-compose.coolify.yml` when Coolify owns proxy;
  - `docs/deploy/docker-compose.yml` when a host proxy maps a local port.
- Confirm target domain placeholder: `kub.example.com`.
- Collect required frontend env names, not values:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `VITE_VAPID_PUBLIC_KEY`
  - `VITE_SENTRY_DSN` later, optional
  - `BASE_PATH`
  - `PORT`

## Setup

1. Create a new Coolify project.
2. Connect the private repository.
3. Select Docker Compose build pack.
4. Set the compose file path.
5. Set the domain in Coolify UI.
6. Add env values in Coolify UI, not in git.
7. Deploy from the intended branch.

## Validation

- Open `https://kub.example.com`.
- Direct refresh `/tasks`.
- Direct refresh `/admin`.
- Auth callback route remains reachable.
- Service worker registers.
- Push settings page renders.
- No frontend bundle contains service-role or private VAPID values.

## Rollback

- Keep previous deployment reachable until post-cutover QA passes.
- Lower DNS TTL before cutover.
- Revert DNS or Coolify active deployment if:
  - login fails for all users;
  - Supabase Auth callback is broken;
  - Realtime cannot connect;
  - media uploads fail broadly.
