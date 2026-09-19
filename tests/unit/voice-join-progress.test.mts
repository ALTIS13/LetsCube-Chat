// Which step of a join is running, how long it took, and what a failure at it
// says.
//
// Asked for by the owner on 2026-09-19, after somebody's join failed three
// times at 15.2 s, 14.6 s and 15.0 s and the whole of what they could report
// was «не подключается». The three durations within 0.6 s of each other are a
// timeout and not a network, and the timeout was livekit-client's
// `peerConnectionTimeout` — the signalling socket had connected and the peer
// connection had not.
//
// Every test below is about a way of getting that wrong which looks right on a
// join that works, which is every join anybody tests by hand.

import assert from "node:assert/strict";
import test from "node:test";

import {
  voiceJoinCurrentStage,
  voiceJoinFailureText,
  voiceJoinOpenStep,
  voiceJoinProgressText,
  voiceJoinSecondsText,
  voiceJoinSettled,
  voiceJoinStageBegan,
  voiceJoinStageElapsedMs,
  voiceJoinStageIsSlow,
  voiceJoinStageLabel,
  voiceJoinStepMs,
  voiceJoinTotalMs,
  VOICE_JOIN_JOURNAL_EMPTY,
  VOICE_JOIN_SLOW_MS,
  VOICE_JOIN_STAGES,
  VOICE_MEDIA_TIMEOUT_MS,
  type VoiceJoinJournal,
  type VoiceJoinStage,
} from "../../artifacts/kub/src/lib/voiceJoinProgress.ts";

const T0 = 1_800_000_000_000;

/** The join the owner's companion had: signal up, media never. */
function theFifteenSecondJoin(): VoiceJoinJournal {
  let journal = voiceJoinStageBegan(VOICE_JOIN_JOURNAL_EMPTY, "microphone", T0);
  journal = voiceJoinStageBegan(journal, "token", T0 + 300);
  journal = voiceJoinStageBegan(journal, "runtime", T0 + 720);
  journal = voiceJoinStageBegan(journal, "signal", T0 + 1_330);
  journal = voiceJoinStageBegan(journal, "media", T0 + 1_510);
  return journal;
}

test("a join records every step it entered, in order, with its own length", () => {
  const journal = voiceJoinSettled(theFifteenSecondJoin(), T0 + 16_520);

  assert.deepEqual(
    journal.map((step) => step.stage),
    ["microphone", "token", "runtime", "signal", "media"],
  );
  // Each closed step ends where the next one begins, so the durations add up
  // to the attempt rather than overlapping or leaving holes.
  assert.equal(voiceJoinStepMs(journal[0], T0), 300);
  assert.equal(voiceJoinStepMs(journal[3], T0), 180);
  assert.equal(voiceJoinStepMs(journal[4], T0), 15_010);
  assert.equal(voiceJoinTotalMs(journal, T0), 16_520);
  // «publish» was never entered, because the peer connection never came up.
  // That absence is a fact about the failure and must not be filled in.
  assert.equal(
    journal.some((step) => step.stage === "publish"),
    false,
  );
});

test("the running step is the last one, and its clock keeps running", () => {
  const journal = theFifteenSecondJoin();
  assert.equal(voiceJoinCurrentStage(journal), "media");
  assert.equal(voiceJoinOpenStep(journal)?.endedAt, null);
  assert.equal(voiceJoinStageElapsedMs(journal, T0 + 9_510), 8_000);
  // And the total is measured to *now* while it is still running, rather than
  // to the last close — a report taken mid-join says how long the attempt has
  // taken, not how long ago it started stalling.
  assert.equal(voiceJoinTotalMs(journal, T0 + 9_510), 9_510);
});

