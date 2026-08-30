import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const scriptPath = new URL(
  "../../scripts/registration-cleanup-smoke.mjs",
  import.meta.url,
);
const composePath = new URL("../../docker-compose.yml", import.meta.url);
const dockerfilePath = new URL("../../docs/deploy/Dockerfile", import.meta.url);
const healthRoutePath = new URL(
  "../../artifacts/api-server/src/routes/health.ts",
  import.meta.url,
);
const cleanupHealthRoutePath = new URL(
  "../../artifacts/api-server/src/routes/registrationCleanupHealthRoute.ts",
  import.meta.url,
);
const runbookPath = new URL(
  "../../docs/operations/registration-lifecycle-cleanup.md",
  import.meta.url,
);

async function source(file) {
  return readFile(file, "utf8").catch(() => "");
}

function runSmoke(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath.pathname, ...args], {
    cwd: path.resolve(root.pathname),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("smoke script fails closed until both the explicit guard and report-only flag are present", async () => {
  const script = await source(scriptPath);
  assert.match(script, /REGISTRATION_CLEANUP_SMOKE\s*!==\s*["']1["']/);
  assert.match(script, /--report-only/);
  assert.match(script, /process\.exitCode\s*=\s*1/);

  for (const [args, env] of [
    [["--report-only"], { REGISTRATION_CLEANUP_SMOKE: "" }],
    [[], { REGISTRATION_CLEANUP_SMOKE: "1" }],
    [["--report-only", "--execute"], { REGISTRATION_CLEANUP_SMOKE: "1" }],
  ]) {
    const result = runSmoke(args, env);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /@|https?:\/\/|token|key|secret/i,
    );
  }
});

test("smoke script only calls the aggregate report RPC and projects safe aggregate fields", async () => {
  const script = await source(scriptPath);

  assert.match(script, /createClient\(/);
  assert.match(script, /persistSession:\s*false/);
  assert.match(script, /autoRefreshToken:\s*false/);
  assert.match(
    script,
    /readEnv\(env, "SUPABASE_SERVICE_ROLE_KEY"\)\s*\|\|\s*readEnv\(env, "SELFHOST_SERVICE_ROLE_KEY"\)/,
  );
  assert.match(script, /\.rpc\(["']registration_cleanup_report["']/);
  assert.doesNotMatch(
    script,
    /\.rpc\(["']registration_cleanup_(?:claim|recheck|finish)["']/,
  );
  for (const field of [
    "report_scope",
    "signup_kind",
    "reason_code",
    "item_count",
  ]) {
    assert.match(script, new RegExp(`['\"]${field}['\"]`));
  }
  assert.match(script, /claimed_unsafe_/);
  assert.match(script, /dead_lettered/);
  assert.match(script, /retry_wait/);
  assert.match(script, /reported\|deleted\|skipped\|failed\|recovered/);
  assert.doesNotMatch(
    script,
    /console\.(?:log|error)[\s\S]{0,160}(?:email|phone|user_id|user_reference|claim_token|endpoint|token|secret)/i,
  );
});

test("portable compose defaults keep cleanup disabled and report-only", async () => {
  const compose = await source(composePath);

  for (const [name, value] of [
    ["REGISTRATION_CLEANUP_ENABLED", "false"],
    ["REGISTRATION_CLEANUP_REPORT_ONLY", "true"],
    ["REGISTRATION_CLEANUP_BATCH_SIZE", "50"],
    ["REGISTRATION_CLEANUP_INTERVAL_SECONDS", "3600"],
  ]) {
    assert.match(compose, new RegExp(`${name}:\\s*\\$\\{${name}:-${value}\\}`));
  }
});

test("Dockerfile worker runtime sources the local secret env and exposes cleanup health", async () => {
  const [dockerfile, healthRoute, cleanupHealthRoute, runbook] = await Promise.all([
    source(dockerfilePath),
    source(healthRoutePath),
    source(cleanupHealthRoutePath),
    source(runbookPath),
  ]);

  assert.match(dockerfile, /\/run\/secrets\/letscube-infra\.env/);
  assert.match(dockerfile, /set -a;\s*\. \/run\/secrets\/letscube-infra\.env;\s*set \+a/);
  assert.match(dockerfile, /artifacts\/api-server\/dist\/index\.mjs/);
  assert.match(healthRoute, /\/healthz\/registration-cleanup/);
  assert.match(healthRoute, /registrationCleanupHealthHandler/);
  assert.match(healthRoute, /registrationCleanupHealthPayload/);
  assert.match(cleanupHealthRoute, /socket\.remoteAddress/);
  assert.match(runbook, /letscube-worker/);
  assert.match(runbook, /\/srv\/letscube\/secrets\/letscube-infra\.env/);
  assert.match(runbook, /\/run\/secrets\/letscube-infra\.env/);
  assert.match(runbook, /container destination/i);
  assert.match(runbook, /fkd10qwlo4qod9e6gtyzzuwk/);
  const workerSelectorPattern =
    /docker ps \\\n  --filter label=coolify\.name=fkd10qwlo4qod9e6gtyzzuwk \\\n  --filter label=com\.docker\.compose\.project=fkd10qwlo4qod9e6gtyzzuwk \\\n  --quiet/g;
  assert.equal(
    [...runbook.matchAll(workerSelectorPattern)].length,
    2,
    "preflight and post-deploy gates must use the same exact worker UUID labels",
  );
  assert.match(runbook, /worker_count=.*\n\[ "\$worker_count" -eq 1 \]/);
  assert.match(runbook, /Re-verify.*Coolify.*before rollout/i);
  assert.doesNotMatch(runbook, /--filter name=letscube-worker/);
  assert.match(runbook, /set -euo pipefail/);
  assert.match(runbook, /REGISTRATION_CLEANUP_ENABLED=true/);
  assert.match(runbook, /REGISTRATION_CLEANUP_REPORT_ONLY=true/);
  assert.match(runbook, /api\/healthz\/registration-cleanup/);
  assert.match(runbook, /curl --fail --silent --show-error[\s\S]+api\/healthz\/registration-cleanup/);
  assert.match(runbook, /lastSuccessAt/);
  assert.match(runbook, /lastRunAt/);
  assert.match(runbook, /lastFailureAt !== null/);
  assert.match(runbook, /lastResult\?\.failed !== 0/);
  assert.match(runbook, /successAt < runAt/);
  assert.match(runbook, /mktemp/);
  assert.match(
    runbook,
    /rollback_file="\$\{env_file\}\.registration-cleanup\.rollback"/,
  );
  assert.match(runbook, /sudo -n test ! -e "\$rollback_file"/);
  assert.match(runbook, /session loss/i);
  assert.match(
    runbook,
    /recovery_env_file=\/srv\/letscube\/secrets\/letscube-infra\.env/,
  );
  assert.match(
    runbook,
    /recovery_rollback_file=\/srv\/letscube\/secrets\/letscube-infra\.env\.registration-cleanup\.rollback/,
  );
  assert.match(runbook, /sudo -n test -f "\$recovery_rollback_file"/);
  assert.match(
    runbook,
    /sudo -n mv -f -- "\$recovery_rollback_file" "\$recovery_env_file"/,
  );
  assert.doesNotMatch(
    runbook,
    /rollback_file="\$\(sudo -n mktemp/,
  );
  assert.match(runbook, /mv -f --/);
  assert.match(runbook, /YYYYMMDD-HHMMSS/);
  assert.match(runbook, /before_backup_dirs/);
  assert.match(runbook, /after_backup_dirs/);
  assert.match(runbook, /set local role service_role[\s\S]+registration_cleanup_report\(\)/i);
});

test("gateway deployment is hash-verified and precedes worker enablement and backfill", async () => {
  const runbook = await source(runbookPath);
  const gateway = runbook.indexOf(
    "/srv/letscube/platform/supabase-docker/volumes/functions/auth-yandex-gateway",
  );
  const worker = runbook.indexOf("REGISTRATION_CLEANUP_ENABLED=true");
  const backfill = runbook.indexOf(
    "registration_lifecycle_backfill_internal(1000",
  );

  assert.ok(gateway >= 0, "expected the live gateway host path");
  assert.ok(worker > gateway, "gateway deployment must precede worker enablement");
  assert.ok(backfill > gateway, "gateway deployment must precede backfill");
  assert.match(runbook, /\/home\/deno\/functions/);
  for (const file of [
    "index.ts",
    "inviteCode.mjs",
    "rateLimit.mjs",
    "registrationLifecycle.mjs",
    "captchaProvider.mjs",
  ]) {
    assert.match(runbook, new RegExp(file.replace(".", "\\.")));
  }
  assert.match(runbook, /git archive/);
  assert.match(runbook, /sha256sum/);
  assert.match(runbook, /committed\.sha256/);
  assert.match(runbook, /staged\.sha256/);
  assert.match(runbook, /deployed\.sha256/);
  assert.match(runbook, /container\.sha256/);
  assert.match(runbook, /cmp --silent/);
  assert.match(
    runbook,
    /auth-yandex-gateway\.registration-lifecycle\.rollback/,
  );
  assert.match(runbook, /cp -a/);
  assert.match(runbook, /install --owner/);
  assert.match(runbook, /mv -f --/);
  assert.match(runbook, /docker restart supabase-edge-functions/);
  assert.match(runbook, /-X OPTIONS/);
  assert.match(runbook, /captcha_required/);
  assert.match(runbook, /session loss/i);
});

test("database rehearsal checks every operational grant, private helper and bounded plan", async () => {
  const runbook = await source(runbookPath);

  for (const rpc of [
    "registration_lifecycle_register_internal",
    "registration_lifecycle_extend_by_email_internal",
    "registration_cleanup_claim",
    "registration_cleanup_recheck",
    "registration_cleanup_delete",
    "registration_cleanup_finish",
    "registration_cleanup_report",
    "registration_cleanup_recover_dead_letter",
    "registration_cleanup_purge_audit",
    "registration_lifecycle_backfill_internal",
  ]) {
    assert.match(
      runbook,
      new RegExp(`public\\.${rpc}\\(`, "i"),
      rpc,
    );
  }
  assert.match(runbook, /has_function_privilege\('anon'/i);
  assert.match(runbook, /has_function_privilege\('authenticated'/i);
  assert.match(runbook, /has_function_privilege\('service_role'/i);

  for (const helper of [
    "registration_identity_requires_hold",
    "registration_has_product_activity",
    "registration_location_membership_requires_hold",
    "registration_record_invite_location_provenance",
    "registration_location_membership_guard",
    "registration_cleanup_guard_auth_user_delete",
  ]) {
    assert.match(runbook, new RegExp(helper, "i"), helper);
  }

  assert.match(runbook, /select report_scope, signup_kind, reason_code, item_count[\s\S]+registration_cleanup_report\(\)/i);
  assert.match(runbook, /explain \(costs off\)[\s\S]+dead_lettered_at is null/i);
  assert.match(runbook, /explain \(costs off\)[\s\S]+next_attempt_at/i);
  assert.match(runbook, /explain \(costs off\)[\s\S]+dead_lettered_at is not null/i);
  assert.match(runbook, /explain \(costs off\)[\s\S]+registration_invite_uses[\s\S]+limit 1000/i);
  for (const index of [
    "registration_lifecycles_due_idx",
    "registration_lifecycles_retry_idx",
    "registration_lifecycles_dead_letter_idx",
    "idx_registration_invite_uses_user",
  ]) {
    assert.match(runbook, new RegExp(index, "i"), index);
  }
});
