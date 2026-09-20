import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIC_ACTIVATION_DEFAULT,
  MIC_ACTIVATION_SEGMENTS,
  MIC_AUTO_THRESHOLD_CAPTURE_NOTE,
  MIC_AUTO_THRESHOLD_LABEL,
  MIC_AUTO_THRESHOLD_MARGIN_DB,
  MIC_AUTO_THRESHOLD_MAX,
  MIC_AUTO_THRESHOLD_MIN_SAMPLES,
  MIC_GATE_CLOSED,
  MIC_GATE_FLOOR_DB,
  MIC_GATE_HOLD_MS,
  MIC_GATE_THRESHOLD_DEFAULT,
  MIC_METER_STEP_PERCENT,
  MIC_TALK_KEY_DEFAULT,
  MIC_TALK_KEY_REFUSED,
  MIC_TALK_RELEASE_EVENTS,
  autoMicThreshold,
  clampMicGateThreshold,
  micActivationHint,
  micAutoThresholdNote,
  micAutoThresholdRefusal,
  micAutoThresholdSettled,
  micControlWords,
  micGateCloseAt,
  micGateNeedsLevel,
  micGateOpenAt,
  micGateThresholdHint,
  micLevelPosition,
  micMeterPercent,
  micTalkKeyFires,
  micTalkKeyLabel,
  micTalkKeyNote,
  micTalkKeyRefusal,
  micTalkKeyReleases,
  micTalkKeyTypes,
  nextMicGate,
  readMicActivation,
  type MicActivation,
  type MicAutoThresholdState,
  type MicGateState,
} from "../../artifacts/kub/src/lib/micGate.ts";
import { normalizeAudioSettings } from "../../artifacts/kub/src/hooks/useAudioSettings.ts";
import { AUDIO_GROUP_LEVEL, micTestLabel } from "../../artifacts/kub/src/lib/audioSettingsSurface.ts";
import { MIC_NO_INPUT_FLOOR, MIC_NO_INPUT_FLOOR_DB } from "../../artifacts/kub/src/lib/micNoInput.ts";

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

/* ── The meter, and reduced motion ────────────────────────────────────────── */

test("both bars on the screen are one measurement on one axis", () => {
  // The defect D-261 names first, as arithmetic. Until 2026-09-20 the meter in
  // «Уровень» was `round(level * 100)` and the bar under the threshold
  // `round(micLevelPosition(level) * 100)`: one screen, one microphone, two
  // pictures. A quiet room at a peak of 0.05 filled 5% of the first bar and
  // 63% of the second, so a person who read the top one and set the bottom one
  // was comparing two different quantities and could not know it.
  const linear = (level: number) => Math.round(level * 100);
  assert.equal(linear(0.05), 5);
  assert.equal(micMeterPercent(0.05, false), 63);
  // And the one that is drawn now is the one the threshold lives on: the bar's
  // width and the handle's position are the same number when the level is
  // exactly at the threshold.
  for (const position of [0.1, 0.35, 0.6, 0.9]) {
    assert.equal(
      micMeterPercent(micGateOpenAt(position), false),
      Math.round(position * 100),
      `the bar and the handle disagree at ${position}`,
    );
  }
});

test("reduced motion coarsens the bar rather than stopping it", () => {
  // The decision, stated as a test: the bar still answers, because a threshold
  // control without a level is the guesswork it exists to end. What goes is the
  // streaming — twenty steps instead of a hundred and one, and the caller drops
  // the CSS transition on top of that.
  const steps = new Set<number>();
  for (let i = 0; i <= 200; i += 1) steps.add(micMeterPercent(i / 200, true));
  assert.ok(steps.size <= 21, `reduced motion still draws ${steps.size} distinct widths`);
  assert.ok(steps.size >= 10, "reduced motion has flattened the bar into something unreadable");
  for (const width of steps) {
    assert.equal(width % MIC_METER_STEP_PERCENT, 0, `${width}% is not on the step`);
  }
  // It still moves, and it still reaches both ends.
  assert.equal(micMeterPercent(0, true), 0);
  assert.equal(micMeterPercent(1, true), 100);
  assert.notEqual(micMeterPercent(0.02, true), micMeterPercent(0.5, true));
  // And nothing about it is a guess when the analyser answers rubbish.
  for (const reduced of [false, true]) {
    assert.equal(micMeterPercent(Number.NaN, reduced), 0);
    assert.equal(micMeterPercent(-1, reduced), 0);
    assert.equal(micMeterPercent(4, reduced), 100);
  }
});

