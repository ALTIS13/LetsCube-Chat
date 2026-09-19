/**
 * One call, written down so that somebody else can read it.
 *
 * ## What it is for
 *
 * On 2026-09-19 a join failed three times in a row and the whole of what the
 * person could say was «не подключается». Finding out what had happened took an
 * evening, an SSH session and a read of the media server's logs — at the end of
 * which the answer was one line long: the signalling socket connected, the
 * token was accepted, the peer connection never established, and
 * livekit-client's fifteen-second timeout tore the socket down. Every fact in
 * that sentence was in the client at the time.
 *
 * So this is the button that would have made it a minute: a complete,
 * self-contained report a person can paste into a message without editing it,
 * and which answers «which step, how long, and what did the network do» in one
 * read.
 *
 * Pure — no React, no browser API, no network — so `node --test` reads it.
 * Everything it prints is handed to it; gathering is `VoiceConnectionPanel`'s.
 *
 * ## Privacy is the constraint, not a preference
 *
 * A report that has to be *edited* before it can be sent is a report nobody
 * sends, so the rule is that nothing here may ever need redacting:
 *
 *   - **No names.** Not a participant's, not the room's. A channel is named by
 *     whoever made it and «Планёрка Анны» is a person's name in a string that
 *     looks like a room's.
 *   - **No message content, no telephone numbers, no e-mail, no avatars.**
 *     None of it is on the path this report walks, and `buildVoiceReport` takes
 *     no field that could carry it — which is the guarantee, rather than a
 *     filter applied afterwards.
 *   - **Every account identifier is reduced to a short hash.** Stable inside
 *     one report, so two lines about the same person can be matched, and
 *     useless outside it: the salt is generated per report and **never
 *     printed**, so the hashes cannot be recomputed against a list of user ids
 *     and cannot be joined across two reports.
 *   - **Device identifiers are hashed too.** `MediaDeviceInfo.deviceId` is
 *     origin-scoped and stable per browser profile, which is a tracking
 *     identifier by design; and a device *label* is worse, because people call
 *     their headphones after themselves. The hash still answers the question
 *     that matters — «is this the device the browser refused» — and the label
 *     never enters the file.
 *
 * ## The one identifier kept verbatim, and why that is right
 *
 * The **room** — `vc_<channel uuid>`. It is the join key: it is what the media
 * server writes in its own log, so it is the one string that makes this report
 * and that log the same incident rather than two stories. And it is not an
 * account: it names a room, it is not derived from a person, and it grants
 * nothing to whoever reads it. Set against a report that cannot be correlated
 * with the server at all — which is to say, a report that does not do its job —
 * that is an easy trade, and it is the only exception in the file.
 *
 * The channel's **name** is a different matter and is deliberately absent; see
 * above.
 */

import type { VoiceHealth, VoiceHealthSample } from "./voiceConnectionHealth";
import {
  voiceJoinCurrentStage,
  voiceJoinStageLabel,
  voiceJoinStepMs,
  voiceJoinStepOutcome,
  voiceJoinTotalMs,
  type VoiceJoinJournal,
  type VoiceJoinStage,
  // The `.ts` is required and is the same shape `voiceChannel.ts` uses for its
  // one value import: a `node --test` process resolves this path itself, and
  // the type imports above may go without because they erase before it looks.
} from "./voiceJoinProgress.ts";

/** What the transport can say about itself. Filled by `hooks/voiceRoom.ts`. */
export interface VoiceTransportFacts {
  /** `vc_<channel uuid>` — the join key with the media server's own log. */
  readonly roomName: string | null;
  /** The server-assigned room id, once it has issued one. */
  readonly roomSid: string | null;
  readonly serverRegion: string | null;
  readonly serverNodeId: string | null;
  readonly serverVersion: string | null;
  readonly serverProtocol: number | null;
  /** The SDK's own `ConnectionState`, verbatim: `connected`, `reconnecting`, … */
  readonly connectionState: string | null;
  /**
   * How many remote voices have an audio element in the document right now.
   *
   * Counted from the document rather than from the sink's own map, because the
   * map is the bookkeeping under test and is therefore not evidence about
   * itself — `lib/voiceAudioSink.ts` records the six days this product spent
   * with a perfect connection and no elements at all.
   */
  readonly audioElements: number;
  /** How many of those are not paused. Zero with elements present is the fault. */
  readonly audioElementsPlaying: number;
}

