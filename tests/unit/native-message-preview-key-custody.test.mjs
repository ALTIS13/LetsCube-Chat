import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { custodyStubs } from "../android/message-preview-key-custody-stubs.fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = fileURLToPath(new URL("../../android/app/src/main/java/com/kub/messenger/MessagePreviewCredentialKeyCustody.java", import.meta.url));
const probe = resolve(root, "tests/android/MessagePreviewCredentialKeyCustodyProbe.java");
const java = "C:/Program Files/Android/Android Studio/jbr/bin/";
const dependencies = [
  ["MessagePreviewKeystoreReader", "D0B3C24E318BD1F393FD688F770F775C949CFD43D9DE3E3FFAD219BE8E7976F4"],
  ["MessagePreviewVaultFence", "0DFCC1664B9D513CB0E524A2EAADE4FA595DE5000429A2C6130BD59FE6FF853B"],
  ["MessagePreviewMetadataEnvelope", "EB1B585E237BFF3326B74185AEB1378E3082EA45F6E728FE917E74DE3A2F416B"],
  ["MessagePreviewJournalIO", "27C32B6F867216ED7E578E686D4F80B5362D7C09A0B0D62A3054ED0AE34066A5"],
  ["MessagePreviewVerificationState", "0B16484C9FCDF57A7F944660A2689CE22AB20D4DFC36B8804A0A68713F3BD73B"],
].map(([name, hash]) => [resolve(root, `android/app/src/main/java/com/kub/messenger/${name}.java`), hash]);
const reusedStubs = ["android/os/UserManager.java", "android/security/keystore/KeyInfo.java", "android/security/keystore/KeyProperties.java"]
  .map(path => resolve(root, "tests/fixtures/native-message-preview-keystore-reader", path));
const stubPins = ["3BA1A89656120A55B4CE2DEF8C9A6A9B51FAA35282585DA05D4D2F6167B3CCC1",
  "FB176C98708A84D48FB2405680F91B69BFEC8843758503FE3AA2B6FB16F850FC",
  "5015F7C9444EBB9E083848249A0CA7360A8AE86BEE2008335D4A923A28685F55"];
const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
function pins() {
  for (const [path, hash] of dependencies) assert.equal(digest(path), hash, "unchanged real dependency");
  reusedStubs.forEach((path, index) => assert.equal(digest(path), stubPins[index], "unchanged labeled API stub"));
}
let directory;
function clean(path) {
  const actual = realpathSync(path), parent = realpathSync(tmpdir());
  assert.equal(actual, resolve(path)); assert.equal(dirname(actual), parent);
  assert.ok(basename(actual).startsWith("letscube-key-custody-"));
  rmSync(actual, { recursive: true });
}
function compile(path, selected = source) {
  pins(); const written = [];
  for (const [name, contents] of Object.entries(custodyStubs)) {
    const file = join(path, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents); written.push(file);
  }
  const result = spawnSync(java + "javac.exe", ["-encoding", "UTF-8", "-g:none", "-d", path,
    ...written, ...reusedStubs, ...dependencies.map(([file]) => file), selected, probe], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, "compiler launched");
  assert.equal(result.status, 0, "compiler/setup failure is not behavioral RED");
  assert.equal(result.stdout, ""); assert.equal(result.stderr, "", "clean compiler output"); pins();
}
function run(scenario, path = directory) {
  const result = spawnSync(java + "java.exe", ["-cp", path, "com.kub.messenger.MessagePreviewCredentialKeyCustodyProbe", scenario], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.error, undefined, "finite child JVM completed"); return result;
}
function healthy(scenario) {
  const result = run(scenario); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), `PASS ${scenario}`);
}
test("credential key custody feature exists", () => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: inactive key custody port missing; not a shipped regression");
});
test.before(() => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE"); directory = mkdtempSync(join(tmpdir(), "letscube-key-custody-"));
  try { compile(directory); } catch (error) { clean(directory); directory = undefined; throw error; }
});
test.after(() => { if (directory) clean(directory); });
for (const scenario of ["create", "delete", "absent", "empty", "gate", "fence", "uid", "app-uid", "application",
  "protected", "locked", "unknown-user", "context-error", "deadline", "before-admission", "regression",
  "snapshot", "tamper", "missing-journal", "missing-metadata", "candidate", "foreign", "malformed-inventory",
  "duplicate", "null-alias", "long-alias", "overflow", "late-alias", "late-candidate", "late-gate-init",
  "late-context", "late-read", "late-metadata", "generate-refusal", "late-generate", "late-fence-generate",
  "late-deadline", "policy-readback", "generated-drift", "delete-present", "delete-unknown", "delete-gate",
  "delete-drift", "delete-successor", "held-generate", "held-delete", "held-context", "held-read",
  "head-operation", "head-revision", "head-generation", "head-phase", "head-installation", "predecessor-generation",
  "predecessor-alias", "predecessor-distinct", "negative-admission", "long-deadline", "zero-budget",
  "wrong-thread", "wrong-instance", "delete-pending", "delete-begin", "delete-refused", "late-untracked-candidate",
  "first-revision-zero", "negative-revision", "unsafe-revision", "constructor-shapes", "bounded-inventory",
  "delete-begin-context-loss", "late-clock-regression", "null-inventory", "inventory-exception", "delete-new-operation", "final-key-loss"])
  test(`actual key custody: ${scenario}`, () => healthy(scenario));