/* ── Placing the threshold from the room ──────────────────────────────────── */

test("a measured threshold clears the room it measured, hysteresis included", () => {
  // A steady room at −52 dBFS, two seconds of it at 50 ms a reading.
  const room = 10 ** (-52 / 20);
  const answer = autoMicThreshold(Array.from({ length: 40 }, () => room));
  assert.notEqual(answer, null);
  const openAt = micGateOpenAt(answer as number);
  const closeAt = micGateCloseAt(answer as number);
  // The whole reason the margin is 10 dB and not 3: the gate lets go 6 dB below
  // where it opens, so a threshold that cleared the room only at its opening
  // level would have its *closing* level buried in that room and would never
  // close again once anybody spoke.
  assert.ok(openAt > room, "the measured threshold does not even clear the room it measured");
  assert.ok(closeAt > room, "the gate's closing level sits inside the room's own noise");
  const marginDb = 20 * Math.log10(openAt / room);
  assert.ok(
    Math.abs(marginDb - MIC_AUTO_THRESHOLD_MARGIN_DB) < 1,
    `the measured threshold sits ${marginDb.toFixed(1)} dB above the room, not ${MIC_AUTO_THRESHOLD_MARGIN_DB}`,
  );
});

test("somebody who talks through the measurement still gets their room, not their voice", () => {
  // Half the run is speech at −25 dBFS, which is where a laptop capture puts a
  // conversational voice, and half is the room at −55.
  const room = 10 ** (-55 / 20);
  const speech = 10 ** (-25 / 20);
  const mixed = autoMicThreshold(Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? room : speech)));
  const quiet = autoMicThreshold(Array.from({ length: 60 }, () => room));
  assert.notEqual(mixed, null);
  // Stated as «the speech changed nothing», not as a bracket. A bracket was
  // what this assertion was first: −55 < threshold < −25, which the mean
  // satisfies — the mean of these two positions is −30 dBFS, comfortably
  // inside it — so a mutation replacing the quarter-point with the mean stayed
  // **green**. The claim is that talking during the measurement does not move
  // the answer, and this is that claim.
  assert.equal(mixed, quiet, `talking during the measurement moved the threshold from ${quiet} to ${mixed}`);
  const db = 20 * Math.log10(micGateOpenAt(mixed as number));
  assert.ok(db > -55, `the threshold at ${db.toFixed(1)} dBFS is under the room`);
  assert.ok(db < -25, `the threshold at ${db.toFixed(1)} dBFS is above the speech it must let through`);
  // The honest limit of this, written down rather than discovered later: the
  // quarter-point is the room only while at least a quarter of the run is
  // room. Somebody who talks without pause for the whole two seconds measures
  // their own voice, and the note under the control tells them to be quiet for
  // exactly that reason.
});

test("a run that measured nothing says so instead of inventing a threshold", () => {
  // `null` and not `MIC_GATE_THRESHOLD_DEFAULT`: a function answering the
  // default when it had nothing is indistinguishable from one that measured a
  // room and found it exactly average, and the surface would have no way to say
  // «не удалось измерить».
  assert.equal(autoMicThreshold([]), null);
  assert.equal(autoMicThreshold(Array.from({ length: MIC_AUTO_THRESHOLD_MIN_SAMPLES - 1 }, () => 0.01)), null);
  assert.equal(autoMicThreshold(Array.from({ length: 30 }, () => Number.NaN)), null);
  assert.notEqual(autoMicThreshold(Array.from({ length: MIC_AUTO_THRESHOLD_MIN_SAMPLES }, () => 0.01)), null);
});

