// The exportable connection report.
//
// Asked for by the owner on 2026-09-19 alongside the join stages: «надо больше
// метрик сверять от клиента к серверу и обратно чтобы пользователь … мог
// предоставить условный debug log своего соединения».
//
// Two kinds of test below and they are not the same kind. The first is about
// whether the file answers the question it exists for — the 2026-09-19 join is
// reconstructed exactly and the report has to say where it broke. The second is
// about **privacy**, which is a hard constraint here rather than a preference:
// a report that has to be edited before it can be sent is a report nobody
// sends, so nothing in it may ever need redacting.

import assert from "node:assert/strict";
import test from "node:test";

import type {
  VoiceHealth,
  VoiceHealthSample,
} from "../../artifacts/kub/src/lib/voiceConnectionHealth.ts";
import {
  buildVoiceReport,
  voiceCandidatePairEverSelected,
  voiceReportHash,
  voiceReportSeconds,
  type VoiceReportInput,
  type VoiceTransportFacts,
} from "../../artifacts/kub/src/lib/voiceConnectionReport.ts";
import {
  voiceJoinSettled,
  voiceJoinStageBegan,
  VOICE_JOIN_JOURNAL_EMPTY,
  type VoiceJoinJournal,
} from "../../artifacts/kub/src/lib/voiceJoinProgress.ts";

const T0 = 1_800_000_000_000;
const SALT = "a-salt-that-is-never-printed";

/** The names, numbers and strings a report must never carry. */
const ANNA = "11111111-1111-4111-8111-000000000002";
const ME = "11111111-1111-4111-8111-000000000001";
const HEADSET = "8f3c2a19d0b4e7615c9a2d3f4e5b6a7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e";

/** The owner's companion's join: signal up in 0.18 s, media open at 15.01 s. */
function theFifteenSecondJoin(): VoiceJoinJournal {
  let journal = voiceJoinStageBegan(VOICE_JOIN_JOURNAL_EMPTY, "microphone", T0);
  journal = voiceJoinStageBegan(journal, "token", T0 + 300);
  journal = voiceJoinStageBegan(journal, "runtime", T0 + 720);
  journal = voiceJoinStageBegan(journal, "signal", T0 + 1_330);
  journal = voiceJoinStageBegan(journal, "media", T0 + 1_510);
  return voiceJoinSettled(journal, T0 + 16_520);
}

function transport(over: Partial<VoiceTransportFacts> = {}): VoiceTransportFacts {
  return {
    roomName: "vc_33333333-3333-4333-8333-000000000001",
    roomSid: "RM_abc123",
    serverRegion: "finland",
    serverNodeId: "14135",
    serverVersion: "1.9.2",
    serverProtocol: 16,
    connectionState: "connected",
    audioElements: 1,
    audioElementsPlaying: 1,
    ...over,
  };
}

function sample(over: Partial<VoiceHealthSample> & { at: number }): VoiceHealthSample {
  return {
    at: over.at,
    rttMs: 19,
    jitterMs: 2,
    packetsSent: 4_200,
    packetsLost: 0,
    packetsReceived: 4_050,
    inboundLost: 0,
    inboundJitterMs: 2,
    samplesPlayed: 96_480,
    audioEnergy: 2.01,
    remoteAudioTracks: 1,
    candidatePair: "srflx/srflx",
    candidatePairState: "succeeded",
    ...over,
  };
}

function health(over: Partial<VoiceHealth> = {}): VoiceHealth {
  return {
    verdict: "good",
    averageRttMs: 21,
    lastRttMs: 19,
    outboundLossPercent: 0,
    lastJitterMs: 2,
    sampleCount: 6,
    inbound: {
      reading: "receiving",
      lossPercent: 0,
      lastJitterMs: 2,
      packetsPerSecond: 50,
      carryingSound: true,
      remoteAudioTracks: 1,
    },
    ...over,
  };
}

