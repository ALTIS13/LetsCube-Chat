import assert from "node:assert/strict";
import test from "node:test";

import {
  CALL_SOUNDS,
  callSoundEnvelope,
  callSoundEnvelopeLevel,
} from "../../artifacts/kub/src/lib/callSounds.ts";
import { callSoundPlanForSpec } from "../../scripts/call-sound-baseline.mjs";
import * as callSoundsModule from "../../artifacts/kub/src/lib/callSounds.ts";
import {
  asBefore,
  decayOnly,
  peakOf,
  renderCallSoundSamples,
  renderSpecSamples,
  throughPhoneSpeaker,
  VOICE_SOUNDS,
  wavBytes,
  withSubOctave,
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

/**
 * How much of one frequency is in a window, by correlating against it.
 *
 * A single-bin discrete transform. The envelope is common to every partial of a
 * burst, so over one window the **ratios** between bins are the ratios between
 * the partials' levels whatever the envelope is doing — which is what makes it
 * the right instrument for reading a timbre back out of samples.
 */
function amplitudeAt(samples, sampleRate, hz, fromMs, toMs) {
  const start = sampleIndex(sampleRate, fromMs);
  const end = Math.min(samples.length, sampleIndex(sampleRate, toMs));
  let real = 0;
  let imaginary = 0;
  for (let index = start; index < end; index += 1) {
    const seconds = (index - start) / sampleRate;
    real += samples[index] * Math.cos(2 * Math.PI * hz * seconds);
    imaginary += samples[index] * Math.sin(2 * Math.PI * hz * seconds);
  }
  const count = end - start;
  return count > 0 ? (2 * Math.hypot(real, imaginary)) / count : 0;
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
      { tones: [], durationMs: 300 },
      { tones: [{ hz: 440, level: 1 }], durationMs: 200 },
    ],
  });
  assert.equal(windowRms(moved.samples, moved.sampleRate, 20, 280), 0);
  assert.ok(windowRms(moved.samples, moved.sampleRate, 320, 480) > 0.02);
});

// ---------------------------------------------------------------------------
// What pitch it is
// ---------------------------------------------------------------------------

test("each note is the pitch its own step names, which is the whole model change", () => {
  // Measured on the fundamental alone: the shipped notes carry partials, and a
  // zero crossing counts every one of them. That projection is the previous
  // sound, and the case below this one proves it is exactly that.
  const join = renderSpecSamples(asBefore(CALL_SOUNDS.join, 0.08));
  assert.ok(
    Math.abs(crossingFrequency(join.samples, join.sampleRate, 10, 100) - 440) < 8,
    `the join's first note must be 440: ${crossingFrequency(join.samples, join.sampleRate, 10, 100)}`,
  );
  assert.ok(
    Math.abs(crossingFrequency(join.samples, join.sampleRate, 150, 280) - 659.25) < 8,
    `and its second 659.25: ${crossingFrequency(join.samples, join.sampleRate, 150, 280)}`,
  );
  // Two different pitches inside one sound. Under the model before 2026-09-19 —
  // one frequency list per spec — both windows would read the same.
  const leave = renderSpecSamples(asBefore(CALL_SOUNDS.leave, 0.08));
  assert.ok(Math.abs(crossingFrequency(leave.samples, leave.sampleRate, 10, 100) - 659.25) < 8);
  assert.ok(Math.abs(crossingFrequency(leave.samples, leave.sampleRate, 150, 280) - 440) < 8);

  // A pitch nothing in the table carries, to show the render follows the step
  // rather than a set of pitches it knows.
  const odd = renderSpecSamples({
    ...CALL_SOUNDS.mute,
    decay: "linear",
    cadence: [{ tones: [{ hz: 1_234.5, level: 1 }], durationMs: 300 }],
  });
  assert.ok(Math.abs(crossingFrequency(odd.samples, odd.sampleRate, 20, 280) - 1_234.5) < 8);
});

