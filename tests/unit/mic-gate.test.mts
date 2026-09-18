import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIC_ACTIVATION_DEFAULT,
  MIC_ACTIVATION_SEGMENTS,
  MIC_GATE_CLOSED,
  MIC_GATE_FLOOR_DB,
  MIC_GATE_HOLD_MS,
  MIC_GATE_THRESHOLD_DEFAULT,
  MIC_TALK_KEY_DEFAULT,
  MIC_TALK_KEY_REFUSED,
  MIC_TALK_RELEASE_EVENTS,
  clampMicGateThreshold,
  micActivationHint,
  micControlWords,
  micGateCloseAt,
  micGateNeedsLevel,
  micGateOpenAt,
  micGateThresholdHint,
  micLevelPosition,
  micTalkKeyFires,
  micTalkKeyLabel,
  micTalkKeyNote,
  micTalkKeyRefusal,
  micTalkKeyReleases,
  micTalkKeyTypes,
  nextMicGate,
  readMicActivation,
  type MicActivation,
  type MicGateState,
} from "../../artifacts/kub/src/lib/micGate.ts";
import { normalizeAudioSettings } from "../../artifacts/kub/src/hooks/useAudioSettings.ts";

/**
 * How the microphone decides to be open, measured without a browser.
 *
 * Everything here is `lib/micGate.ts`, which imports nothing — the module
 * boundary that makes a decision testable at all, and the lesson CLAUDE.md
 * records about `lib/supabase/config.ts`. The two things a `node --test`
 * process genuinely cannot hold are read as source at the end of this file:
 * the level instrument, which needs an `AudioContext`, and — in
 * `tests/unit/voice-room-seam.test.mjs` — the gate reaching the published
 * track, which needs LiveKit.
 */

/* ── The mode, and what a settings value written before today means ───────── */

test("a stored settings value from before this feature reads as the behaviour it had", () => {
  // The whole of the backward-compatibility contract, and the reason `open` is
  // a mode rather than «voice activity with the threshold at zero». Every
  // stored value in the product today has none of these three fields.
  const stored = normalizeAudioSettings({ micInputGain: 1.4, processingMode: "raw" });
  assert.equal(stored.micActivation, "open");
  assert.equal(stored.micActivation, MIC_ACTIVATION_DEFAULT);
  assert.equal(stored.micGateThreshold, MIC_GATE_THRESHOLD_DEFAULT);
  assert.equal(stored.micTalkKey, MIC_TALK_KEY_DEFAULT);
  // And `open` really is the old behaviour rather than a name for it: the gate
  // answers «open» for every level, muted excepted.
  for (const level of [0, 0.0001, 0.5, 1]) {
    assert.equal(
      nextMicGate(MIC_GATE_CLOSED, {
        activation: stored.micActivation,
        muted: false,
        held: false,
        level,
        threshold: stored.micGateThreshold,
        now: 1000,
      }).open,
      true,
    );
  }
});

test("a mode nobody wrote, and a threshold nobody could have set, fall back rather than through", () => {
  assert.equal(readMicActivation("ptt"), "ptt");
  assert.equal(readMicActivation("voice"), "voice");
  for (const wrong of [undefined, null, "", "PTT", "gate", 3, {}, []]) {
    assert.equal(readMicActivation(wrong), "open");
  }
  assert.equal(normalizeAudioSettings({ micActivation: "ptt" }).micActivation, "ptt");
  assert.equal(normalizeAudioSettings({ micActivation: "silly" }).micActivation, "open");

  assert.equal(clampMicGateThreshold(0.5), 0.5);
  assert.equal(clampMicGateThreshold(-3), 0);
  assert.equal(clampMicGateThreshold(12), 1);
  assert.equal(clampMicGateThreshold(Number.NaN), MIC_GATE_THRESHOLD_DEFAULT);
  assert.equal(clampMicGateThreshold("0.25"), 0.25, "a number that arrived as a string is still a number");
  assert.equal(normalizeAudioSettings({ micGateThreshold: 9 }).micGateThreshold, 1);

  // A key hand-edited into storage is held to the same refusal the recorder
  // applies, or `Escape` could be bound by editing a JSON blob.
  assert.equal(normalizeAudioSettings({ micTalkKey: "F8" }).micTalkKey, "F8");
  assert.equal(normalizeAudioSettings({ micTalkKey: "Escape" }).micTalkKey, MIC_TALK_KEY_DEFAULT);
  assert.equal(normalizeAudioSettings({ micTalkKey: "ShiftLeft" }).micTalkKey, MIC_TALK_KEY_DEFAULT);
  assert.equal(normalizeAudioSettings({ micTalkKey: 7 }).micTalkKey, MIC_TALK_KEY_DEFAULT);
});

