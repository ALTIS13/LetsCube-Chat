/**
 * How the microphone decides to be open in a call, as rules that need no
 * browser.
 *
 * Until now a call's microphone had two states — publishing, or self-muted —
 * and nothing in between, which is the largest thing a Discord user misses at
 * once. Discord's settings screen calls the choice «Voice Activity» versus
 * «Push to Talk»; this module is that choice, its threshold arithmetic, its
 * hysteresis, the key that holds it open and what each of the three modes makes
 * the in-call controls mean.
 *
 * It imports nothing, on purpose. The lesson is written in CLAUDE.md and again
 * at the head of `voiceChannel.ts`: a decision inside a `"use client"` module
 * is a decision with no test, and moving the decision is cheaper than building
 * a harness around it. Everything here is reachable from `node --test`, and
 * `tests/unit/mic-gate.test.mts` holds it.
 *
 * What is **not** here, and where it is instead:
 *
 *  - the level itself, which needs an `AudioContext` — `lib/micLevel.ts`;
 *  - the gate reaching the published track, which needs the transport —
 *    `hooks/voiceRoom.ts`, behind `setMicrophoneOpen`;
 *  - where the choice is stored — `hooks/useAudioSettings.ts`, which calls the
 *    two readers below rather than growing clamps of its own.
 *
 * The vocabulary is here as well, rather than in `lib/audioSettingsSurface.ts`,
 * because two surfaces say it: the settings screen names the mode, and the
 * capsule and the call bar name the same mode in the title of a control. One
 * home for the words is what keeps the two from drifting.
 */

/* ── The mode ─────────────────────────────────────────────────────────────── */

/**
 * How the microphone opens.
 *
 * Three, where Discord has two, and the third is not a relabel of the other
 * two: `open` is **what this product has always done** — the capture is on the
 * air from the moment it is published until somebody presses mute. It is the
 * default for exactly that reason (see `MIC_ACTIVATION_DEFAULT`): a stored
 * settings value written before this feature existed has to go on meaning what
 * it meant, and a person who never opens this section must not find a noise
 * gate in front of their voice tomorrow.
 *
 * Calling `open` «voice activity with the threshold at zero» was the other
 * option, and it is what Discord's own slider does at its bottom end. It is
 * refused here because the interface would then be naming a gate that never
 * closes, which is a label disagreeing with its mechanism.
 */
export type MicActivation = "open" | "voice" | "ptt";

export const MIC_ACTIVATION_DEFAULT: MicActivation = "open";

export function readMicActivation(value: unknown, fallback: MicActivation = MIC_ACTIVATION_DEFAULT): MicActivation {
  return value === "open" || value === "voice" || value === "ptt" ? value : fallback;
}

/* ── The threshold, and why it is not a number of decibels ────────────────── */

/**
 * The quietest level the slider can ask for, in dBFS.
 *
 * The control is a position from 0 to 1 and this is what position 0.01 means;
 * position 0 means «never closes» (see `micGateOpenAt`). A position rather than
 * a decibel value because the slider has to be draggable and the live level has
 * to be drawn **on the same axis** — a person setting a threshold is comparing
 * two quantities, and two axes for one comparison is how a threshold control
 * becomes guesswork. `micLevelPosition` is the other half of that mapping.
 *
 * −70 dBFS is the floor rather than −100: below about −70 the quantisation
 * noise of a 16-bit capture and a browser's own noise suppression live, so the
 * bottom third of the slider would be a region where nothing ever happens.
 */
export const MIC_GATE_FLOOR_DB = -70;

/**
 * Where the threshold sits for somebody who switches to «По голосу» and drags
 * nothing.
 *
 * 0.35 of the range is −45.5 dBFS. Stated as what it is: a **starting point**,
 * not a measurement of anybody's room. Conversational speech peaks at roughly
 * −25 dBFS into a laptop capture and a quiet room with the browser's noise
 * suppression on (this product's default «Чистый голос» mode) sits below
 * −60 dBFS, so −45 is between them with about 15 dB of margin either way. The
 * reason a default can be this rough is that the surface draws the live level
 * against it: the control exists to be calibrated by the person, in the one
 * place where their own microphone and their own room are available.
 */
export const MIC_GATE_THRESHOLD_DEFAULT = 0.35;

/** 0..1, and anything that is not a finite number is the default. */
export function clampMicGateThreshold(
  value: unknown,
  fallback: number = MIC_GATE_THRESHOLD_DEFAULT,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric <= 0) return 0;
  if (numeric >= 1) return 1;
  return numeric;
}

/**
 * The peak amplitude, 0..1, a level has to reach to open the gate.
 *
 * `0` at position 0 by definition rather than by arithmetic: the continuous
 * mapping would give −70 dBFS there, which is indistinguishable from «open»
 * for a live capture, and a person who has dragged the slider to the floor
 * means «stop deciding for me».
 */
export function micGateOpenAt(threshold: number): number {
  const position = clampMicGateThreshold(threshold);
  if (position <= 0) return 0;
  return 10 ** ((MIC_GATE_FLOOR_DB * (1 - position)) / 20);
}

