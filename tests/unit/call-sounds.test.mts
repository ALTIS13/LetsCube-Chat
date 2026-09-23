import assert from "node:assert/strict";
import test from "node:test";

import {
  CALL_SOUNDS,
  CALL_SOUND_DEFAULT,
  NOTIFICATION_SOUND_DEFAULT,
  callSoundBursts,
  callSoundCycleMs,
  callSoundEnvelope,
  callSoundEnvelopeCurve,
  callSoundEnvelopeCurvePoints,
  callSoundEnvelopeLevel,
  callSoundToneGain,
  callSoundTransition,
  notificationSoundAllowed,
  readCallSoundEnabled,
  readNotificationSoundEnabled,
  voiceRingSound,
  type CallRingState,
  type CallSoundName,
  type CallSoundSpec,
} from "../../artifacts/kub/src/lib/callSounds.ts";
import * as callSoundsModule from "../../artifacts/kub/src/lib/callSounds.ts";
import { callSoundPlan } from "../../scripts/call-sound-baseline.mjs";
import { normalizeAudioSettings } from "../../artifacts/kub/src/hooks/useAudioSettings.ts";

/**
 * What a call and a notification sound like, and — the half that matters more —
 * every way a sound stops.
 *
 * A sound cannot be photographed, so this file is where the claim «the ring
 * stops» is actually made. `tests/e2e/voice-ring.spec.ts` proves that the
 * player is asked the things asserted here; what is asserted here is that the
 * things asked for are the right ones.
 *
 * A ring that goes on sounding after the call is over is worse than silence,
 * and §4a of `docs/proposals/2026-09-18-one-to-one-calls.md` is why there are so
 * many ways for that to happen: every device the person is signed in on rings,
 * and any one of them answering has to stop the rest.
 */

// ---------------------------------------------------------------------------
// The cadence
// ---------------------------------------------------------------------------

/** Tones of equal weight, which is what a telephone's two are. */
function equalTones(...hz: number[]) {
  return hz.map((value) => ({ hz: value, level: 1 }));
}

/** What each burst of one cycle sounds, in order. */
function tonesOf(spec: CallSoundSpec): number[][] {
  return callSoundBursts(spec, { fromMs: 0, untilMs: callSoundCycleMs(spec) }).map((burst) =>
    burst.tones.map((tone) => tone.hz),
  );
}

/** The pitch of each burst, which for a note is its loudest partial. */
function pitchesOf(spec: CallSoundSpec): number[] {
  return callSoundBursts(spec, { fromMs: 0, untilMs: callSoundCycleMs(spec) }).map(
    (burst) => burst.tones.reduce((best, tone) => (tone.level > best.level ? tone : best)).hz,
  );
}

/** Each burst's tones as {hz, level}, which is the model's own shape. */
function shapeOf(spec: CallSoundSpec): { hz: number; level: number }[][] {
  return callSoundBursts(spec, { fromMs: 0, untilMs: callSoundCycleMs(spec) }).map((burst) =>
    burst.tones.map((tone) => ({ hz: tone.hz, level: tone.level })),
  );
}

/** Every step's length, sound and silence alike. */
function timingOf(spec: CallSoundSpec): number[] {
  return spec.cadence.map((step) => step.durationMs);
}

test("a ring is a double burst and then two seconds of nothing", () => {
  const ring = CALL_SOUNDS.ring;
  assert.deepEqual(timingOf(ring), [500, 200, 500, 2000]);
  assert.equal(callSoundCycleMs(ring), 3_200);

  // One cycle: two bursts, 500 ms each, the second beginning 700 ms in.
  const first = callSoundBursts(ring, { fromMs: 0, untilMs: 3_200 });
  assert.deepEqual(first, [
    { atMs: 0, durationMs: 500, tones: equalTones(440, 480) },
    { atMs: 700, durationMs: 500, tones: equalTones(440, 480) },
  ]);
  // The silence is the point: 1.2 seconds of pattern, then two of nothing.
  assert.equal(first[1].atMs + first[1].durationMs, 1_200);
  assert.equal(callSoundCycleMs(ring) - 1_200, 2_000);
});

