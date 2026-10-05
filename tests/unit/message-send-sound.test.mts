import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as sounds from "../../artifacts/kub/src/lib/callSounds.ts";

const baseline = {
  enabled: true, ringing: null, documentHidden: false, captureActive: false,
  userId: "sender", currentUserId: "sender", chatId: "chat", openChatId: "chat",
  topicId: null, openTopicId: null,
};
const allowed = (input: object) => (sounds as unknown as {
  messageSendSoundAllowed?: (input: object) => boolean;
}).messageSendSoundAllowed?.(input);

test("a confirmed send has a short, quiet, non-looping cue distinct from an arrival", () => {
  const spec = (sounds.CALL_SOUNDS as Record<string, sounds.CallSoundSpec>).messageSent;
  assert.ok(spec, "the outgoing confirmation has no sound");
  assert.equal(spec.loop, false);
  assert.equal(sounds.callSoundCycleMs(spec), 120);
  assert.equal(spec.gain, 0.045);
  assert.deepEqual(sounds.callSoundBursts(spec, { fromMs: 0, untilMs: 1_000 }), [
    { atMs: 0, durationMs: 120, tones: [{ hz: 660, level: 1 }, { hz: 1320, level: 0.12 }] },
  ]);
});

test("a confirmed send in this account's visible conversation may sound", () => {
  assert.equal(allowed(baseline), true);
  assert.equal(allowed({ ...baseline, topicId: "topic", openTopicId: "topic" }), true);
});

for (const [name, patch] of [
  ["sound switched off", { enabled: false }],
  ["incoming ring", { ringing: "ring" }],
  ["outgoing ring", { ringing: "ringback" }],
  ["background document", { documentHidden: true }],
  ["capture or active call", { captureActive: true }],
  ["signed-out account", { currentUserId: null }],
  ["another account", { currentUserId: "another" }],
  ["another conversation", { openChatId: "another" }],
  ["conversation closed", { openChatId: null }],
  ["another topic", { topicId: "one", openTopicId: "two" }],
] as const) {
  test(`send confirmation is silent for ${name}`, () => {
    assert.equal(allowed({ ...baseline, ...patch }), false);
  });
}

const source = readFileSync(new URL("../../artifacts/kub/src/lib/callSounds.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
for (const [name, from, to, oracle] of [
  ["loud send", "gain: 0.045,", "gain: 0.2,", (m: any) => assert.equal(m.CALL_SOUNDS.messageSent.gain, 0.045)],
  ["long send", "durationMs: 120 }],", "durationMs: 1_200 }],", (m: any) => assert.equal(m.callSoundCycleMs(m.CALL_SOUNDS.messageSent), 120)],
  ["ignore enabled", "return input.enabled && input.ringing === null && !input.documentHidden && !input.captureActive", "return true && input.ringing === null && !input.documentHidden && !input.captureActive", (m: any) => assert.equal(m.messageSendSoundAllowed({ ...baseline, enabled: false }), false)],
  ["ignore capture", "&& !input.captureActive", "&& true", (m: any) => assert.equal(m.messageSendSoundAllowed({ ...baseline, captureActive: true }), false)],
  ["ignore identity", "&& input.userId === input.currentUserId", "&& true", (m: any) => assert.equal(m.messageSendSoundAllowed({ ...baseline, currentUserId: "another" }), false)],
  ["ignore topic", "&& input.topicId === input.openTopicId", "&& true", (m: any) => assert.equal(m.messageSendSoundAllowed({ ...baseline, topicId: "one", openTopicId: "two" }), false)],
] as const) {
  test(`literal oracle refuses compiled send-sound mutation: ${name}`, () => {
    assert.ok(source.includes(from), "mutation must touch the actual implementation");
    const js = ts.transpileModule(source.replace(from, to), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    runInNewContext(`(function(exports,module){${js}\n})`)(module.exports, module);
    assert.throws(() => oracle(module.exports), (error) => error instanceof assert.AssertionError);
  });
}
