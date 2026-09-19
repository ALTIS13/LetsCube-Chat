/**
 * The wiring between the call's state and the rule that decides what it sounds.
 *
 * `lib/callSounds.ts` says what the four sounds **are**, `lib/voiceRoomSound.ts`
 * says when one may fire, `lib/callSoundPlayer.ts` owns the `AudioContext`. This
 * is the fourth thing none of them can be: the part that remembers what was
 * last read, notices that something moved, and comes back on a clock for a
 * departure that matures with nothing else happening.
 *
 * It lives here rather than inside `hooks/useVoiceCall.ts` for the reason
 * CLAUDE.md records and the head of every module named above repeats: a
 * decision inside a `"use client"` module is a decision with no test. That is
 * not an abstract worry here. The failure this whole layer exists to prevent —
 * a sound storm under a transport that re-establishes every fifteen seconds —
 * is a property of *this* code and not of the rule: the rule is a pure
 * function and cannot storm, while a caller that schedules a wake without
 * cancelling the last one storms beautifully while every rule test stays green.
 * So this module imports nothing but the rule, `node --test` walks all of it,
 * and `tests/unit/voice-room-sound-driver.test.mjs` drives it through the storm
 * shape that was actually measured on 2026-09-19.
 *
 * ## Why it reads the call's state rather than listening for events
 *
 * The same reason `useVoiceRingSound` does, and it pays off in the same place.
 * A call ends in eight ways — leaving, a room that disappeared, a failed join,
 * a transport that closed, a conversation changed, a tab torn down — and every
 * one of them arrives at `publish()` in `hooks/useVoiceCall.ts` as a state
 * whose phase is no longer `connected`. Not one of them needs a handler here,
 * and a missed event cannot leave the rule believing in a room this person left
 * ten minutes ago.
 *
 * ## The one thing a phase change alone must not do
 *
 * `observe` is called on every publish, and a publish carries both the phase
 * and the roster — but the roster it carries is the last one the transport
 * delivered, which after a reconnect is **from before the transport dropped**.
 * Feeding that to the rule would consume the re-baseline with a stale reading,
 * and the fresh roster arriving a moment later would then be diffed against it:
 * anybody who came or went while the socket was down would be announced, which
 * is exactly the announcement the re-baseline exists to suppress.
 *
 * So a move to `connected` is fed to the rule only while the stay has not been
 * baselined yet. That single condition serves both cases and they are not the
 * same case:
 *
 *  - **the join**, where the first roster arrives *during* `joining` — the seam
 *    reports from inside `VoiceRoom.join`, before the hook has patched the
 *    phase — so the phase change is the only moment the rule can be told we
 *    have arrived, and `inRoom` is still false;
 *  - **the reconnect**, where `inRoom` is true, the rebaseline is left armed,
 *    and the roster the seam re-reports immediately afterwards consumes it.
 *
 * That ordering is `hooks/voiceRoom.ts`'s: `RoomEvent.Reconnected` calls
 * `onReconnected()` and *then* `reportAndAnnounce()`. `tests/unit/voice-room-seam.test.mjs`
 * pins it by position, because reversing those two lines would leave the
 * rebaseline armed across a real arrival and swallow it.
 */

import type { VoiceCallPhase } from "./voiceChannel.ts";
import {
  voiceRoomSound,
  voiceRoomSoundInitial,
  voiceSelfControlSound,
  type VoiceRoomPhase,
  type VoiceRoomSoundName,
  type VoiceRoomSoundState,
} from "./voiceRoomSound.ts";

/**
 * What a phase of the *call* means to the rule.
 *
 * Three of the five collapse to `away`, and that is the whole of the mapping's
 * risk: `reconnecting` must not be one of them. A transport being re-established
 * is not a room this person left — reading it as `away` would sound a departure
 * on the way down and an arrival on the way back up, which at the rate measured
 * on 2026-09-19 is four sounds a minute per person for a call nobody touched.
 *
 * `failed` is `away` on purpose, and it is not only the refused join: it is also
 * the call that ended without being asked to (`onClosed`, «Звонок прерван»).
 * The room really did go silent, and the person is really no longer in it, so it
 * gets the departure a deliberate «Выйти» gets. A refused join sounds nothing,
 * because the rule only announces a departure from a room it believed we were
 * in.
 *
 * Exhaustive over `VoiceCallPhase` rather than a `default`, so adding a sixth
 * phase is a type error here instead of a silent `away`.
 */
export function voiceRoomPhaseOf(phase: VoiceCallPhase): VoiceRoomPhase {
  switch (phase) {
    case "connected":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "idle":
    case "joining":
    case "failed":
      return "away";
  }
}

/** One reading of the call, as `VoiceCallState` already carries it. */
export interface VoiceCallSoundReading {
  readonly phase: VoiceCallPhase;
  /**
   * The roster, as the store holds it.
   *
   * Compared by **identity** rather than by content, which is what tells a
   * roster the transport delivered from a publish about something else — a
   * mute, a revoked permission, a refused output device. `hooks/voiceRoom.ts`
   * rebuilds the list on every event and never patches one, so a new array is
   * exactly «the transport said something about who is here».
   */
  readonly participants: readonly { readonly userId: string }[];
  /** Ours, as the gateway minted the token with it. Null before it is known. */
  readonly selfUserId: string | null;
  readonly micMuted: boolean;
  readonly deafened: boolean;
  /** `AudioSettings.callSoundEnabled`, read at the moment of the reading. */
  readonly enabled: boolean;
}

