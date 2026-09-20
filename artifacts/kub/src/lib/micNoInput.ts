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
 * ## What «nothing» means, measured rather than assumed
 *
 * **This module shipped on 2026-09-20 with `level > 0` and that rule could
 * never fire.** The reasoning behind it was that a dead input reads exactly 0
 * while anything live does not. The owner disproved it the same day on real
 * hardware: his microphone has an analogue volume dimmer, and with it turned
 * fully to zero Discord says it is getting no audio and this product said
 * nothing at all. A dimmer at zero is **attenuation, not disconnection** — the
 * capsule still captures and the converter still converts, so what arrives is
 * tiny and non-zero, `heard` was set on the very first reading, and `heard` is
 * terminal by design.
 *
 * ## The instrument, and why it has only one number below −42 dBFS
 *
 * The level this module is fed is `lib/micLevel.ts`'s peak: the largest
 * distance any sample in a 2048-sample window sits from the 8-bit midpoint of
 * `AnalyserNode.getByteTimeDomainData`, divided by 128. So the **only values it
 * can ever report are k/128**, and everything below turns on what that byte
 * conversion does with a small number.
 *
 * Measured in Chromium 2026-09-20, driving known amplitudes through the same
 * graph the product builds (`output/d272-measure-floor.mjs`):
 *
 * | true signal | byte peak | level reported |
 * | --- | --- | --- |
 * | −90 dBFS (one 16-bit converter step) | 1 | 0.0078125 |
 * | −60 dBFS | 1 | 0.0078125 |
 * | −43 dBFS | 1 | 0.0078125 |
 * | −42 dBFS | 2 | 0.015625 |
 * | −36 dBFS | 3 | 0.0234375 |
 * | −24 dBFS | 9 | 0.0703125 |
 *
 * **The conversion floors, and that is a fact about the specification rather
 * than about one browser.** `getByteTimeDomainData` is defined as
 * `b = ⌊128(1 + x)⌋`, so the rounding is asymmetric: a positive sample has to
 * reach a whole step to move the byte at all, while **any** negative sample,
 * however small, lands on 127 — one step below the midpoint.
 *
 * Measured on 2026-09-20 with a DC offset, which is the one signal that can
 * tell the two explanations apart (`output/d277-byte-asymmetry.mjs`); an
 * oscillator cannot, because every window of one contains both signs:
 *
 * | constant offset | raw byte | reported |
 * | --- | --- | --- |
 * | +3.05e−5 (one 16-bit step) | 128 | 0 |
 * | −3.05e−5 | 127 | 1 |
 * | +1/128 | 129 | 1 |
 * | −1/128 | 127 | 1 |
 *
 * Every real audio signal is bipolar, so every live capture reports at least
 * one step. `level > 0` was therefore satisfied by very nearly anything, and
 * the only way to read a true 0 is absolute digital silence on every sample —
 * in practice a disabled track or a suspended context.
 *
 * The consequence that matters: **byte peak 1 is a single bucket 48 dB wide**,
 * spanning −90.3 dBFS up to about −42.1 dBFS. It does not mean «this quiet»;
 * it means «too quiet for this instrument to put a number on». And because the
 * cause is the specification's own formula, it is not a Chromium quirk to be
 * re-checked on Safari: every compliant implementation floors the same way.
 *
 * ## So the floor is the instrument's own resolution
 *
 * `MIC_NO_INPUT_FLOOR` is one byte step, and the test is `>` — a reading has to
 * reach **two** steps, which is louder than about −42.5 dBFS, to count as
 * sound. That is not a chosen number and cannot drift, because it is the
 * boundary between the bucket that carries no information and the first one
 * that does. Speech peaks at roughly −25 dBFS into a laptop capture, which is
 * byte peak 9 — nine times over the line.
 *
 * **And this is why the gate's threshold is not reused here**, which was the
 * obvious alternative. `micGateOpenAt(MIC_GATE_THRESHOLD_DEFAULT)` is 0.00531,
 * i.e. −45.5 dBFS — **below one byte step**, so a floor set from it would be
 * cleared by every non-zero reading and would reproduce exactly the defect
 * above. A decision the instrument cannot represent cannot be borrowed. The two
 * do share the axis, which is the part worth sharing: both are levels on
 * `micGateOpenAt`'s scale and both can be drawn on the same meter.
 *
 * ## What this costs, stated rather than discovered later
 *
 * A person who joins a call and makes **no sound above −42.5 dBFS for ten
 * continuous seconds** is warned, even though their microphone works. That is
 * the trade this floor buys and it is the same trade Discord makes. One sound
 * anywhere in the call clears it permanently (`heard` is terminal), so it costs
 * a silent listener one sentence and nobody else.
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