/**
 * Where the gate lets go, which is **6 dB below** where it opens.
 *
 * The hysteresis, and the reason a bare threshold is not enough: a voice
 * hovering at the line opens and closes the microphone several times a second,
 * which is worse than either state — a listener hears the first consonant of
 * every third word. 6 dB is half the amplitude, so a voice that opened the gate
 * has to fall to half its own loudness before the gate will consider closing,
 * and the fall of a syllable's tail is much less than that.
 *
 * The pair is the second half of the answer. The first is `MIC_GATE_HOLD_MS`.
 */
export function micGateCloseAt(threshold: number): number {
  return micGateOpenAt(threshold) / 2;
}

/**
 * How long the gate stays open after the voice last cleared the closing level.
 *
 * 400 ms, from the shape of speech rather than from taste: the silence inside a
 * sentence — between words, and the stop before a plosive — runs to about
 * 250 ms, so a tail shorter than that cuts a person off inside their own
 * sentence. Past roughly half a second the tail stops being a tail and starts
 * publishing the room between sentences, which is what the gate is for.
 *
 * It also bounds the chatter arithmetic: whatever the level does, the gate
 * cannot close more than 2.5 times a second, and with the 6 dB pair above it
 * takes a fall of half the amplitude to close at all.
 */
export const MIC_GATE_HOLD_MS = 400;

/**
 * What the gate is, between two readings.
 *
 * `openUntil` is a deadline in the same clock the caller passes as `now`, which
 * is `Date.now()` at the call site and a plain number in the tests.
 */
export interface MicGateState {
  readonly open: boolean;
  readonly openUntil: number;
}

export const MIC_GATE_CLOSED: MicGateState = { open: false, openUntil: 0 };

export interface MicGateInput {
  readonly activation: MicActivation;
  /** Self-mute. It wins over every mode, including a held key. */
  readonly muted: boolean;
  /** Whether the talk control — key or button — is being held right now. */
  readonly held: boolean;
  /** Peak amplitude of the last reading, 0..1. */
  readonly level: number;
  /** The stored threshold position, 0..1. */
  readonly threshold: number;
  readonly now: number;
}

/**
 * The gate, one reading at a time.
 *
 * Pure and total: the same input gives the same output, and there is no branch
 * that leaves the microphone in a state nobody asked for. The order of the
 * three tests is the order in which the reasons beat each other.
 *
 * **A mute is a mute.** It comes first because the alternative is a product
 * where a held key defeats the control a person pressed to stop being heard.
 * This is also what stops the two mechanisms fighting over one knob: the seam
 * disables the underlying track for the gate and the SDK disables it for a
 * mute, so a gate that could open while muted would re-enable a track the SDK
 * still believes is muted — audible, with the interface saying «выключен».
 *
 * **`open` is the old behaviour**, stated as one line rather than implied.
 *
 * **Push to talk has no tail.** The whole promise of the control is that
 * letting go stops it; a hold-open of even 200 ms turns that promise into
 * «mostly».
 */
export function nextMicGate(state: MicGateState, input: MicGateInput): MicGateState {
  if (input.muted) return MIC_GATE_CLOSED;
  if (input.activation === "open") return { open: true, openUntil: 0 };
  if (input.activation === "ptt") return input.held ? { open: true, openUntil: 0 } : MIC_GATE_CLOSED;

  const level = Number.isFinite(input.level) ? input.level : 0;
  if (level >= micGateOpenAt(input.threshold)) {
    return { open: true, openUntil: input.now + MIC_GATE_HOLD_MS };
  }
  if (!state.open) return MIC_GATE_CLOSED;
  // Still above the closing level: the tail is measured from the last reading
  // that cleared it, not from the last one that crossed the opening level, so a
  // voice trailing off does not get cut at a fixed 400 ms after its loudest
  // syllable.
  if (level >= micGateCloseAt(input.threshold)) {
    return { open: true, openUntil: input.now + MIC_GATE_HOLD_MS };
  }
  return input.now < state.openUntil ? state : MIC_GATE_CLOSED;
}

/**
 * Whether a mode needs a level at all, which is whether a call has to run an
 * `AudioContext`.
 *
 * Asked rather than assumed because a meter kept alive after it is needed is a
 * battery defect, and two of the three modes need no meter: `open` decides
 * nothing from the level and `ptt` decides from a key.
 */
export function micGateNeedsLevel(activation: MicActivation): boolean {
  return activation === "voice";
}

/**
 * The live level, placed on the threshold's own axis.
 *
 * The inverse of `micGateOpenAt`, so a bar drawn at this fraction of a slider's
 * width lines up with the handle when the two are equal — which is the whole
 * point of storing a position rather than a number of decibels.
 */
export function micLevelPosition(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  if (level >= 1) return 1;
  const db = 20 * Math.log10(level);
  if (db <= MIC_GATE_FLOOR_DB) return 0;
  return 1 - db / MIC_GATE_FLOOR_DB;
}

/* ── The meter, and what «reduce motion» does to it ───────────────────────── */

/**
 * How coarse the bar becomes for somebody who has asked for reduced motion.
 *
 * 5% of the axis, which is 3.5 dB of the 70 the axis spans, and twenty
 * distinguishable steps across it.
 */
