# LETSCUBE Backup / Restore Status - 2026-06-22

Scope: read-only inventory and non-destructive verification of the production server backup setup.

No restore drill was executed during this check. No production data was modified. Secret file contents were not printed or copied into this document.

## Server Snapshot

- Host: `ms.letscube.ru`.
- Kernel: Ubuntu Linux `6.8.0-124-generic`.
- Checked at: `2026-06-22T19:19:57+03:00`.
- Disk for `/`, `/srv`, `/data`, `/opt`: 119 GB total, 38 GB used, 75 GB free, 34% used.

## Current Local Backup Setup

- Backup script: `/srv/letscube/scripts/letscube-backup.sh`.
- Backup script permissions: `-rwx------ root:root`.
- Systemd service: `letscube-backup.service`.
- Systemd timer: `letscube-backup.timer`.
- Timer status: enabled and active.
- Schedule: daily at `03:35` MSK with up to `30m` randomized delay.
- Latest observed run: `2026-06-22 03:44:50 MSK`.
- Latest observed result: success.
- Latest observed backup directory: `/srv/letscube/backups/automated/20260622-034450`.
- Latest observed log: `/srv/letscube/logs/backups/letscube-backup-20260622-034450.log`.
- Local retention in script: 14 days by default.

## Latest Backup Contents

Latest set: `/srv/letscube/backups/automated/20260622-034450`.

Observed manifest contents:

- `db/supabase-postgres.custom`: 1,113,066 bytes.
- `db/coolify-postgres.custom`: 911,642 bytes.
- `db/mailcow.sql`: 68,231 bytes.
- `storage/supabase-storage.tgz`: 396,557,063 bytes.
- `config/letscube-configs.tgz`: 246,094 bytes.
- `volumes/coolify-redis.tgz`: 1,033,988 bytes.
- `volumes/mailcowdockerized_crypt-vol-1.tgz`: 499 bytes.
- `volumes/mailcowdockerized_postfix-tlspol-vol-1.tgz`: 560 bytes.
- `volumes/mailcowdockerized_postfix-vol-1.tgz`: 981 bytes.
- `volumes/mailcowdockerized_redis-vol-1.tgz`: 406,530 bytes.
- `volumes/mailcowdockerized_rspamd-vol-1.tgz`: 6,623,380 bytes.
- `volumes/mailcowdockerized_vmail-index-vol-1.tgz`: 10,848 bytes.
- `volumes/mailcowdockerized_vmail-vol-1.tgz`: 18,807 bytes.
- `MANIFEST.txt` and `SHA256SUMS`.

The config archive intentionally includes sensitive operational files such as Supabase env/config, Mailcow config, Edge Functions and `/srv/letscube/ops`. Keep these archives root-only and never copy them into git or public storage.

## Non-Destructive Verification Performed

- `sha256sum -c SHA256SUMS` passed for the latest backup set.
- `pg_restore -l` successfully read `db/supabase-postgres.custom`.
- `pg_restore -l` successfully read `db/coolify-postgres.custom`.
- `db/mailcow.sql` header is readable as a MariaDB dump.
- `tar -tzf` successfully listed:
  - `storage/supabase-storage.tgz`;
  - `config/letscube-configs.tgz`;
  - `volumes/coolify-redis.tgz`;
  - all observed Mailcow volume archives in the latest set.

Expected live socket warnings remain acceptable for Mailcow/Postfix live volume archiving and did not fail the latest backup run.

## Read-Only Production Counts For Restore Comparison

These counts were collected without reading row contents.

- Database: `postgres`.
- Postgres version: `17.6`.
- Public base tables: 32.
- Auth base tables: 23.
- Storage base tables: 10.
- `auth.users`: 12.
- `public.profiles`: 12.
- `public.chats`: 30.
- `public.chat_members`: 41.
- `public.messages`: 1,272.
- `public.tasks`: 36.
- `public.notifications`: 210.
- `storage.objects`: 252.
- `storage.objects` by bucket:
  - `media`: 252.

Use these counts as a baseline when validating the first isolated restore rehearsal. They are not a substitute for app smoke tests.

## Relevant Running Containers

Production services were observed running during inventory:

