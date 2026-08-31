# LETSCUBE Bot Platform: database rollout

## Назначение и модель fail-stop

Этот runbook описывает единственный разрешённый порядок rehearsal и production-apply для Bot Platform. Он не запускается автоматически и не является down-migration. Каждый рубеж работает в режиме **fail-stop**: любое расхождение хешей, неполный backup, неуспешное восстановление, занятая блокировка, неожиданный grant, невалидный индекс или drift схемы останавливает rollout.

Полное восстановление backup в изолированный self-hosted Supabase на **PG17** является **hard gate (жёсткий рубеж)**. Проверки архивов недостаточно. Production rehearsal и apply запрещены, пока полный isolated restore rehearsal не завершён и его evidence не сохранён.

Migration является **one-shot** и намеренно не идемпотентна. В self-hosted окружении нет надёжного migration ledger для этого proposal. Commit, SHA-256 и UTC timestamp фиксируются вручную. **Rerun forbidden**, если существует любой partial bot schema или уже применённая Bot Platform schema. Ad-hoc down SQL запрещён; rollback после apply выполняется только из verified backup.

## Неизменяемые входные файлы

- Migration: `.migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql`
- Transactional smoke: `tests/server/bot-platform-db-smoke.sql`

Все команды ниже выполняются из корня reviewed checkout в Bash. Для PostgreSQL используются имена libpq service из файла `pg_service.conf` с правами `0600`; DSN, пароли и ключи в репозиторий или журнал не записываются. Команды не выводят окружение.

```bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MIGRATION_PATH=".migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql"
SMOKE_PATH="tests/server/bot-platform-db-smoke.sql"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLOUT_DIR="$REPO_ROOT/.ops-local/bot-platform-rollout/$RUN_ID"
install -d -m 700 "$ROLLOUT_DIR"

test -f "$MIGRATION_PATH"
test -f "$SMOKE_PATH"
git diff HEAD --exit-code -- "$MIGRATION_PATH" "$SMOKE_PATH"

HEAD_COMMIT="$(git rev-parse --verify 'HEAD^{commit}')"
git show "$HEAD_COMMIT:$MIGRATION_PATH" >"$ROLLOUT_DIR/migration.head.sql"
git show "$HEAD_COMMIT:$SMOKE_PATH" >"$ROLLOUT_DIR/smoke.head.sql"
cmp --silent "$MIGRATION_PATH" "$ROLLOUT_DIR/migration.head.sql"
cmp --silent "$SMOKE_PATH" "$ROLLOUT_DIR/smoke.head.sql"

CURRENT_MIGRATION_SHA="$(sha256sum "$MIGRATION_PATH" | awk '{print $1}')"
HEAD_MIGRATION_SHA="$(sha256sum "$ROLLOUT_DIR/migration.head.sql" | awk '{print $1}')"
CURRENT_SMOKE_SHA="$(sha256sum "$SMOKE_PATH" | awk '{print $1}')"
HEAD_SMOKE_SHA="$(sha256sum "$ROLLOUT_DIR/smoke.head.sql" | awk '{print $1}')"
test "$CURRENT_MIGRATION_SHA" = "$HEAD_MIGRATION_SHA"
test "$CURRENT_SMOKE_SHA" = "$HEAD_SMOKE_SHA"

printf '%s\n' "$HEAD_COMMIT" >"$ROLLOUT_DIR/git-commit.txt"
date -u +%Y-%m-%dT%H:%M:%SZ >"$ROLLOUT_DIR/timestamp-utc.txt"
sha256sum "$MIGRATION_PATH" "$SMOKE_PATH" >"$ROLLOUT_DIR/reviewed-inputs.sha256"
sha256sum -c "$ROLLOUT_DIR/reviewed-inputs.sha256"
```

`git diff HEAD --exit-code` одновременно отвергает staged и unstaged изменения этих двух файлов. `git show` плюс `cmp` и отдельная SHA-256 parity доказывают, что рабочие копии байт-в-байт равны blob-объектам записанного `HEAD_COMMIT`. Перед передачей на isolated host и production DB host сравнить SHA-256 каждой загруженной копии с `reviewed-inputs.sha256`. Требуется SHA-256 parity локального reviewed файла, rehearsal-копии и production-копии. Фиксируются git commit, SHA-256 и timestamp; изменённая после review копия не используется.

## Рубеж 1: свежий backup текущего запуска

Backup должен быть создан именно в current run после фиксации commit и хешей. Нельзя использовать «последний известный» архив от предыдущего запуска.

```bash
set -euo pipefail

BACKUP_ROOT="/srv/letscube/backups/automated"
BACKUP_SCRIPT="/srv/letscube/scripts/letscube-backup.sh"
BACKUP_LOCK="/run/letscube-backup.lock"
STRICT_BACKUP_NAME='^[0-9]{8}-[0-9]{6}$'
BACKUP_COMPLETED_RE='^backup completed: (/srv/letscube/backups/automated/[0-9]{8}-[0-9]{6})$'

test -r "$BACKUP_SCRIPT"
grep -Eq '^LOCK=(/run/letscube-backup[.]lock|"/run/letscube-backup[.]lock")$' "$BACKUP_SCRIPT"
grep -Eq 'flock[[:space:]]+-n[[:space:]]+9' "$BACKUP_SCRIPT"
grep -Eq 'exec[[:space:]]+9>|9>.*\$\{?LOCK\}?' "$BACKUP_SCRIPT"
mapfile -t BEFORE_BACKUPS < <(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    awk -v pattern="$STRICT_BACKUP_NAME" '$0 ~ pattern' | LC_ALL=C sort
)

sudo "$BACKUP_SCRIPT" check
BACKUP_OUTPUT="$ROLLOUT_DIR/backup-command.out"
: >"$BACKUP_OUTPUT"
chmod 600 "$BACKUP_OUTPUT"
if ! sudo "$BACKUP_SCRIPT" run >"$BACKUP_OUTPUT" 2>&1; then
  exit 70
fi

mapfile -t BACKUP_COMPLETIONS < <(
  sed -nE "s|$BACKUP_COMPLETED_RE|\1|p" "$BACKUP_OUTPUT"
)
test "${#BACKUP_COMPLETIONS[@]}" -eq 1
BACKUP_DIR="${BACKUP_COMPLETIONS[0]}"
BACKUP_NAME="$(basename "$BACKUP_DIR")"
[[ "$BACKUP_NAME" =~ ^[0-9]{8}-[0-9]{6}$ ]]

mapfile -t AFTER_BACKUPS < <(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    awk -v pattern="$STRICT_BACKUP_NAME" '$0 ~ pattern' | LC_ALL=C sort
)
NEW_BACKUPS="$({
  comm -13 \
    <(printf '%s\n' "${BEFORE_BACKUPS[@]}") \
    <(printf '%s\n' "${AFTER_BACKUPS[@]}")
} | sed '/^$/d')"
test "$(printf '%s\n' "$NEW_BACKUPS" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1
test "$(printf '%s\n' "$NEW_BACKUPS" | sed '/^$/d')" = "$BACKUP_NAME"
if printf '%s\n' "${BEFORE_BACKUPS[@]}" | grep -Fxq "$BACKUP_NAME"; then
  exit 71
fi

test "$BACKUP_DIR" = "$BACKUP_ROOT/$BACKUP_NAME"
test -d "$BACKUP_DIR"
test -f "$BACKUP_DIR/MANIFEST.txt"
test -f "$BACKUP_DIR/SHA256SUMS"

mapfile -t MANIFEST_CREATED_AT < <(
  sed -n 's/^created_at=//p' "$BACKUP_DIR/MANIFEST.txt"
)
test "${#MANIFEST_CREATED_AT[@]}" -eq 1
test "${MANIFEST_CREATED_AT[0]}" = "$BACKUP_NAME"

(
  cd "$BACKUP_DIR"
  sha256sum -c SHA256SUMS
)

mapfile -d '' DB_DUMPS < <(
  find "$BACKUP_DIR" -type f \
    \( -name '*.custom' -o -name '*.dump' -o -name '*.backup' \) -print0
)
test "${#DB_DUMPS[@]}" -gt 0
for dump in "${DB_DUMPS[@]}"; do
  pg_restore --list "$dump" >/dev/null
done

mapfile -d '' TAR_ARCHIVES < <(find "$BACKUP_DIR" -type f \( -name '*.tar' -o -name '*.tar.gz' -o -name '*.tgz' \) -print0)
test "${#TAR_ARCHIVES[@]}" -gt 0
for archive in "${TAR_ARCHIVES[@]}"; do
  tar -tf "$archive" >/dev/null
done

BACKUP_SHA256SUMS_SHA256="$(sha256sum "$BACKUP_DIR/SHA256SUMS" | awk '{print $1}')"
[[ "$BACKUP_SHA256SUMS_SHA256" =~ ^[0-9a-f]{64}$ ]]
{
  printf 'run_id=%s\n' "$RUN_ID"
  printf 'backup_dir=%s\n' "$BACKUP_DIR"
  printf 'backup_name=%s\n' "$BACKUP_NAME"
  printf 'backup_sha256sums_sha256=%s\n' "$BACKUP_SHA256SUMS_SHA256"
} >"$ROLLOUT_DIR/backup-binding.env"
chmod 600 "$ROLLOUT_DIR/backup-binding.env"
stat -c '%n %s %y' "$BACKUP_DIR" "$BACKUP_DIR/MANIFEST.txt" "$BACKUP_DIR/SHA256SUMS" >"$ROLLOUT_DIR/backup-current-run.txt"
```

