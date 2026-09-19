#!/usr/bin/env node
/**
 * Every sound this product makes, as a file somebody can listen to — and, since
 * 2026-09-19, the candidates for how deep they should be.
 *
 * A sound cannot be photographed and it cannot be reviewed from a diff. The
 * owner judges what they can perceive, and for sound that means listening
 * before anything ships.
 *
 * ## It is the player's own arithmetic, not a description of it
 *
 * Nothing about *what* to sound is decided here. Which bursts, when, on which
 * tones, at what level each of them gets, and how the burst is shaped are all
 * asked of `lib/callSounds.ts` — and since the envelope grew a second shape,
 * `callSoundEnvelopeLevel` is literally the function the player samples into
 * the curve it hands Web Audio. This file owns one thing: turning a level and a
 * frequency into samples.
 *
 * How that sharing is known rather than claimed:
 * `tests/unit/call-sound-render.test.mjs` mutates the spec table and measures
 * the samples. Halve a gain and the rendered peak halves. Change a cadence and
 * the loud windows move. Count zero crossings inside each of the join's notes
 * and they come out at the two pitches the spec names. Make one partial louder
 * and the spectrum follows. A renderer carrying its own copy of the numbers
 * passes none of those.
 *
 * ## The levels are the real ones
 *
 * These sounds are quiet on purpose — roughly -26 to -16 dBFS — because they
 * play over somebody's conversation. Every file but one is rendered at exactly
 * that, so what is judged is what the product makes. Turn the volume up rather
 * than trusting a normalised copy. The exception is named so it cannot be
 * mistaken: `tour-amplified.wav`.
 *
 * ## The A/B, and why the «before» side is not a reconstruction
 *
 * The before side is built by projecting each sound back to one sinusoid with a
 * straight-line fall at the level it had — and the projection is **checked**
 * against the module as it actually stood at `8c083ee9`, burst for burst,
 * rather than trusted. `tests/unit/call-sound-render.test.mjs` fails if the two
 * ever differ, so an A/B cannot quietly compare the new sound against something
 * nobody ever heard.
 *
 * Usage:
 *   node scripts/render-call-sounds.mjs [--before <git-ref>]
 *
 * Writes output/call-sounds/. Nothing on a network is reached and no browser is
 * started.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CALL_SOUNDS,
  callSoundBursts,
  callSoundCycleMs,
  callSoundEnvelopeLevel,
  callSoundToneGain,
} from "../artifacts/kub/src/lib/callSounds.ts";
import { loadRevisionModule } from "./call-sound-baseline.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const OUTPUT_DIR = path.join(ROOT, "output", "call-sounds");

export const SAMPLE_RATE = 48_000;

/** The commit whose sounds the owner has already heard. */
export const BEFORE_REF = "8c083ee9";

/**
 * How many cycles of a looping sound to render.
 *
 * Two, because one cycle of a ring is a pattern and two is a ringtone: the
 * silence between them is the thing being judged, and a single cycle does not
 * contain it.
 */
export const LOOP_CYCLES = 2;

/** Room after the last burst, so a player does not clip the release. */
export const TAIL_MS = 250;

/** The four a voice channel makes, which are the four under discussion. */
export const VOICE_SOUNDS = ["join", "leave", "mute", "unmute"];

/** The order the tour plays: the three that existed, then the four that are new. */
export const TOUR = ["ring", "ringback", "notification", ...VOICE_SOUNDS];

/** Every sample of one spec, at the level the product would actually play it. */
export function renderSpecSamples(spec, options = {}) {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const cycle = callSoundCycleMs(spec);
  const cycles = spec.loop ? (options.loopCycles ?? LOOP_CYCLES) : 1;
  const tailMs = options.tailMs ?? TAIL_MS;
  const spanMs = cycle * cycles;
  const bursts = callSoundBursts(spec, { fromMs: 0, untilMs: spanMs });
  const samples = new Float64Array(Math.ceil(((spanMs + tailMs) / 1000) * sampleRate));
  for (const burst of bursts) {
    const start = Math.round((burst.atMs / 1000) * sampleRate);
    const length = Math.round((burst.durationMs / 1000) * sampleRate);
    for (const tone of burst.tones) {
      const peak = callSoundToneGain(spec, burst, tone);
      if (peak <= 0) continue;
      for (let index = 0; index < length; index += 1) {
        const seconds = index / sampleRate;
        const level = callSoundEnvelopeLevel(spec, burst.durationMs, seconds * 1000);
        if (level === 0) continue;
        const at = start + index;
        if (at >= samples.length) break;
        samples[at] += peak * level * Math.sin(2 * Math.PI * tone.hz * seconds);
      }
    }
  }
  return { samples, sampleRate, spanMs, bursts };
}