/* ── The threshold ────────────────────────────────────────────────────────── */

test("the threshold is a position on the same axis the level is drawn on", () => {
  // The two halves of one mapping. If they ever stop being inverses, the bar
  // under the slider stops meaning the handle above it and the control becomes
  // guesswork — which is what a threshold in decibels beside a meter in linear
  // amplitude would be.
  for (const position of [0.1, 0.2, 0.35, 0.5, 0.75, 0.95]) {
    const amplitude = micGateOpenAt(position);
    assert.ok(
      Math.abs(micLevelPosition(amplitude) - position) < 1e-9,
      `the level's position and the threshold's disagree at ${position}`,
    );
  }
  assert.equal(micGateOpenAt(0), 0, "a threshold at the floor has to mean «never closes»");
  assert.equal(micGateOpenAt(1), 1);
  assert.equal(micLevelPosition(0), 0);
  assert.equal(micLevelPosition(1), 1);
  assert.equal(micLevelPosition(Number.NaN), 0);
  assert.equal(micLevelPosition(-1), 0);
  assert.equal(micLevelPosition(4), 1, "a peak over the analyser's midpoint is still the top of the bar");
});

test("the default threshold sits between a quiet room and a speaking voice", () => {
  const db = 20 * Math.log10(micGateOpenAt(MIC_GATE_THRESHOLD_DEFAULT));
  // −45.5 dBFS. Stated as an interval rather than as an equality so the number
  // can be tuned without a test rewrite, and narrow enough that a tuning which
  // put the default above conversational speech or below a room's noise floor
  // would fail.
  assert.ok(db < -35, `the default threshold is ${db.toFixed(1)} dBFS, which speech would struggle to clear`);
  assert.ok(db > -58, `the default threshold is ${db.toFixed(1)} dBFS, which a quiet room would hold open`);
  assert.equal(MIC_GATE_FLOOR_DB, -70);
});

test("the gate lets go six decibels below where it takes hold", () => {
  for (const position of [0.2, 0.35, 0.6, 0.9]) {
    const open = micGateOpenAt(position);
    const close = micGateCloseAt(position);
    assert.ok(close < open, "the closing level is not below the opening one, so there is no hysteresis at all");
    const db = 20 * Math.log10(close / open);
    assert.ok(Math.abs(db + 6) < 0.1, `the pair is ${db.toFixed(2)} dB apart rather than 6`);
  }
});

/* ── The hysteresis, which is what a bare threshold gets wrong ────────────── */

/** Run a series of readings through the gate, 50ms apart, and count the changes. */
function run(
  levels: readonly number[],
  input: { activation: MicActivation; threshold: number; muted?: boolean; held?: boolean },
): { transitions: number; open: boolean; trace: boolean[] } {
  let state: MicGateState = MIC_GATE_CLOSED;
  let transitions = 0;
  const trace: boolean[] = [];
  levels.forEach((level, index) => {
    const before = state.open;
    state = nextMicGate(state, {
      activation: input.activation,
      muted: input.muted ?? false,
      held: input.held ?? false,
      level,
      threshold: input.threshold,
      now: 1000 + index * 50,
    });
    if (state.open !== before) transitions += 1;
    trace.push(state.open);
  });
  return { transitions, open: state.open, trace };
}