test("a measured threshold is one the slider can hold, and never «never closes»", () => {
  // Silence measures as position 0, and 0 is the one value that means the gate
  // never closes. What keeps the answer off that floor is the **margin**, not a
  // clamp: a `MIC_AUTO_THRESHOLD_MIN` of 0.05 stood here until a mutation
  // showed it could never fire, because the margin already lifts position 0 to
  // 0.143. The clamp went and this assertion stayed, which is the right way
  // round — it pins the property rather than the mechanism, and it goes red if
  // the margin is ever taken away.
  // The run used to be silence. Since D-280 silence is **refused**, so the
  // quietest thing that is still a measurement is a room one decibel above the
  // floor of the axis — and it is the margin, not the refusal, that this
  // assertion is about.
  const quietest = autoMicThreshold(
    Array.from({ length: 40 }, () => 10 ** ((MIC_GATE_FLOOR_DB + 1) / 20)),
  ) as number;
  assert.ok(quietest > 0, `the quietest measurable room measured ${quietest}`);
  assert.notEqual(micGateOpenAt(quietest), 0, "a measured threshold turned the gate off");
  // A room so loud there is no headroom left is clamped rather than made
  // unusable.
  const loud = autoMicThreshold(Array.from({ length: 40 }, () => 0.9)) as number;
  assert.ok(loud <= MIC_AUTO_THRESHOLD_MAX, `a loud room measured ${loud}`);
  // And every answer lands on a step the slider can represent, or the handle
  // would sit somewhere a hand can never put it back.
  for (const level of [0.001, 0.01, 0.05, 0.2, 0.5, 0.9, 1]) {
    const answer = autoMicThreshold(Array.from({ length: 40 }, () => level)) as number;
    // `answer * 100` is compared the other way round on purpose: 0.14 * 100 is
    // 14.000000000000002 in binary floating point, so the multiplication is the
    // wrong side to test on. What the slider needs is that the value is the
    // nearest double to some hundredth, which is what this says.
    assert.equal(answer, Math.round(answer * 100) / 100, `${answer} is not a hundredth`);
  }
});

test("the measurement says something different in each of its five states", () => {
  const states: MicAutoThresholdState[] = ["idle", "listening", "done", "failed", "silent"];
  const notes = states.map(micAutoThresholdNote);
  assert.equal(new Set(notes).size, 5, "two states of the measurement say the same thing");
  for (const note of notes) assert.ok(note.trim().length > 20);
  // The one that must not be mistaken for success.
  assert.match(micAutoThresholdNote("failed"), /Не удалось/);
  assert.match(micAutoThresholdNote("done"), new RegExp(String(MIC_AUTO_THRESHOLD_MARGIN_DB)));
});

test("nothing on this surface claims processing the product does not perform", () => {
  // Krisp is a commercial product and LiveKit's integration of it is a paid
  // add-on; neither is installed. The words this module hands the screen may
  // not imply either, and they may not name a «движок» the product does not
  // ship.
  const words = [
    ...(["idle", "listening", "done", "failed", "silent"] as MicAutoThresholdState[]).map(micAutoThresholdNote),
    MIC_AUTO_THRESHOLD_CAPTURE_NOTE,
    ...(["open", "voice", "ptt"] as MicActivation[]).map(micActivationHint),
    micGateThresholdHint(true),
    micGateThresholdHint(false),
    MIC_AUTO_THRESHOLD_LABEL,
  ].join(" ");
  assert.doesNotMatch(words, /krisp/i);
  assert.doesNotMatch(words, /шумоподавлени[ея] LETSCUBE|нейросет|ИИ-|AI-/i);
});

/* ── D-280: a run that contained nothing is not a measurement ─────────────── */