test("a stage that is not later than the running one changes nothing", () => {
  // The mutation this exists for: dropping the ordering test in
  // `voiceJoinStageBegan`. `RoomEvent.SignalConnected` fires again after every
  // full reconnect for the rest of the call, and production was running a
  // fifteen-second reconnect cycle when this was written — so the transport
  // announces «media» four times a minute for an hour. Without the rule the
  // journal grows a step per reconnect, the interface says a connected call is
  // connecting, and the duration a report exists to carry is overwritten by the
  // age of the newest repeat.
  const journal = theFifteenSecondJoin();
  assert.equal(voiceJoinStageBegan(journal, "media", T0 + 40_000), journal);
  assert.equal(voiceJoinStageBegan(journal, "signal", T0 + 40_000), journal);
  assert.equal(voiceJoinStageBegan(journal, "microphone", T0 + 40_000), journal);
  // The same object, not merely an equal one: the store compares by identity to
  // decide whether to notify, so a copy would re-render every subscriber on
  // every reconnect for nothing.
  assert.equal(voiceJoinStageElapsedMs(journal, T0 + 9_510), 8_000);
});

test("a journal that has been closed takes nothing more", () => {
  const closed = voiceJoinSettled(theFifteenSecondJoin(), T0 + 16_520);
  assert.equal(voiceJoinStageBegan(closed, "publish", T0 + 20_000), closed);
  assert.equal(voiceJoinCurrentStage(closed), null);
  assert.equal(voiceJoinStageElapsedMs(closed, T0 + 99_999), 0);
});

test("closing twice does not move a duration that has already been recorded", () => {
  // `leaveVoiceCall` during a join runs alongside the continuation that is
  // about to call `fail`, so both close the same journal. A second close that
  // wrote a new `endedAt` would report the length of the tidying rather than
  // the length of the attempt.
  const once = voiceJoinSettled(theFifteenSecondJoin(), T0 + 16_520);
  const twice = voiceJoinSettled(once, T0 + 30_000);
  assert.equal(twice, once);
  assert.equal(voiceJoinTotalMs(twice, T0 + 99_999), 16_520);
});

test("a clock that goes backwards cannot make a step of negative length", () => {
  // Not theoretical on a laptop that suspends, and a negative duration in a
  // report is worse than a wrong one: it reads as a bug in the report.
  let journal = voiceJoinStageBegan(VOICE_JOIN_JOURNAL_EMPTY, "microphone", T0);
  journal = voiceJoinStageBegan(journal, "token", T0 - 5_000);
  assert.equal(voiceJoinStepMs(journal[0], T0), 0);
  const closed = voiceJoinSettled(journal, T0 - 9_000);
  assert.ok(voiceJoinStepMs(closed[1], T0) >= 0);
  assert.ok(voiceJoinTotalMs(closed, T0) >= 0);
});

test("an empty journal answers nothing rather than a zeroed attempt", () => {
  assert.equal(voiceJoinCurrentStage(VOICE_JOIN_JOURNAL_EMPTY), null);
  assert.equal(voiceJoinOpenStep(VOICE_JOIN_JOURNAL_EMPTY), null);
  assert.equal(voiceJoinTotalMs(VOICE_JOIN_JOURNAL_EMPTY, T0), 0);
  assert.equal(voiceJoinSettled(VOICE_JOIN_JOURNAL_EMPTY, T0), VOICE_JOIN_JOURNAL_EMPTY);
});

test("the media budget leaves the fifteen-second failure legible while it runs", () => {
  // The whole design decision of this module, as a number. livekit-client's
  // `peerConnectionTimeout` is 15 s (read off `roomConnectOptionDefaults` in
  // 2.22.3), so a budget at or over half of it would announce the problem with
  // less time left than it has already spent — which is announcing it
  // afterwards, dressed as during.
  assert.ok(
    VOICE_JOIN_SLOW_MS.media < VOICE_MEDIA_TIMEOUT_MS / 2,
    `the media budget ${VOICE_JOIN_SLOW_MS.media} does not clear half of ${VOICE_MEDIA_TIMEOUT_MS}`,
  );
  // And the person sees it with most of the timeout still to run.
  assert.ok(VOICE_MEDIA_TIMEOUT_MS - VOICE_JOIN_SLOW_MS.media >= 8_000);
});

