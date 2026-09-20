import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

/**
 * What `lib/micLevel.ts` can resolve, measured in a browser against known
 * amplitudes — and what the gate does with the answer.
 *
 * Every other voice spec replaces the level: `window.__letscubeMicLevel` is
 * that module's own DEV stand-in, written because Chromium's fake capture
 * device is a once-a-second beep. That seam is what makes the gate, the tail
 * and the warning testable, and it is also why **nothing in the suite has ever
 * exercised the analyser itself**. This file is the one that does: no stand-in
 * is installed, so `openMicLevelSource` takes the real path, and the signal it
 * reads is an oscillator at a known level published through a
 * `MediaStreamAudioDestinationNode` — a genuine `MediaStreamTrack`, cloned and
 * analysed exactly as a capture's would be.
 *
 * It exists because of D-278. The instrument used to read
 * `getByteTimeDomainData`, whose conversion is specified as `⌊128(1 + x)⌋`, so
 * every bipolar signal from −90.3 dBFS up to about −42.1 dBFS reported the same
 * single byte — and `micGateOpenAt(0.35)`, the shipped default, is −45.5 dBFS,
 * *inside* that bucket. The consequence is the first test below: at its default
 * threshold «По голосу» could not close the microphone at all, for anybody.
 *
 * What this file does **not** prove: that a real microphone, a driver and
 * `getUserMedia` produce these numbers. The graph after the track is the whole
 * of what is measured here. It runs on Chromium only — the byte conversion is
 * specified rather than a Chromium behaviour, but the float path's exactness is
 * a measurement, and WebKit is unreached.
 */

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

/**
 * A quiet room under the product's default noise suppression, which
 * `lib/micGate.ts` records as sitting below −60 dBFS. The number that matters
 * about it is that it is **below** the default threshold's −45.5 dBFS: a gate
 * pointed at this room is supposed to be shut.
 */
const ROOM_DBFS = -60;

/** A voice into a laptop capture, the other figure that module records. */
const SPEECH_DBFS = -24;

interface Measurement {
  opened: boolean;
  readings: number;
  peak: number;
  /** What `micMeterPercent` would paint for that peak — the bar the owner sees. */
  percent: number;
  amplitude: number;
  openAt: number;
  noInputFloor: number;
  gateOpen: boolean;
}

/**
 * Read a known amplitude through the product's own level source, then walk the
 * gate over what came back.
 *
 * The gate is seeded **open**, by one syllable, because that is the state the
 * defect hides in: a gate that has never opened is trivially shut. What is
 * asked is whether a microphone that has been spoken into goes quiet again.
 */
async function measure(page: import("@playwright/test").Page, dbfs: number): Promise<Measurement> {
  return page.evaluate(async (decibels) => {
    const { openMicLevelSource } = await import("/src/lib/micLevel.ts");
    const {
      MIC_GATE_HOLD_MS,
      MIC_GATE_THRESHOLD_DEFAULT,
      micGateOpenAt,
      micMeterPercent,
      nextMicGate,
    } = await import("/src/lib/micGate.ts");
    const { MIC_NO_INPUT_FLOOR } = await import("/src/lib/micNoInput.ts");

    const amplitude = 10 ** (decibels / 20);
    const context = new AudioContext();
    if (context.state === "suspended") await context.resume();
    const destination = context.createMediaStreamDestination();
    const gain = context.createGain();
    gain.gain.value = amplitude;
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    oscillator.connect(gain).connect(destination);
    oscillator.start();

    const track = destination.stream.getAudioTracks()[0];
    const readings: number[] = [];
    // The sampler's own period, so the walk below is in real units.
    const source = openMicLevelSource(track, (level) => readings.push(level), 50);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    source?.close();
    oscillator.stop();
    await context.close();

    // The first readings are the graph filling: an analyser hands back a window
    // of zeros until 2048 samples have been through it.
    const settled = readings.slice(6);
    let peak = 0;
    for (const level of settled) if (level > peak) peak = level;

    let gate = nextMicGate(
      { open: false, openUntil: 0 },
      {
        activation: "voice",
        muted: false,
        held: false,
        level: 0.3,
        threshold: MIC_GATE_THRESHOLD_DEFAULT,
        now: 0,
      },
    );
    let now = 0;
    for (const level of settled) {
      now += 50;
      gate = nextMicGate(gate, {
        activation: "voice",
        muted: false,
        held: false,
        level,
        threshold: MIC_GATE_THRESHOLD_DEFAULT,
        now,
      });
    }
    // The walk has to outlast the tail, or «still open» would mean nothing.
    if (now <= MIC_GATE_HOLD_MS)
      throw new Error(`the walk is ${now}ms, shorter than the gate's own tail`);

    return {
      opened: source !== null,
      readings: settled.length,
      peak,
      percent: micMeterPercent(peak, false),
      amplitude,
      openAt: micGateOpenAt(MIC_GATE_THRESHOLD_DEFAULT),
      noInputFloor: MIC_NO_INPUT_FLOOR,
      gateOpen: gate.open,
    };
  }, dbfs);
}

