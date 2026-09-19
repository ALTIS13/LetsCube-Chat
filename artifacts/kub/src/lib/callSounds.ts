/**
 * What a call and a notification sound like, as data.
 *
 * Asked for by the owner on 2026-09-18, after the first real call: «добавь
 * звуки при звонке и уведомлениях, а то сейчас непонятно». A call arrived in
 * total silence and was missed.
 *
 * This module imports nothing, on purpose. The lesson is in CLAUDE.md and again
 * at the head of `lib/micGate.ts`, `lib/voiceRing.ts` and `lib/callRecord.ts`:
 * a decision inside a `"use client"` module is a decision with no test, and
 * moving the decision is cheaper than building a harness around it. The halves
 * are the same split `micGate.ts` and `micLevel.ts` already have — the rule
 * here, the `AudioContext` in `lib/callSoundPlayer.ts`, which owns no rule of
 * its own. `tests/unit/call-sounds.test.mts` holds everything below.
 *
 * ## Synthesised, not a file
 *
 * Three reasons, and the first two are the whole argument. **Licensing**: every
 * ringtone worth shipping belongs to somebody, and a sound file in a repository
 * is a licence question that outlives the person who added it. **Weight**: the
 * bundle gains nothing — no asset, no fetch, no cache entry, nothing to version
 * with the service worker. And a telephone ring really is two tones and a
 * cadence: 440 Hz and 480 Hz together is the sound a telephone makes, and it is
 * four numbers rather than a 40 kB file.
 *
 * ## The cadence, and why the ringback shares it
 *
 * `ring` is 1.2 seconds of a double burst and then two seconds of nothing,
 * repeating: 500 on, 200 off, 500 on, 2000 off. That silence is not padding —
 * it is what makes a ring a ring rather than an alarm, and it is the window in
 * which somebody can hear themselves think about answering.
 *
 * `ringback` — what the **caller** hears — is the same cadence at a single
 * tone and less than half the level. Deliberately the same array rather than a
 * second one: the two are one object seen from its two ends, exactly as
 * `voiceRingView` draws one surface for both directions, and a second cadence
 * would be a second place for them to drift. What tells the two apart is the
 * timbre, the level, and the sentence on screen beside them — «Входящий
 * звонок» against «Звоним…».
 *
 * A real European ringback is 1 on / 4 off and the American one is 2 / 4. Both
 * were considered and neither is here: a caller who has just pressed «Позвонить»
 * needs to know within half a second that something is happening, and four
 * seconds of silence at the start of an outgoing call reads as a control that
 * did nothing.
 *
 * ## A step carries its own pitches
 *
 * Until 2026-09-19 a spec was *a set of frequencies* plus an alternating
 * sound/silence array, so every burst of a sound had the same pitches. True of
 * a telephone, and false of everything the owner asked for next — «звуки сделай
 * красивые в стиле приложения, минималистичные как в дискорде». A join in that
 * idiom is two **different** notes in sequence, which the old model could not
 * say at all.
 *
 * A second optional field beside `frequencies` would have been the cheap change
 * and the wrong one: two spellings of «what does this sound at», one right for
 * two sounds and one for the other five, and every reader afterwards having to
 * know which. So the pitches moved to what they were always a property of — the
 * step. A cadence is a list of steps, each with its own tones and its own
 * length, and **a step with no tones is silence**. The old array's parity rule —
 * even index sounds, odd index is silent — is gone with it, and with it one
 * invariant that an inserted element could break without anything noticing.
 *
 * `ring`, `ringback` and `notification` came through unchanged, and that is a
 * measurement rather than a claim: `scripts/call-sound-baseline.mjs` plans four
 * cycles of each against the module at any git revision and diffs burst for
 * burst — time, length, tones, level per oscillator, attack and release.
 * `tests/unit/call-sounds.test.mts` pins the same table.
 *
 * ## The one thing no cadence can fix
 *
 * A browser will not sound anything until the page has been touched. That is
 * `lib/callSoundPlayer.ts`'s problem and it is stated there; what belongs here
 * is the consequence — **the sound is never the whole notice**. Every state
 * below that sounds also draws, and `VoiceCallRing` is written so that a person
 * who hears nothing still cannot miss the call.
 */

/**
 * The seven sounds this product makes. Nothing else may make one.
 *
 * Three are a telephone and four are a voice channel. The four were asked for
 * on 2026-09-19, after the owner noticed that somebody joining a channel made
 * no sound at all — because there was none to make.
 */
