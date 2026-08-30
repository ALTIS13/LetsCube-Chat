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
  assert.match(
    runbook,
    /docker ps --filter label=coolify\.applicationId=fkd10qwlo4qod9e6gtyzzuwk/,
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