export const MIC_METER_STEP_PERCENT = 5;

/**
 * The width of the level bar, as a percentage of the threshold's own axis.
 *
 * **The bar goes on moving under `prefers-reduced-motion`, and that is the
 * decision rather than an omission.** The preference is about movement a person
 * did not ask for and cannot use — a panel sliding, a card lifting, a ripple.
 * This bar is the measurement: a threshold control without it is the guesswork
 * the control exists to end, and freezing it would not reduce motion so much as
 * remove the instrument. What is removed instead is the part that is genuinely
 * animation rather than data:
 *
 *  - the reading is **quantised** to `MIC_METER_STEP_PERCENT`, so the bar steps
 *    between twenty positions instead of streaming through 101 of them;
 *  - the caller drops the CSS `transition`, so the browser stops interpolating
 *    a further sixty frames between two readings that already arrive twenty
 *    times a second.
 *
 * `aria-valuenow` is taken from the same number, so what a screen reader is
 * told and what the eye sees are one reading and not two.
 */
export function micMeterPercent(level: number, reducedMotion: boolean): number {
  const exact = micLevelPosition(level) * 100;
  if (!reducedMotion) return Math.round(exact);
  return Math.round(exact / MIC_METER_STEP_PERCENT) * MIC_METER_STEP_PERCENT;
}

/* ── Placing the threshold from the room rather than by eye ───────────────── */

/**
 * How far above the measured noise the threshold is placed, in dB.
 *
 * 10, and the first 6 of them are not taste: `micGateCloseAt` lets go 6 dB
 * below where it opens, so a threshold sitting less than 6 dB above the room
 * would have its *closing* level at or under the room's own noise and the gate,
 * once opened, would never close again. 10 leaves 4 dB of headroom past that
 * for a room that is not perfectly steady — a fan cycling, a street outside.
 */
export const MIC_AUTO_THRESHOLD_MARGIN_DB = 10;

/** How long the measurement listens. Two seconds of room, no more. */
export const MIC_AUTO_THRESHOLD_MS = 2000;

/**
 * The fewest readings an answer may be computed from.
 *
 * A guard rather than a schedule: the caller stops by the clock above, and this
 * refuses an answer when the level never really arrived — a browser that gave
 * no `AudioContext`, a capture torn down under the run. Twenty is one second at
 * the 50 ms the level is read on, so a run that produced fewer than this did
 * not measure a room, and saying so is better than placing a threshold from
 * four samples.
 *
 * **It is not the only reason to refuse, and until D-280 it was.** A run can
 * arrive complete and still contain nothing; see `micAutoThresholdRefusal`.
 */
export const MIC_AUTO_THRESHOLD_MIN_SAMPLES = 20;

/**
 * Which part of the run is taken as «the room».
 *
 * The quarter-point of the sorted readings, not the mean and not the median.
 * Speech has gaps — the silence inside a sentence runs to about 250 ms, which
 * is five readings — so a quarter of a two-second run is quiet whether the
 * person stayed silent throughout or talked over half of it. The mean would be
 * dragged up by every syllable, and the median by anyone who did not stop.
 */
export const MIC_AUTO_THRESHOLD_FLOOR_QUANTILE = 0.25;

/**
 * Never so high that ordinary speech cannot open it.
 *
 * There is deliberately **no matching floor**. One was written here first —
 * `MIC_AUTO_THRESHOLD_MIN = 0.05`, guarding against a measured threshold of 0,
 * which is the one value that means «never closes». A mutation proved it dead:
 * the quietest room measures as position 0, and the margin above already lifts
 * that to 10/70 = 0.143, so the clamp could not fire for any input. What keeps
 * a measured threshold off the floor is the margin, and an unreachable clamp
 * pretending to do it would have been a guarantee nothing could test.
 */
export const MIC_AUTO_THRESHOLD_MAX = 0.9;