/** The same, by name. */
export function renderCallSoundSamples(name, options = {}) {
  const spec = CALL_SOUNDS[name];
  if (!spec) throw new Error(`no such sound: ${name}`);
  return renderSpecSamples(spec, options);
}

// ---------------------------------------------------------------------------
// The candidates
// ---------------------------------------------------------------------------

/** The loudest tone of a step, which is what a fundamental is. */
function fundamental(tones) {
  return tones.reduce((best, tone) => (tone.level > best.level ? tone : best));
}

/** Every step reduced to its fundamental alone, at full level. */
function fundamentalsOnly(spec) {
  return spec.cadence.map((step) => ({
    ...step,
    tones: step.tones.length > 0 ? [{ hz: fundamental(step.tones).hz, level: 1 }] : [],
  }));
}

/**
 * A — the sound as the owner already heard it: one sinusoid, falling in a
 * straight line, at the level it had before the partials were paid for.
 */
export function asBefore(spec, beforeGain) {
  return { ...spec, gain: beforeGain, decay: "linear", cadence: fundamentalsOnly(spec) };
}

/** D — the new fall and nothing else, so the decay can be judged on its own. */
export function decayOnly(spec, beforeGain) {
  return { ...spec, gain: beforeGain, decay: "exponential", cadence: fundamentalsOnly(spec) };
}

/**
 * C — the shipped note with an octave added underneath.
 *
 * The one the measurement argued against and the owner may overrule. Rendered
 * at **B's own gain**, so the two differ by one partial and nothing else — and
 * so what is heard is exactly what the sub-octave costs. It cannot be paid
 * back: `join` and `leave` already sit at the 0.1 ceiling that `notification`
 * sets, and the compensation this partial would need is 0.118.
 */
export const SUB_OCTAVE_LEVEL = 0.3;