/**
 * A steady run of a known level, in the shape and the length the control
 * collects: `MIC_AUTO_THRESHOLD_MS` at `MIC_LEVEL_PERIOD_MS`, which is forty.
 */
const runAt = (dbfs: number, count = 40) => Array.from({ length: count }, () => 10 ** (dbfs / 20));

test("a capture that produced nothing is refused instead of being given a threshold", () => {
  // The defect, in one line. The owner pressed «Подобрать порог» with his
  // microphone's analogue dimmer at zero; the shipped function had no way to
  // say «the readings arrived and were nothing» — only «there were too few of
  // them» — and forty readings is twice what that guard asks for.
  const silence = Array.from({ length: 40 }, () => 0);
  assert.equal(micAutoThresholdRefusal(silence), "silent");
  assert.equal(autoMicThreshold(silence), null);

  // And what it answered before, which is the precise sense in which it was
  // not a measurement: with every position clamped to 0 the quarter-point is 0
  // and the answer is the margin alone — the same number for digital silence,
  // for a muted headset and for an ended track. An output that cannot depend
  // on its input is the formal shape of «that was not a measurement».
  const marginOnly = Math.round((MIC_AUTO_THRESHOLD_MARGIN_DB / -MIC_GATE_FLOOR_DB) * 100) / 100;
  assert.equal(marginOnly, 0.14);
});

test("every capture that produced nothing is refused, and no room is", () => {
  // Measured on 2026-09-20 through the real constraint pipeline — Chromium's
  // file-backed fake device, the product's default ec/ns/agc, read exactly as
  // `lib/micLevel.ts` reads. The tables are in `micGate.ts` beside
  // `micAutoThresholdRefusal`; the scripts are `output/d280-measure-*.mjs`,
  // which are gitignored, which is why the numbers are written down.
  const floor = 10 ** (MIC_GATE_FLOOR_DB / 20);
  const nothing: [string, number[]][] = [
    ["digital silence", Array.from({ length: 40 }, () => 0)],
    // Measured: a clone disabled before the run reads exact 0 forty times out
    // of forty. Disabling is what a mute is, and what the gate itself does.
    ["a track disabled before the run", Array.from({ length: 40 }, () => 0)],
    // Measured: readyState `ended`, forty exact zeros.
    ["a track that has ended", Array.from({ length: 40 }, () => 0)],
    // Measured: 0 of 40 readings off the floor, p25 −93.1 dBFS. A real signal,
    // 15 dB below the bottom of the axis, which the control cannot see at all.
    ["a capsule dimmed to −85 dBFS", runAt(-85)],
    ["a run sitting exactly on the floor of the axis", Array.from({ length: 40 }, () => floor)],
  ];
  for (const [what, levels] of nothing) {
    assert.equal(micAutoThresholdRefusal(levels), "silent", `${what} was taken for a measurement`);
    assert.equal(autoMicThreshold(levels), null, `${what} was given a threshold`);
  }

  const rooms: [string, number[]][] = [
    // The quiet-room fixture at peak −70 dBFS put 2 of 40 readings off the
    // floor. This is the population the rule may not touch: the brief's own
    // warning is that a quiet room with a good microphone reads −60 to −70,
    // and refusing there would refuse the people who most want the feature.
    ["a very quiet room at −69 dBFS", runAt(-69)],
    ["the owner's dimmed capsule at −64 dBFS", runAt(-64)],
    ["a quiet room at −60 dBFS", runAt(-60)],
    ["an ordinary room at −50 dBFS", runAt(-50)],
    ["a voice at −25 dBFS", runAt(-25)],
  ];
  for (const [what, levels] of rooms) {
    assert.equal(micAutoThresholdRefusal(levels), null, `${what} was refused`);
    assert.notEqual(autoMicThreshold(levels), null, `${what} was refused`);
  }
});