Сам backup script владеет exclusive lock через fd 9 и `flock -n 9`; внешний wrapper не пытается повторно захватить тот же lock. При одновременном timer/manual запуске один процесс обязан завершиться неуспешно. Приватный `backup-command.out` не выводится в terminal; допустима ровно одна anchored final line `backup completed: /srv/letscube/backups/automated/YYYYMMDD-HHMMSS`. Она, before/after guard, basename каталога и `MANIFEST.txt` с `created_at=$STAMP` обязаны указывать один и тот же backup. Успешные `sha256sum -c`, `pg_restore --list` и `tar -tf` обязательны, но сами по себе не доказывают восстановимость.

## Рубеж 2: полный isolated PG17 restore rehearsal

1. Подготовить отдельный Compose-файл с чистым PG17, Auth, Storage и PostgREST. Project name обязан иметь вид `letscube-bot-rehearsal-*`, единственная сеть сервисов должна быть `internal: true`, а DB host-port для libpq service может быть опубликован только на loopback.
2. Указать точный custom dump текущего backup в `BACKUP_DB_DUMP`. Flow ниже требует штатные `db/supabase-postgres.custom` и `storage/supabase-storage.tgz`, сверяя оба с текущим `BACKUP_DIR/SHA256SUMS`; ссылка на другой каталог или файл запрещена.
3. Не инициализировать Supabase schema до запуска flow. Он требует ноль user relations в target DB и пустой private storage bind mount, затем сам выполняет fail-stop database и object restore.
4. Не задавать health URL. Они выводятся только из проверенных Compose service labels и проверяются из той же internal Docker network. Production DNS, произвольный host и внешний network этим flow не принимаются.
5. Не выводить restore log, health response, имена storage objects или строки таблиц. Evidence содержит только локальные container/network identity, SHA-256 и privacy-safe aggregate counts.

