# Registration Lifecycle Cleanup Rollout

## Scope And Approval Boundary

This runbook is for Task 5B, after Task 5A, task review, and whole-branch review
are complete. It is an operator procedure, not an instruction to contact
production from local development.

Keep `REGISTRATION_CLEANUP_REPORT_ONLY=true` throughout Task 5B. Changing it to
`false` enables deletion and requires separate, explicit operator approval after
the aggregate report has been reviewed. Do not treat a successful report-only
run as that approval.

The reviewed migration is
`.migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql`.
It contains its own `BEGIN` and `COMMIT`; the rehearsal below removes only those
outer wrapper lines and supplies an enclosing transaction that is rolled back.

## 1. Verify And Create A Fresh Backup

Run these on the production server during the approved maintenance window. The
operator account must use `sudo -n`; it cannot test the backup program's execute
bit without sudo.

```bash
sudo -n test -x /srv/letscube/scripts/letscube-backup.sh
sudo -n /srv/letscube/scripts/letscube-backup.sh check
sudo -n /srv/letscube/scripts/letscube-backup.sh run
latest="$(sudo -n find /srv/letscube/backups/automated -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n1)"
latest="/srv/letscube/backups/automated/$latest"
printf '%s\n' "$latest"
sudo -n test -d "$latest"
sudo -n sh -c 'cd "$1" && sha256sum -c SHA256SUMS && pg_restore -l db/supabase-postgres.custom >/tmp/registration-cleanup-pg-restore-list.txt' sh "$latest"
```

The fresh path must match `/srv/letscube/backups/automated/YYYYMMDD-HHMMSS`.
Record only that path and the UTC timestamp in the change record. Do not copy
the archive, configuration archive, or credentials into the repository.

## 2. Upload The Reviewed Migration

From the reviewed checkout, upload the exact committed migration. Do not edit it
on the server.

```bash
scp .migration-backup/supabase/migrations/20260830103000_registration_lifecycle_cleanup.sql techadmin@ms.letscube.ru:/tmp/20260830103000_registration_lifecycle_cleanup.sql
```

## 3. Rehearse Inside A Rolled-Back Transaction

Run on the production server. This command is read/write only inside the outer
transaction and always ends with `ROLLBACK`; do not replace it with the apply
command until its output has been reviewed.

```bash
{
  printf '%s\n' 'BEGIN;'
  sed -E '/^[[:space:]]*begin;[[:space:]]*$/Id; /^[[:space:]]*commit;[[:space:]]*$/Id' /tmp/20260830103000_registration_lifecycle_cleanup.sql
  cat <<'SQL'
select to_regclass('private.registration_lifecycles') as registration_lifecycles;
select to_regclass('private.registration_cleanup_audit') as registration_cleanup_audit;
select to_regprocedure('public.registration_cleanup_report(timestamptz,timestamptz)') as registration_cleanup_report;
select
  has_function_privilege('anon', 'public.registration_cleanup_report(timestamptz,timestamptz)', 'execute') as anon_can_execute,
  has_function_privilege('authenticated', 'public.registration_cleanup_report(timestamptz,timestamptz)', 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', 'public.registration_cleanup_report(timestamptz,timestamptz)', 'execute') as service_role_can_execute;
explain (costs off) select * from public.registration_cleanup_report();
rollback;
SQL
} | sudo -n docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres
```

Proceed only when the two relations and report function resolve, the grant check
is `false`, `false`, `true`, and the transaction ends at `ROLLBACK` without a
SQL error. If it fails before rollback, stop and inspect the SQL locally; ending
the `psql` connection rolls back the uncommitted outer transaction.

## 4. Apply The Reviewed Migration

Only after the rehearsal passes, run the unmodified reviewed file:

```bash
sudo -n docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres < /tmp/20260830103000_registration_lifecycle_cleanup.sql
```

There is no down migration. Do not attempt an ad hoc SQL rollback after this
command commits. A post-commit database rollback is an incident procedure based
on the fresh backup and requires separate approval.

## 5. Verify Grants And Aggregate Report

Run on the production server. It confirms the report RPC grants and invokes the
service-role-only aggregate projection without selecting lifecycle identities.

```bash
sudo -n docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
select
  has_function_privilege('anon', 'public.registration_cleanup_report(timestamptz,timestamptz)', 'execute') as anon_can_execute,
  has_function_privilege('authenticated', 'public.registration_cleanup_report(timestamptz,timestamptz)', 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', 'public.registration_cleanup_report(timestamptz,timestamptz)', 'execute') as service_role_can_execute;
begin;
set local role service_role;
select report_scope, signup_kind, reason_code, item_count
from public.registration_cleanup_report()
order by report_scope, signup_kind, reason_code;
rollback;
SQL
```

The grant result must remain `false`, `false`, `true`. Preserve only aggregate
scope/kind/reason/count output in the change record.

## 6. Deploy Report-Only Worker And Backfill

Set these exact `kub-worker` environment values in Coolify, then deploy the
reviewed worker and wait for its `/api/healthz` health check:

```text
REGISTRATION_CLEANUP_ENABLED=true
REGISTRATION_CLEANUP_REPORT_ONLY=true
REGISTRATION_CLEANUP_BATCH_SIZE=50
REGISTRATION_CLEANUP_INTERVAL_SECONDS=3600
```

Record the enablement timestamp in UTC before backfill. On the production
server, run the following command with that recorded value and repeat it until
`inserted` is `0`; do not substitute a later timestamp between batches.

```bash
enabled_at='YYYY-MM-DDTHH:MM:SSZ'
sudo -n docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -v enabled_at="$enabled_at" -U postgres -d postgres <<'SQL'
begin;
set local role service_role;
select public.registration_lifecycle_backfill_internal(1000, :'enabled_at'::timestamptz) as inserted;
commit;
SQL
```

After the final batch, retain only these aggregate checks:

```bash
sudo -n docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -v enabled_at="$enabled_at" -U postgres -d postgres <<'SQL'
select count(*) filter (where eligible_at < :'enabled_at'::timestamptz + interval '24 hours') as grace_violations
from private.registration_lifecycles;
select count(*) as privileged_without_hold
from private.registration_lifecycles l
where private.registration_identity_requires_hold(l.user_id)
  and l.admin_hold_at is null;
SQL
```

Both counts must be `0`. From the reviewed local checkout with the ignored
operator environment available, run the smoke command after one report-only
interval:

```bash
REGISTRATION_CLEANUP_SMOKE=1 node scripts/registration-cleanup-smoke.mjs --report-only
```

Any nonzero exit, including any `claimed_unsafe_*` aggregate, is a stop signal.

## 7. Report-Only Rollback And Deletion Gate

For any deployment, health, backfill, or aggregate-report concern, immediately
set these `kub-worker` values in Coolify and deploy the worker again:

```text
REGISTRATION_CLEANUP_ENABLED=false
REGISTRATION_CLEANUP_REPORT_ONLY=true
```

Do not set `REGISTRATION_CLEANUP_REPORT_ONLY=false` in Task 5B. Active deletion
requires a separate operator approval after report-only evidence has been
reviewed and accepted.
