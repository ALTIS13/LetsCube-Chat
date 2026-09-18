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

export const MIC_GATE_THRESHOLD_LABEL = "Порог голоса";
export const MIC_GATE_LEVEL_LABEL = "Уровень микрофона относительно порога";

/**
 * The line under the threshold, in its two states.
 *
 * The level comes from the microphone test above it rather than from a second
 * capture of its own: a person calibrating a threshold is already looking at
 * their own level, and a settings screen that opens the microphone by itself is
 * a settings screen that turns the light on when nobody asked.
 */
export function micGateThresholdHint(testing: boolean): string {
  return testing
    ? "Полоса под ползунком светится, пока микрофон открыт. Говорите обычным голосом и поднимайте порог, пока не перестанет реагировать на тишину."
    : "Запустите проверку микрофона выше, чтобы увидеть свой уровень рядом с порогом.";
}

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