```bash
set -euo pipefail
: "${REHEARSAL_PGSERVICE:?Set an isolated PG17 libpq service name}"
: "${REHEARSAL_COMPOSE_FILE:?Set the isolated Compose file}"
: "${REHEARSAL_COMPOSE_PROJECT:?Set the isolated Compose project}"
: "${REHEARSAL_NETWORK:?Set the isolated Compose network name}"
: "${REHEARSAL_DB_SERVICE:?Set the Compose database service}"
: "${REHEARSAL_AUTH_SERVICE:?Set the Compose Auth service}"
: "${REHEARSAL_STORAGE_SERVICE:?Set the Compose Storage service}"
: "${REHEARSAL_POSTGREST_SERVICE:?Set the Compose PostgREST service}"
: "${REHEARSAL_DB_NAME:?Set the blank rehearsal database name}"
: "${RUN_ID:?Keep the current rollout RUN_ID}"
: "${BACKUP_DIR:?Keep the exact current-run BACKUP_DIR}"
: "${BACKUP_SHA256SUMS_SHA256:?Keep the exact SHA256SUMS digest}"
: "${BACKUP_DB_DUMP:?Set the exact current backup custom dump}"

[[ "$REHEARSAL_COMPOSE_PROJECT" =~ ^letscube-bot-rehearsal-[a-z0-9][a-z0-9_-]{0,40}$ ]]
for service in \
  "$REHEARSAL_DB_SERVICE" \
  "$REHEARSAL_AUTH_SERVICE" \
  "$REHEARSAL_STORAGE_SERVICE" \
  "$REHEARSAL_POSTGREST_SERVICE"; do
  [[ "$service" =~ ^[a-z0-9][a-z0-9_-]{0,40}$ ]]
done
[[ "$REHEARSAL_DB_NAME" =~ ^[a-zA-Z0-9_]+$ ]]

REHEARSAL_COMPOSE_FILE="$(realpath -e "$REHEARSAL_COMPOSE_FILE")"
BACKUP_DIR="$(realpath -e "$BACKUP_DIR")"
BACKUP_DB_DUMP="$(realpath -e "$BACKUP_DB_DUMP")"
BACKUP_STORAGE_ARCHIVE="$(realpath -e "$BACKUP_DIR/storage/supabase-storage.tgz")"
case "$BACKUP_DB_DUMP" in
  "$BACKUP_DIR"/*) ;;
  *) exit 72 ;;
esac
test "$BACKUP_DB_DUMP" = "$BACKUP_DIR/db/supabase-postgres.custom"
test "$BACKUP_STORAGE_ARCHIVE" = "$BACKUP_DIR/storage/supabase-storage.tgz"

CURRENT_BACKUP_SHA256SUMS_SHA256="$(sha256sum "$BACKUP_DIR/SHA256SUMS" | awk '{print $1}')"
test "$CURRENT_BACKUP_SHA256SUMS_SHA256" = "$BACKUP_SHA256SUMS_SHA256"
BACKUP_DB_RELATIVE="$(realpath --relative-to="$BACKUP_DIR" "$BACKUP_DB_DUMP")"
BACKUP_STORAGE_RELATIVE="$(realpath --relative-to="$BACKUP_DIR" "$BACKUP_STORAGE_ARCHIVE")"
[[ "$BACKUP_DB_RELATIVE" != ../* ]]
test "$BACKUP_STORAGE_RELATIVE" = "storage/supabase-storage.tgz"

manifest_sha_for() {
  local relative_path="$1"
  awk -v wanted="$relative_path" '
    {
      digest = $1
      name = $0
      sub(/^[^[:space:]]+[[:space:]]+[* ]?/, "", name)
      if (name == wanted || name == "./" wanted) {
        matches++
        value = digest
      }
    }
    END {
      if (matches != 1 || value !~ /^[0-9a-f]{64}$/) exit 73
      print value
    }
  ' "$BACKUP_DIR/SHA256SUMS"
}

BACKUP_DB_DUMP_SHA256="$(manifest_sha_for "$BACKUP_DB_RELATIVE")"
BACKUP_STORAGE_ARCHIVE_SHA256="$(manifest_sha_for "$BACKUP_STORAGE_RELATIVE")"
test "$(sha256sum "$BACKUP_DB_DUMP" | awk '{print $1}')" = "$BACKUP_DB_DUMP_SHA256"
test "$(sha256sum "$BACKUP_STORAGE_ARCHIVE" | awk '{print $1}')" = "$BACKUP_STORAGE_ARCHIVE_SHA256"
pg_restore --list "$BACKUP_DB_DUMP" >/dev/null
tar -tzf "$BACKUP_STORAGE_ARCHIVE" |
  awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { exit 74 }'
tar -tvzf "$BACKUP_STORAGE_ARCHIVE" |
  awk 'substr($1, 1, 1) !~ /^[-d]$/ { exit 75 }'

count_dump_copy_rows() {
  local relation="$1"
  pg_restore \
    --data-only \
    --table="$relation" \
    --file=- \
    "$BACKUP_DB_DUMP" |
    awk -v relation="$relation" '
      BEGIN {
        gsub(/[.]/, "[.]", relation)
        copies = 0
        rows = 0
        in_copy = 0
      }
      $0 ~ ("^COPY " relation " \\(") && $0 ~ / FROM stdin;$/ {
        copies++
        in_copy = 1
        next
      }
      in_copy && $0 == "\\." {
        in_copy = 0
        next
      }
      in_copy {
        rows++
        if (rows > 1000000000) exit 76
      }
      END {
        if (copies != 1 || in_copy) exit 77
        print rows
      }
    '
}

SOURCE_AUTH_USERS_COUNT="$(count_dump_copy_rows auth.users)"
SOURCE_STORAGE_OBJECTS_COUNT="$(count_dump_copy_rows storage.objects)"
SOURCE_MESSAGES_COUNT="$(count_dump_copy_rows public.messages)"
SOURCE_PROFILES_COUNT="$(count_dump_copy_rows public.profiles)"
for count in \
  "$SOURCE_AUTH_USERS_COUNT" \
  "$SOURCE_STORAGE_OBJECTS_COUNT" \
  "$SOURCE_MESSAGES_COUNT" \
  "$SOURCE_PROFILES_COUNT"; do
  [[ "$count" =~ ^[0-9]+$ ]]
done
test "$SOURCE_AUTH_USERS_COUNT" -gt 0
test "$SOURCE_STORAGE_OBJECTS_COUNT" -gt 0
test "$SOURCE_PROFILES_COUNT" -gt 0

REHEARSAL_STORAGE_ROOT="$ROLLOUT_DIR/rehearsal-storage"
install -d -m 700 "$REHEARSAL_STORAGE_ROOT"
test -z "$(find "$REHEARSAL_STORAGE_ROOT" -mindepth 1 -print -quit)"
export REHEARSAL_STORAGE_ROOT

compose() {
  docker compose \
    -f "$REHEARSAL_COMPOSE_FILE" \
    -p "$REHEARSAL_COMPOSE_PROJECT" \
    "$@"
}

compose up -d "$REHEARSAL_DB_SERVICE"
compose create \
  "$REHEARSAL_AUTH_SERVICE" \
  "$REHEARSAL_STORAGE_SERVICE" \
  "$REHEARSAL_POSTGREST_SERVICE"

NETWORK_PROJECT="$(docker network inspect \
  --format '{{index .Labels "com.docker.compose.project"}}' \
  "$REHEARSAL_NETWORK")"
NETWORK_INTERNAL="$(docker network inspect --format '{{.Internal}}' "$REHEARSAL_NETWORK")"
REHEARSAL_NETWORK_ID="$(docker network inspect --format '{{.Id}}' "$REHEARSAL_NETWORK")"
test "$NETWORK_PROJECT" = "$REHEARSAL_COMPOSE_PROJECT"
test "$NETWORK_INTERNAL" = "true"
[[ "$REHEARSAL_NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]

compose_container_id() {
  local service="$1"
  local container_ids
  mapfile -t container_ids < <(compose ps --all -q "$service")
  test "${#container_ids[@]}" -eq 1
  test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "${container_ids[0]}")" = \
    "$REHEARSAL_COMPOSE_PROJECT"
  test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "${container_ids[0]}")" = \
    "$service"
  printf '%s\n' "${container_ids[0]}"
}

REHEARSAL_DB_CONTAINER_ID="$(compose_container_id "$REHEARSAL_DB_SERVICE")"
REHEARSAL_STORAGE_CONTAINER_ID="$(compose_container_id "$REHEARSAL_STORAGE_SERVICE")"
test "$(docker inspect --format '{{len .NetworkSettings.Networks}}' "$REHEARSAL_DB_CONTAINER_ID")" -eq 1
DB_CONTAINER_IP="$(docker inspect \
  --format "{{with index .NetworkSettings.Networks \"$REHEARSAL_NETWORK\"}}{{.IPAddress}}{{end}}" \
  "$REHEARSAL_DB_CONTAINER_ID")"
test -n "$DB_CONTAINER_IP"

REHEARSAL_STORAGE_CONTAINER_PATH="/var/lib/storage"
mapfile -t STORAGE_MOUNT_SOURCES < <(
  docker inspect \
    --format '{{range .Mounts}}{{printf "%s\t%s\n" .Source .Destination}}{{end}}' \
    "$REHEARSAL_STORAGE_CONTAINER_ID" |
    awk -F '\t' -v destination="$REHEARSAL_STORAGE_CONTAINER_PATH" \
      '$2 == destination { print $1 }'
)
test "${#STORAGE_MOUNT_SOURCES[@]}" -eq 1
STORAGE_MOUNT_SOURCE="$(realpath -e "${STORAGE_MOUNT_SOURCES[0]}")"
test "$STORAGE_MOUNT_SOURCE" = "$(realpath -e "$REHEARSAL_STORAGE_ROOT")"

DB_IDENTITY_SQL="select current_database(), coalesce(inet_server_addr()::text, ''), current_setting('server_version_num'), (select system_identifier::text from pg_control_system()), to_char(pg_postmaster_start_time() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US')"
DB_IDENTITY_BEFORE="$(psql -X "service=$REHEARSAL_PGSERVICE" -AtF '|' -v ON_ERROR_STOP=1 -c "$DB_IDENTITY_SQL")"
IFS='|' read -r DB_NAME INET_SERVER_ADDR PG_VERSION_NUM DB_SYSTEM_IDENTIFIER DB_POSTMASTER_STARTED \
  <<<"$DB_IDENTITY_BEFORE"
test "$DB_NAME" = "$REHEARSAL_DB_NAME"
test "$INET_SERVER_ADDR" = "$DB_CONTAINER_IP"
test "$PG_VERSION_NUM" -ge 170000
[[ "$DB_SYSTEM_IDENTIFIER" =~ ^[0-9]+$ ]]
test -n "$DB_POSTMASTER_STARTED"

FRESH_USER_RELATION_COUNT="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 <<'SQL'
select count(*)
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname !~ '^pg_toast'
  and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f');
SQL
)"
[[ "$FRESH_USER_RELATION_COUNT" =~ ^[0-9]+$ ]]
test "$FRESH_USER_RELATION_COUNT" -eq 0

RESTORE_EVIDENCE_DIR="$ROLLOUT_DIR/restore-evidence"
install -d -m 700 "$RESTORE_EVIDENCE_DIR"
RESTORE_LOG="$RESTORE_EVIDENCE_DIR/restore.log"
install -m 600 /dev/null "$RESTORE_LOG"
PGOPTIONS='-c statement_timeout=0' pg_restore \
  --exit-on-error \
  --verbose \
  --dbname="service=$REHEARSAL_PGSERVICE" \
  "$BACKUP_DB_DUMP" >"$RESTORE_LOG" 2>&1
chmod 600 "$RESTORE_LOG"
RESTORE_LOG_SHA256="$(sha256sum "$RESTORE_LOG" | awk '{print $1}')"

DB_IDENTITY_AFTER="$(psql -X "service=$REHEARSAL_PGSERVICE" -AtF '|' -v ON_ERROR_STOP=1 -c "$DB_IDENTITY_SQL")"
test "$DB_IDENTITY_AFTER" = "$DB_IDENTITY_BEFORE"
TARGET_AUTH_USERS_COUNT="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 -c 'select count(*) from auth.users')"
TARGET_STORAGE_OBJECTS_COUNT="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 -c 'select count(*) from storage.objects')"
TARGET_MESSAGES_COUNT="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 -c 'select count(*) from public.messages')"
TARGET_PROFILES_COUNT="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 -c 'select count(*) from public.profiles')"
test "$TARGET_AUTH_USERS_COUNT" = "$SOURCE_AUTH_USERS_COUNT"
test "$TARGET_STORAGE_OBJECTS_COUNT" = "$SOURCE_STORAGE_OBJECTS_COUNT"
test "$TARGET_MESSAGES_COUNT" = "$SOURCE_MESSAGES_COUNT"
test "$TARGET_PROFILES_COUNT" = "$SOURCE_PROFILES_COUNT"
storage_aggregate() {
  find "$1" -type f -printf '%s\n' |
    awk '{ files++; bytes += $1 } END { printf "%.0f %.0f\n", files, bytes }'
}

SOURCE_STORAGE_SCAN_DIR="$(mktemp -d "$ROLLOUT_DIR/.storage-source.XXXXXX")"
chmod 700 "$SOURCE_STORAGE_SCAN_DIR"
cleanup_source_storage_scan() {
  find "$SOURCE_STORAGE_SCAN_DIR" -depth -delete
}
trap cleanup_source_storage_scan EXIT
tar --extract --gzip --file "$BACKUP_STORAGE_ARCHIVE" \
  --directory "$SOURCE_STORAGE_SCAN_DIR" \
  --no-same-owner --no-same-permissions
read -r SOURCE_STORAGE_FILE_COUNT SOURCE_STORAGE_TOTAL_BYTES \
  < <(storage_aggregate "$SOURCE_STORAGE_SCAN_DIR")
test "$SOURCE_STORAGE_FILE_COUNT" -gt 0
test "$SOURCE_STORAGE_TOTAL_BYTES" -gt 0

tar --extract --gzip --file "$BACKUP_STORAGE_ARCHIVE" \
  --directory "$REHEARSAL_STORAGE_ROOT" \
  --no-same-owner --no-same-permissions
read -r TARGET_STORAGE_FILE_COUNT TARGET_STORAGE_TOTAL_BYTES \
  < <(storage_aggregate "$REHEARSAL_STORAGE_ROOT")
test "$TARGET_STORAGE_FILE_COUNT" = "$SOURCE_STORAGE_FILE_COUNT"
test "$TARGET_STORAGE_TOTAL_BYTES" = "$SOURCE_STORAGE_TOTAL_BYTES"
cleanup_source_storage_scan
trap - EXIT

compose start \
  "$REHEARSAL_AUTH_SERVICE" \
  "$REHEARSAL_STORAGE_SERVICE" \
  "$REHEARSAL_POSTGREST_SERVICE"
REHEARSAL_AUTH_CONTAINER_ID="$(compose_container_id "$REHEARSAL_AUTH_SERVICE")"
REHEARSAL_STORAGE_CONTAINER_ID_AFTER="$(compose_container_id "$REHEARSAL_STORAGE_SERVICE")"
REHEARSAL_POSTGREST_CONTAINER_ID="$(compose_container_id "$REHEARSAL_POSTGREST_SERVICE")"
test "$REHEARSAL_STORAGE_CONTAINER_ID_AFTER" = "$REHEARSAL_STORAGE_CONTAINER_ID"

for container_id in \
  "$REHEARSAL_DB_CONTAINER_ID" \
  "$REHEARSAL_AUTH_CONTAINER_ID" \
  "$REHEARSAL_STORAGE_CONTAINER_ID" \
  "$REHEARSAL_POSTGREST_CONTAINER_ID"; do
  test "$(docker inspect --format '{{len .NetworkSettings.Networks}}' "$container_id")" -eq 1
  test -n "$(docker inspect \
    --format "{{with index .NetworkSettings.Networks \"$REHEARSAL_NETWORK\"}}{{.IPAddress}}{{end}}" \
    "$container_id")"
done

AUTH_HEALTH_URL="http://${REHEARSAL_AUTH_SERVICE}:9999/health"
STORAGE_HEALTH_URL="http://${REHEARSAL_STORAGE_SERVICE}:5000/status"
POSTGREST_HEALTH_URL="http://${REHEARSAL_POSTGREST_SERVICE}:3000/"
HEALTH_RESPONSE_DIR="$ROLLOUT_DIR/.health-responses"
install -d -m 700 "$HEALTH_RESPONSE_DIR"

probe_health() {
  local label="$1"
  local container_id="$2"
  local url="$3"
  local evidence="$4"
  local response="$HEALTH_RESPONSE_DIR/$label.response"
  install -m 600 /dev/null "$response"
  docker run --rm --network "$REHEARSAL_NETWORK" curlimages/curl:8.12.1 \
    -fsS --max-time 15 "$url" >"$response"
  printf '%s_health=ok\ncontainer_id=%s\nnetwork_id=%s\nresponse_sha256=%s\n' \
    "$label" \
    "$container_id" \
    "$REHEARSAL_NETWORK_ID" \
    "$(sha256sum "$response" | awk '{print $1}')" \
    >"$evidence"
  chmod 600 "$evidence"
  find "$response" -delete
}

probe_health auth "$REHEARSAL_AUTH_CONTAINER_ID" "$AUTH_HEALTH_URL" \
  "$RESTORE_EVIDENCE_DIR/auth-evidence.txt"
probe_health storage "$REHEARSAL_STORAGE_CONTAINER_ID" "$STORAGE_HEALTH_URL" \
  "$RESTORE_EVIDENCE_DIR/storage-health-evidence.txt"
probe_health postgrest "$REHEARSAL_POSTGREST_CONTAINER_ID" "$POSTGREST_HEALTH_URL" \
  "$RESTORE_EVIDENCE_DIR/postgrest-evidence.txt"
find "$HEALTH_RESPONSE_DIR" -depth -delete

printf 'database_restore=ok\nserver_version_num=%s\ndatabase_name=%s\nsystem_identifier=%s\ndump_sha256=%s\nrestore_log_sha256=%s\nsource_auth_users_count=%s\ntarget_auth_users_count=%s\nsource_storage_objects_count=%s\ntarget_storage_objects_count=%s\nsource_messages_count=%s\ntarget_messages_count=%s\nsource_profiles_count=%s\ntarget_profiles_count=%s\n' \
  "$PG_VERSION_NUM" \
  "$DB_NAME" \
  "$DB_SYSTEM_IDENTIFIER" \
  "$BACKUP_DB_DUMP_SHA256" \
  "$RESTORE_LOG_SHA256" \
  "$SOURCE_AUTH_USERS_COUNT" \
  "$TARGET_AUTH_USERS_COUNT" \
  "$SOURCE_STORAGE_OBJECTS_COUNT" \
  "$TARGET_STORAGE_OBJECTS_COUNT" \
  "$SOURCE_MESSAGES_COUNT" \
  "$TARGET_MESSAGES_COUNT" \
  "$SOURCE_PROFILES_COUNT" \
  "$TARGET_PROFILES_COUNT" \
  >"$RESTORE_EVIDENCE_DIR/database-evidence.txt"

printf 'storage_restore=ok\narchive_sha256=%s\nsource_storage_file_count=%s\ntarget_storage_file_count=%s\nsource_storage_total_bytes=%s\ntarget_storage_total_bytes=%s\n' \
  "$BACKUP_STORAGE_ARCHIVE_SHA256" \
  "$SOURCE_STORAGE_FILE_COUNT" \
  "$TARGET_STORAGE_FILE_COUNT" \
  "$SOURCE_STORAGE_TOTAL_BYTES" \
  "$TARGET_STORAGE_TOTAL_BYTES" \
  >"$RESTORE_EVIDENCE_DIR/storage-evidence.txt"

printf 'compose_project=%s\nnetwork_name=%s\nnetwork_id=%s\ndatabase_container_id=%s\ndatabase_system_identifier=%s\nauth_container_id=%s\nstorage_container_id=%s\npostgrest_container_id=%s\ndatabase_identity=%s\n' \
  "$REHEARSAL_COMPOSE_PROJECT" \
  "$REHEARSAL_NETWORK" \
  "$REHEARSAL_NETWORK_ID" \
  "$REHEARSAL_DB_CONTAINER_ID" \
  "$DB_SYSTEM_IDENTIFIER" \
  "$REHEARSAL_AUTH_CONTAINER_ID" \
  "$REHEARSAL_STORAGE_CONTAINER_ID" \
  "$REHEARSAL_POSTGREST_CONTAINER_ID" \
  "$DB_IDENTITY_AFTER" \
  >"$RESTORE_EVIDENCE_DIR/target-identity.txt"

chmod 600 "$RESTORE_EVIDENCE_DIR"/*.txt
(
  cd "$ROLLOUT_DIR"
  sha256sum \
    restore-evidence/restore.log \
    restore-evidence/database-evidence.txt \
    restore-evidence/auth-evidence.txt \
    restore-evidence/storage-evidence.txt \
    restore-evidence/storage-health-evidence.txt \
    restore-evidence/postgrest-evidence.txt \
    restore-evidence/target-identity.txt \
    >restore-evidence.sha256
  sha256sum -c restore-evidence.sha256
)

RESTORE_EVIDENCE_SHA256="$(sha256sum "$ROLLOUT_DIR/restore-evidence.sha256" | awk '{print $1}')"
DATABASE_EVIDENCE_SHA256="$(sha256sum "$RESTORE_EVIDENCE_DIR/database-evidence.txt" | awk '{print $1}')"
AUTH_EVIDENCE_SHA256="$(sha256sum "$RESTORE_EVIDENCE_DIR/auth-evidence.txt" | awk '{print $1}')"
STORAGE_EVIDENCE_SHA256="$(sha256sum "$RESTORE_EVIDENCE_DIR/storage-evidence.txt" | awk '{print $1}')"
STORAGE_HEALTH_EVIDENCE_SHA256="$(sha256sum "$RESTORE_EVIDENCE_DIR/storage-health-evidence.txt" | awk '{print $1}')"
POSTGREST_EVIDENCE_SHA256="$(sha256sum "$RESTORE_EVIDENCE_DIR/postgrest-evidence.txt" | awk '{print $1}')"
TARGET_IDENTITY_SHA256="$(sha256sum "$RESTORE_EVIDENCE_DIR/target-identity.txt" | awk '{print $1}')"
RESTORE_GATE="$ROLLOUT_DIR/restore-gate.env"
{
  printf 'version=2\n'
  printf 'run_id=%s\n' "$RUN_ID"
  printf 'backup_dir=%s\n' "$BACKUP_DIR"
  printf 'backup_sha256sums_sha256=%s\n' "$BACKUP_SHA256SUMS_SHA256"
  printf 'backup_db_dump_sha256=%s\n' "$BACKUP_DB_DUMP_SHA256"
  printf 'backup_storage_archive_sha256=%s\n' "$BACKUP_STORAGE_ARCHIVE_SHA256"
  printf 'rehearsal_compose_project=%s\n' "$REHEARSAL_COMPOSE_PROJECT"
  printf 'rehearsal_network_name=%s\n' "$REHEARSAL_NETWORK"
  printf 'rehearsal_network_id=%s\n' "$REHEARSAL_NETWORK_ID"
  printf 'rehearsal_db_container_id=%s\n' "$REHEARSAL_DB_CONTAINER_ID"
  printf 'rehearsal_db_system_identifier=%s\n' "$DB_SYSTEM_IDENTIFIER"
  printf 'target_identity_sha256=%s\n' "$TARGET_IDENTITY_SHA256"
  printf 'restore_log_sha256=%s\n' "$RESTORE_LOG_SHA256"
  printf 'database_evidence_sha256=%s\n' "$DATABASE_EVIDENCE_SHA256"
  printf 'auth_evidence_sha256=%s\n' "$AUTH_EVIDENCE_SHA256"
  printf 'storage_evidence_sha256=%s\n' "$STORAGE_EVIDENCE_SHA256"
  printf 'storage_health_evidence_sha256=%s\n' "$STORAGE_HEALTH_EVIDENCE_SHA256"
  printf 'postgrest_evidence_sha256=%s\n' "$POSTGREST_EVIDENCE_SHA256"
  printf 'restore_evidence_sha256=%s\n' "$RESTORE_EVIDENCE_SHA256"
  printf 'source_auth_users_count=%s\n' "$SOURCE_AUTH_USERS_COUNT"
  printf 'target_auth_users_count=%s\n' "$TARGET_AUTH_USERS_COUNT"
  printf 'source_storage_objects_count=%s\n' "$SOURCE_STORAGE_OBJECTS_COUNT"
  printf 'target_storage_objects_count=%s\n' "$TARGET_STORAGE_OBJECTS_COUNT"
  printf 'source_messages_count=%s\n' "$SOURCE_MESSAGES_COUNT"
  printf 'target_messages_count=%s\n' "$TARGET_MESSAGES_COUNT"
  printf 'source_profiles_count=%s\n' "$SOURCE_PROFILES_COUNT"
  printf 'target_profiles_count=%s\n' "$TARGET_PROFILES_COUNT"
  printf 'source_storage_file_count=%s\n' "$SOURCE_STORAGE_FILE_COUNT"
  printf 'target_storage_file_count=%s\n' "$TARGET_STORAGE_FILE_COUNT"
  printf 'source_storage_total_bytes=%s\n' "$SOURCE_STORAGE_TOTAL_BYTES"
  printf 'target_storage_total_bytes=%s\n' "$TARGET_STORAGE_TOTAL_BYTES"
} >"$RESTORE_GATE.tmp"
chmod 600 "$RESTORE_GATE.tmp"
mv "$RESTORE_GATE.tmp" "$RESTORE_GATE"
(
  cd "$ROLLOUT_DIR"
  sha256sum restore-gate.env >restore-gate.env.sha256
  sha256sum -c restore-gate.env.sha256
)
chmod 600 "$ROLLOUT_DIR/restore-gate.env.sha256"
```

