import assert from "node:assert/strict";
import test from "node:test";

import {
  CALL_SOUNDS,
  callSoundEnvelope,
} from "../../artifacts/kub/src/lib/callSounds.ts";
import {
  peakOf,
  renderCallSoundSamples,
  renderSpecSamples,
  wavBytes,
} from "../../scripts/render-call-sounds.mjs";

/**
 * That the files the owner listens to are the sounds the product makes.
 *
 * `scripts/render-call-sounds.mjs` is only useful if it is the player's own
 * arithmetic put through a different output. A renderer carrying its own copy
 * of the numbers would produce a preview of something else and would look
 * exactly as convincing, so the sharing is measured here rather than asserted
 * there: every case below changes the **spec** and reads the **samples**.
 *
 * Nothing here reads the renderer's source. A scan for a literal proves nothing
 * about what the code does with it.
 */

function sampleIndex(sampleRate, ms) {
  return Math.round((ms / 1000) * sampleRate);
}

function windowRms(samples, sampleRate, fromMs, toMs) {
  const start = Math.max(0, sampleIndex(sampleRate, fromMs));
  const end = Math.min(samples.length, sampleIndex(sampleRate, toMs));
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

function peakWithin(samples, sampleRate, fromMs, toMs) {
  const start = Math.max(0, sampleIndex(sampleRate, fromMs));
  const end = Math.min(samples.length, sampleIndex(sampleRate, toMs));
  let peak = 0;
  for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
  return peak;
}

/** The pitch of a window, counted off the waveform rather than taken on trust. */
function crossingFrequency(samples, sampleRate, fromMs, toMs) {
  const start = sampleIndex(sampleRate, fromMs);
  const end = Math.min(samples.length, sampleIndex(sampleRate, toMs));
  let crossings = 0;
  for (let index = start + 1; index < end; index += 1) {
    const was = samples[index - 1];
    const is = samples[index];
    if ((was < 0 && is >= 0) || (was >= 0 && is < 0)) crossings += 1;
  }
  return crossings / 2 / ((end - start) / sampleRate);
}

// ---------------------------------------------------------------------------
// Where the audio is
// ---------------------------------------------------------------------------

test("the render is laid out where callSoundBursts puts it, not where it remembers", () => {
  const { samples, sampleRate } = renderCallSoundSamples("ring");
  // Two cycles of 500 on, 200 off, 500 on, 2000 off, and the silences are
  // exactly silent because nothing is written into them at all.
  for (const [from, to] of [[20, 480], [720, 1180], [3220, 3680], [3920, 4380]]) {
    assert.ok(windowRms(samples, sampleRate, from, to) > 0.02, `${from}..${to}ms must sound`);
  }
  for (const [from, to] of [[520, 680], [1220, 3180], [4420, 6380]]) {
    assert.equal(windowRms(samples, sampleRate, from, to), 0, `${from}..${to}ms must be silent`);
  }

  // And a cadence the renderer has never seen moves the audio with it. A
  // renderer with an idea of its own about the layout passes the block above
  // and fails this one.
  const moved = renderSpecSamples({
    ...CALL_SOUNDS.ring,
    loop: false,
    cadence: [
      { frequencies: [], durationMs: 300 },
      { frequencies: [440], durationMs: 200 },
    ],
  });
  assert.equal(windowRms(moved.samples, moved.sampleRate, 20, 280), 0);
  assert.ok(windowRms(moved.samples, moved.sampleRate, 320, 480) > 0.02);
});

// ---------------------------------------------------------------------------
// What pitch it is
// ---------------------------------------------------------------------------

test("each note is the pitch its own step names, which is the whole model change", () => {
  const join = renderCallSoundSamples("join");
  assert.ok(
    Math.abs(crossingFrequency(join.samples, join.sampleRate, 10, 100) - 440) < 8,
    `the join's first note must be 440: ${crossingFrequency(join.samples, join.sampleRate, 10, 100)}`,
  );
  assert.ok(
    Math.abs(crossingFrequency(join.samples, join.sampleRate, 150, 280) - 659.25) < 8,
    `and its second 659.25: ${crossingFrequency(join.samples, join.sampleRate, 150, 280)}`,
  );
  // Two different pitches inside one sound, measured off the samples. Under the
  // old model — one frequency list per spec — both windows would read the same.
  const leave = renderCallSoundSamples("leave");
  assert.ok(Math.abs(crossingFrequency(leave.samples, leave.sampleRate, 10, 100) - 659.25) < 8);
  assert.ok(Math.abs(crossingFrequency(leave.samples, leave.sampleRate, 150, 280) - 440) < 8);

  // A pitch nothing in the table carries, to show the render follows the step
  // rather than a set of pitches it knows.
  const odd = renderSpecSamples({
    ...CALL_SOUNDS.mute,
    cadence: [{ frequencies: [1_234.5], durationMs: 300 }],
  });
  assert.ok(Math.abs(crossingFrequency(odd.samples, odd.sampleRate, 20, 280) - 1_234.5) < 8);
});

// ---------------------------------------------------------------------------
// How loud it is
// ---------------------------------------------------------------------------

test("the level is callSoundToneGain's, asked of the burst", () => {
  const spec = CALL_SOUNDS.notification;
  const full = renderSpecSamples(spec);
  assert.ok(Math.abs(peakOf(full.samples) - spec.gain) < 0.002, "one tone peaks at the whole level");
  const half = renderSpecSamples({ ...spec, gain: spec.gain / 2 });
  assert.ok(Math.abs(peakOf(half.samples) - spec.gain / 2) < 0.002, "halve the gain, halve the peak");

  // Two sines in one burst share the level rather than doubling it, which is
  // the whole reason the division exists. Two copies of the same pitch are in
  // phase, so they sum to exactly the spec's level — and to twice it if the
  // renderer had skipped the division, which is audible as clipping.
  const single = renderSpecSamples({
    ...CALL_SOUNDS.ring,
    loop: false,
    cadence: [{ frequencies: [440], durationMs: 500 }],
  });
  const doubled = renderSpecSamples({
    ...CALL_SOUNDS.ring,
    loop: false,
    cadence: [{ frequencies: [440, 440], durationMs: 500 }],
  });
  assert.ok(Math.abs(peakOf(single.samples) - CALL_SOUNDS.ring.gain) < 0.002);
  assert.ok(Math.abs(peakOf(doubled.samples) - CALL_SOUNDS.ring.gain) < 0.002);

  // And the real ring, whose two tones beat against each other, still never
  // goes past the level its spec asks for.
  const ring = renderCallSoundSamples("ring");
  assert.ok(
    peakOf(ring.samples) <= CALL_SOUNDS.ring.gain + 1e-9,
    `two sines must not add up past ${CALL_SOUNDS.ring.gain}`,
  );
});

test("the four new sounds render at the levels the table names", () => {
  for (const name of ["join", "leave", "mute", "unmute"]) {
    const { samples } = renderCallSoundSamples(name);
    assert.ok(
      Math.abs(peakOf(samples) - CALL_SOUNDS[name].gain) < 0.002,
      `${name} peaked at ${peakOf(samples)} against ${CALL_SOUNDS[name].gain}`,
    );
  }
});

// ---------------------------------------------------------------------------
// What shape it is
// ---------------------------------------------------------------------------

test("the envelope is callSoundEnvelope's, squeezed bursts included", () => {
  const spec = {
    name: "mute",
    gain: 0.1,
    attackMs: 20,
    releaseMs: 60,
    loop: false,
    cadence: [{ frequencies: [1_000], durationMs: 200 }],
  };
  const { samples, sampleRate } = renderSpecSamples(spec);
  assert.equal(samples[0], 0, "silence at the very start");
  // Halfway up the attack the envelope is half the peak, so nothing in that
  // window can be louder than that.
  assert.ok(peakWithin(samples, sampleRate, 0, 10) <= 0.05 + 0.002);
  assert.ok(Math.abs(peakWithin(samples, sampleRate, 25, 135) - 0.1) < 0.003, "held at the peak");
  // A tone that stops dead reads as a beep. This one falls away.
  assert.ok(peakWithin(samples, sampleRate, 196, 200) < 0.012);
  assert.equal(peakWithin(samples, sampleRate, 205, 400), 0, "and then nothing at all");

  // A burst shorter than its own envelope: `callSoundEnvelope` scales both to
  // fit, and the render has to follow rather than ramp past the end of the
  // burst — which is where a browser leaves the gain wherever it had got to.
  const envelope = callSoundEnvelope(spec, 40);
  assert.ok(envelope.attackMs + envelope.releaseMs <= 40 + 1e-9);
  assert.ok(envelope.attackMs > 0 && envelope.releaseMs > 0);
  const squeezed = renderSpecSamples({ ...spec, cadence: [{ frequencies: [1_000], durationMs: 40 }] });
  assert.ok(peakWithin(squeezed.samples, squeezed.sampleRate, 0, 40) <= 0.1 + 0.002);
  assert.ok(peakWithin(squeezed.samples, squeezed.sampleRate, 39, 60) < 0.02, "it still ends at nothing");
});

// ---------------------------------------------------------------------------
// The file itself
// ---------------------------------------------------------------------------

test("what is written is a 48 kHz 16-bit mono wav", () => {
  const { samples } = renderCallSoundSamples("mute");
  const bytes = wavBytes(samples);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "fmt ");
  assert.equal(bytes.readUInt32LE(16), 16);
  assert.equal(bytes.readUInt16LE(20), 1, "uncompressed PCM");
  assert.equal(bytes.readUInt16LE(22), 1, "mono");
  assert.equal(bytes.readUInt32LE(24), 48_000);
  assert.equal(bytes.readUInt16LE(34), 16, "16 bits a sample");
  assert.equal(bytes.subarray(36, 40).toString("ascii"), "data");
  assert.equal(bytes.readUInt32LE(40), samples.length * 2);
  assert.equal(bytes.length, 44 + samples.length * 2);
  // And the samples in it are the samples that were rendered, at the level they
  // were rendered at — no normalisation anywhere between the two.
  assert.equal(bytes.readInt16LE(44), 0);
  const peakSample = Math.round(peakOf(samples) * 32_767);
  let written = 0;
  for (let index = 0; index < samples.length; index += 1) {
    written = Math.max(written, Math.abs(bytes.readInt16LE(44 + index * 2)));
  }
  assert.ok(Math.abs(written - peakSample) <= 1, `${written} written against ${peakSample} rendered`);
});
