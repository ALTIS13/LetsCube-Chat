import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_DEPARTURE_GRACE_MS,
  VOICE_SOUND_MIN_GAP_MS,
  voiceRoomSound,
  voiceRoomSoundInitial,
  voiceSelfControlSound,
} from "../../artifacts/kub/src/lib/voiceRoomSound.ts";

/**
 * When a voice channel may make a sound, and — the half that matters more —
 * every way it must not.
 *
 * Two of the cases below are measurements rather than inventions. The reconnect
 * storm is `docs/operations/voice.md`, 2026-09-19: ~8 new RTC sessions a minute
 * across two participants, a median of 15–16 seconds between one participant's
 * own successive sessions, and the client library restarting itself on a saved
 * token rather than the application re-joining. Arriving in a populated channel
 * is the ordinary case and is where a naive implementation plays four sounds at
 * once.
 *
 * A sound cannot be photographed, so this file is where the claim «it is quiet
 * when it should be» is actually made.
 */

const SELF = "11111111-1111-4111-8111-000000000001";
const ANNA = "22222222-2222-4222-8222-000000000002";
const BORIS = "33333333-3333-4333-8333-000000000003";
const VERA = "44444444-4444-4444-8444-000000000004";
const GLEB = "55555555-5555-4555-8555-000000000005";

/** Feed a sequence of readings, and collect what was sounded and when to wake. */
function drive(readings, over = {}) {
  let state = voiceRoomSoundInitial();
  const sounds = [];
  const decisions = [];
  for (const reading of readings) {
    const decision = voiceRoomSound(state, {
      phase: "connected",
      selfUserId: SELF,
      userIds: [],
      enabled: true,
      deafened: false,
      ...over,
      ...reading,
    });
    state = decision.state;
    decisions.push(decision);
    if (decision.sound !== null) sounds.push({ sound: decision.sound, atMs: reading.nowMs });
    }
  return { state, sounds, decisions, names: sounds.map((entry) => entry.sound) };
}

// ---------------------------------------------------------------------------
// The two situations that were measured
// ---------------------------------------------------------------------------

test("arriving where four people already sit plays one sound, not four", () => {
  const { names, state } = drive([{ nowMs: 1_000, userIds: [ANNA, BORIS, VERA, GLEB, SELF] }]);
  // Our own, and nobody else's. Everybody already there was already there.
  assert.deepEqual(names, ["join"]);
  assert.deepEqual([...state.present], [ANNA, BORIS, GLEB, SELF, VERA].sort());
  assert.equal(state.inRoom, true);
});

test("everybody already there stays already there", () => {
  // The same room read again is not four arrivals either, and our own
  // departure at the end says we were counted as being in a room at all — the
  // two halves of the baseline, each of which can fail without the other.
  const { names } = drive([
    { nowMs: 1_000, userIds: [ANNA, BORIS, VERA, GLEB, SELF] },
    { nowMs: 5_000, userIds: [ANNA, BORIS, VERA, GLEB, SELF] },
    { nowMs: 9_000, phase: "away", userIds: [] },
  ]);
  assert.deepEqual(names, ["join", "leave"]);
});

test("a reconnect storm is silent from the first cycle to the last", () => {
  // The shape that was measured: the transport restarting about four times a
  // minute, each cycle bringing the whole roster back. A rule that read a fresh
  // roster as a set of arrivals would have played two joins per cycle, sixteen
  // over this stretch, for two people who never moved.
  const room = [ANNA, BORIS, SELF];
  const readings = [{ nowMs: 0, userIds: room }];
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const at = 15_000 + cycle * 15_500;
    readings.push({ nowMs: at, phase: "reconnecting", userIds: room });
    // A roster mid-reconnect says nothing about anybody, including an empty one.
    readings.push({ nowMs: at + 200, phase: "reconnecting", userIds: [] });
    readings.push({ nowMs: at + 800, userIds: room });
  }
  const { names } = drive(readings);
  assert.deepEqual(names, ["join"], "only our own arrival, once, at the very start");
});

test("a reconnect that brings somebody new back is still silent, and the next arrival is not", () => {
  // The honest cost of re-baselining, stated rather than hidden: somebody who
  // joined while our socket was down is adopted without a sound. Whoever
  // arrives after it is heard normally, which is the property that matters.
  const { names, state } = drive([
    { nowMs: 0, userIds: [ANNA, SELF] },
    { nowMs: 5_000, phase: "reconnecting", userIds: [ANNA, SELF] },
    { nowMs: 5_900, userIds: [ANNA, BORIS, SELF] },
    { nowMs: 9_000, userIds: [ANNA, BORIS, VERA, SELF] },
  ]);
  assert.deepEqual(names, ["join", "join"]);
  assert.deepEqual([...state.present], [ANNA, BORIS, SELF, VERA].sort());
});

// ---------------------------------------------------------------------------
// Arrivals
// ---------------------------------------------------------------------------

test("somebody who arrives after our own join is an arrival", () => {
  const { names } = drive([
    { nowMs: 0, userIds: [SELF] },
    { nowMs: 4_000, userIds: [SELF, ANNA] },
  ]);
  assert.deepEqual(names, ["join", "join"]);
});

