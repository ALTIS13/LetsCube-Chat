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
bit without sudo. This script records the strict-format directory set before the
run and accepts only one directory created by this invocation. It never falls
back to a pre-existing backup.

```bash
set -euo pipefail

backup_root=/srv/letscube/backups/automated
strict_backup_name='^[0-9]{8}-[0-9]{6}$'
before_backup_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
before_backup_dirs="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | awk -v pattern="$strict_backup_name" '$0 ~ pattern' | LC_ALL=C sort)"
printf 'backup_started_at=%s\n' "$before_backup_at"

sudo -n test -x /srv/letscube/scripts/letscube-backup.sh
sudo -n /srv/letscube/scripts/letscube-backup.sh check
sudo -n /srv/letscube/scripts/letscube-backup.sh run

after_backup_dirs="$(sudo -n find "$backup_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | awk -v pattern="$strict_backup_name" '$0 ~ pattern' | LC_ALL=C sort)"
new_backup_dirs="$(comm -13 <(printf '%s\n' "$before_backup_dirs") <(printf '%s\n' "$after_backup_dirs"))"
new_backup_count="$(printf '%s\n' "$new_backup_dirs" | sed '/^$/d' | wc -l | tr -d ' ')"

[ "$new_backup_count" -eq 1 ]
latest="$(printf '%s\n' "$new_backup_dirs" | sed '/^$/d')"
[[ "$latest" =~ ^[0-9]{8}-[0-9]{6}$ ]]
if printf '%s\n' "$before_backup_dirs" | grep -Fxq "$latest"; then
  printf '%s\n' 'backup directory existed before this run' >&2
  exit 1
fi

latest="$backup_root/$latest"
sudo -n test -d "$latest"
printf 'backup_path=%s\n' "$latest"
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
select to_regclass('private.registration_location_provenance') as registration_location_provenance;
select to_regprocedure('public.registration_cleanup_report(timestamptz,timestamptz)') as registration_cleanup_report;

with operational_rpc(signature) as (values
  ('public.registration_lifecycle_register_internal(uuid,text,text)'),
  ('public.registration_lifecycle_extend_by_email_internal(text)'),
  ('public.registration_cleanup_claim(integer,uuid,timestamptz)'),
  ('public.registration_cleanup_recheck(uuid,uuid,timestamptz)'),
  ('public.registration_cleanup_delete(uuid,uuid,timestamptz)'),
  ('public.registration_cleanup_finish(uuid,uuid,text,text)'),
  ('public.registration_cleanup_report(timestamptz,timestamptz)'),
  ('public.registration_cleanup_recover_dead_letter(uuid,text)'),
  ('public.registration_cleanup_purge_audit(integer,timestamptz)'),
  ('public.registration_lifecycle_backfill_internal(integer,timestamptz)')
)
select signature,
       has_function_privilege('anon', signature, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', signature, 'execute') as authenticated_can_execute,
       has_function_privilege('service_role', signature, 'execute') as service_role_can_execute
from operational_rpc
order by signature;

with private_helper(signature) as (values
  ('private.registration_identity_requires_hold(uuid)'),
  ('private.registration_has_product_activity(uuid)'),
  ('private.registration_location_membership_requires_hold(uuid)'),
  ('private.registration_record_invite_location_provenance(uuid,text)'),
  ('private.registration_location_membership_guard()'),
  ('private.registration_cleanup_guard_auth_user_delete()')
)
select signature,
       has_function_privilege('anon', signature, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', signature, 'execute') as authenticated_can_execute,
       has_function_privilege('service_role', signature, 'execute') as service_role_can_execute
from private_helper
order by signature;

set local enable_seqscan = off;
explain (costs off)
select l.user_id
from private.registration_lifecycles l
where l.admin_hold_at is null
  and l.dead_lettered_at is null
  and l.eligible_at <= clock_timestamp()
  and coalesce(l.next_attempt_at, l.eligible_at) <= clock_timestamp()
order by coalesce(l.next_attempt_at, l.eligible_at), l.eligible_at, l.user_id
limit 100;

explain (costs off)
select l.user_id
from private.registration_lifecycles l
where l.admin_hold_at is null
  and l.dead_lettered_at is null
  and l.failure_count > 0
  and l.next_attempt_at <= clock_timestamp()
order by l.next_attempt_at, l.eligible_at, l.user_id
limit 100;

explain (costs off)
select l.user_id
from private.registration_lifecycles l
where l.dead_lettered_at is not null
order by l.dead_lettered_at, l.user_id
limit 100;

explain (costs off)
select u.id
from auth.users u
where u.email_confirmed_at is null
  and u.phone_confirmed_at is null
  and u.last_sign_in_at is null
  and not exists (
    select 1 from private.registration_lifecycles l where l.user_id = u.id
  )
  and exists (
    select 1 from public.registration_invite_uses riu where riu.user_id = u.id
  )
order by u.created_at, u.id
limit 1000;
reset enable_seqscan;

set local role service_role;
select report_scope, signup_kind, reason_code, item_count
from public.registration_cleanup_report()
order by report_scope, signup_kind, reason_code;
rollback;
SQL
} | sudo -n docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres
```