test("the owner's own capture measures 23%, and the rule leaves it alone", () => {
  // His dimmer at zero, on the float instrument, on the deployed build:
  // «теперь реально определяет только шум в реальном времени - хорошо».
  // Working backwards from 0.23: minus the 10/70 margin is 0.0871 of position,
  // which is −63.9 dBFS — a real noise floor, honestly resolved, where the byte
  // instrument crushed everything under −42 into one 40% reading.
  //
  // It is here as a test and not as a comment because it is the case a
  // carelessly chosen rule would have broken: −64 dBFS is squarely inside the
  // range a genuinely quiet room occupies, so no absolute floor can separate
  // «dimmer at zero» from «quiet room», and 23% is the right answer for both.
  assert.equal(autoMicThreshold(runAt(-64)), 0.23);
  assert.equal(micAutoThresholdRefusal(runAt(-64)), null);
});

test("one reading off the floor is a measurement; none is not", () => {
  // The rule is deliberately the **weakest** one that refuses a dead capture.
  // The larger and more tempting rule — refuse when the *quarter-point* is at
  // the floor, which catches every run whose answer is that same 0.14 constant
  // — refuses the measured quiet rooms at peak −65 and −60, whose quarter
  // points sit at −83 and −78 dBFS. Whether that is the fixture's modulation
  // or a real room's cannot be settled on a workstation with no microphone,
  // and a rule whose correctness turns on an unmeasurable property of real
  // rooms is not one to ship.
  const floor = 10 ** (MIC_GATE_FLOOR_DB / 20);
  const dead = Array.from({ length: 40 }, () => floor);
  assert.equal(micAutoThresholdRefusal(dead), "silent");

  const barely = [...dead];
  barely[17] = 10 ** ((MIC_GATE_FLOOR_DB + 1) / 20);
  assert.equal(micAutoThresholdRefusal(barely), null, "a run that produced a signal was refused");
  assert.notEqual(autoMicThreshold(barely), null);

  // Stated against the axis rather than against a number, because that is what
  // the rule is: the refusal reuses `micLevelPosition`, which already carries
  // `MIC_GATE_FLOOR_DB`, and introduces no constant of its own. It is also
  // exactly the condition a person watches — the bar at 0% for two seconds.
  for (const level of dead) assert.equal(micLevelPosition(level), 0);
  assert.ok(micLevelPosition(barely[17]) > 0);
});

test("the no-input floor is not borrowed for this, because it answers another question", () => {
  // `MIC_NO_INPUT_FLOOR_DB` is −42 and asks «did this microphone produce a
  // *sound*», judged against speech near −25 dBFS. This asks «what is this
  // room's *noise floor*», and a quiet room with a good microphone lives at
  // −60 to −70. Refusing at −42 would refuse to calibrate for exactly the
  // people who most want voice activation — including the owner at −64.
  assert.equal(MIC_NO_INPUT_FLOOR_DB, -42);
  for (const dbfs of [-64, -60, -55, -50]) {
    assert.equal(
      micAutoThresholdRefusal(runAt(dbfs)),
      null,
      `a room at ${dbfs} dBFS, under the no-input floor, was refused a threshold`,
    );
  }
  // The two do share the axis, which is the part worth sharing.
  assert.ok(micLevelPosition(MIC_NO_INPUT_FLOOR) > 0);
});

test("the two refusals are told apart, and the threshold agrees with both", () => {
  const short = Array.from({ length: MIC_AUTO_THRESHOLD_MIN_SAMPLES - 1 }, () => 0.01);
  assert.equal(micAutoThresholdRefusal(short), "few");
  assert.equal(micAutoThresholdRefusal([]), "few");
  // Not-a-number readings are not readings: they are filtered before the count,
  // so a run of them is «too few» and never «silent».
  assert.equal(micAutoThresholdRefusal(Array.from({ length: 40 }, () => Number.NaN)), "few");
  assert.equal(micAutoThresholdRefusal(Array.from({ length: 40 }, () => 0)), "silent");
  assert.equal(micAutoThresholdRefusal(runAt(-50)), null);

  // One decision, not two that could drift apart. A surface saying «нет звука»
  // over a threshold that had just been written would be worse than either
  // message on its own, which is why `autoMicThreshold` delegates rather than
  // repeating the test.
  const runs = [short, [], Array.from({ length: 40 }, () => 0), runAt(-85), runAt(-64), runAt(-50), runAt(-25)];
  for (const levels of runs) {
    assert.equal(
      autoMicThreshold(levels) === null,
      micAutoThresholdRefusal(levels) !== null,
      "the threshold and the reason disagree about the same run",
    );
  }
});

