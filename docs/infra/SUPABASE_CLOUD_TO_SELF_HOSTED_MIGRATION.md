# Supabase Cloud To Self-Hosted Migration

This is a runbook, not an automated script. Do not apply SQL from this stage.

## 1. Inventory

- Current Supabase URL and project ref are recorded outside git.
- List applied migration proposal files.
- List Edge Functions and required secrets.
- List buckets and storage policies.
- List Auth providers:
  - email;
  - phone/SMS;
  - OAuth if any.
- List cron jobs:
  - recurring task scheduler;
  - push notification dispatcher.

## 2. Rehearsal

1. Bring up self-hosted Supabase.
2. Apply migrations to an empty database.
3. Generate fresh app-facing keys.
4. Restore a sanitized database dump.
5. Restore a sample of storage objects.
6. Run:
   - `pnpm.cmd rls:smoke`
   - `pnpm.cmd e2e:smoke`
   - role visibility tests
   - media and push smoke where configured.

## 3. Data migration

Plan a maintenance window.

- Freeze writes or put KUB into maintenance mode.
- Export Postgres schema/data from Cloud.
- Restore into self-hosted Postgres.
- Copy storage buckets and object metadata.
- Reconfigure Auth URLs.
- Deploy Edge Functions.
- Configure cron jobs.
- Run post-migration QA.

## 4. Cutover

- Rebuild frontend with self-hosted `VITE_SUPABASE_URL` and publishable key.
- Deploy KUB via Coolify.
- Point DNS for `kub.example.com` at the new node.
- Verify Auth, Realtime, Storage, RPC, Edge Functions, and push.

## 5. Rollback

Rollback is viable only while the old Supabase project remains intact and the
write freeze can be restored. If writes continue on the new backend, rollback
requires a reverse sync plan.

Rollback triggers:

- login or session restore broken;
- RLS denies normal role flows;
- message send/read broken;
- storage uploads broken;
- task routing or recurrence broken.
