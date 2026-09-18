// The arithmetic behind the voice connection panel.
//
// Asked for by the owner on 2026-09-18 with a screenshot of Discord's: a
// latency graph, the average and latest round trip, outbound packet loss, and
// the two sentences that say what the numbers mean.
//
// Every test here exists because the obvious implementation is wrong in a way
// that looks right on a good connection. That is the trap this panel sets: it
// is read almost exclusively when something is broken, and almost every
// shortcut in it produces reassuring numbers exactly then.

import assert from "node:assert/strict";
import test from "node:test";

import {
  lossBetween,
  roundLoss,
  trimVoiceSamples,
  voiceHealthAdvice,
  voiceHealthOf,
  voiceHealthScale,
  VOICE_HEALTH_THRESHOLDS,
  VOICE_HEALTH_WINDOW_MS,
  VOICE_LOSS_WINDOW_MS,
  type VoiceHealthSample,
} from "../../artifacts/kub/src/lib/voiceConnectionHealth.ts";

const NOW = 1_800_000_000_000;

function sample(over: Partial<VoiceHealthSample> & { at: number }): VoiceHealthSample {
  return {
    at: over.at,
    rttMs: "rttMs" in over ? (over.rttMs ?? null) : 45,
    jitterMs: "jitterMs" in over ? (over.jitterMs ?? null) : 3,
    packetsSent: "packetsSent" in over ? (over.packetsSent ?? null) : 1000,
    packetsLost: "packetsLost" in over ? (over.packetsLost ?? null) : 0,
  };
}

/** A clean run of readings, one a second, ending now. */
function run(count: number, shape: (index: number) => Partial<VoiceHealthSample> = () => ({})) {
  return Array.from({ length: count }, (_unused, index) =>
    sample({ at: NOW - (count - 1 - index) * 1000, ...shape(index) }),
  );
}

// ---------------------------------------------------------------------------
// Loss, which is the number most likely to be computed wrongly
// ---------------------------------------------------------------------------

test("loss is measured between two readings, not as a share of the whole call", () => {
  // The defect this prevents, as arithmetic. An hour of clean audio followed by
  // ten bad seconds: the lifetime figure is a fraction of a per cent, and it is
  // the figure somebody would read at the exact moment their voice broke up.
  const clean = { packetsSent: 180_000, packetsLost: 0 };
  const bad = { packetsSent: 180_500, packetsLost: 150 };
  const lifetime = (bad.packetsLost / bad.packetsSent) * 100;
  assert.ok(lifetime < 0.1, `the lifetime figure is ${lifetime.toFixed(3)}%, which reads as fine`);

  const windowed = lossBetween(
    sample({ at: NOW - 1000, ...clean }),
    sample({ at: NOW, ...bad }),
  );
  assert.equal(windowed, 30, "the window says thirty per cent, which is what is happening");
});

test("a counter that went backwards is a new connection, not a negative loss", () => {
  // WebRTC restarts its counters when the peer connection is replaced, which is
  // what a reconnection is. Subtracting across that produces a large negative
  // and, unclamped, a nonsense percentage.
  const after = lossBetween(
    sample({ at: NOW - 1000, packetsSent: 50_000, packetsLost: 120 }),
    sample({ at: NOW, packetsSent: 40, packetsLost: 0 }),
  );
  assert.equal(after, null);
});

test("nothing sent means nothing lost, and that is not zero per cent", () => {
  // Silence between two readings. Reporting 0% would be a measurement nobody
  // made; the panel has to say «—» rather than «0.0%».
  const silent = lossBetween(
    sample({ at: NOW - 1000, packetsSent: 1000, packetsLost: 7 }),
    sample({ at: NOW, packetsSent: 1000, packetsLost: 7 }),
  );
  assert.equal(silent, null);
});

test("more lost than sent is clamped rather than trusted", () => {
  const impossible = lossBetween(
    sample({ at: NOW - 1000, packetsSent: 1000, packetsLost: 0 }),
    sample({ at: NOW, packetsSent: 1010, packetsLost: 500 }),
  );
  assert.equal(impossible, 100);
});