`pg_restore --exit-on-error` является fail-stop эквивалентом `ON_ERROR_STOP` для custom dump; все SQL probes выполняются через `psql -v ON_ERROR_STOP=1`. Empty initialized Supabase не проходит `FRESH_USER_RELATION_COUNT=0`, а пустой или частично восстановленный target не проходит ненулевые source counts и exact source/target parity. Libpq service не может указывать production: server address должен совпасть с IP проверенного Compose DB container, каждый service имеет labels того же rehearsal project, единственную `internal: true` network и неизменный container/network identity. Health endpoints имеют фиксированные container-local host/port/path и не принимаются из окружения.

Storage archive дважды извлекается без вывода имён: сначала во временный private source scan, затем в доказанно пустой bind mount под текущим `ROLLOUT_DIR`. File count и total uncompressed bytes должны быть ненулевыми и точно совпасть. Полные responses и restore log остаются mode `0600`; gate хранит только их hashes и privacy-safe counts. Без `restore-gate.env`, `restore-gate.env.sha256` и связанного evidence дальнейшие команды не выполняются.

## Рубеж 3: one-shot и partial-schema gate

Проверку сначала выполнить на восстановленной isolated DB, затем повторить на production непосредственно перед maintenance window. Любой результат больше нуля означает partial bot schema или ранее выполненный apply; rerun запрещён.

