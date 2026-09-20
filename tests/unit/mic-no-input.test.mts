import assert from "node:assert/strict";
import test from "node:test";

import {
  MIC_NO_INPUT_AFTER_MS,
  MIC_NO_INPUT_CLEAR,
  MIC_NO_INPUT_FLOOR,
  MIC_NO_INPUT_HEARD_READINGS,
  MIC_NO_INPUT_HINT,
  MIC_NO_INPUT_WARNING,
  MIC_NO_INPUT_WARNING_DETAIL,
  micNoInputNeedsLevel,
  nextMicNoInput,
  readMicNoInputEnabled,
  type MicNoInputState,
} from "../../artifacts/kub/src/lib/micNoInput.ts";

/**
 * When a microphone is producing nothing, measured without a browser, a call or
 * a React tree.
 *
 * The rule is `lib/micNoInput.ts` and the reasoning is in its header. What is
 * held here is every branch of it, and every assertion below was watched go
 * **red** under the mutation named beside it before it was written down — the
 * lesson from 2026-09-20, when seven tests in one day turned out to be green
 * under the very mutation they existed to catch.
 *
 * What these tests do **not** reach, stated plainly rather than implied: no
 * real microphone is involved. The level they feed in is the number
 * `lib/micLevel.ts` produces from an `AnalyserNode`, and that whole path —
 * hardware, driver, `getUserMedia`, the analyser — is absent here. That a dead
 * microphone really reads exactly 0 and a live quiet room really does not is a
 * claim about the browser, and it is the one claim in this feature that only a
 * person with a headset can confirm.
 */

/** A capture that can be judged: the call is up, publishing, not muted. */
const LIVE = { enabled: true, judgeable: true };

/** Walk a number of readings at one level, 50ms apart as the sampler is. */
function walk(state: MicNoInputState, from: number, ms: number, level: number): MicNoInputState {
  let held = state;
  for (let at = from; at <= from + ms; at += 50) {
    held = nextMicNoInput(held, { ...LIVE, level, now: at });
  }
  return held;
}

/** Exact digital silence, which is what a disabled track reads. */
function silence(state: MicNoInputState, from: number, ms: number): MicNoInputState {
  return walk(state, from, ms, 0);
}

/**
 * A syllable: `MIC_NO_INPUT_HEARD_READINGS` readings comfortably over the
 * floor, which is 150 ms at the sampler's 50 ms period.
 */
function speech(state: MicNoInputState, from: number, level = 0.3125): MicNoInputState {
  let held = state;
  for (let i = 0; i < MIC_NO_INPUT_HEARD_READINGS; i += 1) {
    held = nextMicNoInput(held, { ...LIVE, level, now: from + i * 50 });
  }
  return held;
}

test("ten seconds of exact silence raises the warning, and not a moment before", () => {
  const start = 1_000_000;
  // One reading short of the deadline. The run has begun — `silentSince` is
  // held — and nothing is being claimed yet.
  //
  // Mutation: `MIC_NO_INPUT_AFTER_MS` 10_000 -> 0. Under it this line is
  // already `true` and the warning fires at the first reading, which is a
  // warning at somebody who has not finished joining.
  const early = silence(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_AFTER_MS - 100);
  assert.equal(early.warned, false);
  assert.equal(early.silentSince, start);

  // Exactly on the deadline, which is the reading that has waited the full
  // time.
  //
  // Mutation: `now - since >= MIC_NO_INPUT_AFTER_MS` -> `>`. Under it this
  // exact reading is still silent about the failure and the warning arrives one
  // 50ms tick late — small, and the kind of off-by-one that makes a test that
  // only probes the middle of a range useless.
  const due = nextMicNoInput(early, { ...LIVE, level: 0, now: start + MIC_NO_INPUT_AFTER_MS });
  assert.equal(due.warned, true);
  assert.equal(due.heard, false);
});

test("the run is measured from where it started, not from the last reading", () => {
  const start = 2_000_000;
  // The whole of the arithmetic in one assertion: a hundred readings of silence
  // have to *accumulate*.
  //
  // Mutation: `const since = state.silentSince ?? input.now` -> `const since =
  // input.now`. Under it every reading restarts the clock, `now - since` is
  // always 0, and the warning can never be raised however long a microphone
  // stays dead. This is the mutation that matters most in the file and it is
  // the one a test written against a single call would not see.
  const held = silence(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_AFTER_MS);
  assert.equal(held.warned, true);
  assert.equal(held.silentSince, start);
});