export type CallSoundName =
  | "ring"
  | "ringback"
  | "notification"
  | "join"
  | "leave"
  | "mute"
  | "unmute";

/**
 * One step of a cadence: what is sounded, and for how long.
 *
 * **No tones is silence**, and that is the whole of the model's rule. It
 * replaced an array of alternating durations whose even indices were sound by
 * convention — a convention that could not express two different notes in
 * sequence, and that an inserted element silently inverted.
 */
export interface CallSoundStep {
  /** The tones sounded together for this step. Empty is a rest. */
  readonly frequencies: readonly number[];
  readonly durationMs: number;
}

export interface CallSoundSpec {
  readonly name: CallSoundName;
  /** The peak level of the **whole** sound, 0..1. See `callSoundToneGain`. */
  readonly gain: number;
  /** The envelope of one burst. A square edge on a sine clicks; these remove it. */
  readonly attackMs: number;
  readonly releaseMs: number;
  /** The steps, in order, beginning at the sound's own millisecond zero. */
  readonly cadence: readonly CallSoundStep[];
  /** Whether the cadence repeats until something stops it. */
  readonly loop: boolean;
}

/**
 * The cadence a telephone rings on, shared by the ring and the ringback.
 *
 * Still one array of numbers read twice, which is what «one object seen from
 * its two ends» meant and still means. What it can no longer be is one array of
 * *steps*: the two differ in their tones, and the tones now live in the step.
 * So the timing is the shared thing and the pitches are laid onto it, which is
 * the honest decomposition — a second literal `[500, 200, 500, 2000]` beside
 * the ringback would be the drift this constant exists to prevent.
 */
const TELEPHONE_CADENCE_MS = [500, 200, 500, 2000] as const;

/** A cadence of alternating sound and silence, every burst on the same tones. */
function alternating(
  frequencies: readonly number[],
  cadenceMs: readonly number[],
): CallSoundStep[] {
  return cadenceMs.map((durationMs, index) => ({
    frequencies: index % 2 === 0 ? frequencies : [],
    durationMs,
  }));
}

/**
 * The two pitches every voice-channel sound is built from.
 *
 * A4 and E5: a perfect fifth, which after the octave is the most consonant
 * interval there is, and which — having no third in it — is neither major nor
 * minor, so nothing here reads as cheerful or as sad. 440 is already the tone
 * the ring sounds on, so the four new sounds are audibly the same instrument as
 * the three that exist rather than a second set bolted beside them.
 *
 * Both are above 440 Hz on purpose. A lower pair would have been warmer and
 * would have been inaudible where half of this product is used: a telephone's
 * loudspeaker rolls off hard below about 500 Hz, and feedback nobody can hear
 * on a telephone is not feedback.
 *
 * The family is two facts, and each is carried by one dimension:
 *
 *  - **how many notes** says whose event it is. One note is a control **you**
 *    pressed; two notes is the **room** telling you something;
 *  - **which way** says what happened. Low is off, or away; high is on, or
 *    arriving.
 *
 * So `mute` is the low note alone, `unmute` the high note alone, `join` is low
 * then high and `leave` is high then low — the same two pitches in the opposite
 * order, for the same reason `ring` and `ringback` share one cadence.
 */
const VOICE_LOW_HZ = 440;
const VOICE_HIGH_HZ = 659.25;

/**
 * The timing of a two-note figure: note, gap, note. 290 ms end to end.
 *
 * Shared by `join` and `leave` exactly as the telephone cadence is shared, and
 * short enough that four people arriving does not turn into a phrase. The
 * second note is longer than the first because it is the one that resolves —
 * the first is a step towards it.
 */
const VOICE_FIGURE_MS = [110, 30, 150] as const;

/** A rising or falling two-note figure on the shared timing. */
function figure(first: number, second: number): CallSoundStep[] {
  return [
    { frequencies: [first], durationMs: VOICE_FIGURE_MS[0] },
    { frequencies: [], durationMs: VOICE_FIGURE_MS[1] },
    { frequencies: [second], durationMs: VOICE_FIGURE_MS[2] },
  ];
}

/** One short note, for a control somebody pressed. */
function blip(frequency: number): CallSoundStep[] {
  return [{ frequencies: [frequency], durationMs: 100 }];
}