test("a voice hovering at the threshold does not chatter", () => {
  // The defect this whole pair of thresholds and the tail exist for: a level
  // sitting on the line opens and closes the microphone several times a second,
  // and a listener hears the first consonant of every other word. Forty
  // readings, two seconds, alternating a hair either side of the line.
  const threshold = 0.35;
  const line = micGateOpenAt(threshold);
  const levels = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? line * 1.02 : line * 0.98));
  const { transitions, open } = run(levels, { activation: "voice", threshold });
  assert.equal(open, true, "a voice at the threshold ends up shut out");
  assert.equal(transitions, 1, `the gate moved ${transitions} times in two seconds on one steady voice`);
});

test("the gate holds open across the silence inside a sentence, and closes after it", () => {
  const threshold = 0.35;
  const loud = micGateOpenAt(threshold) * 4;
  // Two words with 250ms of silence between them — the gap inside a sentence,
  // which is the measurement `MIC_GATE_HOLD_MS` is set from — then silence.
  const sentence = [loud, loud, 0, 0, 0, 0, 0, loud, loud];
  const { trace } = run(sentence, { activation: "voice", threshold });
  assert.deepEqual(
    trace,
    [true, true, true, true, true, true, true, true, true],
    "the gate closed inside a sentence, cutting the speaker off between two words",
  );

  // And it does close, or the tail would be «always».
  const after = run([...sentence, ...Array.from({ length: 12 }, () => 0)], {
    activation: "voice",
    threshold,
  });
  assert.equal(after.open, false, "silence never closes the gate, so the room is published between sentences");
  assert.equal(MIC_GATE_HOLD_MS, 400);
});

test("a level between the two thresholds holds the state it is in, either way", () => {
  const threshold = 0.5;
  const between = (micGateOpenAt(threshold) + micGateCloseAt(threshold)) / 2;
  // Coming from silence it is not enough to open.
  assert.equal(run([between, between, between], { activation: "voice", threshold }).open, false);
  // Having opened, it is enough to stay open — for longer than the tail, which
  // is what makes this the hysteresis rather than the tail being measured twice.
  const opened = run(
    [micGateOpenAt(threshold) * 2, ...Array.from({ length: 20 }, () => between)],
    { activation: "voice", threshold },
  );
  assert.equal(opened.open, true, "a voice that trails to just under the line is cut off");
});

/* ── What each mode makes of the same readings ────────────────────────────── */

test("«Рация» is the key and nothing else, and «Всегда» is the level and nothing else", () => {
  const quiet = Array.from({ length: 6 }, () => 0);
  const loud = Array.from({ length: 6 }, () => 1);

  assert.equal(run(loud, { activation: "ptt", threshold: 0.35 }).open, false, "a loud room opens a push-to-talk microphone");
  assert.equal(run(quiet, { activation: "ptt", threshold: 0.35, held: true }).open, true, "a held key does not open the microphone");
  assert.equal(run(quiet, { activation: "open", threshold: 0.35 }).open, true);
  assert.equal(run(quiet, { activation: "voice", threshold: 0.35 }).open, false);
  assert.equal(run(loud, { activation: "voice", threshold: 0.35 }).open, true);

  // No tail on push to talk: the promise of the control is that letting go
  // stops it, and a hold-open makes that «mostly».
  const held = nextMicGate(MIC_GATE_CLOSED, {
    activation: "ptt",
    muted: false,
    held: true,
    level: 0,
    threshold: 0.35,
    now: 1000,
  });
  assert.equal(held.open, true);
  const released = nextMicGate(held, {
    activation: "ptt",
    muted: false,
    held: false,
    level: 0,
    threshold: 0.35,
    now: 1001,
  });
  assert.equal(released.open, false, "letting go leaves the microphone open for a while");
});