test("one sound answers the question for the life of the capture", () => {
  const start = 3_000_000;
  const warned = silence(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_AFTER_MS);
  assert.equal(warned.warned, true);

  // The headset's own mute button, opened. A level arrives, and the sentence on
  // screen has to go with it rather than wait for a timer.
  //
  // Mutation: `level > 0` -> `level >= 0`. Under it silence counts as sound,
  // `heard` is set on the first reading of every call, and the warning can
  // never appear at all — green in a suite that only checks the happy path.
  const heard = speech(warned, start + 20_000);
  assert.equal(heard.heard, true);
  assert.equal(heard.warned, false);
  assert.equal(heard.silentSince, null);

  // And it is terminal. Ten more seconds of silence after a microphone has
  // proved itself is a person not talking, which is not a defect.
  //
  // Mutation: `if (state.heard) return state;` removed. Under it anybody who
  // stops talking for ten seconds is told their microphone is broken, which is
  // the warning that gets itself turned off.
  const later = silence(heard, start + 20_000, MIC_NO_INPUT_AFTER_MS * 2);
  assert.equal(later.warned, false);
  assert.equal(later.heard, true);
});

/**
 * **The case this whole episode exists to produce.**
 *
 * The owner's microphone has an analogue volume dimmer. Turned fully to zero,
 * Discord tells him it is getting no audio; this product said nothing. The
 * reason is in the module header: a dimmer attenuates, it does not disconnect,
 * so the capture still produces a tiny non-zero reading — and the shipped rule
 * was `level > 0`, which that reading satisfies.
 *
 * 1/128 is not «very quiet». It is the **only** value the instrument can report
 * for anything between −90.3 dBFS and about −42.5 dBFS, because
 * `getByteTimeDomainData` rounds up and one byte is the smallest step there is.
 * A signal one 16-bit converter step above absolute silence reports it.
 *
 * Mutation, and it is the one that matters here: `input.level >
 * MIC_NO_INPUT_FLOOR` -> `input.level > 0`, which is the rule that shipped.
 * Under it `heard` is set on the first reading and this test goes red.
 */
test("a level that is persistently tiny but non-zero raises the warning", () => {
  const start = 8_000_000;
  // **The literal 1/128, not `MIC_NO_INPUT_FLOOR`**, and the difference is not
  // style. Written symbolically this test pins the *relationship* and not the
  // *value*: setting the constant to 0 left it green, measured on 2026-09-20,
  // because the walk then fed zeros and still warned. 1/128 is what the
  // instrument actually reports for a dimmed capsule — a fact about
  // `getByteTimeDomainData`, not about this module — so it belongs here as a
  // number the rule has to cope with rather than as a name the rule chooses.
  const held = walk(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_AFTER_MS, 1 / 128);
  assert.equal(held.heard, false, "a dimmed microphone must not count as heard");
  assert.equal(held.warned, true);
  // And the analyser is still wanted, because the question is still open.
  assert.equal(micNoInputNeedsLevel(true, held), true);

  // The constant is that value, said once so a reader of the two tests above
  // can see which side of the boundary each of them is on.
  assert.equal(MIC_NO_INPUT_FLOOR, 1 / 128);
});

test("one step above the floor is sound, and the floor itself is not", () => {
  // The two sides of the boundary, so the assertion above cannot be satisfied
  // by a rule that simply stopped believing in sound.
  //
  // Mutation: `>` -> `>=` on the floor. Under it the dimmed microphone counts
  // as heard again and the test above goes red with this one.
  const start = 9_000_000;
  assert.equal(speech(MIC_NO_INPUT_CLEAR, start, 2 / 128).heard, true);
  assert.equal(speech(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_FLOOR).heard, false);
});

