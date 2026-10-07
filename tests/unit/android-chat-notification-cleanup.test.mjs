import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { nativeChatStubs } from "../android/native-chat-stubs.fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const nativeRoot = resolve(root, "android/app/src/main/java/com/kub/messenger");
const files = ["ChatNotificationCleanup.java", "ChatNotificationIntentStore.java", "ChatNotificationsPlugin.java", "ChatPushNotifications.java", "ChatPushNotificationContract.java"];
const sources = Object.fromEntries(files.map(file => [file, readFileSync(resolve(nativeRoot, file), "utf8").replaceAll("\r\n", "\n")]));
const home = process.env.CHAT_PUSH_TEST_JDK ?? process.env.JAVA_HOME
  ?? (process.platform === "win32" ? "C:/Program Files/Android/Android Studio/jbr" : null);
const binary = name => home ? resolve(home, "bin", name + (process.platform === "win32" ? ".exe" : "")) : name;
let directory;
function compile(target, changed = {}) {
  const paths = [];
  for (const [file, source] of Object.entries(nativeChatStubs)) {
    const path = join(target, "src", file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source); paths.push(path);
  }
  for (const file of files) {
    const path = join(target, "src", "com/kub/messenger", file); writeFileSync(path, changed[file] ?? sources[file]); paths.push(path);
  }
  paths.push(resolve(root, "tests/android/ChatNotificationCleanupProbe.java"));
  if (home) assert.ok(existsSync(binary("javac")) && existsSync(binary("java")), "reuse existing JBR only");
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-d", target, ...paths], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
}
function run(scenario, target = directory) {
  const result = spawnSync(binary("java"), ["-cp", target, "com.kub.messenger.ChatNotificationCleanupProbe", scenario], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined); return result;
}
function cleanup(target) {
  const actual = realpathSync(target);
  assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep) && actual === resolve(target));
  rmSync(actual, { recursive: true });
}
test.before(() => { directory = mkdtempSync(join(tmpdir(), "letscube-chat-cleanup-")); compile(directory); });
test.after(() => { if (directory) cleanup(directory); });
for (const scenario of ["read", "newer", "wrong-message", "missing-id", "legacy", "summary", "voice", "wrong-chat", "wrong-id",
  "invalid-read", "retry", "retired", "stale-binding", "logout", "replace-serialized", "retire-during-take",
  "producer-read", "producer-newer", "producer-missing", "producer-malformed", "producer-serialized", "producer-os-queued", "producer-os-missing",
  "producer-process-restart", "producer-write-failed", "producer-write-failed-same-message", "producer-rotation-read-failed", "wire-read", "wire-fractional", "wire-reload",
  "pending-read", "pending-unread", "pending-after-flush", "pending-missing", "pending-replaced", "pending-retired", "pending-voice",
  "pending-wrong-message", "pending-wrong-notification", "pending-unowned", "pending-generic-old", "pending-retire-snapshot"]) {
  test(`compiled native cleanup: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const mutations = [
  ["ChatNotificationCleanup.java", "return new Result(0, true);", "return Result.SETTLED;", "pending-read", "EXACT_QUEUED_READ_PENDING"],
  ["ChatNotificationCleanup.java", "posted.notificationId.equals(receipt.notificationId)", "true", "pending-wrong-notification", "NON_PENDING_TERMINAL"],
  ["ChatNotificationCleanup.java", " && posted.messageId.equals(receipt.messageId)", "", "pending-wrong-message", "NON_PENDING_TERMINAL"],
  ["ChatNotificationCleanup.java", "if (card.protocol != 1 || card.summary || !chatId.equals(card.chatId) || !isUuid(card.notificationId) || !isUuid(card.messageId)) {\n                    continue;",
    "if (card.protocol != 1 || card.summary || !chatId.equals(card.chatId) || !isUuid(card.notificationId) || !isUuid(card.messageId)) {\n                    return Result.SETTLED;", "pending-generic-old", "EXACT_QUEUED_READ_PENDING"],
  ["ChatNotificationCleanup.java", "if (owner == expected && posted != null", "if (posted != null", "pending-retire-snapshot", "NON_PENDING_TERMINAL"],
  ["ChatNotificationsPlugin.java", '.put("pending", result.pending)', '.put("pending", false)', "pending-read", "EXACT_QUEUED_READ_PENDING"],
  ["ChatNotificationCleanup.java", "synchronized (CARDS) {\n            Posted previous", "{\n            Posted previous", "replace-serialized", "REPLACEMENT_RETAINED"],
  ["ChatNotificationCleanup.java", "card.notificationId.equals(receipt.notificationId)", "true", "newer", "NEWER_RETAINED"],
  ["ChatNotificationCleanup.java", " && card.messageId.equals(receipt.messageId)", "", "wrong-message", "WRONG_MESSAGE_RETAINED"],
  ["ChatNotificationCleanup.java", "card.protocol != 1 || ", "", "legacy", "LEGACY_RETAINED"],
  ["ChatNotificationCleanup.java", " || card.summary", "", "summary", "SUMMARY_RETAINED"],
  ["ChatNotificationCleanup.java", " || !tag.equals(card.tag)", "", "voice", "VOICE_RETAINED"],
  ["ChatNotificationCleanup.java", "!chatId.equals(card.chatId)", "false", "wrong-chat", "WRONG_CHAT_RETAINED"],
  ["ChatNotificationCleanup.java", "card.id != 0 || ", "", "wrong-id", "WRONG_ID_RETAINED"],
  ["ChatNotificationCleanup.java", "expected == null || owner != expected", "expected == null", "retired", "RETIRED_BEFORE_SNAPSHOT"],
  ["ChatNotificationCleanup.java", "read && owner == expected", "read", "retire-during-take", "RETIRED_DURING_SNAPSHOT"],
  ["ChatNotificationCleanup.java", " || nextRevision < revision", "", "stale-binding", "STALE_BINDING_REFUSED"],
  ["ChatPushNotifications.java", "cleanup.putString(ChatNotificationCleanup.EXTRA_NOTIFICATION, notificationId);", "", "producer-read", "CONFIRMED_PRODUCER_CARD_REMOVED"],
  ["ChatPushNotifications.java", "notification.extras.putLong(ChatNotificationCleanup.EXTRA_GENERATION, generation);", "", "producer-read", "CONFIRMED_PRODUCER_CARD_REMOVED"],
  ["ChatPushNotifications.java", "boolean tracked = ChatNotificationCleanup.post", "notification.contentIntent = PendingIntent.getActivity(context, event.chatId.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);\n        boolean tracked = ChatNotificationCleanup.post",
    "producer-write-failed-same-message", "OLD_TAP_RETAINED"],
  ["ChatPushNotifications.java", "if (!tracked) {", "if (false) {", "producer-write-failed", "UNTRACKED_GENERIC_DELIVERED"],
  ["ChatPushNotifications.java", "notification.extras.remove(key);", "", "producer-write-failed", "UNTRACKED_WITHOUT_AUTHORITY"],
  ["ChatPushNotifications.java", ' + "/untracked/" + nonce', "", "producer-write-failed", "UNTRACKED_EXACT_DISTINCT_TAP"],
  ["ChatPushNotifications.java", 'String fallbackTag = event.tag + ":untracked:" + nonce;', "String fallbackTag = event.tag;", "producer-write-failed", "UNPERSISTED_CARD_NOT_POSTED"],
  ["ChatPushNotifications.java", "ChatNotificationCleanup.isUuid(notificationCandidate) ? notificationCandidate : null", "notificationCandidate", "producer-malformed", "NON_UUID_NOT_PERSISTED"],
  ["ChatNotificationCleanup.java", "if (!matchesLatest(card, cards.intents())) continue;", "", "producer-os-queued", "OS_QUEUED_REPLACEMENT_RETAINED"],
  ["ChatNotificationCleanup.java", "posted = intents.read(tag);", "posted = null;", "producer-process-restart", "COLD_OWN_CARD_REMOVED"],
  ["ChatNotificationCleanup.java", "revision = 0;", "revision = 0; latestPosts.clear();", "producer-rotation-read-failed", "CONFIRMED_PRODUCER_CARD_REMOVED"],
  ["ChatNotificationCleanup.java", "if (!matchesLatest(card, cards.intents())) continue;", "", "producer-os-missing", "OS_MISSING_INTENT_RETAINED"],
  ["ChatNotificationCleanup.java", "if (!intents.write(tag, intent)) return false;", "intents.write(tag, intent);", "producer-write-failed", "UNPERSISTED_CARD_NOT_POSTED"],
  ["ChatNotificationIntentStore.java", 'return preferences.edit().putString(tag + ":notification", intent.notificationId)\n                .putString(tag + ":message", intent.messageId).putLong(tag + ":generation", intent.generation).commit();',
    "return true;", "producer-process-restart", "COLD_OWN_CARD_REMOVED"],
  ["ChatNotificationsPlugin.java", "number == Math.rint(number)", "true", "wire-fractional", "FRACTIONAL_REFUSED"],
  ["ChatNotificationsPlugin.java", "instanceId = UUID.randomUUID().toString();\n        ChatNotificationCleanup.activate(instanceId);", "", "wire-reload", "DOCUMENT_LEASE_RETIRED"],
];
for (const [file, before, after, scenario, oracle] of mutations) {
  test(`compiled cleanup mutation: ${scenario} / ${before}`, () => {
    assert.equal(sources[file].split(before).length - 1, 1);
    const target = mkdtempSync(join(tmpdir(), "letscube-chat-cleanup-mutant-"));
    try {
      compile(target, { [file]: sources[file].replace(before, after) });
      const result = run(scenario, target);
      assert.equal(result.status, 1, "a compiled behavioral failure, not a setup error, kills a mutant");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { cleanup(target); }
  });
}
