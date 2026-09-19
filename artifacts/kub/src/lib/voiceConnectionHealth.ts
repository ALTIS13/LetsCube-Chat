/**
 * What the voice connection is doing, as a panel can show it.
 *
 * Asked for by the owner on 2026-09-18 with a screenshot of Discord's: a
 * latency graph over the last few minutes, the average and the latest round
 * trip, outbound packet loss as a percentage, and two sentences saying what the
 * numbers mean. This module is the arithmetic; nothing here draws or samples.
 *
 * Pure — no React, no browser API, no `@/` import — so `node --test` reads it.
 *
 * ## Three decisions that are easy to get wrong, and are the reason this is a
 * module rather than four lines inside a component
 *
 * **1. Loss is a rate over a window, never a lifetime total.** WebRTC's
 * `packetsLost` and `packetsSent` are cumulative counters for the whole
 * connection. A call that lost thirty per cent for ten seconds and was then
 * clean for an hour reports about 0.1% lifetime — and 0.1% is exactly the
 * wrong thing to show somebody who opened the panel *because their voice just
 * broke up*. So loss is computed between consecutive samples and averaged over
 * a short window.
 *
 * **2. A missing sample is a gap, not a zero.** `getStats()` can fail, a
 * metric can be absent before the first RTCP report arrives, and a connection
 * can be re-establishing. Recording 0ms then draws a graph touching the floor,
 * which reads as a perfect connection at exactly the moment there is none.
 * Samples carry `null` and the series keeps the hole.
 *
 * **3. The thresholds are Discord's, on purpose.** 250ms before audio is
 * described as lagging, 10% outbound loss before a voice is described as
 * distorting. They are the numbers in the owner's own screenshot, they are
 * defensible for interactive audio, and inventing our own would mean
 * explaining why ours differ.
 *
 * **4. Incoming is its own axis, and it is the one people open this for.**
 * Added 2026-09-19, after the owner sat in a voice channel hearing nothing
 * while this panel said «19 мс, 0.0%, связь стабильна». Every number it had
 * was outbound — round trip to the server and the loss the server reports on
 * **our** stream — so a call in which nothing whatever was arriving looked
 * perfect, and the panel opened to diagnose silence was structurally unable to
 * see it. Outbound cannot stand in for inbound, and an unlabelled number is
 * read as «the connection», so both directions are measured and both are named
 * on screen.
 *
 * **5. «Packets arrive» and «a person hears» are different questions, and only
 * one of them was the bug.** Measured in Chrome on 2026-09-19 against a
 * loopback `RTCPeerConnection`, two seconds per row:
 *
 * | sender | attached to an element | packets | samples | energy |
 * |--------|------------------------|---------|---------|--------|
 * | loud   | no                     | 100     | **0**   | 0      |
 * | loud   | yes                    | 101     | 96480   | 2.01   |
 * | silent | yes                    | 100     | 96480   | **0**  |
 *
 * `totalSamplesReceived` is the discriminator: it advances only when something
 * is playing the track out, and it advances just the same for somebody sitting
 * quietly — so it catches the defect this product shipped without accusing a
 * silent participant of anything. `totalAudioEnergy` does **not** discriminate:
 * it is zero for silence, so it is carried as information and never as a fault.
 * Row one is the exact signature of the six days nobody could hear anybody.
 */

/** One reading, as a sampler produces it. `null` means «not available». */
export interface VoiceHealthSample {
  /** `Date.now()` when the reading was taken. */
  readonly at: number;
  /** Round trip to the media server, milliseconds. */
  readonly rttMs: number | null;
  /** Jitter, milliseconds. Shown by the connection test rather than the graph. */
  readonly jitterMs: number | null;
  /** Cumulative outbound packets, as WebRTC counts them. */
  readonly packetsSent: number | null;
  /** Cumulative outbound packets lost, as WebRTC counts them. */
  readonly packetsLost: number | null;

  /* ── What arrives, summed across every remote voice in the room ─────────── */

