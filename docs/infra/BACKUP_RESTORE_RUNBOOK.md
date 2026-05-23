# Backup And Restore Runbook

Backups are not complete until restore has been tested.

## Backup scope

- Postgres database.
- Supabase Storage objects.
- Supabase configuration and secrets inventory.
- Edge Function source and deployment config.
- Coolify app configuration.
- Reverse proxy/DNS notes.

## Minimum policy

- Daily database backup.
- Storage object backup.
- Off-node encrypted storage.
- Retention policy sized for the 120 GB node.
- Restore drill before production cutover.

## Restore drill

1. Provision clean rehearsal environment.
2. Restore database.
3. Restore storage objects.
4. Recreate secrets from password manager/secret store.
5. Deploy Edge Functions.
6. Rebuild frontend against restored backend.
7. Run post-migration QA.

## Failure cases to test

- Restore with missing storage object.
- Restore with expired Auth links.
- Restore after Edge Function secret rotation.
- Restore while Realtime subscriptions reconnect.

## Do not store

- Plaintext secret dumps in git.
- Database dumps in git.
- Media bucket archives in git.
- Production `.env` files in git.
