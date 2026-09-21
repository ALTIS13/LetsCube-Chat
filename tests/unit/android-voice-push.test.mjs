import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const java = "android/app/src/main/java/com/kub/messenger/";
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

test("native voice receiver replaces only the Capacitor messaging service", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /<service\s+android:name="com\.capacitorjs\.plugins\.pushnotifications\.MessagingService"\s+tools:node="remove"\s*\/>/);
  assert.match(manifest, /<service\s+android:name="\.VoiceCallMessagingService"\s+android:exported="false">/);
  assert.equal((manifest.match(/com.google.firebase.MESSAGING_EVENT/g) ?? []).length, 1);
  assert.doesNotMatch(manifest, /USE_FULL_SCREEN_INTENT|SCHEDULE_EXACT_ALARM|FOREGROUND_SERVICE/);
});

test("voice plugin is registered before Capacitor creation and intercepts voice intents", () => {
  const source = strip(read(`${java}MainActivity.java`));
  assert.ok(source.indexOf("registerPlugin(VoiceCallsPlugin.class)") >= 0);
  assert.ok(source.indexOf("registerPlugin(VoiceCallsPlugin.class)") < source.indexOf("super.onCreate(savedInstanceState)"));
  assert.match(source, /VoiceCallRuntime\.isVoiceIntent\(intent\)/);
  assert.match(source, /captureIntent\(intent\)/);
});

test("native implementation and executable pure Java tests are present", () => {
  for (const file of ["VoiceCallNotificationContract", "VoiceCallState", "VoiceCallRuntime", "VoiceCallsPlugin", "VoiceCallMessagingService"]) {
    assert.ok(existsSync(new URL(`${java}${file}.java`, root)), file);
  }
  const receiver = strip(read(`${java}VoiceCallMessagingService.java`));
  assert.match(receiver, /extends MessagingService/);
  assert.match(receiver, /super\.onMessageReceived\(message\)/);
  assert.doesNotMatch(receiver, /onNewToken\s*\(/);
  assert.ok(existsSync(new URL("android/app/src/test/java/com/kub/messenger/VoiceCallStateTest.java", root)));
});