Proceed only when all three relations and the report function resolve, every
operational RPC row is `false`, `false`, `true`, every private helper row is
`false`, `false`, `false`, and all four bounded query plans are returned. The
due, retry, and dead-letter plans must name
`registration_lifecycles_due_idx`, `registration_lifecycles_retry_idx`, and
`registration_lifecycles_dead_letter_idx` respectively; the invite branch of
the backfill plan must name the existing `idx_registration_invite_uses_user`.
The service-role report must return aggregate-only rows, and the transaction
must end at `ROLLBACK` without a SQL error. If it fails before
rollback, stop and inspect the SQL locally; ending the `psql` connection rolls
back the uncommitted outer transaction.

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
with operational_rpc(signature) as (values
  ('public.registration_lifecycle_register_internal(uuid,text,text)'),
  ('public.registration_lifecycle_extend_by_email_internal(text)'),
  ('public.registration_cleanup_claim(integer,uuid,timestamptz)'),
  ('public.registration_cleanup_recheck(uuid,uuid,timestamptz)'),
  ('public.registration_cleanup_delete(uuid,uuid,timestamptz)'),
  ('public.registration_cleanup_finish(uuid,uuid,text,text)'),
  ('public.registration_cleanup_report(timestamptz,timestamptz)'),
  ('public.registration_cleanup_recover_dead_letter(uuid,text)'),
  ('public.registration_cleanup_purge_audit(integer,timestamptz)'),
  ('public.registration_lifecycle_backfill_internal(integer,timestamptz)')
)
select signature,
       has_function_privilege('anon', signature, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', signature, 'execute') as authenticated_can_execute,
       has_function_privilege('service_role', signature, 'execute') as service_role_can_execute
from operational_rpc
order by signature;
begin;
set local role service_role;
select report_scope, signup_kind, reason_code, item_count
from public.registration_cleanup_report()
order by report_scope, signup_kind, reason_code;
rollback;
SQL
```

Every operational grant result must remain `false`, `false`, `true`. Preserve
only signatures, grant booleans, and aggregate scope/kind/reason/count output in
the change record.

## 6. Deploy And Verify auth-yandex-gateway

This deployment is mandatory before worker enablement or lifecycle backfill. The
live host directory is
`/srv/letscube/platform/supabase-docker/volumes/functions/auth-yandex-gateway`.
The parent host directory is bind-mounted into `supabase-edge-functions` at
`/home/deno/functions`, so the in-container gateway path is
`/home/deno/functions/auth-yandex-gateway`.

From the clean reviewed checkout, stage only files from the exact commit. This
includes the lifecycle and provider modules that are not present in the older
deployed gateway. The manifest prints hashes and filenames only, never source
content.

```bash
set -euo pipefail

git diff --quiet
git diff --cached --quiet
gateway_commit="$(git rev-parse HEAD)"
gateway_rel=supabase/functions/auth-yandex-gateway
gateway_files=(
  index.ts
  inviteCode.mjs
  rateLimit.mjs
  registrationLifecycle.mjs
  captchaProvider.mjs
)
gateway_paths=()
for file in "${gateway_files[@]}"; do
  git cat-file -e "${gateway_commit}:${gateway_rel}/${file}"
  gateway_paths+=("${gateway_rel}/${file}")
done

local_stage="$(mktemp -d)"
cleanup_local_stage() { rm -rf -- "$local_stage"; }
trap cleanup_local_stage EXIT
git archive --format=tar "$gateway_commit" "${gateway_paths[@]}" |
  tar -xf - -C "$local_stage"
committed_gateway_dir="$local_stage/$gateway_rel"
(
  cd "$committed_gateway_dir"
  sha256sum "${gateway_files[@]}" > committed.sha256
)

remote_stage="/tmp/letscube-auth-gateway-${gateway_commit}"
ssh techadmin@ms.letscube.ru "test ! -e '$remote_stage' && install -d -m 700 '$remote_stage'"
scp -r "$committed_gateway_dir/." "techadmin@ms.letscube.ru:$remote_stage/"
```

On the production host, verify the exact mount, recompute the staged hashes, and
prepare a same-filesystem candidate. Existing files retain their own owner and
mode; new committed modules inherit `index.ts` ownership and mode. The current
directory becomes the fresh deterministic rollback directory only during the
atomic directory swap. Stop if either deterministic candidate or rollback path
already exists.

```bash
set -euo pipefail

gateway_commit='REPLACE_WITH_REVIEWED_COMMIT_HASH'
gateway_root=/srv/letscube/platform/supabase-docker/volumes/functions
gateway_dir="$gateway_root/auth-yandex-gateway"
container_gateway_dir=/home/deno/functions/auth-yandex-gateway
remote_stage="/tmp/letscube-auth-gateway-${gateway_commit}"
candidate_dir="${gateway_dir}.registration-lifecycle.candidate"
rollback_dir="${gateway_dir}.registration-lifecycle.rollback"
gateway_files=(
  index.ts
  inviteCode.mjs
  rateLimit.mjs
  registrationLifecycle.mjs
  captchaProvider.mjs
)

[[ "$gateway_commit" =~ ^[0-9a-f]{40}$ ]]
sudo -n test -d "$gateway_dir"
sudo -n test ! -e "$candidate_dir"
sudo -n test ! -e "$rollback_dir"
test -d "$remote_stage"

mount_ok="$(sudo -n docker inspect --format '{{range .Mounts}}{{if and (eq .Source "/srv/letscube/platform/supabase-docker/volumes/functions") (eq .Destination "/home/deno/functions")}}ok{{end}}{{end}}' supabase-edge-functions)"
[ "$mount_ok" = ok ]

(
  cd "$remote_stage"
  sha256sum "${gateway_files[@]}" > staged.sha256
)
cmp --silent "$remote_stage/committed.sha256" "$remote_stage/staged.sha256"

sudo -n cp -a -- "$gateway_dir" "$candidate_dir"
for file in "${gateway_files[@]}"; do
  reference="$candidate_dir/$file"
  if ! sudo -n test -e "$reference"; then
    reference="$candidate_dir/index.ts"
  fi
  owner="$(sudo -n stat -c '%u' "$reference")"
  group="$(sudo -n stat -c '%g' "$reference")"
  mode="$(sudo -n stat -c '%a' "$reference")"
  candidate_file="$(sudo -n mktemp "$candidate_dir/.${file}.install.XXXXXX")"
  sudo -n install --owner="$owner" --group="$group" --mode="$mode" \
    "$remote_stage/$file" "$candidate_file"
  sudo -n mv -f -- "$candidate_file" "$candidate_dir/$file"
done

sudo -n bash -c 'cd "$1" && sha256sum "${@:3}" > "$2"' sh \
  "$candidate_dir" "$remote_stage/candidate.sha256" "${gateway_files[@]}"
sudo -n cmp --silent "$remote_stage/committed.sha256" "$remote_stage/candidate.sha256"

sudo -n mv -- "$gateway_dir" "$rollback_dir"
if ! sudo -n mv -- "$candidate_dir" "$gateway_dir"; then
  sudo -n mv -- "$rollback_dir" "$gateway_dir"
  exit 1
fi

sudo -n bash -c 'cd "$1" && sha256sum "${@:3}" > "$2"' sh \
  "$gateway_dir" "$remote_stage/deployed.sha256" "${gateway_files[@]}"
sudo -n cmp --silent "$remote_stage/committed.sha256" "$remote_stage/deployed.sha256"
```

Restart only the Edge Functions container. Verify that its configured provider
has the matching server-only secret without printing either value. Then perform
an `OPTIONS` probe and a no-token POST that must stop at `captcha_required`
before Supabase Auth; it cannot create or mutate an Auth user.

```bash
set -euo pipefail

sudo -n docker restart supabase-edge-functions >/dev/null
sudo -n docker exec supabase-edge-functions sh -lc '
  provider="${KUB_AUTH_CAPTCHA_PROVIDER:-yandex-smartcaptcha}"
  case "$provider" in
    yandex|yandex-smartcaptcha|smartcaptcha) test -n "$YANDEX_SMARTCAPTCHA_SECRET" ;;
    turnstile) test -n "$TURNSTILE_SECRET_KEY" ;;
    *) exit 1 ;;
  esac
