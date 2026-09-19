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
  inboundLossBetween,
  lossBetween,
  roundLoss,
  trimVoiceSamples,
  voiceHealthAdvice,
  voiceHealthOf,
  voiceHealthScale,
  voiceInboundIsFault,
  voiceInboundJitterStands,
  voiceInboundLabel,
  voiceInboundOf,
  VOICE_HEALTH_THRESHOLDS,
  VOICE_HEALTH_WINDOW_MS,
  VOICE_INBOUND_WINDOW_MS,
  VOICE_LOSS_WINDOW_MS,
  type VoiceHealthSample,
  type VoiceInboundReading,
} from "../../artifacts/kub/src/lib/voiceConnectionHealth.ts";

const NOW = 1_800_000_000_000;

function sample(over: Partial<VoiceHealthSample> & { at: number }): VoiceHealthSample {
  return {
    at: over.at,
    rttMs: "rttMs" in over ? (over.rttMs ?? null) : 45,
    jitterMs: "jitterMs" in over ? (over.jitterMs ?? null) : 3,
    packetsSent: "packetsSent" in over ? (over.packetsSent ?? null) : 1000,
    packetsLost: "packetsLost" in over ? (over.packetsLost ?? null) : 0,
    // The incoming half defaults to a healthy room with one other person in
    // it, so that every case written before this axis existed goes on
    // measuring what it was written to measure. A test about the inbound axis
    // states its own counters.
    //
    // **The defaults advance with `at`,** and that is the whole trick: these
    // are cumulative counters, so a fixed default is a room in which nothing
    // is arriving — which is `starved`, and which turned nine unrelated cases
    // red the first time this helper was written with constants.
    packetsReceived: "packetsReceived" in over ? (over.packetsReceived ?? null) : 1_000_000 + tick(over.at) * 50,
    inboundLost: "inboundLost" in over ? (over.inboundLost ?? null) : 0,
    inboundJitterMs: "inboundJitterMs" in over ? (over.inboundJitterMs ?? null) : 2,
    samplesPlayed: "samplesPlayed" in over ? (over.samplesPlayed ?? null) : 100_000_000 + tick(over.at) * 48_000,
    audioEnergy: "audioEnergy" in over ? (over.audioEnergy ?? null) : 1000 + tick(over.at),
    remoteAudioTracks: "remoteAudioTracks" in over ? (over.remoteAudioTracks ?? null) : 1,
    // The ICE reading, added 2026-09-19 with the exported report. It defaults
    // to a connection that selected a pair, so every case written before this
    // axis existed goes on measuring what it was written to measure — the same
    // reason the inbound counters above carry defaults rather than nulls.
    // Nothing in this module reads them; they are here so the fixture stays a
    // complete `VoiceHealthSample` rather than one with two holes in it.
    candidatePair: "candidatePair" in over ? (over.candidatePair ?? null) : "srflx/srflx",
    candidatePairState:
      "candidatePairState" in over ? (over.candidatePairState ?? null) : "succeeded",
  };
}

/** How many seconds this reading is after `NOW`; negative for older ones. */
function tick(at: number): number {
  return Math.round((at - NOW) / 1000);
}

/**
 * A pair of readings a second apart, for the incoming axis.
 *
 * Two is the minimum that can say anything: every quantity on this axis is a
 * movement between cumulative counters, and one of those is a number with no
 * direction.
 */
