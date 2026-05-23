# Infrastructure Documentation

This directory describes how to move KUB from the current managed-backend
model toward a self-hosted node while keeping secrets outside the repository.

The target examples use placeholders:

- `kub.example.com`
- `sentry.example.com`
- `admin@example.com`

Do not replace these placeholders in committed docs with real production
values.

## Documents

- [Self-hosting overview](./SELF_HOSTING_OVERVIEW.md)
- [Node requirements](./NODE_REQUIREMENTS.md)
- [Coolify migration runbook](./COOLIFY_MIGRATION_RUNBOOK.md)
- [Supabase self-hosted runbook](./SUPABASE_SELF_HOSTED_RUNBOOK.md)
- [Supabase Cloud to self-hosted migration](./SUPABASE_CLOUD_TO_SELF_HOSTED_MIGRATION.md)
- [Storage migration runbook](./STORAGE_MIGRATION_RUNBOOK.md)
- [Mail self-hosting runbook](./MAIL_SELF_HOSTING_RUNBOOK.md)
- [Phone verification runbook](./PHONE_VERIFICATION_RUNBOOK.md)
- [Sentry self-hosted runbook](./SENTRY_SELF_HOSTED_RUNBOOK.md)
- [Backup and restore runbook](./BACKUP_RESTORE_RUNBOOK.md)
- [DNS/TLS/networking runbook](./DNS_TLS_NETWORKING_RUNBOOK.md)
- [Cutover and rollback checklist](./CUTOVER_ROLLBACK_CHECKLIST.md)
- [Secrets matrix](./SECRETS_MATRIX.md)
- [Post-migration QA checklist](./POST_MIGRATION_QA_CHECKLIST.md)

## Boundary

Self-hosted Supabase is treated as one backend platform that includes:

- Postgres;
- Auth;
- Realtime;
- Storage;
- PostgREST/RPC;
- Edge Functions;
- API gateway and Studio.

Those are not independent KUB infrastructure blocks; they must be migrated,
backed up, monitored, and rolled back together.
