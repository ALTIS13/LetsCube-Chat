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
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewKeystoreReader.java");
const probe = resolve(root, "tests/android/MessagePreviewKeystoreReaderProbe.java");
const fixture = resolve(root, "tests/fixtures/native-message-preview-keystore-reader");
const stubs = ["android/content/Context.java", "android/os/UserManager.java",
  "android/security/keystore/KeyInfo.java", "android/security/keystore/KeyProperties.java"].map(path => resolve(fixture, path));
let directory;
function compile(path, actualSource = source) {
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", path, ...stubs, actualSource, probe], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
}
function run(scenario, path = directory) {
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewKeystoreReaderProbe", scenario], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined);
  return result;
}
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path));
  assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep));
  rmSync(actual, { recursive: true });
}
test.before(() => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: read-only Keystore reader is not implemented; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), "letscube-keystore-reader-"));
  compile(directory);
});
test.after(() => { if (directory) clean(directory); });
for (const scenario of ["positive", "aliases", "installations", "protected", "locked", "unknown-user", "unknown-context", "null-context",
  "context-recheck", "retirement", "missing", "not-secret", "algorithm", "load-error", "lookup-error", "spec-error", "wrong-spec", "missing-provider",
  "info-alias", "size", "origin", "purposes", "modes", "padding", "authentication", "null-modes", "null-padding", "null-info-alias"]) {
  test(`compiled keystore reader: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["fixed metadata namespace", '"letscube.nmpv.metadata.v1."', '"letscube.nmpv.metadata.v2."', "positive", "FIXED_METADATA_ALIAS"],
  ["credential ownership", "alias.startsWith(prefix)", "true", "aliases", "FOREIGN_OR_MALFORMED_ALIAS"],
  ["credential lowercase", "hex32(alias.substring(prefix.length()))", "true", "aliases", "FOREIGN_OR_MALFORMED_ALIAS"],
  ["installation lowercase", "!hex32(installation)", "installation == null || installation.length() != 32", "installations", "INSTALLATION_REFUSED"],
  ["CE context", "context.isDeviceProtectedStorage()", "false", "protected", "CONTEXT_REFUSED"],
  ["unlocked user", "!manager.isUserUnlocked()", "false", "locked", "CONTEXT_REFUSED"],
  ["load context recheck", "requireContext(); // Before lookup.", "", "context-recheck", "LOAD_RECHECK_BEFORE_LOOKUP"],
  ["return context recheck", "requireContext(); // Before returning the borrowed key.", "", "retirement", "LOCK_DURING_LOOKUP_REFUSED"],
  ["AES key algorithm", "!KeyProperties.KEY_ALGORITHM_AES.equals(key.getAlgorithm())", "false", "algorithm", "KEY_UNAVAILABLE"],
  ["exact KeyInfo alias", "!alias.equals(info.getKeystoreAlias())", "false", "info-alias", "POLICY_REFUSED"],
  ["AES256", "info.getKeySize() != 256", "false", "size", "POLICY_REFUSED"],
  ["generated origin", "info.getOrigin() != KeyProperties.ORIGIN_GENERATED", "false", "origin", "POLICY_REFUSED"],
  ["exact purposes", "info.getPurposes() != (KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)", "false", "purposes", "POLICY_REFUSED"],
  ["GCM only", "!Arrays.equals(info.getBlockModes(), new String[] { KeyProperties.BLOCK_MODE_GCM })", "false", "modes", "POLICY_REFUSED"],
  ["NoPadding only", "!Arrays.equals(info.getEncryptionPaddings(), new String[] { KeyProperties.ENCRYPTION_PADDING_NONE })", "false", "padding", "POLICY_REFUSED"],
  ["no user-authenticated key", "info.isUserAuthenticationRequired()", "false", "authentication", "POLICY_REFUSED"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled keystore omission refused: ${name}`, () => {
    const actual = readFileSync(source, "utf8");
    assert.equal(actual.split(before).length, 2, "one literal actual-source rule");
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(healthy.stdout.trim(), `PASS ${scenario}`);
    const path = mkdtempSync(join(tmpdir(), "letscube-keystore-mutant-"));
    try {
      const changed = join(path, "MessagePreviewKeystoreReader.java");
      writeFileSync(changed, actual.replace(before, after));
      compile(path, changed);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime assertion, not compile/setup/timeout failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