test("the cadence repeats for as long as it is asked about", () => {
  const ring = CALL_SOUNDS.ring;
  const overAMinute = callSoundBursts(ring, { fromMs: 0, untilMs: 64_000 });
  // Twenty cycles of two bursts. A ring runs for 45 seconds; this is past that,
  // deliberately, because the thing that stops it is a state and not a length.
  assert.equal(overAMinute.length, 40);
  assert.equal(overAMinute.at(-1)?.atMs, 19 * 3_200 + 700);

  // And a window that starts late contains only what is still to come, so a
  // player scheduling ahead cannot schedule the same burst twice.
  const later = callSoundBursts(ring, { fromMs: 3_200, untilMs: 6_400 });
  assert.deepEqual(later, [
    { atMs: 3_200, durationMs: 500, tones: equalTones(440, 480) },
    { atMs: 3_900, durationMs: 500, tones: equalTones(440, 480) },
  ]);
});

test("the ringback is the ring's cadence, single-toned and quieter", () => {
  const ring = CALL_SOUNDS.ring;
  const ringback = CALL_SOUNDS.ringback;
  // One timing read twice. Since 2026-09-19 it can no longer be literally the
  // same array of *steps* — the tones live in the step now and these two differ
  // there — so what is asserted is the property the shared array existed to
  // guarantee: the two cannot come to sound at different moments. The one array
  // of numbers they are both laid onto is `TELEPHONE_CADENCE_MS`.
  assert.deepEqual(timingOf(ringback), timingOf(ring));
  assert.deepEqual(tonesOf(ring), [[440, 480], [440, 480]], "a telephone rings on two tones");
  assert.deepEqual(tonesOf(ringback), [[425], [425]], "a ringback is one");
  assert.ok(
    ringback.gain < ring.gain / 2,
    `a caller's own ringback must be well under the ring: ${ringback.gain} vs ${ring.gain}`,
  );
});

test("a notification is a short two-note figure, however far ahead it is asked about", () => {
  const spec = CALL_SOUNDS.notification;
  assert.equal(spec.loop, false);
  assert.equal(spec.decay, "exponential");
  assert.ok(spec.gain <= 0.1, "the notification must retain its quiet peak budget");
  assert.deepEqual(timingOf(spec), [100, 24, 156]);
  assert.deepEqual(shapeOf(spec), [
    [{ hz: 740, level: 1 }, { hz: 1480, level: 0.18 }],
    [{ hz: 988, level: 1 }, { hz: 1976, level: 0.18 }],
  ]);
  assert.ok(callSoundCycleMs(spec) <= 300, "one compact cue, not a phrase");
  const forever = callSoundBursts(spec, { fromMs: 0, untilMs: 600_000 });
  assert.deepEqual(forever, [
    { atMs: 0, durationMs: 100, tones: [{ hz: 740, level: 1 }, { hz: 1480, level: 0.18 }] },
    { atMs: 124, durationMs: 156, tones: [{ hz: 988, level: 1 }, { hz: 1976, level: 0.18 }] },
  ]);
  assert.deepEqual(callSoundBursts(spec, { fromMs: 280, untilMs: 600_000 }), []);
  assert.notDeepEqual(pitchesOf(spec), pitchesOf(CALL_SOUNDS.join));
  assert.notDeepEqual(pitchesOf(spec), pitchesOf(CALL_SOUNDS.leave));
});

