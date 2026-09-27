import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseHeadphones,
  chooseMicrophone,
  micMutedBy,
  readVoiceSelfAudio,
  VOICE_SELF_AUDIO_DEFAULT,
  writeVoiceSelfAudio,
} from "../../artifacts/kub/src/lib/voiceSelfAudio.ts";

// Tracker item 40: mute and deafen are the person's own standing choice, kept
// across calls and reloads, and the panel's two buttons work with no call.

const open = { muted: false, deafened: false };
const muted = { muted: true, deafened: false };
const deafOpen = { muted: false, deafened: true };
const deafMuted = { muted: true, deafened: true };

/** A press, as the panel makes it: the opposite of what the button shows. */
const pressMicrophone = (self: typeof open) => chooseMicrophone(self, !micMutedBy(self));
const pressHeadphones = (self: typeof open) => chooseHeadphones(self, !self.deafened);

test("deafening silences the microphone too, and only while it is on", () => {
  assert.equal(micMutedBy(open), false);
  assert.equal(micMutedBy(muted), true);
  assert.equal(micMutedBy(deafOpen), true, "somebody who cannot hear the room is not on the air");
  assert.equal(micMutedBy(deafMuted), true);
});

test("the headphones give back the microphone as it was left", () => {
  assert.deepEqual(pressHeadphones(open), deafOpen);
  assert.deepEqual(pressHeadphones(deafOpen), open, "open before deafening, open after");
  assert.deepEqual(pressHeadphones(muted), deafMuted);
  assert.deepEqual(pressHeadphones(deafMuted), muted, "muted before deafening, muted after");
});

test("the microphone toggles, and while deafened it brings the room back too", () => {
  assert.deepEqual(pressMicrophone(open), muted);
  assert.deepEqual(pressMicrophone(muted), open);
  assert.deepEqual(pressMicrophone(deafOpen), open, "a press to talk is not left unable to hear");
  assert.deepEqual(pressMicrophone(deafMuted), open);
});

test("setting a control to what it already is changes nothing", () => {
  for (const self of [open, muted, deafOpen, deafMuted]) {
    assert.deepEqual(chooseHeadphones(self, self.deafened), self);
  }
  assert.deepEqual(chooseMicrophone(muted, true), muted);
  assert.deepEqual(chooseMicrophone(deafMuted, true), deafMuted);
  assert.deepEqual(chooseMicrophone(open, false), open);
});

test("what storage holds reads back, and anything else is open and hearing", () => {
  for (const value of [open, muted, deafOpen, deafMuted]) {
    assert.deepEqual(readVoiceSelfAudio(writeVoiceSelfAudio(value)), value);
  }
  assert.deepEqual(readVoiceSelfAudio(null), VOICE_SELF_AUDIO_DEFAULT);
  assert.deepEqual(readVoiceSelfAudio("not json"), VOICE_SELF_AUDIO_DEFAULT);
  assert.deepEqual(readVoiceSelfAudio("null"), VOICE_SELF_AUDIO_DEFAULT);
  assert.deepEqual(readVoiceSelfAudio("[true, true]"), { muted: false, deafened: false });
  assert.deepEqual(readVoiceSelfAudio('{"muted":"yes","deafened":1}'), open, "only a real true counts");
  assert.deepEqual(readVoiceSelfAudio('{"muted":true}'), muted);
});