test("a quiet room is read as a quiet room, and «По голосу» closes on it", async ({ page }) => {
  await gotoOrSkip(page, "/");
  const measured = await measure(page, ROOM_DBFS);

  expect(measured.opened, "the level source refused to open in this browser").toBe(true);
  expect(measured.readings).toBeGreaterThan(8);

  // The instrument, first. A factor of two either way: what is claimed is that
  // the reading is the signal, not that a graph is bit-exact.
  expect(measured.peak).toBeGreaterThan(measured.amplitude / 2);
  expect(measured.peak).toBeLessThan(measured.amplitude * 2);

  // And the byte path's single answer for every one of these levels, named as
  // a literal because that is what it is — the one number the old instrument
  // could return for anything between −90.3 and −42.1 dBFS.
  expect(measured.peak, "the level is still quantised to a byte step").toBeLessThan(1 / 128);

  // The consequence. A room below the threshold has to be below the threshold,
  // and on the byte path it was not: 1/128 is 0.0078, and micGateOpenAt(0.35)
  // is 0.0053.
  expect(measured.peak).toBeLessThan(measured.openAt);
  expect(measured.gateOpen, "the gate stayed open on a room 15 dB under its own threshold").toBe(
    false,
  );

  // The same reading, judged by the other rule that reads it: a room this
  // quiet is not sound, so the no-input warning is still reachable.
  expect(measured.peak).toBeLessThanOrEqual(measured.noInputFloor);
});

/**
 * **The bucket, asserted as a bucket.**
 *
 * The owner photographed his dimmed capsule on the deployed build: the bar
 * rests at about 42% of its track, which is byte 1 → −42.14 dBFS → position
 * 0.398. The defect is not that 42% is the wrong number — his true level is
 * somewhere in the 48 dB bucket and nobody knows where, so the honest reading
 * might be 0% or 14% or 28%. The defect is that **42% is the only number the
 * instrument could produce below −42 dBFS**: a dead microphone, a dimmed one
 * and a quiet room all painted the same bar.
 *
 * So what is asserted is that they stop being the same. Three signals spread
 * across the old bucket have to reach three different positions on the meter,
 * and under the byte path all three are 40%.
 */
test("three different quiet signals stop painting one bar", async ({ page }) => {
  await gotoOrSkip(page, "/");
  const drawn: { dbfs: number; percent: number; peak: number }[] = [];
  for (const dbfs of [-85, -60, -50]) {
    const measured = await measure(page, dbfs);
    expect(measured.opened).toBe(true);
    drawn.push({ dbfs, percent: measured.percent, peak: measured.peak });
  }

  const positions = drawn.map((entry) => entry.percent);
  expect(
    new Set(positions).size,
    `three signals 35 dB apart painted ${JSON.stringify(drawn)}`,
  ).toBe(3);
  // And in the right order, so «distinct» cannot be satisfied by noise.
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
  // The byte path's single answer for every one of them, as a literal: 1/128
  // is position 0.39794, which rounds to the 40% the owner photographed.
  for (const entry of drawn)
    expect(entry.percent, `${entry.dbfs} dBFS still paints the bucket`).not.toBe(40);
});

test("a voice opens the same gate, and counts as sound", async ({ page }) => {
  await gotoOrSkip(page, "/");
  const measured = await measure(page, SPEECH_DBFS);

  expect(measured.opened).toBe(true);
  expect(measured.peak).toBeGreaterThan(measured.amplitude / 2);
  expect(measured.peak).toBeLessThan(measured.amplitude * 2);
  // Without this the test above is satisfied by an instrument that reports
  // nothing at all, which is the obvious way to break this module.
  expect(measured.peak).toBeGreaterThan(measured.openAt);
  expect(measured.peak).toBeGreaterThan(measured.noInputFloor);
  expect(measured.gateOpen).toBe(true);
});