function input(over: Partial<VoiceReportInput> = {}): VoiceReportInput {
  return {
    at: T0 + 20_000,
    salt: SALT,
    reportId: "r7f3a2",
    app: {
      version: "0.1.5",
      commit: "245e4d9714",
      shell: "web_only · production",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0",
    },
    call: {
      phase: "connected",
      channelId: "33333333-3333-4333-8333-000000000001",
      canPublish: true,
      micMuted: false,
      deafened: false,
      speechRevoked: false,
      audioEverBlocked: false,
      audioBlockedNow: false,
      outputDeviceRefused: false,
      refusal: null,
      identity: ME,
      participants: [
        { userId: ME, muted: false, canSpeak: true, audioSource: "microphone" },
        { userId: ANNA, muted: true, canSpeak: true, audioSource: "microphone" },
      ],
    },
    devices: { input: null, output: HEADSET },
    journal: voiceJoinSettled(
      voiceJoinStageBegan(VOICE_JOIN_JOURNAL_EMPTY, "microphone", T0),
      T0 + 900,
    ),
    transport: transport(),
    health: health(),
    samples: [sample({ at: T0 + 18_000 }), sample({ at: T0 + 19_000 })],
    ...over,
  };
}

/* ── Does it answer the question it exists for ─────────────────────────────── */

test("the fifteen-second failure is legible in the first three lines", () => {
  const text = buildVoiceReport(
    input({
      call: {
        ...input().call,
        phase: "failed",
        refusal: "Сигнал есть, медиасоединение не устанавливается.",
        participants: [],
      },
      journal: theFifteenSecondJoin(),
      // A join that never connected has no transport to ask and no readings to
      // hold. That is the real shape of this failure and the report has to be
      // useful anyway — which is the whole reason the timeline is in it.
      transport: null,
      health: null,
      samples: [],
    }),
  );

  assert.match(text, /Подключение не удалось на шаге «Медиасоединение»\./);
  assert.match(text, /Длительность попытки: 16\.52 с/);
  // The two lines that took an evening, an SSH session and a read of the media
  // server's logs to establish.
  assert.match(text, /Связь с сервером\s+0\.18 с\s+готово/);
  assert.match(text, /Медиасоединение\s+15\.01 с\s+← оборвалось/);
  // The step that was never reached is absent rather than reported as zero.
  assert.doesNotMatch(text, /Микрофон в эфир/);
});

test("a running call reports both directions, the node, and the two playout counters", () => {
  const text = buildVoiceReport(input());
  assert.match(text, /Регион: finland/);
  assert.match(text, /Узел: 14135/);
  assert.match(text, /Версия сервера: 1\.9\.2/);
  assert.match(text, /Исходящие пакеты: 4200, потеряно 0/);
  assert.match(text, /Входящие пакеты: 4050, потеряно 0/);
  // The discriminator between «packets arrive» and «a person hears», and the
  // counter that is information rather than a fault. Both were asked for by
  // name, and both are printed under their WebRTC names so that a reader can
  // look them up.
  assert.match(text, /totalSamplesReceived: 96480/);
  assert.match(text, /totalAudioEnergy: 2\.01/);
  assert.match(text, /Элементов с чужим звуком: 1, играет 1/);
  assert.match(text, /ICE-пара сейчас: srflx\/srflx/);
  assert.match(text, /ICE-пара выбиралась хоть раз: да/);
});

test("a call that is silent because nothing plays it says so in three places", () => {
  // The state this product shipped for six days: a perfect link, a subscribed
  // track, and no audio element anywhere.
  const text = buildVoiceReport(
    input({
      transport: transport({ audioElements: 0, audioElementsPlaying: 0 }),
      health: health({
        verdict: "unheard",
        inbound: { ...health().inbound, reading: "unheard" },
      }),
      samples: [sample({ at: T0 + 18_000, samplesPlayed: 0, audioEnergy: 0 })],
    }),
  );
  assert.match(text, /Звук приходит и не воспроизводится в этом клиенте\./);
  assert.match(text, /Состояние: приходит, но не воспроизводится/);
  assert.match(text, /totalSamplesReceived: 0/);
  assert.match(text, /Элементов с чужим звуком: 0, играет 0/);
});

