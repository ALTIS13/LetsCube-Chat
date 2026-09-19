/**
 * What a join is actually doing, while it is doing it.
 *
 * ## The evening this exists for
 *
 * On 2026-09-19 somebody could not join a voice channel. From their side it was
 * fifteen seconds of nothing and then «Не удалось подключиться к голосовому
 * серверу.» From the server's side it was legible in one read: the signalling
 * socket connected, the token was accepted, and the `RTCPeerConnection` never
 * established — so livekit-client's `peerConnectionTimeout` fired and tore the
 * socket down. Their three attempts lasted 15.2 s, 14.6 s and 15.0 s, which is
 * a timeout and not a network.
 *
 * Every one of those facts was available in the client at the time. None of it
 * reached the person, because the join was one opaque await with one sentence
 * at the end of it. This module is the stages, the words for them, and the
 * words for a failure that names where it happened.
 *
 * Pure — no React, no browser API, no `@/` import — so `node --test` reads it.
 * The lesson is CLAUDE.md's and `lib/voiceChannel.ts` repeats it at its own
 * head: a decision that cannot be reached from a test is a gap in the module
 * boundary, not in the suite.
 *
 * ## Why the stages are six, and where each of them comes from
 *
 * They are read off `hooks/useVoiceCall.ts`'s `joinVoiceChannel` and
 * `hooks/voiceRoom.ts`'s `join`, in order, rather than invented as a plausible
 * list:
 *
 *   1. `microphone` — `captureMicrophone()`, which is `getUserMedia` and may
 *      sit on a permission prompt for as long as a person takes to answer it.
 *   2. `token` — `requestVoiceToken()`: the Supabase session, then one POST to
 *      the voice gateway.
 *   3. `runtime` — `loadVoiceRoom()`, which is `await import("livekit-client")`
 *      — 12.4 MB unpacked, deliberately not in the entry bundle, and therefore
 *      a network fetch on the first call of a session.
 *   4. `signal` — `room.connect()` up to `RoomEvent.SignalConnected`: the
 *      WebSocket and the server's join response.
 *   5. `media` — the rest of `room.connect()`: ICE, DTLS, the peer connection.
 *      **This is the fifteen seconds.**
 *   6. `publish` — `publishTrack`, the local microphone reaching the room. A
 *      listen-only token never enters it, which is correct rather than a gap.
 *
 * The first three are the hook's and it announces them itself. The last three
 * are inside one await and only the transport can see them, so the seam
 * announces those — `VoiceRoomEvents.onJoinStage`.
 *
 * ## Why this is not five more values of `VoiceCallPhase`
 *
 * `VoiceCallPhase` is read by `voiceCapsuleState`, `voiceCallBarState`,
 * `useVoiceHealth`, `lib/voiceRoomSound.ts` and `lib/callRecord.ts`, and most
 * of those branch on it with `phase !== "idle" && phase !== "failed"` or
 * `phase === "joining"`. Six new members would make every one of those sites
 * quietly wrong — the comparisons still compile, and `joining` simply stops
 * being true of a join.
 *
 * The decisive reason is narrower than that, though. **A failure has to name
 * the stage it failed at**, so the stage history must survive into
 * `phase: "failed"` — and a sub-state *of* a phase cannot, by construction:
 * the moment the phase moves, the thing that said where it was is gone. The
 * journal is therefore its own value with its own lifetime, cleared by the
 * next join rather than by the end of this one.
 */

/** One step of a join, in the order they happen. */
export type VoiceJoinStage =
  /** `getUserMedia`. May be sitting on a permission prompt. */
  | "microphone"
  /** The session, and one POST to the voice gateway for a token. */
  | "token"
  /** `await import("livekit-client")` — a network fetch on the first join. */
  | "runtime"
  /** The WebSocket to the media server, and its join response. */
  | "signal"
  /** ICE, DTLS, the peer connection. Where the fifteen seconds go. */
  | "media"
  /** The local microphone reaching the room. Never entered by a listener. */
  | "publish";

