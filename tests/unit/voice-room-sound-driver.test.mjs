// The wiring between the call's state and the rule that decides what it sounds.
//
// `tests/unit/voice-room-sound.test.mjs` proves the rule. This proves the
// caller, and the difference is the whole reason this file exists: the rule is
// a pure function and cannot storm, while a caller that schedules a wake
// without cancelling the last one storms beautifully while every rule test
// stays green. The storm has a measured shape — `docs/operations/voice.md`,
// 2026-09-19: a transport that re-established itself roughly every fifteen
// seconds, ~8 new RTC sessions a minute across two participants — and the case
// below is that shape driven through `createVoiceRoomSoundDriver` rather than
// through `voiceRoomSound`.
//
// What this file does **not** reach, stated rather than implied: whether
// `hooks/useVoiceCall.ts` calls `observe` on every publish, whether the reading
// it builds carries `AudioSettings.callSoundEnabled` rather than some second
// flag, and whether `hooks/voiceRoom.ts` raises the phase in the order the
// re-baseline depends on. None of those is loadable by `node --test` — one is
// a `"use client"` module and the other names LiveKit — so they are read as
// source in `tests/unit/voice-room-seam.test.mjs`.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createVoiceRoomSoundDriver,
  voiceRoomPhaseOf,
} from "../../artifacts/kub/src/lib/voiceRoomSoundDriver.ts";
import {
  VOICE_DEPARTURE_GRACE_MS,
  VOICE_SOUND_MIN_GAP_MS,
} from "../../artifacts/kub/src/lib/voiceRoomSound.ts";

const SELF = "11111111-1111-4111-8111-000000000001";
const ANNA = "22222222-2222-4222-8222-000000000002";
const BORIS = "33333333-3333-4333-8333-000000000003";

/**
 * A browser, as this module needs one: a clock that only moves when the test
 * moves it, a timer register that can be counted, and a list of sounds.
 *
 * `openTimers` is the field the storm case is really about. A count rather than
 * a boolean, because the failure being excluded is accumulation.
 */
function host() {
  let nowMs = 1_000;
  let nextId = 1;
  let nowCalls = 0;
  const timers = new Map();
  const played = [];
  return {
    played,
    get openTimers() {
      return timers.size;
    },
    /**
     * How many times the driver has asked what time it is.
     *
     * The only way from out here to see that the rule was consulted at all,
     * which a reading that sounds nothing otherwise cannot be told from a
     * reading that was never taken. `feed` reads the clock; nothing else does.
     */
    get ruleAsked() {
      return nowCalls;
    },
    now: () => {
      nowCalls += 1;
      return nowMs;
    },
    schedule(delayMs, fire) {
      const id = nextId++;
      timers.set(id, { at: nowMs + delayMs, fire });
      return () => timers.delete(id);
    },
    play(sound) {
      played.push({ sound, atMs: nowMs });
    },
    /** Move the clock, firing every timer that matures on the way. */
    advance(byMs) {
      const until = nowMs + byMs;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= until && (due === null || timer.at < due.timer.at)) due = { id, timer };
        }
        if (due === null) break;
        timers.delete(due.id);
        nowMs = due.timer.at;
        due.timer.fire();
      }
      nowMs = until;
    },
    set(atMs) {
      nowMs = atMs;
    },
  };
}

/** A roster, as the store holds it: a fresh array every time the seam reports. */
const roster = (...userIds) => userIds.map((userId) => ({ userId }));

function open(over = {}) {
  const browser = host();
  const driver = createVoiceRoomSoundDriver(browser);
  const base = {
    phase: "idle",
    participants: roster(),
    selfUserId: SELF,
    micMuted: false,
    deafened: false,
    enabled: true,
    ...over,
  };
  let last = base;
  const observe = (fields) => {
    last = { ...last, ...fields };
    driver.observe(last);
    return last;
  };
  return { browser, driver, observe, names: () => browser.played.map((entry) => entry.sound) };
}

/** The join, as `hooks/useVoiceCall.ts` publishes it: phase, roster, phase. */
function join(harness, present = [SELF, ANNA]) {
  harness.observe({ phase: "joining", participants: roster() });
  // Inside `VoiceRoom.join`, which reports before the hook has patched the
  // phase. This ordering is the reason a phase change carries the roster.
  harness.observe({ participants: roster(...present) });
  harness.observe({ phase: "connected" });
}

