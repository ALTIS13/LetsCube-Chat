import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const runbookPath = "docs/operations/bot-platform-database-rollout.md";
const migrationPath =
  ".migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql";
const smokePath = "tests/server/bot-platform-db-smoke.sql";
const planPath = "docs/superpowers/plans/2026-08-30-bot-platform.md";
const restoreSafetyPath = "scripts/ops/supabase-restore-safety.py";

function runbook() {
  assert.equal(existsSync(runbookPath), true, `missing ${runbookPath}`);
  return readFileSync(runbookPath, "utf8");
}

function plan() {
  assert.equal(existsSync(planPath), true, `missing ${planPath}`);
  return readFileSync(planPath, "utf8");
}

function isIgnored(path) {
  const result = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--quiet", "--", path],
    { encoding: "utf8" },
  );
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore failed for ${path}: ${result.stderr}`,
  );
  return result.status === 0;
}

test("root rollout evidence is ignored without hiding nested product paths", () => {
  const gitignore = readFileSync(".gitignore", "utf8");
  const source = runbook();

  assert.ok(
    gitignore.split(/\r?\n/).includes("/.ops-local/"),
    "missing root-anchored /.ops-local/ ignore",
  );
  assert.equal(isIgnored(".ops-local/contract-probe.txt"), true);
  assert.equal(isIgnored("artifacts/kub/.ops-local/product-state.txt"), false);
  assert.match(
    source,
    /ROLLOUT_DIR="\$REPO_ROOT\/\.ops-local\/bot-platform-rollout\/\$RUN_ID"/,
  );
});

test("runbook pins reviewed inputs and treats the migration as a one-shot artifact", () => {
  const source = runbook();

  assert.match(source, new RegExp(migrationPath.replaceAll(".", "\\.")));
  assert.match(source, new RegExp(smokePath.replaceAll(".", "\\.")));
  assert.match(source, /git commit/i);
  assert.match(source, /SHA-256/i);
  assert.match(source, /timestamp/i);
  assert.match(source, /parity/i);
  assert.match(source, /one[- ]shot|одноразов/i);
  assert.match(source, /migration ledger/i);
  assert.match(source, /rerun[^\n]*(forbidden|запрещ)/i);
  assert.match(source, /partial bot schema|частичн[^\n]*bot schema/i);
  assert.match(
    source,
    /git diff HEAD --exit-code -- "\$MIGRATION_PATH" "\$SMOKE_PATH"/,
  );
  assert.match(source, /git show "\$HEAD_COMMIT:\$MIGRATION_PATH"/);
  assert.match(source, /git show "\$HEAD_COMMIT:\$SMOKE_PATH"/);
  assert.match(source, /cmp --silent "\$MIGRATION_PATH"/);
  assert.match(source, /cmp --silent "\$SMOKE_PATH"/);
});

test("fresh backup and an isolated PG17 restore rehearsal are hard fail-stop gates", () => {
  const source = runbook();

  assert.match(source, /fresh backup[^\n]*current run|свеж[^\n]*backup[^\n]*текущ/i);
  assert.match(source, /BEFORE_BACKUPS/);
  assert.match(source, /AFTER_BACKUPS/);
  assert.match(source, /comm\s+-13/i);
  assert.match(source, /wc\s+-l/i);
  assert.match(source, /\/run\/letscube-backup\.lock/);
  assert.match(source, /flock -n 9/);
  assert.match(source, /backup-command\.out/);
  assert.match(
    source,
    /\\\[\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T[\s\S]{0,160}backup completed: \(\/srv\/letscube\/backups\/automated\/\[0-9\]\{8\}-\[0-9\]\{6\}\)\$/,
  );
  assert.match(source, /sed -nE "s#\$BACKUP_COMPLETED_RE#\\2#p"/);
  assert.match(source, /MANIFEST\.txt/);
  assert.match(source, /created_at=/);
  assert.match(source, /basename "\$BACKUP_DIR"/);
  assert.match(source, /sha256sum\s+-c/i);
  assert.match(source, /pg_restore\s+(?:--list|-l)/i);
  assert.match(source, /-name '\*\.custom'/i);
  assert.match(source, /tar\s+(?:-t|-tf|--list)/i);
  assert.match(source, /isolated[^\n]*PG17|изолирован[^\n]*PG17/i);
  assert.match(source, /hard gate|ж[её]стк[^\n]*рубеж/i);
  assert.match(source, /fail[- ]stop/i);
});

test("production rehearsal is bounded, blocks writes, and audits trigger side effects", () => {
  const source = runbook();

  assert.match(source, /AccessExclusive/i);
  assert.match(source, /maintenance window/i);
  assert.match(source, /app[^\n]*worker[^\n]*(write|запис)[^\n]*(stop|останов)/i);
  assert.match(source, /SET LOCAL lock_timeout/i);
  assert.match(source, /SET LOCAL statement_timeout/i);
  assert.match(source, /SET LOCAL idle_in_transaction_session_timeout/i);
  assert.match(source, /trigger[^\n]*external[^\n]*nontransactional/i);
  assert.match(source, /smoke[^\n]*(existing rows|существующ)/i);
  for (const touchedRelation of [
    "('auth', 'users')",
    "('public', 'chat_members')",
    "('public', 'chat_notification_preferences')",
    "('public', 'messages')",
    "('public', 'notification_preferences')",
    "('public', 'profiles')",
    "('public', 'permissions')",
    "('public', 'push_subscriptions')",
    "('public', 'role_permissions')",
    "('public', 'topics')",
    "('public', 'user_global_roles')",
    "('storage', 'objects')",
  ]) {
    assert.ok(source.includes(touchedRelation), `missing trigger audit scope: ${touchedRelation}`);
  }
  assert.match(source, /all-user-function-definitions\.txt/);
  assert.match(source, /pg_catalog\.pg_depend/);
  assert.match(source, /dep\.deptype = 'e'/);
  assert.match(source, /p\.prokind in \('f', 'p'\)/);
  assert.match(source, /http_request/i);
  assert.match(source, /wrapper/i);
  assert.match(source, /foreign server|foreign data wrapper/i);
});

test("restore gate binds the current run and exact backup to database and service evidence", () => {
  const source = runbook();

  for (const binding of [
    "RUN_ID",
    "BACKUP_DIR",
    "BACKUP_SHA256SUMS_SHA256",
    "database-evidence.txt",
    "auth-evidence.txt",
    "storage-evidence.txt",
    "postgrest-evidence.txt",
    "restore-evidence.sha256",
    "restore-gate.env",
  ]) {
    assert.match(source, new RegExp(binding.replaceAll(".", "\\.")));
  }
  assert.match(
    source,
    /cd "\$ROLLOUT_DIR"[\s\S]{0,500}sha256sum[\s\S]{0,500}>restore-evidence\.sha256/,
  );
  assert.match(
    source,
    /cd "\$ROLLOUT_DIR"[\s\S]{0,200}sha256sum -c restore-evidence\.sha256/,
  );

  const apply = source.slice(source.indexOf("## Рубеж 8:"));
  assert.match(apply, /test -f "\$RESTORE_GATE"/);
  assert.match(apply, /test "\$\(gate_value run_id\)" = "\$RUN_ID"/);
  assert.match(apply, /test "\$\(gate_value backup_dir\)" = "\$BACKUP_DIR"/);
  assert.match(
    apply,
    /test "\$\(gate_value backup_sha256sums_sha256\)" = "\$BACKUP_SHA256SUMS_SHA256"/,
  );
  assert.match(
    apply,
    /cd "\$ROLLOUT_DIR"[\s\S]{0,200}sha256sum -c restore-evidence\.sha256/,
  );
});

test("restore flow executes the manifest-bound dump and rejects an empty or mismatched target", () => {
  const source = runbook();
  const restore = source.slice(
    source.indexOf("## Рубеж 2:"),
    source.indexOf("## Рубеж 3:"),
  );
  const apply = source.slice(source.indexOf("## Рубеж 8:"));

  assert.match(restore, /BACKUP_DB_DUMP/);
  assert.match(
    restore,
    /test "\$BACKUP_DB_DUMP" = "\$BACKUP_DIR\/db\/supabase-postgres\.custom"/,
  );
  assert.match(restore, /BACKUP_DB_DUMP_SHA256/);
  assert.match(
    restore,
    /test "\$BACKUP_DB_ROLES" = "\$BACKUP_DIR\/db\/supabase-roles\.sql"/,
  );
  assert.match(restore, /BACKUP_DB_ROLES_SHA256/);
  assert.match(restore, /PASSWORD\|SCRAM-SHA\|md5/);
  assert.match(restore, /CREATE ROLE supabase_realtime_admin/);
  assert.match(restore, /ALTER ROLE supabase_realtime_admin WITH NOSUPERUSER NOINHERIT/);
  assert.match(restore, /SHA256SUMS/);
  assert.match(restore, /manifest_sha_for/);
  assert.match(restore, /pg_restore[\s\S]{0,300}--exit-on-error/);
  assert.match(restore, /--dbname="service=\$REHEARSAL_PGSERVICE"/);
  assert.match(restore, /"\$BACKUP_DB_DUMP"[\s\S]{0,100}>"\$RESTORE_LOG" 2>&1/);
  assert.match(restore, /chmod 600 "\$RESTORE_LOG"/);
  assert.match(
    restore,
    /pg_restore[\s\S]{0,240}--data-only[\s\S]{0,120}--schema="\$schema"[\s\S]{0,120}--table="\$table"/,
  );
  assert.match(restore, /relation="\$schema\.\$table"/);
  assert.match(restore, /count_dump_copy_rows auth users/);
  assert.match(restore, /host\(inet_server_addr\(\)\)/);
  assert.match(restore, /RESTORE_ROLE=.*select current_user/);
  assert.match(restore, /test "\$RESTORE_ROLE" = "supabase_admin"/);
  assert.match(restore, /current_setting\('cron\.database_name', true\)/);
  assert.match(restore, /test "\$CRON_DATABASE_NAME" = "\$REHEARSAL_DB_NAME"/);
  assert.match(restore, /supabase_realtime_admin/);
  assert.match(restore, /pg_has_role\('postgres', 'supabase_realtime_admin', 'MEMBER'\)/);
  assert.match(restore, new RegExp(restoreSafetyPath.replaceAll(".", "\\.")));
  assert.match(restore, /filter-roles/);
  assert.match(restore, /FILTERED_DB_ROLES/);
  assert.match(
    restore,
    /psql[\s\S]{0,300}--file="\$FILTERED_DB_ROLES"/,
  );
  assert.match(restore, /pg_dumpall[\s\S]{0,300}--roles-only[\s\S]{0,300}--no-role-passwords/);
  assert.match(restore, /ROLE_DUMP_PARITY/);
  assert.match(restore, /test "\$ROLE_DUMP_PARITY" = "ok"/);
  assert.ok(
    restore.indexOf('--file="$FILTERED_DB_ROLES"') <
      restore.indexOf("PGOPTIONS='-c statement_timeout=0' pg_restore"),
    "global roles must be restored before the database archive",
  );
  assert.match(restore, /restore_role=%s/);
  assert.match(apply, /grep -Fxq 'restore_role=supabase_admin' "\$TARGET_IDENTITY_EVIDENCE"/);
  assert.match(restore, /COPY[\s\S]{0,500}rows > 1000000000/);

  for (const count of [
    "SOURCE_AUTH_USERS_COUNT",
    "SOURCE_STORAGE_OBJECTS_COUNT",
    "SOURCE_MESSAGES_COUNT",
    "SOURCE_PROFILES_COUNT",
    "TARGET_AUTH_USERS_COUNT",
    "TARGET_STORAGE_OBJECTS_COUNT",
    "TARGET_MESSAGES_COUNT",
    "TARGET_PROFILES_COUNT",
  ]) {
    assert.match(restore, new RegExp(count));
  }
  assert.match(restore, /test "\$SOURCE_AUTH_USERS_COUNT" -gt 0/);
  assert.match(restore, /test "\$SOURCE_STORAGE_OBJECTS_COUNT" -gt 0/);
  assert.match(restore, /test "\$SOURCE_PROFILES_COUNT" -gt 0/);
  assert.match(restore, /test "\$TARGET_AUTH_USERS_COUNT" = "\$SOURCE_AUTH_USERS_COUNT"/);
  assert.match(
    restore,
    /test "\$TARGET_STORAGE_OBJECTS_COUNT" = "\$SOURCE_STORAGE_OBJECTS_COUNT"/,
  );
  assert.match(restore, /test "\$TARGET_MESSAGES_COUNT" = "\$SOURCE_MESSAGES_COUNT"/);
  assert.match(restore, /test "\$TARGET_PROFILES_COUNT" = "\$SOURCE_PROFILES_COUNT"/);
  assert.match(restore, /FRESH_USER_RELATION_COUNT/);
  assert.match(restore, /test "\$FRESH_USER_RELATION_COUNT" -eq 0/);
  assert.match(restore, /DB_IDENTITY_BEFORE/);
  assert.match(restore, /DB_IDENTITY_AFTER/);
  assert.match(restore, /test "\$DB_IDENTITY_AFTER" = "\$DB_IDENTITY_BEFORE"/);
});

test("rehearsal endpoints are derived from one internal compose network", () => {
  const source = runbook();
  const restore = source.slice(
    source.indexOf("## Рубеж 2:"),
    source.indexOf("## Рубеж 3:"),
  );

  assert.match(restore, /REHEARSAL_COMPOSE_PROJECT/);
  assert.match(restore, /REHEARSAL_NETWORK/);
  assert.match(restore, /com\.docker\.compose\.project/);
  assert.match(restore, /com\.docker\.compose\.service/);
  assert.match(restore, /\.Internal/);
  assert.match(restore, /len \.NetworkSettings\.Networks/);
  assert.match(restore, /DB_CONTAINER_IP/);
  assert.match(restore, /INET_SERVER_ADDR/);
  assert.match(restore, /test "\$INET_SERVER_ADDR" = "\$DB_CONTAINER_IP"/);
  assert.match(restore, /AUTH_HEALTH_URL="http:\/\/\$\{REHEARSAL_AUTH_SERVICE\}:9999\/health"/);
  assert.match(
    restore,
    /STORAGE_HEALTH_URL="http:\/\/\$\{REHEARSAL_STORAGE_SERVICE\}:5000\/status"/,
  );
  assert.match(
    restore,
    /POSTGREST_HEALTH_URL="http:\/\/\$\{REHEARSAL_POSTGREST_SERVICE\}:3000\/"/,
  );
  assert.match(restore, /docker run --rm --network "\$REHEARSAL_NETWORK"/);
  assert.match(restore, /for attempt in \$\(seq 1 30\)/);
  assert.match(restore, /test "\$container_status" != "exited"/);
  assert.match(restore, /sleep 2/);
  assert.match(restore, /test "\$health_ready" = "1"/);
  assert.doesNotMatch(restore, /REHEARSAL_(?:AUTH|STORAGE|POSTGREST)_HEALTH_URL/);
  assert.doesNotMatch(restore, /https?:\/\/(?:api|app)\.letscube\.ru/i);
});

test("published ports reject wildcards and are bound into the restore gate", () => {
  const source = runbook();
  const restore = source.slice(
    source.indexOf("## Рубеж 2:"),
    source.indexOf("## Рубеж 3:"),
  );
  const apply = source.slice(source.indexOf("## Рубеж 8:"));

  assert.match(restore, /\.HostConfig\.PortBindings/);
  assert.match(restore, /\.NetworkSettings\.Ports/);
  assert.match(restore, /cmp --silent "\$host_config_ports" "\$network_settings_ports"/);
  assert.match(
    restore,
    /sed -i '\/\^\[\[:space:\]\]\*\$\/d' "\$host_config_ports" "\$network_settings_ports"/,
  );
  assert.match(restore, /127\.0\.0\.1\|::1\) ;;/);
  assert.match(restore, /""\|0\.0\.0\.0\|::\|\*\) exit [0-9]+ ;;/);
  assert.match(
    restore,
    /require_no_published_ports auth "\$REHEARSAL_AUTH_CONTAINER_ID"/,
  );
  assert.match(
    restore,
    /require_no_published_ports storage "\$REHEARSAL_STORAGE_CONTAINER_ID"/,
  );
  assert.match(
    restore,
    /require_no_published_ports postgrest "\$REHEARSAL_POSTGREST_CONTAINER_ID"/,
  );
  assert.match(restore, /port-bindings-evidence\.txt/);
  assert.match(restore, /hostconfig_networksettings_parity=ok/);
  assert.match(restore, /auth=none/);
  assert.match(restore, /storage=none/);
  assert.match(restore, /postgrest=none/);
  assert.match(restore, /port_binding_policy=internal-health-loopback-db-v1/);
  assert.match(restore, /port_binding_evidence_sha256/);

  assert.match(apply, /GATE_PORT_BINDING_POLICY="\$\(gate_value port_binding_policy\)"/);
  assert.match(
    apply,
    /GATE_PORT_BINDING_EVIDENCE_SHA256="\$\(gate_value port_binding_evidence_sha256\)"/,
  );
  assert.match(
    apply,
    /sha256sum "\$PORT_BINDING_EVIDENCE"[\s\S]{0,150}"\$GATE_PORT_BINDING_EVIDENCE_SHA256"/,
  );
  assert.match(apply, /grep -Fxq 'auth=none' "\$PORT_BINDING_EVIDENCE"/);
  assert.match(apply, /grep -Fxq 'storage=none' "\$PORT_BINDING_EVIDENCE"/);
  assert.match(apply, /grep -Fxq 'postgrest=none' "\$PORT_BINDING_EVIDENCE"/);
  assert.match(apply, /127\.0\.0\.1\|::1\) ;;/);
  assert.match(apply, /""\|0\.0\.0\.0\|::\|\*\) exit [0-9]+ ;;/);
});

test("storage restore and checksummed gate bind archive parity and all evidence", () => {
  const source = runbook();
  const restore = source.slice(
    source.indexOf("## Рубеж 2:"),
    source.indexOf("## Рубеж 3:"),
  );
  const apply = source.slice(source.indexOf("## Рубеж 8:"));

  assert.match(restore, /supabase-storage\.tgz/);
  assert.match(
    restore,
    /BACKUP_STORAGE_ARCHIVE="\$\(realpath -e "\$BACKUP_DIR\/storage\/supabase-storage\.tgz"\)"/,
  );
  assert.match(restore, /BACKUP_STORAGE_ARCHIVE_SHA256/);
  assert.match(restore, /STORAGE_MOUNT_SOURCE/);
  assert.match(restore, /\.Mounts/);
  assert.match(restore, /SOURCE_STORAGE_FILE_COUNT/);
  assert.match(restore, /SOURCE_STORAGE_TOTAL_BYTES/);
  assert.match(restore, /TARGET_STORAGE_FILE_COUNT/);
  assert.match(restore, /TARGET_STORAGE_TOTAL_BYTES/);
  assert.match(restore, /test "\$SOURCE_STORAGE_FILE_COUNT" -gt 0/);
  assert.match(restore, /test "\$SOURCE_STORAGE_TOTAL_BYTES" -gt 0/);
  assert.match(restore, /test "\$TARGET_STORAGE_FILE_COUNT" = "\$SOURCE_STORAGE_FILE_COUNT"/);
  assert.match(restore, /test "\$TARGET_STORAGE_TOTAL_BYTES" = "\$SOURCE_STORAGE_TOTAL_BYTES"/);

  for (const binding of [
    "backup_db_dump_sha256",
    "backup_db_roles_sha256",
    "backup_storage_archive_sha256",
    "rehearsal_compose_project",
    "rehearsal_network_name",
    "rehearsal_network_id",
    "rehearsal_db_container_id",
    "rehearsal_db_system_identifier",
    "target_identity_sha256",
    "restore_log_sha256",
    "database_evidence_sha256",
    "role_restore_evidence_sha256",
    "source_auth_users_count",
    "target_auth_users_count",
    "source_storage_objects_count",
    "target_storage_objects_count",
    "source_storage_file_count",
    "target_storage_file_count",
    "source_storage_total_bytes",
    "target_storage_total_bytes",
    "auth_evidence_sha256",
    "storage_evidence_sha256",
    "storage_health_evidence_sha256",
    "postgrest_evidence_sha256",
    "restore-gate.env.sha256",
  ]) {
    assert.match(restore, new RegExp(binding.replaceAll(".", "\\.")));
    assert.match(apply, new RegExp(binding.replaceAll(".", "\\.")));
  }
  assert.match(apply, /sha256sum -c restore-gate\.env\.sha256/);
  assert.match(
    apply,
    /grep -Fxq "network_name=\$GATE_REHEARSAL_NETWORK_NAME" "\$TARGET_IDENTITY_EVIDENCE"/,
  );
  assert.match(
    apply,
    /grep -Fxq "database_container_id=\$GATE_REHEARSAL_DB_CONTAINER_ID" "\$TARGET_IDENTITY_EVIDENCE"/,
  );
  assert.match(
    apply,
    /grep -Fxq "database_system_identifier=\$GATE_REHEARSAL_DB_SYSTEM_IDENTIFIER" "\$TARGET_IDENTITY_EVIDENCE"/,
  );
  assert.match(apply, /test "\$GATE_SOURCE_AUTH_USERS_COUNT" = "\$GATE_TARGET_AUTH_USERS_COUNT"/);
  assert.match(
    apply,
    /test "\$GATE_SOURCE_STORAGE_FILE_COUNT" = "\$GATE_TARGET_STORAGE_FILE_COUNT"/,
  );
});

test("storage archive restores one exact storage root beside the bind source", () => {
  const source = runbook();
  const restore = source.slice(
    source.indexOf("## Рубеж 2:"),
    source.indexOf("## Рубеж 3:"),
  );
  const scriptStart = restore.indexOf("```bash\n");
  const restoreScript = restore.slice(
    scriptStart,
    restore.indexOf("\n```", scriptStart),
  );
  const apply = source.slice(source.indexOf("## Рубеж 8:"));

  assert.match(
    restoreScript,
    /ARCHIVE_PARENT="\$\(mktemp -d "\$ROLLOUT_DIR\/\.rehearsal-storage\.XXXXXX"\)"/,
  );
  assert.match(restoreScript, /REHEARSAL_STORAGE_ROOT="\$ARCHIVE_PARENT\/storage"/);
  assert.match(restoreScript, /install -d -m 700 "\$REHEARSAL_STORAGE_ROOT"/);
  assert.match(
    restoreScript,
    /test -z "\$\(find "\$REHEARSAL_STORAGE_ROOT" -mindepth 1 -print -quit\)"/,
  );
  assert.ok(
    restoreScript.indexOf('install -d -m 700 "$REHEARSAL_STORAGE_ROOT"') <
      restoreScript.indexOf("compose create"),
    "storage bind child must exist before compose create",
  );
  assert.match(restoreScript, new RegExp(restoreSafetyPath.replaceAll(".", "\\.")));
  assert.match(restoreScript, /extract-storage/);
  assert.doesNotMatch(restoreScript, /tar -tv/);
  assert.match(
    restoreScript,
    /SOURCE_SCAN="\$\(mktemp -d "\$ROLLOUT_DIR\/\.storage-source\.XXXXXX"\)"/,
  );
  assert.match(restoreScript, /"\$ROLLOUT_DIR"\/\.storage-source\.\?\?\?\?\?\?\) ;;/);
  assert.match(restoreScript, /find "\$SOURCE_SCAN" -xdev -depth -delete/);
  assert.match(restoreScript, /storage_aggregate "\$SOURCE_SCAN\/storage"/);
  assert.match(restoreScript, /extract-storage[\s\S]{0,200}"\$ARCHIVE_PARENT"/);
  assert.match(restoreScript, /storage_aggregate "\$REHEARSAL_STORAGE_ROOT"/);
  assert.match(
    restoreScript,
    /test "\$STORAGE_MOUNT_SOURCE" = "\$\(realpath -e "\$REHEARSAL_STORAGE_ROOT"\)"/,
  );
  assert.match(restoreScript, /printf 'version=7\\n'/);
  assert.match(apply, /test "\$\(gate_value version\)" = "7"/);
  assert.doesNotMatch(restoreScript, /\/var\/lib\/storage\/storage/);
});