// ---------------------------------------------------------------------------
// What it is made of
// ---------------------------------------------------------------------------

test("a note's partials come out at the levels the table gives them", () => {
  for (const name of VOICE_SOUNDS) {
    const spec = CALL_SOUNDS[name];
    const { samples, sampleRate } = renderCallSoundSamples(name);
    const [burst] = spec.cadence.filter((step) => step.tones.length > 0);
    const tones = [...burst.tones].sort((a, b) => b.level - a.level);
    const fundamental = tones[0];
    const window = [2, Math.min(burst.durationMs - 2, 95)];
    const base = amplitudeAt(samples, sampleRate, fundamental.hz, window[0], window[1]);
    assert.ok(base > 0, `${name}: nothing at its own pitch`);
    for (const tone of tones.slice(1)) {
      const measured = amplitudeAt(samples, sampleRate, tone.hz, window[0], window[1]);
      const ratio = measured / base;
      assert.ok(
        Math.abs(ratio - tone.level / fundamental.level) < 0.05,
        `${name}: ${tone.hz} Hz came out at ${ratio.toFixed(3)} of the fundamental, not ${tone.level}`,
      );
    }
    // And nothing an octave below, which is the measured refusal made audible.
    const below = amplitudeAt(samples, sampleRate, fundamental.hz / 2, window[0], window[1]);
    assert.ok(below / base < 0.05, `${name} has ${(below / base).toFixed(3)} of a sub-octave in it`);
  }
});

test("moving a partial's level moves what comes out, which is how the sharing is known", () => {
  const spec = CALL_SOUNDS.mute;
  const pitch = spec.cadence[0].tones[0].hz;
  const measure = (level) => {
    const { samples, sampleRate } = renderSpecSamples({
      ...spec,
      cadence: [
        {
          tones: [
            { hz: pitch, level: 1 },
            { hz: pitch * 2, level },
          ],
          durationMs: 200,
        },
      ],
    });
    return (
      amplitudeAt(samples, sampleRate, pitch * 2, 2, 190) /
      amplitudeAt(samples, sampleRate, pitch, 2, 190)
    );
  };
  for (const level of [0.1, 0.32, 0.75]) {
    assert.ok(Math.abs(measure(level) - level) < 0.05, `${level} came out at ${measure(level)}`);
  }
  // Equal levels are not a special case; they are one value the field takes.
  assert.ok(Math.abs(measure(1) - 1) < 0.05);
});

// ---------------------------------------------------------------------------
// How loud it is
// ---------------------------------------------------------------------------

test("the rendered notification has two distinct notes, a rest and a quiet tail", () => {
  const { samples, sampleRate } = renderCallSoundSamples("notification");
  const first = amplitudeAt(samples, sampleRate, 740, 12, 55);
  const second = amplitudeAt(samples, sampleRate, 988, 140, 180);
  assert.ok(first > 0.01, `first note at 740 Hz: ${first}`);
  assert.ok(second > 0.01, `second note at 988 Hz: ${second}`);
  assert.ok(first > amplitudeAt(samples, sampleRate, 988, 12, 55) * 2);
  assert.ok(second > amplitudeAt(samples, sampleRate, 740, 140, 180) * 2);
  assert.ok(amplitudeAt(samples, sampleRate, 1480, 12, 55) < first / 3);
  assert.ok(amplitudeAt(samples, sampleRate, 1976, 140, 180) < second / 3);
  assert.equal(windowRms(samples, sampleRate, 105, 120), 0, "a real rest separates the notes");
  assert.ok(
    windowRms(samples, sampleRate, 245, 270) < windowRms(samples, sampleRate, 145, 170) / 4,
    "the resolving note falls away before it ends",
  );
  assert.equal(peakWithin(samples, sampleRate, 280, 500), 0, "the one-shot is over by 280 ms");
});

