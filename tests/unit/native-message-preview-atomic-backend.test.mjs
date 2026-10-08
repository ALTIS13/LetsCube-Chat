import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { atomicStubs } from "../android/message-preview-atomic-stubs.fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const javaHome = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(javaHome, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewAtomicBackend.java");
const supporting = ["MessagePreviewVerificationState", "MessagePreviewMetadataEnvelope", "MessagePreviewJournalIO",
  "MessagePreviewInstallationMarker", "MessagePreviewInitializationGate"]
  .map(name => resolve(root, "android/app/src/main/java/com/kub/messenger", name + ".java"));
const probe = resolve(root, "tests/android/MessagePreviewAtomicBackendProbe.java");
let directory;
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path));
  assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep));
  rmSync(actual, { recursive: true });
}
function compile(path, sourceFile = source) {
  const files = Object.entries(atomicStubs).map(([name, text]) => {
    const file = join(path, "stubs", name);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  });
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", path, ...files, ...supporting, sourceFile, probe], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
}
function run(scenario, path = directory) {
  const files = mkdtempSync(join(tmpdir(), "letscube-atomic-files-"));
  try {
    const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewAtomicBackendProbe", scenario, files], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined); return result;
  } finally { clean(files); }
}
test.before(() => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: Task6C2 backend does not exist; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), "letscube-atomic-backend-")); compile(directory);
});
test.after(() => { if (directory) clean(directory); });
for (const scenario of ["healthy", "policy", "missing", "paths", "symlinks", "ownership", "finalization", "completion-policy", "sync-fault", "root-alias", "root-alias-refusals", "root-alias-recheck", "root-alias-children"]) {
  test(`compiled adapter with JVM API doubles: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["CE admission", "if (context.isDeviceProtectedStorage()) throw unavailable();", "", "policy", "CE_RECHECKED"],
  ["unlocked admission", "!((UserManager) service).isUserUnlocked()", "false", "policy", "UNLOCK_REQUIRED"],
  ["raw root traversal", "if (\".\".equals(part.getName()) || \"..\".equals(part.getName())) throw unavailable();", "", "paths", "CANONICAL_PATH_REQUIRED"],
  ["one writer", "if (active != null) throw unavailable();", "", "ownership", "ONE_WRITER"],
  ["stream identity before I/O", "borrowed != active", "false", "ownership", "FOREIGN_BEFORE_IO_OR_CLOSE"],
  ["explicit flush", "owned.flush();", "", "healthy", "SYNC_EXPLICIT_FLUSH"],
  ["explicit fd sync", "owned.getFD().sync();", "", "sync-fault", "REAL_FD_SYNC_REQUIRED"],
  ["release after failure", "active = null;", "", "finalization", "CONSUMED_STREAM_REFUSED"],
  ["root alias normalization", "return raw.getCanonicalFile();", "return raw;", "root-alias", "PLATFORM_PARENT_ALIAS_ACCEPTED"],
  ["raw root absolute", "raw == null || !raw.isAbsolute()", "raw == null", "root-alias-refusals", "ROOT_ABSOLUTE_REQUIRED"],
  ["raw root leaf directory", "if (!OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode)) throw unavailable();", "Os.lstat(raw.getPath());", "root-alias-refusals", "ROOT_LEAF_SYMLINK_REFUSED"],
  ["raw root lookup failure", "} catch (ErrnoException refused) { throw unavailable(); }\n        return raw.getCanonicalFile();", "} catch (ErrnoException refused) { return raw.getCanonicalFile(); }\n        return raw.getCanonicalFile();", "root-alias-refusals", "ROOT_LOOKUP_REFUSED"],
  ["normalized root identity", "if (!root.equals(platformRoot())) throw unavailable();", "", "root-alias-recheck", "NORMALIZED_ROOT_DRIFT_REFUSED"],
  ["root lstat before normalization", "        try {\n            if (!OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode)) throw unavailable();\n        } catch (ErrnoException refused) { throw unavailable(); }\n        return raw.getCanonicalFile();", "        File normalized = raw.getCanonicalFile();\n        try {\n            if (!OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode)) throw unavailable();\n        } catch (ErrnoException refused) { throw unavailable(); }\n        return normalized;", "root-alias", "RAW_LSTAT_BEFORE_CANONICAL"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled adapter omission refused: ${name}`, () => {
    const actual = readFileSync(source, "utf8").replace(/\r\n/g, "\n");
    assert.equal(actual.split(before).length, 2, "one literal production rule");
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    const path = mkdtempSync(join(tmpdir(), "letscube-atomic-mutant-"));
    try {
      const changed = join(path, "MessagePreviewAtomicBackend.java");
      writeFileSync(changed, actual.replace(before, after)); compile(path, changed);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime refusal, not compiler/timeout failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}

test("real Android SDK bootclasspath compile only (no stubs/device)", () => {
  const jar = process.env.MESSAGE_PREVIEW_ANDROID_JAR ?? "D:/Progi/AndroidStudio-sdk/platforms/android-36/android.jar";
  assert.ok(existsSync(jar), "installed Android SDK required; no download/fallback");
  const path = mkdtempSync(join(tmpdir(), "letscube-atomic-sdk-"));
  try {
    const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-source", "8", "-target", "8", "-bootclasspath", jar, "-d", path, ...supporting, source], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(path, "com/kub/messenger/MessagePreviewAtomicBackend.class")));
  } finally { clean(path); }
});
