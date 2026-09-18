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
  | "distorting";

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

  return { verdict, averageRttMs, lastRttMs, outboundLossPercent, lastJitterMs, sampleCount: held.length };
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
  }
}