/**
 * The stages in order, which is what makes «later than» a question with an
 * answer.
 *
 * Exported because the ordering is a fact about the product rather than an
 * implementation detail of `voiceJoinStageBegan`, and a test that asserted the
 * rule against its own copy of the list would be asserting nothing.
 */
export const VOICE_JOIN_STAGES: readonly VoiceJoinStage[] = [
  "microphone",
  "token",
  "runtime",
  "signal",
  "media",
  "publish",
];

/** The stages the **transport** announces, because nothing above it can see them. */
export type VoiceTransportStage = Extract<VoiceJoinStage, "media" | "publish">;

/**
 * livekit-client's own `peerConnectionTimeout`, read off
 * `roomConnectOptionDefaults` in 2.22.3 rather than remembered.
 *
 * It is here because the `media` budget below is derived from it, and a number
 * derived from another number is a lie the moment the other one moves without
 * anybody noticing.
 */
export const VOICE_MEDIA_TIMEOUT_MS = 15_000;

/**
 * How long each stage may run before the interface says it is slow.
 *
 * Not one number, because the stages fail on different clocks and one
 * threshold would be wrong for every stage but one:
 *
 *   - `microphone` is the **shortest**, which looks backwards until you read the
 *     sentence it produces. Every other stage is a machine answering or not
 *     answering, and saying so early is a nag; this one is a person who has not
 *     yet noticed the browser asking them something, and «Ждём разрешение на
 *     микрофон» is not a complaint but a finger pointing at the prompt. Three
 *     seconds is about as long as it takes to move a hand to a mouse.
 *   - `token` and `signal` are one round trip each to a server that is up or is
 *     not. Four seconds is already several times a bad connection's latency.
 *   - `runtime` is a 12 MB chunk over whatever link this person has, so it is
 *     allowed the longest of the ordinary stages.
 *   - `media` is the one this whole module was written for, and its budget is
 *     deliberately **less than half** of `VOICE_MEDIA_TIMEOUT_MS`: the failure
 *     has to be legible while it is happening, with nine seconds still to run,
 *     rather than explained after the timeout has already fired.
 */
export const VOICE_JOIN_SLOW_MS: Readonly<Record<VoiceJoinStage, number>> = {
  microphone: 3_000,
  token: 4_000,
  runtime: 5_000,
  signal: 4_000,
  media: 6_000,
  publish: 4_000,
};

/** One step of a join, as the journal records it. */
export interface VoiceJoinStep {
  readonly stage: VoiceJoinStage;
  /** `Date.now()` when this stage began. */
  readonly at: number;
  /** When it ended, or `null` while it is still running. */
  readonly endedAt: number | null;
}

/** Every step of the join that is running, or of the last one that ran. */
export type VoiceJoinJournal = readonly VoiceJoinStep[];

/** Nothing has been attempted. */
export const VOICE_JOIN_JOURNAL_EMPTY: VoiceJoinJournal = [];

function indexOfStage(stage: VoiceJoinStage): number {
  return VOICE_JOIN_STAGES.indexOf(stage);
}

/** The step that is running right now, or null when none is. */
export function voiceJoinOpenStep(journal: VoiceJoinJournal): VoiceJoinStep | null {
  const last = journal[journal.length - 1];
  return last && last.endedAt === null ? last : null;
}

/** The stage that is running right now, or null. */
export function voiceJoinCurrentStage(journal: VoiceJoinJournal): VoiceJoinStage | null {
  return voiceJoinOpenStep(journal)?.stage ?? null;
}

/**
 * Record that a stage has begun.
 *
 * **A stage that is not strictly later than the one running is ignored**, and
 * that is a rule rather than defensiveness. Two things produce a repeat: the
 * transport announces `media` on `RoomEvent.SignalConnected`, which fires again
 * after every full reconnect for the rest of the call; and a stage arriving
 * late from a join this client has already abandoned. Either one restarting the
 * clock would make the interface say a finished call is still connecting, and
 * would overwrite the very duration a report exists to carry.
 *
 * A journal that has already been closed takes nothing more, for the same
 * reason: the join is over and what it did is now evidence.
 */