test("the level is shared between a burst's tones rather than added up", () => {
  // Two sines at the spec's gain do not make that sound; they make one twice as
  // loud, which clips against everything else the page is playing.
  const ring = CALL_SOUNDS.ring;
  const [ringBurst] = callSoundBursts(ring, { fromMs: 0, untilMs: 1 });
  for (const tone of ringBurst.tones) {
    assert.equal(callSoundToneGain(ring, ringBurst, tone), ring.gain / 2);
  }
  const ringback = CALL_SOUNDS.ringback;
  const [ringbackBurst] = callSoundBursts(ringback, { fromMs: 0, untilMs: 1 });
  assert.equal(
    callSoundToneGain(ringback, ringbackBurst, ringbackBurst.tones[0]),
    ringback.gain,
  );
  assert.equal(callSoundToneGain(ring, { tones: [] }, { hz: 440, level: 1 }), 0);

  // And it is a question about the **burst**, which is the whole reason it
  // moved: a level divided by a count taken from the spec could not have said
  // that a sound rings on two tones and resolves on one.
  const notification = CALL_SOUNDS.notification;
  const [ping] = callSoundBursts(notification, { fromMs: 0, untilMs: 1 });
  assert.ok(
    Math.abs(callSoundToneGain(notification, ping, ping.tones[0]) - notification.gain / 1.18) < 1e-12,
  );
});

test("a tone's level is a share, and the shares of a burst add up to the sound", () => {
  // The invariant the division has always kept, now stated over unequal
  // shares: whatever the levels are, a burst cannot be louder than its sound.
  for (const name of Object.keys(CALL_SOUNDS) as CallSoundName[]) {
    const spec = CALL_SOUNDS[name];
    for (const burst of callSoundBursts(spec, { fromMs: 0, untilMs: callSoundCycleMs(spec) })) {
      const total = burst.tones.reduce(
        (sum, tone) => sum + callSoundToneGain(spec, burst, tone),
        0,
      );
      assert.ok(
        Math.abs(total - spec.gain) < 1e-12,
        `${name}: tones summed to ${total} against a budget of ${spec.gain}`,
      );
    }
  }

  // Shares are relative, so scaling every level of a burst changes nothing.
  const loud = { tones: [{ hz: 100, level: 4 }, { hz: 200, level: 1 }] };
  const quiet = { tones: [{ hz: 100, level: 1 }, { hz: 200, level: 0.25 }] };
  const spec = CALL_SOUNDS.join;
  assert.equal(
    callSoundToneGain(spec, loud, loud.tones[0]),
    callSoundToneGain(spec, quiet, quiet.tones[0]),
  );
  // Four fifths of the budget. Compared with a tolerance rather than exactly:
  // `0.1 * 4 / 5` and `0.1 * 0.8` are different doubles, and a test that fails
  // on which order the same arithmetic was written in is testing nothing.
  assert.ok(Math.abs(callSoundToneGain(spec, loud, loud.tones[0]) - spec.gain * 0.8) < 1e-15);
});

// ---------------------------------------------------------------------------
// The model: a step says for itself whether it sounds
// ---------------------------------------------------------------------------

test("a step with no tones is a rest, and a burst carries its own step's tones", () => {
  const spec: CallSoundSpec = {
    name: "join",
    gain: 0.1,
    attackMs: 1,
    releaseMs: 1,
    decay: "linear",
    cadence: [
      { tones: equalTones(100), durationMs: 10 },
      { tones: [], durationMs: 20 },
      { tones: equalTones(200, 300), durationMs: 30 },
      { tones: [], durationMs: 40 },
    ],
    loop: false,
  };
  assert.equal(callSoundCycleMs(spec), 100);
  assert.deepEqual(callSoundBursts(spec, { fromMs: 0, untilMs: 100 }), [
    { atMs: 0, durationMs: 10, tones: equalTones(100) },
    { atMs: 30, durationMs: 30, tones: equalTones(200, 300) },
  ]);

  // And this is what the parity convention could not survive: prepending one
  // rest used to make every burst silent and every silence a burst, with
  // nothing anywhere saying so. Now it moves the same two bursts 5 ms later.
  const shifted: CallSoundSpec = {
    ...spec,
    cadence: [{ tones: [], durationMs: 5 }, ...spec.cadence],
  };
  assert.deepEqual(callSoundBursts(shifted, { fromMs: 0, untilMs: 105 }), [
    { atMs: 5, durationMs: 10, tones: equalTones(100) },
    { atMs: 35, durationMs: 30, tones: equalTones(200, 300) },
  ]);
});

