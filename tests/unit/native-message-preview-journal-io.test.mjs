import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const javaHome = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(javaHome, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewJournalIO.java");
const supporting = ["MessagePreviewVerificationState", "MessagePreviewMetadataEnvelope"]
  .map(name => resolve(root, "android/app/src/main/java/com/kub/messenger", name + ".java"));
const probe = resolve(root, "tests/android/MessagePreviewJournalIOProbe.java");
let directory;
function compile(path, sourceFile = source) {
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", path, ...supporting, sourceFile, probe], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
}
function run(scenario, path = directory) {
  const files = mkdtempSync(join(tmpdir(), "letscube-journal-files-"));
  try {
    const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewJournalIOProbe", scenario, files], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    return result;
  } finally { clean(files); }
}
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path));
  assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep));
  rmSync(actual, { recursive: true });
}
test.before(() => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: checked journal I/O is not implemented; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), "letscube-journal-io-"));
  compile(directory);
});
test.after(() => { if (directory) clean(directory); });
for (const scenario of ["healthy", "invalid-before-io", "read-bound", "read-close", "no-progress", "write-faults", "finish-unknown", "readback-faults", "missing-auth", "readback-key", "locking"]) {
  test(`compiled journal I/O: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["flush before sync", "stream.flush();", "", "healthy", "CHECKED_ORDER"],
  ["explicit sync", "backend.sync(stream);", "", "healthy", "CHECKED_ORDER"],
  ["finish before readback", "backend.finishWrite(stream);", "", "healthy", "CHECKED_WRITE"],
  ["exact byte readback", "if (!Arrays.equals(snapshot, readback)) return Result.UNAVAILABLE;", "", "readback-faults", "READBACK_EXACT_NOT_ANY_AUTH"],
  ["authenticate before start", "MessagePreviewMetadataEnvelope.open(snapshot, installation, metadataKey);", "", "invalid-before-io", "INVALID_BEFORE_IO"],
  ["bounded observation", "Math.min(buffer.length, MAX_BYTES + 1 - output.size())", "buffer.length", "read-bound", "READ_OBSERVATION_CEILING"],
  ["no rollback after finish", "stream != null && !finishAttempted", "stream != null", "finish-unknown", "NO_ROLLBACK_AFTER_FINISH"],
  ["readback metadata authenticates", "MessagePreviewMetadataEnvelope.open(readback, installation, metadataKey);", "", "readback-key", "READBACK_REAUTHENTICATES_KEY"],
  ["read-write serialization", "synchronized MessagePreviewMetadataEnvelope.Record read", "MessagePreviewMetadataEnvelope.Record read", "locking", "SERIALIZED_READ_WRITE"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled journal omission refused: ${name}`, () => {
    const actual = readFileSync(source, "utf8");
    assert.equal(actual.split(before).length, 2);
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    const path = mkdtempSync(join(tmpdir(), "letscube-journal-mutant-"));
    try {
      const changed = join(path, "MessagePreviewJournalIO.java");
      writeFileSync(changed, actual.replace(before, after)); compile(path, changed);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime assertion, not compilation/timeout/setup failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