'

gateway_url=https://core.letscube.ru/functions/v1/auth-yandex-gateway
options_body="$remote_stage/options.body"
options_status="$(curl --silent --show-error --output "$options_body" --write-out '%{http_code}' -X OPTIONS "$gateway_url")"
[ "$options_status" = 204 ]

anon_key="$(sudo -n docker exec supabase-edge-functions sh -lc 'printf "%s" "${SUPABASE_ANON_KEY:-${ANON_KEY:-}}"')"
[ -n "$anon_key" ]
smoke_body="$remote_stage/runtime-smoke.body"
smoke_status="$(curl --silent --show-error --output "$smoke_body" --write-out '%{http_code}' \
  -X POST "$gateway_url" \
  -H "apikey: $anon_key" \
  -H "authorization: Bearer $anon_key" \
  -H 'content-type: application/json' \
  --data '{"action":"recovery","email":"gateway-deploy-smoke@example.invalid"}')"
unset anon_key
[ "$smoke_status" = 400 ]
grep -Eq '"ok"[[:space:]]*:[[:space:]]*false' "$smoke_body"
grep -Eq '"error"[[:space:]]*:[[:space:]]*"captcha_required"' "$smoke_body"
rm -f -- "$options_body" "$smoke_body"
```

Finally compare the committed manifest with both the host mount and the files as
seen inside the running container. Redirect manifests to protected staging
files; do not print file content.

```bash
sudo -n bash -c 'cd "$1" && sha256sum "${@:3}" > "$2"' sh \
  "$gateway_dir" "$remote_stage/deployed.sha256" "${gateway_files[@]}"