/**
 * Why a run is not a measurement, or `null` when it is one.
 *
 * **The whole of D-280.** The owner pressed «Подобрать порог» with his
 * microphone's analogue dimmer at zero and the control confidently set a
 * threshold. It had only ever been able to refuse a run that was *short* —
 * `MIC_AUTO_THRESHOLD_MIN_SAMPLES` — and had no way to say «the readings
 * arrived and were nothing». Two seconds of a dead capture is forty readings,
 * which is twice what that guard asks for.
 *
 * ## The rule, and why it is stated on the axis rather than in decibels
 *
 * `"silent"` is **not one reading in the whole run rose off the bottom of the
 * control's own axis**. No new constant: `micLevelPosition` already carries
 * `MIC_GATE_FLOOR_DB`, and the condition is exactly the one a person watches —
 * the bar sat at 0% for two continuous seconds. The owner's own words for what
 * the reference client does, and the sentence this rule is built from:
 * «дискорд в такие моменты полоску никуда не двигает если нет реального шума
 * или звука».
 *
 * It is also, exactly, the condition under which this function stops being a
 * function of its input. Every position at 0 means the quarter-point is 0, so
 * the answer is `MIC_AUTO_THRESHOLD_MARGIN_DB / -MIC_GATE_FLOOR_DB` — 0.14 —
 * for a dead microphone, an ended track and a muted headset alike. Refusing
 * where the output cannot depend on the input is the formal shape of «that was
 * not a measurement», and it is why the rule needs no tuned number.
 *
 * ## What was measured before it was chosen
 *
 * Synthetic captures driven through the real constraint pipeline — Chromium's
 * file-backed fake device, the product's default `ec`/`ns`/`agc`, read exactly
 * as `lib/micLevel.ts` reads: float peak over 2048 samples, forty readings at
 * 50 ms, which is this control's own run. `output/d280-measure-autothreshold.mjs`
 * and `output/d280-measure-dead.mjs`, both gitignored, so the numbers are here:
 *
 * | capture | readings off the floor | p25 | shipped answer |
 * | --- | --- | --- | --- |
 * | digital silence | 0/40 | −inf | 0.14 |
 * | track ended | 0/40 | −inf | 0.14 |
 * | track disabled before the run (a mute) | 0/40 | −inf | 0.14 |
 * | capsule dimmed to −85 dBFS | 0/40 | −93.1 dBFS | 0.14 |
 * | quiet room, peak −70 dBFS | 2/40 | −87.1 dBFS | 0.14 |
 * | quiet room, peak −65 dBFS | 12/40 | −83.3 dBFS | 0.14 |
 * | ordinary room, peak −50 dBFS | 35/40 | −67.8 dBFS | 0.17 |
 * | voice, peak −25 dBFS | 40/40 | −23.8 dBFS | 0.80 |
 *
 * The line falls between the fourth row and the fifth, and nothing a room
 * produced is on the wrong side of it.
 *
 * ## The hypothesis this replaced, refuted in the wrong direction
 *
 * The lead's proposal was **variation**: a dead capture is flat, a real room
 * fluctuates however quiet it is. Measured, it fails twice. In position units
 * digital silence and a capsule dimmed to −85 dBFS both span exactly 0.0000 —
 * both clamped at the floor — against 0.0206 for a quiet room at −70, which is
 * not a separation anything could be set between. In raw decibels it inverts:
 * the p90/p10 spread is **68.8 dB for the −85 dBFS capsule** and 19–28 dB for
 * every real room, because two readings near the converter's last step differ
 * by a huge ratio. «Refuse a flat run» would have refused the quiet room and
 * accepted the dead capsule.
 *
 * ## And the larger rule that was rejected
 *
 * Refusing when the **quarter-point** is at the floor is the rule that would
 * catch every run whose answer is that same 0.14 constant, which is tempting
 * and wrong: the quiet-room fixtures at peak −65 and −60 have quarter-points at
 * −83 and −78 dBFS, so it refuses them. Whether that is the fixture's
 * modulation or a real room's is not answerable on a workstation with no
 * microphone — and a rule whose correctness turns on an unmeasurable property
 * of real rooms is not one to ship. This rule refuses nothing that produced a
 * signal.
 *
 * ## What it deliberately does not do
 *
 * It does **not** reuse `MIC_NO_INPUT_FLOOR_DB = -42`. That constant answers
 * «did this microphone produce a *sound*», judged against speech; this asks
 * «what is this room's *noise floor*», and a quiet room with a good microphone
 * lives at −60 to −70. A −42 refusal would refuse to calibrate for exactly the
 * people who most want voice activation. The two questions share the axis and
 * nothing else.
 *
 * And it does not refuse the owner's own capture. On the float instrument his
 * dimmer at zero measures about −64 dBFS and the control answers 23%, which is
 * a real noise floor honestly resolved — «теперь реально определяет только шум
 * в реальном времени». A rule that refused that would be a second defect
 * wearing the first one's clothes.
 */
export type MicAutoThresholdRefusal = "few" | "silent";

export function micAutoThresholdRefusal(levels: readonly number[]): MicAutoThresholdRefusal | null {
  const positions = levels.filter((level) => Number.isFinite(level)).map(micLevelPosition);
  if (positions.length < MIC_AUTO_THRESHOLD_MIN_SAMPLES) return "few";
  let loudest = 0;
  for (const position of positions) if (position > loudest) loudest = position;
  // `<= 0` and not `=== 0`: `micLevelPosition` is total and already clamps, so
  // this is the same set — written as an inequality because what it means is
  // «nothing reached the bottom of the axis», not «everything was exactly a
  // particular float».
  if (loudest <= 0) return "silent";
  return null;
}

/**
 * A threshold position measured from a run of levels, or `null` for «that was
 * not a measurement».
 *
 * `null` rather than a default, and that distinction is the whole point: a
 * function that answered `MIC_GATE_THRESHOLD_DEFAULT` when it had nothing would
 * be indistinguishable from one that had measured a room and found it to be
 * exactly average. The caller says «не удалось измерить» instead.
 *
 * **Which** «not a measurement» it was is `micAutoThresholdRefusal`, and this
 * delegates to it rather than repeating the test, so the two can never
 * disagree about a run — a surface that said «нет звука» over a threshold that
 * had just been written would be worse than either message alone.
 */
