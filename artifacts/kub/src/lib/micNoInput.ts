/**
 * Whether a microphone is producing anything at all, as a rule that needs no
 * browser.
 *
 * Discord's advanced voice settings call this «Предупреждение об отсутствии
 * звука» — a warning shown when the client is not receiving audio from the
 * capture it opened. This module is that decision: what counts as nothing,
 * how long nothing has to last, when the question stops being asked, and the
 * sentence the surface prints.
 *
 * It imports nothing, on purpose, for the reason written at the head of
 * `micGate.ts` and again in CLAUDE.md: a decision inside a `"use client"`
 * module is a decision with no test. Everything here is reachable from
 * `node --test`, and `tests/unit/mic-no-input.test.mts` holds it.
 *
 * ## The distinction that makes the warning honest
 *
 * **Digital silence is not a quiet room.** The level this module is fed is
 * `lib/micLevel.ts`'s peak — the largest distance any sample in a 2048-sample
 * window sits from the 8-bit midpoint, divided by 128. A live capture of a
 * quiet room never reads exactly 0: Chromium's own fake device sits at 0.0078
 * between its beeps (measured, and written down in `micLevel.ts`). What reads
 * exactly 0 is a capture that is producing no signal — a headset with its
 * hardware mute closed, a device muted in the operating system's mixer, an
 * input the browser opened and the machine never fed.
 *
 * So the test is `level > 0`, not `level > someFloor`. A floor would turn this
 * into «you are being quiet», which is not a defect and not worth a warning.
 *
 * **It is not a diagnosis, and the copy must not pretend otherwise.** A
 * browser whose noise suppression emits true digital silence between words
 * would read 0 as well, and this module cannot tell that apart from a dead
 * microphone. What it can say without ever being wrong is the measurement:
 * nothing has arrived. `micNoInputNote` says exactly that and no more —
 * see the comment there.
 *
 * ## Why the question is asked once and then dropped
 *
 * `heard` is the whole cost story. The question is «does this microphone
 * work», and a microphone that has produced one sound has answered it. From
 * that moment the state is terminal: no warning can be raised for this capture
 * again, and `micNoInputNeedsLevel` answers `false`, which is what lets a call
 * in «Всегда» or «Рация» **close** the `AudioContext` it opened for this and
 * go back to costing nothing. Neither of those two modes needs a level for the
 * gate — `micGateNeedsLevel` is where that is decided — and an analyser left
 * running for the length of a conversation is the battery defect nobody sees.
 *
 * The limitation that follows is real and is stated rather than hidden: a
 * microphone that works at the start of a call and dies in the middle of it is
 * **not** caught. Catching that needs a level for the whole call, which is the
 * cost this design refuses.
 *
 * ## Why there is no «скрыть»
 *
 * There were a `dismissed` flag and a `dismissMicNoInput` here, both written
 * and both mutation-tested, and they came out again the same day. Nothing
 * could press them: the warning is drawn in `VoiceCallCapsule` beside the
 * moderator-silence line, which is a sentence and not a control, and the call
 * bar — the other surface that could carry a button — belongs to another track
 * this evening. A state nothing can enter is dead code, and dead code in a
 * rule module is worse than a missing feature, because the next reader has to
 * work out which half is live.
 *
 * Three things already put the warning away, which is what makes the absence
 * defensible rather than merely convenient: the microphone producing one sound
 * (`heard`), the person muting themselves (`judgeable`), and the switch in the
 * settings panel. A «скрыть» is `warned` plus one button whenever it is wanted,
 * and it should arrive together with the surface that presses it.
 *
 * If the mid-call death above is ever wanted, the cheap way in is the sender's
 * own `media-source.audioLevel` from `RTCRtpSender.getStats()`, which the
 * encoder already computes — not a second analyser. Two facts measured on
 * 2026-09-20 before anyone builds on it, because both are easy to be surprised
 * by: the stats array is **empty until the peer connection is established**
 * (still empty after `addTrack` and after `setLocalDescription`), so it can
 * never answer «does this microphone work» *before* a call; and it reads
 * exactly 0 whenever the gate has the track disabled, so any rule built on it
 * has to know the gate's state or it will report every push-to-talk pause as a
 * dead microphone. Firefox does not implement `RTCAudioSourceStats` at all
 * (Bugzilla 1728364, still open), and WebKit's support is in the source since
 * 2023-10-16 but the release it shipped in was not established — check on a
 * real iPhone.
 */