- Coolify: `coolify`, `coolify-db`, `coolify-redis`, `coolify-proxy`, `coolify-realtime`, `coolify-sentinel`.
- Supabase: `supabase-db`, `supabase-auth`, `supabase-rest`, `supabase-realtime`, `supabase-storage`, `supabase-edge-functions`, `supabase-kong`, `supabase-meta`, `supabase-pooler`, `supabase-imgproxy`, `supabase-studio`, `supabase-auth-templates`.
- Mailcow: MariaDB, Postfix, Dovecot, Redis, Rspamd, Nginx, ACME, SOGo and related Mailcow containers.

Relevant Docker networks:

- `coolify`.
- `supabase_default`.
- `mailcowdockerized_mailcow-network`.

Relevant Docker volumes observed:

- `coolify-db`.
- `coolify-redis`.
- `supabase_db-config`.
- `supabase_deno-cache`.
- Mailcow volumes: `vmail`, `vmail-index`, `crypt`, `rspamd`, `postfix`, `postfix-tlspol`, `redis`, `mysql`, `mysql-socket`, `clamd-db`, `sogo-*`.

## Offsite Backup Status

Prepared tooling exists:

- `/srv/letscube/scripts/letscube-offsite-backup.sh`.
- `letscube-offsite-backup.service`.
- `letscube-offsite-backup.timer`.
- Installed tools: `rclone`, `restic`, `borg`.

Generic offsite script status:

- `letscube-offsite-backup.timer` is disabled.
- `/srv/letscube/scripts/letscube-offsite-backup.sh check` reports that `BACKUP_REMOTE_TYPE` is empty.
- No permanent `rclone` / `restic` / `borg` destination is configured yet.

Supported offsite modes in the script:

- `rclone`.
- `restic`.
- `borg`.

Do not enable the generic offsite timer until a permanent target is selected and tested.

## Temporary GitHub Encrypted Offsite Backup

Temporary target:

- Private GitHub repository: `ALTIS13/letscube-encrypted-backups`.
- Repository visibility: private.
- Purpose: temporary encrypted latest-snapshot offsite copy until a dedicated backup environment is ready.

Security model:

- Raw backups are not pushed to GitHub.
- The server encrypts the selected local backup set with `age`.
- Encryption recipient: operator SSH public key.
- The matching private key remains off GitHub and is required to decrypt.
- Server GitHub access uses a dedicated deploy key scoped to `ALTIS13/letscube-encrypted-backups`.
- Deploy key path on server: `/srv/letscube/secrets/github-backup-ed25519`.

Server-side implementation:

- Script: `/srv/letscube/scripts/letscube-github-offsite-backup.sh`.
- Service: `letscube-github-offsite-backup.service`.
- Timer: `letscube-github-offsite-backup.timer`.
- Timer status: enabled and active.
- Schedule: daily around `04:45` MSK with up to `45m` randomized delay.
- Next observed trigger: `2026-06-23 05:00:23 MSK`.
- Git transport: `ssh.github.com:443`.
- Chunk size: `45M`.
- Upload strategy: force-push latest encrypted snapshot to `main` to avoid normal git history growth.

Controlled sync result:

- Source local backup: `/srv/letscube/backups/automated/20260622-034450`.
- Encrypted upload completed successfully on `2026-06-22`.
- GitHub repository root contains `README.md`, `MANIFEST.txt`, `encrypted.sha256`, `chunks.sha256`, and `chunks/`.
- Uploaded encrypted chunks: 9.
- Total encrypted chunk size: 407,108,852 bytes.
- Largest encrypted chunk size: 47,185,920 bytes.

Limitations:

- GitHub is not a real backup platform. This is only a temporary latest-snapshot offsite copy.
- Private GitHub storage still depends on GitHub availability and account access.
- The force-push strategy intentionally keeps only the latest encrypted snapshot in the branch view.
- Replace this with a dedicated backup target as soon as available.

## Restore Drill Status

No isolated restore rehearsal has been performed yet.

The server-side runbook explicitly notes that restoring the Supabase dump into a plain temporary database is not a valid drill because a plain DB lacks Supabase-managed schemas/extensions/publications. The correct restore path is a separate rehearsal host or isolated Docker Compose Supabase stack initialized normally before restore.

## Remaining Required Work

- Choose an off-server backup target and configure it only on the server, not in git.
- Run offsite check and one controlled sync of the latest local backup after the target is configured.
- Prepare an isolated restore target, separate from production.
- Run a restore drill from the latest automated backup into that isolated target.
- Verify restored Supabase row counts, Storage object counts, mail service config, and app smoke against the baseline counts above.
- Record the exact restore command sequence and rollback conditions after the rehearsal is complete.