export function autoMicThreshold(levels: readonly number[]): number | null {
  if (micAutoThresholdRefusal(levels) !== null) return null;
  const positions = levels
    .filter((level) => Number.isFinite(level))
    .map(micLevelPosition)
    .sort((a, b) => a - b);
  const index = Math.min(
    positions.length - 1,
    Math.floor(positions.length * MIC_AUTO_THRESHOLD_FLOOR_QUANTILE),
  );
  const floor = positions[index];
  // The margin is also what keeps the answer off the floor of the slider: the
  // quietest possible room is position 0, and 0 is the one value that means
  // «never closes». See `MIC_AUTO_THRESHOLD_MAX` for the clamp that was here
  // and why it went.
  const answer = floor + MIC_AUTO_THRESHOLD_MARGIN_DB / -MIC_GATE_FLOOR_DB;
  if (answer >= MIC_AUTO_THRESHOLD_MAX) return MIC_AUTO_THRESHOLD_MAX;
  // The slider steps in hundredths, so an answer it cannot represent would put
  // the handle somewhere the person can never put it back.
  return Math.round(answer * 100) / 100;
}

/* ── The key ──────────────────────────────────────────────────────────────── */

/**
 * The talk key, as a `KeyboardEvent.code`.
 *
 * A code and not a `key`, because the physical key is what a person holds: on
 * the Russian layout the key left of «1» prints «ё» and on the US layout «`»,
 * and it is one key either way. `Backquote` is the default for three reasons —
 * it is where the hand already rests, it is the key every game binds for the
 * same job, and it exists on every keyboard, which the function row does not
 * reliably (a laptop whose F-row defaults to media keys never delivers F8 to a
 * page at all).
 *
 * It is rebindable, and that is not gold plating: `Backquote` **prints a
 * character**, so while the cursor is in the composer it types instead of
 * talking (see `micTalkKeyFires`) — and in a messenger the cursor is in the
 * composer most of the time. The person who minds that needs a key that prints
 * nothing, and the settings row says so rather than leaving them to discover
 * it mid-sentence.
 */
export const MIC_TALK_KEY_DEFAULT = "Backquote";

/**
 * Codes that may not become the talk key, each for a reason of its own.
 *
 * `Escape` belongs to whatever a person opened — D-194 is in the register
 * precisely about who owns that key and what it costs when two owners disagree.
 * `Tab` and the two `Enter`s move focus and send. `Space` scrolls the
 * conversation and, in the composer, types. `F5`, `F11` and `F12` are the
 * browser's own and never reach the page in a usable state.
 */
export const MIC_TALK_KEY_REFUSED: readonly string[] = [
  "Escape",
  "Tab",
  "Enter",
  "NumpadEnter",
  "Space",
  "F5",
  "F11",
  "F12",
];

/** A bare modifier cannot be the talk key: see `micTalkKeyRefusal`. */
const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** Codes that put a character into a field, which is what makes the rule below. */
const TYPES_TEXT =
  /^(Key[A-Z]|Digit[0-9]|Numpad(?!Enter)|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Space|Intl(Backslash|Ro|Yen))/;

export function micTalkKeyTypes(code: string): boolean {
  return TYPES_TEXT.test(code);
}

/**
 * Why a key was refused, or `null` when it is acceptable.
 *
 * A sentence rather than a boolean, because the recorder has to say what
 * happened: a control that swallows a press and changes nothing is read as
 * broken.
 */
export function micTalkKeyRefusal(code: string): string | null {
  if (!code.trim()) return "Клавиша не распознана. Попробуйте ещё раз.";
  if (MODIFIER_CODES.test(code)) {
    return "Модификатор не подходит: Shift, Ctrl и Alt нужны для других сочетаний.";
  }
  if (MIC_TALK_KEY_REFUSED.includes(code)) {
    return "Эта клавиша уже занята интерфейсом. Выберите другую.";
  }
  return null;
}

/** What the chosen key is called on screen. */
export function micTalkKeyLabel(code: string): string {
  if (code === "Backquote") return "Ё / ~";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (code.startsWith("Numpad")) return `Num ${code.slice(6) || ""}`.trim();
  const named: Record<string, string> = {
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    CapsLock: "Caps Lock",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "Page Up",
    PageDown: "Page Down",
    ArrowUp: "Вверх",
    ArrowDown: "Вниз",
    ArrowLeft: "Влево",
    ArrowRight: "Вправо",
  };
  return named[code] ?? code;
}

export interface MicTalkKeyEvent {
  readonly code: string;
  /** Held modifiers. A chord is not a hold: see below. */
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  /** Whether the focus is in a field that takes text. */
  readonly editable: boolean;
  /** The key is already down and the OS is repeating it. */
  readonly repeat: boolean;
}