sudo -n docker exec supabase-edge-functions sh -lc \
  'cd /home/deno/functions/auth-yandex-gateway && sha256sum index.ts inviteCode.mjs rateLimit.mjs registrationLifecycle.mjs captchaProvider.mjs' \
  > "$remote_stage/container.sha256"
sudo -n cmp --silent "$remote_stage/committed.sha256" "$remote_stage/deployed.sha256"
sudo -n cmp --silent "$remote_stage/committed.sha256" "$remote_stage/container.sha256"
```

Do not enable the worker or run backfill until every gateway check above passes.
Keep the deterministic gateway rollback directory until the report-only worker,
backfill, and aggregate smoke gates pass.

If the session is lost or any gateway check fails after the swap, use this
self-contained rollback. It does not depend on variables from the interrupted
shell and preserves the failed deployment for investigation.

```bash
set -euo pipefail

recovery_gateway_dir=/srv/letscube/platform/supabase-docker/volumes/functions/auth-yandex-gateway
recovery_gateway_rollback=/srv/letscube/platform/supabase-docker/volumes/functions/auth-yandex-gateway.registration-lifecycle.rollback
recovery_failed_dir="${recovery_gateway_dir}.failed.$(date -u +%Y%m%d-%H%M%S)"
sudo -n test -d "$recovery_gateway_dir"
sudo -n test -d "$recovery_gateway_rollback"
sudo -n test ! -e "$recovery_failed_dir"
sudo -n mv -- "$recovery_gateway_dir" "$recovery_failed_dir"
if ! sudo -n mv -- "$recovery_gateway_rollback" "$recovery_gateway_dir"; then
  sudo -n mv -- "$recovery_failed_dir" "$recovery_gateway_dir"
  exit 1
fi
sudo -n docker restart supabase-edge-functions >/dev/null
```

## 7. Deploy Report-Only letscube-worker And Backfill

The live `letscube-worker` is a Dockerfile application that sources the
container destination `/run/secrets/letscube-infra.env` at runtime. Read-only
verification established that Coolify bind-mounts the host source
`/srv/letscube/secrets/letscube-infra.env` to that container destination. Edit
only the host source; never attempt to modify the container destination. The
root `docker-compose.yml` defaults are portability defaults only; they do not
wire the live worker.

Each enabled batch first calls the bounded service-role-only 90-day audit purge.
Caller time can retain audit rows longer but cannot shorten the 90-day floor. If
purge fails, the batch fails before claim and processes no candidates. The worker
never calls `registration_cleanup_recover_dead_letter`; that RPC is an
operator-only one-row recovery action after the fifth failure has been reviewed.

Re-verify in Coolify before rollout that this deployment is application UUID
`fkd10qwlo4qod9e6gtyzzuwk`. Then run this read-only Docker check on the server;
it must find exactly one running container with that explicit application label
and confirm the verified host-to-container bind mount. Stop if either check
fails.

```bash
set -euo pipefail