```bash
set -euo pipefail
: "${PGSERVICE:?Set the target libpq service name}"

PARTIAL_BOT_OBJECTS="$(psql -X "service=$PGSERVICE" -Atv ON_ERROR_STOP=1 <<'SQL'
with found as (
  select 1
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and (
      c.relname in ('bots', 'bot_owners', 'bot_commands', 'chat_bot_members')
      or c.relname like 'bot\_%' escape '\'
    )
  union all
  select 1
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.proname like 'bot\_%' escape '\'
  union all
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'messages'
    and column_name in ('bot_id', 'bot_reply_markup')
  union all
  select 1
  from pg_catalog.pg_trigger
  where not tgisinternal and tgname like '%bot%'
)
select count(*) from found;
SQL
)"
test "$PARTIAL_BOT_OBJECTS" = "0"
```

Migration ledger отсутствует, поэтому после успешного apply оператор вручную добавляет в защищённый ops-report: commit, оба SHA-256, UTC timestamp, backup path, restore evidence и результат apply. Повторный запуск файла не используется как проверка идемпотентности.

## Рубеж 4: production baseline без сырых данных

Production baseline и post-rollback parity должны включать схему, functions, grants and policies, triggers, constraints и indexes. `pg_dump --schema-only` канонизируется, потому что PG17 добавляет случайные `\\restrict`/`\\unrestrict` markers.

```bash
set -euo pipefail
: "${PGSERVICE:?Set the production libpq service name}"

capture_schema() {
  label="$1"
  pg_dump --dbname="service=$PGSERVICE" --schema-only --no-owner >"$ROLLOUT_DIR/$label.raw.sql"
  sed '/^\\restrict /d; /^\\unrestrict /d' "$ROLLOUT_DIR/$label.raw.sql" >"$ROLLOUT_DIR/$label.schema.sql"
  sha256sum "$ROLLOUT_DIR/$label.schema.sql" >"$ROLLOUT_DIR/$label.schema.sha256"
}

capture_schema baseline

psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 --csv >"$ROLLOUT_DIR/baseline-sender-aggregates.csv" <<'SQL'
select
  count(*) filter (
    where coalesce(type, 'text') <> 'system'
      and user_id is null
      and coalesce(to_jsonb(m)->>'bot_id', '') = ''
  ) as tombstone_count,
  count(*) filter (
    where user_id is not null
      and coalesce(to_jsonb(m)->>'bot_id', '') <> ''
  ) as dual_sender_count,
  count(*) filter (
    where type = 'system'
      and (
        user_id is not null
        or coalesce(to_jsonb(m)->>'bot_id', '') <> ''
      )
  ) as system_sender_count
from public.messages m;
SQL
```

Это только aggregate counts: tombstone, dual-sender и system-sender; правило **no raw user data** обязательно. Запрещены message bodies, email, phone, profile rows, tokens, push endpoints и любые другие пользовательские строки. Baseline tombstone count должен быть явно одобрен; dual-sender и invalid system-sender должны быть равны нулю.

Сохранить также размеры таблиц, список активных/долгих транзакций и catalog-only сведения о затрагиваемых functions, grants и policies. Нельзя выгружать строки пользовательских таблиц.

## Рубеж 5: maintenance window и side-effect audit

Combined rehearsal удерживает `AccessExclusive` locks от первых `ALTER TABLE public.messages` до общего `ROLLBACK`. Smoke временно изменяет existing rows и затем откатывает их. Поэтому production rehearsal разрешён только в заранее объявленное **maintenance window**, когда записи app и worker остановлены.