/**
 * Whether a keydown should open the microphone.
 *
 * Four rules, and the third is the one that is easy to get backwards.
 *
 * **The code has to match**, and a repeat is not a new press — the gate is
 * already open and re-opening it on every repeat would publish a change several
 * times a second for a key that has not moved.
 *
 * **Not while Ctrl, Alt or Meta is held.** `Alt+Backquote` is a window
 * shortcut on more than one desktop, and `Ctrl+`\` is a shortcut in more than
 * one editor; transmitting a room because somebody switched windows is the
 * defect this rule exists for. Shift is deliberately not in that list: it
 * changes what a key prints and not what it means, and a person holding Shift
 * to type is covered by the rule below.
 *
 * **In a text field, only a key that prints nothing talks.** A printing key
 * must reach the field — a person typing «ёлка» into the composer is typing,
 * not talking — while `F8` or `CapsLock` cannot possibly be text and so stays a
 * talk key wherever the cursor is. This is what makes the choice of key worth
 * offering: the default prints, and the interface says what that costs.
 *
 * The release is deliberately **not** this function's business. See
 * `micTalkKeyReleases`.
 */
export function micTalkKeyFires(event: MicTalkKeyEvent, bound: string): boolean {
  if (event.code !== bound) return false;
  if (event.repeat) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.editable && micTalkKeyTypes(event.code)) return false;
  return true;
}

/**
 * Whether a keyup should close the microphone — and it asks almost nothing.
 *
 * Only the code, because every other condition is a way to leave a microphone
 * open. Hold the key, press Ctrl, let go: the modifier test would refuse the
 * release. Hold the key, Tab into the composer, let go: the editable test would
 * refuse it, and the keyup would land on the field. A release always releases;
 * the worst a wrong release can do is stop transmitting a moment early, and the
 * worst a missed one does is publish a room nobody meant to publish.
 */
export function micTalkKeyReleases(code: string, bound: string): boolean {
  return code === bound;
}

/**
 * Why a held talk key is dropped without a keyup, listed so the wiring can be
 * read against the reasons.
 *
 * A window that loses focus never receives the keyup: `Alt+Tab` is delivered to
 * the desktop, and on Windows the key is physically released over another
 * application entirely. The same is true of a tab going to the background and
 * of a page being put away on a phone. Each of these has to close the gate, or
 * «a microphone stuck open because somebody alt-tabbed» is exactly what ships.
 */
export const MIC_TALK_RELEASE_EVENTS: readonly string[] = ["blur", "pointerup", "pointercancel", "visibilitychange"];

/* ── What the controls say, mode by mode ──────────────────────────────────── */

/** The segment labels, in the order the picker draws them. */
export interface MicActivationSegment {
  readonly mode: MicActivation;
  readonly label: string;
}

/**
 * Discord's own two words, in the vocabulary a Russian Discord user already has
 * — «Рация» is what its own interface calls push to talk — plus the state this
 * product has always been in.
 */
export const MIC_ACTIVATION_SEGMENTS: readonly MicActivationSegment[] = [
  { mode: "open", label: "Всегда" },
  { mode: "voice", label: "По голосу" },
  { mode: "ptt", label: "Рация" },
];

export const MIC_ACTIVATION_GROUP_CAPTION = "Микрофон в звонке";

/**
 * The one fact a person cannot read off the controls: this is about calls and
 * nothing else. A voice message is recorded by holding a button and is not
 * gated, and somebody who set «Рация» here would otherwise have to wonder.
 */
export const MIC_ACTIVATION_SCOPE_NOTE =
  "Относится только к звонкам. Голосовые сообщения записываются как раньше.";

export const MIC_ACTIVATION_GROUP_LABEL = "Как включается микрофон";

/** The line under the picker, which says what the chosen mode does. */
export function micActivationHint(activation: MicActivation): string {
  if (activation === "voice") {
    return "Микрофон открывается, когда вы говорите громче порога, и закрывается через мгновение после.";
  }
  if (activation === "ptt") {
    return "Микрофон открыт, только пока вы держите клавишу или кнопку «Говорить» в звонке.";
  }
  return "Микрофон открыт всё время, пока вы не выключите его в звонке.";
}

/**
 * Where the sensitivity control is, said in the group that does not have it.
 *
 * D-279. The owner, twice, looking for it: «не вижу этой самой живой полосы с
 * уровнями громкости микрофона с соответствующей регулировкой
 * чувствительности». He had found the level meter — «Уровень» is outside the
 * mode gate and he had it running — so what he could not find was the
 * *threshold*, which is drawn only for «По голосу», and «Всегда» is the
 * default.
 *
 * **Drawn as a line and not as the control**, which is the decision here.
 * `docs/operations/reference-clients.md` §8 sets out the four answers Discord
 * gives to «this control cannot work here», and the one it never gives is a
 * control that is present and inert. Our threshold in «Всегда» would be
 * exactly that: a slider a person could calibrate carefully, against a live
 * bar, that changed nothing about who hears them — a worse lie than not
 * drawing it. So the control stays inside its mode and the group says where
 * it went, once, in the words he used.
 *
 * The word is his and not the label's. The control is «Порог голоса»
 * everywhere it is drawn, because the whole surface around it — «Подобрать
 * порог», both hints — is built on that word; but a person who has Discord's
 * «Входная чувствительность» in their head searches for «чувствительность»,
 * and this is the one line whose job is to be found by that search.
 */
export const MIC_GATE_THRESHOLD_ELSEWHERE_NOTE =
  "Чувствительность микрофона настраивается только в режиме «По голосу»: порог и живая полоса уровня появляются там.";

