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
 * ## The one thing no cadence can fix
 *
 * A browser will not sound anything until the page has been touched. That is
 * `lib/callSoundPlayer.ts`'s problem and it is stated there; what belongs here
 * is the consequence — **the sound is never the whole notice**. Every state
 * below that sounds also draws, and `VoiceCallRing` is written so that a person
 * who hears nothing still cannot miss the call.
 */

/** The three sounds this product makes. Nothing else may make one. */
export type CallSoundName = "ring" | "ringback" | "notification";

export interface CallSoundSpec {
  readonly name: CallSoundName;
  /**
   * The tones sounded together. Two is a telephone; one is a ringback.
   *
   * 440 and 480 are the pair a North American telephone rings on, and the beat
   * between them — 40 Hz — is what makes the sound read as mechanical rather
   * than as a test tone. 425 is the European ringing tone, used alone.
   */
  readonly frequencies: readonly number[];
  /** The peak level of the **whole** sound, 0..1. See `callSoundToneGain`. */
  readonly gain: number;
  /** The envelope of one burst. A square edge on a sine clicks; these remove it. */
  readonly attackMs: number;
  readonly releaseMs: number;
  /** Sound, silence, sound, silence… in milliseconds, beginning with sound. */
  readonly cadenceMs: readonly number[];
  /** Whether the cadence repeats until something stops it. */
  readonly loop: boolean;
}

/** The cadence a telephone rings on, shared by the ring and the ringback. */
const TELEPHONE_CADENCE_MS = [500, 200, 500, 2000] as const;

export const CALL_SOUNDS: Record<CallSoundName, CallSoundSpec> = {
  ring: {
    name: "ring",
    frequencies: [440, 480],
    gain: 0.16,
    attackMs: 18,
    releaseMs: 70,
    cadenceMs: TELEPHONE_CADENCE_MS,
    loop: true,
  },
  ringback: {
    name: "ringback",
    frequencies: [425],
    // Under half the ring's. The caller already knows a call is happening —
    // they started it — so this is confirmation rather than a summons, and a
    // summons is what a loud tone in your own ear for forty-five seconds is.
    gain: 0.07,
    attackMs: 18,
    releaseMs: 70,
    cadenceMs: TELEPHONE_CADENCE_MS,
    loop: true,
  },
  notification: {
    name: "notification",
    frequencies: [880],
    gain: 0.1,
    attackMs: 8,
    // Most of the burst is the release: a tone that stops dead reads as a
    // beep, and one that falls away reads as a bell.
    releaseMs: 180,
    cadenceMs: [220],
    loop: false,
  },
};

/**
 * The level one oscillator is given, so that the sum is `spec.gain`.
 *
 * Two sines at 0.16 each do not make a 0.16 sound; they make a 0.32 one that
 * clips against everything else the page is playing. The division is here
 * rather than in the player because it is arithmetic about the spec, and a
 * player that forgot it would be a defect nothing could see.
 */
export function callSoundToneGain(spec: CallSoundSpec): number {
  const voices = spec.frequencies.length;
  return voices > 0 ? spec.gain / voices : 0;
}

/** One burst of a sound: when it starts, relative to the sound's own start. */
export interface CallSoundBurst {
  readonly atMs: number;
  readonly durationMs: number;
}

/** How long one pass through the cadence takes, silence included. */
export function callSoundCycleMs(spec: CallSoundSpec): number {
  let total = 0;
  for (const step of spec.cadenceMs) total += Math.max(0, step);
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
    for (let step = 0; step < spec.cadenceMs.length; step += 1) {
      const length = Math.max(0, spec.cadenceMs[step]);
      // Even steps are sound, odd steps are silence — the cadence begins with
      // sound, which is what makes the array readable as one.
      if (step % 2 === 0 && length > 0 && at >= window.fromMs && at < window.untilMs) {
        out.push({ atMs: at, durationMs: length });
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