  /** Cumulative inbound packets. `null` when nothing could be read. */
  readonly packetsReceived: number | null;
  /** Cumulative inbound packets lost, as the receiver counts them. */
  readonly inboundLost: number | null;
  /**
   * Inbound jitter, milliseconds — the receiver's own, not the server's, and
   * **the worst voice in the room rather than an average or the last one**.
   *
   * One number stands for several senders, so it has to say which: a reader
   * notices the person who is breaking up, and an average would hide them
   * behind everybody who is fine.
   */
  readonly inboundJitterMs: number | null;
  /**
   * Cumulative audio samples played out of the receivers.
   *
   * The one reading that separates «the packets are arriving» from «somebody
   * is hearing them»: it advances only while something is playing the track,
   * and it advances for silence too. See decision 5 in the header for the
   * measurement. `null` in a browser that does not report it, which must read
   * as «unknown» and never as «nothing is playing».
   */
  readonly samplesPlayed: number | null;
  /**
   * Cumulative audio energy received. Information, never a fault: it is zero
   * for a participant who is simply not talking.
   */
  readonly audioEnergy: number | null;
  /**
   * How many remote voices this reading covers. Zero means nobody else is
   * publishing, which is a room state and not a failure.
   */
  readonly remoteAudioTracks: number | null;
}

/** How the connection is doing, in the terms the panel explains. */
export type VoiceHealthVerdict =
  /** Nothing measured yet, or nothing measurable. */
  | "unknown"
  /** Within both thresholds. */
  | "good"
  /** At or over 250ms: the far end hears you late. */
  | "lagging"
  /** Over 10% outbound loss: your voice arrives broken. */
  | "distorting"
  /**
   * Somebody is publishing and nothing is arriving.
   *
   * Beats every outbound answer below it, and the precedence is the whole
   * point of adding it: on 2026-09-19 the owner read «Связь стабильна» off a
   * verdict computed from outbound numbers alone while hearing nothing at all.
   * A call you cannot hear is not a stable connection however good the numbers
   * in the other direction are.
   */
  | "not_receiving"
  /** It arrives, and nothing in this client is playing it. */
  | "unheard";

export interface VoiceHealth {
  readonly verdict: VoiceHealthVerdict;
  /** Mean round trip across the samples that had one, or null. */
  readonly averageRttMs: number | null;
  /** The most recent round trip, or null when the latest reading had none. */
  readonly lastRttMs: number | null;
  /** Outbound loss over the recent window, 0–100, or null when unmeasured. */
  readonly outboundLossPercent: number | null;
  /** The most recent jitter, or null. */
  readonly lastJitterMs: number | null;
  /** How many readings the numbers above are made of. */
  readonly sampleCount: number;
  /**
   * The incoming half, as its own object rather than as four more fields.
   *
   * Separate because the two directions are separate questions and the panel
   * has to label them as such: a flat bag of numbers is what let «Потеря
   * исходящих пакетов» sit on screen being honest and still be read as «the
   * connection is fine».
   */
  readonly inbound: VoiceInbound;
}

/** The two numbers the panel's sentences quote. Discord's, deliberately. */
export const VOICE_HEALTH_THRESHOLDS = {
  /** At or above this round trip, audio is described as lagging. */
  laggingRttMs: 250,
  /** Above this outbound loss, a voice is described as distorting. */
  distortingLossPercent: 10,
} as const;

/**
 * How much history the graph holds.
 *
 * Four minutes at one reading a second, which is the span the owner's
 * screenshot covers — its axis runs from about 03:48 to 03:52. Long enough to
 * show that a problem started, short enough that a spike ten minutes ago is not
 * still on screen when somebody looks.
 */
export const VOICE_HEALTH_WINDOW_MS = 4 * 60 * 1000;

/**
 * How much history the loss percentage is made of.
 *
 * Shorter than the graph's, because loss is the number somebody reads to answer
 * «is it broken right now». Fifteen seconds is long enough that one dropped
 * packet is not 100%, and short enough to move while they watch.
 */
export const VOICE_LOSS_WINDOW_MS = 15 * 1000;

/** Keep only what the window covers, oldest first. */
export function trimVoiceSamples(
  samples: readonly VoiceHealthSample[],
  now: number,
  windowMs: number = VOICE_HEALTH_WINDOW_MS,
): VoiceHealthSample[] {
  const floor = now - windowMs;
  return samples.filter((sample) => sample.at >= floor);
}

/**
 * Outbound loss between two readings, as a percentage of what was sent between
 * them.
 *
 * Returns null rather than zero when it cannot be computed, and that covers
 * more cases than it looks: a counter that went backwards (the connection was
 * re-established and WebRTC started counting again), no packets sent at all
 * between the two readings (nobody was speaking, so there is nothing to lose),
 * and either reading missing a counter.
 */