test("a mute wins over every mode, including a held key", () => {
  for (const activation of ["open", "voice", "ptt"] as const) {
    const state = nextMicGate(
      { open: true, openUntil: 9_999_999 },
      { activation, muted: true, held: true, level: 1, threshold: 0, now: 1000 },
    );
    assert.equal(state.open, false, `a muted microphone is open in «${activation}»`);
    assert.equal(state.openUntil, 0, "a mute leaves a tail behind that will reopen the gate");
  }
});

test("only voice activity needs a meter running", () => {
  assert.equal(micGateNeedsLevel("voice"), true);
  assert.equal(micGateNeedsLevel("open"), false);
  assert.equal(micGateNeedsLevel("ptt"), false);
});

/* ── The key ──────────────────────────────────────────────────────────────── */

const press = (over: Partial<Parameters<typeof micTalkKeyFires>[0]> = {}) => ({
  code: MIC_TALK_KEY_DEFAULT,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  editable: false,
  repeat: false,
  ...over,
});

test("the talk key fires for its own code and for nothing else", () => {
  assert.equal(micTalkKeyFires(press(), "Backquote"), true);
  assert.equal(micTalkKeyFires(press({ code: "KeyB" }), "Backquote"), false);
  assert.equal(micTalkKeyFires(press({ repeat: true }), "Backquote"), false, "an OS key repeat republishes the same state");
  for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
    assert.equal(
      micTalkKeyFires(press({ [modifier]: true }), "Backquote"),
      false,
      `${modifier} held is a chord — Alt+Backquote switches windows on more than one desktop`,
    );
  }
  // Shift is deliberately not in that list: it changes what a key prints, not
  // what it means, and the editable rule below is what covers typing.
  assert.equal(micTalkKeyFires({ ...press(), ctrlKey: false }, "Backquote"), true);
});

test("in a text field only a key that prints nothing talks", () => {
  // The rule that decides whether the default key is usable, and the reason the
  // key is rebindable at all: in a messenger the cursor is in the composer most
  // of the time.
  assert.equal(micTalkKeyFires(press({ editable: true }), "Backquote"), false, "«ё» talks instead of typing");
  assert.equal(micTalkKeyFires(press({ code: "F8", editable: true }), "F8"), true);
  assert.equal(micTalkKeyFires(press({ code: "CapsLock", editable: true }), "CapsLock"), true);
  assert.equal(micTalkKeyFires(press({ code: "KeyT", editable: true }), "KeyT"), false);

  assert.equal(micTalkKeyTypes("Backquote"), true);
  assert.equal(micTalkKeyTypes("KeyQ"), true);
  assert.equal(micTalkKeyTypes("Digit4"), true);
  assert.equal(micTalkKeyTypes("Numpad5"), true);
  assert.equal(micTalkKeyTypes("F8"), false);
  assert.equal(micTalkKeyTypes("CapsLock"), false);
  assert.equal(micTalkKeyTypes("NumpadEnter"), false, "Enter is refused outright rather than called a printing key");
});

test("a release releases, whatever else is true at the moment it arrives", () => {
  // Hold the key, press Ctrl, let go; hold the key, Tab into the composer, let
  // go. Both are releases the guarded version of this test would refuse, and
  // each one leaves a microphone open.
  assert.equal(micTalkKeyReleases("Backquote", "Backquote"), true);
  assert.equal(micTalkKeyReleases("KeyB", "Backquote"), false);
  // And the releases that are not a keyup at all are named, so the wiring can
  // be read against them.
  for (const event of ["blur", "pointerup", "pointercancel", "visibilitychange"]) {
    assert.ok(MIC_TALK_RELEASE_EVENTS.includes(event), `${event} is no longer a release`);
  }
});