/* ── How long nothing has to last ─────────────────────────────────────────── */

/**
 * How long a capture may produce exact silence before the warning appears.
 *
 * Ten seconds, from the two failures it sits between. Shorter and it fires at
 * somebody who joined a call and has not said their first word yet — the
 * window between «Присоединиться» and «привет» is a few seconds, and a warning
 * inside it is a warning at the wrong person. Longer and it stops being a
 * warning: the case this exists for is somebody talking into a microphone
 * nobody can hear, and every second past the first ten is spent saying
 * something to a room that is not receiving it.
 *
 * It is a run of **continuous** silence, restarted by anything that makes the
 * capture unjudgeable — see `nextMicNoInput`. A person who mutes at second
 * nine does not come back at second eleven to a warning about the microphone
 * they had already turned off.
 */
export const MIC_NO_INPUT_AFTER_MS = 10_000;

/* ── The state ────────────────────────────────────────────────────────────── */

/**
 * What the detector knows between two readings.
 *
 * `silentSince` is a timestamp in the same clock the caller passes as `now`,
 * which is `Date.now()` at the call site and a plain number in the tests. It is
 * `null` whenever there is no run in progress — either because sound has
 * arrived, or because the capture is not in a state that can be judged.
 */
export interface MicNoInputState {
  /** When the current run of exact silence began, or `null` for no run. */
  readonly silentSince: number | null;
  /** This capture has produced sound at least once. Terminal. */
  readonly heard: boolean;
  /** Whether the warning is showing right now. */
  readonly warned: boolean;
}

export const MIC_NO_INPUT_CLEAR: MicNoInputState = {
  silentSince: null,
  heard: false,
  warned: false,
};

export interface MicNoInputInput {
  /** The stored setting. Off means the detector does nothing at all. */
  readonly enabled: boolean;
  /**
   * Whether this capture can be judged at all right now.
   *
   * The call is connected, this client may publish, and the person has not
   * muted themselves. **Not** «the gate is open»: the level is read from a
   * clone of the track (`lib/micLevel.ts`), which the gate never disables, so a
   * working microphone reads its true level in «Рация» between presses just as
   * it does in «Всегда». Requiring an open gate would mean telling somebody in
   * push-to-talk that their microphone is dead because they have not pressed
   * the key — which is the mechanism working, not failing.
   *
   * A self-mute is different and does belong here: «мы не получаем звук с
   * вашего микрофона» said to somebody who has just switched their microphone
   * off is the product failing to read its own state.
   */
  readonly judgeable: boolean;
  /** Peak amplitude of the last reading, 0..1. See `lib/micLevel.ts`. */
  readonly level: number;
  readonly now: number;
}

/**
 * The detector, one reading at a time.
 *
 * Pure and total, in the shape of `nextMicGate`: same input, same output, and
 * every branch returns a complete state.
 *
 * The order of the tests is the order in which the reasons beat each other.
 *
 * **The setting comes first**, and it resets rather than freezes: somebody who
 * turns the warning off is not asking for it to be remembered and shown later.
 *
 * **`heard` is terminal and beats everything below it.** It is what stops the
 * warning appearing on a microphone that has already proved itself, and it is
 * what `micNoInputNeedsLevel` reads to close the analyser.
 *
 * **An unjudgeable capture breaks the run but keeps what was learned.** Muting
 * clears `silentSince` — the ten seconds start again on unmute — while `heard`
 * survives, because it is not a fact about the last ten seconds.
 */