// ---------------------------------------------------------------------------
// The four a voice channel makes
// ---------------------------------------------------------------------------

const VOICE_SOUNDS: CallSoundName[] = ["join", "leave", "mute", "unmute"];

test("join and leave are one figure seen from both ends", () => {
  const up = pitchesOf(CALL_SOUNDS.join);
  const down = pitchesOf(CALL_SOUNDS.leave);
  // Two notes in sequence, which is the thing the old model could not express
  // and the reason it grew.
  assert.equal(up.length, 2);
  assert.deepEqual(down, [...up].reverse());
  assert.ok(up[0] < up[1], `an arrival rises: ${up[0]} then ${up[1]}`);
  assert.ok(down[0] > down[1], `a departure falls: ${down[0]} then ${down[1]}`);
  // A perfect fifth either way. No third in it, so it is neither major nor
  // minor and neither sound reads as cheerful or as sad.
  assert.ok(Math.abs(up[1] / up[0] - 1.5) < 0.005, `a fifth, not ${up[1] / up[0]}`);
  // The same timing, for the reason the ring and the ringback share theirs.
  assert.deepEqual(timingOf(CALL_SOUNDS.leave), timingOf(CALL_SOUNDS.join));
});

test("the four are two pitches, and how many notes says whose event it is", () => {
  const pitches = [...new Set(VOICE_SOUNDS.flatMap((name) => pitchesOf(CALL_SOUNDS[name])))];
  assert.deepEqual(
    pitches.sort((a, b) => a - b),
    [440, 659.25],
    "one small consonant set, and 440 is the tone the ring already sounds on",
  );
  // One note is a control **you** pressed; two notes is the room telling you
  // something. That is the whole of how the four are told apart by ear.
  assert.deepEqual(pitchesOf(CALL_SOUNDS.mute), [440]);
  assert.deepEqual(pitchesOf(CALL_SOUNDS.unmute), [659.25]);
  // Low is off, high is on — the same direction the two-note figures carry.
  assert.ok(pitchesOf(CALL_SOUNDS.mute)[0] < pitchesOf(CALL_SOUNDS.unmute)[0]);
});

// ---------------------------------------------------------------------------
// The timbre: partials, and a fall that is not a straight line
// ---------------------------------------------------------------------------

test("a voice-channel note is a fundamental with partials under it", () => {
  for (const name of VOICE_SOUNDS) {
    for (const tones of shapeOf(CALL_SOUNDS[name])) {
      assert.ok(tones.length > 1, `${name} must be more than one sinusoid`);
      const [first, ...rest] = tones;
      assert.equal(first.level, 1, `${name}: the fundamental carries the level`);
      for (const partial of rest) {
        // Well under, not merely under: a partial at 0.8 is a second note.
        assert.ok(
          partial.level <= first.level / 3,
          `${name}: a partial at ${partial.level} would be heard as a note of its own`,
        );
        // Whole multiples fuse into one note. Anything else is a chord.
        const ratio = partial.hz / first.hz;
        assert.ok(
          Math.abs(ratio - Math.round(ratio)) < 1e-9 && ratio > 1,
          `${name}: ${partial.hz} is ${ratio} times the fundamental`,
        );
      }
    }
  }
});

test("nothing sits below the fundamental, which was measured rather than assumed", () => {
  // A sub-octave is about 16 dB down on a telephone's loudspeaker and takes
  // 1.6 dB from the partials that are not. The budget to pay that back does not
  // exist under the 0.1 ceiling, so it is a rendered candidate and not a tone.
  for (const name of VOICE_SOUNDS) {
    for (const tones of shapeOf(CALL_SOUNDS[name])) {
      const lowest = Math.min(...tones.map((tone) => tone.hz));
      const fundamentalHz = tones.reduce((best, tone) => (tone.level > best.level ? tone : best)).hz;
      assert.equal(lowest, fundamentalHz, `${name} carries a tone under its own pitch`);
      assert.ok(lowest >= 440, `${name} at ${lowest} Hz is below what a telephone reproduces`);
    }
  }
});

