import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contract = resolve(root, "android/app/src/main/java/com/kub/messenger/ChatPushNotificationContract.java");
const probe = resolve(root, "tests/android/ChatPushPrivacyProbe.java");
const source = readFileSync(contract, "utf8").replaceAll("\r\n", "\n");
// Reuse an installed JDK without changing JAVA_HOME or PATH. Override for other hosts.
const javaHome = process.env.CHAT_PUSH_TEST_JDK ?? process.env.JAVA_HOME
  ?? (process.platform === "win32" ? "C:/Program Files/Android/Android Studio/jbr" : null);
const binary = (name) => javaHome
  ? resolve(javaHome, "bin", name + (process.platform === "win32" ? ".exe" : "")) : name;
const java = binary("java");
const javac = binary("javac");
let directory;

function compile(target, sourceFile = contract) {
  if (javaHome) {
    assert.ok(existsSync(javac) && existsSync(java), "use an existing JDK; this test never installs or changes it");
  }
  const result = spawnSync(javac, ["-encoding", "UTF-8", "-d", target, sourceFile, probe], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.error, undefined, "javac must execute");
  assert.equal(result.status, 0, result.stderr);
}

function run(name, target = directory) {
  const result = spawnSync(java, ["-cp", target, "com.kub.messenger.ChatPushPrivacyProbe", name], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.error, undefined, "the compiled Java probe must execute");
  return result;
}

function cleanup(target) {
  const actual = realpathSync(target);
  assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep), "cleanup remains inside this test's temporary directory");
  assert.ok(actual === resolve(target), "cleanup must not follow a redirected test directory");
  rmSync(actual, { recursive: true });
}

test.before(() => {
  directory = mkdtempSync(join(tmpdir(), "letscube-chat-push-privacy-"));
  compile(directory);
});
test.after(() => { if (directory) cleanup(directory); });

for (const [name, behavior] of [
  ["title", "v1 never displays provider sender/title"],
  ["body", "v1 never displays provider body"],
  ["fallback", "absent, blank, overlong and sensitive text retain valid routing"],
  ["private-fields", "returned Event contains no provider/account-private context"],
  ["route", "route and stable identity are derived only from validated UUIDs"],
  ["version", "future and malformed versions remain refused"],
  ["tag", "mismatched or absent tags remain refused"],
  ["group", "mismatched or absent group tags remain refused"],
  ["type", "non-message and malformed types remain refused"],
  ["chat-id", "malformed chat UUIDs remain refused"],
  ["message-id", "malformed message UUIDs remain refused"],
  ["reserved", "future versions stay reserved from legacy fallback"],
  ["null", "null data remains refused"],
]) {
  test(`compiled Android parser: ${behavior}`, () => {
    const result = run(name);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${name}`);
  });
}

const mutants = [
  ["restore provider title", '"LETSCUBE"', 'data.get("title")', "title", "TITLE_GENERIC"],
  ["restore provider body", String.raw`"\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435"`, 'data.get("body")', "body", "BODY_GENERIC"],
  ["omit version validation", ' || !"1".equals(data.get("native_chat_v"))', "", "version", "VERSION_REFUSED"],
  ["omit tag validation", '!tag.equals(data.get("tag"))', "false", "tag", "TAG_REFUSED"],
  ["omit group validation", '!tag.equals(data.get("group_tag"))', "false", "group", "GROUP_REFUSED"],
  ["omit type validation", ' || !"message".equals(data.get("type"))', "", "type", "TYPE_REFUSED"],
  ["omit chat UUID validation", "!isUuid(chatId)", "chatId == null", "chat-id", "CHAT_UUID_REFUSED"],
  ["omit message UUID validation", "!isUuid(messageId)", "messageId == null", "message-id", "MESSAGE_UUID_REFUSED"],
  ["restore display-required gate", "// v1 is a generic wake signal, not a recipient-authenticated preview.",
    'if (data.get("title") == null || data.get("body") == null) return null;', "fallback", "ROUTING_ACCEPTED"],
];

for (const [name, before, after, scenario, oracle] of mutants) {
  test(`compiled Android mutation refused: ${name}`, () => {
    assert.equal(source.split(before).length - 1, 1, "mutant must replace exactly one production rule");
    const target = mkdtempSync(join(tmpdir(), "letscube-chat-push-mutant-"));
    try {
      const mutated = join(target, "ChatPushNotificationContract.java");
      writeFileSync(mutated, source.replace(before, after));
      compile(target, mutated);
      const result = run(scenario, target);
      assert.equal(result.status, 1, "a compiled mutant must fail its behavior oracle");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`,
        "compilation, setup errors and timeouts do not count as killed mutations");
    } finally {
      cleanup(target);
    }
  });
}
