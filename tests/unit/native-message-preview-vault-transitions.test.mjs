import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transitionStubs } from "../fixtures/native-message-preview-vault-transitions/stubs.fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const home = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(home, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const base = resolve(root, "android/app/src/main/java/com/kub/messenger");
const source = join(base, "MessagePreviewPristineInitializer.java");
const names = ["MessagePreviewVerificationState", "MessagePreviewVaultFence", "MessagePreviewMetadataEnvelope",
  "MessagePreviewJournalIO", "MessagePreviewInstallationMarker", "MessagePreviewInitializationGate",
  "MessagePreviewOwnedKeyInventory", "MessagePreviewKeystoreReader", "MessagePreviewAtomicBackend"];
const prefix = "letscube-vault-transitions-";
let directory;
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path)); assert.equal(dirname(actual), realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix)); rmSync(actual, { recursive: true });
}
function compile(path, ownerSource = source) {
  const stubs = { ...transitionStubs };
  for (const name of ["KeyInfo", "KeyProperties"]) stubs[`android/security/keystore/${name}.java`] = readFileSync(
    resolve(root, "tests/fixtures/native-message-preview-keystore-reader/android/security/keystore", name + ".java"), "utf8");
  const files = Object.entries(stubs).map(([name, text]) => {
    const file = join(path, "stubs", name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  });
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-g:none", "-d", path, ...files,
    ...names.map(name => join(base, name + ".java")), ownerSource,
    resolve(root, "tests/android/MessagePreviewPristineInitializerProbe.java"),
    resolve(root, "tests/android/MessagePreviewVaultTransitionsProbe.java")],
  { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
}
function run(scenario, path = directory, probe = "MessagePreviewVaultTransitionsProbe") {
  const files = mkdtempSync(join(tmpdir(), prefix + "files-"));
  try {
    const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger." + probe, scenario, files],
      { encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true });
    assert.equal(result.error, undefined); return result;
  } finally { clean(files); }
}
test.before(() => { directory = mkdtempSync(join(tmpdir(), prefix + "classes-")); compile(directory); });
test.after(() => { if (directory) clean(directory); });
for (const scenario of ["positive", "refusals", "malformed", "uninitialized", "unknown-final", "readback-failure",
  "predecessor-mismatch", "corrupt-predecessor", "missing-key", "generation-exhausted", "ledger-exhausted",
  "observation-mismatch", "lost-callback", "held-finish", "held-read", "held-context", "held-kernel-auth", "held-final-context", "close-held",
  "start-failure", "write-failure", "flush-failure", "sync-failure", "finish-failure", "empty-start-failure",
  "deadline-return", "clock-backward", "locked-return", "foreground-retired", "final-deadline", "old-cancel", "held-init-final"]) {
  test(`actual transition: ${scenario}`, () => {
    const result = run(scenario); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

for (const scenario of ["healthy", "wrong-g0"]) {
  test(`affected initialization handoff: ${scenario}`, () => {
    const result = run(scenario, directory, "MessagePreviewPristineInitializerProbe");
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const initHeaderGuard = `        if (!installation.equals(h.installation) || h.generation != 0 || h.kind != MessagePreviewMetadataEnvelope.Kind.EMPTY
            || !h.alias.isEmpty() || h.expiresWallMillis != 0 || h.wallHighWaterMillis != wall
            || !h.operationId.isEmpty() || h.baseGeneration != 0 || h.vaultRevision != 0
            || readback.credentialBytes().length != 0) throw new Unavailable();`;
const mutations = [
  ["kernel preauth currency", "try { if (work != null) transitionCurrent(work); }", "try { }",
    "held-kernel-auth", "NO_FIRST_EFFECT_AFTER_HELD_AUTH"],
  ["syntax before CAS", "|| !MessagePreviewVerificationState.safe(expectedGeneration)", "",
    "malformed", "MALFORMED_SYNTAX_BEFORE_CAS"],
  ["complete predecessor", "if (!sameHeader(predecessor.header, work.target.predecessor.header)\n            || !Arrays.equals",
    "if (!Arrays.equals", "predecessor-mismatch", "FULL_PREDECESSOR_MATCH_BEFORE_EFFECTS"],
  ["exact observed header", "if (!sameHeader(readback.header, work.target.expectedFinal) || readback.credentialBytes().length != 0)",
    "if (readback.credentialBytes().length != 0)", "observation-mismatch", "OBSERVATION_EXACT_OPERATION_REQUIRED"],
  ["cancel currency", "|| work.cancelled", "", "held-final-context", "NO_CANCELLED_FINAL_ACK"],
  ["busy through cancel", "synchronized void cancelRetirement(String operationId) {\n        if (activeTransition != null && activeTransition.target.operation.operationId.equals(operationId))\n            activeTransition.cancelled=true;",
    "synchronized void cancelRetirement(String operationId) {\n        if (activeTransition != null && activeTransition.target.operation.operationId.equals(operationId))\n            activeTransition.cancelled=true; busy=false;", "held-final-context", "FINAL_READ_BUSY_RETAINED"],
  ["old cancel successor fence", "activeTransition.target.operation.operationId.equals(operationId)", "true",
    "old-cancel", "OLD_CANCEL_CANNOT_RETIRE_SUCCESSOR"],
  ["deadline boundary", "now >= work.deadline", "now > work.deadline", "deadline-return", "FRESH_PLATFORM_RETURN_REQUIRED"],
  ["monotonic return", "|| now < work.state.lastMillis", "", "clock-backward", "FRESH_PLATFORM_RETURN_REQUIRED"],
  ["checked head before callback", "work.state.checkedHead=readback;", "", "positive", "CHECKED_G2_ACK"],
  ["final publication currency", "transitionMemory(work, now);\n                if (!work.target.completed", "if (!work.target.completed",
    "final-deadline", "FRESH_FINAL_PUBLICATION_REQUIRED"],
  ["stop after unavailable write", "if (work.state.journal.write(bytes, work.state.installation, key) != MessagePreviewJournalIO.Result.CHECKED)\n            throw new Unavailable();",
    "work.state.journal.write(bytes, work.state.installation, key);", "start-failure", "NO_AUTOMATIC_EXECUTE_REPLAY"],
  ["no premature initialized state", "Prepared prepared=initialize(attempt.permit);\n                current(attempt.permit);",
    "Prepared prepared=initialize(attempt.permit);\n                initialized=new InitializedState(prepared);\n                current(attempt.permit);",
    "held-init-final", "NO_STATE_BEFORE_FINAL_INIT_SUCCESS"],
  ["authenticated literal G0", initHeaderGuard, "", "wrong-g0", "CURRENT_COMPOSITION_REFUSED", "MessagePreviewPristineInitializerProbe"],
];
for (const [name, before, after, scenario, oracle, probe = "MessagePreviewVaultTransitionsProbe"] of mutations) {
  test(`compiled transition omission: ${name}`, () => {
    const actual = readFileSync(source, "utf8").replaceAll("\r\n", "\n");
    assert.equal(actual.split(before).length, 2, "exact unique current production rule");
    const control = run(scenario, directory, probe);
    assert.equal(control.status, 0, control.stderr); assert.equal(control.stderr, "");
    assert.equal(control.stdout.trim(), `PASS ${scenario}`);
    const path = mkdtempSync(join(tmpdir(), prefix + "mutant-"));
    try {
      const changed = join(path, basename(source)); writeFileSync(changed, actual.replace(before, after)); compile(path, changed);
      const result = run(scenario, path, probe);
      assert.equal(result.status, 1, "compiled runtime assertion, not timeout/compile/setup failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