test("a telephone is plain while the short cues are struck", () => {
  for (const name of ["ring", "ringback"] as CallSoundName[]) {
    assert.equal(CALL_SOUNDS[name].decay, "linear", `${name} must stay plain`);
  }
  for (const name of ["notification", ...VOICE_SOUNDS] as CallSoundName[]) {
    assert.equal(CALL_SOUNDS[name].decay, "exponential");
  }
});

test("an exponential fall is most of the way down in a third of the time", () => {
  const spec = CALL_SOUNDS.mute;
  const duration = callSoundCycleMs(spec);
  const { attackMs, releaseMs } = callSoundEnvelope(spec, duration);
  const releaseStart = duration - releaseMs;
  const at = (ms: number) => callSoundEnvelopeLevel(spec, duration, ms);

  assert.equal(at(0), 0, "silence at the very start");
  assert.equal(at(attackMs), 1, "up to the peak over the attack, in a straight line");
  assert.equal(at(attackMs / 2), 0.5);
  assert.equal(at(releaseStart), 1, "held until the fall begins");
  assert.equal(at(duration), 0, "and nothing at the end");

  // A third of the way down the release, a straight line is at 0.67 and this is
  // far below it. That difference is what «struck» rather than «switched off»
  // sounds like.
  const third = at(releaseStart + releaseMs / 3);
  assert.ok(third < 0.32, `a third of the way in, the level is ${third}`);
  assert.ok(third > 0.2, `and it is a decay rather than a cliff: ${third}`);
  // Monotone all the way down, which a badly joined tail would not be.
  let previous = 1;
  for (let ms = releaseStart; ms <= duration; ms += 0.25) {
    const level = at(ms);
    assert.ok(level <= previous + 1e-12, `the fall went back up at ${ms}ms`);
    previous = level;
  }

  // The same sound with a straight fall is exactly the straight line, which is
  // what the three telephone sounds still get.
  const plain = { ...spec, decay: "linear" as const };
  assert.ok(
    Math.abs(callSoundEnvelopeLevel(plain, duration, releaseStart + releaseMs / 3) - 2 / 3) < 1e-9,
  );
});

test("the curve the player hands the browser is the shape the file renders", () => {
  // The player samples `callSoundEnvelopeCurve` and Web Audio joins the points
  // with straight lines. This measures how far that polyline can stray from the
  // function the `.wav` is rendered from — the one number that decides whether
  // «the same arithmetic» survives the trip through an automation curve.
  for (const name of Object.keys(CALL_SOUNDS) as CallSoundName[]) {
    const spec = CALL_SOUNDS[name];
    for (const burst of callSoundBursts(spec, { fromMs: 0, untilMs: callSoundCycleMs(spec) })) {
      const curve = callSoundEnvelopeCurve(spec, burst.durationMs);
      assert.equal(curve.length, callSoundEnvelopeCurvePoints(burst.durationMs));
      assert.equal(curve[0], 0);
      assert.equal(curve[curve.length - 1], 0);
      let worst = 0;
      for (let step = 0; step <= 4_000; step += 1) {
        const atMs = (step / 4_000) * burst.durationMs;
        const position = (atMs / burst.durationMs) * (curve.length - 1);
        const low = Math.min(curve.length - 1, Math.floor(position));
        const high = Math.min(curve.length - 1, low + 1);
        const interpolated = curve[low] + (curve[high] - curve[low]) * (position - low);
        worst = Math.max(
          worst,
          Math.abs(interpolated - callSoundEnvelopeLevel(spec, burst.durationMs, atMs)),
        );
      }
      assert.ok(worst < 0.002, `${name}: the curve strays ${worst} from the shape`);
    }
  }
});

