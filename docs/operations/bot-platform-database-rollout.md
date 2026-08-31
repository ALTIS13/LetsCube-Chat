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

1. Развернуть отдельный PG17/self-hosted Supabase без production routing, production workers и внешней доставки.
2. Восстановить **этот** `BACKUP_DIR` полностью по `docs/infra/BACKUP_RESTORE_RUNBOOK.md`: database, Auth/Storage metadata, storage objects и необходимые конфигурационные архивы.
3. Не использовать `--clean`, автоматическое удаление схем или destructive auto-cleanup. Rehearsal target должен быть новым и пустым.
4. Подтвердить доступность Auth, Storage и PostgREST внутри isolated network; не направлять на него production DNS.
5. Сохранить логи restore, health checks, source backup path и его SHA256SUMS в evidence текущего `RUN_ID`.

```bash
set -euo pipefail
: "${REHEARSAL_PGSERVICE:?Set an isolated PG17 libpq service name}"
: "${REHEARSAL_AUTH_HEALTH_URL:?Set the isolated Auth health URL}"
: "${REHEARSAL_STORAGE_HEALTH_URL:?Set the isolated Storage health URL}"
: "${REHEARSAL_POSTGREST_HEALTH_URL:?Set the isolated PostgREST health URL}"
: "${RUN_ID:?Keep the current rollout RUN_ID}"
: "${BACKUP_DIR:?Keep the exact current-run BACKUP_DIR}"
: "${BACKUP_SHA256SUMS_SHA256:?Keep the exact SHA256SUMS digest}"

PG_VERSION_NUM="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 -c 'show server_version_num')"
test "$PG_VERSION_NUM" -ge 170000
psql -X "service=$REHEARSAL_PGSERVICE" -v ON_ERROR_STOP=1 -c 'select 1' >/dev/null

RESTORE_EVIDENCE_DIR="$ROLLOUT_DIR/restore-evidence"
install -d -m 700 "$RESTORE_EVIDENCE_DIR"
printf 'database_restore=ok\nserver_version_num=%s\n' "$PG_VERSION_NUM" \
  >"$RESTORE_EVIDENCE_DIR/database-evidence.txt"

AUTH_ROW_COUNT="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 -c 'select count(*) from auth.users')"
curl -fsS -o /dev/null "$REHEARSAL_AUTH_HEALTH_URL"
printf 'auth_restore=ok\nauth_row_count=%s\n' "$AUTH_ROW_COUNT" \
  >"$RESTORE_EVIDENCE_DIR/auth-evidence.txt"

STORAGE_ROW_COUNT="$(psql -X "service=$REHEARSAL_PGSERVICE" -Atv ON_ERROR_STOP=1 -c 'select count(*) from storage.objects')"
curl -fsS -o /dev/null "$REHEARSAL_STORAGE_HEALTH_URL"
printf 'storage_restore=ok\nstorage_metadata_row_count=%s\n' "$STORAGE_ROW_COUNT" \
  >"$RESTORE_EVIDENCE_DIR/storage-evidence.txt"

curl -fsS -o /dev/null "$REHEARSAL_POSTGREST_HEALTH_URL"
printf 'postgrest_restore=ok\n' \
  >"$RESTORE_EVIDENCE_DIR/postgrest-evidence.txt"

chmod 600 "$RESTORE_EVIDENCE_DIR"/*.txt
(
  cd "$ROLLOUT_DIR"
  sha256sum \
    restore-evidence/database-evidence.txt \
    restore-evidence/auth-evidence.txt \
    restore-evidence/storage-evidence.txt \
    restore-evidence/postgrest-evidence.txt \
    >restore-evidence.sha256
  sha256sum -c restore-evidence.sha256
)

RESTORE_EVIDENCE_SHA256="$(sha256sum "$ROLLOUT_DIR/restore-evidence.sha256" | awk '{print $1}')"
RESTORE_GATE="$ROLLOUT_DIR/restore-gate.env"
{
  printf 'version=1\n'
  printf 'run_id=%s\n' "$RUN_ID"
  printf 'backup_dir=%s\n' "$BACKUP_DIR"
  printf 'backup_sha256sums_sha256=%s\n' "$BACKUP_SHA256SUMS_SHA256"
  printf 'restore_evidence_sha256=%s\n' "$RESTORE_EVIDENCE_SHA256"
  printf 'database=ok\n'
  printf 'auth=ok\n'
  printf 'storage=ok\n'
  printf 'postgrest=ok\n'
} >"$RESTORE_GATE.tmp"
chmod 600 "$RESTORE_GATE.tmp"
mv "$RESTORE_GATE.tmp" "$RESTORE_GATE"
```

Health URL должны принадлежать только isolated network; production URL запрещены. Aggregate counts не содержат сырых строк. `storage-evidence.txt` создаётся только после восстановления Storage metadata и object archive по основному restore runbook. Этот полный restore rehearsal является hard gate. Без связанного с текущими `RUN_ID`, `BACKUP_DIR`, SHA manifest и четырьмя evidence-файлами `restore-gate.env` дальнейшие команды не выполняются.

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

RESTORE_GATE="$ROLLOUT_DIR/restore-gate.env"
test -f "$RESTORE_GATE"
test "$(stat -c '%a' "$RESTORE_GATE")" = "600"
grep -Fxq "run_id=$RUN_ID" "$RESTORE_GATE"
grep -Fxq "backup_dir=$BACKUP_DIR" "$RESTORE_GATE"
grep -Fxq "backup_sha256sums_sha256=$BACKUP_SHA256SUMS_SHA256" "$RESTORE_GATE"
grep -Fxq 'database=ok' "$RESTORE_GATE"
grep -Fxq 'auth=ok' "$RESTORE_GATE"
grep -Fxq 'storage=ok' "$RESTORE_GATE"
grep -Fxq 'postgrest=ok' "$RESTORE_GATE"

CURRENT_RESTORE_EVIDENCE_SHA256="$(sha256sum "$ROLLOUT_DIR/restore-evidence.sha256" | awk '{print $1}')"
grep -Fxq "restore_evidence_sha256=$CURRENT_RESTORE_EVIDENCE_SHA256" "$RESTORE_GATE"
(
  cd "$ROLLOUT_DIR"
  sha256sum -c restore-evidence.sha256
)
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