1. Включить maintenance response в web/app на уровне оркестратора.
2. Остановить проверенные контейнеры/сервисы приложения и worker через Coolify; не угадывать имена контейнеров и не останавливать Supabase DB.
3. Убедиться, что app and worker writes stopped; завершить rollout при наличии неизвестных writers или long-running transactions.
4. До smoke провести trigger audit for external nontransactional side effects на затрагиваемых таблицах. Любой такой вызов (`http`, `net.http`, `dblink`, `pg_background`, `COPY PROGRAM`, внешний shell) является blocker. Transactional `NOTIFY` отдельно документируется и доставляется только после commit.

```bash
set -euo pipefail
: "${PGSERVICE:?Set the production libpq service name}"

psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -At >"$ROLLOUT_DIR/trigger-side-effect-audit.txt" <<'SQL'
select format('%I.%I|%I|%s', nt.nspname, ct.relname, t.tgname, pg_get_functiondef(p.oid))
from pg_catalog.pg_trigger t
join pg_catalog.pg_class ct on ct.oid = t.tgrelid
join pg_catalog.pg_namespace nt on nt.oid = ct.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and (nt.nspname, ct.relname) in (
    ('auth', 'users'),
    ('public', 'chat_members'),
    ('public', 'chat_notification_preferences'),
    ('public', 'chats'),
    ('public', 'messages'),
    ('public', 'notification_preferences'),
    ('public', 'notifications'),
    ('public', 'permissions'),
    ('public', 'profiles'),
    ('public', 'push_subscriptions'),
    ('public', 'role_permissions'),
    ('public', 'topics'),
    ('public', 'user_global_roles'),
    ('storage', 'objects')
  );
SQL

psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -At >"$ROLLOUT_DIR/all-user-function-definitions.txt" <<'SQL'
select format('%I.%I|%s', n.nspname, p.proname, pg_get_functiondef(p.oid))
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname !~ '^pg_toast'
  and p.prokind in ('f', 'p')
  and not exists (
    select 1
    from pg_catalog.pg_depend dep
    where dep.classid = 'pg_catalog.pg_proc'::regclass
      and dep.objid = p.oid
      and dep.deptype = 'e'
  );
SQL

psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -At >"$ROLLOUT_DIR/foreign-server-audit.txt" <<'SQL'
select format('%I|%I', fdw.fdwname, srv.srvname)
from pg_catalog.pg_foreign_server srv
join pg_catalog.pg_foreign_data_wrapper fdw on fdw.oid = srv.srvfdw;
SQL

if grep -Eiq 'http_request|http_(get|post|put|patch|delete)|net[.]http_|http[.]|dblink|postgres_fdw|foreign data wrapper|pg_background|COPY[[:space:]]+PROGRAM|lo_export|aws_lambda|LANGUAGE[[:space:]]+(c|plpython|plperlu|pljava)|[[:space:]]PROGRAM[[:space:]]' \
  "$ROLLOUT_DIR/trigger-side-effect-audit.txt" \
  "$ROLLOUT_DIR/all-user-function-definitions.txt"; then
  exit 72
fi
test ! -s "$ROLLOUT_DIR/foreign-server-audit.txt"

LONG_TX="$(psql -X "service=$PGSERVICE" -Atv ON_ERROR_STOP=1 <<'SQL'
select count(*)
from pg_catalog.pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and xact_start is not null
  and clock_timestamp() - xact_start > interval '30 seconds';
SQL
)"
test "$LONG_TX" = "0"
```

`all-user-function-definitions.txt` намеренно расширяет audit за пределы прямых trigger bodies: wrapper functions также проверяются на `http_request`, `net.http_*`, HTTP extensions, FDW/dblink, background workers и внешние программы. Это консервативный blocker с возможными false positives; разрешать его автоматически запрещено. Не продолжать, пока оркестратор не подтверждает остановку app/worker и production health не показывает новых write requests.

## Рубеж 6: точная сборка combined rehearsal

Правила stripping являются частью review-контракта:

- migration должен содержать **exactly 1 BEGIN and 1 COMMIT**, без внешнего `ROLLBACK`;
- smoke должен содержать **exactly 1 BEGIN and 1 ROLLBACK**, без `COMMIT`;
- из smoke удаляется ровно одна psql meta line `\set ON_ERROR_STOP on`;
- удаляются только полные внешние строки `begin;`, `commit;`, `rollback;`; PL/pgSQL BEGIN без завершающей точки с запятой не изменяются;
- тела объединяются в one outer transaction с bounded timeout gates.

```bash
set -euo pipefail

full_line_count() {
  file="$1"
  wanted="$2"
  awk -v wanted="$wanted" '
    {
      line=tolower($0)
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if (line == wanted) count++
    }
    END { print count + 0 }
  ' "$file"
}

test "$(full_line_count "$MIGRATION_PATH" 'begin;')" -eq 1
test "$(full_line_count "$MIGRATION_PATH" 'commit;')" -eq 1
test "$(full_line_count "$MIGRATION_PATH" 'rollback;')" -eq 0
test "$(full_line_count "$SMOKE_PATH" 'begin;')" -eq 1
test "$(full_line_count "$SMOKE_PATH" 'commit;')" -eq 0
test "$(full_line_count "$SMOKE_PATH" 'rollback;')" -eq 1
test "$(full_line_count "$SMOKE_PATH" '\set on_error_stop on')" -eq 1

awk '
  {
    line=tolower($0)
    sub(/^[[:space:]]+/, "", line)
    sub(/[[:space:]]+$/, "", line)
    if (line == "begin;" || line == "commit;") next
    print
  }
' "$MIGRATION_PATH" >"$ROLLOUT_DIR/migration.body.sql"

awk '
  {
    line=tolower($0)
    sub(/^[[:space:]]+/, "", line)
    sub(/[[:space:]]+$/, "", line)
    if (line == "begin;" || line == "rollback;" || line == "\\set on_error_stop on") next
    print
  }
' "$SMOKE_PATH" >"$ROLLOUT_DIR/smoke.body.sql"

{
  printf '\\set ON_ERROR_STOP on\n'
  printf 'BEGIN;\n'
  printf "SET LOCAL lock_timeout = '5s';\n"
  printf "SET LOCAL statement_timeout = '15min';\n"
  printf "SET LOCAL idle_in_transaction_session_timeout = '60s';\n"
  cat "$ROLLOUT_DIR/migration.body.sql"
  cat "$ROLLOUT_DIR/smoke.body.sql"
  printf 'ROLLBACK;\n'
} >"$ROLLOUT_DIR/combined-rehearsal.sql"

sha256sum "$ROLLOUT_DIR/migration.body.sql" \
  "$ROLLOUT_DIR/smoke.body.sql" \
  "$ROLLOUT_DIR/combined-rehearsal.sql" >"$ROLLOUT_DIR/rehearsal-files.sha256"
```

Сначала запустить combined rehearsal на полностью восстановленной isolated PG17 DB:

```bash
psql -X "service=$REHEARSAL_PGSERVICE" -v ON_ERROR_STOP=1 -f "$ROLLOUT_DIR/combined-rehearsal.sql"
```

Только после isolated success, maintenance/write-stop и baseline выполнить production rehearsal:

```bash
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -f "$ROLLOUT_DIR/combined-rehearsal.sql"
```

Ожидается `bot_platform_db_smoke_ok`, после чего выполняется общий `ROLLBACK`. Timeout, disconnect или отсутствие маркера означает fail-stop; apply запрещён.

## Рубеж 7: post-rollback parity

В новой PostgreSQL-сессии повторить partial-schema gate и sender aggregate query. Затем снять канонический schema snapshot и потребовать побайтовое совпадение с production baseline.

```bash
set -euo pipefail
: "${PGSERVICE:?Set the production libpq service name}"

capture_schema post-rollback
cmp --silent "$ROLLOUT_DIR/baseline.schema.sql" "$ROLLOUT_DIR/post-rollback.schema.sql"
sha256sum "$ROLLOUT_DIR/baseline.schema.sql" "$ROLLOUT_DIR/post-rollback.schema.sql" \
  >"$ROLLOUT_DIR/post-rollback-parity.sha256"
```

Post-rollback parity включает schema/functions/grants/policies/triggers/constraints/indexes, отсутствие partial bot schema и те же aggregate counts. Любой drift блокирует exact apply.

## Рубеж 8: exact apply only after rehearsal

Apply разрешён только для исходного migration-файла, чей SHA-256 совпал на всех рубежах. Не использовать объединённый smoke-файл для apply. Не повторять apply при ошибке без нового incident review и доказанного отсутствия partial schema.