mapfile -t worker_containers < <(sudo -n docker ps --filter label=coolify.applicationId=fkd10qwlo4qod9e6gtyzzuwk --quiet)
worker_count="${#worker_containers[@]}"
[ "$worker_count" -eq 1 ]
worker_container="${worker_containers[0]}"
mount_source="$(sudo -n docker inspect --format '{{range .Mounts}}{{if and (eq .Source "/srv/letscube/secrets/letscube-infra.env") (eq .Destination "/run/secrets/letscube-infra.env")}}{{.Source}}{{end}}{{end}}' "$worker_container")"
[ "$mount_source" = "/srv/letscube/secrets/letscube-infra.env" ]
```

On the production server, atomically prepare the verified host source file.
This retains every unrelated line, mode, and owner; only the four non-secret
cleanup flags are replaced. It prints only those flag names and values.

```bash
set -euo pipefail

env_file=/srv/letscube/secrets/letscube-infra.env
env_dir=/srv/letscube/secrets
rollback_file="${env_file}.registration-cleanup.rollback"
sudo -n test -f "$env_file"
sudo -n test ! -e "$rollback_file"
candidate_file="$(sudo -n mktemp "$env_dir/.letscube-infra.env.candidate.XXXXXX")"
cleanup_candidate() { sudo -n rm -f -- "$candidate_file"; }
trap cleanup_candidate EXIT

sudo -n cp --preserve=mode,ownership "$env_file" "$rollback_file"
sudo -n cp --preserve=mode,ownership "$env_file" "$candidate_file"
sudo -n awk -F= '
  $1 != "REGISTRATION_CLEANUP_ENABLED" &&
  $1 != "REGISTRATION_CLEANUP_REPORT_ONLY" &&
  $1 != "REGISTRATION_CLEANUP_BATCH_SIZE" &&
  $1 != "REGISTRATION_CLEANUP_INTERVAL_SECONDS" { print }
' "$env_file" | sudo -n tee "$candidate_file" >/dev/null
sudo -n tee -a "$candidate_file" >/dev/null <<'EOF'
REGISTRATION_CLEANUP_ENABLED=true
REGISTRATION_CLEANUP_REPORT_ONLY=true
REGISTRATION_CLEANUP_BATCH_SIZE=50
REGISTRATION_CLEANUP_INTERVAL_SECONDS=3600
EOF
sudo -n awk -F= '
  $1 == "REGISTRATION_CLEANUP_ENABLED" && $2 == "true" { enabled = 1 }
  $1 == "REGISTRATION_CLEANUP_REPORT_ONLY" && $2 == "true" { report_only = 1 }
  $1 == "REGISTRATION_CLEANUP_BATCH_SIZE" && $2 == "50" { batch_size = 1 }
  $1 == "REGISTRATION_CLEANUP_INTERVAL_SECONDS" && $2 == "3600" { interval = 1 }
  END { exit !(enabled && report_only && batch_size && interval) }
' "$candidate_file"
sudo -n awk -F= '$1 ~ /^REGISTRATION_CLEANUP_(ENABLED|REPORT_ONLY|BATCH_SIZE|INTERVAL_SECONDS)$/ { print $1 "=" $2 }' "$candidate_file"
sudo -n mv -f -- "$candidate_file" "$env_file"
deploy_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'deploy_started_at=%s\n' "$deploy_started_at"
```

Deploy the reviewed `letscube-worker` application through Coolify. If that
deploy fails, restore the preserved server-local file before retrying or
investigating, then redeploy the previous reviewed worker configuration:

```bash
sudo -n mv -f -- "$rollback_file" "$env_file"
```

The deterministic rollback file is deliberately retained until the status gate
passes. If session loss occurs after creating it, do not start another rollout
or overwrite that file. In the recovery session, re-verify the Coolify UUID and
bind mount, then run this self-contained recovery command before deploying the
previous reviewed worker configuration:

```bash
set -euo pipefail