function incoming(
  first: Partial<VoiceHealthSample>,
  second: Partial<VoiceHealthSample>,
): VoiceHealthSample[] {
  return [sample({ at: NOW - 1000, ...first }), sample({ at: NOW, ...second })];
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


/* ── The incoming half, which nothing measured until 2026-09-19 ───────────── */

/**
 * Why this section exists, in one paragraph, because it is the most expensive
 * thing this file has ever been written about.
 *
 * On 2026-09-19 the owner sat in a voice channel hearing nothing, opened this
 * panel, and it told him «19 мс, потеря исходящих пакетов 0.0%, связь
 * стабильна». Every one of those was true. All three were about what he was
 * sending. Nothing in the product measured what was arriving, so the panel
 * people open *because* audio is missing was structurally unable to see audio
 * missing — and it did not merely fail to answer, it actively reassured.
 *
 * The discriminator below is `samplesPlayed`, and it was measured rather than
 * reasoned about (Chrome, loopback `RTCPeerConnection`, two seconds a row):
 * a loud sender with nothing attached moves 100 packets and **0** samples; the
 * same sender attached moves 101 packets and 96480 samples; a **silent**
 * sender attached moves 100 packets and 96480 samples. So samples tell «is
 * anybody playing this» apart from «is anybody talking», which is the
 * distinction every naive version of this feature gets wrong.
 */

test("inbound loss counts against what was expected, not against what arrived", () => {
  // The denominator is the mirror of `lossBetween`'s and not a copy of it: a
  // receiver knows what turned up and what it noticed missing, so the total
  // that was coming is the sum. 10 lost out of 90 that arrived is 10%, not
  // 11.1% — and getting this backwards understates every loss there is.
  const [first, second] = incoming(
    { packetsReceived: 1000, inboundLost: 0 },
    { packetsReceived: 1090, inboundLost: 10 },
  );
  assert.equal(inboundLossBetween(first, second), 10);
});

test("inbound loss refuses the three things it cannot answer", () => {
  const backwards = incoming(
    { packetsReceived: 5000, inboundLost: 3 },
    { packetsReceived: 40, inboundLost: 0 },
  );
  assert.equal(inboundLossBetween(backwards[0], backwards[1]), null, "a reconnect is not a negative loss");

  const nothing = incoming(
    { packetsReceived: 1000, inboundLost: 4 },
    { packetsReceived: 1000, inboundLost: 4 },
  );
  assert.equal(inboundLossBetween(nothing[0], nothing[1]), null, "nothing expected is nothing to lose");

  const missing = incoming({ packetsReceived: null }, {});
  assert.equal(inboundLossBetween(missing[0], missing[1]), null, "a missing counter is unknown, not zero");
});

test("one reading says nothing about the incoming half", () => {
  // A cumulative counter with nothing to compare it to has no direction, and
  // reading it as «nothing is arriving» would put an alarm on screen in the
  // first second of every call.
  const one = voiceInboundOf([sample({ at: NOW, packetsReceived: 0, samplesPlayed: 0 })], NOW);
  assert.equal(one.reading, "unknown");
  assert.equal(voiceInboundIsFault(one.reading), false);
});

test("an empty room is idle, which is not a fault however still the counters are", () => {
  // The state of somebody who is first into a channel. Every counter is flat
  // and nothing is wrong, so this has to be decided before anything is
  // measured — a rule the reading order in `voiceInboundOf` depends on.
  const alone = voiceInboundOf(
    incoming(
      { remoteAudioTracks: 0, packetsReceived: 0, samplesPlayed: 0, audioEnergy: 0 },
      { remoteAudioTracks: 0, packetsReceived: 0, samplesPlayed: 0, audioEnergy: 0 },
    ),
    NOW,
  );
  assert.equal(alone.reading, "idle");
  assert.equal(voiceInboundIsFault("idle"), false);
});

test("packets arriving and samples moving is «receiving»", () => {
  const view = voiceInboundOf(
    incoming(
      { packetsReceived: 1000, samplesPlayed: 48_000 },
      { packetsReceived: 1050, samplesPlayed: 96_000 },
    ),
    NOW,
  );
  assert.equal(view.reading, "receiving");
  assert.equal(view.remoteAudioTracks, 1);
  assert.equal(view.packetsPerSecond, 50);
});

test("somebody publishing and nothing arriving is «starved»", () => {
  const view = voiceInboundOf(
    incoming(
      { remoteAudioTracks: 1, packetsReceived: 1000, samplesPlayed: 48_000 },
      { remoteAudioTracks: 1, packetsReceived: 1000, samplesPlayed: 48_000 },
    ),
    NOW,
  );
  assert.equal(view.reading, "starved");
  assert.equal(voiceInboundIsFault("starved"), true);
});

test("packets arriving with nothing playing them is «unheard» — the 2026-09-19 defect", () => {
  // Measured signature: packets advance, samples do not. This is what six days
  // of voice channels looked like from inside the browser, and it is a
  // different fault from `starved` with a different fix — one is the wire, one
  // is this client — which is why it is a reading of its own.
  const view = voiceInboundOf(
    incoming(
      { packetsReceived: 1000, samplesPlayed: 0, audioEnergy: 0 },
      { packetsReceived: 1100, samplesPlayed: 0, audioEnergy: 0 },
    ),
    NOW,
  );
  assert.equal(view.reading, "unheard");
  assert.equal(voiceInboundIsFault("unheard"), true);
});

test("a quiet participant is receiving, not broken", () => {
  // The false-positive this axis would otherwise invent, and the reason the
  // fault is read off `samplesPlayed` rather than off `audioEnergy`. Measured:
  // a silent sender moves 96480 samples in two seconds and zero energy. A
  // version that alarmed on flat energy would accuse everybody who stops
  // talking of a broken call.
  const view = voiceInboundOf(
    incoming(
      { packetsReceived: 1000, samplesPlayed: 48_000, audioEnergy: 5 },
      { packetsReceived: 1100, samplesPlayed: 96_000, audioEnergy: 5 },
    ),
    NOW,
  );
  assert.equal(view.reading, "receiving");
  assert.equal(view.carryingSound, false, "silence is reported as silence");
  assert.equal(voiceInboundIsFault(view.reading), false);
});

test("a browser that reports no samples is unknown about playback, never «unheard»", () => {
  // Firefox has no `totalSamplesReceived`. A missing counter must not be read
  // as a zero — the rule `lossBetween` follows — or every Firefox call would
  // draw an alarm about a fault that is not happening.
  const view = voiceInboundOf(
    incoming(
      { packetsReceived: 1000, samplesPlayed: null },
      { packetsReceived: 1100, samplesPlayed: null },
    ),
    NOW,
  );
  assert.equal(view.reading, "receiving");
});

test("a missing inbound counter is unknown, never «starved»", () => {
  const view = voiceInboundOf(
    incoming({ packetsReceived: null }, { packetsReceived: null }),
    NOW,
  );
  assert.equal(view.reading, "unknown");
  assert.equal(voiceInboundIsFault(view.reading), false);
});

test("counters that went backwards are a reconnection, not a silence", () => {
  const view = voiceInboundOf(
    incoming({ packetsReceived: 50_000 }, { packetsReceived: 40 }),
    NOW,
  );
  assert.equal(view.reading, "unknown", "a re-established connection read as a fault");
});

test("the incoming window is short, so a room that fell silent says so", () => {
  // Fifteen seconds of history would go on reporting «receiving» for a quarter
  // of a minute after everything stopped, which is most of the time somebody
  // spends looking at this panel.
  assert.ok(VOICE_INBOUND_WINDOW_MS < VOICE_LOSS_WINDOW_MS);
  const stale = [
    sample({ at: NOW - VOICE_INBOUND_WINDOW_MS - 1, packetsReceived: 500 }),
    sample({ at: NOW - 1000, packetsReceived: 1000 }),
    sample({ at: NOW, packetsReceived: 1000 }),
  ];
  assert.equal(voiceInboundOf(stale, NOW).reading, "starved");
});

test("every incoming reading has a word for it, and only the two faults are faults", () => {
  const readings: VoiceInboundReading[] = ["unknown", "idle", "receiving", "starved", "unheard"];
  for (const reading of readings) {
    const label = voiceInboundLabel(reading);
    assert.ok(label.length > 0, `${reading} has no label`);
  }
  assert.deepEqual(
    readings.filter(voiceInboundIsFault),
    ["starved", "unheard"],
    "the set of things drawn as a failure changed",
  );
});

/* ── The verdict has to account for both directions ───────────────────────── */

test("THE 2026-09-19 CASE: perfect outbound and nothing arriving is not «стабильна»", () => {
  // The exact reading the owner had on screen while he could not hear a word:
  // a 19 ms round trip and 0.0% outbound loss. Every outbound number is
  // flawless and the call is not happening. If this ever returns "good" again,
  // the panel has gone back to reassuring people about a call they cannot hear.
  const held = [
    sample({ at: NOW - 1000, rttMs: 19, packetsSent: 1000, packetsLost: 0, packetsReceived: 1000, samplesPlayed: 48_000 }),
    sample({ at: NOW, rttMs: 19, packetsSent: 1050, packetsLost: 0, packetsReceived: 1000, samplesPlayed: 48_000 }),
  ];
  const health = voiceHealthOf(held, NOW);
  assert.equal(health.outboundLossPercent, 0, "the outbound half really is clean");
  assert.equal(health.averageRttMs, 19);
  assert.equal(health.verdict, "not_receiving");
  assert.equal(health.inbound.reading, "starved");
  assert.notEqual(health.verdict, "good");
});

test("perfect outbound and nothing playing it is «unheard»", () => {
  const held = [
    sample({ at: NOW - 1000, rttMs: 17, packetsSent: 1000, packetsLost: 0, packetsReceived: 1000, samplesPlayed: 0 }),
    sample({ at: NOW, rttMs: 17, packetsSent: 1050, packetsLost: 0, packetsReceived: 1100, samplesPlayed: 0 }),
  ];
  const health = voiceHealthOf(held, NOW);
  assert.equal(health.verdict, "unheard");
});

test("an empty room with a clean connection is still «good»", () => {
  // The guard on the guard: an axis that turns every quiet moment into a
  // warning is worse than no axis, because people stop reading warnings.
  const held = [
    sample({ at: NOW - 1000, remoteAudioTracks: 0, packetsReceived: 0, samplesPlayed: 0 }),
    sample({ at: NOW, remoteAudioTracks: 0, packetsReceived: 0, samplesPlayed: 0 }),
  ];
  const health = voiceHealthOf(held, NOW);
  assert.equal(health.inbound.reading, "idle");
  assert.equal(health.verdict, "good");
});

test("an incoming fault outranks an outgoing one, and an outgoing one still lands", () => {
  const outboundBroken = { packetsSent: 1000, packetsLost: 0 };
  const outboundBrokenLater = { packetsSent: 1100, packetsLost: 60 };

  // Outbound broken, inbound fine: the outbound verdict survives, because the
  // new axis must not mask the old one.
  const onlyOut = voiceHealthOf(
    [
      sample({ at: NOW - 1000, ...outboundBroken, packetsReceived: 1000, samplesPlayed: 48_000 }),
      sample({ at: NOW, ...outboundBrokenLater, packetsReceived: 1100, samplesPlayed: 96_000 }),
    ],
    NOW,
  );
  assert.equal(onlyOut.verdict, "distorting");

  // Both broken: the one that means «you cannot hear anybody» wins, because a
  // verdict is one sentence and that is the worse half.
  const both = voiceHealthOf(
    [
      sample({ at: NOW - 1000, ...outboundBroken, packetsReceived: 1000, samplesPlayed: 48_000 }),
      sample({ at: NOW, ...outboundBrokenLater, packetsReceived: 1000, samplesPlayed: 48_000 }),
    ],
    NOW,
  );
  assert.equal(both.verdict, "not_receiving");
});

test("an unknown incoming half leaves the outgoing verdict exactly as it was", () => {
  const held = [
    sample({ at: NOW - 1000, rttMs: 300, packetsReceived: null, samplesPlayed: null }),
    sample({ at: NOW, rttMs: 300, packetsReceived: null, samplesPlayed: null }),
  ];
  const health = voiceHealthOf(held, NOW);
  assert.equal(health.inbound.reading, "unknown");
  assert.equal(health.verdict, "lagging");
});

test("both new verdicts have a sentence, and each names where the fault is", () => {
  const notReceiving = voiceHealthAdvice("not_receiving");
  const unheard = voiceHealthAdvice("unheard");
  for (const [verdict, text] of [["not_receiving", notReceiving], ["unheard", unheard]] as const) {
    assert.ok(text.length > 0, `${verdict} has no sentence`);
    assert.ok(text.trim().endsWith("."), `${verdict} is a fragment rather than a sentence`);
  }
  assert.notEqual(notReceiving, unheard, "two different faults must not read as one");
  // The one the reader can act on names the action; the other must not send
  // somebody to their router when the link to the server is demonstrably fine.
  assert.match(unheard, /браузер/i);
  assert.doesNotMatch(notReceiving, /интернет/i);
});

test("the health of nothing carries an incoming half too", () => {
  // The empty branch returns early, and an early return that forgets a field
  // is how a panel renders `undefined.reading` on its first frame.
  const empty = voiceHealthOf([], NOW);
  assert.equal(empty.verdict, "unknown");
  assert.equal(empty.inbound.reading, "unknown");
});


/* ── A number that stopped being a measurement ──────────────────────── */

/**
 * `inbound-rtp.jitter` is left at its last value when packets stop — measured
 * in Chrome on 2026-09-19 by stopping the sender and reading the receiver four
 * seconds later: zero packets moved, and the jitter came back still reported,
 * still 0.001, byte-identical to the reading before the stop.
 *
 * Printed under «Ничего не приходит», «2 мс» tells a reader that something is
 * arriving and arriving smoothly. It is the same objection this module already
 * accepts for inbound loss, and the same one it accepts for the graph, where a
 * gap is drawn as a gap rather than bridged.
 */

test("a starved stream shows no jitter, because the last one is four seconds stale", () => {
  const view = voiceInboundOf(
    incoming(
      { remoteAudioTracks: 1, packetsReceived: 1000, samplesPlayed: 48_000, inboundJitterMs: 2 },
      { remoteAudioTracks: 1, packetsReceived: 1000, samplesPlayed: 48_000, inboundJitterMs: 2 },
    ),
    NOW,
  );
  assert.equal(view.reading, "starved");
  assert.equal(view.lastJitterMs, null, "a stale jitter is printed beside «nothing is arriving»");
});

test("an empty room shows no jitter either, because it belongs to somebody who left", () => {
  const view = voiceInboundOf(
    incoming(
      { remoteAudioTracks: 0, inboundJitterMs: 7 },
      { remoteAudioTracks: 0, inboundJitterMs: 7 },
    ),
    NOW,
  );
  assert.equal(view.reading, "idle");
  assert.equal(view.lastJitterMs, null);
});

test("an unheard stream keeps its jitter, because the packets really are being timed", () => {
  // Jitter is computed by the RTP stack from arrival times and owes nothing to
  // playout. Measured: a stream with packets arriving and
  // `totalSamplesReceived` stuck at 0 still reported `jitter`. The packets are
  // genuinely arriving and genuinely being timed here; it is the playing-out
  // that is not happening, and the row above this one says so.
  const view = voiceInboundOf(
    incoming(
      { packetsReceived: 1000, samplesPlayed: 0, inboundJitterMs: 4 },
      { packetsReceived: 1100, samplesPlayed: 0, inboundJitterMs: 4 },
    ),
    NOW,
  );
  assert.equal(view.reading, "unheard");
  assert.equal(view.lastJitterMs, 4, "a live measurement was withheld");
});

test("a receiving stream keeps its jitter", () => {
  const view = voiceInboundOf(
    incoming(
      { packetsReceived: 1000, samplesPlayed: 48_000, inboundJitterMs: 6 },
      { packetsReceived: 1100, samplesPlayed: 96_000, inboundJitterMs: 6 },
    ),
    NOW,
  );
  assert.equal(view.reading, "receiving");
  assert.equal(view.lastJitterMs, 6);
});

test("exactly the two readings where nothing is arriving withhold the number", () => {
  const readings: VoiceInboundReading[] = ["unknown", "idle", "receiving", "starved", "unheard"];
  assert.deepEqual(
    readings.filter((reading) => !voiceInboundJitterStands(reading)),
    ["idle", "starved"],
    "the set of readings that withhold a jitter number changed",
  );
});

test("a starved stream goes on producing samples, so the order of the two checks holds", () => {
  // Not a hypothetical. Four seconds after the sender stopped,
  // `packetsReceived` had not moved and `totalSamplesReceived` had risen by
  // 192 000 — NetEq concealing the gap for an element still pulling from it.
  // So «samples are moving» does not mean «packets are arriving», and asking
  // about playout before arrival reads a dead stream as a healthy one.
  const view = voiceInboundOf(
    incoming(
      { packetsReceived: 1000, samplesPlayed: 120_000 },
      { packetsReceived: 1000, samplesPlayed: 312_000 },
    ),
    NOW,
  );
  assert.equal(view.reading, "starved", "a stream with no packets was read as healthy because samples moved");
});