test("nothing a voice channel makes competes with speech", () => {
  const quietest = Math.min(CALL_SOUNDS.notification.gain, CALL_SOUNDS.ring.gain);
  for (const name of VOICE_SOUNDS) {
    const spec = CALL_SOUNDS[name];
    assert.equal(spec.loop, false, `${name} must not loop`);
    assert.ok(spec.gain <= quietest, `${name} at ${spec.gain} must sit at or under ${quietest}`);
    assert.ok(callSoundCycleMs(spec) < 400, `${name} runs ${callSoundCycleMs(spec)}ms`);
    // Soft in, long out: a tone that stops dead reads as a beep and one that
    // falls away reads as a bell. Every burst has room for its own envelope,
    // so none of them is silently scaled down to fit.
    assert.ok(spec.releaseMs >= spec.attackMs * 4, `${name}'s release must outlast its attack`);
    for (const burst of callSoundBursts(spec, { fromMs: 0, untilMs: callSoundCycleMs(spec) })) {
      assert.deepEqual(
        callSoundEnvelope(spec, burst.durationMs),
        { attackMs: spec.attackMs, releaseMs: spec.releaseMs },
        `${name}'s ${burst.durationMs}ms burst is too short for its own envelope`,
      );
    }
  }
  // A control blip is quieter than a room event: it sounds while **you** are
  // the one talking, several times in a conversation.
  assert.ok(CALL_SOUNDS.mute.gain < CALL_SOUNDS.join.gain);
  assert.equal(CALL_SOUNDS.mute.gain, CALL_SOUNDS.unmute.gain);
  assert.equal(CALL_SOUNDS.join.gain, CALL_SOUNDS.leave.gain);
});

// ---------------------------------------------------------------------------
// The unchanged telephone sounds, pinned burst for burst
// ---------------------------------------------------------------------------

test("the telephone sounds did not move", () => {
  // The left-hand side of this was generated from `lib/callSounds.ts` as it
  // stood at **6f2a4fba** — the commit that last touched it before any of this
  // work, when a spec was a list of frequencies and a burst had no pitches of
  // its own — by `scripts/call-sound-baseline.mjs --against 6f2a4fba`, which
  // imports the module at a git revision, plans four cycles of each sound
  // through that module's own pure functions, and diffs burst for burst. The
  // same builder produces the right-hand side here, so this is that comparison
  // frozen rather than a second description of it.
  //
  // Named by the commit that touched the **file**, not by whatever `HEAD` was
  // at the time: this branch carries several agents' work, the commit this
  // comment used to name never contained this file at all, and `--against HEAD`
  // silently compares against whoever committed last.
  //
  // Four cycles rather than one: the second is where an off-by-one in the cycle
  // arithmetic shows. The notification's non-looping limit is tested above.
  const telephoneBursts = [0, 700, 3_200, 3_900, 6_400, 7_100, 9_600, 10_300];
  const expected: Record<string, unknown[]> = {
    ring: telephoneBursts.map((atMs) => ({
      atMs,
      durationMs: 500,
      decay: "linear",
      voices: [
        { hz: 440, gain: 0.08 },
        { hz: 480, gain: 0.08 },
      ],
      attackMs: 18,
      releaseMs: 70,
    })),
    ringback: telephoneBursts.map((atMs) => ({
      atMs,
      durationMs: 500,
      decay: "linear",
      voices: [{ hz: 425, gain: 0.07 }],
      attackMs: 18,
      releaseMs: 70,
    })),
  };
  for (const [name, rows] of Object.entries(expected)) {
    assert.deepEqual(callSoundPlan(callSoundsModule, name), rows, `${name} moved`);
  }
});

