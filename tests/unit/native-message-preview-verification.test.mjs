import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { messagePreviewStubs } from "../android/message-preview-stubs.fixture.mjs";
import { foregroundCompositionStubs, foregroundCompositionSourceNames } from "../android/message-preview-genuine-composition.fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const javaHome = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(javaHome, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const names = ["MessagePreviewVerificationState", "MessagePreviewResponseParser", "MessagePreviewVerificationRuntime", "MessagePreviewHttpTransport", "MessagePreviewsPlugin"];
names.push(...foregroundCompositionSourceNames.filter(name => !names.includes(name)));
const paths = names.map(name => resolve(root, `android/app/src/main/java/com/kub/messenger/${name}.java`));
const probe = resolve(root, "tests/android/MessagePreviewVerificationProbe.java");
const bridgeProbe = resolve(root, "tests/android/MessagePreviewBridgeProbe.java");
let directory;
function clean(path) {
  assert.ok(realpathSync(path).startsWith(realpathSync(tmpdir()) + sep));
  assert.equal(realpathSync(path), resolve(path));
  rmSync(path, { recursive: true });
}
function compile(path, sources = paths) {
  const stubs = Object.entries({ ...foregroundCompositionStubs,
    "android/os/SystemClock.java": messagePreviewStubs["android/os/SystemClock.java"] }).map(([name, text]) => {
    const file = join(path, "stubs", name); mkdirSync(resolve(file, ".."), { recursive: true }); writeFileSync(file, text); return file;
  });
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", path, ...sources, probe, bridgeProbe, ...stubs], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
}
function run(name, path = directory, bridge = false) {
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger." + (bridge ? "MessagePreviewBridgeProbe" : "MessagePreviewVerificationProbe"), name], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined); return result;
}
for (const scenario of ["transport-normal", "transport-resolver", "transport-redirect", "transport-declared-large", "transport-stream-large", "transport-depth", "transport-utf8", "transport-deadline", "jwt-normal", "jwt-none", "jwt-malformed", "jwt-padded", "plugin-normal", "plugin-malformed", "plugin-timeout", "plugin-logging", "plugin-logging-verify"]) {
  test(`compiled preview bridge/I/O: ${scenario}`, () => {
    const result = run(scenario, directory, true); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}
for (const kind of ["missing", "string", "fractional", "negative", "unsafe"]) {
  for (const stale of [false, true]) {
    const scenario = `plugin-begin-${stale ? "stale-" : ""}${kind}`;
    test(`compiled preview malformed-account retirement: ${scenario}`, () => {
      const result = run(scenario, directory, true); assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), `PASS ${scenario}`);
    });
  }
}
test.before(() => { directory = mkdtempSync(join(tmpdir(), "letscube-preview-verification-")); compile(directory); });
test.after(() => { if (directory) clean(directory); });
for (const scenario of ["normal", "revisions", "late-auth", "late-resolver", "late-destroy", "held",
  "expiry-ttl", "expiry-jwt", "expiry-rollback", "expiry-monotonic-back", "expiry-rollback-high-water", "pending-cancel", "completion-orders", "safe-numbers", "second-sdk-missing", "auth-error", "resolver-error", "header", "role", "anonymous", "claims-owner", "claims-session", "expired", "issuer", "audience", "private-key",
  "auth-owner", "auth-anonymous", "sdk-change", "sdk-empty", "sdk-edge", "sdk-large", "empty-row", "multirow", "wrong-owner", "wrong-session", "wrong-device", "version", "string-version", "extra-field", "deadline", "expired-after-auth", "tuple-epoch", "tuple-session", "ticket"]) {
  test(`compiled preview verification: ${scenario}`, () => {
    const result = run(scenario); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["revision high-water", 0, "if (!safe(next) || next <= revision) return null;", "if (!safe(next)) return null;", "revisions", "STALE_BEGIN"],
  ["ticket match", 0, " || !ticket.epoch.equals(epoch)", "", "ticket", "TICKET_FENCE"],
  ["account epoch", 0, " || ticket.accountEpoch != accountEpoch", "", "tuple-epoch", "ACCOUNT_EPOCH_FENCE"],
  ["recipient getter", 0, " && current.user.equals(expectedRecipientId)", "", "normal", "GETTER_EXPECTED_RECIPIENT"],
  ["wall high-water", 0, "lastWall = Math.max(clock.wallTime(), lastWall + advance);", "lastWall = clock.wallTime();", "expiry-rollback-high-water", "EXPIRY_BOTH_CLOCKS"],
  ["verified TTL", 0, "MAX_VERIFIED_MS = 15_000", "MAX_VERIFIED_MS = 16_000", "expiry-ttl", "EXPIRY_BOTH_CLOCKS"],
  ["verification deadline", 0, "VERIFY_MS = 8_000", "VERIFY_MS = 9_000", "deadline", "REFUSAL_deadline"],
  ["pre-start cancellation", 0, "(current.device != null && !current.device.equals(device))", "!device.equals(current.device)", "pending-cancel", "CANCEL_BEFORE_WORKER_START"],
  ["auth user authority", 2, "!MessagePreviewResponseParser.authUser(auth, user)", "false", "auth-owner", "REFUSAL_auth-owner"],
  ["live resolver authority", 2, "!MessagePreviewResponseParser.binding(response, user, session, device)", "false", "wrong-device", "REFUSAL_wrong-device"],
  ["second SDK token", 2, "!first.equals(second)", "false", "sdk-change", "REFUSAL_sdk-change"],
  ["four-key row", 1, "row.size() == 4", "true", "extra-field", "REFUSAL_extra-field"],
  ["version 1", 1, "((Number) version).doubleValue() == 1d", "true", "version", "REFUSAL_version"],
  ["closed capability", 4, '.put("protocol", 0)', '.put("protocol", 1)', "plugin-normal", "CAPABILITIES_CLOSED_LITERAL", true],
  ["begin logger gate", 4, 'if (!loggingOff()) { if (runtime != null) runtime.retire(); call.resolve(new JSObject().put("epoch", JSONObject.NULL)); return; }', "", "plugin-logging", "LOGGER_BEGIN_RETIRES_AND_REFUSES", true],
  ["malformed newer begin retirement", 4, "runtime == null || revision == null ? null", "runtime == null || revision == null || account == null ? null", "plugin-begin-missing", "MALFORMED_NEWER_BEGIN_RETIRES", true],
  ["verify logger gate", 4, 'if (!loggingOff()) { if (runtime != null) runtime.retire(); verified(call, false); return; }', "", "plugin-logging-verify", "PLUGIN_VERIFIED_ACK", true],
  ["body size", 3, "output.size() + count > MAX_BODY", "false", "transport-stream-large", "TRANSPORT_REFUSAL_stream-large", true],
  ["redirect refusal", 3, "setInstanceFollowRedirects(false)", "setInstanceFollowRedirects(true)", "transport-normal", "ONE_FIXED_REQUEST_NO_REDIRECT", true],
  ["credential retirement", 4, 'call.getData().remove("accessToken"); call.getData().remove("publicApiKey");', "", "plugin-normal", "CALL_DROPS_CREDENTIALS", true],
];
for (const [name, index, before, after, scenario, oracle, bridge = false] of mutations) {
  test(`compiled preview omission refused: ${name}`, () => {
    const source = readFileSync(paths[index], "utf8");
    assert.equal(source.split(before).length, 2, "replace exactly one actual production rule");
    const positive = run(scenario, directory, bridge);
    assert.equal(positive.status, 0, positive.stderr);
    const path = mkdtempSync(join(tmpdir(), "letscube-preview-mutant-"));
    try {
      const changed = join(path, names[index] + ".java"); writeFileSync(changed, source.replace(before, after));
      compile(path, paths.map((file, n) => n === index ? changed : file));
      const result = run(scenario, path, bridge);
      assert.equal(result.status, 1, "compiled behavioral failure, not setup/timeout");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