export function voiceJoinStageBegan(
  journal: VoiceJoinJournal,
  stage: VoiceJoinStage,
  at: number,
): VoiceJoinJournal {
  const last = journal[journal.length - 1];
  if (!last) return [{ stage, at, endedAt: null }];
  if (last.endedAt !== null) return journal;
  if (indexOfStage(stage) <= indexOfStage(last.stage)) return journal;
  // `Math.max` rather than `at`, so a clock that went backwards between two
  // readings cannot produce a step of negative length in the report.
  return [...journal.slice(0, -1), { ...last, endedAt: Math.max(at, last.at) }, { stage, at, endedAt: null }];
}

/**
 * Close the journal: the join connected, failed, or was cancelled.
 *
 * Idempotent, because every one of those three paths can be reached twice —
 * `leaveVoiceCall` during a join runs alongside the continuation that is about
 * to fail — and a second close must not move a duration that has already been
 * recorded.
 */
export function voiceJoinSettled(journal: VoiceJoinJournal, at: number): VoiceJoinJournal {
  const open = voiceJoinOpenStep(journal);
  if (!open) return journal;
  return [...journal.slice(0, -1), { ...open, endedAt: Math.max(at, open.at) }];
}

/** How long the running stage has been running, or 0 when none is. */
export function voiceJoinStageElapsedMs(journal: VoiceJoinJournal, now: number): number {
  const open = voiceJoinOpenStep(journal);
  if (!open) return 0;
  return Math.max(0, now - open.at);
}

/**
 * How long the whole attempt has taken.
 *
 * Measured to the close of the last step when the journal is closed, and to
 * `now` while it is still running — so the number in a report is the attempt's
 * own length rather than the time since somebody opened the panel.
 */
export function voiceJoinTotalMs(journal: VoiceJoinJournal, now: number): number {
  const first = journal[0];
  if (!first) return 0;
  const last = journal[journal.length - 1];
  const end = last.endedAt ?? now;
  return Math.max(0, end - first.at);
}

/** How long one recorded step took, or how long it has been running. */
export function voiceJoinStepMs(step: VoiceJoinStep, now: number): number {
  return Math.max(0, (step.endedAt ?? now) - step.at);
}

/** How one recorded step ended. */
export type VoiceJoinStepOutcome =
  /** Still running. Only ever the last step, and only during a join. */
  | "running"
  /** The step the attempt died at. */
  | "broke"
  /** Finished and handed over to the next one. */
  | "done";

/**
 * Which of the three a step is — and the reason this is a function rather than
 * `step.endedAt === null`.
 *
 * **A failed join has no open step.** `fail()` closes the journal before it
 * publishes, deliberately, so that the last step’s recorded length is the length
 * of the attempt rather than the age of the report. The first version of the
 * timeline therefore marked nothing at all on exactly the journal it was written
 * for: every row read «готово», including the fifteen-second one that had just
 * timed out. The step that broke is not the open one — it is the **last** one,
 * of an attempt that failed, and only the caller knows the attempt failed.
 *
 * So `failed` is a parameter. Passing it wrongly is the one way to get a wrong
 * answer here, which is why both callers read it from the same `phase` the
 * person was shown a sentence for.
 */
export function voiceJoinStepOutcome(
  journal: VoiceJoinJournal,
  index: number,
  failed: boolean,
): VoiceJoinStepOutcome {
  const step = journal[index];
  if (!step) return "done";
  if (step.endedAt === null) return "running";
  return failed && index === journal.length - 1 ? "broke" : "done";
}

/** Whether the running stage has been running longer than its budget. */
export function voiceJoinStageIsSlow(stage: VoiceJoinStage, elapsedMs: number): boolean {
  return elapsedMs >= VOICE_JOIN_SLOW_MS[stage];
}

/**
 * What each stage is called, in three or four words.
 *
 * Used by the report's timeline and by nothing that has to fit in a capsule —
 * the capsule says a sentence, which is `voiceJoinProgressText`.
 */
