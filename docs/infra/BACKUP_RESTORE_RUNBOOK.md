# LETSCUBE Backup And Restore Runbook

Backups are not complete until restore has been tested. This runbook describes the current self-hosted LETSCUBE setup and the safe sequence for backup verification and restore rehearsal.

Do not store database dumps, media archives, plaintext env files, mail configs, private keys, or service credentials in git.

## Current Production Backup Setup

- Server: `ms.letscube.ru`.
- Local backup root: `/srv/letscube/backups/automated`.
- Backup script: `/srv/letscube/scripts/letscube-backup.sh`.
- Systemd service: `letscube-backup.service`.
- Systemd timer: `letscube-backup.timer`.
- Schedule: daily around `03:35` MSK with randomized delay.
- Retention: 14 days under `/srv/letscube/backups/automated`.
- Logs: `/srv/letscube/logs/backups/letscube-backup-*.log`.

The latest read-only inventory is tracked in `docs/infra/BACKUP_RESTORE_STATUS_20260622.md`.

## Backup Scope

The current script backs up:

- Self-hosted Supabase Postgres: `db/supabase-postgres.custom`.
- Supabase Storage volume: `storage/supabase-storage.tgz`.
- Supabase functions, auth email templates, compose and env/config files: `config/letscube-configs.tgz`.
- Coolify Postgres: `db/coolify-postgres.custom`.
- Coolify Redis volume: `volumes/coolify-redis.tgz`.
- Mailcow MySQL: `db/mailcow.sql`.
- Mailcow mail/config-related Docker volumes: `volumes/mailcowdockerized_*.tgz`.
- Backup manifest: `MANIFEST.txt`.
- Checksums: `SHA256SUMS`.

The config archive contains secrets and must stay root-only.

## Manual Local Backup Check

Run on the server:

```bash
/srv/letscube/scripts/letscube-backup.sh check
```

Run a manual backup only when useful before a risky operation:

```bash
/srv/letscube/scripts/letscube-backup.sh run
```

Find the latest backup:

```bash
latest="$(find /srv/letscube/backups/automated -mindepth 1 -maxdepth 1 -type d | sort | tail -n1)"
printf '%s\n' "$latest"
```

Verify checksums:

```bash
cd "$latest"
sha256sum -c SHA256SUMS
```

Verify Postgres custom dumps are readable without restoring:

```bash
pg_restore -l "$latest/db/supabase-postgres.custom" >/tmp/supabase-restore-list.txt
pg_restore -l "$latest/db/coolify-postgres.custom" >/tmp/coolify-restore-list.txt
```

Verify archive readability without extracting:

```bash
tar -tzf "$latest/storage/supabase-storage.tgz" >/tmp/supabase-storage-list.txt
tar -tzf "$latest/config/letscube-configs.tgz" >/tmp/letscube-config-list.txt
for archive in "$latest"/volumes/*.tgz; do
  tar -tzf "$archive" >/dev/null
done
```

## Restore Baseline Counts

Collect counts before a restore rehearsal and compare them after restore. Do not query sensitive row contents.

```bash
docker exec supabase-db psql -U postgres -d postgres -Atc "
select 'auth.users', count(*)::text from auth.users
union all select 'public.profiles', count(*)::text from public.profiles
union all select 'public.chats', count(*)::text from public.chats
union all select 'public.chat_members', count(*)::text from public.chat_members
union all select 'public.messages', count(*)::text from public.messages
union all select 'public.tasks', count(*)::text from public.tasks
union all select 'public.notifications', count(*)::text from public.notifications
union all select 'storage.objects.total', count(*)::text from storage.objects;
"
docker exec supabase-db psql -U postgres -d postgres -Atc "
select 'storage.bucket.' || bucket_id, count(*)::text
from storage.objects
group by bucket_id
order by bucket_id;
"
```

## Offsite Backup

Local backups protect against bad migrations and operator mistakes. They do not protect against full server loss.

Prepared tooling:

- Script: `/srv/letscube/scripts/letscube-offsite-backup.sh`.
- Service: `letscube-offsite-backup.service`.
- Timer: `letscube-offsite-backup.timer`.
- Tools installed on the server: `rclone`, `restic`, `borg`.

Current status: offsite backup is intentionally disabled until a remote target is configured.

Configure only on the server or in a password manager, never in git. Edit `/srv/letscube/secrets/letscube-infra.env` and set one mode.

Rclone mode:

```bash
BACKUP_REMOTE_TYPE=rclone
BACKUP_RCLONE_REMOTE=<rclone-remote:path>
```

Restic mode:

```bash
BACKUP_REMOTE_TYPE=restic
BACKUP_RESTIC_REPOSITORY=<restic-repository-url-or-path>
BACKUP_ENCRYPTION_PASSWORD=<strong-secret-in-password-manager>
```

Borg mode:

```bash
BACKUP_REMOTE_TYPE=borg
BACKUP_BORG_REPOSITORY=<borg-repository>
```

After configuration:

```bash
/srv/letscube/scripts/letscube-offsite-backup.sh check
/srv/letscube/scripts/letscube-offsite-backup.sh sync-latest
systemctl enable --now letscube-offsite-backup.timer
systemctl list-timers --all 'letscube-offsite-backup.timer'
```

Do one controlled offsite sync and verify the remote object list before enabling the timer.

## Temporary GitHub Encrypted Offsite Backup

Until a dedicated backup environment is ready, the server also has a temporary encrypted GitHub offsite path.

Repository:

- `ALTIS13/letscube-encrypted-backups`
- Visibility: private.
- Contents: encrypted `age` chunks only, not raw backups.

Server files:

- Script: `/srv/letscube/scripts/letscube-github-offsite-backup.sh`
- Service: `letscube-github-offsite-backup.service`
- Timer: `letscube-github-offsite-backup.timer`
- Deploy key: `/srv/letscube/secrets/github-backup-ed25519`

Security properties:

- The script encrypts the latest local backup set before upload.
- The repository receives only encrypted chunks plus manifests/checksums.
- The deploy key is scoped to the backup repository.
- The decryption private key must stay outside GitHub.
- Do not add raw backup archives to this repository.

Manual check:

```bash
/srv/letscube/scripts/letscube-github-offsite-backup.sh check
```

Manual upload of the latest local backup:

```bash
/srv/letscube/scripts/letscube-github-offsite-backup.sh sync-latest
```

Timer status:

```bash
systemctl status letscube-github-offsite-backup.timer --no-pager -l
systemctl list-timers --all 'letscube-github-offsite-backup.timer'
```

The current implementation force-pushes the latest encrypted snapshot to `main` so the branch view does not grow with every daily backup. GitHub is still not a real backup platform; replace this temporary path with `rclone`, `restic`, or `borg` on dedicated backup storage.

Decrypt on a trusted machine with the matching private key:

```bash
cat chunks/letscube-<STAMP>.tar.age.part-* > letscube-<STAMP>.tar.age
sha256sum -c encrypted.sha256
age --decrypt -i /path/to/operator_private_key letscube-<STAMP>.tar.age > letscube-<STAMP>.tar
tar -xf letscube-<STAMP>.tar
```

The extracted directory contains sensitive production backup material. Keep it outside git and public storage.

## Restore Rehearsal Target

Do not restore into production for the first drill.

Use one of these isolated targets:

- Separate temporary VPS with similar OS/Docker versions.
- Isolated Docker Compose stack on a separate host.
- Separate local lab machine with enough disk space.

Do not use a plain empty Postgres database as the only restore drill. A Supabase backup needs a Supabase-initialized environment with managed schemas/extensions/publications.

## Restore Rehearsal Sequence

1. Provision the isolated target.
2. Install Docker and Docker Compose.
3. Apply the same Docker address-pool avoidance rule used on production if the target network needs it.
4. Start a clean self-hosted Supabase stack so managed schemas and services exist.
5. Copy the selected backup set to the isolated target.
6. Verify checksums on the target:

```bash
cd /path/to/backup-set
sha256sum -c SHA256SUMS
```

7. Stop API-facing services on the rehearsal stack.
8. Restore Supabase Postgres into the rehearsal Supabase DB.
9. Restore `storage/supabase-storage.tgz` into the rehearsal storage volume.
10. Restore functions/auth templates/config from `config/letscube-configs.tgz`, replacing secrets only from the password manager or controlled secret store.
11. Start Supabase services.
12. Run row-count and storage-count comparison.
13. Rebuild or point a rehearsal frontend to the rehearsal Supabase URL.
14. Run smoke checks:
    - login;
    - profile load;
    - private chat list;
    - media sample opens;
    - password recovery email can be generated in rehearsal mode;
    - Edge Functions health;
    - cron/net response table check if enabled.

## Production Restore Warning

Production restore is a maintenance-window operation. Before any production restore:

- Freeze writes if possible.
- Take a fresh manual backup.
- Confirm latest offsite copy exists.
- Confirm rollback condition and DNS/proxy plan.
- Stop app/API writes before restoring.
- Record exact commands in the incident log.

## Remaining Work

- Choose an offsite target and enable `letscube-offsite-backup.timer`.
- Run the first isolated restore rehearsal.
- Record exact restore commands after the rehearsal proves the target path.