test("«ничего не пришло» and «пришла тишина» stopped being one sentence", () => {
  const silent = micAutoThresholdNote("silent");
  const failed = micAutoThresholdNote("failed");
  assert.notEqual(silent, failed);
  // The shipped copy was «Не удалось измерить: микрофон не дал уровень» for
  // both, and it is true of one. `failed` is «the level never arrived», which
  // says nothing about the microphone; `silent` is a statement about the
  // microphone and names the three things to check.
  assert.doesNotMatch(silent, /Не удалось/);
  assert.match(failed, /Не удалось/);
  for (const check of [/гарнитур/i, /систем/i, /микрофон/i]) assert.match(silent, check);
  // Neither may be mistaken for success: both say the old threshold stands.
  for (const note of [silent, failed]) assert.match(note, /орог остался прежним/);
});

/* ── D-281: the capture it opens, said out loud ───────────────────────────── */

test("the control says it is about to turn the microphone on", () => {
  // The owner, twice: «но также активирует сверху функцию проверки». Pressing
  // «Подобрать порог» starts the «Уровень» capture, which is right — the
  // threshold must be settable without knowing that a button two groups up is
  // a prerequisite — but it said so nowhere, before or after.
  assert.match(
    micAutoThresholdNote("idle"),
    /икрофон/,
    "the control still opens a capture without announcing it",
  );
  // And the hint above the button, which has always said it, still does.
  assert.match(micGateThresholdHint(false), /микрофон включится/);
});

test("and says it left it on, naming a control that exists", () => {
  // The capture stays open on purpose: `micAutoThresholdNote("done")` asks the
  // person to speak into it, and a threshold nobody has watched work is a
  // threshold nobody has set. What was wrong was the silence, not the capture.
  assert.match(MIC_AUTO_THRESHOLD_CAPTURE_NOTE, /икрофон/);
  // The words are written out in `micGate.ts`, which imports nothing, so this
  // is the only thing standing between them and a rename. Both come from
  // `lib/audioSettingsSurface.ts`, the module that actually labels the button.
  assert.ok(
    MIC_AUTO_THRESHOLD_CAPTURE_NOTE.includes(micTestLabel(true)),
    `the note does not name «${micTestLabel(true)}», which is what the button says`,
  );
  assert.ok(
    MIC_AUTO_THRESHOLD_CAPTURE_NOTE.includes(AUDIO_GROUP_LEVEL),
    `the note does not name the «${AUDIO_GROUP_LEVEL}» group the button is in`,
  );
});

test("every state that leaves the capture open is a state that says so", () => {
  const states: MicAutoThresholdState[] = ["idle", "listening", "done", "failed", "silent"];
  // `idle` has not opened anything yet and `listening` says «Помолчите…»,
  // which is nobody's idea of a microphone being off.
  assert.deepEqual(states.filter(micAutoThresholdSettled), ["done", "failed", "silent"]);
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
  // And the resting line names the control that will produce one. It used to
  // say «запустите проверку микрофона **выше**» — a direction to a button in
  // another group, which is the arrangement D-261 was filed about. The
  // measurement is in this group now, so the line names it by the words on it;
  // if the button is ever renamed, this goes red rather than the sentence
  // quietly pointing at nothing.
  assert.match(micGateThresholdHint(false), new RegExp(MIC_AUTO_THRESHOLD_LABEL));
});

/* ── The instrument the axis is read through, and what it decided ─────────── */

