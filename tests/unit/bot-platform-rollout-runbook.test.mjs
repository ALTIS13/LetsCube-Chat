import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const runbookPath = "docs/operations/bot-platform-database-rollout.md";
const migrationPath =
  ".migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql";
const smokePath = "tests/server/bot-platform-db-smoke.sql";
const planPath = "docs/superpowers/plans/2026-08-30-bot-platform.md";

function runbook() {
  assert.equal(existsSync(runbookPath), true, `missing ${runbookPath}`);
  return readFileSync(runbookPath, "utf8");
}

function plan() {
  assert.equal(existsSync(planPath), true, `missing ${planPath}`);
  return readFileSync(planPath, "utf8");
}

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
    /\^backup completed: \(\/srv\/letscube\/backups\/automated\/\[0-9\]\{8\}-\[0-9\]\{6\}\)\$/,
  );
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
  assert.match(apply, /run_id=\$RUN_ID/);
  assert.match(apply, /backup_dir=\$BACKUP_DIR/);
  assert.match(apply, /backup_sha256sums_sha256=\$BACKUP_SHA256SUMS_SHA256/);
  assert.match(
    apply,
    /cd "\$ROLLOUT_DIR"[\s\S]{0,200}sha256sum -c restore-evidence\.sha256/,
  );
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