test("nothing measured prints a dash, never a confident zero", () => {
  // The rule the whole of `lib/voiceConnectionHealth.ts` is built on, carried
  // into the report: a missing counter is «I cannot say», and a zero there
  // reads as a perfect connection at exactly the moment there is none.
  const text = buildVoiceReport(
    input({
      transport: null,
      health: null,
      samples: [],
      journal: VOICE_JOIN_JOURNAL_EMPTY,
    }),
  );
  assert.match(text, /Измерений: 0/);
  assert.match(text, /Задержка: последняя —, средняя —/);
  assert.match(text, /Потеря исходящих: —/);
  assert.match(text, /ICE-пара выбиралась хоть раз: —/);
  assert.match(text, /Попытка подключения не записана\./);
  assert.doesNotMatch(text, /: 0 мс/);
});

test("«a pair was ever selected» is three answers, not two", () => {
  assert.equal(voiceCandidatePairEverSelected([]), null);
  assert.equal(
    voiceCandidatePairEverSelected([sample({ at: T0, candidatePair: null })]),
    false,
  );
  // One reading out of several is enough, **in either order**, and the second
  // ordering is the one that makes this «ever» rather than «now»: a connection
  // that selected a pair and then lost it is a different fault from one that
  // never selected one at all. The first version of this case put the pair in
  // the *last* reading, where a version answering about the latest sample gives
  // the same answer — measured, and green.
  assert.equal(
    voiceCandidatePairEverSelected([
      sample({ at: T0, candidatePair: null }),
      sample({ at: T0 + 1_000 }),
    ]),
    true,
  );
  assert.equal(
    voiceCandidatePairEverSelected([
      sample({ at: T0 }),
      sample({ at: T0 + 1_000, candidatePair: null }),
    ]),
    true,
    "a pair that was selected and then lost is reported as never selected",
  );

  // **A transport that does not report the field at all answers `false`, not
  // `true`.** Found by reading a real report rather than by reasoning: the e2e
  // stand-in omitted the two ICE fields, so they arrived as `undefined`,
  // `undefined !== null` passed, and the file printed «выбиралась хоть
  // раз: да» directly under «сейчас: —». The cast is the point of the
  // case: this is the shape a transport gives, and the type saying it cannot
  // is exactly why nobody had looked.
  const missing = { ...sample({ at: T0 }) } as Record<string, unknown>;
  delete missing.candidatePair;
  assert.equal(
    voiceCandidatePairEverSelected([missing as unknown as VoiceHealthSample]),
    false,
    "a field the transport never reported is being read as a pair that was selected",
  );
});

test("two decimals, because 15.0 and 14.6 are the measurement", () => {
  assert.equal(voiceReportSeconds(15_010), "15.01 с");
  assert.equal(voiceReportSeconds(14_600), "14.60 с");
  assert.equal(voiceReportSeconds(0), "0.00 с");
});

/* ── Privacy, which is the constraint rather than a preference ─────────────── */

test("no account identifier survives into the file", () => {
  const text = buildVoiceReport(input());
  for (const identifier of [ME, ANNA, HEADSET]) {
    assert.equal(
      text.includes(identifier),
      false,
      `the report carries ${identifier} verbatim`,
    );
  }
  // And the salt itself is not in it, which is what makes the hashes above
  // irreversible: with it, anybody holding a list of user ids could recompute
  // every one of them in a second.
  assert.equal(text.includes(SALT), false, "the salt is printed, so every hash is reversible");
});

test("a person's name never reaches the report, because it is not in its input", () => {
  // The guarantee is structural rather than a filter: `VoiceReportInput` has no
  // field that can carry a name, so there is nothing to strip and nothing to
  // forget to strip. This test is what fails if a `name` is ever added to the
  // participant shape — which is the change that would break the promise.
  const shape = Object.keys(input().call.participants[0]).sort();
  assert.deepEqual(shape, ["audioSource", "canSpeak", "muted", "userId"]);
  const text = buildVoiceReport(input());
  assert.doesNotMatch(text, /Анна|Максим|@|\+7/);
});

