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
const sourcePath = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewVaultFence.java");
const boundsPath = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewVerificationState.java");
const probe = resolve(root, "tests/android/MessagePreviewVaultFenceProbe.java");
let directory;

function clean(path) {
  const actual = realpathSync(path);
  assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep));
  assert.equal(actual, resolve(path));
  rmSync(actual, { recursive: true });
}
function compile(path, source = sourcePath) {
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", path, boundsPath, source, probe], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
}
function run(scenario, path = directory) {
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewVaultFenceProbe", scenario], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  return result;
}
test.before(() => {
  assert.ok(existsSync(sourcePath), "FEATURE_ABSENCE: Task6A internal fence does not exist; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), "letscube-vault-fence-"));
  compile(directory);
});
test.after(() => { if (directory) clean(directory); });

const scenarios = [
  "inactive", "reserve", "stale-generation", "context", "context-epoch", "context-owner", "owner", "invalid-owner",
  "invalid-owner-erasure", "invalid-owner-lost-ack", "retire-clear", "retire-expiry", "retire-before-begin", "correlation", "foreign-successor",
  "duplicate-id", "late-completion", "late-refusal", "erasure-completion", "bounds", "syntax",
  "locked-cas", "bounded-identities", "generation-headroom", "intent-headroom",
];
for (const scenario of scenarios) {
  test(`compiled vault fence: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["generation CAS", "if (expectedGeneration != generation) return rejected(Decision.STALE_OWNER);", "", "stale-generation", "GENERATION_CAS"],
  ["vault high-water", "nextRevision <= vaultRevision", "false", "reserve", "INTENT_HIGH_WATER"],
  ["Task5 revision match", "left.revision == right.revision", "true", "context", "CAPTURED_CONTEXT"],
  ["Task5 epoch match", "left.epoch.equals(right.epoch)", "true", "context-epoch", "CONTEXT_EPOCH"],
  ["captured recipient", "left.recipient.equals(right.recipient)", "true", "context-owner", "CAPTURED_RECIPIENT"],
  ["captured session", "left.session.equals(right.session)", "true", "context-owner", "CAPTURED_SESSION"],
  ["captured account epoch", "left.accountEpoch == right.accountEpoch", "true", "context-owner", "CAPTURED_ACCOUNT_EPOCH"],
  ["owner recipient", "owner.recipient.equals(captured.recipient)", "true", "owner", "OWNER_RECIPIENT"],
  ["owner session", "owner.session.equals(captured.session)", "true", "owner", "OWNER_SESSION"],
  ["owner account epoch", "owner.accountEpoch == captured.accountEpoch", "true", "owner", "OWNER_ACCOUNT_EPOCH"],
  ["exact target before effects", "if (!direct && !correlated) return rejected(Decision.STALE_OWNER);", "", "foreign-successor", "FOREIGN_SUCCESSOR"],
  ["correlated operation ID", "current.operationId.equals(lost.operationId)", "true", "correlation", "CORRELATION_ID"],
  ["correlated intent", "current.vaultRevision == lost.vaultRevision", "true", "correlation", "CORRELATION_REVISION"],
  ["correlated base", "current.baseGeneration == expectedGeneration", "true", "correlation", "CORRELATION_BASE"],
  ["refused original BEGIN correlation", " || current.kind == Kind.REFUSED", "", "invalid-owner-lost-ack", "INVALID_OWNER_LOST_ACK_ERASURE"],
  ["explicit RETIRE cannot correlate", "current.kind == Kind.BEGIN || current.kind == Kind.REFUSED", "true", "invalid-owner-lost-ack", "RETIRE_NOT_BEGIN_CORRELATION"],
  ["late completion ownership fence", "current == operation && generation == operation.generation\n            && vaultRevision == operation.vaultRevision", "true", "late-completion", "LATE_COMPLETION"],
  ["late refusal identity", "if (!canContinue(operation) && !canErase(operation)) return false;\n        operation.closed = true;", "if (operation == null) return false;\n        current.closed = true;", "late-refusal", "LATE_REFUSAL"],
  ["context loss closes continuations", "sameContext(context, operation.context)", "true", "retire-expiry", "CONTEXT_LOSS_CONTINUATION"],
  ["malformed owner erasure reservation", "return new Admission(kind == Kind.REFUSED ? Decision.INVALID_OWNER : Decision.RESERVED, current);", "return new Admission(kind == Kind.REFUSED ? Decision.INVALID_OWNER : Decision.RESERVED, kind == Kind.REFUSED ? null : current);", "invalid-owner-erasure", "INVALID_OWNER_ERASURE_RESERVATION"],
  ["malformed owner cannot acquire", "operation.kind == Kind.BEGIN && sameContext(context, operation.context)", "true", "invalid-owner-erasure", "INVALID_OWNER_NO_ACCESS"],
  ["erasure independent of Task5 context", "(operation.kind == Kind.RETIRE || operation.kind == Kind.REFUSED)", "(operation.kind == Kind.RETIRE || operation.kind == Kind.REFUSED) && sameContext(context, operation.context)", "invalid-owner-erasure", "INVALID_OWNER_ERASURE_AFTER_CLEAR"],
  ["single completion", "operation.completed = true;", "", "late-completion", "ONE_COMPLETION"],
  ["immutable ID replay guard", "if (seenIds.contains(operationId)) return Decision.INVALID_REQUEST;", "", "duplicate-id", "DUPLICATE_ID"],
  ["safe number bound", "return MessagePreviewVerificationState.safe(value);", "return value >= 0;", "bounds", "UNSAFE_INTENT"],
  ["generation exhaustion", "if (generation == 9007199254740991L) return rejected(Decision.EXHAUSTED);", "", "bounds", "GENERATION_EXHAUSTION"],
  ["generation headroom omission", "if (kind != Kind.RETIRE && generation == 9007199254740990L) return rejected(Decision.EXHAUSTED);", "", "generation-headroom", "BEGIN_GENERATION_HEADROOM"],
  ["REFUSED generation headroom", "if (kind != Kind.RETIRE && generation == 9007199254740990L) return rejected(Decision.EXHAUSTED);", "if (kind == Kind.BEGIN && generation == 9007199254740990L) return rejected(Decision.EXHAUSTED);", "generation-headroom", "REFUSED_GENERATION_HEADROOM"],
  ["final generation allows RETIRE", "if (kind != Kind.RETIRE && generation == 9007199254740990L) return rejected(Decision.EXHAUSTED);", "if (generation == 9007199254740990L) return rejected(Decision.EXHAUSTED);", "generation-headroom", "FINAL_GENERATION_RETIRE_ALLOWED"],
  ["intent headroom omission", "if (kind != Kind.RETIRE && nextRevision == 9007199254740991L) return rejected(Decision.EXHAUSTED);", "", "intent-headroom", "BEGIN_INTENT_HEADROOM"],
  ["REFUSED intent headroom", "if (kind != Kind.RETIRE && nextRevision == 9007199254740991L) return rejected(Decision.EXHAUSTED);", "if (kind == Kind.BEGIN && nextRevision == 9007199254740991L) return rejected(Decision.EXHAUSTED);", "intent-headroom", "REFUSED_INTENT_HEADROOM"],
  ["final intent allows RETIRE", "if (kind != Kind.RETIRE && nextRevision == 9007199254740991L) return rejected(Decision.EXHAUSTED);", "if (nextRevision == 9007199254740991L) return rejected(Decision.EXHAUSTED);", "intent-headroom", "FINAL_INTENT_RETIRE_ALLOWED"],
  ["bounded identity admission", "if (seenIds.size() >= MAX_OPERATIONS - (kind == Kind.RETIRE ? 0 : 1)) return rejected(Decision.EXHAUSTED);", "", "bounded-identities", "IDENTITY_EXHAUSTION"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled vault fence omission refused: ${name}`, () => {
    const source = readFileSync(sourcePath, "utf8");
    assert.equal(source.split(before).length, 2, "one literal rule in actual new source");
    const healthy = run(scenario);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(healthy.stdout.trim(), `PASS ${scenario}`);
    const path = mkdtempSync(join(tmpdir(), "letscube-vault-fence-mutant-"));
    try {
      const changed = join(path, "MessagePreviewVaultFence.java");
      writeFileSync(changed, source.replace(before, after));
      compile(path, changed);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "compiled assertion failure, not compilation or timeout");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