test("the microphone speaks soonest, because the thing that is stuck is the person", () => {
  // It reads backwards until you read the sentence. Every other stage is a
  // machine answering or not answering, and announcing those early is a nag;
  // this one is somebody who has not noticed the browser asking them something,
  // and the line it produces points at the prompt. So it must not sit at or
  // above the machine budgets.
  for (const stage of ["token", "runtime", "signal", "publish"] as const) {
    assert.ok(
      VOICE_JOIN_SLOW_MS.microphone < VOICE_JOIN_SLOW_MS[stage],
      `${stage} announces itself sooner than the prompt nobody has answered`,
    );
  }
  assert.match(voiceJoinProgressText("microphone", 60_000), /^Ждём разрешение на микрофон/);
});

test("under its budget the line is a sentence; over it, it says so and counts", () => {
  assert.equal(voiceJoinProgressText("media", 0), "Устанавливаем медиасоединение…");
  assert.equal(
    voiceJoinProgressText("media", VOICE_JOIN_SLOW_MS.media - 1),
    "Устанавливаем медиасоединение…",
  );
  // The moment the budget is reached, not one tick after it.
  assert.equal(voiceJoinStageIsSlow("media", VOICE_JOIN_SLOW_MS.media), true);
  assert.equal(
    voiceJoinProgressText("media", 8_400),
    "Медиасоединение не устанавливается · 8 с",
  );
  // Whole seconds, rounded **down**: a counter that says 9 at 8.4 is a counter
  // that disagrees with the stopwatch in somebody's hand.
  assert.equal(voiceJoinSecondsText(8_400), "8 с");
  assert.equal(voiceJoinSecondsText(0), "0 с");
  assert.equal(voiceJoinSecondsText(-500), "0 с");
});

test("a slow stage names the thing that is stuck, not the attempt", () => {
  // The defect the whole module is about, one layer up: «Не удалось
  // подключиться» is true of four different faults that send a person to four
  // different places. Each slow sentence has to name its own.
  const said = VOICE_JOIN_STAGES.map((stage) => voiceJoinProgressText(stage, 60_000));
  assert.equal(new Set(said).size, VOICE_JOIN_STAGES.length, `two stages say the same thing: ${said}`);
  for (const line of said) assert.match(line, / · 60 с$/);
  // And none of them claims the attempt has ended, because it has not: a person
  // who reads «не удалось» presses cancel half a second before it connects.
  for (const line of said) assert.doesNotMatch(line, /удалось|ошибк/i);
});

test("every stage has its own words, and the failure names where it happened", () => {
  const labels = VOICE_JOIN_STAGES.map(voiceJoinStageLabel);
  const failures = VOICE_JOIN_STAGES.map(voiceJoinFailureText);
  assert.equal(new Set(labels).size, VOICE_JOIN_STAGES.length);
  assert.equal(new Set(failures).size, VOICE_JOIN_STAGES.length);
  for (const text of [...labels, ...failures]) assert.ok(text.trim().length > 0);

  // The sentence this was all for, verbatim — it is the owner's own wording of
  // the same event «Не удалось подключиться» was reporting.
  assert.equal(
    voiceJoinFailureText("media"),
    "Сигнал есть, медиасоединение не устанавливается.",
  );
  // And the one before it has to be a different sentence, or the two faults are
  // indistinguishable again and the split bought nothing.
  assert.equal(voiceJoinFailureText("signal"), "Нет связи с голосовым сервером.");
});

test("the stage order is the order a join actually runs in", () => {
  // The control for every ordering assertion above: if this list stopped
  // matching `hooks/useVoiceCall.ts`'s sequence, `voiceJoinStageBegan` would go
  // on refusing and accepting confidently and wrongly.
  assert.deepEqual(VOICE_JOIN_STAGES, [
    "microphone",
    "token",
    "runtime",
    "signal",
    "media",
    "publish",
  ] satisfies VoiceJoinStage[]);
  // Every stage has a budget. A stage added without one would read
  // `undefined`, and `elapsed >= undefined` is false for ever — a step that can
  // never be slow, silently.
  for (const stage of VOICE_JOIN_STAGES) {
    assert.equal(typeof VOICE_JOIN_SLOW_MS[stage], "number", `${stage} has no budget`);
    assert.ok(VOICE_JOIN_SLOW_MS[stage] > 0);
  }
});