test("an envelope never outlasts the burst it shapes", () => {
  const ring = CALL_SOUNDS.ring;
  const whole = callSoundEnvelope(ring, 500);
  assert.deepEqual(whole, { attackMs: ring.attackMs, releaseMs: ring.releaseMs });
  assert.ok(whole.attackMs + whole.releaseMs <= 500);

  // A burst shorter than its own envelope is one edit away — shorten a cadence
  // step, lengthen a release — and a ramp that ends after the oscillator has
  // stopped leaves the gain wherever it had got to.
  const squeezed = callSoundEnvelope(ring, 40);
  assert.ok(squeezed.attackMs + squeezed.releaseMs <= 40 + 1e-9);
  assert.ok(squeezed.attackMs > 0 && squeezed.releaseMs > 0, "and it still has a shape");
  assert.deepEqual(callSoundEnvelope(ring, 0), { attackMs: 0, releaseMs: 0 });
});

// ---------------------------------------------------------------------------
// Which sound belongs to which state — and therefore every way one stops
// ---------------------------------------------------------------------------

test("only a ringing ring sounds, and which end you are decides what", () => {
  assert.equal(voiceRingSound({ state: "ringing", direction: "incoming", enabled: true }), "ring");
  assert.equal(
    voiceRingSound({ state: "ringing", direction: "outgoing", enabled: true }),
    "ringback",
  );
  // A ring belonging to nobody is silence rather than a default.
  assert.equal(voiceRingSound({ state: "ringing", direction: null, enabled: true }), null);
});

test("every way a call ends is silence, and not one of them is a special case", () => {
  // The five paths the surface has to survive, and what each one is in terms of
  // the row: answered here or on another device sets the second timestamp;
  // declined, cancelled, hung up and «the tab was hidden while it ended» all
  // clear the row, which the picker reports as no ring at all — `idle` here;
  // forty-five seconds with no answer is `expired`. The unmount is the sixth
  // and is the effect's own cleanup, which has no state to be asked about.
  for (const state of ["idle", "answered", "expired"] as CallRingState[]) {
    for (const direction of ["incoming", "outgoing"] as const) {
      assert.equal(
        voiceRingSound({ state, direction, enabled: true }),
        null,
        `${state} from the ${direction} end must be silent`,
      );
    }
  }
});

test("the setting silences every state, not merely the next one", () => {
  for (const state of ["idle", "ringing", "answered", "expired"] as CallRingState[]) {
    for (const direction of ["incoming", "outgoing"] as const) {
      assert.equal(voiceRingSound({ state, direction, enabled: false }), null);
    }
  }
});

test("a transition stops what is playing before it starts anything else", () => {
  assert.deepEqual(callSoundTransition({ playing: null, wanted: "ring" }), {
    stop: null,
    start: "ring",
  });
  assert.deepEqual(callSoundTransition({ playing: "ring", wanted: null }), {
    stop: "ring",
    start: null,
  });
  // A caller whose own call is answered nowhere but whose direction flips —
  // which happens when two people call each other within the same second and
  // the picker changes its mind about which ring is «the» ring.
  assert.deepEqual(callSoundTransition({ playing: "ringback", wanted: "ring" }), {
    stop: "ringback",
    start: "ring",
  });
  // And the same sound is not restarted. A ring that began again on every
  // re-render would never reach its second burst.
  assert.deepEqual(callSoundTransition({ playing: "ring", wanted: "ring" }), {
    stop: null,
    start: null,
  });
  assert.deepEqual(callSoundTransition({ playing: null, wanted: null }), {
    stop: null,
    start: null,
  });
});

// ---------------------------------------------------------------------------
// The notification's three refusals
// ---------------------------------------------------------------------------

const ANOTHER_CHAT = "22222222-2222-4222-8222-000000000002";
const OPEN_CHAT = "22222222-2222-4222-8222-000000000001";

function ping(over: Partial<Parameters<typeof notificationSoundAllowed>[0]> = {}) {
  return notificationSoundAllowed({
    enabled: true,
    ringing: null,
    chatId: ANOTHER_CHAT,
    openChatId: OPEN_CHAT,
    documentHidden: false,
    osToast: false,
    ...over,
  });
}

test("a notification sounds when it is about a conversation nobody is reading", () => {
  assert.equal(ping(), true);
});

