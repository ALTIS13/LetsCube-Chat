import assert from "node:assert/strict";
import test from "node:test";

import {
  CALL_SOUNDS,
  CALL_SOUND_DEFAULT,
  NOTIFICATION_SOUND_DEFAULT,
  callSoundBursts,
  callSoundCycleMs,
  callSoundEnvelope,
  callSoundToneGain,
  callSoundTransition,
  notificationSoundAllowed,
  readCallSoundEnabled,
  readNotificationSoundEnabled,
  voiceRingSound,
  type CallRingState,
} from "../../artifacts/kub/src/lib/callSounds.ts";
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

test("a ring is a double burst and then two seconds of nothing", () => {
  const ring = CALL_SOUNDS.ring;
  assert.deepEqual([...ring.cadenceMs], [500, 200, 500, 2000]);
  assert.equal(callSoundCycleMs(ring), 3_200);

  // One cycle: two bursts, 500 ms each, the second beginning 700 ms in.
  const first = callSoundBursts(ring, { fromMs: 0, untilMs: 3_200 });
  assert.deepEqual(first, [
    { atMs: 0, durationMs: 500 },
    { atMs: 700, durationMs: 500 },
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
    { atMs: 3_200, durationMs: 500 },
    { atMs: 3_900, durationMs: 500 },
  ]);
});

test("the ringback is the ring's cadence, single-toned and quieter", () => {
  const ring = CALL_SOUNDS.ring;
  const ringback = CALL_SOUNDS.ringback;
  // The same array, not a copy of its numbers: the two are one object seen from
  // its two ends, and a second cadence would be a second place to drift.
  assert.equal(ringback.cadenceMs, ring.cadenceMs);
  assert.equal(ring.frequencies.length, 2, "a telephone rings on two tones");
  assert.equal(ringback.frequencies.length, 1, "a ringback is one");
  assert.ok(
    ringback.gain < ring.gain / 2,
    `a caller's own ringback must be well under the ring: ${ringback.gain} vs ${ring.gain}`,
  );
});

test("a notification is one short tone, however far ahead it is asked about", () => {
  const spec = CALL_SOUNDS.notification;
  assert.equal(spec.loop, false);
  assert.equal(spec.frequencies.length, 1);
  assert.ok(callSoundCycleMs(spec) <= 400, "one tone, not a phrase");
  const forever = callSoundBursts(spec, { fromMs: 0, untilMs: 600_000 });
  assert.deepEqual(forever, [{ atMs: 0, durationMs: 220 }]);
});

test("the level is shared between the tones rather than added up", () => {
  // Two sines at the spec's gain do not make that sound; they make one twice as
  // loud, which clips against everything else the page is playing.
  assert.equal(callSoundToneGain(CALL_SOUNDS.ring), CALL_SOUNDS.ring.gain / 2);
  assert.equal(callSoundToneGain(CALL_SOUNDS.ringback), CALL_SOUNDS.ringback.gain);
  assert.equal(callSoundToneGain({ ...CALL_SOUNDS.ring, frequencies: [] }), 0);
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