test("a reading with no counters contributes nothing", () => {
  assert.equal(lossBetween(sample({ at: 1, packetsSent: null }), sample({ at: 2 })), null);
  assert.equal(lossBetween(sample({ at: 1 }), sample({ at: 2, packetsLost: null })), null);
});

test("the percentage is printed to one decimal, so «0.0%» is a measurement", () => {
  // «0%» reads like a default and «0.0%» reads like somebody looked. The
  // owner's screenshot shows the second.
  assert.equal(roundLoss(0), 0);
  assert.equal(roundLoss(0.04), 0);
  assert.equal(roundLoss(0.06), 0.1);
  assert.equal(roundLoss(12.349), 12.3);
});

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

test("the graph holds four minutes and drops what is older", () => {
  const old = sample({ at: NOW - VOICE_HEALTH_WINDOW_MS - 1 });
  const edge = sample({ at: NOW - VOICE_HEALTH_WINDOW_MS });
  const fresh = sample({ at: NOW });
  const kept = trimVoiceSamples([old, edge, fresh], NOW);
  assert.deepEqual(kept.map((entry) => entry.at), [edge.at, fresh.at]);
});

test("loss is read over a shorter window than the graph", () => {
  // Fifteen seconds against four minutes, and the difference is the point: the
  // graph answers «did this start recently», the percentage answers «is it
  // broken right now». A thirty-second burst four minutes ago must not still be
  // in the number.
  assert.ok(VOICE_LOSS_WINDOW_MS < VOICE_HEALTH_WINDOW_MS);

  const samples = [
    // Bad, but long ago.
    sample({ at: NOW - 120_000, packetsSent: 1000, packetsLost: 0 }),
    sample({ at: NOW - 119_000, packetsSent: 1100, packetsLost: 50 }),
    // Clean, and recent.
    sample({ at: NOW - 2000, packetsSent: 5000, packetsLost: 50 }),
    sample({ at: NOW - 1000, packetsSent: 5100, packetsLost: 50 }),
    sample({ at: NOW, packetsSent: 5200, packetsLost: 50 }),
  ];
  const health = voiceHealthOf(samples, NOW);
  assert.equal(health.outboundLossPercent, 0, "an old burst is still being counted");
  // And the graph still holds every reading, because the two windows differ.
  assert.equal(health.sampleCount, 5);
});

// ---------------------------------------------------------------------------
// A missing reading is a hole, never a zero
// ---------------------------------------------------------------------------

test("a reading with no round trip is not a round trip of zero", () => {
  const samples = [
    sample({ at: NOW - 2000, rttMs: 40 }),
    sample({ at: NOW - 1000, rttMs: null }),
    sample({ at: NOW, rttMs: 50 }),
  ];
  const health = voiceHealthOf(samples, NOW);
  // 45, not 30: a zero in the mean would make a failing connection look faster.
  assert.equal(health.averageRttMs, 45);

  const { points } = voiceHealthScale(samples, NOW);
  assert.deepEqual(points, [40, null, 50], "the gap was filled in rather than drawn as a gap");
});

test("«last» is the last reading that had one, not the last reading", () => {
  // A panel whose «Последняя задержка» blanks every time one sample misses
  // looks broken at the moment it is being read for reassurance.
  const health = voiceHealthOf(
    [sample({ at: NOW - 1000, rttMs: 49 }), sample({ at: NOW, rttMs: null })],
    NOW,
  );
  assert.equal(health.lastRttMs, 49);
  assert.equal(health.averageRttMs, 49);
});

test("nothing measured is «unknown», not «good»", () => {
  assert.equal(voiceHealthOf([], NOW).verdict, "unknown");
  assert.equal(voiceHealthOf([], NOW).averageRttMs, null);
  assert.equal(voiceHealthOf([], NOW).outboundLossPercent, null);

  // Readings that carry nothing measurable are the same answer. A connection
  // whose stats are unavailable must not be reported as healthy.
  const blind = voiceHealthOf(
    [
      sample({ at: NOW - 1000, rttMs: null, packetsSent: null, packetsLost: null }),
      sample({ at: NOW, rttMs: null, packetsSent: null, packetsLost: null }),
    ],
    NOW,
  );
  assert.equal(blind.verdict, "unknown");
});

// ---------------------------------------------------------------------------
// The verdict, at the thresholds the owner's screenshot shows
// ---------------------------------------------------------------------------