/** Everything the report prints, as one argument. */
export interface VoiceReportInput {
  /** `Date.now()` when the report was made. */
  readonly at: number;
  /**
   * The per-report hashing salt. **Never printed.** See the header: printing it
   * would make every hash below recomputable against a list of user ids.
   */
  readonly salt: string;
  /** A short random name for this report, so two of them can be told apart. */
  readonly reportId: string;
  readonly app: {
    readonly version: string;
    readonly commit: string | null;
    /** «браузер», «Windows», «Android» — the shell, not the device. */
    readonly shell: string;
    readonly userAgent: string;
  };
  readonly call: {
    readonly phase: string;
    /** The channel id. Kept verbatim for the same reason the room is. */
    readonly channelId: string | null;
    readonly canPublish: boolean;
    readonly micMuted: boolean;
    readonly deafened: boolean;
    readonly speechRevoked: boolean;
    /** Whether the browser **ever** refused to sound this call, not only now. */
    readonly audioEverBlocked: boolean;
    readonly audioBlockedNow: boolean;
    readonly outputDeviceRefused: boolean;
    /** The sentence the person was shown, when the attempt was refused. */
    readonly refusal: string | null;
    /** Who this client is in the room. Hashed. */
    readonly identity: string | null;
    /** The room, as the SDK last reported it. Ids hashed, names dropped. */
    readonly participants: readonly {
      readonly userId: string;
      readonly muted: boolean;
      readonly canSpeak: boolean | null;
      readonly audioSource: string | null;
    }[];
  };
  readonly devices: {
    /** The chosen input device id, or null for the system default. Hashed. */
    readonly input: string | null;
    readonly output: string | null;
  };
  readonly journal: VoiceJoinJournal;
  readonly transport: VoiceTransportFacts | null;
  /** The computed numbers, or null when nothing was ever sampled. */
  readonly health: VoiceHealth | null;
  /** The raw readings the numbers were made of, oldest first. */
  readonly samples: readonly VoiceHealthSample[];
}

/**
 * FNV-1a, one 32-bit pass with a chosen offset basis.
 *
 * Chosen over a `crypto.subtle` digest for one reason that matters more than
 * its speed: `crypto.subtle.digest` is **asynchronous and unavailable on
 * insecure origins**, and this function is called from the middle of building a
 * string. A cryptographic digest would also not make the output stronger than
 * the salt already makes it — the salt is what the reversal has to break, and
 * it is 128 random bits that never leave the page.
 */
