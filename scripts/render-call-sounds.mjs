#!/usr/bin/env node
/**
 * Every sound this product makes, as a file somebody can listen to.
 *
 * A sound cannot be photographed and it cannot be reviewed from a diff. The
 * owner judges what they can perceive — that rule is written down after being
 * learned twice on visual work — and for sound that means listening before
 * anything ships.
 *
 * ## It is the player's own arithmetic, not a description of it
 *
 * Nothing about *what* to sound is decided here. Which bursts, when, on which
 * tones, at what level each oscillator gets, and how each burst is shaped are
 * all asked of `lib/callSounds.ts` — `callSoundBursts`, `callSoundToneGain`,
 * `callSoundEnvelope`, `callSoundCycleMs`, the same four `lib/callSoundPlayer.ts`
 * calls and in the same order. This file owns exactly one thing the player
 * hands to Web Audio instead: turning (start, tones, peak, attack, release)
 * into samples, and it reproduces the graph the player builds — one sine per
 * tone, starting at phase zero at the burst's start, linear from silence to
 * peak over the attack, held, linear back to silence over the release.
 *
 * How that sharing is known rather than claimed:
 * `tests/unit/call-sound-render.test.mjs` mutates the spec table and measures
 * the samples. Halve a gain and the rendered peak halves. Change a cadence and
 * the loud windows move to where `callSoundBursts` now puts them. Count the
 * zero crossings inside each of the join's two notes and they come out at the
 * two pitches the spec names. A renderer carrying its own copy of the numbers
 * passes none of those.
 *
 * ## The levels are the real ones
 *
 * These sounds are quiet on purpose — 0.05 to 0.16 of full scale, which is
 * roughly -26 to -16 dBFS — because they play over somebody's conversation.
 * The files are rendered at exactly that, so what is judged is what the product
 * makes. Turn the volume up rather than trusting a normalised copy.
 *
 * The one exception is named so it cannot be mistaken for the others:
 * `tour-amplified.wav` is the same tour with a plain multiplier on it, for
 * judging timbre on a laptop without reaching for the volume. It is not the
 * product's level and must not be used to judge loudness.
 *
 * Usage:
 *   node scripts/render-call-sounds.mjs
 *
 * Writes output/call-sounds/. Nothing on a network is reached and no browser
 * is started.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CALL_SOUNDS,
  callSoundBursts,
  callSoundCycleMs,
  callSoundEnvelope,
  callSoundToneGain,
} from "../artifacts/kub/src/lib/callSounds.ts";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const OUTPUT_DIR = path.join(ROOT, "output", "call-sounds");

export const SAMPLE_RATE = 48_000;

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

/**
 * The gain envelope of one burst at a moment inside it.
 *
 * The shape `callSoundPlayer.ts` asks Web Audio for, read back as a function:
 * `setValueAtTime(0)`, `linearRampToValueAtTime(peak, attack)`, held, then
 * `linearRampToValueAtTime(0, end)`. The attack and release are whatever
 * `callSoundEnvelope` gave for this burst's length — including the case where
 * they were scaled down to fit inside it.
 */
function envelopeAt(tMs, durationMs, attackMs, releaseMs, peak) {
  if (tMs <= 0 || tMs >= durationMs) return 0;
  if (attackMs > 0 && tMs < attackMs) return (peak * tMs) / attackMs;
  const releaseStart = durationMs - releaseMs;
  if (releaseMs > 0 && tMs > releaseStart) return peak * (1 - (tMs - releaseStart) / releaseMs);
  return peak;
}

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
    const { attackMs, releaseMs } = callSoundEnvelope(spec, burst.durationMs);
    const peak = callSoundToneGain(spec, burst);
    const start = Math.round((burst.atMs / 1000) * sampleRate);
    const length = Math.round((burst.durationMs / 1000) * sampleRate);
    for (const frequency of burst.frequencies) {
      for (let index = 0; index < length; index += 1) {
        const seconds = index / sampleRate;
        const amplitude = envelopeAt(seconds * 1000, burst.durationMs, attackMs, releaseMs, peak);
        if (amplitude === 0) continue;
        const at = start + index;
        if (at >= samples.length) break;
        samples[at] += amplitude * Math.sin(2 * Math.PI * frequency * seconds);
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

/** The loudest sample, as a fraction of full scale. */
export function peakOf(samples) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return peak;
}

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

/** The order the tour plays: the three that existed, then the four that are new. */
export const TOUR = ["ring", "ringback", "notification", "join", "leave", "mute", "unmute"];

/** Every sound in order, with a gap between them. */
function renderTour(gapMs = 700) {
  const parts = TOUR.map((name) => renderCallSoundSamples(name));
  const gap = Math.round((gapMs / 1000) * SAMPLE_RATE);
  const total = parts.reduce((sum, part) => sum + part.samples.length + gap, 0);
  const samples = new Float64Array(total);
  let at = 0;
  for (const part of parts) {
    samples.set(part.samples, at);
    at += part.samples.length + gap;
  }
  return samples;
}

function dbfs(peak) {
  return peak <= 0 ? "-inf" : (20 * Math.log10(peak)).toFixed(1);
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const written = [];
  for (const name of TOUR) {
    const { samples, spanMs } = renderCallSoundSamples(name);
    const file = path.join(OUTPUT_DIR, `${name}.wav`);
    writeFileSync(file, wavBytes(samples));
    written.push({ name, file, ms: Math.round(spanMs), peak: peakOf(samples) });
  }

  const tour = renderTour();
  const tourFile = path.join(OUTPUT_DIR, "tour.wav");
  writeFileSync(tourFile, wavBytes(tour));
  written.push({ name: "tour", file: tourFile, ms: Math.round((tour.length / SAMPLE_RATE) * 1000), peak: peakOf(tour) });

  // The one file that is not the product's level, named so it cannot be
  // mistaken for one that is.
  const loudGain = 0.7 / peakOf(tour);
  const loud = Float64Array.from(tour, (value) => value * loudGain);
  const loudFile = path.join(OUTPUT_DIR, "tour-amplified.wav");
  writeFileSync(loudFile, wavBytes(loud));

  for (const row of written) {
    console.log(`${row.name.padEnd(13)} ${String(row.ms).padStart(6)} ms   peak ${row.peak.toFixed(4)} (${dbfs(row.peak)} dBFS)   ${row.file}`);
  }
  console.log(`tour-amplified  x${loudGain.toFixed(1)} of the above, for timbre only   ${loudFile}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
