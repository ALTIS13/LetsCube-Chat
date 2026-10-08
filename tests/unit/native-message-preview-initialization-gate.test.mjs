import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const javaHome = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(javaHome, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewInitializationGate.java");
const probe = resolve(root, "tests/android/MessagePreviewInitializationGateProbe.java");
const prefix = "letscube-preview-init-gate-";
let directory;
function compile(path, sourceFile = source) {
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-g:none", "-d", path, sourceFile, probe], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
}
function run(scenario, path = directory) {
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewInitializationGateProbe", scenario], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  return result;
}
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path));
  assert.equal(dirname(actual), realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix));
  rmSync(actual, { recursive: true });
}
test.before(() => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: inactive initialization gate is not implemented; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), prefix)); compile(directory);
});
test.after(() => { if (directory) clean(directory); });
for (const scenario of ["healthy", "budget", "handles", "permits", "one-use", "stale", "held-worker", "retry", "effect-terminal", "clock", "authority", "refusal"]) {
  test(`compiled initialization gate: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}
function replaceOne(before, after) {
  return actual => {
    assert.equal(actual.split(before).length, 2, "one literal rule in actual source");
    return actual.replace(before, after);
  };
}
const mutations = [
  ["private handle issuer/currency", replaceOne("handle == null || handle.issuer != this || handle.epoch != epoch", "handle == null"), "handles", "HANDLE_ISSUER_REQUIRED"],
  ["private permit owner/attempt", replaceOne("permit == null || permit.issuer != this || active != permit || permit.worker != worker", "permit == null"), "permits", "PRIVATE_PERMIT_OWNER_REQUIRED"],
  ["exact worker", replaceOne("if (Thread.currentThread() != worker) throw new Unavailable();", ""), "one-use", "EXACT_WORKER_REQUIRED"],
  ["one-use consume", replaceOne("if (permit.consumed) throw new Unavailable();", ""), "one-use", "ONE_USE_CONSUME_REQUIRED"],
  ["consumed before effect", replaceOne("if (!permit.consumed) throw new Unavailable();", ""), "one-use", "CONSUMED_BEFORE_EFFECT_REQUIRED"],
  ["current final ACK", replaceOne("if (!permit.effectAttempted) throw new Unavailable();\n        requireCurrent(permit);", "if (!permit.effectAttempted) throw new Unavailable();"), "stale", "CURRENT_FINAL_ACK_REQUIRED"],
  ["held busy admission", replaceOne("if (active != null) throw new Unavailable();", ""), "held-worker", "BUSY_HELD_UNTIL_SETTLED"],
  ["invalidation retains worker slot", replaceOne("if (active != null) retire(active);", "if (active != null) retire(active); active = null;"), "held-worker", "BUSY_HELD_UNTIL_SETTLED"],
  ["effect failure terminal", replaceOne("if (permit.effectAttempted) terminal = true;", ""), "effect-terminal", "EFFECT_FAILURE_TERMINAL"],
  ["10000 ms endpoint", replaceOne("BUDGET_MILLIS = 10_000;", "BUDGET_MILLIS = 10_001;"), "budget", "DEADLINE_10000_REFUSED"],
  ["deadline arithmetic headroom", replaceOne("if (value > Long.MAX_VALUE - BUDGET_MILLIS) throw new Unavailable();", ""), "budget", "ADMISSION_HEADROOM_REQUIRED"],
  ["backward monotonic refusal", replaceOne("value < 0 || value < lastMillis", "value < 0"), "clock", "BACKWARD_MONOTONIC_REFUSED"],
  ["old handle retirement", replaceOne("epoch = new Object();\n        if (active != null) retire(active);", "if (active != null) retire(active);"), "handles", "INVALIDATED_HANDLE_REFUSED"],
  ["clock after authority check", replaceOne("requireAuthority(permit.handle.snapshot);\n            long value = now();", "long value = now();\n            requireAuthority(permit.handle.snapshot);"), "budget", "AUTHORITY_CHECK_SPENT_BUDGET_REFUSED"],
];
for (const [name, mutate, scenario, oracle] of mutations) {
  test(`compiled initialization gate omission refused: ${name}`, () => {
    const actual = readFileSync(source, "utf8").replace(/\r\n/g, "\n");
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(healthy.stdout.trim(), `PASS ${scenario}`);
    const changed = mutate(actual); assert.notEqual(changed, actual);
    const path = mkdtempSync(join(tmpdir(), prefix + "mutant-"));
    try {
      const changedFile = join(path, "MessagePreviewInitializationGate.java");
      writeFileSync(changedFile, changed); compile(path, changedFile);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime oracle, not compilation/timeout/setup failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