test("the thresholds are the ones the panel's own sentences quote", () => {
  assert.equal(VOICE_HEALTH_THRESHOLDS.laggingRttMs, 250);
  assert.equal(VOICE_HEALTH_THRESHOLDS.distortingLossPercent, 10);
  // And the sentences quote the constants rather than repeating the numbers,
  // so the two cannot drift. That is not pedantry: a sentence naming 250 beside
  // a check at 300 is a panel that explains a rule it does not apply.
  assert.match(voiceHealthAdvice("lagging"), /250/);
  assert.match(voiceHealthAdvice("distorting"), /10%/);
});

test("latency at the threshold is already lagging, not still fine", () => {
  const at249 = voiceHealthOf(run(3, () => ({ rttMs: 249 })), NOW);
  assert.equal(at249.verdict, "good");
  const at250 = voiceHealthOf(run(3, () => ({ rttMs: 250 })), NOW);
  assert.equal(at250.verdict, "lagging", "«250 мс и больше» has to include 250");
});

test("loss at the threshold is not yet distorting, because the sentence says «больше»", () => {
  const exactly10 = [
    sample({ at: NOW - 1000, packetsSent: 1000, packetsLost: 0 }),
    sample({ at: NOW, packetsSent: 1100, packetsLost: 10 }),
  ];
  assert.equal(voiceHealthOf(exactly10, NOW).outboundLossPercent, 10);
  assert.equal(voiceHealthOf(exactly10, NOW).verdict, "good");

  const over = [
    sample({ at: NOW - 1000, packetsSent: 1000, packetsLost: 0 }),
    sample({ at: NOW, packetsSent: 1100, packetsLost: 11 }),
  ];
  assert.equal(voiceHealthOf(over, NOW).verdict, "distorting");
});

test("loss wins over latency, because a broken voice is worse news than a late one", () => {
  const both = [
    sample({ at: NOW - 1000, rttMs: 400, packetsSent: 1000, packetsLost: 0 }),
    sample({ at: NOW, rttMs: 400, packetsSent: 1100, packetsLost: 40 }),
  ];
  const health = voiceHealthOf(both, NOW);
  assert.equal(health.verdict, "distorting");
  // Both numbers are still reported; only the sentence had to choose.
  assert.equal(health.averageRttMs, 400);
  assert.equal(health.outboundLossPercent, 40);
});

test("every verdict has a sentence, and «good» does not lecture", () => {
  for (const verdict of ["unknown", "good", "lagging", "distorting"] as const) {
    const text = voiceHealthAdvice(verdict);
    assert.ok(text.length > 0, `${verdict} has no sentence`);
  }
  assert.doesNotMatch(
    voiceHealthAdvice("good"),
    /отключитесь/,
    "a working connection is told how to fix itself",
  );
});

// ---------------------------------------------------------------------------
// The graph's scale
// ---------------------------------------------------------------------------

test("a good connection is not flattened onto the floor", () => {
  // Every reading between 40 and 49, as in the owner's screenshot. Against a
  // ceiling taken from the data alone the line would fill the frame and a
  // 9ms wobble would look like a crisis; against a floor of 50 it sits where
  // it belongs.
  const scale = voiceHealthScale(run(20, (index) => ({ rttMs: 40 + (index % 10) })), NOW);
  assert.equal(scale.maxMs, 50);
});

test("a spike raises the ceiling above itself, so the peak is inside the frame", () => {
  const scale = voiceHealthScale(
    [sample({ at: NOW - 1000, rttMs: 45 }), sample({ at: NOW, rttMs: 260 })],
    NOW,
  );
  assert.ok(scale.maxMs > 260, `the peak is on the frame's edge at ${scale.maxMs}`);
  assert.equal(scale.maxMs, 300);
});

test("a reading exactly on a round ceiling still gets room above it", () => {
  const scale = voiceHealthScale([sample({ at: NOW, rttMs: 100 })], NOW);
  assert.ok(scale.maxMs > 100, "a 100ms peak is drawn touching the top edge");
});

test("no readings still produce a drawable frame", () => {
  const scale = voiceHealthScale([], NOW);
  assert.equal(scale.maxMs, 50);
  assert.deepEqual(scale.points, []);
});