export function lossBetween(
  earlier: VoiceHealthSample,
  later: VoiceHealthSample,
): number | null {
  if (
    earlier.packetsSent === null ||
    later.packetsSent === null ||
    earlier.packetsLost === null ||
    later.packetsLost === null
  ) {
    return null;
  }
  const sent = later.packetsSent - earlier.packetsSent;
  const lost = later.packetsLost - earlier.packetsLost;
  // A counter that fell is a new connection, not a negative loss.
  if (sent <= 0 || lost < 0) return null;
  // More lost than sent cannot happen on one connection, and does happen across
  // a reconnection the counters did not announce. Clamped rather than trusted.
  return Math.min(100, (lost / sent) * 100);
}

/**
 * Inbound loss between two readings, as a percentage of what was expected.
 *
 * The mirror of `lossBetween` and not a copy of it: the denominator here is
 * received **plus** lost, because a receiver counts what turned up and what it
 * knows went missing, where a sender counts what it put on the wire. Same three
 * refusals — a counter that went backwards is a new connection, nothing
 * expected in the interval is nothing to lose, and a missing counter is
 * unknown rather than zero.
 */
export function inboundLossBetween(
  earlier: VoiceHealthSample,
  later: VoiceHealthSample,
): number | null {
  if (
    earlier.packetsReceived === null ||
    later.packetsReceived === null ||
    earlier.inboundLost === null ||
    later.inboundLost === null
  ) {
    return null;
  }
  const arrived = later.packetsReceived - earlier.packetsReceived;
  const lost = later.inboundLost - earlier.inboundLost;
  if (arrived < 0 || lost < 0) return null;
  const expected = arrived + lost;
  if (expected <= 0) return null;
  return Math.min(100, (lost / expected) * 100);
}

/**
 * How far a cumulative counter moved between two readings, or null.
 *
 * `null` for either end missing, and `null` for a counter that went backwards —
 * which is a re-established connection rather than a negative quantity. Both
 * are «I cannot say», and the callers below must not read either as a zero:
 * the whole point of this axis is that «zero arrived» is an alarm, so anything
 * that is not a measurement has to be kept apart from it.
 */
function movedBy(
  earlier: VoiceHealthSample,
  later: VoiceHealthSample,
  read: (sample: VoiceHealthSample) => number | null,
): number | null {
  const from = read(earlier);
  const to = read(later);
  if (from === null || to === null) return null;
  const moved = to - from;
  return moved < 0 ? null : moved;
}

/**
 * How long a stretch of readings the inbound answer is made of.
 *
 * Five seconds rather than the loss window's fifteen. This answers «is anything
 * arriving **right now**», which somebody reads while watching, and fifteen
 * seconds of history would go on saying «receiving» for a quarter of a minute
 * after a room went silent. Short enough to move, long enough that one missed
 * sample is not an alarm.
 */
export const VOICE_INBOUND_WINDOW_MS = 5 * 1000;

/**
 * What the incoming half of the call is doing.
 *
 * `unknown` and `idle` are deliberately not the same answer and neither is a
 * fault. `idle` is «nobody else is publishing», which is the ordinary state of
 * a room somebody is first into; `unknown` is «this browser did not tell me»,
 * which is where a missing counter has to land so that it cannot be read as
 * silence.
 */
export type VoiceInboundReading =
  /** Not measured yet, or not measurable in this browser. */
  | "unknown"
  /** Nobody else is publishing. Nothing to receive, and nothing wrong. */
  | "idle"
  /** Packets are arriving and something is playing them. */
  | "receiving"
  /** Somebody is publishing and nothing is arriving. */
  | "starved"
  /**
   * Packets are arriving and nothing is playing them out.
   *
   * The state this product was in for six days: a healthy link, a subscribed
   * track, and no audio element anywhere. It is worth its own answer because
   * the two have opposite fixes — one is the network, one is this client.
   */
  | "unheard";