test("three people arriving in one reading make one sound", () => {
  const { names } = drive([
    { nowMs: 0, userIds: [SELF] },
    { nowMs: 4_000, userIds: [SELF, ANNA, BORIS, VERA] },
  ]);
  assert.deepEqual(names, ["join", "join"]);
});

/**
 * The two intervals, spelled as numbers below rather than read from the module.
 *
 * Measured rather than inherited: a case written as `now + GAP - 1` follows the
 * constant wherever it goes, so setting the floor to zero moved the case to
 * «one millisecond *before* the last sound» and it went on passing while
 * nothing at all was being limited. Caught by mutation on 2026-09-19. The pins
 * here are what connects the literal times below to the module's own numbers.
 */
test("the two intervals are what the cases below are written against", () => {
  assert.equal(VOICE_SOUND_MIN_GAP_MS, 400);
  assert.equal(VOICE_DEPARTURE_GRACE_MS, 2_500);
});

test("two arrivals inside the floor make one sound, and the second is dropped rather than queued", () => {
  const { names, sounds } = drive([
    { nowMs: 0, userIds: [SELF] },
    { nowMs: 4_000, userIds: [SELF, ANNA] },
    // 150 ms later, which is inside the 400 ms floor.
    { nowMs: 4_150, userIds: [SELF, ANNA, BORIS] },
    // Nothing further happens, and nothing further sounds: the refused sound is
    // gone rather than waiting, so a rattle cannot arrive late instead.
    { nowMs: 20_000, userIds: [SELF, ANNA, BORIS] },
  ]);
  assert.deepEqual(names, ["join", "join"]);
  assert.deepEqual(
    sounds.map((entry) => entry.atMs),
    [0, 4_000],
  );
});

test("two arrivals a floor apart make two sounds", () => {
  const { names, sounds } = drive([
    { nowMs: 0, userIds: [SELF] },
    { nowMs: 4_000, userIds: [SELF, ANNA] },
    { nowMs: 4_400, userIds: [SELF, ANNA, BORIS] },
  ]);
  assert.deepEqual(names, ["join", "join", "join"]);
  assert.deepEqual(
    sounds.map((entry) => entry.atMs),
    [0, 4_000, 4_400],
  );
});

// ---------------------------------------------------------------------------
// Departures, and the flap the grace exists for
// ---------------------------------------------------------------------------

test("a departure is not believed until it has lasted", () => {
  const { names, decisions } = drive([
    { nowMs: 0, userIds: [SELF, ANNA] },
    { nowMs: 5_000, userIds: [SELF] },
  ]);
  assert.deepEqual(names, ["join"], "nothing yet");
  // And the rule says when to come back, because nothing else will: a roster
  // does not change again just because somebody stayed gone.
  assert.equal(decisions.at(-1).wakeAtMs, 7_500);
});

test("a departure that lasts is a departure", () => {
  const { names, sounds } = drive([
    { nowMs: 0, userIds: [SELF, ANNA] },
    { nowMs: 5_000, userIds: [SELF] },
    { nowMs: 7_500, userIds: [SELF] },
  ]);
  assert.deepEqual(names, ["join", "leave"]);
  assert.equal(sounds.at(-1).atMs, 7_500);
});

test("somebody whose own client restarts makes no sound in either direction", () => {
  // Their session restarting looks exactly like a departure followed by an
  // arrival, and it is neither. Without the grace this was two sounds for an
  // event that never happened — four times a minute per participant, at the
  // rate that was measured.
  const { names, decisions } = drive([
    { nowMs: 0, userIds: [SELF, ANNA] },
    { nowMs: 5_000, userIds: [SELF] },
    { nowMs: 5_900, userIds: [SELF, ANNA] },
    { nowMs: 30_000, userIds: [SELF, ANNA] },
  ]);
  assert.deepEqual(names, ["join"], "our own arrival and nothing else");
  assert.equal(decisions.at(-1).wakeAtMs, null, "and nothing is still pending");
});

test("an arrival and a matured departure in one reading sound the arrival", () => {
  const { names, state } = drive([
    { nowMs: 0, userIds: [SELF, ANNA] },
    { nowMs: 5_000, userIds: [SELF] },
    { nowMs: 7_500, userIds: [SELF, BORIS] },
    // The departure that lost is dropped rather than held: it does not arrive
    // late, and it does not arrive at all.
    { nowMs: 60_000, userIds: [SELF, BORIS] },
  ]);
  assert.deepEqual(names, ["join", "join"]);
  assert.deepEqual([...state.leaving], []);
});

// ---------------------------------------------------------------------------
// Our own arrival and departure
// ---------------------------------------------------------------------------

test("our own arrival sounds once per stay, however often the transport comes back", () => {
  const { names } = drive([
    { nowMs: 0, userIds: [SELF] },
    { nowMs: 1_000, phase: "reconnecting", userIds: [SELF] },
    { nowMs: 2_000, userIds: [SELF] },
    { nowMs: 3_000, phase: "reconnecting", userIds: [] },
    { nowMs: 4_000, userIds: [SELF] },
  ]);
  assert.deepEqual(names, ["join"]);
});

