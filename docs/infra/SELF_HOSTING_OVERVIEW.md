# Self-Hosting Overview

Target server:

- 8 CPU cores;
- 12 GB RAM;
- 120 GB storage.

This is enough for a small production or rehearsal node if storage growth is
controlled, backups are off-node, and monitoring is kept practical. It is not
enough to treat the node as unlimited storage for database, media, backups,
logs, Sentry, and Docker images at the same time.

## Target services

Minimum stack:

- Coolify or equivalent deploy orchestrator;
- KUB web/PWA container;
- self-hosted Supabase stack:
  - Postgres;
  - Auth;
  - Realtime;
  - Storage;
  - PostgREST/RPC;
  - Edge Functions;
  - API gateway;
  - Studio for admin access;
- reverse proxy and TLS;
- backup job and off-node backup target;
- optional Sentry self-host later.

## Recommended rollout

1. Rehearsal node with empty/test data.
2. Restore production-like dump into rehearsal.
3. Run post-migration QA.
4. Fix docs/config drift.
5. Schedule cutover window.
6. Freeze writes or enter maintenance window.
7. Final database and storage sync.
8. DNS cutover to `kub.example.com`.
9. Post-cutover QA.
10. Keep rollback path warm until the new node is stable.

## Non-goals

- No secrets in git.
- No frontend service-role key.
- No SQL applied from this documentation stage.
- No hardcoded production domain in source code.
- No self-hosted Sentry until pre-packaging monitoring review.

## Main risks

- Storage exhaustion from media, backups, logs, and Docker layers.
- Auth redirect URL mismatch during cutover.
- Realtime websocket proxy misconfiguration.
- Storage object paths copied without matching bucket policies.
- Edge Function secrets missing after migration.
- Backup exists but restore was never tested.