test("a click is not a syllable, and does not switch the warning off for the call", () => {
  // `heard` is terminal, so a single reading is a very cheap way to disable the
  // warning for a whole call. Measured 2026-09-20: the product's default
  // constraints give speech +13 dB, so a transient near a dimmed microphone
  // clears a one-reading rule while its owner still cannot be heard.
  //
  // Mutation: `MIC_NO_INPUT_HEARD_READINGS` 3 -> 1. Under it the click below
  // counts as a working microphone.
  const start = 10_000_000;
  let held = MIC_NO_INPUT_CLEAR;
  for (let at = start; at <= start + MIC_NO_INPUT_AFTER_MS; at += 50) {
    // One reading in every twenty is loud — a keyboard, a chair — and the
    // nineteen around it are the dimmed capsule. Deliberately off the
    // deadline’s own phase: a loud reading carries the run rather than
    // advancing it, so a click landing exactly on the tenth second would
    // make this test measure its own arithmetic instead of the rule.
    held = nextMicNoInput(held, { ...LIVE, level: at % 1000 === 500 ? 0.5 : 0, now: at });
  }
  assert.equal(held.heard, false, "a transient counted as a working microphone");
  assert.equal(held.warned, true);

  // And a real syllable does clear it, on the same levels.
  assert.equal(speech(held, start + MIC_NO_INPUT_AFTER_MS).heard, true);
});

test("a muted person is not told we cannot hear their microphone", () => {
  const start = 4_000_000;
  // Nine seconds of silence while muted, then the tenth.
  //
  // Mutation: the `if (!input.judgeable)` branch removed. Under it somebody who
  // muted themselves and sat quietly is accused of a broken microphone — which
  // is the product failing to read a state it set itself.
  let held = MIC_NO_INPUT_CLEAR;
  for (let at = start; at <= start + MIC_NO_INPUT_AFTER_MS * 2; at += 50) {
    held = nextMicNoInput(held, { enabled: true, judgeable: false, level: 0, now: at });
  }
  assert.equal(held.warned, false);
  assert.equal(held.silentSince, null);

  // And unmuting starts the ten seconds again rather than arriving already
  // expired. A person who unmutes must get a chance to speak first.
  const after = start + MIC_NO_INPUT_AFTER_MS * 2;
  const resumed = silence(held, after, MIC_NO_INPUT_AFTER_MS - 100);
  assert.equal(resumed.warned, false);
  assert.equal(resumed.silentSince, after);
});

test("a warning already up goes down when the capture stops being judgeable", () => {
  const start = 5_000_000;
  const warned = silence(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_AFTER_MS);
  assert.equal(warned.warned, true);

  // Mutation: the unjudgeable branch returning `state` unchanged instead of
  // clearing `warned`. Under it «мы не получаем звук с вашего микрофона» stays
  // on screen over a microphone the person has just switched off themselves.
  const muted = nextMicNoInput(warned, { enabled: true, judgeable: false, level: 0, now: start + 11_000 });
  assert.equal(muted.warned, false);
  assert.equal(muted.silentSince, null);
});

test("the setting off is off, and is not remembered for later", () => {
  const start = 6_000_000;
  const warned = silence(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_AFTER_MS);
  assert.equal(warned.warned, true);

  // Mutation: `if (!input.enabled) return MIC_NO_INPUT_CLEAR;` removed. Under
  // it the switch changes nothing at all, which is the defect class this whole
  // evening is about — a control that cannot change its own outcome.
  const off = nextMicNoInput(warned, { enabled: false, judgeable: true, level: 0, now: start + 11_000 });
  assert.deepEqual(off, MIC_NO_INPUT_CLEAR);
});

test("a warning that has been raised stays up while the microphone stays silent", () => {
  // There is deliberately no «скрыть» — the module header says why, and the
  // three things that do put the warning away are `heard`, a self-mute and the
  // switch. What must not happen is the sentence flickering: once raised, every
  // further reading of silence has to keep it up rather than re-arm a timer.
  //
  // Mutation: `const since = state.silentSince ?? input.now` -> `input.now`.
  // Under it the run restarts, `due` goes false, and the warning blinks off on
  // the very next reading.
  const start = 7_000_000;
  const warned = silence(MIC_NO_INPUT_CLEAR, start, MIC_NO_INPUT_AFTER_MS);
  assert.equal(warned.warned, true);
  const later = silence(warned, start + 11_000, MIC_NO_INPUT_AFTER_MS * 3);
  assert.equal(later.warned, true);
  assert.equal(later.silentSince, start);
  // And the analyser is still wanted, because the question is still open.
  assert.equal(micNoInputNeedsLevel(true, later), true);
});