test("leaving the room sounds, and leaving a room we were never in does not", () => {
  const left = drive([
    { nowMs: 0, userIds: [SELF, ANNA] },
    { nowMs: 9_000, phase: "away", userIds: [] },
  ]);
  assert.deepEqual(left.names, ["join", "leave"]);
  // And the state is forgotten, so the next stay baselines afresh rather than
  // reporting everybody already in the room as an arrival.
  assert.equal(left.state.inRoom, false);
  assert.deepEqual([...left.state.present], []);

  const never = drive([{ nowMs: 0, phase: "away", userIds: [] }]);
  assert.deepEqual(never.names, []);
});

test("a roster taken before the room has listed us decides nothing", () => {
  const { names, state } = drive([
    // Connected, and the SFU has not put us in the list yet. A rule that
    // baselined here would then hear our own appearance as somebody else's.
    { nowMs: 0, userIds: [ANNA, BORIS] },
    { nowMs: 200, userIds: [ANNA, BORIS] },
    { nowMs: 400, userIds: [ANNA, BORIS, SELF] },
  ]);
  assert.deepEqual(names, ["join"]);
  assert.deepEqual([...state.present], [ANNA, BORIS, SELF].sort());
  assert.equal(state.inRoom, true);
});

test("we are never our own arrival twice, nor our own departure inside a stay", () => {
  // The SFU dropping us out of its own list for one reading and putting us
  // back: not a leave, not a join, because `inRoom` is cleared only by `away`.
  const { names } = drive([
    { nowMs: 0, userIds: [SELF, ANNA] },
    { nowMs: 1_000, userIds: [ANNA] },
    { nowMs: 2_000, userIds: [SELF, ANNA] },
    { nowMs: 30_000, userIds: [SELF, ANNA] },
  ]);
  assert.deepEqual(names, ["join"]);
});

// ---------------------------------------------------------------------------
// The two switches
// ---------------------------------------------------------------------------

test("the call-sound setting silences the room, in every phase", () => {
  const { names } = drive(
    [
      { nowMs: 0, userIds: [SELF] },
      { nowMs: 4_000, userIds: [SELF, ANNA] },
      { nowMs: 8_000, userIds: [SELF] },
      { nowMs: 10_500, userIds: [SELF] },
      { nowMs: 20_000, phase: "away", userIds: [] },
    ],
    { enabled: false },
  );
  assert.deepEqual(names, []);
});

test("a deafened listener hears nothing the room does", () => {
  const { names } = drive(
    [
      { nowMs: 0, userIds: [SELF] },
      { nowMs: 4_000, userIds: [SELF, ANNA] },
      { nowMs: 8_000, userIds: [SELF] },
      { nowMs: 10_500, userIds: [SELF] },
    ],
    { deafened: true },
  );
  assert.deepEqual(names, []);
  // And a listener who stops being deafened hears what happens next, not what
  // happened while they were not listening.
  const resumed = drive([
    { nowMs: 0, userIds: [SELF], deafened: true },
    { nowMs: 4_000, userIds: [SELF, ANNA], deafened: true },
    { nowMs: 8_000, userIds: [SELF, ANNA, BORIS], deafened: false },
  ]);
  assert.deepEqual(resumed.names, ["join"]);
});

test("a refused sound is refused, not remembered", () => {
  // The floor is not advanced by a sound the settings suppressed, so switching
  // the setting on does not leave a silent period behind it.
  const { state } = drive([{ nowMs: 10_000, userIds: [SELF] }], { enabled: false });
  assert.equal(state.lastSoundAtMs, Number.NEGATIVE_INFINITY);
});

// ---------------------------------------------------------------------------
// The control blip, which deafen reuses
// ---------------------------------------------------------------------------

test("a press is answered, and a state is not", () => {
  assert.equal(voiceSelfControlSound({ silenced: true, previous: false, enabled: true }), "mute");
  assert.equal(voiceSelfControlSound({ silenced: false, previous: true, enabled: true }), "unmute");
  // Joining a call already muted is a state, not a press.
  assert.equal(voiceSelfControlSound({ silenced: true, previous: null, enabled: true }), null);
  assert.equal(voiceSelfControlSound({ silenced: false, previous: null, enabled: true }), null);
  // And a re-render is not a press either.
  assert.equal(voiceSelfControlSound({ silenced: true, previous: true, enabled: true }), null);
  assert.equal(voiceSelfControlSound({ silenced: false, previous: false, enabled: true }), null);
});

test("deafen and undeafen reuse the same two sounds", () => {
  // One function, asked about a different control. The screen says which press
  // it was; the sound only says that the press registered.
  assert.equal(voiceSelfControlSound({ silenced: true, previous: false, enabled: true }), "mute");
  assert.equal(voiceSelfControlSound({ silenced: false, previous: true, enabled: true }), "unmute");
});

test("the setting silences a press too, and nothing else does", () => {
  assert.equal(voiceSelfControlSound({ silenced: true, previous: false, enabled: false }), null);
  assert.equal(voiceSelfControlSound({ silenced: false, previous: true, enabled: false }), null);
});