/** The browser, as this module needs it: a clock, a timer and a player. */
export interface VoiceRoomSoundHost {
  now(): number;
  /** Schedule one wake, and answer with its cancel. */
  schedule(delayMs: number, fire: () => void): () => void;
  play(sound: VoiceRoomSoundName): void;
}

export interface VoiceRoomSoundDriver {
  /** Take a reading. Cheap when nothing that matters has moved. */
  observe(reading: VoiceCallSoundReading): void;
  /**
   * Forget everything and cancel the pending wake, without sounding anything.
   *
   * For a test, and for the one teardown a state machine cannot see: the tab
   * going away. Silent by construction — it is the one door into this module
   * that never reaches `play`, which is what makes «nothing sounds during
   * teardown» a property of the code rather than a hope about the ordering.
   */
  forget(): void;
}

export function createVoiceRoomSoundDriver(host: VoiceRoomSoundHost): VoiceRoomSoundDriver {
  let state: VoiceRoomSoundState = voiceRoomSoundInitial();
  let lastPhase: VoiceRoomPhase | null = null;
  let lastReading: VoiceCallSoundReading | null = null;
  /**
   * The cancel of the one pending wake, or null.
   *
   * **At most one, ever.** This is the field the storm test is really about: a
   * version that scheduled without cancelling would accumulate a timer per
   * roster reading, and a flapping room would then announce the same departure
   * once per timer — a storm the rule cannot prevent, because by then it is
   * being asked the question hundreds of times.
   */
  let cancelWake: (() => void) | null = null;
  /**
   * What the two controls were at the last reading, or null for «not read yet».
   *
   * Null is what `voiceSelfControlSound` answers nothing to, and it is restored
   * on every `away` reading. That is not tidiness: leaving a call while muted
   * moves `micMuted` from true to false in the same publish that ends the call,
   * so without the reset a departure would be a leave **and** an unmute blip
   * over the top of it. Joining a call already muted is the same shape from the
   * other end — a state rather than a press, and silent for the same reason.
   */
  let mutedBefore: boolean | null = null;
  let deafenedBefore: boolean | null = null;

  const forgetWake = () => {
    if (cancelWake === null) return;
    cancelWake();
    cancelWake = null;
  };

  /** Ask the rule, sound what it allows, and arm at most one wake. */
  const feed = (reading: VoiceCallSoundReading, phase: VoiceRoomPhase) => {
    forgetWake();
    const decision = voiceRoomSound(state, {
      phase,
      selfUserId: reading.selfUserId,
      userIds: reading.participants.map((who) => who.userId),
      nowMs: host.now(),
      enabled: reading.enabled,
      deafened: reading.deafened,
    });
    state = decision.state;
    if (decision.sound !== null) host.play(decision.sound);
    if (decision.wakeAtMs === null) return;
    // A departure matures on a clock — the roster does not change again just
    // because somebody stayed gone — so the rule has to be asked again with
    // nothing new to tell it. The reading is the one in hand: at most
    // `VOICE_DEPARTURE_GRACE_MS` old by the time it is used again.
    cancelWake = host.schedule(Math.max(0, decision.wakeAtMs - host.now()), () => {
      cancelWake = null;
      if (lastReading === null || lastPhase === null) return;
      feed(lastReading, lastPhase);
    });
  };

  const observe = (reading: VoiceCallSoundReading) => {
    const phase = voiceRoomPhaseOf(reading.phase);
    const phaseMoved = phase !== lastPhase;
    const rosterMoved = lastReading === null || reading.participants !== lastReading.participants;
    lastPhase = phase;
    lastReading = reading;

    // The controls this person pressed, first and separately. They are not
    // subject to the roster's floor and not refused while deafened — the rule
    // says so and says why — so they do not go through `feed` at all.
    //
    // Read from the state rather than hung on the two press handlers, and two
    // consequences of that are worth naming rather than discovering:
    // a **moderator's** force-mute moves `micMuted` too and therefore blips,
    // which is honest — the microphone really did go off and nobody here
    // touched it; and a mute the transport **refuses** blips twice, once on the
    // optimistic patch and once on the revert, which is the same bounce the
    // button itself performs and is the only honest sound for it.
    if (phase === "away") {
      mutedBefore = null;
      deafenedBefore = null;
    } else {
      // Deafen is asked first and `??` stops there when it answers, because
      // deafening moves **both** flags in one publish — `setVoiceDeafened`
      // patches `{ deafened, micMuted }` together — and the two would otherwise
      // be two blips for one press. They always move in the same direction, so
      // the one that is dropped would have been the same sound.
      const blip =
        voiceSelfControlSound({
          silenced: reading.deafened,
          previous: deafenedBefore,
          enabled: reading.enabled,
        }) ??
        voiceSelfControlSound({
          silenced: reading.micMuted,
          previous: mutedBefore,
          enabled: reading.enabled,
        });
      deafenedBefore = reading.deafened;
      mutedBefore = reading.micMuted;
      if (blip !== null) host.play(blip);
    }

    // Nothing the room could have said has changed. Every other publish — a
    // refused output device, a revoked permission, a mute — costs two
    // comparisons and stops here.
    if (!phaseMoved && !rosterMoved) return;
    // A move to `connected` with the stay already baselined is a reconnect, and
    // the roster in hand is from before the socket dropped. Leave the rebaseline
    // armed for the fresh one; see the header.
    if (phaseMoved && !rosterMoved && phase === "connected" && state.inRoom) return;
    feed(reading, phase);
  };

  const forget = () => {
    forgetWake();
    state = voiceRoomSoundInitial();
    lastPhase = null;
    lastReading = null;
    mutedBefore = null;
    deafenedBefore = null;
  };

  return { observe, forget };
}