// ---------------------------------------------------------------------------
// The mapping, which is three lines and one of them matters
// ---------------------------------------------------------------------------

test("a transport being re-established is not a room anybody left", () => {
  assert.equal(voiceRoomPhaseOf("connected"), "connected");
  assert.equal(voiceRoomPhaseOf("reconnecting"), "reconnecting");
  // The three that are genuinely «not in this room».
  assert.equal(voiceRoomPhaseOf("idle"), "away");
  assert.equal(voiceRoomPhaseOf("joining"), "away");
  assert.equal(voiceRoomPhaseOf("failed"), "away");
});

// ---------------------------------------------------------------------------
// The ordinary life of a call
// ---------------------------------------------------------------------------

test("the arrival is sounded on the phase, because the roster arrives before it", () => {
  const harness = open();
  harness.observe({ phase: "joining", participants: roster() });
  harness.observe({ participants: roster(SELF, ANNA) });
  // Still nothing: a roster read while the call is «joining» is a roster of a
  // room this client is not in yet.
  assert.deepEqual(harness.names(), []);
  harness.observe({ phase: "connected" });
  assert.deepEqual(harness.names(), ["join"]);
});

test("arriving where three people already sit is one sound", () => {
  const harness = open();
  join(harness, [SELF, ANNA, BORIS, "44444444-4444-4444-8444-000000000004"]);
  assert.deepEqual(harness.names(), ["join"]);
});

test("somebody arriving after us is announced, and staying is not", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF, ANNA, BORIS) });
  assert.deepEqual(harness.names(), ["join", "join"]);
  harness.browser.advance(5_000);
  // The same room read again. `report()` builds a new array every time, so this
  // is a roster the driver cannot tell from a real one by identity — which is
  // the point: the set difference is what answers, not the array.
  harness.observe({ participants: roster(SELF, ANNA, BORIS) });
  assert.deepEqual(harness.names(), ["join", "join"]);
});

test("a departure matures on the clock, with nothing else happening", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF) });
  // Held, not announced: the grace is what makes somebody else's restart silent.
  assert.deepEqual(harness.names(), ["join"]);
  assert.equal(harness.browser.openTimers, 1, "nothing will ever ask the rule again");
  harness.browser.advance(VOICE_DEPARTURE_GRACE_MS + 10);
  assert.deepEqual(harness.names(), ["join", "leave"]);
  assert.equal(harness.browser.openTimers, 0);
});

test("a peer who comes back inside the grace is silent in both directions", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF) });
  harness.browser.advance(1_000);
  harness.observe({ participants: roster(SELF, ANNA) });
  // Checked here rather than after the clock moves, and that is the whole
  // assertion: a stale wake is *drained* by advancing, so a version that armed
  // without cancelling would look identical from the far side of the grace.
  assert.equal(harness.browser.openTimers, 0, "a cancelled departure left a wake behind");
  harness.browser.advance(10_000);
  assert.deepEqual(harness.names(), ["join"]);
  assert.equal(harness.browser.openTimers, 0);
});

test("leaving is the one departure the roster never reports", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.browser.advance(60_000);
  harness.observe({ phase: "idle", participants: roster() });
  assert.deepEqual(harness.names(), ["join", "leave"]);
});

test("a call that ended without being asked to is still a departure", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.browser.advance(60_000);
  // `onClosed` — «Звонок прерван.» The room really did go silent.
  harness.observe({ phase: "failed", participants: roster() });
  assert.deepEqual(harness.names(), ["join", "leave"]);
});

test("a join that was refused sounds nothing at either end", () => {
  const harness = open();
  harness.observe({ phase: "joining", participants: roster() });
  harness.observe({ phase: "failed", participants: roster() });
  assert.deepEqual(harness.names(), []);
});

// ---------------------------------------------------------------------------
// The storm that was measured
// ---------------------------------------------------------------------------