export const CALL_SOUNDS: Record<CallSoundName, CallSoundSpec> = {
  /**
   * 440 and 480 are the pair a North American telephone rings on, and the beat
   * between them — 40 Hz — is what makes the sound read as mechanical rather
   * than as a test tone.
   */
  ring: {
    name: "ring",
    gain: 0.16,
    attackMs: 18,
    releaseMs: 70,
    cadence: alternating([440, 480], TELEPHONE_CADENCE_MS),
    loop: true,
  },
  /** 425 is the European ringing tone, used alone. */
  ringback: {
    name: "ringback",
    // Under half the ring's. The caller already knows a call is happening —
    // they started it — so this is confirmation rather than a summons, and a
    // summons is what a loud tone in your own ear for forty-five seconds is.
    gain: 0.07,
    attackMs: 18,
    releaseMs: 70,
    cadence: alternating([425], TELEPHONE_CADENCE_MS),
    loop: true,
  },
  notification: {
    name: "notification",
    gain: 0.1,
    attackMs: 8,
    // Most of the burst is the release: a tone that stops dead reads as a
    // beep, and one that falls away reads as a bell.
    releaseMs: 180,
    cadence: alternating([880], [220]),
    loop: false,
  },
  /**
   * Somebody arrived in the voice channel. Low then high.
   *
   * Quieter than the notification, which is the quieter of the two that
   * existed: this one interrupts a conversation that is already happening, and
   * a sound that competes with speech is a sound people switch off. The long
   * release is what stops it reading as a beep — the same reason the
   * notification's release is most of its burst.
   */
  join: {
    name: "join",
    gain: 0.08,
    attackMs: 6,
    releaseMs: 100,
    cadence: figure(VOICE_LOW_HZ, VOICE_HIGH_HZ),
    loop: false,
  },
  /** Somebody left. The same two pitches, the other way round. */
  leave: {
    name: "leave",
    gain: 0.08,
    attackMs: 6,
    releaseMs: 100,
    cadence: figure(VOICE_HIGH_HZ, VOICE_LOW_HZ),
    loop: false,
  },
  /**
   * You silenced your own microphone. One low note, and quieter still.
   *
   * Half the level of an arrival, because this one sounds while **you** are the
   * one talking, several times in a conversation, and the only thing it has to
   * say is «the press registered». Today it says nothing at all, which is the
   * defect: the control a person presses most often in a call is the one with
   * no feedback but a glyph they are not looking at.
   */
  mute: {
    name: "mute",
    gain: 0.05,
    attackMs: 4,
    releaseMs: 80,
    cadence: blip(VOICE_LOW_HZ),
    loop: false,
  },
  /** Your microphone is open again. The high note, alone. */
  unmute: {
    name: "unmute",
    gain: 0.05,
    attackMs: 4,
    releaseMs: 80,
    cadence: blip(VOICE_HIGH_HZ),
    loop: false,
  },
};

/** One burst of a sound: when it starts, how long it runs, what it sounds. */
export interface CallSoundBurst {
  readonly atMs: number;
  readonly durationMs: number;
  /** The tones sounded together, from the step this burst came from. */
  readonly frequencies: readonly number[];
}

/**
 * The level one oscillator is given, so that the burst's sum is `spec.gain`.
 *
 * Two sines at 0.16 each do not make a 0.16 sound; they make a 0.32 one that
 * clips against everything else the page is playing. The division is here
 * rather than in the player because it is arithmetic about the sound, and a
 * player that forgot it would be a defect nothing could see.
 *
 * It asks the **burst** how many voices there are rather than the spec, because
 * since 2026-09-19 that is where the answer lives and it is no longer the same
 * for every burst of a sound: the day a sound rings on two tones and resolves
 * on one, a level taken from the spec would make the second note twice as loud
 * as the first and nothing would say why.
 */
export function callSoundToneGain(
  spec: CallSoundSpec,
  burst: { readonly frequencies: readonly number[] },
): number {
  const voices = burst.frequencies.length;
  return voices > 0 ? spec.gain / voices : 0;
}

/** How long one pass through the cadence takes, silence included. */
export function callSoundCycleMs(spec: CallSoundSpec): number {
  let total = 0;
  for (const step of spec.cadence) total += Math.max(0, step.durationMs);
  return total;
}