test("a notification does not ping over a ringtone", () => {
  // The commonest case of all: a message from the person who is calling.
  assert.equal(ping({ ringing: "ring" }), false);
  assert.equal(ping({ ringing: "ringback" }), false);
});

test("a notification does not sound for the conversation on screen", () => {
  assert.equal(ping({ chatId: OPEN_CHAT }), false);
  // Unless the window is behind something, in which case the same conversation
  // is not being read and the sound is the only notice there is.
  assert.equal(ping({ chatId: OPEN_CHAT, documentHidden: true }), true);
});

test("a notification the shell is already announcing does not sound twice", () => {
  // The Windows application raises a real toast for the same row and Windows
  // plays its own sound for it. The operating system's is the one the person
  // has tuned — focus assist, the volume mixer, their notification settings —
  // and this one obeys none of them, so this one is the one that gives way.
  assert.equal(ping({ osToast: true }), false);
  // And a shell that raises no toast is the ordinary browser, which is where
  // this sound is the only notice there is.
  assert.equal(ping({ osToast: false }), true);
});

test("a notification that belongs to no conversation still sounds", () => {
  // An invitation, a moderation notice, a support reply. `chatId` is null and
  // nothing about «the chat being read» can apply to it.
  assert.equal(ping({ chatId: null }), true);
  assert.equal(ping({ chatId: null, openChatId: null }), true);
});

test("the notification switch is not the call switch", () => {
  assert.equal(ping({ enabled: false }), false);
  // Somebody who wants a silent office still wants their telephone to ring, so
  // the two are read from two different fields and neither implies the other.
  assert.equal(voiceRingSound({ state: "ringing", direction: "incoming", enabled: true }), "ring");
});

// ---------------------------------------------------------------------------
// The stored setting, and what every value written before today means
// ---------------------------------------------------------------------------

test("both sounds are on unless somebody turned them off", () => {
  assert.equal(CALL_SOUND_DEFAULT, true);
  assert.equal(NOTIFICATION_SOUND_DEFAULT, true);
  assert.equal(readCallSoundEnabled(undefined), true);
  assert.equal(readNotificationSoundEnabled(undefined), true);
  // A stored `false` is taken seriously; a stored anything-else is not a
  // setting at all and reads as the default.
  assert.equal(readCallSoundEnabled(false), false);
  assert.equal(readNotificationSoundEnabled(false), false);
  assert.equal(readCallSoundEnabled("false"), true);
  assert.equal(readNotificationSoundEnabled(0), true);
});

test("a settings blob written before 2026-09-18 still means what it meant", () => {
  // Exactly the shape `kub:audio-settings:v1` held yesterday: no sound keys at
  // all. Every other field has to survive unchanged, and the two new ones have
  // to arrive on — which is the state the owner asked for.
  const stored = normalizeAudioSettings({
    micInputGain: 1.4,
    voicePlaybackVolume: 0.5,
    processingMode: "raw",
    noiseSuppression: false,
    echoCancellation: false,
    autoGainControl: false,
    monitorGain: 0.3,
    selectedInputDeviceId: "mic-7",
    micActivation: "ptt",
    micTalkKey: "F8",
  });
  assert.equal(stored.micInputGain, 1.4);
  assert.equal(stored.processingMode, "raw");
  assert.equal(stored.micActivation, "ptt");
  assert.equal(stored.micTalkKey, "F8");
  assert.equal(stored.selectedInputDeviceId, "mic-7");
  assert.equal(stored.callSoundEnabled, true);
  assert.equal(stored.notificationSoundEnabled, true);

  // And the two are stored independently of each other.
  assert.deepEqual(
    [
      normalizeAudioSettings({ callSoundEnabled: false }).callSoundEnabled,
      normalizeAudioSettings({ callSoundEnabled: false }).notificationSoundEnabled,
      normalizeAudioSettings({ notificationSoundEnabled: false }).callSoundEnabled,
      normalizeAudioSettings({ notificationSoundEnabled: false }).notificationSoundEnabled,
    ],
    [false, true, true, false],
  );
});