test("a transport that re-establishes every fifteen seconds is silent after the join", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  assert.deepEqual(harness.names(), ["join"]);

  // Forty cycles is ten minutes at the measured rate, and about five times the
  // ~8 sessions a minute Kong logged on 2026-09-19.
  for (let cycle = 0; cycle < 40; cycle += 1) {
    harness.browser.advance(15_000);
    harness.observe({ phase: "reconnecting" });
    harness.observe({ phase: "connected" });
    // `RoomEvent.Reconnected` reports immediately afterwards, and a reconnect
    // resubscribes every track, so the roster really is re-delivered.
    harness.observe({ participants: roster(SELF, ANNA) });
    assert.ok(
      harness.browser.openTimers <= 1,
      `cycle ${cycle} left ${harness.browser.openTimers} timers armed`,
    );
  }

  assert.deepEqual(harness.names(), ["join"], "the storm made a sound");
  assert.equal(harness.browser.openTimers, 0);
});

test("a storm with no roster between its halves is silent too", () => {
  // The shape a client that never finishes reconnecting produces: the phase
  // flaps and nothing is ever re-reported. A version that read `reconnecting`
  // as «away» plays a departure and an arrival on every cycle.
  const harness = open();
  join(harness, [SELF, ANNA]);
  for (let cycle = 0; cycle < 40; cycle += 1) {
    harness.browser.advance(15_000);
    harness.observe({ phase: "reconnecting" });
    harness.observe({ phase: "connected" });
  }
  assert.deepEqual(harness.names(), ["join"]);
  assert.equal(harness.browser.openTimers, 0);
});

test("somebody who came and went while the socket was down is not announced", () => {
  // The rule's re-baseline, reached through the wiring — and the case the
  // wiring can lose on its own. The roster a phase change carries is the one
  // from **before** the drop, so consuming the re-baseline with it would leave
  // the fresh roster to be diffed against a stale reading.
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.browser.advance(20_000);
  harness.observe({ phase: "reconnecting" });
  harness.observe({ phase: "connected" });
  harness.browser.advance(500);
  // Anna went, Boris came, both while there was no socket to hear it on.
  harness.observe({ participants: roster(SELF, BORIS) });
  harness.browser.advance(VOICE_DEPARTURE_GRACE_MS + 1_000);
  assert.deepEqual(harness.names(), ["join"]);
  assert.equal(harness.browser.openTimers, 0);

  // And the room is understood afterwards rather than merely quiet: somebody
  // arriving **after** the re-baseline is still announced.
  harness.observe({ participants: roster(SELF, BORIS, ANNA) });
  assert.deepEqual(harness.names(), ["join", "join"]);
});

test("a roster churning every fifty milliseconds cannot outrun the floor", () => {
  // A different person every fiftieth of a second, so every reading is a real
  // arrival **and** a real departure — the same body flapping in and out would
  // be cancelled by the grace and would prove nothing about the floor. Two
  // hundred of them is ten seconds of a room nobody could survive.
  const harness = open();
  join(harness, [SELF, ANNA]);
  const startedAt = harness.browser.now();
  for (let step = 0; step < 200; step += 1) {
    harness.browser.advance(50);
    harness.observe({ participants: roster(SELF, ANNA, `guest-${step}`) });
    assert.ok(harness.browser.openTimers <= 1, `step ${step} armed ${harness.browser.openTimers}`);
  }
  const elapsed = harness.browser.now() - startedAt;
  const ceiling = Math.ceil(elapsed / VOICE_SOUND_MIN_GAP_MS) + 1;
  assert.ok(
    harness.browser.played.length <= ceiling,
    `${harness.browser.played.length} sounds in ${elapsed}ms, ceiling ${ceiling}`,
  );
  // And no two of them are closer together than the floor, which is what the
  // ceiling above is really asserting.
  for (let index = 1; index < harness.browser.played.length; index += 1) {
    const gap = harness.browser.played[index].atMs - harness.browser.played[index - 1].atMs;
    assert.ok(gap >= VOICE_SOUND_MIN_GAP_MS, `two sounds ${gap}ms apart`);
  }
});

// ---------------------------------------------------------------------------
// The controls this person pressed
// ---------------------------------------------------------------------------

test("a mute and an unmute each answer once", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.observe({ micMuted: true });
  harness.observe({ micMuted: false });
  assert.deepEqual(harness.names(), ["join", "mute", "unmute"]);
});

