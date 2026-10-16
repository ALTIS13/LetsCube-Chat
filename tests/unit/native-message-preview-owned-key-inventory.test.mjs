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
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewOwnedKeyInventory.java");
const probe = resolve(root, "tests/android/MessagePreviewOwnedKeyInventoryProbe.java");
const prefix = "letscube-preview-owned-key-inventory-";
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
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewOwnedKeyInventoryProbe", scenario], {
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
  rmSync(actual, {recursive:true});
}
test.before(() => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: owned-key inventory scanner is not implemented; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), prefix));
  compile(directory);
});
test.after(() => { if (directory) clean(directory); });

for (const scenario of ["empty", "entry-bounds", "alias-bounds", "prefix", "late-owned", "iterator-errors", "stale-has", "stale-next", "stale-end", "stale-repeat", "refusal"]) {
  test(`compiled owned-key inventory: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}
function omitCurrent(ordinal) {
  return actual => {
    const literal = "requireCurrent(current);";
    assert.equal(actual.split(literal).length, 4, "three independent current boundaries");
    let cursor = -1;
    for (let i = 0; i <= ordinal; i++) cursor = actual.indexOf(literal, cursor + 1);
    return actual.slice(0, cursor) + actual.slice(cursor + literal.length);
  };
}
function replaceOne(before, after) {
  return actual => {
    assert.equal(actual.split(before).length, 2, "one literal rule in actual source");
    return actual.replace(before, after);
  };
}
const mutations = [
  ["whole reserved prefix", replaceOne('"letscube.nmpv."', '"letscube.nmpv.metadata.v1."'), "prefix", "OWNED_PREFIX_REFUSED"],
  ["owned-prefix refusal", replaceOne("alias.startsWith(PREFIX)", "false"), "prefix", "OWNED_PREFIX_REFUSED"],
  ["256 total entry cap", replaceOne("MAX_ENTRIES = 256;", "MAX_ENTRIES = 257;"), "entry-bounds", "ENTRY_OVERFLOW_REFUSED"],
  ["256 alias character cap", replaceOne("MAX_ALIAS_CHARS = 256;", "MAX_ALIAS_CHARS = 257;"), "alias-bounds", "ALIAS_SIZE_REFUSED"],
  ["current before hasMoreElements", omitCurrent(0), "stale-has", "NO_HAS_AFTER_STALE"],
  ["current before nextElement", omitCurrent(2), "stale-next", "NO_NEXT_AFTER_STALE"],
  ["current before end ACK", omitCurrent(1), "stale-end", "END_ACK_REFUSED"],
  ["exception containment", replaceOne("catch (Exception refused) { throw new Unavailable(); }", 'catch (Exception refused) { throw new IllegalStateException("FICTIONAL_PRIVATE"); }'), "iterator-errors", "CHECKED_REFUSAL_REQUIRED"],
  ["stack exclusion", replaceOne('super("UNAVAILABLE", null, false, false);', 'super("UNAVAILABLE", null, false, true);'), "refusal", "REFUSAL_NO_STACK"],
  ["suppression exclusion", replaceOne('super("UNAVAILABLE", null, false, false);', 'super("UNAVAILABLE", null, true, false);'), "refusal", "REFUSAL_NO_SUPPRESSED"],
];
for (const [name, mutate, scenario, oracle] of mutations) {
  test(`compiled owned-key inventory omission refused: ${name}`, () => {
    const actual = readFileSync(source, "utf8");
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(healthy.stdout.trim(), `PASS ${scenario}`);
    const changed = mutate(actual); assert.notEqual(changed, actual);
    const path = mkdtempSync(join(tmpdir(), prefix + "mutant-"));
    try {
      const changedFile = join(path, "MessagePreviewOwnedKeyInventory.java");
      writeFileSync(changedFile, changed);
      compile(path, changedFile);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime oracle, not compilation/timeout/setup failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