const mutations = [
  ["randomized creation", ".setRandomizedEncryptionRequired(true)", ".setRandomizedEncryptionRequired(false)", "create", "EXACT_CREATION_POLICY"],
  ["AES256 creation", ".setKeySize(256)", ".setKeySize(128)", "create", "EXACT_CREATION_POLICY"],
  ["GCM creation", ".setBlockModes(KeyProperties.BLOCK_MODE_GCM)", '.setBlockModes("CBC")', "create", "EXACT_CREATION_POLICY"],
  ["padding creation", ".setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)", '.setEncryptionPaddings("PKCS7Padding")', "create", "EXACT_CREATION_POLICY"],
  ["no per-use auth", ".setUserAuthenticationRequired(false)", ".setUserAuthenticationRequired(true)", "create", "EXACT_CREATION_POLICY"],
  ["exact creation alias", "new KeyGenParameterSpec.Builder(request.expectedHead.header.alias,", "new KeyGenParameterSpec.Builder(metadataAlias,", "create", "EXACT_CREATION_ALIAS"],
  ["exact purposes", "KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)", "KeyProperties.PURPOSE_ENCRYPT)", "create", "EXACT_CREATION_POLICY"],
  ["full prefix", "if (value.startsWith(OWNED_PREFIX))", "if (false)", "foreign", "REFUSAL_REQUIRED"],
  ["fresh snapshot equality", "require(equal(actual, r.expectedHead));", "", "snapshot", "REFUSAL_REQUIRED"],
  ["worker", "Thread.currentThread() == soleWorker", "true", "wrong-thread", "REFUSAL_REQUIRED"],
  ["UID", "require(uid == expectedUid && application instanceof Application);", "require(application instanceof Application);", "uid", "REFUSAL_REQUIRED"],
  ["deadline", "now < r.deadlineElapsedMillis", "true", "deadline", "REFUSAL_REQUIRED"],
  ["Gate", "gate.requireCurrent(r);", "", "gate", "REFUSAL_REQUIRED"],
  ["Fence continuation", "r.fence.canContinue(r.operation)", "true", "fence", "REFUSAL_REQUIRED"],
  ["held init full-prefix recheck", "beforeCreate(request, store); // Held init must not overwrite a newly present candidate/namespace.", "", "late-alias", "NO_KEY_MUTATION"],
  ["candidate absence", "require(!contains(r, store, r.expectedHead.header.alias));", "", "late-untracked-candidate", "REFUSAL_REQUIRED"],
  ["single use", "require(!r.consumed);", "", "delete", "ONE_USE"],
  ["operation binding", "h.operationId.equals(op.operationId)", "true", "head-operation", "REQUEST_BINDING_REFUSED"],
  ["predecessor exact alias", "require(h.alias.equals(p.alias));", "require(true);", "predecessor-alias", "REQUEST_BINDING_REFUSED"],
  ["new alias distinction", "!h.alias.equals(p.alias)", "true", "predecessor-distinct", "REQUEST_BINDING_REFUSED"],
  ["exact deletion", "store.deleteEntry(exactAlias);", "store.deleteEntry(metadataAlias);", "delete-unknown", "EXACT_DELETE_NO_REPAIR"],
  ["post entered generate Gate", "gate.requireCurrent(r);", "", "late-generate", "REFUSAL_REQUIRED"],
  ["post mutation authenticated snapshot", "require(equal(actual, r.expectedHead));", "", "generated-drift", "REFUSAL_REQUIRED"],
  ["nonregressing time", "now >= r.lastElapsed", "true", "late-clock-regression", "REFUSAL_REQUIRED"],
  ["inventory256", "require(count < 256);", "require(count < 257);", "overflow", "REFUSAL_REQUIRED"],
  ["alias256", "value.length() <= 256", "value.length() <= 257", "long-alias", "REFUSAL_REQUIRED"],
  ["duplicate inventory", "seen.add(value)", "true", "duplicate", "REFUSAL_REQUIRED"],
  ["confirmed absence paired guards",
    "if (!exactAlias.isEmpty()) require(!contains(request, store, exactAlias));\n            snapshot(request); inventory(request, store, null); platform(request);",
    "snapshot(request); inventory(request, store, exactAlias); platform(request);", "delete-present", "REFUSAL_REQUIRED"],
  ["final candidate presence", "require(contains(request, store, request.expectedHead.header.alias)); // Confirm alias survived the borrowed-handle readback.",
    "", "final-key-loss", "FINAL_KEY_ABSENCE_REFUSED"],
];
for (const [name, before, after, scenario, tag] of mutations) test(`compiled custody omission: ${name}`, () => {
  healthy(scenario); const contents = readFileSync(source, "utf8");
  assert.equal(contents.split(before).length, 2, "one actual literal rule");
  const path = mkdtempSync(join(tmpdir(), "letscube-key-custody-"));
  try {
    const changed = join(path, "MessagePreviewCredentialKeyCustody.java"); writeFileSync(changed, contents.replace(before, after));
    compile(path, changed); const result = run(scenario, path);
    assert.equal(result.status, 1, "compiled runtime assertion, not setup/timeout");
    assert.equal(result.stdout, ""); assert.equal(result.stderr.trim(), `FAIL ${tag}`);
  } finally { clean(path); }
});
