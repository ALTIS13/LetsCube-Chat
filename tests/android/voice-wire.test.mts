import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { delimiter, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildVoiceFcmMessage } from "../../supabase/functions/send-push-notifications/voice-payload.ts";

const now = 1_800_000_000_000;
const input = {
  event: "ring", chat_id: "33333333-3333-4333-8333-333333333333",
  channel_id: "44444444-4444-4444-8444-444444444444",
  caller_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  recipient_id: "11111111-1111-4111-8111-111111111111",
  recipient_session_id: "22222222-2222-4222-8222-222222222222",
  ring_started_at: now, expires_at: now + 45_000,
};

test("actual Edge-built ring/cancel data round-trips through Android's compiled Java parser", () => {
  const javaHome = process.env.JAVA_HOME;
  assert.ok(javaHome, "JAVA_HOME must already point to a JDK; this test never changes it");
  const java = resolve(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  const javac = resolve(javaHome, "bin", process.platform === "win32" ? "javac.exe" : "javac");
  assert.ok(existsSync(javac), "a configured JDK is required for Android contract verification");
  const contract = resolve("android/app/src/main/java/com/kub/messenger/VoiceCallNotificationContract.java");
  assert.ok(existsSync(contract), "Android must implement the shared wire contract");
  const output = resolve("output");
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(resolve(output, "voice-wire-"));
  try {
    const compiled = spawnSync(javac, ["-encoding", "UTF-8", "-d", directory, contract, resolve("tests/android/VoiceCallWireProbe.java")], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ring = buildVoiceFcmMessage(input, "fixture-transport", now)?.message.data;
    const cancel = buildVoiceFcmMessage({ ...input, event: "cancel" }, "fixture-transport", now)?.message.data;
    assert.ok(ring);
    assert.ok(cancel);
    const cases: Array<{ data: Record<string, string>; at: number; accept: boolean }> = [
      { data: ring, at: now, accept: true },
      { data: cancel, at: now, accept: true },
      { data: ring, at: now + 44_999, accept: true },
      { data: ring, at: now + 45_000, accept: false },
      { data: ring, at: now - 1, accept: false },
    ];
    for (const [field, value] of [
      ["protocol_version", "2"], ["ring_started_at", "01800000000000"],
      ["expires_at", String(now + 45_001)], ["expires_at", "9007199254740992"],
      ["route", `/chat/${input.chat_id}?accept=1`], ["ring_key", `voice:${input.channel_id}:0`],
      ["caller_id", input.recipient_id], ["recipient_session_id", "wrong"],
      ["caller_id", input.caller_id.toUpperCase()], ["extra", "untrusted"],
    ]) cases.push({ data: { ...ring, [field]: value }, at: now, accept: false });
    for (const field of Object.keys(ring)) {
      const data = { ...ring } as Record<string, string>;
      delete data[field];
      cases.push({ data, at: now, accept: false });
    }
    const b64 = (value: string) => Buffer.from(value).toString("base64");
    const encoded = cases.map(({ data, at }) => [String(at), ...Object.entries(data).flatMap(([key, value]) => [b64(key), b64(value)])].join("\t")).join("\n") + "\n";
    const execution = spawnSync(java, ["-cp", [directory].join(delimiter), "com.kub.messenger.VoiceCallWireProbe"], { input: encoded, encoding: "utf8" });
    assert.equal(execution.status, 0, execution.stderr);
    assert.deepEqual(execution.stdout.trim().split(/\r?\n/), cases.map(({ accept }) => accept ? "accepted" : "rejected"));
    assert.equal(cases.length, 27);
  } finally {
    const target = realpathSync(directory);
    assert.ok(target.startsWith(realpathSync(output) + sep), "cleanup stays inside this test's output directory");
    rmSync(target, { recursive: true });
  }
});