export const MIC_GATE_THRESHOLD_LABEL = "Порог голоса";
export const MIC_GATE_LEVEL_LABEL = "Уровень микрофона относительно порога";

/**
 * The line under the threshold, in its two states.
 *
 * The level comes from the microphone test above it rather than from a second
 * capture of its own: a person calibrating a threshold is already looking at
 * their own level, and a settings screen that opens the microphone by itself is
 * a settings screen that turns the light on when nobody asked.
 *
 * **It names the notch and not the colour**, which is a decision rather than
 * brevity. The meter says «through» in hue, and a sentence that said «полоса
 * становится синей» would be an instruction only some readers can follow —
 * the whole reason that hue pair is amber against blue rather than Discord's
 * warm against green. A landmark and a crossing are readable by everybody.
 */
export function micGateThresholdHint(testing: boolean): string {
  return testing
    ? "Полоса под ползунком — ваш уровень, засечка на ней — порог. Пока полоса не дошла до засечки, вас не слышно: говорите обычным голосом и поднимайте порог, пока полоса не перестанет переходить засечку в тишине."
    : `Полоса под ползунком — ваш уровень на той же шкале, засечка на ней — порог. Нажмите «${MIC_AUTO_THRESHOLD_LABEL}»: микрофон включится, и вы её увидите.`;
}

/**
 * The calibration control, and the three things it can be in the middle of.
 *
 * It is a **button and not a switch**, which is a decision and not a shortcut.
 * Discord's «Automatically determine input sensitivity» keeps deciding for the
 * whole call: it follows the room while you are in it. Nothing here can do
 * that — the level a call reads lives in `hooks/useVoiceCall.ts`, on the call's
 * own capture, and this screen's capture ends when the screen closes. A switch
 * called «автоматически» that in fact measured once, here, and then stopped
 * would be a label describing a mechanism the product does not have, which is
 * the one thing the register refuses more consistently than any visual defect.
 *
 * So the control says what it does: it listens for two seconds and puts the
 * threshold where the measurement says it goes.
 */
export type MicAutoThresholdState = "idle" | "listening" | "done" | "failed" | "silent";

export const MIC_AUTO_THRESHOLD_LABEL = "Подобрать порог";
export const MIC_AUTO_THRESHOLD_BUSY_LABEL = "Слушаем…";

/**
 * Five states, and the last two are both refusals for different reasons.
 *
 * `failed` is «the level never arrived» — no `AudioContext`, a capture torn
 * down under the run, fewer readings than `MIC_AUTO_THRESHOLD_MIN_SAMPLES`.
 * Nothing about the microphone follows from it and the sentence says nothing
 * about the microphone.
 *
 * `silent` is the D-280 refusal: the readings arrived, all forty of them, and
 * not one moved the bar off zero. That **is** a statement about the microphone
 * and it names the same three things to check that `MIC_NO_INPUT_HINT` names,
 * deliberately in the same order — they are one question asked in two places,
 * and a person who meets both should not have to notice they are the same.
 *
 * The one sentence this must not become is «не удалось измерить», which was
 * the shipped copy for both and is true of one.
 */
export function micAutoThresholdNote(state: MicAutoThresholdState): string {
  if (state === "listening") {
    return "Помолчите: измеряем шум вашей комнаты. Займёт две секунды.";
  }
  if (state === "done") {
    return `Порог поставлен на ${MIC_AUTO_THRESHOLD_MARGIN_DB} дБ выше измеренного шума комнаты. Скажите что-нибудь: полоса должна загораться на голосе и гаснуть в тишине.`;
  }
  if (state === "silent") {
    return "За две секунды микрофон не дал ни одного звука, поэтому измерять было нечего: порог остался прежним. Проверьте, не выключен ли он на гарнитуре, не приглушён ли в системе и тот ли это микрофон.";
  }
  if (state === "failed") {
    return "Не удалось измерить: уровень микрофона так и не пришёл. Порог остался прежним.";
  }
  return `Включит микрофон, послушает комнату две секунды и поставит порог на ${MIC_AUTO_THRESHOLD_MARGIN_DB} дБ выше её шума.`;
}

/**
 * Whether the measurement has finished, in either direction.
 *
 * The three states in which the control has let go of the capture — and the
 * capture is still open, which is what `MIC_AUTO_THRESHOLD_CAPTURE_NOTE` is
 * for. Exported rather than written as a comparison at the call site so that
 * adding a sixth state cannot quietly leave the sentence out of it.
 */
export function micAutoThresholdSettled(state: MicAutoThresholdState): boolean {
  return state === "done" || state === "failed" || state === "silent";
}

