# Cutover And Rollback Checklist

## Before cutover

- Rehearsal migration completed.
- Restore drill completed.
- DNS TTL lowered.
- New node has current deploy.
- Self-hosted Supabase is configured.
- Storage objects restored.
- Edge Functions deployed.
- Cron jobs configured.
- Secrets loaded from secret store, not git.
- QA accounts available.
- Rollback owner assigned.

## Cutover

1. Announce maintenance window.
2. Freeze writes or prevent user activity.
3. Take final database backup.
4. Take final storage sync.
5. Restore final data to self-hosted backend.
6. Rebuild/deploy frontend with new backend URL.
7. Switch DNS to `kub.example.com`.
8. Run post-migration QA.
9. Watch logs, Realtime, push dispatcher, and scheduler.

## Rollback triggers

- Users cannot login.
- Password recovery/auth callback broken.
- Message send broken.
- Realtime missing incoming messages.
- Storage uploads broken.
- Task permissions broken.
- Recurring scheduler creates wrong occurrences.
- Push dispatcher sends to wrong users.

## Rollback action

- Stop writes on new backend.
- Repoint DNS to previous environment.
- Restore previous frontend env.
- Keep new backend data for analysis.
- Decide whether reverse data sync is required.
