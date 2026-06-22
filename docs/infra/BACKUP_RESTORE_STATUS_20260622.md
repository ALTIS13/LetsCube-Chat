# LETSCUBE Backup / Restore Status - 2026-06-22

Scope: read-only inventory of the production server backup setup.

No restore drill was executed during this check.

## Current Backup Setup

- Backup script: `/srv/letscube/scripts/letscube-backup.sh`.
- Systemd timer: `letscube-backup.timer`.
- Timer status: enabled and active.
- Latest observed run: `2026-06-22 03:44:50 MSK`.
- Latest observed result: success.
- Latest observed backup directory: `/srv/letscube/backups/automated/20260622-034450`.
- Latest observed log: `/srv/letscube/logs/backups/letscube-backup-20260622-034450.log`.
- Retention in script: 14 days by default.

## Backup Contents

The script currently backs up:

- self-hosted Supabase Postgres via custom-format `pg_dump`;
- Coolify Postgres via custom-format `pg_dump`;
- Mailcow MySQL via `mysqldump`;
- Supabase storage volume archive;
- Supabase compose/env/function/auth-template config archive;
- Mailcow compose/config archive;
- Mailcow mail-related Docker volumes;
- Coolify Redis volume;
- backup manifest and SHA256 checksums.

## Observed Notes

Mailcow/Postfix socket files are skipped by `tar` with `socket ignored` warnings. This is expected for live socket files and did not fail the backup run.

The server also has a runbook at `/srv/letscube/ops/backup-restore-runbook.md`.

## Remaining Required Work

- Add a restore rehearsal target that is isolated from production.
- Run a restore drill from the latest automated backup into that isolated target.
- Verify restored Supabase row counts, Storage object counts, mail service config, and app smoke.
- Record the exact restore command sequence and rollback conditions.
- Add off-server backup verification once offsite storage is finalized.