/**
 * Every burst between two moments, in order.
 *
 * Measured from the start of the sound, so the caller schedules against one
 * origin and never accumulates drift: `fromMs` inclusive, `untilMs` exclusive.
 * A sound that does not loop has the bursts of its first cycle and no others,
 * however far ahead it is asked about — which is what makes the notification a
 * single tone rather than a smoke alarm.
 */
export function callSoundBursts(
  spec: CallSoundSpec,
  window: { readonly fromMs: number; readonly untilMs: number },
): CallSoundBurst[] {
  const cycle = callSoundCycleMs(spec);
  if (cycle <= 0 || window.untilMs <= window.fromMs) return [];
  const out: CallSoundBurst[] = [];
  const lastCycle = spec.loop ? Math.ceil(window.untilMs / cycle) : 1;
  const firstCycle = spec.loop ? Math.max(0, Math.floor(window.fromMs / cycle)) : 0;
  for (let index = firstCycle; index < lastCycle; index += 1) {
    let at = index * cycle;
    for (const step of spec.cadence) {
      const length = Math.max(0, step.durationMs);
      // A step says for itself whether it sounds. No parity to get wrong, and
      // no way for an inserted rest to turn every burst after it into silence.
      if (step.frequencies.length > 0 && length > 0 && at >= window.fromMs && at < window.untilMs) {
        out.push({ atMs: at, durationMs: length, frequencies: step.frequencies });
      }
      at += length;
    }
  }
  return out;
}

/**
 * The attack and the release of one burst, never longer together than the burst.
 *
 * A burst shorter than its own envelope is not a thing anybody wrote on
 * purpose, but it is one edit away — shorten a cadence step, or lengthen a
 * release — and what a browser does with a ramp that ends after the oscillator
 * has stopped is to leave the gain wherever it had got to. So the envelope is
 * scaled to fit rather than trusted, and the burst still has a shape.
 */
export function callSoundEnvelope(
  spec: CallSoundSpec,
  durationMs: number,
): { readonly attackMs: number; readonly releaseMs: number } {
  const duration = Math.max(0, durationMs);
  const wanted = Math.max(0, spec.attackMs) + Math.max(0, spec.releaseMs);
  if (wanted <= duration) {
    return { attackMs: Math.max(0, spec.attackMs), releaseMs: Math.max(0, spec.releaseMs) };
  }
  if (wanted === 0) return { attackMs: 0, releaseMs: 0 };
  const scale = duration / wanted;
  return {
    attackMs: Math.max(0, spec.attackMs) * scale,
    releaseMs: Math.max(0, spec.releaseMs) * scale,
  };
}

// ---------------------------------------------------------------------------
// Which sound belongs to which state
// ---------------------------------------------------------------------------

/**
 * The four words `voice_ring_state` answers, spelled again rather than imported.
 *
 * Structurally the same union as `VoiceRingState` in `lib/voiceRing.ts`, so one
 * can be passed where the other is asked for and the compiler checks it. Spelled
 * here because this module imports nothing — the property that lets
 * `node --test` load it — and because the two are asked different questions:
 * that module decides what is drawn, this one decides what is heard.
 */
export type CallRingState = "idle" | "ringing" | "answered" | "expired";

/** Which end of the ring this client is. `VoiceRingDirection`, again. */
export type CallRingDirection = "incoming" | "outgoing";

/**
 * The sound a ring in this state wants, or silence.
 *
 * **Only `ringing` sounds**, and that is the whole of «every path stops the
 * sound». §4a of the proposal is the reason there are so many paths: every
 * device the person is signed in on rings, and one of them answering stops the
 * rest. Answered, expired, declined, cancelled, hung up from another device,
 * the row simply gone — all of them leave this function with something that is
 * not `ringing`, and it answers `null` to every one without being told which
 * happened. A sound driven by events would need six handlers and would keep
 * ringing the day one of them was missed.
 *
 * `direction` decides which sound, not whether: a caller hears a ringback and
 * a callee hears a ring, and a ring with no direction is a ring belonging to
 * nobody, which is silence.
 */
export function voiceRingSound(input: {
  readonly state: CallRingState;
  readonly direction: CallRingDirection | null;
  /** The person's own setting. Off means off, in every state. */
  readonly enabled: boolean;
}): CallSoundName | null {
  if (!input.enabled) return null;
  if (input.state !== "ringing") return null;
  if (input.direction === "incoming") return "ring";
  if (input.direction === "outgoing") return "ringback";
  return null;
}

