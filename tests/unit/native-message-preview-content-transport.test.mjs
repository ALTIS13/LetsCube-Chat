import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { messagePreviewStubs } from "../android/message-preview-stubs.fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const javaHome = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(javaHome, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const names = ["MessagePreviewVerificationState", "MessagePreviewResponseParser", "MessagePreviewVerificationRuntime", "MessagePreviewHttpTransport",
  "MessagePreviewContent", "MessagePreviewContentLookup"];
const paths = names.map(name => resolve(root, `android/app/src/main/java/com/kub/messenger/${name}.java`));
const probe = resolve(root, "tests/android/MessagePreviewContentTransportProbe.java");
let directory;
function clean(path) {
  assert.ok(realpathSync(path).startsWith(realpathSync(tmpdir()) + sep));
  assert.equal(realpathSync(path), resolve(path));
  rmSync(path, { recursive: true });
}
function compile(path, sources = paths) {
  const stubs = Object.entries(messagePreviewStubs).filter(([name]) => name.startsWith("org/json/")
    || name === "android/util/Base64.java").map(([name, text]) => {
    const file = join(path, "stubs", name); mkdirSync(resolve(file, ".."), { recursive: true }); writeFileSync(file, text); return file;
  });
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", path, ...sources, probe, ...stubs],
    { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
}
function run(scenario, path = directory) {
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewContentTransportProbe", scenario],
    { encoding: "utf8", timeout: 10_000, windowsHide: true });
  assert.equal(result.error, undefined); return result;
}
test.before(() => { directory = mkdtempSync(join(tmpdir(), "letscube-preview-content-")); compile(directory); });
test.after(() => { if (directory) clean(directory); });
const scenarios = ["fixed", "legacy-auth", "legacy-binding", "header-boundary", "integration",
  ...["device-null", "device-malformed", "device-uppercase", "notification-null", "notification-malformed", "notification-injection",
    "access-null", "access-empty", "access-crlf", "access-space", "access-unicode", "access-large", "key-null", "key-empty", "key-control", "key-large"].map(s => "invalid-" + s),
  ...["current", "multirow", "not-array", "not-object", "declared-limit", "declared-large", "stream-large", "utf8", "depth16", "depth17",
    "decode-error", "wrong-type", "missing-type", "json-type", "status-201", "status-301", "status-302", "status-307", "status-308", "status-401", "status-403", "status-429", "status-500"].map(s => "response-" + s),
  ...["expired", "negative", "short", "write", "headers", "read", "eof"].map(s => "deadline-" + s),
  ...["idle", "active", "successor", "busy"].map(s => "cancel-" + s)];
for (const scenario of scenarios) {
  test(`compiled actual content transport: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["fixed content endpoint", "https://core.letscube.ru/rest/v1/rpc/native_message_notification_preview",
    "https://core.letscube.ru/rest/v1/rpc/native_push_device_binding", "fixed", "CONTENT_FIXED_RPC"],
  ["exact notification argument", String.raw`\"p_notification_id\":\"`, String.raw`\"notification_id\":\"`, "fixed", "CONTENT_EXACT_BODY"],
  ["device UUID", "!MessagePreviewVerificationState.uuid(device)", "false", "invalid-device-malformed", "CONTENT_INVALID_device-malformed"],
  ["notification UUID", "!MessagePreviewVerificationState.uuid(notification)", "false", "invalid-notification-injection", "CONTENT_INVALID_notification-injection"],
  ["access bound", "MessagePreviewVerificationRuntime.header(access, 8192)", "MessagePreviewVerificationRuntime.header(access, 8193)", "invalid-access-large", "CONTENT_INVALID_access-large"],
  ["key bound", "MessagePreviewVerificationRuntime.header(key, 4096)", "MessagePreviewVerificationRuntime.header(key, 4097)", "invalid-key-large", "CONTENT_INVALID_key-large"],
  ["current rows retained", "return rows;\n    }\n    private Object exchange", "return new ArrayList<>();\n    }\n    private Object exchange", "response-current", "CONTENT_ROWS_FOR_PARENT_PARSER"],
  ["no redirect", "setInstanceFollowRedirects(false)", "setInstanceFollowRedirects(true)", "fixed", "CONTENT_NO_REDIRECT_CACHE"],
  ["status200 only", "connection.getResponseCode() != 200", "connection.getResponseCode() == -1", "response-status-302", "CONTENT_RESPONSE_REFUSAL_status-302"],
  ["declared byte cap", "connection.getContentLengthLong() > MAX_BODY", "false", "response-declared-large", "CONTENT_RESPONSE_REFUSAL_declared-large"],
  ["streamed byte cap", "output.size() + count > MAX_BODY", "false", "response-stream-large", "CONTENT_RESPONSE_REFUSAL_stream-large"],
  ["body cap literal", "MAX_BODY = 32_768", "MAX_BODY = 32_769", "response-stream-large", "CONTENT_RESPONSE_REFUSAL_stream-large"],
  ["strict UTF8", "onMalformedInput(CodingErrorAction.REPORT)", "onMalformedInput(CodingErrorAction.REPLACE)", "response-utf8", "CONTENT_RESPONSE_REFUSAL_utf8"],
  ["nesting16", "++depth > 16", "++depth > 17", "response-depth17", "CONTENT_RESPONSE_REFUSAL_depth17"],
  ["original deadline boundary", "left <= 0", "left < 0", "deadline-expired", "CONTENT_DEADLINE_BEFORE_OPEN"],
  ["negative deadline overflow", "deadline < 0 || ", "", "deadline-negative", "CONTENT_DEADLINE_BEFORE_OPEN"],
  ["IO timeout literal", "Math.min(2_000, left)", "Math.min(2_001, left)", "fixed", "CONTENT_TIMEOUT_LITERAL"],
  ["deadline after headers", "remaining(connection, deadline);\n            String type", "String type", "deadline-headers", "CONTENT_NO_INPUT_AFTER_EXPIRY"],
  ["cancelled buffered response", "active.get() != connection", "false", "cancel-successor", "CONTENT_CANCELLED_RESPONSE_REFUSED"],
  ["cancel disconnects now", "if (connection != null) connection.disconnect();", "if (connection != null) {}", "cancel-active", "CONTENT_CANCEL_DISCONNECT_NOW"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled literal transport omission killed: ${name}`, () => {
    const source = readFileSync(paths[3], "utf8");
    assert.equal(source.split(before).length, 2, "one exact actual-source mutation");
    const positive = run(scenario);
    assert.equal(positive.status, 0, positive.stderr);
    const path = mkdtempSync(join(tmpdir(), "letscube-preview-content-mutant-"));
    try {
      const changed = join(path, "MessagePreviewHttpTransport.java"); writeFileSync(changed, source.replace(before, after));
      compile(path, paths.map((file, n) => n === 3 ? changed : file));
      const result = run(scenario, path);
      assert.equal(result.status, 1, "compiled assertion failure, not setup/timeout");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