test("the same person is one hash throughout a report, and a different one in the next", () => {
  const twice = buildVoiceReport(
    input({
      call: {
        ...input().call,
        participants: [
          { userId: ANNA, muted: true, canSpeak: true, audioSource: "microphone" },
          { userId: ANNA, muted: false, canSpeak: null, audioSource: null },
        ],
      },
    }),
  );
  const seen = [...twice.matchAll(/^([0-9a-z]{12})\s+микрофон/gm)].map((m) => m[1]);
  assert.equal(seen.length, 2);
  // Stable inside one report: two lines about one person can be matched, which
  // is the point of hashing rather than dropping.
  assert.equal(seen[0], seen[1]);

  // And useless outside it. Two reports of the same room, made a second apart,
  // must not be joinable on a participant — otherwise the hash is a stable
  // pseudonym rather than a redaction.
  const other = buildVoiceReport(input({ salt: "a-different-salt-entirely" }));
  assert.equal(other.includes(seen[0]), false, "the hashes line up across two reports");
});

test("the room is kept verbatim, because it is the join key with the server's log", () => {
  const text = buildVoiceReport(input());
  // The one exception in the file, argued at the head of the module: it names a
  // room rather than a person, it grants nothing, and without it the report
  // cannot be lined up with the media server's own log — which is the job.
  assert.match(text, /Комната: vc_33333333-3333-4333-8333-000000000001/);
  assert.match(text, /Канал: 33333333-3333-4333-8333-000000000001/);
});

test("a device the person chose is hashed; the system default is not a hash at all", () => {
  const text = buildVoiceReport(input());
  assert.match(text, /Вход: по умолчанию/);
  assert.doesNotMatch(text, /Выход: по умолчанию/);
  // A hash of the literal string «default» would be one identifier shared by
  // everybody who never chose a device — the one value in the file that really
  // would line up across reports, and a line that reads as a choice where none
  // was made.
  assert.equal(text.includes(voiceReportHash(SALT, "default")), false);
});

test("the file says what it has done to itself, for the person forwarding it", () => {
  const text = buildVoiceReport(input());
  assert.match(text, /Идентификаторы участников и устройств заменены хешами/);
  assert.match(text, /Имён, сообщений, телефонов и почты здесь нет\./);
});

test("both halves of the hash are doing work, so two people cannot share a line", () => {
  // A room holds ten people and a report in which two of them share a line
  // misleads rather than merely losing information. The hash is two FNV-1a
  // passes with different offsets, about 64 bits; one pass would be 32.
  //
  // **A birthday test cannot prove that here, and this is what one measures
  // instead.** Hashing 300 000 sequential ids under a single-pass variant
  // produced 300 000 distinct answers — FNV over strings that differ in their
  // last characters separates them better than chance, so the collision a
  // birthday argument predicts simply does not arrive. The two ids below were
  // found by searching 64 915 random UUIDs for a pair sharing its **first**
  // pass, which is the birthday expectation over 2^32.
  //
  // So the assertion is in two parts and the first is the guard against the
  // second passing vacuously: they must still share the six characters the
  // first pass produces — if the offset basis ever changes, this pair is no
  // longer a first-pass collision and the test says so rather than going quietly
  // green — and they must nevertheless hash differently, which only the second
  // pass can bring about.
  const A = "bb589db8-2a79-4cd7-8d6a-32486d104659";
  const B = "d2b10997-cf74-44be-89be-380cf3972eb5";
  const a = voiceReportHash(SALT, A);
  const b = voiceReportHash(SALT, B);
  assert.equal(
    a.slice(0, 6),
    b.slice(0, 6),
    "this pair no longer collides in the first pass, so the assertion below proves nothing — " +
      "search for a new pair before trusting it",
  );
  assert.notEqual(a, b, "the second pass contributes nothing, so the hash is 32 bits wide");

  // Deterministic for one salt, which is what «stable within one report» means,
  // and one fixed width, so the participant column lines up.
  assert.equal(voiceReportHash(SALT, ME), voiceReportHash(SALT, ME));
  assert.equal(voiceReportHash(SALT, ME).length, 12);
  assert.match(voiceReportHash(SALT, ME), /^[0-9a-z]{12}$/);

  // And the case the product actually has: a full room, every line its own.
  const room = new Set(
    Array.from({ length: 10 }, (_, index) =>
      voiceReportHash(SALT, `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`),
    ),
  );
  assert.equal(room.size, 10);
});