/**
 * What the player has to be told to get from what it is playing to what the
 * state now wants.
 *
 * A separate function rather than two calls at the call site, because «stop the
 * old one» is the half that gets forgotten. Same sound: nothing happens, and
 * the ring is not restarted on every re-render — a ring that restarted its
 * cadence whenever React re-rendered would never reach its second burst.
 */
export function callSoundTransition(input: {
  readonly playing: CallSoundName | null;
  readonly wanted: CallSoundName | null;
}): { readonly stop: CallSoundName | null; readonly start: CallSoundName | null } {
  if (input.playing === input.wanted) return { stop: null, start: null };
  return { stop: input.playing, start: input.wanted };
}

/**
 * Whether a notification may sound right now.
 *
 * Three refusals, and each is a different fact:
 *
 *  - **the setting.** Somebody who wants a silent office still wants their
 *    telephone to ring, which is why this is not the same switch as the call's;
 *  - **a ring is sounding.** A ping on top of a ringtone is noise, and it
 *    arrives exactly when it is least wanted — a message from the person who is
 *    calling is the commonest case of all;
 *  - **the conversation is open and being looked at.** A sound for a line that
 *    has just appeared under the reader's eyes tells them nothing they cannot
 *    see. `documentHidden` is the half that makes this safe: the same chat in a
 *    tab behind three others is not being looked at, and that one does sound;
 *  - **the shell already raised a notification of its own.** The Windows
 *    application raises a real toast for the same row, and Windows plays its
 *    own sound for it. Two sounds for one message is worse than either, and the
 *    operating system's is the one the person has already tuned — it obeys
 *    their focus assist, their volume mixer and their notification settings,
 *    where this one obeys none of them.
 */
export function notificationSoundAllowed(input: {
  readonly enabled: boolean;
  /** What the ring is sounding, if anything. */
  readonly ringing: CallSoundName | null;
  /** The conversation the notification belongs to, if it belongs to one. */
  readonly chatId: string | null;
  /** The conversation open on screen. */
  readonly openChatId: string | null;
  readonly documentHidden: boolean;
  /** Whether the shell is raising an operating-system notification for this row. */
  readonly osToast: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.ringing !== null) return false;
  if (input.osToast) return false;
  if (!input.documentHidden && input.chatId !== null && input.chatId === input.openChatId) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

/**
 * Both sounds are on unless somebody turns them off.
 *
 * Which is also what every settings blob written before 2026-09-18 means. The
 * two keys are absent from all of them, and a person who has never seen this
 * setting asked for the product to make a sound — that is the request this
 * whole change answers. The readers below take `undefined` to the default for
 * that reason, and take a stored `false` seriously.
 */
export const CALL_SOUND_DEFAULT = true;
export const NOTIFICATION_SOUND_DEFAULT = true;

/** A stored call-sound setting, or the default. */
export function readCallSoundEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : CALL_SOUND_DEFAULT;
}

/** A stored notification-sound setting, or the default. */
export function readNotificationSoundEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : NOTIFICATION_SOUND_DEFAULT;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** The settings group, beside «Микрофон в звонке» and «Обработка голоса». */
export const SOUND_GROUP_CAPTION = "Звуки";
export const CALL_SOUND_LABEL = "Звонок";
export const CALL_SOUND_HINT = "Мелодия входящего и гудки исходящего звонка.";
export const NOTIFICATION_SOUND_LABEL = "Уведомления";
export const NOTIFICATION_SOUND_HINT = "Короткий сигнал о новом сообщении.";
/**
 * Where the setting lives, said plainly.
 *
 * The same honesty §4a asks of the per-device call switch: this is
 * `localStorage`, so it is this browser's answer and not the account's, and a
 * person who turns the ring off on their computer will still be rung by their
 * telephone. Saying so is cheaper than the surprise.
 */
export const SOUND_SCOPE_NOTE = "Настройка действует на этом устройстве.";
/**
 * What a browser does before the page has been touched, said to the person
 * rather than swallowed.
 *
 * Shown only when the player has actually been refused, never as a warning in
 * advance: a sentence about something that has not happened is noise, and on
 * every shell where sound works it would never be true.
 */
export const SOUND_BLOCKED_NOTE =
  "Браузер включит звук после первого нажатия на странице — до этого звонок виден, но не слышен.";