function fnv1a(offsetBasis: number, text: string): number {
  let hash = offsetBasis >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // The FNV prime, 16777619, by shifts — `hash * 16777619` overflows a
    // double's exact integer range and starts losing low bits.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * One account or device identifier, reduced.
 *
 * Two passes with different offsets, so the answer carries about 64 bits rather
 * than 32: ten people in a room collide at roughly one in a hundred million
 * instead of one in forty thousand, and a report in which two participants
 * share a line is a report that misleads.
 *
 * The salt's own length goes in front of it, so `salt + id` cannot be confused
 * with a different split of the same characters — the standard length-prefix
 * fix, chosen over a separator byte because any byte one might pick is a byte
 * that has to be argued about, and a `NUL` in a source file makes `grep` call it
 * binary.
 */
export function voiceReportHash(salt: string, value: string): string {
  const text = `${salt.length}:${salt}:${value}`;
  const high = fnv1a(0x811c9dc5, text).toString(36);
  const low = fnv1a(0x01000193, text).toString(36);
  return `${high}${low}`.padEnd(12, "0").slice(0, 12);
}

/** «15.02 с». Two decimals, because the fifteen-second case is 15.0 and 14.6. */
export function voiceReportSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} с`;
}

function yesNo(value: boolean): string {
  return value ? "да" : "нет";
}

/** A number, or the dash this product uses everywhere for «не измерено». */
function num(value: number | null | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : "—";
}

/**
 * What the incoming half is doing, in one word for a log rather than the
 * sentence the panel draws.
 *
 * Deliberately not `voiceInboundLabel`'s wording: that is written for somebody
 * reading a panel and this is written for somebody scanning a report. Keeping
 * them apart also means neither is changed by accident on behalf of the other.
 */
function inboundWord(reading: string): string {
  switch (reading) {
    case "receiving":
      return "принимаем";
    case "starved":
      return "ничего не приходит";
    case "unheard":
      return "приходит, но не воспроизводится";
    case "idle":
      return "никто не передаёт";
    default:
      return "неизвестно";
  }
}

/**
 * Whether an ICE candidate pair was **ever** selected during the readings held.
 *
 * «Ever» rather than «now» because that is the question a support conversation
 * asks: a connection that selected a pair and lost it is a different fault from
 * one that never selected one at all, and the second is what a peer connection
 * that times out looks like.
 *
 * `null` when nothing was sampled, which must not read as «no».
 */
export function voiceCandidatePairEverSelected(
  samples: readonly VoiceHealthSample[],
): boolean | null {
  if (samples.length === 0) return null;
  // `typeof === "string"`, not `!== null`, and the difference was measured
  // rather than guarded against: a transport that does not report the field at
  // all gives `undefined`, `undefined !== null` is true, and the first version
  // of this printed «ICE-пара выбиралась хоть раз: да» two lines under
  // «ICE-пара сейчас: —». That is this module’s own rule broken in its own
  // file: a reading nobody took is not a reading that answered.
  return samples.some((sample) => typeof sample.candidatePair === "string");
}

function heading(title: string): string {
  return `── ${title} ${"─".repeat(Math.max(0, 28 - title.length))}`;
}

function lines(...rows: (string | null)[]): string {
  return rows.filter((row): row is string => row !== null).join("\n");
}

/**
 * The stage timeline, which in the failing case **is** the whole diagnosis.
 *
 * Each row is the stage, how long it took, and whether it finished. The one
 * that did not finish carries an arrow, so the eye lands on it without reading
 * the durations — and for the 2026-09-19 failure that row reads
 * «Медиасоединение 15.01 с ← оборвалось» directly under «Связь с сервером
 * 0.18 с», which is the entire content of the evening that was spent finding it
 * out.
 */
function timeline(journal: VoiceJoinJournal, now: number, failed: boolean): string {
  if (journal.length === 0) return "Попытка подключения не записана.";
  const width = Math.max(...journal.map((step) => voiceJoinStageLabel(step.stage).length));
  const word = {
    running: "идёт",
    broke: "← оборвалось",
    done: "готово",
  } as const;
  return journal
    .map((step, index) => {
      const label = voiceJoinStageLabel(step.stage).padEnd(width, " ");
      const took = voiceReportSeconds(voiceJoinStepMs(step, now)).padStart(9, " ");
      return `${label}  ${took}  ${word[voiceJoinStepOutcome(journal, index, failed)]}`;
    })
    .join("\n");
}

/**
 * The one-line verdict at the top.
 *
 * First, because a report that has to be read to the bottom before it says what
 * happened is a report whose first reader guesses.
 */
function summary(input: VoiceReportInput): string {
  const open = voiceJoinCurrentStage(input.journal);
  if (input.call.phase === "failed") {
    const where: VoiceJoinStage | null = open ?? lastStage(input.journal);
    return where === null
      ? "Подключение не удалось."
      : `Подключение не удалось на шаге «${voiceJoinStageLabel(where)}».`;
  }
  if (input.call.phase === "joining") {
    return open === null
      ? "Подключение идёт."
      : `Подключение идёт, текущий шаг — «${voiceJoinStageLabel(open)}».`;
  }
  if (input.call.phase === "reconnecting") return "Связь потеряна, транспорт восстанавливается.";
  if (input.call.phase === "connected") {
    const verdict = input.health?.verdict ?? "unknown";
    if (verdict === "not_receiving") return "Соединение есть, входящий звук не идёт.";
    if (verdict === "unheard") return "Звук приходит и не воспроизводится в этом клиенте.";
    if (verdict === "lagging") return "Соединение есть, задержка выше порога.";
    if (verdict === "distorting") return "Соединение есть, потеря пакетов выше порога.";
    if (verdict === "good") return "Соединение установлено, отклонений не измерено.";
    return "Соединение установлено, измерений пока нет.";
  }
  return "Звонка нет.";
}

function lastStage(journal: VoiceJoinJournal): VoiceJoinStage | null {
  return journal[journal.length - 1]?.stage ?? null;
}

/**
 * The report.
 *
 * Plain text rather than JSON, and that is the whole of the decision about the
 * format: it leaves the page through the clipboard and arrives in a chat
 * message, where a person reads it. JSON would be joinable by a machine that
 * does not exist and unreadable by the reader who does.
 */
export function buildVoiceReport(input: VoiceReportInput): string {
  const { call, transport, health, journal, samples, at } = input;
  const hash = (value: string | null): string =>
    value === null ? "—" : voiceReportHash(input.salt, value);
  const device = (value: string | null): string =>
    value === null ? "по умолчанию" : voiceReportHash(input.salt, value);
  const latest = samples[samples.length - 1] ?? null;
  const pairEver = voiceCandidatePairEverSelected(samples);

  return lines(
    "Отчёт о голосовом соединении LETSCUBE",
    `Отчёт ${input.reportId} · ${new Date(at).toISOString()}`,
    "",
    summary(input),
    call.refusal ? `Сообщение на экране: ${call.refusal}` : null,
    `Длительность попытки: ${voiceReportSeconds(voiceJoinTotalMs(journal, at))}`,
    "",
    heading("Шаги подключения"),
    timeline(journal, at, call.phase === "failed"),
    "",
    heading("Приложение"),
    `Версия: ${input.app.version}${input.app.commit ? ` (${input.app.commit})` : ""}`,
    `Оболочка: ${input.app.shell}`,
    `User-Agent: ${input.app.userAgent}`,
    "",
    heading("Комната"),
    // Verbatim, and the only thing in the file that is. See the header.
    `Комната: ${transport?.roomName ?? "—"}`,
    `Канал: ${call.channelId ?? "—"}`,
    `Room SID: ${transport?.roomSid ?? "—"}`,
    `Состояние звонка: ${call.phase}`,
    `Состояние транспорта: ${transport?.connectionState ?? "—"}`,
    `Вы в комнате: ${hash(call.identity)}`,
    `Право говорить в токене: ${yesNo(call.canPublish)}`,
    `Микрофон выключен вами: ${yesNo(call.micMuted)}`,
    `Не слышите комнату: ${yesNo(call.deafened)}`,
    `Микрофон отобран модератором: ${yesNo(call.speechRevoked)}`,
    "",
    heading("Медиасервер"),
    `Регион: ${transport?.serverRegion ?? "—"}`,
    `Узел: ${transport?.serverNodeId ?? "—"}`,
    `Версия сервера: ${transport?.serverVersion ?? "—"}`,
    `Протокол: ${num(transport?.serverProtocol ?? null)}`,
    "",
    heading("Сеть"),
    `Измерений: ${samples.length}`,
    `ICE-пара сейчас: ${latest?.candidatePair ?? "—"}`,
    `Состояние ICE-пары: ${latest?.candidatePairState ?? "—"}`,
    `ICE-пара выбиралась хоть раз: ${pairEver === null ? "—" : yesNo(pairEver)}`,
    `Задержка: последняя ${num(health?.lastRttMs ?? null, " мс")}, средняя ${num(health?.averageRttMs ?? null, " мс")}`,
    `Дрожание исходящего: ${num(health?.lastJitterMs ?? null, " мс")}`,
    `Исходящие пакеты: ${num(latest?.packetsSent ?? null)}, потеряно ${num(latest?.packetsLost ?? null)}`,
    `Потеря исходящих: ${health?.outboundLossPercent === undefined || health?.outboundLossPercent === null ? "—" : `${health.outboundLossPercent.toFixed(1)}%`}`,
    "",
    heading("Входящий звук"),
    `Состояние: ${inboundWord(health?.inbound.reading ?? "unknown")}`,
    `Чужих голосов в комнате: ${num(latest?.remoteAudioTracks ?? null)}`,
    `Входящие пакеты: ${num(latest?.packetsReceived ?? null)}, потеряно ${num(latest?.inboundLost ?? null)}`,
    `Потеря входящих: ${health?.inbound.lossPercent === undefined || health?.inbound.lossPercent === null ? "—" : `${health.inbound.lossPercent.toFixed(1)}%`}`,
    `Дрожание входящего: ${num(health?.inbound.lastJitterMs ?? null, " мс")}`,
    // The two counters that separate «пакеты идут» from «человек слышит».
    // `totalSamplesReceived` advances only while something plays the track out
    // and advances for silence too; `totalAudioEnergy` is zero for somebody who
    // is simply not talking and is therefore information, never a fault.
    `totalSamplesReceived: ${num(latest?.samplesPlayed ?? null)}`,
    `totalAudioEnergy: ${num(latest?.audioEnergy ?? null)}`,
    `Элементов с чужим звуком: ${num(transport?.audioElements ?? null)}, играет ${num(transport?.audioElementsPlaying ?? null)}`,
    "",
    heading("Устройства"),
    // `null` is «the system default», which is a different answer from a device
    // that was chosen and is being reported by hash — and the difference is the
    // whole of a support conversation about a headset that stopped working.
    `Вход: ${device(input.devices.input)}`,
    `Выход: ${device(input.devices.output)}`,
    `Браузер отказал в выборе выхода: ${yesNo(call.outputDeviceRefused)}`,
    `Автовоспроизведение блокировалось: ${yesNo(call.audioEverBlocked)}${call.audioBlockedNow ? " (блокировано сейчас)" : ""}`,
    "",
    heading("Участники"),
    call.participants.length === 0
      ? "Комната пуста или ещё не сообщена."
      : call.participants
          .map(
            (who) =>
              `${hash(who.userId)}  микрофон ${who.muted ? "выключен" : "включён"}` +
              `  право говорить ${who.canSpeak === null ? "неизвестно" : yesNo(who.canSpeak)}` +
              `  звук ${who.audioSource ?? "неизвестно"}`,
          )
          .join("\n"),
    "",
    // Said in the file rather than only in this module's header, because the
    // person who receives it has to be able to see that it is safe to forward.
    "Идентификаторы участников и устройств заменены хешами, которые действуют",
    "только внутри этого отчёта. Имён, сообщений, телефонов и почты здесь нет.",
  );
}