test("the level is callSoundToneGain's, asked of the burst and of the tone", () => {
  const spec = CALL_SOUNDS.notification;
  const full = renderSpecSamples(spec);
  const fullPeak = peakOf(full.samples);
  assert.ok(fullPeak > 0.04 && fullPeak <= spec.gain, "the cue is audible within its peak budget");
  const half = renderSpecSamples({ ...spec, gain: spec.gain / 2 });
  assert.ok(Math.abs(peakOf(half.samples) - fullPeak / 2) < 0.002, "halve the gain, halve the peak");

  // Two sines in one burst share the level rather than doubling it, which is
  // the whole reason the division exists. Two copies of the same pitch are in
  // phase, so they sum to exactly the spec's level — and to twice it if the
  // renderer had skipped the division, which is audible as clipping.
  const single = renderSpecSamples({
    ...CALL_SOUNDS.ring,
    loop: false,
    cadence: [{ tones: [{ hz: 440, level: 1 }], durationMs: 500 }],
  });
  const doubled = renderSpecSamples({
    ...CALL_SOUNDS.ring,
    loop: false,
    cadence: [
      {
        tones: [
          { hz: 440, level: 1 },
          { hz: 440, level: 1 },
        ],
        durationMs: 500,
      },
    ],
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

test("no arrangement of partials makes a note louder than its budget", () => {
  for (const name of VOICE_SOUNDS) {
    const { samples } = renderCallSoundSamples(name);
    assert.ok(
      peakOf(samples) <= CALL_SOUNDS[name].gain + 1e-9,
      `${name} peaked at ${peakOf(samples)} against ${CALL_SOUNDS[name].gain}`,
    );
    // And it is not so far under that the budget has stopped meaning anything.
    assert.ok(peakOf(samples) > CALL_SOUNDS[name].gain * 0.6, `${name} is wasting its budget`);
  }
});

// ---------------------------------------------------------------------------
// What shape it is
// ---------------------------------------------------------------------------

test("an exponential note is most of the way down where a linear one is at two thirds", () => {
  const spec = CALL_SOUNDS.mute;
  const duration = spec.cadence[0].durationMs;
  const { releaseMs } = callSoundEnvelope(spec, duration);
  const releaseStart = duration - releaseMs;
  const third = releaseStart + releaseMs / 3;

  const struck = renderCallSoundSamples("mute");
  const plain = renderSpecSamples({ ...spec, decay: "linear" });
  const at = (render, ms) =>
    peakWithin(render.samples, render.sampleRate, ms - 3, ms + 3) / peakOf(render.samples);

  assert.ok(Math.abs(at(plain, third) - 2 / 3) < 0.05, `a straight fall: ${at(plain, third)}`);
  assert.ok(at(struck, third) < 0.35, `and a struck one: ${at(struck, third)}`);
  // Both end at nothing — the exponential's tail exists so that it does.
  assert.ok(at(struck, duration - 1) < 0.05);
  assert.ok(at(plain, duration - 1) < 0.05);
});

test("every sample sits under the envelope the shared function describes", () => {
  // The exact statement of «the renderer uses `callSoundEnvelopeLevel`», and it
  // needs no tolerance to be meaningful: the envelope is the signal's amplitude
  // bound at every instant, so a renderer shaping its notes any other way puts
  // a sample over the line somewhere. Both decays, all seven sounds.
  //
  // Measured against a *window* rather than a point, deliberately. A window's
  // loudest sample reports the envelope's maximum across that window, not its
  // value in the middle, and on a fall this steep those differ by 13% over
  // three milliseconds — which is how the first version of this case failed
  // while the renderer was correct.
  for (const name of Object.keys(CALL_SOUNDS)) {
    const spec = CALL_SOUNDS[name];
    const { samples, sampleRate, bursts } = renderCallSoundSamples(name);
    for (const burst of bursts) {
      const start = sampleIndex(sampleRate, burst.atMs);
      const count = sampleIndex(sampleRate, burst.durationMs);
      let loosest = 0;
      for (let index = 0; index < count; index += 1) {
        const atMs = (index / sampleRate) * 1000;
        const bound = spec.gain * callSoundEnvelopeLevel(spec, burst.durationMs, atMs);
        const value = Math.abs(samples[start + index]);
        assert.ok(
          value <= bound + 1e-12,
          `${name} at ${atMs.toFixed(2)}ms: ${value} over a bound of ${bound}`,
        );
        loosest = Math.max(loosest, bound - value);
      }
      // And the bound is the envelope rather than something far above it: some
      // sample of every 10 ms window gets within 40% of it. Without this the
      // case above would pass for a renderer that output silence.
      for (let fromMs = 1; fromMs + 10 < burst.durationMs; fromMs += 10) {
        const ceiling = spec.gain * callSoundEnvelopeLevel(spec, burst.durationMs, fromMs);
        const reached = peakWithin(
          samples,
          sampleRate,
          burst.atMs + fromMs,
          burst.atMs + fromMs + 10,
        );
        assert.ok(
          reached >= ceiling * 0.6,
          `${name} at ${fromMs}ms reaches only ${reached} of ${ceiling}`,
        );
      }
      assert.ok(loosest > 0, `${name} never came near its own envelope`);
    }
  }
});

test("the envelope is callSoundEnvelope's, squeezed bursts included", () => {
  const spec = {
    name: "mute",
    gain: 0.1,
    attackMs: 20,
    releaseMs: 60,
    decay: "linear",
    loop: false,
    cadence: [{ tones: [{ hz: 1_000, level: 1 }], durationMs: 200 }],
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
  const squeezed = renderSpecSamples({
    ...spec,
    cadence: [{ tones: [{ hz: 1_000, level: 1 }], durationMs: 40 }],
  });
  assert.ok(peakWithin(squeezed.samples, squeezed.sampleRate, 0, 40) <= 0.1 + 0.002);
  assert.ok(peakWithin(squeezed.samples, squeezed.sampleRate, 39, 60) < 0.02, "it still ends at nothing");
});

// ---------------------------------------------------------------------------
// The A/B, which is only worth anything if its «before» is the real before
// ---------------------------------------------------------------------------

test("the before side of the A/B is the sound the owner actually heard", () => {
  // Pinned from `lib/callSounds.ts` at 8c083ee9, read out by
  // `scripts/call-sound-baseline.mjs`. The projection reconstructs it from the
  // shipped spec by keeping the loudest partial and straightening the fall; if
  // the two ever differ, the comparison the owner is being asked to make is
  // between the new sound and something nobody ever heard.
  const before = {
    join: [
      { atMs: 0, durationMs: 110, hz: 440, gain: 0.08, attackMs: 6, releaseMs: 100 },
      { atMs: 140, durationMs: 150, hz: 659.25, gain: 0.08, attackMs: 6, releaseMs: 100 },
    ],
    leave: [
      { atMs: 0, durationMs: 110, hz: 659.25, gain: 0.08, attackMs: 6, releaseMs: 100 },
      { atMs: 140, durationMs: 150, hz: 440, gain: 0.08, attackMs: 6, releaseMs: 100 },
    ],
    mute: [{ atMs: 0, durationMs: 100, hz: 440, gain: 0.05, attackMs: 4, releaseMs: 80 }],
    unmute: [{ atMs: 0, durationMs: 100, hz: 659.25, gain: 0.05, attackMs: 4, releaseMs: 80 }],
  };
  for (const [name, rows] of Object.entries(before)) {
    const projected = asBefore(CALL_SOUNDS[name], rows[0].gain);
    assert.deepEqual(
      callSoundPlanForSpec(callSoundsModule, projected, 1),
      rows.map((row) => ({
        atMs: row.atMs,
        durationMs: row.durationMs,
        decay: "linear",
        voices: [{ hz: row.hz, gain: row.gain }],
        attackMs: row.attackMs,
        releaseMs: row.releaseMs,
      })),
      `${name}'s before side is not what ${name} used to be`,
    );
  }
});

test("the telephone model is the roll-off the sub-octave was refused for", () => {
  // The measurement the whole decision rests on, and until 2026-09-19 nothing
  // tested it: replacing the filter with a pass-through left every case below
  // this one green, because a sub-octave costs budget whether or not anything
  // attenuates it. A model nobody measures is an opinion with a decimal point.
  const response = (hz) => {
    const count = 48_000;
    const tone = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      tone[index] = Math.sin((2 * Math.PI * hz * index) / 48_000);
    }
    const out = throughPhoneSpeaker(tone);
    let after = 0;
    for (let index = count / 2; index < count; index += 1) after = Math.max(after, Math.abs(out[index]));
    return 20 * Math.log10(after);
  };

  // Two poles at 500 Hz, measured off the filter rather than derived from it.
  assert.ok(Math.abs(response(220) - -15.9) < 0.6, `220 Hz came through at ${response(220)}`);
  assert.ok(Math.abs(response(440) - -7.5) < 0.6, `440 Hz came through at ${response(440)}`);
  assert.ok(Math.abs(response(880) - -2.9) < 0.6, `880 Hz came through at ${response(880)}`);

  // And the argument itself, in two lines: an octave below either of this
  // family's pitches loses several dB more than the pitch does, so the budget
  // it takes buys almost nothing on the platform most people are on.
  assert.ok(response(220) < response(440) - 8, "a sub-octave under A4 must be far down");
  assert.ok(response(329.6) < response(659.25) - 5.5, "and under E5 as well");
  // A roll-off rather than a wall: it still passes what speech sits in.
  assert.ok(response(1_320) > -3);
  assert.ok(response(4_000) > -2);
});

test("the candidates differ from each other in the one way each is named for", () => {
  const spec = CALL_SOUNDS.join;
  const a = renderSpecSamples(asBefore(spec, 0.08));
  const b = renderCallSoundSamples("join");
  const c = renderSpecSamples(withSubOctave(spec));
  const d = renderSpecSamples(decayOnly(spec, 0.08));
  const partialOf = (render, hz) =>
    amplitudeAt(render.samples, render.sampleRate, hz, 2, 105) /
    amplitudeAt(render.samples, render.sampleRate, 440, 2, 105);

  // A and D are one sinusoid; B and C carry the octave above.
  assert.ok(partialOf(a, 880) < 0.05 && partialOf(d, 880) < 0.05);
  assert.ok(partialOf(b, 880) > 0.25 && partialOf(c, 880) > 0.25);
  // Only C has anything under the fundamental.
  assert.ok(partialOf(a, 220) < 0.05 && partialOf(b, 220) < 0.05 && partialOf(d, 220) < 0.05);
  assert.ok(partialOf(c, 220) > 0.15, `C is the sub-octave candidate: ${partialOf(c, 220)}`);
  // And only A falls in a straight line.
  const mid = (render) =>
    peakWithin(render.samples, render.sampleRate, 40, 46) / peakOf(render.samples);
  assert.ok(mid(a) > 0.5, `A is held and switched off: ${mid(a)}`);
  for (const render of [b, c, d]) assert.ok(mid(render) < 0.4, `${mid(render)} is not a decay`);

  // The sub-octave costs the rest of the note, which is the whole reason it is
  // a candidate and not a tone: through a telephone model C is the quietest.
  const phone = (render) => windowRms(throughPhoneSpeaker(render.samples), render.sampleRate, 0, 290);
  assert.ok(phone(c) < phone(b), `C ${phone(c)} must be under B ${phone(b)}`);
  assert.ok(phone(b) < phone(a), "and the fall itself costs energy, which is what a fall is");
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