export function voiceJoinStageLabel(stage: VoiceJoinStage): string {
  switch (stage) {
    case "microphone":
      return "Микрофон";
    case "token":
      return "Разрешение на вход";
    case "runtime":
      return "Голосовой модуль";
    case "signal":
      return "Связь с сервером";
    case "media":
      return "Медиасоединение";
    case "publish":
      return "Микрофон в эфир";
  }
}

/** What is happening, while it is still within its budget. */
function stageRunningText(stage: VoiceJoinStage): string {
  switch (stage) {
    case "microphone":
      return "Запрашиваем микрофон…";
    case "token":
      return "Получаем разрешение…";
    case "runtime":
      return "Загружаем голосовой модуль…";
    case "signal":
      return "Соединяемся с сервером…";
    case "media":
      return "Устанавливаем медиасоединение…";
    case "publish":
      return "Включаем микрофон…";
  }
}

/**
 * What is happening, once it has taken longer than it should.
 *
 * Each of these names the thing that is stuck rather than the attempt — «Сервер
 * не отвечает» and «Медиасоединение не устанавливается» send a person to
 * different places, and «Не удалось подключиться» sends them nowhere. Present
 * tense on purpose: it is still running, and saying it has failed while it has
 * not is how a person presses «Отмена» half a second before it would have
 * connected.
 */
function stageSlowText(stage: VoiceJoinStage): string {
  switch (stage) {
    case "microphone":
      return "Ждём разрешение на микрофон";
    case "token":
      return "Сервер разрешений не отвечает";
    case "runtime":
      return "Голосовой модуль долго загружается";
    case "signal":
      return "Голосовой сервер не отвечает";
    case "media":
      return "Медиасоединение не устанавливается";
    case "publish":
      return "Микрофон не выходит в эфир";
  }
}

/** «8 с», «12 с» — whole seconds, because tenths on a live counter are noise. */
export function voiceJoinSecondsText(elapsedMs: number): string {
  return `${Math.max(0, Math.floor(elapsedMs / 1000))} с`;
}

/**
 * The one line the capsule draws while a join is in flight.
 *
 * Under its budget it is a sentence and nothing else. Over it, the sentence
 * changes **and** a running seconds count appears — which is the whole of the
 * owner's «пользователь не был в недоумении что происходит»: a number that is
 * visibly climbing is the difference between «this is taking a while» and «this
 * has hung», and it is the thing a person quotes when they report it.
 */
export function voiceJoinProgressText(stage: VoiceJoinStage, elapsedMs: number): string {
  if (!voiceJoinStageIsSlow(stage, elapsedMs)) return stageRunningText(stage);
  return `${stageSlowText(stage)} · ${voiceJoinSecondsText(elapsedMs)}`;
}

/**
 * What a join that failed at this stage says.
 *
 * `microphone` and `token` are deliberately **not** the sentences used in
 * production: those two stages fail with a reason the client already knows —
 * `microphoneRefusalText` names the browser's own refusal, and
 * `voiceGatewayRefusalText` names the gateway's — and a stage name would be a
 * coarser answer than the one already in hand. They are answered here so that
 * the report's summary line can name any stage, and so that this function is
 * total rather than partial.
 *
 * The `media` sentence is the owner's own, and it is the point of the whole
 * exercise: «Сигнал есть, медиасоединение не устанавливается» is the same event
 * as «Не удалось подключиться», said usefully.
 */
export function voiceJoinFailureText(stage: VoiceJoinStage): string {
  switch (stage) {
    case "microphone":
      return "Микрофон недоступен.";
    case "token":
      return "Сервер не выдал разрешение на вход.";
    case "runtime":
      return "Не удалось загрузить голосовой модуль.";
    case "signal":
      return "Нет связи с голосовым сервером.";
    case "media":
      return "Сигнал есть, медиасоединение не устанавливается.";
    case "publish":
      return "Соединение есть, но микрофон не удалось включить.";
  }
}
