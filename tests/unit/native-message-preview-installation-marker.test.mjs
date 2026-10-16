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
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewInstallationMarker.java");
const probe = resolve(root, "tests/android/MessagePreviewInstallationMarkerProbe.java");
const prefix = "letscube-preview-installation-marker-";
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
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewInstallationMarkerProbe", scenario], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true,
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
  assert.ok(existsSync(source), "FEATURE_ABSENCE: installation marker codec is not implemented; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), prefix));
  compile(directory);
});
test.after(() => { if (directory) clean(directory); });

for (const scenario of ["literal-encode", "literal-decode", "nonce-bounds", "frame-bounds", "magic", "version", "ownership", "refusal"]) {
  test(`compiled installation marker: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["literal magic", '"LCNMPVI1"', '"LCNMPVI2"', "literal-encode", "MARKER_LITERAL_ENCODE"],
  ["literal version", "VERSION = 1;", "VERSION = 2;", "literal-encode", "MARKER_LITERAL_ENCODE"],
  ["big-endian encoding", "ByteBuffer.allocate(28).order(ByteOrder.BIG_ENDIAN)", "ByteBuffer.allocate(28).order(ByteOrder.LITTLE_ENDIAN)", "literal-encode", "MARKER_LITERAL_ENCODE"],
  ["exact read size", "encoded.length != 28", "encoded.length < 28", "frame-bounds", "EXACT_SIZE_READ"],
  ["magic refusal", "!Arrays.equals(magic, MAGIC)", "false", "magic", "MAGIC_REFUSED"],
  ["version refusal", "input.getInt() != VERSION", "false", "version", "VERSION_REFUSED"],
  ["lowercase installation", '"0123456789abcdef"', '"0123456789ABCDEF"', "literal-decode", "LOWERCASE_INSTALLATION"],
  ["stack suppression", 'super("UNAVAILABLE", null, false, false);', 'super("UNAVAILABLE", null, true, true);', "refusal", "REFUSAL_NO_STACK"],
  ["nonce size", "nonce.length != 16", "nonce.length > 16", "nonce-bounds", "EXACT_NONCE_SIZE"],
  ["cause exclusion", 'super("UNAVAILABLE", null, false, false);', 'super("UNAVAILABLE", new Exception("FICTIONAL"), false, false);', "refusal", "REFUSAL_NO_CAUSE"],
  ["suppression exclusion", 'super("UNAVAILABLE", null, false, false);', 'super("UNAVAILABLE", null, true, false);', "refusal", "REFUSAL_NO_SUPPRESSED"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled installation marker omission refused: ${name}`, () => {
    const actual = readFileSync(source, "utf8");
    assert.equal(actual.split(before).length, 2, "one literal rule in actual source");
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(healthy.stdout.trim(), `PASS ${scenario}`);
    const path = mkdtempSync(join(tmpdir(), prefix + "mutant-"));
    try {
      const changed = join(path, "MessagePreviewInstallationMarker.java");
      writeFileSync(changed, actual.replace(before, after));
      compile(path, changed);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime oracle, not compilation/timeout/setup failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
