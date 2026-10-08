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
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewMetadataEnvelope.java");
const bounds = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewVerificationState.java");
const probe = resolve(root, "tests/android/MessagePreviewMetadataEnvelopeProbe.java");
let directory;

function compile(path, sourceFile = source) {
  const compiled = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", path, bounds, sourceFile, probe], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.status, 0, compiled.stderr);
}
function run(scenario, path = directory) {
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewMetadataEnvelopeProbe", scenario], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

function clean(path) {
  const actual = realpathSync(path);
  assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep));
  assert.equal(actual, resolve(path));
  rmSync(actual, { recursive: true });
}
test.before(() => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: metadata envelope is not implemented; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), "letscube-preview-metadata-"));
  compile(directory);
});
test.after(() => { if (directory) clean(directory); });

for (const scenario of ["kinds", "external", "tamper", "keys", "namespace", "framing", "bounds", "ownership", "ivs", "expired", "malformed-authenticated"]) {
  test(`compiled metadata envelope: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["independent AAD domain", '"LETSCUBE-NMPV-META-v1"', '"LETSCUBE-NMPV-META-v2"', "external", "EXTERNAL_AUTH"],
  ["independent format version", "FORMAT = 1;", "FORMAT = 2;", "external", "EXTERNAL_AUTH"],
  ["independent 12-byte IV", "IV_BYTES = 12, TAG_BYTES = 16", "IV_BYTES = 16, TAG_BYTES = 16", "external", "EXTERNAL_AUTH"],
  ["independent 128-bit tag", "new GCMParameterSpec(128, snapshot", "new GCMParameterSpec(96, snapshot", "external", "EXTERNAL_AUTH"],
  ["credential bytes participate in AAD", "cipher.updateAAD(snapshot, MAGIC.length, credentialStart + credentialLength - MAGIC.length);", "cipher.updateAAD(snapshot, MAGIC.length, credentialStart - MAGIC.length);", "external", "EXTERNAL_AUTH"],
  ["metadata tag must authenticate", "if (cipher.doFinal(snapshot, snapshot.length - TAG_BYTES, TAG_BYTES).length != 0) throw new Unavailable();", "", "tamper", "ALTERED_BYTE_REFUSED"],
  ["total envelope bound", "MAX_BYTES = 16_384", "MAX_BYTES = 32_768", "bounds", "TOTAL_LIMIT_WRITE"],
  ["read-side total bound", "encoded.length > MAX_BYTES", "false", "bounds", "TOTAL_LIMIT_READ"],
  ["cross-installation refusal", "!header.installation.equals(expectedInstallation)", "false", "namespace", "FOREIGN_INSTALLATION"],
  ["owned alias namespace", "alias.startsWith(prefix)", "true", "namespace", "FOREIGN_ALIAS"],
  ["safe persisted numbers", "return MessagePreviewVerificationState.safe(value);", "return value >= 0;", "bounds", "SAFE_INTEGER"],
  ["noncommitted payload exclusion", "credentialLength != 0 || h.expiresWallMillis != 0", "h.expiresWallMillis != 0", "malformed-authenticated", "NONCOMMITTED_CIPHERTEXT"],
  ["canonical header has no extra fields", "if (input.hasRemaining()) throw new Unavailable();", "", "malformed-authenticated", "EXTRA_HEADER_FIELD"],
  ["returned ciphertext is a snapshot", "byte[] credentialBytes() { return credential.clone(); }", "byte[] credentialBytes() { return credential; }", "ownership", "IMMUTABLE_SNAPSHOT"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled metadata omission refused: ${name}`, () => {
    const actual = readFileSync(source, "utf8");
    assert.equal(actual.split(before).length, 2, "one literal rule in actual source");
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(healthy.stdout.trim(), `PASS ${scenario}`);
    const path = mkdtempSync(join(tmpdir(), "letscube-preview-metadata-mutant-"));
    try {
      const changed = join(path, "MessagePreviewMetadataEnvelope.java");
      writeFileSync(changed, actual.replace(before, after));
      compile(path, changed);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime assertion, not compilation/timeout/setup failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