export function withSubOctave(spec) {
  return {
    ...spec,
    cadence: spec.cadence.map((step) => ({
      ...step,
      tones:
        step.tones.length > 0
          ? [{ hz: fundamental(step.tones).hz / 2, level: SUB_OCTAVE_LEVEL }, ...step.tones]
          : [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Measuring what came out
// ---------------------------------------------------------------------------

/** The loudest sample, as a fraction of full scale. */
export function peakOf(samples) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return peak;
}

export function rmsOf(samples) {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

/**
 * A telephone's loudspeaker, modelled as two one-pole high passes at 500 Hz.
 *
 * A model and named as one: no telephone was measured. It is the conservative
 * shape for the platform most people will hear these on, and it exists so that
 * «a sub-octave is wasted on a phone» is a number rather than an opinion —
 * 220 Hz comes through it about 16 dB down.
 */
export function throughPhoneSpeaker(samples, sampleRate = SAMPLE_RATE, cutoffHz = 500) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  let out = Float64Array.from(samples);
  for (let pole = 0; pole < 2; pole += 1) {
    const next = new Float64Array(out.length);
    let previousIn = 0;
    let previousOut = 0;
    for (let index = 0; index < out.length; index += 1) {
      previousOut = alpha * (previousOut + out[index] - previousIn);
      previousIn = out[index];
      next[index] = previousOut;
    }
    out = next;
  }
  return out;
}

function dbfs(value) {
  return value <= 0 ? "-inf " : (20 * Math.log10(value)).toFixed(1);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** 16-bit PCM, mono, as the bytes of a `.wav` file. */
export function wavBytes(samples, sampleRate = SAMPLE_RATE) {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(clamped * 32_767), 44 + index * 2);
  }
  return buffer;
}

/** Several renders laid end to end with silence between them. */
export function sequence(parts, gapsMs) {
  const gaps = parts.map((_, index) => Math.round(((gapsMs[index] ?? 0) / 1000) * SAMPLE_RATE));
  const total = parts.reduce((sum, part, index) => sum + part.length + gaps[index], 0);
  const samples = new Float64Array(total);
  let at = 0;
  for (let index = 0; index < parts.length; index += 1) {
    samples.set(parts[index], at);
    at += parts[index].length + gaps[index];
  }
  return samples;
}

async function main(argv) {
  const refAt = argv.indexOf("--before");
  const ref = refAt === -1 ? BEFORE_REF : argv[refAt + 1];
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const { mod: before, dispose } = await loadRevisionModule(ref);
  try {
    const write = (name, samples) => {
      const file = path.join(OUTPUT_DIR, `${name}.wav`);
      writeFileSync(file, wavBytes(samples));
      return file;
    };

    // The product, as it would sound today.
    const rows = [];
    for (const name of TOUR) {
      const { samples, spanMs } = renderCallSoundSamples(name);
      write(name, samples);
      rows.push({ name, ms: Math.round(spanMs), samples });
    }
    const tour = sequence(
      TOUR.map((name) => renderCallSoundSamples(name).samples),
      TOUR.map(() => 700),
    );
    write("tour", tour);
    const loudGain = 0.7 / peakOf(tour);
    write("tour-amplified", Float64Array.from(tour, (value) => value * loudGain));

    // The candidates, per sound.
    const candidates = {};
    for (const name of VOICE_SOUNDS) {
      const spec = CALL_SOUNDS[name];
      const beforeGain = before.CALL_SOUNDS[name].gain;
      candidates[name] = {
        A: renderSpecSamples(asBefore(spec, beforeGain)).samples,
        B: renderCallSoundSamples(name).samples,
        C: renderSpecSamples(withSubOctave(spec)).samples,
        D: renderSpecSamples(decayOnly(spec, beforeGain)).samples,
      };
      write(`ab-${name}`, sequence(
        [candidates[name].A, candidates[name].B, candidates[name].C, candidates[name].D],
        [400, 400, 400, 0],
      ));
    }

    // The one comparison that decides it: what ships now, then what is proposed.
    write("ab-depth", sequence(
      VOICE_SOUNDS.flatMap((name) => [candidates[name].A, candidates[name].B]),
      VOICE_SOUNDS.flatMap(() => [400, 1_200]),
    ));
    for (const letter of ["A", "B", "C", "D"]) {
      write(`candidate-${letter.toLowerCase()}`, sequence(
        VOICE_SOUNDS.map((name) => candidates[name][letter]),
        VOICE_SOUNDS.map(() => 700),
      ));
    }

    console.log("the product, as it would sound today");
    for (const row of rows) {
      console.log(
        `  ${row.name.padEnd(13)} ${String(row.ms).padStart(5)} ms   peak ${dbfs(peakOf(row.samples))} dBFS   rms ${dbfs(rmsOf(row.samples))}   through a phone ${dbfs(rmsOf(throughPhoneSpeaker(row.samples)))}`,
      );
    }
    console.log("");
    console.log(`the candidates, each against ${ref} (A), through the same telephone model`);
    console.log("  A one sinusoid, straight fall   B partials + exponential (ships)");
    console.log("  C B plus a sub-octave           D exponential only, no partials");
    for (const name of VOICE_SOUNDS) {
      const basePeak = peakOf(candidates[name].A);
      const baseRms = rmsOf(throughPhoneSpeaker(candidates[name].A));
      const deltas = ["A", "B", "C", "D"]
        .map((letter) => {
          const peak = peakOf(candidates[name][letter]);
          const rms = rmsOf(throughPhoneSpeaker(candidates[name][letter]));
          return `${letter} peak ${(20 * Math.log10(peak / basePeak)).toFixed(1).padStart(5)} rms ${(20 * Math.log10(rms / baseRms)).toFixed(1).padStart(5)}`;
        })
        .join("  ");
      console.log(`  ${name.padEnd(7)} ${deltas}`);
    }
    console.log("");
    console.log(`written to ${OUTPUT_DIR}`);
    return 0;
  } finally {
    dispose();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