/**
 * Two instruments, as arithmetic, and the gate under each.
 *
 * `lib/micLevel.ts` is a browser file and cannot be imported here; what *can*
 * be held here is the consequence of which reading it takes, because that is
 * pure. Both models below reproduce the measured table exactly
 * (`output/d272-measure-floor.mjs`, Chromium, 2026-09-20) and the source read
 * at the foot of this file says which one is installed.
 */

/**
 * `getByteTimeDomainData`: `b = ⌊128(1 + x)⌋`, peak distance from 128, over
 * 128. The negative half of any signal lands a step below the midpoint, so the
 * peak distance for a bipolar amplitude `a` is `⌈128a⌉` — which gives 1 for
 * everything from −90.3 dBFS up to −42.14, 2 at −42, 3 at −36, 9 at −24 and
 * 17 at −18, each matching what was measured.
 */
const bytePath = (amplitude: number) => Math.ceil(128 * amplitude) / 128;

/** `getFloatTimeDomainData`: the sample, which is the signal. */
const floatPath = (amplitude: number) => amplitude;

/** dBFS to a peak amplitude, so the cases below read as levels and not as digits. */
const dbfs = (db: number) => 10 ** (db / 20);

/**
 * Walk the gate over a steady level, from a microphone that has just been
 * spoken into.
 *
 * Seeded **open** on purpose: a gate that has never opened is trivially shut,
 * and the question is whether a microphone that has been used goes quiet
 * again. The walk outlasts `MIC_GATE_HOLD_MS` so «still open» means the rule
 * and not the tail.
 */
function settle(level: number, threshold: number): boolean {
  let state: MicGateState = nextMicGate(MIC_GATE_CLOSED, {
    activation: "voice",
    muted: false,
    held: false,
    level: 0.3,
    threshold,
    now: 0,
  });
  for (let now = 50; now <= MIC_GATE_HOLD_MS * 4; now += 50) {
    state = nextMicGate(state, { activation: "voice", muted: false, held: false, level, threshold, now });
  }
  return state.open;
}

/** The same, from a microphone nobody has spoken into: does silence open it? */
function opensFromSilence(level: number, threshold: number): boolean {
  return nextMicGate(MIC_GATE_CLOSED, {
    activation: "voice",
    muted: false,
    held: false,
    level,
    threshold,
    now: 0,
  }).open;
}

/**
 * **D-278, as the arithmetic the owner was looking at.**
 *
 * His dimmer is at zero, his slider at 0.38, the microphone test running. On
 * the byte instrument his capture reads 1/128 whatever it is really producing,
 * `micGateOpenAt(0.38)` is 0.00676, and 0.0078125 ≥ 0.00676 — so the gate is
 * **open**, `MicMeter` paints `--kub-cyan`, and the bar is 40% wide against a
 * handle at 38%. The product was not merely failing to close a gate: it was
 * telling a silent person, in colour and in width, that they were through it.
 *
 * Two boundaries, both exact, and the second is the wider one:
 *
 *  - silence **opens** a closed gate wherever `1/128 ≥ micGateOpenAt(p)`, i.e.
 *    **p ≤ 0.39794** — the bottom 39.8% of the slider, every position in it
 *    meaning the same thing;
 *  - silence **holds an opened gate open** wherever `1/128 ≥ micGateCloseAt(p)`,
 *    and the hysteresis is 6 dB, so that runs to **p ≤ 0.48395**. For anybody
 *    who has ever spoken, nearly half the control was inert.
 *
 * And dragging across either boundary changed the bar's colour without moving
 * its edge by a pixel, because `micMeterPercent` reads the level and the level
 * could not move.
 */