test("a key the interface already owns is refused, with a reason", () => {
  for (const code of MIC_TALK_KEY_REFUSED) {
    const refusal = micTalkKeyRefusal(code);
    assert.ok(refusal, `${code} is accepted as a talk key`);
    assert.ok(refusal.trim().length > 10, "the refusal has to say something a person can act on");
  }
  assert.ok(micTalkKeyRefusal("Escape"), "Escape belongs to whatever a person opened (D-194)");
  for (const modifier of ["ShiftLeft", "ControlRight", "AltLeft", "MetaLeft"]) {
    assert.ok(micTalkKeyRefusal(modifier), `${modifier} is accepted, and a chord is not a hold`);
  }
  assert.equal(micTalkKeyRefusal("Backquote"), null);
  assert.equal(micTalkKeyRefusal("F8"), null);
  assert.equal(micTalkKeyRefusal("KeyV"), null, "a printing key is allowed — with the note that says what it costs");
  assert.ok(micTalkKeyRefusal(" "), "a blank code is not a key");
});

test("the key is named the way a person would name it", () => {
  assert.equal(micTalkKeyLabel("KeyG"), "G");
  assert.equal(micTalkKeyLabel("Digit7"), "7");
  assert.equal(micTalkKeyLabel("F8"), "F8");
  assert.equal(micTalkKeyLabel("Backquote"), "Ё / ~", "the one key whose name depends on the layout");
  assert.equal(micTalkKeyLabel("Numpad0"), "Num 0");
  assert.equal(micTalkKeyLabel("ArrowUp"), "Вверх");
  assert.equal(micTalkKeyLabel("Unknown"), "Unknown");

  // And the note changes with the kind of key, because the cost does.
  assert.match(micTalkKeyNote("Backquote"), /печатает/);
  assert.match(micTalkKeyNote("F8"), /ничего не печатает/);
  assert.notEqual(micTalkKeyNote("Backquote"), micTalkKeyNote("F8"));
});

/* ── What the controls say ────────────────────────────────────────────────── */

test("«выключен» and «не нажата» are different things, and are said differently", () => {
  // The distinction the brief names, and the one an interface gets wrong by
  // drawing a push-to-talk microphone that is merely waiting as if it were off.
  const waiting = micControlWords({ activation: "ptt", muted: false, held: false, talkKey: "Backquote" });
  const talking = micControlWords({ activation: "ptt", muted: false, held: true, talkKey: "Backquote" });
  const muted = micControlWords({ activation: "ptt", muted: true, held: false, talkKey: "Backquote" });

  assert.equal(waiting.talkAvailable, true, "a microphone that is simply not held reads as unavailable");
  assert.equal(muted.talkAvailable, false, "a hold is offered over a microphone that is switched off");
  assert.equal(new Set([waiting.talkLabel, talking.talkLabel, muted.talkLabel]).size, 3, "two of the three states say the same thing");
  assert.equal(waiting.muteLabel, "Выключить микрофон");
  assert.equal(muted.muteLabel, "Включить микрофон");
  // The printed word does not move, or the capsule reflows on every press and
  // the room's name re-truncates behind it.
  assert.equal(waiting.talkWord, talking.talkWord);
  assert.equal(waiting.talkWord, muted.talkWord);
  assert.ok(waiting.talkWord.trim().length > 0);
  // The bound key is named where the gesture is explained, so a person who
  // rebound it is not told about a key they no longer use.
  assert.match(waiting.talkTitle, /Ё \/ ~/);
  assert.match(micControlWords({ activation: "ptt", muted: false, held: false, talkKey: "F8" }).talkTitle, /F8/);
});

test("the hold control exists only in the mode that has one", () => {
  for (const activation of ["open", "voice"] as const) {
    const words = micControlWords({ activation, muted: false, held: false, talkKey: "Backquote" });
    assert.equal(words.talk, false, `«${activation}» draws a hold-to-talk control`);
    assert.equal(words.talkAvailable, false);
  }
  assert.equal(micControlWords({ activation: "ptt", muted: false, held: false, talkKey: "Backquote" }).talk, true);
});