export interface VoiceInbound {
  readonly reading: VoiceInboundReading;
  /** Inbound loss over the recent window, 0-100, or null when unmeasured. */
  readonly lossPercent: number | null;
  /**
   * The most recent inbound jitter that was reported — **of the worst voice in
   * the room**, as `sampleHealth` sums it — or null.
   *
   * `null` also when the reading is one this number would misrepresent; see
   * `voiceInboundJitterStands`.
   */
  readonly lastJitterMs: number | null;
  /** Packets arriving per second over the window, or null. */
  readonly packetsPerSecond: number | null;
  /**
   * Whether any voice has actually carried sound recently.
   *
   * Information for a reader, never a fault: `false` is what a room of people
   * saying nothing looks like. `null` when the browser does not report energy.
   */
  readonly carryingSound: boolean | null;
  /** How many remote voices the reading covers, or null when unknown. */
  readonly remoteAudioTracks: number | null;
}

/**
 * Whether a jitter reading is a measurement of **now**.
 *
 * `inbound-rtp.jitter` is a cumulative estimate that is simply left at its last
 * value when packets stop: measured in Chrome on 2026-09-19 by stopping the
 * sender and reading the receiver four seconds later — zero packets moved and
 * the jitter was still reported, still 0.001, byte-identical to the reading
 * before the stop. Printed beside «Ничего не приходит» that is a stale number
 * dressed as a live one, and a reader would reasonably conclude that something
 * is arriving, smoothly.
 *
 * It is the objection this module already accepts twice: inbound loss shows a
 * dash because nothing was expected, and the latency graph breaks its line at
 * a gap rather than bridging it, because bridging «invents a measurement
 * across the exact moment the connection was failing».
 *
 * **`unheard` keeps its number, and that is not an oversight.** Jitter is
 * computed by the RTP stack from packet arrival times and owes nothing to
 * playout: in the same measurement, a stream with packets arriving and
 * `totalSamplesReceived` stuck at 0 still reported `jitter` — the field was
 * present and being maintained. There the packets really are arriving and
 * really are being timed; it is only the playing-out that is not happening, so
 * the number is honest and the row above it says what is wrong.
 *
 * `idle` dashes for the same reason as `starved`: whatever is left in the
 * window belongs to somebody who has since gone.
 */
export function voiceInboundJitterStands(reading: VoiceInboundReading): boolean {
  return reading !== "starved" && reading !== "idle";
}

const UNKNOWN_INBOUND: VoiceInbound = {
  reading: "unknown",
  lossPercent: null,
  lastJitterMs: null,
  packetsPerSecond: null,
  carryingSound: null,
  remoteAudioTracks: null,
};

/**
 * The incoming half, read from the samples held.
 *
 * Two readings are the minimum: every quantity here is a movement between
 * counters, and one cumulative number says nothing about whether it is moving.
 */
export function voiceInboundOf(
  samples: readonly VoiceHealthSample[],
  now: number,
): VoiceInbound {
  const held = trimVoiceSamples(samples, now, VOICE_INBOUND_WINDOW_MS);
  if (held.length === 0) return UNKNOWN_INBOUND;

  const latest = held[held.length - 1];
  const tracks = latest.remoteAudioTracks;
  const lastJitterMs =
    [...held].reverse().find((s) => typeof s.inboundJitterMs === "number")?.inboundJitterMs ?? null;

  // Nobody else is publishing. Said before anything is computed, because every
  // counter below is legitimately still in a room with one person in it.
  if (tracks === 0) {
    return { ...UNKNOWN_INBOUND, reading: "idle", remoteAudioTracks: 0 };
  }
  if (held.length < 2) {
    return { ...UNKNOWN_INBOUND, lastJitterMs, remoteAudioTracks: tracks };
  }

  const first = held[0];
  const arrived = movedBy(first, latest, (s) => s.packetsReceived);
  const played = movedBy(first, latest, (s) => s.samplesPlayed);
  const energy = movedBy(first, latest, (s) => s.audioEnergy);
  const seconds = (latest.at - first.at) / 1000;

  const rates: number[] = [];
  for (let index = 1; index < held.length; index += 1) {
    const rate = inboundLossBetween(held[index - 1], held[index]);
    if (rate !== null) rates.push(rate);
  }
  const lossPercent =
    rates.length > 0 ? roundLoss(rates.reduce((sum, value) => sum + value, 0) / rates.length) : null;
  const packetsPerSecond =
    arrived !== null && seconds > 0 ? Math.round(arrived / seconds) : null;
  const carryingSound = energy === null ? null : energy > 0;

  const common = {
    lossPercent,
    lastJitterMs,
    packetsPerSecond,
    carryingSound,
    remoteAudioTracks: tracks,
  };

  // A counter this browser does not report is «I cannot say», and must not be
  // drawn as an alarm — the rule `lossBetween` follows one function up.
  if (arrived === null) return { ...common, reading: "unknown" };
  // **Before the playout check, and the order is load-bearing.** A starved
  // stream goes on producing samples: measured on 2026-09-19, four seconds
  // after the sender stopped, `packetsReceived` had not moved and
  // `totalSamplesReceived` had risen by 192 000 — NetEq concealing the gap for
  // the element that is still pulling from it. So «samples are moving» does
  // not mean «packets are arriving», and asking about playout first would read
  // a dead stream as a healthy one.
  if (arrived === 0) return { ...common, reading: "starved", lastJitterMs: null };
  // Packets are arriving. Whether anybody is hearing them is a second question
  // and `samplesPlayed` is the only counter that answers it; absent, the honest
  // answer is that they are arriving, not that they are lost.
  if (played === 0) return { ...common, reading: "unheard" };
  return { ...common, reading: "receiving" };
}