test("on the byte instrument nearly half the threshold slider was one position", () => {
  const silent = bytePath(dbfs(-85));
  assert.equal(silent, 1 / 128, "the model no longer reproduces the measured byte floor");

  // Silence opening a gate nobody has spoken into. 0.38 is the owner's own
  // setting; 0.39 and 0.40 are the two sides of the first boundary.
  assert.equal(opensFromSilence(silent, 0.38), true, "this is the defect: silence opened the gate");
  assert.equal(opensFromSilence(silent, 0.39), true);
  assert.equal(opensFromSilence(silent, 0.4), false);

  // And the wider one: once a voice has opened it, the hysteresis holds it
  // open on silence up to 0.484.
  assert.equal(settle(silent, 0.4), true);
  assert.equal(settle(silent, 0.48), true);
  assert.equal(settle(silent, 0.49), false);

  // The meter said nothing about any of it: one width, two colours.
  assert.equal(micMeterPercent(silent, false), 40);
});

/**
 * And the same capture through the instrument that is installed now.
 *
 * −85 dBFS rather than 0: a dead microphone reading exact silence was never
 * the hard case. `micGateCloseAt` tends to `10 ** (-3.5) / 2` — −76 dBFS — as
 * the position tends to 0, so a capture below that is shut out at **every**
 * position a person can select. Position 0 is the documented exception and
 * means «stop deciding for me».
 *
 * Mutation: `getFloatTimeDomainData` back to `getByteTimeDomainData` in
 * `lib/micLevel.ts`. The source read below goes red, and so does
 * `tests/e2e/mic-level-instrument.spec.ts`, which drives a real `AnalyserNode`
 * rather than either model.
 */
test("on the float instrument a silent capture closes the gate at every position", () => {
  const silent = floatPath(dbfs(-85));
  for (let step = 1; step <= 100; step += 1) {
    const position = step / 100;
    assert.equal(settle(silent, position), false, `the gate stayed open at ${position}`);
    assert.equal(opensFromSilence(silent, position), false, `silence opened the gate at ${position}`);
  }
  assert.equal(micMeterPercent(silent, false), 0, "«должен показывать 0 если реально звуков сейчас нет»");

  // The axis is reachable rather than merely non-zero: three captures inside
  // the old 48 dB bucket have to land on three different bars.
  assert.deepEqual([-85, -60, -50].map((db) => micMeterPercent(floatPath(dbfs(db)), false)), [0, 14, 29]);
  assert.deepEqual(
    [-85, -60, -50].map((db) => micMeterPercent(bytePath(dbfs(db)), false)),
    [40, 40, 40],
    "the byte model no longer reproduces the bucket this test exists to record",
  );

  // A voice still opens it, or the assertions above are satisfied by an
  // instrument that reports nothing at all.
  assert.equal(opensFromSilence(floatPath(dbfs(-24)), MIC_GATE_THRESHOLD_DEFAULT), true);
  assert.equal(settle(floatPath(dbfs(-24)), MIC_GATE_THRESHOLD_DEFAULT), true);
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

test("the level is read through the float path, which is the whole of D-278", () => {
  // `getByteTimeDomainData` is specified as `⌊128(1 + x)⌋`, so any negative
  // sample lands a step below the midpoint and every bipolar signal from
  // −90.3 dBFS up to −42.1 reported the same single byte. The two tests above
  // are what that cost; this is the line that decides which of them describes
  // the product.
  assert.match(levelSource, /getFloatTimeDomainData\(samples\)/, "the level is back on the byte path");
  assert.match(levelSource, /new Float32Array\(analyser\.fftSize\)/);
  assert.ok(
    !/getByteTimeDomainData/.test(levelSource),
    "the byte path is being read again, and with it the 48 dB bucket under −42 dBFS",
  );
  // The peak is the sample's magnitude, not a distance from a midpoint the
  // float path does not have. `Math.abs(sample - 128)` on floats would report
  // about 128 for every reading, which `micLevelPosition` clamps to a full bar.
  assert.ok(!/sample - 128/.test(levelSource), "a byte midpoint is being subtracted from a float sample");
  assert.ok(!/peak \/ 128/.test(levelSource), "the float peak is still being divided by the byte scale");
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
