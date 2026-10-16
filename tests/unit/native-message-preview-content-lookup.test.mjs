import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const home = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(home, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewContentLookup.java");
const content = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewContent.java");
const probe = resolve(root, "tests/android/MessagePreviewContentLookupProbe.java");
const fixture = resolve(root, "tests/android/MessagePreviewContentProbe.java");

function compile(directory, selected = source) {
    const compiled = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", directory,
      content, fixture, selected, probe], { encoding: "utf8", timeout: 30_000 });
    assert.equal(compiled.error, undefined); assert.equal(compiled.status, 0, compiled.stderr);
}
function run(directory, scenario) {
    const result = spawnSync(binary("java"), ["-cp", directory, "com.kub.messenger.MessagePreviewContentLookupProbe", scenario],
      { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined); return result;
}
function clean(directory) {
    assert.ok(realpathSync(directory).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(directory, { recursive: true });
}
let directory;
test.before(() => { directory = mkdtempSync(join(tmpdir(), "letscube-preview-lookup-")); compile(directory); });
test.after(() => { if (directory) clean(directory); });
const scenarios = ["current", "before-deadline", "held", "sink-error", "bad-request", "retired-before", "retired-during",
  "epoch-during", "card-during", "consent-during", "cancel-during", "close-during", "closed-before", "exact-deadline",
  "clock-rollback", "elapsed-rollback", "forward-expiry", "elapsed-expiry", "empty", "reader-error", "owner-error-before",
  "owner-error-after", "cancel-in-final-owner"];
for (const scenario of scenarios) {
  test(`compiled content lookup: ${scenario}`, () => {
    const result = run(directory, scenario); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `PASS ${scenario}`); assert.equal(result.stderr, "");
  });
}
const mutants = [
  ["owner recheck", "!owner.isCurrent(attempt.request)", "false", "epoch-during", "LOOKUP_REFUSED_epoch-during"],
  ["card generation recheck", "!owner.isCurrent(attempt.request)", "false", "card-during", "LOOKUP_REFUSED_card-during"],
  ["consent recheck", "!owner.isCurrent(attempt.request)", "false", "consent-during", "LOOKUP_REFUSED_consent-during"],
  ["deadline bound", "elapsed + 2_000", "elapsed + 2_001", "before-deadline", "EXACT_LOOKUP_REQUEST_DEADLINE"],
  ["deadline equality", "elapsed >= attempt.deadline", "elapsed > attempt.deadline", "exact-deadline", "LOOKUP_REFUSED_exact-deadline"],
  ["monotonic expiry", "Math.max(wall, attempt.wallStart + (elapsed - attempt.elapsedStart))", "wall", "elapsed-expiry", "LOOKUP_REFUSED_elapsed-expiry"],
  ["wall rollback", "wall < attempt.lastWall", "false", "clock-rollback", "LOOKUP_REFUSED_clock-rollback"],
  ["elapsed rollback", "elapsed < attempt.lastElapsed", "false", "elapsed-rollback", "LOOKUP_REFUSED_elapsed-rollback"],
  ["cancel fence", "active = null;\n        try { disconnect.run(); }", "try { disconnect.run(); }", "cancel-during", "LOOKUP_REFUSED_cancel-during"],
  ["ambiguous sink completion", "catch (RuntimeException unknown) { return Outcome.UNKNOWN; }", "catch (RuntimeException unknown) { return Outcome.REFUSED; }", "sink-error", "SINK_ERROR_IS_NOT_UNAPPLIED_CLAIM"],
];
for (const [name, before, after, scenario, oracle] of mutants) {
  test(`compiled lookup omission refused: ${name}`, () => {
    const original = readFileSync(source, "utf8"); assert.equal(original.split(before).length, 2, "one selected rule");
    const mutantDirectory = mkdtempSync(join(tmpdir(), "letscube-preview-lookup-mutant-"));
    try {
      const mutant = join(mutantDirectory, "MessagePreviewContentLookup.java");
      writeFileSync(mutant, original.replace(before, after)); compile(mutantDirectory, mutant);
      const result = run(mutantDirectory, scenario); assert.equal(result.status, 1, "compiled behavioral failure");
      assert.match(result.stderr, new RegExp(`java.lang.AssertionError: ${oracle}\\r?\\n`));
    } finally { clean(mutantDirectory); }
  });
}