test("the analyser is asked for only while the question is open", () => {
  // Mutation: `enabled && !state.heard` -> `!state.heard`. Under it every call
  // in «Всегда» opens an `AudioContext` for a warning its owner switched off,
  // which is the battery cost `micGateNeedsLevel` exists to avoid.
  assert.equal(micNoInputNeedsLevel(false, MIC_NO_INPUT_CLEAR), false);
  // Mutation: `enabled && !state.heard` -> `enabled`. Under it the analyser
  // runs for the length of every conversation instead of closing the moment the
  // microphone has proved itself.
  assert.equal(micNoInputNeedsLevel(true, MIC_NO_INPUT_CLEAR), true);
  assert.equal(
    micNoInputNeedsLevel(true, { silentSince: null, heard: true, warned: false, above: 3 }),
    false,
  );
});

test("a level that is not a number is silence, not sound", () => {
  // `NaN` is what an empty analyser buffer produces, and `audioLevelPercent`
  // already guards the meter against it. Here it must fall to the *safe* side:
  // treating it as sound would silently disable the whole feature on a browser
  // that answered `NaN` once, and nobody would ever find out.
  //
  // This assertion was written against a `Number.isFinite` guard in the module
  // and **no mutation of that guard could make it fail** — `NaN > 0` is already
  // `false`, so the guard was doing nothing. The guard is gone and the comment
  // in its place says so; what holds the behaviour is the comparison itself.
  //
  // Mutation: `input.level > 0` -> `!(input.level <= 0)`. That is the same
  // test for every real reading and the opposite one for `NaN`, and under it
  // this case reports a heard microphone.
  const held = nextMicNoInput(MIC_NO_INPUT_CLEAR, { ...LIVE, level: Number.NaN, now: 0 });
  assert.equal(held.heard, false);
  assert.equal(held.silentSince, 0);
});

test("an absent stored value means the warning is on", () => {
  // Mutation: `MIC_NO_INPUT_DEFAULT` -> `false`. Under it nobody who has not
  // opened this panel is ever warned, which is every person the warning exists
  // for.
  assert.equal(readMicNoInputEnabled(undefined), true);
  assert.equal(readMicNoInputEnabled(null), true);
  assert.equal(readMicNoInputEnabled("true"), true, "a string is not a boolean and falls to the default");
  assert.equal(readMicNoInputEnabled(false), false);
  assert.equal(readMicNoInputEnabled(true), true);
});

test("the warning reports the measurement and does not diagnose", () => {
  // The copy rule from the module header, held as a test because it is the one
  // thing that keeps this honest: the same reading comes from a hardware mute,
  // a system mixer and a noise suppressor that emits true silence, and naming
  // any one of them would be a guess.
  const said = `${MIC_NO_INPUT_WARNING} ${MIC_NO_INPUT_WARNING_DETAIL}`.toLocaleLowerCase("ru-RU");
  for (const forbidden of ["не работает", "сломан", "неисправ", "отключён микрофон", "нет микрофона"]) {
    assert.equal(said.includes(forbidden), false, `the warning diagnoses: ${forbidden}`);
  }
  // And it does say what was measured, and the two things to check.
  assert.equal(said.includes("не даёт звука"), true);
  for (const check of ["гарнитур", "устройство"]) {
    assert.equal(said.includes(check), true, `the warning does not name: ${check}`);
  }

  // **And it has to stay short.** It is drawn inside the call capsule, whose
  // text column is about 25 characters wide at 390 — the first version of this
  // sentence was 170 characters and photographed as **seven lines of red**,
  // a quarter of a phone screen. The checklist lives under the switch in the
  // settings panel instead, where a row is full width.
  //
  // 80 is three lines at that column and is the budget; the other sentence in
  // that capsule, «Модератор выключил ваш микрофон.», is 31.
  const inCapsule = `${MIC_NO_INPUT_WARNING}. ${MIC_NO_INPUT_WARNING_DETAIL}`;
  assert.ok(inCapsule.length <= 80, `the capsule sentence is ${inCapsule.length} characters`);

  // The checklist really is somewhere, so the assertion above cannot be
  // satisfied by a product that simply stopped telling anybody what to do.
  const hint = MIC_NO_INPUT_HINT.toLocaleLowerCase("ru-RU");
  for (const check of ["гарнитур", "систем", "выбран"]) {
    assert.equal(hint.includes(check), true, `the settings hint does not name: ${check}`);
  }
});