test("restore safety helper rejects escaping hard links and verifies valid archives", () => {
  assert.equal(existsSync(restoreSafetyPath), true, `missing ${restoreSafetyPath}`);

  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  let result;
  for (const candidate of candidates) {
    result = spawnSync(candidate, ["tests/unit/supabase-restore-safety.test.py"], {
      encoding: "utf8",
    });
    if (!result.error && result.status !== 9009) break;
  }

  assert.ok(result && !result.error, `Python runtime unavailable: ${result?.error ?? "unknown"}`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("combined rehearsal strips only the exact outer transaction markers", () => {
  const source = runbook();

  assert.match(source, /migration[^\n]*exactly[^\n]*1[^\n]*BEGIN[^\n]*1[^\n]*COMMIT/i);
  assert.match(source, /smoke[^\n]*exactly[^\n]*1[^\n]*BEGIN[^\n]*1[^\n]*ROLLBACK/i);
  assert.match(source, /smoke[^\n]*psql meta/i);
  assert.match(source, /\\set ON_ERROR_STOP on/);
  assert.match(source, /PL\/pgSQL[^\n]*BEGIN/i);
  assert.match(source, /psql\s+-X[^\n]*ON_ERROR_STOP=1/i);
  assert.match(source, /one outer transaction|един[^\n]*внешн[^\n]*транзакц/i);
});

test("baseline, aggregate privacy-safe probes, and post-rollback parity are mandatory", () => {
  const source = runbook();

  assert.match(source, /production baseline/i);
  assert.match(source, /post-rollback parity/i);
  assert.match(source, /tombstone/i);
  assert.match(source, /dual[- ]sender/i);
  assert.match(source, /system[- ]sender/i);
  assert.match(source, /aggregate counts|агрегатн[^\n]*сч[её]тчик/i);
  assert.match(source, /no raw user data|без сырых пользовательских данных/i);
  assert.match(source, /functions?[^\n]*grants?[^\n]*polic/i);
  assert.match(source, /invalid index|невалидн[^\n]*индекс/i);
});

test("apply and gateway rollout remain behind database verification", () => {
  const source = runbook();

  assert.match(source, /exact apply only after rehearsal|apply[^\n]*only after[^\n]*rehearsal/i);
  assert.match(source, /NOTIFY pgrst,\s*'reload schema';/i);
  assert.match(source, /standalone smoke/i);
  assert.match(source, /gateway[^\n]*only after[^\n]*DB/i);
  assert.match(source, /rollback[^\n]*verified backup/i);
  assert.match(source, /no ad-hoc down SQL|ad-hoc down SQL[^\n]*(forbidden|запрещ)/i);
});

test("post-apply grant audit enumerates every private bot table and bot routine", () => {
  const source = runbook();
  const postApply = source.slice(source.indexOf("## Рубеж 9:"));

  assert.match(postApply, /n\.nspname = 'private'/);
  assert.match(postApply, /c\.relname like 'bot\\_%'/);
  assert.match(postApply, /for table_row in/i);
  assert.match(postApply, /has_table_privilege\('anon'/);
  assert.match(postApply, /has_table_privilege\('authenticated'/);
  assert.match(postApply, /has_table_privilege\('service_role'/);
  assert.match(postApply, /for routine_row in/i);
  assert.match(postApply, /p\.proname like 'bot\\_%'/);
  assert.match(postApply, /has_function_privilege\('anon'/);
  assert.match(postApply, /has_function_privilege\('authenticated'/);
  assert.match(postApply, /has_function_privilege\('service_role'/);
  assert.match(postApply, /expected_service_role_execute/i);
});

test("Task 7 keeps Step 5 pending until RLS smoke runs on the isolated restored stack", () => {
  const source = plan();
  const task7 = source.slice(source.indexOf("### Task 7:"));

  assert.match(task7, /- \[ \] \*\*Step 5: Run full local validation\*\*/);
  assert.match(task7, /local validation[^\n]*complete/i);
  assert.match(task7, /external-env security gate pending/i);
  assert.match(task7, /isolated restored/i);
  assert.match(task7, /rls:smoke/i);
});

test("examples are paste-safe and do not expose credentials or destructive cleanup", () => {
  const source = runbook();

  assert.doesNotMatch(source, /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i);
  assert.doesNotMatch(source, /(?:password|secret|service[_-]?role)\s*=\s*[^<$\s`]+/i);
  assert.doesNotMatch(source, /(?:echo|printf)[^\n]*(?:DATABASE_URL|PSQL_DSN|PASSWORD|SECRET)/i);
  assert.doesNotMatch(source, /\b(?:printenv|set\s+-x)\b/i);
  assert.doesNotMatch(source, /rm\s+-rf|DROP\s+SCHEMA[^\n]*CASCADE/i);
});
