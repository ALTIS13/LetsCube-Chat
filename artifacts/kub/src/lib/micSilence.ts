/**
 * What a moderator's silence does to somebody's own microphone, and what
 * lifting it gives back.
 *
 * The defect this module exists for, measured on 2026-09-20: a moderator
 * pressed «Разрешить говорить» and the person stayed silent. Nothing was
 * broken on the wire — the permission really did come back — and the reason is
 * one sentence long, in three layers.
 *
 * **The server actively unpublishes and passively restores.** `SetPermission`
 * in `pkg/rtc/participant.go` walks `GetPublishedTracks()` and calls
 * `removePublishedTrack` for every source the new grant no longer allows;
 * giving the grant back only calls `OnParticipantUpdate`. There is no
 * «republish now» signal, by design: the client is the one holding the capture.
 *
 * **The SDK forwards that and does nothing else.** The `trackUnpublished`
 * signal reaches `LocalParticipant.handleLocalTrackUnpublished`, which calls
 * `unpublishTrack(track)` with no `stopOnUnpublish`, so the room option decides
 * — and `hooks/voiceRoom.ts` sets `stopLocalTrackOnUnpublish: false`, which
 * makes it `track.stopMonitor()` rather than `track.stop()`. `stopMonitor`
 * clears a stats interval and a rAF handle; it touches neither
 * `MediaStreamTrack.enabled` nor `LocalTrack.isMuted`. The publication is
 * deleted from the participant's maps, the sender is removed and the
 * transceiver is set `inactive`. On the way back,
 * `Room.onLocalParticipantPermissionsChanged` **only emits** — livekit-client
 * 2.22.3, all of it read rather than supposed.
 *
 * So the track is *unpublished*, not stopped and not refused: the capture is
 * still live, still enabled, still the same `MediaStreamTrack`, and nothing is
 * carrying it. The repair is therefore **republish**, which is what
 * `VoiceRoom.setMuted(false)` already does — and the only question left is the
 * one this module answers: should it be asked to.
 *
 * ## The two properties, which is why this is a module and not an `if`
 *
 * **Restoring a permission is not consent to open somebody's microphone.** A
 * person who muted themselves and was then silenced by a moderator has pressed
 * a control; lifting the silence must not un-press it. That needs the mute they
 * had *before* the silence to survive the silence, and it cannot be read off
 * the state at the moment of the lift — `useVoiceCall` forces `micMuted` to
 * true on the way in, deliberately, so that the interface does not draw a live
 * microphone over audio nobody is carrying.
 *
 * **Deafening still wins.** Somebody who cannot hear the room must not be put
 * back on the air by a permission change they did not ask for; the pair is the
 * same one `setVoiceDeafened` already keeps.
 *
 * It imports nothing, for the reason written at the head of `lib/micGate.ts`
 * and again in CLAUDE.md: a decision inside a `"use client"` module is a
 * decision with no test. `tests/unit/mic-silence.test.mjs` holds every line
 * below, and four mutations of them go red.
 */

/**
 * What has to be remembered across a silence.
 *
 * `mutedBefore` is meaningless while `silenced` is false and is deliberately
 * not cleared: the step function only ever reads it on the lifting edge, and a
 * version that reset it would need a second rule about when.
 */
export interface MicSilenceState {
  readonly silenced: boolean;
  /** The person's own mute at the moment the silence began. */
  readonly mutedBefore: boolean;
}

/** A call nobody has silenced. Every call starts here and every leave returns to it. */
export const MIC_SILENCE_CLEAR: MicSilenceState = { silenced: false, mutedBefore: false };

export interface MicSilenceInput {
  /** What the room says **now**: whether this client's publish right is revoked. */
  readonly silenced: boolean;
  /** `micMuted` as the interface is currently drawing it. */
  readonly muted: boolean;
  /** Whether this person has stopped hearing the room. */
  readonly deafened: boolean;
}

export interface MicSilenceStep {
  /** What to remember. Identical to the previous value when nothing moved. */
  readonly next: MicSilenceState;
  /** What `micMuted` should be after this step. */
  readonly muted: boolean;
  /**
   * Whether the transport has to be told.
   *
   * True on exactly one path — a lift that ends with the microphone meant to be
   * heard — because that is the only path on which something has to go back on
   * the air. Silencing needs no call at all: the publication is already gone,
   * and `VoiceRoom.setMuted` refuses while the permission is revoked anyway, so
   * a call there would be a press with no effect and a `muted` entry in the
   * transport's history that no human made.
   */
  readonly tellTransport: boolean;
}

/**
 * One announcement of the room's answer, turned into what the call should do.
 *
 * Called for every change of the permission and for nothing else — the caller
 * has already decided that «unknown» is not a refusal and that a listen-only
 * token is not a revocation, because both of those are facts about the grant
 * rather than about the microphone.
 *
 * The unchanged branch is not an optimisation. It is what stops a second
 * announcement of the same state overwriting `mutedBefore` with the value that
 * the first announcement had just forced to `true` — after which the lift would
 * restore a mute nobody pressed, which is the same defect wearing the opposite
 * coat.
 */
export function nextMicSilence(prev: MicSilenceState, input: MicSilenceInput): MicSilenceStep {
  if (input.silenced === prev.silenced) {
    return { next: prev, muted: input.muted, tellTransport: false };
  }
  if (input.silenced) {
    return {
      next: { silenced: true, mutedBefore: input.muted },
      // The interface must not draw a live microphone over audio the room is
      // not carrying. This is the one place the person's own choice is
      // overwritten, and `mutedBefore` above is what makes that reversible.
      muted: true,
      tellTransport: false,
    };
  }
  const muted = input.deafened || prev.mutedBefore;
  return {
    next: MIC_SILENCE_CLEAR,
    muted,
    // Only when the answer actually moves. A person who was muted before the
    // silence stays muted and nothing is republished: their next press of the
    // microphone is what puts the track back, and `VoiceRoom.setMuted` already
    // republishes on that path.
    tellTransport: muted !== input.muted,
  };
}