test("deafening moves two flags and makes one sound", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  // `setVoiceDeafened(true)` patches both in one publish, which is why the two
  // readings are asked in order and only the first is allowed to answer.
  harness.observe({ deafened: true, micMuted: true });
  assert.deepEqual(harness.names(), ["join", "mute"]);
  harness.observe({ deafened: false, micMuted: false });
  assert.deepEqual(harness.names(), ["join", "mute", "unmute"]);
});

test("undeafening somebody who was already muted still answers, and the mute holds", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.observe({ micMuted: true });
  harness.observe({ deafened: true });
  harness.observe({ deafened: false });
  assert.deepEqual(harness.names(), ["join", "mute", "mute", "unmute"]);
});

test("joining a call already muted is a state rather than a press", () => {
  const harness = open({ micMuted: true });
  join(harness, [SELF, ANNA]);
  assert.deepEqual(harness.names(), ["join"]);
});

test("leaving while muted is a departure and not also an unmute", () => {
  // The one that bites: leaving publishes IDLE, which moves `micMuted` from
  // true to false in the same reading that ends the call. Without the reset the
  // departure arrives under a blip.
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.observe({ micMuted: true });
  harness.browser.advance(5_000);
  harness.observe({ phase: "idle", participants: roster(), micMuted: false });
  assert.deepEqual(harness.names(), ["join", "mute", "leave"]);
});

test("a room that fills up while this listener is deafened stays silent", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.observe({ deafened: true, micMuted: true });
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF, ANNA, BORIS) });
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF, BORIS) });
  harness.browser.advance(VOICE_DEPARTURE_GRACE_MS + 100);
  // The blip that answered the deafen, and nothing the room did afterwards.
  assert.deepEqual(harness.names(), ["join", "mute"]);
});

// ---------------------------------------------------------------------------
// The setting, and the teardown
// ---------------------------------------------------------------------------

test("the switch silences all four, in every phase", () => {
  const harness = open({ enabled: false });
  join(harness, [SELF, ANNA]);
  harness.observe({ micMuted: true });
  harness.observe({ micMuted: false });
  // Deafen as well as mute, and they are asked separately: a first version of
  // this case moved only `micMuted`, so the deafen reading answered null
  // because nothing had changed rather than because the switch was off — and a
  // mutation that stopped carrying the setting into that reading stayed green.
  harness.observe({ deafened: true, micMuted: true });
  harness.observe({ deafened: false, micMuted: false });
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF, ANNA, BORIS) });
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF) });
  harness.browser.advance(VOICE_DEPARTURE_GRACE_MS + 100);
  harness.observe({ phase: "idle", participants: roster() });
  assert.deepEqual(harness.names(), []);
});

test("a switch turned back on mid-call does not replay what it missed", () => {
  const harness = open({ enabled: false });
  join(harness, [SELF, ANNA]);
  harness.browser.advance(5_000);
  harness.observe({ enabled: true, participants: roster(SELF, ANNA, BORIS) });
  // The arrival that happens **after** it was turned on, and not the one before.
  assert.deepEqual(harness.names(), ["join"]);
});

test("forgetting is the one door that never reaches the player", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  harness.browser.advance(5_000);
  harness.observe({ participants: roster(SELF) });
  assert.equal(harness.browser.openTimers, 1);
  harness.driver.forget();
  assert.equal(harness.browser.openTimers, 0, "a wake survived the teardown");
  harness.browser.advance(60_000);
  assert.deepEqual(harness.names(), ["join"]);
  // And a call after it starts from nothing rather than from a room it
  // half-remembers: this is a new stay, so its first roster is a baseline.
  join(harness, [SELF, ANNA, BORIS]);
  assert.deepEqual(harness.names(), ["join", "join"]);
});

test("a publish about something else never reaches the rule", () => {
  const harness = open();
  join(harness, [SELF, ANNA]);
  const sounds = harness.browser.played.length;
  const asked = harness.browser.ruleAsked;
  // A refused output device, a revoked permission, blocked playback: three
  // publishes that carry the same roster array and the same phase. `patch`
  // spreads a new state object every time, so «nothing moved» has to be
  // answered by comparing what is in it rather than by comparing the object.
  harness.observe({});
  harness.observe({});
  harness.observe({});
  assert.equal(harness.browser.played.length, sounds, "a publish about nothing made a sound");
  assert.equal(harness.browser.ruleAsked, asked, "the rule was consulted about nothing");
  assert.equal(harness.browser.openTimers, 0);
});
