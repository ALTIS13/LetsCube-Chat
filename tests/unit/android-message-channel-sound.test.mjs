import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const native = () => readFileSync(new URL("android/app/src/main/java/com/kub/messenger/ChatPushNotifications.java", root), "utf8");

test("the fresh message sound is short, original PCM with two audible notes", () => {
  const wav = readFileSync(new URL("android/app/src/main/res/raw/letscube_message_v2.wav", root));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1, "uncompressed PCM");
  assert.equal(wav.readUInt16LE(22), 1, "mono");
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  const samples = wav.readUInt32LE(40) / 2;
  assert.ok(samples >= 12_000 && samples <= 14_400, "250-300 ms, not a ringtone");
  const at = (ms) => 44 + Math.round(ms * 48) * 2;
  const peak = (from, to) => {
    let value = 0;
    for (let offset = at(from); offset < at(to); offset += 2) value = Math.max(value, Math.abs(wav.readInt16LE(offset)));
    return value;
  };
  const amplitude = (hz, from, to) => {
    const start = Math.round(from * 48);
    const end = Math.round(to * 48);
    let real = 0;
    let imaginary = 0;
    for (let index = start; index < end; index += 1) {
      const sample = wav.readInt16LE(44 + index * 2);
      const phase = (2 * Math.PI * hz * (index - start)) / 48_000;
      real += sample * Math.cos(phase);
      imaginary += sample * Math.sin(phase);
    }
    return (2 * Math.hypot(real, imaginary)) / (end - start);
  };
  assert.ok(peak(15, 50) > 1_000, "opening note is audible");
  assert.ok(peak(0, 280) < 3_277, "the packaged cue stays below 0.1 full scale");
  assert.ok(amplitude(740, 12, 55) > amplitude(988, 12, 55) * 2, "opening pitch is distinct");
  assert.equal(peak(105, 120), 0, "notes have a real gap");
  assert.ok(peak(145, 175) > 1_000, "resolution is audible");
  assert.ok(amplitude(988, 140, 180) > amplitude(740, 140, 180) * 2, "resolution changes pitch");
  assert.ok(peak(245, 270) < peak(145, 175) / 4, "the end falls away");
});

test("only the fresh message channel gets the packaged sound; tap routing stays intact", () => {
  const source = native();
  assert.match(source, /getNotificationChannel\(LEGACY_CHANNEL_ID\)/);
  assert.match(source, /getNotificationChannel\(FRESH_CHANNEL_ID\)/);
  assert.match(source, /new NotificationChannel\(FRESH_CHANNEL_ID,/);
  assert.doesNotMatch(source, /new NotificationChannel\(LEGACY_CHANNEL_ID,/);
  assert.match(source, /setSound\(soundUri\(context\),/);
  assert.match(source, /android\.resource:\/\/.*\/raw\/letscube_message_v2/);
  assert.match(source, /new Notification\.Builder\(context, channelId\)/);
  assert.match(source, /selected == null \|\| selected\.getImportance\(\) == NotificationManager\.IMPORTANCE_NONE/);
  assert.match(source, /intent\.putExtra\("route", event\.route\)/);
  assert.match(source, /\.setContentIntent\(tap\)/);
  assert.match(source, /manager\.notify\(event\.tag, 0, notification\)/);
  assert.doesNotMatch(source, /"tasks"|"system"|"calls"/);
});