/**
 * That the microphone is on, said where it was switched on — D-281.
 *
 * The owner, twice: «но также активирует сверху функцию проверки». He pressed
 * «Подобрать порог», the «Уровень» control two groups up flipped to
 * «Остановить», and nothing told him either before or after. `lib/micLevel.ts`
 * states the principle this breaks — «a settings screen that opens the
 * microphone by itself is a settings screen that turns the light on when
 * nobody asked» — and the comment beside this control in
 * `AudioSettingsSection.tsx` was written to *defend* the opening, not the
 * silence about it.
 *
 * **The capture stays, and the surface speaks.** The alternative was to close
 * it again, and it loses more than it saves: `micAutoThresholdNote("done")`
 * ends «Скажите что-нибудь: полоса должна загораться на голосе и гаснуть в
 * тишине», which is the step that turns a number into a threshold somebody has
 * *watched work*; and the whole threshold group is drawn around a live bar, so
 * a control that measured and then killed the capture would leave
 * `micGateThresholdHint(true)` describing a bar frozen at zero — which is
 * D-279 again, the copy promising something the pixels do not show. What was
 * wrong was never the capture. It was that it opened, and stayed open, without
 * a word.
 *
 * So: the idle note above now says the microphone will come on, and this says
 * it is on and where it goes off. The words «Остановить» and «Уровень» are the
 * real label and the real caption from `lib/audioSettingsSurface.ts`, written
 * out here because this module imports nothing;
 * `tests/unit/mic-gate.test.mts` reads both modules and fails if they drift.
 */
export const MIC_AUTO_THRESHOLD_CAPTURE_NOTE =
  "Микрофон сейчас включён — поэтому полоса живая. Выключить его: кнопка «Остановить» в группе «Уровень».";

export const MIC_TALK_KEY_ROW_LABEL = "Клавиша для разговора";
export const MIC_TALK_KEY_LISTENING = "Нажмите клавишу…";

/**
 * What a printing key costs, said where the key is chosen.
 *
 * Not a refusal: the default is such a key, it works everywhere except in a
 * field, and the on-screen button covers the field. A sentence is the honest
 * shape for «this works, with one exception you will meet».
 */
export function micTalkKeyNote(code: string): string {
  return micTalkKeyTypes(code)
    ? `Клавиша «${micTalkKeyLabel(code)}» печатает символ: пока курсор в поле ввода, она не включит микрофон — держите кнопку «Говорить».`
    : `Клавиша «${micTalkKeyLabel(code)}» ничего не печатает, поэтому работает и когда вы набираете сообщение.`;
}

/** The phone's half of the same feature, said once, where the key is chosen. */
export const MIC_TALK_TOUCH_NOTE =
  "На телефоне клавиатура не нужна: в звонке появляется кнопка «Говорить», которую держат пальцем.";

/**
 * What the two in-call controls say, in one place, for one state.
 *
 * The capsule and the call bar both draw them and neither may invent a word of
 * its own — they are two windows onto one call, which is the rule
 * `lib/voiceCallBar.ts` was written under.
 *
 * The distinction this exists for: in «Рация», **muted** and **not currently
 * held** are different states, and an interface that drew them the same way
 * would be telling somebody their microphone is off when it is merely waiting.
 * So a mute keeps the slashed glyph and the danger tone it has always had, and
 * a talk control that is simply not held is an ordinary control at rest.
 */
export interface MicControlWords {
  /** Whether the hold-to-talk control is drawn at all. */
  readonly talk: boolean;
  /**
   * The word printed on it, which does **not** change when it is held.
   *
   * The state is said by the fill, the glyph's tone and `aria-pressed`, never
   * by the width of a word: «Говорить» and «Говорите» are different widths, and
   * a control that resizes on every press reflows the capsule it sits in —
   * which at 390 points means the room's name re-truncating each time somebody
   * says a sentence.
   */
  readonly talkWord: string;
  /** Its accessible name, which says the state rather than the gesture. */
  readonly talkLabel: string;
  /** Its title, which says the gesture and names the key. */
  readonly talkTitle: string;
  /** Whether it can be pressed. A muted microphone is not held open. */
  readonly talkAvailable: boolean;
  /** What the mute control says, unchanged in the mode this product had. */
  readonly muteLabel: string;
  /** And its title, which is where the mode becomes discoverable in a call. */
  readonly muteTitle: string;
}

export interface MicControlInput {
  readonly activation: MicActivation;
  readonly muted: boolean;
  readonly held: boolean;
  /** The bound key, for the title of the talk control. */
  readonly talkKey: string;
}

export function micControlWords(input: MicControlInput): MicControlWords {
  const { activation, muted, held, talkKey } = input;
  const muteLabel = muted ? "Включить микрофон" : "Выключить микрофон";
  const muteTitle =
    activation === "voice"
      ? `${muteLabel} · открывается по голосу`
      : activation === "ptt"
        ? `${muteLabel} · режим рации`
        : muteLabel;
  if (activation !== "ptt") {
    return {
      talk: false,
      talkWord: "",
      talkLabel: "",
      talkTitle: "",
      talkAvailable: false,
      muteLabel,
      muteTitle,
    };
  }
  return {
    talk: true,
    talkWord: "Говорить",
    talkLabel: muted ? "Микрофон выключен" : held ? "Говорите" : "Говорить",
    talkTitle: muted
      ? "Сначала включите микрофон"
      : `Удерживайте, чтобы говорить · клавиша «${micTalkKeyLabel(talkKey)}»`,
    talkAvailable: !muted,
    muteLabel,
    muteTitle,
  };
}