export function nextMicNoInput(state: MicNoInputState, input: MicNoInputInput): MicNoInputState {
  if (!input.enabled) return MIC_NO_INPUT_CLEAR;

  // `> 0` and nothing else, which is also why there is no `Number.isFinite`
  // guard here as there is in `nextMicGate`. One was written and then removed
  // on 2026-09-20, because no mutation could make it matter: `NaN > 0` is
  // already `false`, so a level the analyser could not produce falls to the
  // safe side — silence — through the comparison itself. A guard a test cannot
  // reach is a guard that is not doing anything, and leaving it in would have
  // suggested this branch had two decisions in it when it has one.
  if (input.level > 0) {
    // The answer to the whole question, and it is kept for the life of this
    // capture. `warned: false` rather than left alone: a warning still on
    // screen over a microphone that has just been heard is a stale sentence,
    // and a person whose headset mute they just opened should see it go.
    return { silentSince: null, heard: true, warned: false };
  }
  if (state.heard) return state;

  if (!input.judgeable) {
    if (state.silentSince === null && !state.warned) return state;
    return { ...state, silentSince: null, warned: false };
  }

  const since = state.silentSince ?? input.now;
  // `>=` rather than `>`: a reading taken exactly on the deadline is a reading
  // that waited the full time, and the 50ms sampling period means the
  // difference is otherwise one whole extra tick of silence.
  const due = input.now - since >= MIC_NO_INPUT_AFTER_MS;
  return {
    silentSince: since,
    heard: false,
    warned: due,
  };
}

/**
 * Whether the detector still needs somebody to be measuring the level.
 *
 * The one function a call asks before deciding whether to hold an
 * `AudioContext` open for this. Both halves matter and both were mutated:
 * dropping `enabled` makes every call pay for a warning nobody asked for, and
 * dropping `!heard` leaves the analyser running for the length of every
 * conversation.
 */
export function micNoInputNeedsLevel(enabled: boolean, state: MicNoInputState): boolean {
  return enabled && !state.heard;
}

/* ── What the surface says ────────────────────────────────────────────────── */

/** The switch, in Discord's own words for it. */
export const MIC_NO_INPUT_LABEL = "Предупреждение об отсутствии звука";

/**
 * The line under the switch.
 *
 * Names the measurement and the window, because a warning whose trigger is
 * invisible is one people learn to distrust.
 */
export const MIC_NO_INPUT_HINT =
  "Предупредим в звонке, если микрофон за десять секунд не даст ни одного звука: выключен на гарнитуре, приглушён в системе или выбран не тот.";

/**
 * The warning itself.
 *
 * **It reports the measurement and stops.** «Микрофон не работает» is a
 * diagnosis this module cannot make: the same reading comes from a hardware
 * mute, from a device muted in the system mixer, and from a browser whose noise
 * suppression happens to emit true silence. What is certainly true, in all
 * three, is that nothing arrived — so that is what it says, followed by the
 * three things a person can actually check.
 *
 * Discord's own sentence is the same shape, and this is deliberately not a
 * translation of it: «Похоже, Discord не получает звук с вашего микрофона»
 * names the product because Discord's warning is about Discord's audio engine,
 * and ours is about the browser's capture.
 */
export const MIC_NO_INPUT_WARNING = "Микрофон не даёт звука";

/**
 * The second half, and it is **short on purpose**.
 *
 * The first version of this named all three things to check — the headset
 * button, the system volume, the selected device — and was photographed at 390
 * before it shipped: **seven lines of red inside the call capsule**, which is a
 * quarter of a phone screen and pushes the conversation down by that much. The
 * capsule’s text column is about 25 characters wide, because the three controls
 * take the other half of the row.
 *
 * So the checklist moved to `MIC_NO_INPUT_HINT`, under the switch in the
 * settings panel, where a row is full width and already wraps to two lines.
 * What stays here is the sentence a person reads **while they are talking to
 * somebody** and cannot stop to read a list.
 *
 * Compare the only other sentence in that capsule — «Модератор выключил ваш
 * микрофон.», 31 characters. This one is 66 with the headline, which is
 * three lines against that one’s two.
 */
export const MIC_NO_INPUT_WARNING_DETAIL =
  "Проверьте гарнитуру и выбранное устройство.";

/** The close on the warning. A verb, like every other action in this product. */
export const MIC_NO_INPUT_DISMISS_LABEL = "Скрыть";

/**
 * Whether a stored value means the warning is on.
 *
 * Absent reads as **on**, which is the same reasoning `callSoundEnabled` is
 * given in `lib/callSounds.ts`: a person who has never seen this setting is
 * better served by being told their microphone is silent than by not being
 * told. Discord ships it on for the same reason.
 */
export const MIC_NO_INPUT_DEFAULT = true;

export function readMicNoInputEnabled(value: unknown, fallback: boolean = MIC_NO_INPUT_DEFAULT): boolean {
  return typeof value === "boolean" ? value : fallback;
}