/**
 * The quietest reading that counts as sound: one step of the instrument.
 *
 * `lib/micLevel.ts` reports `peak / 128` out of `getByteTimeDomainData`, so the
 * only values that exist are k/128 and this is k = 1. The test against it is
 * **strictly greater**, so a reading has to reach k = 2 — louder than about
 * −42.5 dBFS — before the microphone is considered to have produced anything.
 *
 * Why here rather than a number of decibels: the whole argument for this value
 * is that it is the instrument's resolution, and the instrument counts bytes.
 * Written as a dB figure it would look like a choice somebody could tune, and
 * the next person would tune it.
 *
 * The measurement behind it is in this module's header, and the scripts that
 * took it are `output/d272-measure-floor.mjs` and
 * `output/d277-byte-asymmetry.mjs`. The one line to remember: a signal at
 * −90 dBFS — one 16-bit converter step above absolute silence — already
 * reports k = 1, because the byte conversion floors and the negative half of
 * any signal therefore lands a step below the midpoint. So k = 1 is not a
 * level at all; it is a 48 dB bucket meaning «below the bottom of this scale».
 *
 * **What would invalidate this value, said here because it does not look like
 * it can drift.** The argument is «one step of the instrument», and the
 * instrument is `getByteTimeDomainData`. The same `AnalyserNode` also offers
 * `getFloatTimeDomainData`, which in the same measurement resolved every level
 * down to −90 dBFS exactly. If `lib/micLevel.ts` ever reads the float path —
 * and D-278 is the case for doing so — then 1/128 stops being a resolution and
 * becomes −42.1 dBFS, a tuned number, which is precisely what the paragraph
 * above says this must not be. It would still be a defensible figure (17 dB
 * under conversational speech, 18 dB over a quiet room), but it would need
 * that justification written out instead of this one.
 */
export const MIC_NO_INPUT_FLOOR = 1 / 128;

/**
 * How many readings above the floor it takes to call a microphone alive.
 *
 * Three, and the number is not a new one: `lib/micLevel.ts` already says «a
 * syllable is around 150 ms, so three readings inside the shortest thing worth
 * opening the gate for is the fewest that can be called responsive», and the
 * sampler runs at 50 ms because of it. Three readings is that same 150 ms.
 *
 * It exists because `heard` is **terminal**, which makes a single reading a
 * very cheap way to switch the warning off for a whole call. Measured on
 * 2026-09-20: the product's default constraints give speech **+13 dB** (byte 9
 * raw, byte 40 processed), so a keyboard click near a dimmed microphone can
 * clear a one-reading rule while a person still cannot be heard. A click is
 * one reading; a syllable is three.
 *
 * Counted **consecutively** and reset by any reading at or below the floor, so
 * what it asks for is 150 ms of continuous sound rather than three transients
 * spread over a minute.
 */
export const MIC_NO_INPUT_HEARD_READINGS = 3;

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
  /** When the current run of silence began, or `null` for no run. */
  readonly silentSince: number | null;
  /** This capture has produced sound for long enough to count. Terminal. */
  readonly heard: boolean;
  /** Whether the warning is showing right now. */
  readonly warned: boolean;
  /**
   * Consecutive readings above `MIC_NO_INPUT_FLOOR`, up to the point where
   * they add up to `heard`. Reset by any reading at or below the floor.
   */
  readonly above: number;
}

export const MIC_NO_INPUT_CLEAR: MicNoInputState = {
  silentSince: null,
  heard: false,
  warned: false,
  above: 0,
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

  // Terminal, and tested before the level rather than after it: once a capture
  // has proved itself there is nothing left for a reading to change.
  if (state.heard) return state;

  // `> MIC_NO_INPUT_FLOOR`, not `> 0`. The shipped rule was `> 0` and could
  // never fire: the byte conversion rounds up, so a signal 90 dB below full
  // scale still reports a whole step and `heard` was set on the first reading
  // of every call. The header carries the measurement and the owner's dimmer,
  // which is the hardware that found it.
  //
  // Still no `Number.isFinite` guard, and still for the reason a mutation
  // proved on 2026-09-20: `NaN > anything` is already `false`, so a level the
  // analyser could not produce falls to the safe side — silence — through the
  // comparison itself. A guard a test cannot reach is not doing anything.
  if (input.level > MIC_NO_INPUT_FLOOR) {
    const above = state.above + 1;
    if (above >= MIC_NO_INPUT_HEARD_READINGS) {
      // The answer to the whole question, and it is kept for the life of this
      // capture. `warned: false` rather than left alone: a warning still on
      // screen over a microphone that has just been heard is a stale sentence,
      // and somebody who has just opened their headset's mute should see it go.
      return { silentSince: null, heard: true, warned: false, above };
    }
    // Not yet sound — a transient, on the way to being a syllable or not. The
    // silence run deliberately carries **on** underneath it rather than
    // restarting, because a click is not a reason to give somebody another ten
    // seconds of being inaudible.
    return { ...state, above };
  }

  if (!input.judgeable) {
    if (state.silentSince === null && !state.warned && state.above === 0) return state;
    return { ...state, silentSince: null, warned: false, above: 0 };
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
    above: 0,
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