test("the mute control names the mode, which is where it is discoverable in a call", () => {
  const titles = (["open", "voice", "ptt"] as const).map(
    (activation) => micControlWords({ activation, muted: false, held: false, talkKey: "Backquote" }).muteTitle,
  );
  assert.equal(new Set(titles).size, 3, "two modes give the microphone control the same title");
  assert.equal(titles[0], "Выключить микрофон", "the mode this product has always had says nothing extra");
  for (const title of titles) assert.ok(title.startsWith("Выключить микрофон"));
});

test("every mode says what it does, once, in its own words", () => {
  const hints = (["open", "voice", "ptt"] as const).map(micActivationHint);
  assert.equal(new Set(hints).size, 3);
  for (const hint of hints) assert.ok(hint.trim().length > 20);
  assert.deepEqual(
    MIC_ACTIVATION_SEGMENTS.map((segment) => segment.mode),
    ["open", "voice", "ptt"],
  );
  assert.equal(new Set(MIC_ACTIVATION_SEGMENTS.map((segment) => segment.label)).size, 3);
  // The threshold's own line changes with whether there is a level to look at,
  // which is the same courtesy `selfMonitorHint` was fixed to show.
  assert.notEqual(micGateThresholdHint(true), micGateThresholdHint(false));
  assert.match(micGateThresholdHint(false), /проверку микрофона/);
});

/* ── The instrument, read as source ───────────────────────────────────────── */

/**
 * `lib/micLevel.ts` cannot be imported here: it reads `import.meta.env` at the
 * point of use and builds an `AudioContext`, neither of which a `node --test`
 * process has. What it holds is not a rule — every rule is above — but it does
 * carry two decisions that would be silently undone by a tidy-up, and a source
 * read is the only instrument that reaches them. Comments are stripped first:
 * guards in this repository have matched their own prose five times in one
 * session.
 */
const strip = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const levelSource = strip(
  readFileSync(fileURLToPath(new URL("../../artifacts/kub/src/lib/micLevel.ts", import.meta.url)), "utf8"),
);

test("the analyser reads a clone, because the gate destroys the level it needs", () => {
  // Measured on 2026-09-18: with the captured track disabled, an `AnalyserNode`
  // on that same track reads 0 while a clone of it reads up to 0.99. A gate
  // that measured the track it closes would close once and never reopen — the
  // level it needs to come back is exactly the one it has just removed.
  assert.match(
    levelSource,
    /clone = track\.clone\(\)/,
    "the level is being read from the published capture, which the gate disables",
  );
  assert.match(
    levelSource,
    /createMediaStreamSource\(new MediaStream\(\[clone\]\)\)/,
    "the analyser is no longer fed from the clone",
  );
  assert.ok(
    !/createMediaStreamSource\(new MediaStream\(\[track\]\)\)/.test(levelSource),
    "the analyser is fed from the track the gate disables",
  );
  // And the clone is stopped with the source, or a capture stays half alive
  // with nothing reading it.
  assert.match(levelSource, /clone\?\.stop\(\)/, "closing the level source leaves its own clone running");
  assert.match(levelSource, /context\?\.close\(\)/, "the AudioContext outlives the call, which is a battery defect");
});

test("the level is polled on a timer, not on a frame", () => {
  // `requestAnimationFrame` does not run for a hidden document — that is what
  // it is specified to do — so a gate driven by it freezes in whatever state it
  // was in the moment somebody switched windows. A timer is throttled in a
  // hidden page and keeps arriving.
  assert.match(levelSource, /setInterval\(/, "the level is no longer polled on a clock");
  assert.ok(
    !/requestAnimationFrame/.test(levelSource),
    "the level is polled on a frame, which stops entirely while the window is not on screen",
  );
  assert.match(levelSource, /clearInterval\(timer\)/, "the poll is never stopped");
});