recovery_env_file=/srv/letscube/secrets/letscube-infra.env
recovery_rollback_file=/srv/letscube/secrets/letscube-infra.env.registration-cleanup.rollback
sudo -n test -f "$recovery_rollback_file"
sudo -n mv -f -- "$recovery_rollback_file" "$recovery_env_file"
```

Investigate the interrupted rollout before trying again.

After a successful deploy, confirm the dedicated local worker status from inside
the deployed container. Do not rely on the generic health endpoint. The command
requires the effective enabled/report-only state and a success timestamp later
than both the latest run and recorded deployment start. It also requires no
current failure and a latest aggregate result with zero failed candidates; its
output is limited to the safe status and aggregate result.

```bash
mapfile -t worker_containers < <(sudo -n docker ps --filter label=coolify.applicationId=fkd10qwlo4qod9e6gtyzzuwk --quiet)
worker_count="${#worker_containers[@]}"
[ "$worker_count" -eq 1 ]
worker_container="${worker_containers[0]}"
sudo -n docker exec -e DEPLOY_STARTED_AT="$deploy_started_at" "$worker_container" sh -lc "
  curl --fail --silent --show-error http://127.0.0.1:8096/api/healthz/registration-cleanup |
    node -e '
      let body = \"\";
      process.stdin.setEncoding(\"utf8\");
      process.stdin.on(\"data\", (chunk) => { body += chunk; });
      process.stdin.on(\"end\", () => {
        const status = JSON.parse(body);
        const runAt = Date.parse(status.lastRunAt || \"\");
        const successAt = Date.parse(status.lastSuccessAt || \"\");
        const deployAt = Date.parse(process.env.DEPLOY_STARTED_AT || \"\");
        if (status.configured !== true || status.enabled !== true || status.reportOnly !== true || !Number.isFinite(runAt) || !Number.isFinite(successAt) || successAt < runAt || successAt < deployAt || status.lastFailureAt !== null || status.lastResult?.failed !== 0) process.exit(1);
        console.log(JSON.stringify({ configured: status.configured, enabled: status.enabled, reportOnly: status.reportOnly, lastRunAt: status.lastRunAt, lastSuccessAt: status.lastSuccessAt, lastFailureAt: status.lastFailureAt, lastResult: status.lastResult }));
      });
    '
"
```

Only after the status command succeeds, remove the temporary rollback copy:

```bash
sudo -n rm -f -- "$rollback_file"
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

After a dead-letter cause has been corrected and reviewed, an operator may reset
exactly one row with a bounded, PII-free reason code. Never schedule or call this
RPC from the worker:

```bash
dead_letter_user_id='REPLACE_WITH_REVIEWED_INTERNAL_UUID'
sudo -n docker exec -i supabase-db psql -v ON_ERROR_STOP=1 \
  -v user_id="$dead_letter_user_id" -U postgres -d postgres <<'SQL'
begin;
set local role service_role;
select public.registration_cleanup_recover_dead_letter(
  :'user_id'::uuid,
  'operator_reviewed'
) as recovered;
commit;
SQL
```

Only after the aggregate smoke succeeds, remove the deterministic gateway
rollback and committed staging directory. Re-enter the absolute paths in the
same shell before removal:

```bash
gateway_rollback=/srv/letscube/platform/supabase-docker/volumes/functions/auth-yandex-gateway.registration-lifecycle.rollback
gateway_stage="/tmp/letscube-auth-gateway-REPLACE_WITH_REVIEWED_COMMIT_HASH"
sudo -n test -d "$gateway_rollback"
sudo -n rm -rf -- "$gateway_rollback"
rm -rf -- "$gateway_stage"
```

## 8. Report-Only Rollback And Deletion Gate

For a worker deployment, status, backfill, or aggregate-report concern, restore
the preserved `/srv/letscube/secrets/letscube-infra.env` host-source rollback
file as shown above, then deploy the previous reviewed `letscube-worker`
configuration. If no rollback file remains, perform the same atomic procedure
with only these values:

```text
REGISTRATION_CLEANUP_ENABLED=false
REGISTRATION_CLEANUP_REPORT_ONLY=true
```

Do not set `REGISTRATION_CLEANUP_REPORT_ONLY=false` in Task 5B. Active deletion
requires a separate operator approval after report-only evidence has been
reviewed and accepted.
