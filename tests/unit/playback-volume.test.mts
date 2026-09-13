// One volume, one owner.
//
// D-149. Two stored volumes were written to the same `<audio>` element — the
// sound settings' `voicePlaybackVolume` and the player's own — so the volume a
// person heard depended on which of them had written last, which depended on
// how playback had been started. The rule is data here so that «who owns the
// volume» is a question with one answer that can be read, rather than an order
// of effects in two components.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PLAYBACK,
  elementVolume,
  normalizePlaybackRate,
  normalizeVolume,
  readStoredPlayback,
} from "../../artifacts/kub/src/lib/playbackVolume.ts";

const player = (value: unknown) => JSON.stringify(value);
const sound = (voicePlaybackVolume: unknown) => JSON.stringify({ micInputGain: 1, voicePlaybackVolume });

test("a volume is a number between nothing and everything", () => {
  assert.equal(normalizeVolume(0.4), 0.4);
  assert.equal(normalizeVolume(0), 0);
  assert.equal(normalizeVolume(-1), 0);
  assert.equal(normalizeVolume(3), 1);
  assert.equal(normalizeVolume("0.25"), 0.25);
  for (const nonsense of [undefined, null, NaN, Infinity, "loud", {}]) {
    assert.equal(normalizeVolume(nonsense), DEFAULT_PLAYBACK.volume, String(nonsense));
  }
});

test("a rate is one of the four the player offers", () => {
  for (const rate of [0.5, 1, 1.5, 2]) assert.equal(normalizePlaybackRate(rate), rate);
  for (const refused of [0.75, 3, -1, "fast", null]) assert.equal(normalizePlaybackRate(refused), 1, String(refused));
});

test("the player's own volume wins over the sound settings, silence included", () => {
  const stored = readStoredPlayback(player({ playbackRate: 1.5, volume: 0.3 }), sound(0.9));
  assert.deepEqual(stored, { playbackRate: 1.5, volume: 0.3 });

  // Zero is the case a truthiness check gets wrong, and it is the one that
  // matters: somebody who muted the player must stay muted rather than have the
  // settings' 90% handed back to them.
  assert.equal(readStoredPlayback(player({ volume: 0 }), sound(0.9)).volume, 0);
});

test("a volume set in the old sound settings is inherited once, not lost", () => {
  // D-149 takes the second slider away. A person who had turned voice messages
  // down to a fifth keeps that, and the player owns it from then on.
  assert.equal(readStoredPlayback(null, sound(0.2)).volume, 0.2);
  assert.equal(readStoredPlayback(player({ playbackRate: 2 }), sound(0.2)).volume, 0.2);
  // The rate the player had is not disturbed by the inheritance.
  assert.equal(readStoredPlayback(player({ playbackRate: 2 }), sound(0.2)).playbackRate, 2);
});

test("nothing stored, or nonsense stored, plays at full volume", () => {
  assert.deepEqual(readStoredPlayback(null, null), DEFAULT_PLAYBACK);
  assert.deepEqual(readStoredPlayback("{not json", "also not json"), DEFAULT_PLAYBACK);
  assert.deepEqual(readStoredPlayback("[1,2]", "null"), DEFAULT_PLAYBACK);
  assert.equal(readStoredPlayback(player({ volume: "loud" }), sound("quiet")).volume, 1);
});

test("under a finger nothing stored may turn the sound down (D-118)", () => {
  assert.equal(elementVolume(0.2, true), 1);
  assert.equal(elementVolume(0, true), 1);
  assert.equal(elementVolume(0.2, false), 0.2);
  assert.equal(elementVolume(0, false), 0);
  assert.equal(elementVolume(7, false), 1, "still a volume an element will accept");
});