/**
 * Round to one decimal place, the way the panel prints it.
 *
 * Its own function because «0.0%» and «0%» are different sentences: the first
 * says somebody measured, the second reads like a default.
 */
export function roundLoss(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The numbers, from the samples held. */
export function voiceHealthOf(
  samples: readonly VoiceHealthSample[],
  now: number,
): VoiceHealth {
  const held = trimVoiceSamples(samples, now);
  if (held.length === 0) {
    return {
      verdict: "unknown",
      averageRttMs: null,
      lastRttMs: null,
      outboundLossPercent: null,
      lastJitterMs: null,
      sampleCount: 0,
      inbound: voiceInboundOf(held, now),
    };
  }

  const rtts = held
    .map((sample) => sample.rttMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageRttMs =
    rtts.length > 0 ? Math.round(rtts.reduce((sum, value) => sum + value, 0) / rtts.length) : null;

  // The latest reading that HAD one, not the latest reading. A panel that
  // blanks its «last» field every time one sample misses looks broken.
  const lastRttMs =
    [...held].reverse().find((sample) => typeof sample.rttMs === "number")?.rttMs ?? null;
  const lastJitterMs =
    [...held].reverse().find((sample) => typeof sample.jitterMs === "number")?.jitterMs ?? null;

  const recent = trimVoiceSamples(held, now, VOICE_LOSS_WINDOW_MS);
  const rates: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    const rate = lossBetween(recent[index - 1], recent[index]);
    if (rate !== null) rates.push(rate);
  }
  const outboundLossPercent =
    rates.length > 0
      ? roundLoss(rates.reduce((sum, value) => sum + value, 0) / rates.length)
      : null;

  const inbound = voiceInboundOf(held, now);

  let verdict: VoiceHealthVerdict = "unknown";
  if (averageRttMs !== null || outboundLossPercent !== null) {
    verdict = "good";
    // Loss is checked first and wins, because a voice that arrives broken is a
    // worse thing to be told about than a voice that arrives late — and a bad
    // connection usually has both.
    if (
      outboundLossPercent !== null &&
      outboundLossPercent > VOICE_HEALTH_THRESHOLDS.distortingLossPercent
    ) {
      verdict = "distorting";
    } else if (
      averageRttMs !== null &&
      averageRttMs >= VOICE_HEALTH_THRESHOLDS.laggingRttMs
    ) {
      verdict = "lagging";
    }
  }

  // **Inbound wins over every outbound answer, including «good».** This is the
  // line that would have answered the owner on 2026-09-19: the outbound
  // numbers were genuinely perfect — 19 ms, 0.0% — and he could not hear a
  // word, and the panel agreed with the numbers rather than with him. The two
  // inbound faults are not degradations of a working call; they are the call
  // not happening, and a verdict is one sentence, so they take it.
  //
  // `idle`, `receiving` and `unknown` change nothing: nobody publishing is not
  // a fault, a working stream is not news, and a browser that cannot answer
  // must not be drawn as a failure.
  if (inbound.reading === "starved") verdict = "not_receiving";
  else if (inbound.reading === "unheard") verdict = "unheard";

  return {
    verdict,
    averageRttMs,
    lastRttMs,
    outboundLossPercent,
    lastJitterMs,
    sampleCount: held.length,
    inbound,
  };
}

/** What the graph is drawn against: a floor, and whatever the data needs. */
export interface VoiceHealthScale {
  readonly maxMs: number;
  /** The points, `null` where a reading had no round trip. */
  readonly points: readonly (number | null)[];
}

/**
 * The series and its ceiling.
 *
 * A fixed ceiling would flatten a good connection into a line on the floor; a
 * ceiling that is exactly the maximum would put the worst spike on the frame's
 * edge where it cannot be seen. So: the highest reading rounded up to a round
 * number, never below `floorMs`. The owner's screenshot shows 50 as its
 * ceiling on a connection whose worst reading is just under it.
 */
export function voiceHealthScale(
  samples: readonly VoiceHealthSample[],
  now: number,
  floorMs = 50,
): VoiceHealthScale {
  const held = trimVoiceSamples(samples, now);
  const points = held.map((sample) =>
    typeof sample.rttMs === "number" && Number.isFinite(sample.rttMs) ? sample.rttMs : null,
  );
  const highest = points.reduce<number>(
    (top, value) => (value !== null && value > top ? value : top),
    0,
  );
  if (highest <= floorMs) return { maxMs: floorMs, points };
  // To the next 50 above the peak, so the line has room rather than touching
  // the top edge.
  return { maxMs: Math.ceil((highest + 1) / 50) * 50, points };
}

/**
 * The sentence under the numbers.
 *
 * Kept here rather than in the component because it quotes the thresholds, and
 * a sentence that names 250 while the constant says 300 is the defect this
 * whole module is shaped to avoid.
 */
export function voiceHealthAdvice(verdict: VoiceHealthVerdict): string {
  switch (verdict) {
    case "unknown":
      return "Измеряем соединение…";
    case "good":
      return "Соединение в порядке.";
    case "lagging":
      return `При задержке ${VOICE_HEALTH_THRESHOLDS.laggingRttMs} мс и больше звук может отставать. Если не проходит — отключитесь и подключитесь заново.`;
    case "distorting":
      return `При потере больше ${VOICE_HEALTH_THRESHOLDS.distortingLossPercent}% исходящих пакетов ваш голос может искажаться. Если не проходит — отключитесь и подключитесь заново.`;
    case "not_receiving":
      // Names the direction, because the numbers above it say the outgoing
      // half is fine and a reader needs to be told those two facts are not in
      // conflict. No «проверьте интернет»: the connection to the server is
      // demonstrably working, and sending somebody to their router would be
      // the panel guessing.
      return "Звук собеседников не приходит, хотя связь с сервером есть. Попробуйте выйти и зайти в канал заново.";
    case "unheard":
      // The one fault here whose cause is inside this client rather than on
      // the wire, so the first thing it names is the one thing the reader can
      // actually do about it.
      return "Звук приходит, но не воспроизводится — возможно, браузер заблокировал его. Нажмите «Звук заблокирован — включить» или перезайдите в канал.";
  }
}

/* ── What the panel calls things ──────────────────────────────────────────── */

/**
 * The row labels, here rather than in the component, for the reason
 * `voiceHealthAdvice` is: the panel's failure was never a wrong number, it was
 * a number nobody could tell the direction of. «Потеря исходящих пакетов» was
 * accurate and still misread as «the connection», because nothing beside it
 * said the other direction existed. So the two directions are named as
 * headings, in one place, and a row cannot drift away from its heading.
 */
export const VOICE_HEALTH_OUTGOING_CAPTION = "Исходящий поток";
export const VOICE_HEALTH_INCOMING_CAPTION = "Входящий поток";

/** What the incoming reading says, in the panel's own words. */
export function voiceInboundLabel(reading: VoiceInboundReading): string {
  switch (reading) {
    case "unknown":
      return "Измеряем…";
    case "idle":
      // Not «ничего не приходит»: nobody is sending, which is a fact about the
      // room and not about the connection.
      return "Никто не передаёт";
    case "receiving":
      return "Принимаем";
    case "starved":
      return "Ничего не приходит";
    case "unheard":
      return "Приходит, но не звучит";
  }
}

/** Whether the incoming reading is a fault, for the tone a panel draws it in. */
export function voiceInboundIsFault(reading: VoiceInboundReading): boolean {
  return reading === "starved" || reading === "unheard";
}