```bash
set -euo pipefail
: "${PGSERVICE:?Set the production libpq service name}"
: "${RUN_ID:?Keep the current rollout RUN_ID}"
: "${BACKUP_DIR:?Keep the exact current-run BACKUP_DIR}"
: "${BACKUP_SHA256SUMS_SHA256:?Keep the exact SHA256SUMS digest}"
: "${BACKUP_DB_DUMP:?Set the exact current backup custom dump}"

RESTORE_GATE="$ROLLOUT_DIR/restore-gate.env"
RESTORE_GATE_CHECKSUM="$ROLLOUT_DIR/restore-gate.env.sha256"
test -f "$RESTORE_GATE"
test -f "$RESTORE_GATE_CHECKSUM"
test "$(stat -c '%a' "$RESTORE_GATE")" = "600"
test "$(stat -c '%a' "$RESTORE_GATE_CHECKSUM")" = "600"
(
  cd "$ROLLOUT_DIR"
  sha256sum -c restore-gate.env.sha256
)

gate_value() {
  local key="$1"
  local values
  mapfile -t values < <(sed -n "s/^${key}=//p" "$RESTORE_GATE")
  test "${#values[@]}" -eq 1
  printf '%s\n' "${values[0]}"
}

test "$(gate_value version)" = "2"
test "$(gate_value run_id)" = "$RUN_ID"
test "$(gate_value backup_dir)" = "$BACKUP_DIR"
test "$(gate_value backup_sha256sums_sha256)" = "$BACKUP_SHA256SUMS_SHA256"

GATE_BACKUP_DB_DUMP_SHA256="$(gate_value backup_db_dump_sha256)"
GATE_BACKUP_STORAGE_ARCHIVE_SHA256="$(gate_value backup_storage_archive_sha256)"
GATE_REHEARSAL_COMPOSE_PROJECT="$(gate_value rehearsal_compose_project)"
GATE_REHEARSAL_NETWORK_NAME="$(gate_value rehearsal_network_name)"
GATE_REHEARSAL_NETWORK_ID="$(gate_value rehearsal_network_id)"
GATE_REHEARSAL_DB_CONTAINER_ID="$(gate_value rehearsal_db_container_id)"
GATE_REHEARSAL_DB_SYSTEM_IDENTIFIER="$(gate_value rehearsal_db_system_identifier)"
GATE_TARGET_IDENTITY_SHA256="$(gate_value target_identity_sha256)"
GATE_RESTORE_LOG_SHA256="$(gate_value restore_log_sha256)"
GATE_DATABASE_EVIDENCE_SHA256="$(gate_value database_evidence_sha256)"
GATE_AUTH_EVIDENCE_SHA256="$(gate_value auth_evidence_sha256)"
GATE_STORAGE_EVIDENCE_SHA256="$(gate_value storage_evidence_sha256)"
GATE_STORAGE_HEALTH_EVIDENCE_SHA256="$(gate_value storage_health_evidence_sha256)"
GATE_POSTGREST_EVIDENCE_SHA256="$(gate_value postgrest_evidence_sha256)"
GATE_RESTORE_EVIDENCE_SHA256="$(gate_value restore_evidence_sha256)"
[[ "$GATE_REHEARSAL_COMPOSE_PROJECT" =~ ^letscube-bot-rehearsal-[a-z0-9][a-z0-9_-]{0,40}$ ]]
[[ "$GATE_REHEARSAL_NETWORK_NAME" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]
[[ "$GATE_REHEARSAL_NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]
[[ "$GATE_REHEARSAL_DB_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]
[[ "$GATE_REHEARSAL_DB_SYSTEM_IDENTIFIER" =~ ^[0-9]+$ ]]

BACKUP_DIR="$(realpath -e "$BACKUP_DIR")"
BACKUP_DB_DUMP="$(realpath -e "$BACKUP_DB_DUMP")"
BACKUP_STORAGE_ARCHIVE="$(realpath -e "$BACKUP_DIR/storage/supabase-storage.tgz")"
case "$BACKUP_DB_DUMP" in
  "$BACKUP_DIR"/*) ;;
  *) exit 92 ;;
esac
test "$BACKUP_DB_DUMP" = "$BACKUP_DIR/db/supabase-postgres.custom"
BACKUP_DB_RELATIVE="$(realpath --relative-to="$BACKUP_DIR" "$BACKUP_DB_DUMP")"

manifest_sha_for() {
  local relative_path="$1"
  awk -v wanted="$relative_path" '
    {
      digest = $1
      name = $0
      sub(/^[^[:space:]]+[[:space:]]+[* ]?/, "", name)
      if (name == wanted || name == "./" wanted) {
        matches++
        value = digest
      }
    }
    END {
      if (matches != 1 || value !~ /^[0-9a-f]{64}$/) exit 93
      print value
    }
  ' "$BACKUP_DIR/SHA256SUMS"
}

test "$(manifest_sha_for "$BACKUP_DB_RELATIVE")" = "$GATE_BACKUP_DB_DUMP_SHA256"
test "$(manifest_sha_for storage/supabase-storage.tgz)" = "$GATE_BACKUP_STORAGE_ARCHIVE_SHA256"
test "$(sha256sum "$BACKUP_DB_DUMP" | awk '{print $1}')" = "$GATE_BACKUP_DB_DUMP_SHA256"
test "$(sha256sum "$BACKUP_STORAGE_ARCHIVE" | awk '{print $1}')" = "$GATE_BACKUP_STORAGE_ARCHIVE_SHA256"

CURRENT_RESTORE_EVIDENCE_SHA256="$(sha256sum "$ROLLOUT_DIR/restore-evidence.sha256" | awk '{print $1}')"
test "$CURRENT_RESTORE_EVIDENCE_SHA256" = "$GATE_RESTORE_EVIDENCE_SHA256"
(
  cd "$ROLLOUT_DIR"
  sha256sum -c restore-evidence.sha256
)
test "$(sha256sum "$ROLLOUT_DIR/restore-evidence/restore.log" | awk '{print $1}')" = "$GATE_RESTORE_LOG_SHA256"
test "$(sha256sum "$ROLLOUT_DIR/restore-evidence/database-evidence.txt" | awk '{print $1}')" = "$GATE_DATABASE_EVIDENCE_SHA256"
test "$(sha256sum "$ROLLOUT_DIR/restore-evidence/auth-evidence.txt" | awk '{print $1}')" = "$GATE_AUTH_EVIDENCE_SHA256"
test "$(sha256sum "$ROLLOUT_DIR/restore-evidence/storage-evidence.txt" | awk '{print $1}')" = "$GATE_STORAGE_EVIDENCE_SHA256"
test "$(sha256sum "$ROLLOUT_DIR/restore-evidence/storage-health-evidence.txt" | awk '{print $1}')" = "$GATE_STORAGE_HEALTH_EVIDENCE_SHA256"
test "$(sha256sum "$ROLLOUT_DIR/restore-evidence/postgrest-evidence.txt" | awk '{print $1}')" = "$GATE_POSTGREST_EVIDENCE_SHA256"
TARGET_IDENTITY_EVIDENCE="$ROLLOUT_DIR/restore-evidence/target-identity.txt"
test "$(sha256sum "$TARGET_IDENTITY_EVIDENCE" | awk '{print $1}')" = "$GATE_TARGET_IDENTITY_SHA256"
grep -Fxq "compose_project=$GATE_REHEARSAL_COMPOSE_PROJECT" "$TARGET_IDENTITY_EVIDENCE"
grep -Fxq "network_name=$GATE_REHEARSAL_NETWORK_NAME" "$TARGET_IDENTITY_EVIDENCE"
grep -Fxq "network_id=$GATE_REHEARSAL_NETWORK_ID" "$TARGET_IDENTITY_EVIDENCE"
grep -Fxq "database_container_id=$GATE_REHEARSAL_DB_CONTAINER_ID" "$TARGET_IDENTITY_EVIDENCE"
grep -Fxq "database_system_identifier=$GATE_REHEARSAL_DB_SYSTEM_IDENTIFIER" "$TARGET_IDENTITY_EVIDENCE"

GATE_SOURCE_AUTH_USERS_COUNT="$(gate_value source_auth_users_count)"
GATE_TARGET_AUTH_USERS_COUNT="$(gate_value target_auth_users_count)"
GATE_SOURCE_STORAGE_OBJECTS_COUNT="$(gate_value source_storage_objects_count)"
GATE_TARGET_STORAGE_OBJECTS_COUNT="$(gate_value target_storage_objects_count)"
GATE_SOURCE_MESSAGES_COUNT="$(gate_value source_messages_count)"
GATE_TARGET_MESSAGES_COUNT="$(gate_value target_messages_count)"
GATE_SOURCE_PROFILES_COUNT="$(gate_value source_profiles_count)"
GATE_TARGET_PROFILES_COUNT="$(gate_value target_profiles_count)"
GATE_SOURCE_STORAGE_FILE_COUNT="$(gate_value source_storage_file_count)"
GATE_TARGET_STORAGE_FILE_COUNT="$(gate_value target_storage_file_count)"
GATE_SOURCE_STORAGE_TOTAL_BYTES="$(gate_value source_storage_total_bytes)"
GATE_TARGET_STORAGE_TOTAL_BYTES="$(gate_value target_storage_total_bytes)"
for count in \
  "$GATE_SOURCE_AUTH_USERS_COUNT" \
  "$GATE_TARGET_AUTH_USERS_COUNT" \
  "$GATE_SOURCE_STORAGE_OBJECTS_COUNT" \
  "$GATE_TARGET_STORAGE_OBJECTS_COUNT" \
  "$GATE_SOURCE_MESSAGES_COUNT" \
  "$GATE_TARGET_MESSAGES_COUNT" \
  "$GATE_SOURCE_PROFILES_COUNT" \
  "$GATE_TARGET_PROFILES_COUNT" \
  "$GATE_SOURCE_STORAGE_FILE_COUNT" \
  "$GATE_TARGET_STORAGE_FILE_COUNT" \
  "$GATE_SOURCE_STORAGE_TOTAL_BYTES" \
  "$GATE_TARGET_STORAGE_TOTAL_BYTES"; do
  [[ "$count" =~ ^[0-9]+$ ]]
done
test "$GATE_SOURCE_AUTH_USERS_COUNT" -gt 0
test "$GATE_SOURCE_STORAGE_OBJECTS_COUNT" -gt 0
test "$GATE_SOURCE_PROFILES_COUNT" -gt 0
test "$GATE_SOURCE_STORAGE_FILE_COUNT" -gt 0
test "$GATE_SOURCE_STORAGE_TOTAL_BYTES" -gt 0
test "$GATE_SOURCE_AUTH_USERS_COUNT" = "$GATE_TARGET_AUTH_USERS_COUNT"
test "$GATE_SOURCE_STORAGE_OBJECTS_COUNT" = "$GATE_TARGET_STORAGE_OBJECTS_COUNT"
test "$GATE_SOURCE_MESSAGES_COUNT" = "$GATE_TARGET_MESSAGES_COUNT"
test "$GATE_SOURCE_PROFILES_COUNT" = "$GATE_TARGET_PROFILES_COUNT"
test "$GATE_SOURCE_STORAGE_FILE_COUNT" = "$GATE_TARGET_STORAGE_FILE_COUNT"
test "$GATE_SOURCE_STORAGE_TOTAL_BYTES" = "$GATE_TARGET_STORAGE_TOTAL_BYTES"

CURRENT_BACKUP_SHA256SUMS_SHA256="$(sha256sum "$BACKUP_DIR/SHA256SUMS" | awk '{print $1}')"
test "$CURRENT_BACKUP_SHA256SUMS_SHA256" = "$BACKUP_SHA256SUMS_SHA256"

sha256sum -c "$ROLLOUT_DIR/reviewed-inputs.sha256"
PGOPTIONS="-c lock_timeout=5s -c statement_timeout=15min -c idle_in_transaction_session_timeout=60s" \
  psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -f "$MIGRATION_PATH"
```

