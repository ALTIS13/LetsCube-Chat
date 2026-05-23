# Supabase Self-Hosted Runbook

Self-hosted Supabase should be treated as one backend platform for KUB:
Postgres, Auth, Realtime, Storage, PostgREST/RPC, Edge Functions, API gateway,
and Studio.

Reference:

- https://supabase.com/docs/guides/self-hosting
- https://supabase.com/docs/guides/self-hosting/docker

## Preflight

- Confirm the self-hosted Supabase version.
- Confirm backups and restore process.
- Generate secrets outside the repo.
- Prepare domains and proxy routes.
- Prepare SMTP and SMS provider decisions.
- Prepare VAPID and push dispatcher secrets.

## Required configuration areas

Auth:

- Site URL: `https://kub.example.com`
- Redirect URLs:
  - `https://kub.example.com/`
  - `https://kub.example.com/**`
  - `https://kub.example.com/auth/callback`
- SMTP provider for email confirmation/recovery.
- SMS provider for phone verification when enabled.

Postgres/RLS:

- Apply reviewed migrations from `.migration-backup/supabase/migrations/`.
- Keep RLS enabled.
- Validate dynamic roles, task permissions, and storage policies.

Realtime:

- Enable websocket proxy support.
- Enable the tables used by chat, notifications, tasks, and presence.

Storage:

- Create required buckets.
- Apply bucket policies.
- Restore media objects before broad user QA.

Edge Functions:

- Deploy recurring scheduler function.
- Deploy push dispatcher function.
- Configure secrets in Supabase runtime only.

## Secrets

Never commit values. Store them in the self-hosted Supabase environment,
Coolify secrets, a password manager, or a dedicated secret manager.

See [Secrets matrix](./SECRETS_MATRIX.md).

## Smoke checks

- Auth login/logout.
- Password recovery.
- Realtime message delivery.
- Storage upload/view.
- RPC smoke.
- Recurring scheduler.
- Push dispatcher.
- RLS by role.
