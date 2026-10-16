import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const home = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(home, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewContent.java");
const probe = resolve(root, "tests/android/MessagePreviewContentProbe.java");

function compile(directory, selected = source) {
    const compiled = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", directory,
      ...(existsSync(selected) ? [selected] : []), probe], { encoding: "utf8", timeout: 30_000 });
    assert.equal(compiled.error, undefined);
    assert.equal(compiled.status, 0, compiled.stderr);
}
function run(directory, scenario) {
    const result = spawnSync(binary("java"), ["-cp", directory, "com.kub.messenger.MessagePreviewContentProbe", scenario],
      { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    return result;
}
function clean(directory) {
    assert.ok(realpathSync(directory).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(directory, { recursive: true });
}
let directory;
test.before(() => { directory = mkdtempSync(join(tmpdir(), "letscube-preview-content-")); compile(directory); });
test.after(() => { if (directory) clean(directory); });
const scenarios = ["current", "sender", "unicode", "offset-fraction", "bad-date", "bad-hour", "bad-offset", "empty", "multiple", "object", "null", "extra", "missing",
  "string-version", "version", "owner", "session", "device", "notification", "chat", "message", "none", "unknown-level",
  "sender-escalation", "sender-leak", "title-mismatch", "title-long", "body-long", "body-empty", "body-type", "body-leading",
  "body-control", "body-bidi", "body-surrogate", "body-line", "expired", "long-expiry", "bad-expiry", "no-offset", "unsafe-clock"];
for (const scenario of scenarios) {
  test(`compiled recipient content: ${scenario}`, () => {
    const result = run(directory, scenario);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}
const mutants = [
  ["recipient ownership", '!recipient.equals(row.get("recipient_id"))', "false", "owner"],
  ["session ownership", '!session.equals(row.get("session_id"))', "false", "session"],
  ["device ownership", '!device.equals(row.get("device_id"))', "false", "device"],
  ["notification identity", '!notification.equals(row.get("notification_id"))', "false", "notification"],
  ["chat identity", '!chat.equals(row.get("chat_id"))', "false", "chat"],
  ["message identity", '!message.equals(row.get("message_id"))', "false", "message"],
  ["expiry bound", "now + 15_000", "now + 15_001", "long-expiry"],
  ["title bound", "displayText(title, 96)", "displayText(title, 97)", "title-long"],
  ["body bound", "displayText(body, 240)", "displayText(body, 241)", "body-long"],
  ["sender redaction", '|| ("sender".equals(level) && !GENERIC.equals(body))', "", "sender-leak"],
  ["consent ceiling", '|| ("sender".equals(maximumLevel) && !"sender".equals(level))', "", "sender-escalation"],
];
for (const [name, before, after, scenario] of mutants) {
  test(`compiled content omission refused: ${name}`, () => {
    const original = readFileSync(source, "utf8");
    assert.equal(original.split(before).length, 2, "one selected production rule");
    const mutantDirectory = mkdtempSync(join(tmpdir(), "letscube-preview-content-mutant-"));
    try {
      const mutant = join(mutantDirectory, "MessagePreviewContent.java");
      writeFileSync(mutant, original.replace(before, after)); compile(mutantDirectory, mutant);
      const result = run(mutantDirectory, scenario);
      assert.equal(result.status, 1, "compiled behavioral refusal, not setup/timeout");
      assert.match(result.stderr, new RegExp(`java.lang.AssertionError: REFUSED_${scenario}\\r?\\n`));
    } finally { clean(mutantDirectory); }
  });
}