После успешного commit обновить PostgREST schema cache:

```bash
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"
```

## Рубеж 9: post-apply проверки

Сначала проверить constraints, grants, index readiness и отсутствие invalid index. Приватные bot tables не должны читаться `anon`, `authenticated` или напрямую `service_role`; internal RPC не должны быть доступны клиентским ролям.

```bash
set -euo pipefail
: "${PGSERVICE:?Set the production libpq service name}"

psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 <<'SQL'
do $check$
declare
  invalid_count integer;
  unvalidated_count integer;
  table_row record;
  routine_row record;
  privilege_name text;
  expected_service_role_execute boolean;
begin
  select count(*) into invalid_count
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and (c.relname like 'bot\_%' escape '\' or c.relname = 'messages_bot_created_idx')
    and (not i.indisvalid or not i.indisready);

  select count(*) into unvalidated_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname in ('public', 'private')
    and (c.conname like 'bot\_%' escape '\' or c.conname like 'messages\_%bot%' escape '\')
    and not c.convalidated;

  if invalid_count <> 0 then
    raise exception 'invalid index count: %', invalid_count;
  end if;
  if unvalidated_count <> 0 then
    raise exception 'unvalidated constraint count: %', unvalidated_count;
  end if;

  for table_row in
    select c.oid as object_oid, format('%I.%I', n.nspname, c.relname) as object_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relkind in ('r', 'p')
      and c.relname like 'bot\_%' escape '\'
  loop
    foreach privilege_name in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if has_table_privilege('anon', table_row.object_oid, privilege_name)
         or has_table_privilege('authenticated', table_row.object_oid, privilege_name)
         or has_table_privilege('service_role', table_row.object_oid, privilege_name) then
        raise exception 'unexpected table grant: % %', table_row.object_name, privilege_name;
      end if;
    end loop;

    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    loop
      if has_any_column_privilege('anon', table_row.object_oid, privilege_name)
         or has_any_column_privilege('authenticated', table_row.object_oid, privilege_name)
         or has_any_column_privilege('service_role', table_row.object_oid, privilege_name) then
        raise exception 'unexpected column grant: % %', table_row.object_name, privilege_name;
      end if;
    end loop;
  end loop;

  for routine_row in
    select
      p.oid as object_oid,
      n.nspname as schema_name,
      p.proname,
      p.oid::regprocedure::text as object_name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname like 'bot\_%' escape '\'
  loop
    if has_function_privilege('anon', routine_row.object_oid, 'EXECUTE')
       or has_function_privilege('authenticated', routine_row.object_oid, 'EXECUTE') then
      raise exception 'client role can execute bot routine: %', routine_row.object_name;
    end if;

    expected_service_role_execute :=
      routine_row.schema_name = 'public'
      and routine_row.proname like 'bot\_%\_internal' escape '\';
    if has_function_privilege('service_role', routine_row.object_oid, 'EXECUTE')
       is distinct from expected_service_role_execute then
      raise exception 'unexpected service_role EXECUTE: % expected=%',
        routine_row.object_name,
        expected_service_role_execute;
    end if;
  end loop;
end
$check$;
SQL
```

Этот DO-block динамически перечисляет каждую `private.bot_*` table и каждую
`public`/`private` routine `bot_*`. Для private tables запрещены table-level и
column-level grants ролям `anon`, `authenticated` и `service_role`. Для routines
клиентские роли всегда запрещены; `service_role` должен иметь `EXECUTE` ровно
на public `bot_*_internal`, а private helper routines должны оставаться без
такого grant. Новая bot table или routine автоматически попадает в audit.

Проверить наличие и definitions ключевых indexes: active token prefix, due updates, due delivery attempts, active membership и `messages_bot_created_idx`. Сохранить catalog-only EXPLAIN/plans для token-prefix, delivery-due и update-due запросов; не включать реальные токены или пользовательские значения.

Затем выполнить **standalone smoke** с его собственным `BEGIN`/`ROLLBACK`:

```bash
psql -X "service=$PGSERVICE" -v ON_ERROR_STOP=1 -f "$SMOKE_PATH"
```

После standalone smoke повторить aggregate counts, invalid-index check, chat list/search, Realtime, notification grouping/read-sync и push-outbox regression checks. PostgREST/Kong должны видеть только public RPC; schema `private` не добавляется в exposed schemas.

## Рубеж 10: gateway и возврат трафика

Gateway deploy разрешён **only after DB** apply и всех post-apply проверок. Сначала один internal canary bot при отключённом публичном создании. Traefik routes `/bot/v1` и `/bot/manage/v1` не должны перехватывать `/releases`, `/assets` или `/healthz`.

Трафик app/worker возвращается только после canary, chat/search/notification regression QA и подтверждения отсутствия новых DB errors. Фактическое время возобновления, health results и commit/SHA заносятся в ops-report.

## Rollback после commit

После успешного apply ad-hoc down SQL запрещён: он не гарантирует восстановление заменённых RPC, policies, triggers и message constraints. Rollback выполняется через verified backup по `docs/infra/BACKUP_RESTORE_RUNBOOK.md` в отдельном maintenance window. До восстановления gateway и app/worker остаются остановленными. Автоматическое удаление bot objects или каскадное удаление схем не используется.

Если verified backup недоступен или full restore rehearsal не имеет evidence, rollout не начинается.
