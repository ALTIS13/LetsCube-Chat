#!/usr/bin/env node
/**
 * What the player would actually do with a sound, as a table two versions of
 * `lib/callSounds.ts` can be compared on.
 *
 * Written for one job: the cadence model grew a per-burst pitch list on
 * 2026-09-19, and «the three existing sounds are unchanged» had to be proved
 * rather than asserted. A spec's fields are the wrong thing to compare — they
 * are exactly what changed shape. What the ear hears is the sequence of
 * **bursts**: when each one starts, how long it runs, which tones it sounds,
 * what level each oscillator is given, and how the burst is shaped. That
 * sequence is what this builds, and it is built by calling the module's own
 * four pure functions rather than by re-deriving anything.
 *
 * `callSoundPlan` deliberately reads **either** shape, because its whole job is
 * to compare two of them:
 *
 *  - a burst carries `frequencies` in the new model and the spec carries them
 *    in the old one;
 *  - `callSoundToneGain` takes the burst as well as the spec in the new model,
 *    and only the spec in the old one. Its arity says which.
 *
 * Usage:
 *   node scripts/call-sound-baseline.mjs --print
 *   node scripts/call-sound-baseline.mjs --against HEAD
 *
 * `--against` extracts `lib/callSounds.ts` at that git revision into a scratch
 * directory, plans the same sounds with it, and diffs. It exits non-zero on any
 * difference, and it prints both rows so the difference can be read rather than
 * looked for.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MODULE_PATH = "artifacts/kub/src/lib/callSounds.ts";

/**
 * How many cadence cycles to plan.
 *
 * Four rather than one: a looping sound's second cycle is where an off-by-one
 * in the cycle arithmetic shows up, and the fourth is past any «first time
 * round» special case. A sound that does not loop answers with its one cycle
 * however wide the window, which is itself part of what is being pinned.
 */
export const BASELINE_CYCLES = 4;

/** The sounds that existed before the model grew, and must not have moved. */
export const BASELINE_SOUNDS = ["ring", "ringback", "notification"];

/**
 * The sounds whose **timbre** was allowed to change on 2026-09-19.
 *
 * Their levels moved on purpose and their pitches and lengths did not, so they
 * are diffed on a skeleton rather than on a plan. Without this the report would
 * be silent about the four sounds most likely to be broken by a timbre change.
 */
export const TIMBRE_SOUNDS = ["join", "leave", "mute", "unmute"];

/**
 * The voices of one burst, as `{hz, gain}`, whichever model the module uses.
 *
 * Three shapes have existed and the arity of `callSoundToneGain` tells them
 * apart, because that is the function each change had to alter:
 *
 *  - **1** — the oldest: frequencies on the spec, one level for the whole sound;
 *  - **2** — frequencies on the burst, one level for the whole burst;
 *  - **3** — tones on the burst, each with its own share of the level.
 */
function burstVoices(mod, spec, burst) {
  const arity = mod.callSoundToneGain.length;
  if (arity >= 3) {
    return burst.tones.map((tone) => ({
      hz: tone.hz,
      gain: mod.callSoundToneGain(spec, burst, tone),
    }));
  }
  const gain = arity === 2 ? mod.callSoundToneGain(spec, burst) : mod.callSoundToneGain(spec);
  return [...(burst.frequencies ?? spec.frequencies)].map((hz) => ({ hz, gain }));
}

/** One burst, as everything that decides what it sounds like. */
export function callSoundPlan(mod, name, cycles = BASELINE_CYCLES) {
  const spec = mod.CALL_SOUNDS[name];
  if (!spec) throw new Error(`no such sound: ${name}`);
  return callSoundPlanForSpec(mod, spec, cycles);
}

/**
 * The same for a spec the table does not hold.
 *
 * Exists so that a *candidate* can be planned with the module's own functions.
 * The «before» side of the owner's A/B is a spec built by projecting a shipped
 * sound back to one sinusoid, and the only way to know the projection is right
 * is to plan it and diff it against what really produced that sound.
 */
export function callSoundPlanForSpec(mod, spec, cycles = BASELINE_CYCLES) {
  const cycle = mod.callSoundCycleMs(spec);
  const bursts = mod.callSoundBursts(spec, { fromMs: 0, untilMs: cycle * cycles });
  return bursts.map((burst) => {
    const envelope = mod.callSoundEnvelope(spec, burst.durationMs);
    return {
      atMs: burst.atMs,
      durationMs: burst.durationMs,
      // A module from before the shape was a field had exactly one shape, and
      // it was this one. Saying so is what makes «identical» cover how a burst
      // falls as well as when it sounds — a diff blind to the envelope would
      // have reported three unchanged sounds while all three had been restruck.
      decay: spec.decay ?? "linear",
      voices: burstVoices(mod, spec, burst),
      attackMs: envelope.attackMs,
      releaseMs: envelope.releaseMs,
    };
  });
}

/**
 * The same, reduced to what a timbre change may not touch: when each note
 * starts, how long it runs, and what pitch it is.
 *
 * The fundamental is the loudest voice of the burst, which is what a
 * fundamental is — and for a module whose voices are all equal, it is simply
 * the first, which is the single tone those sounds had.
 */
export function callSoundSkeleton(mod, name, cycles = 1) {
  return callSoundPlan(mod, name, cycles).map((row) => ({
    atMs: row.atMs,
    durationMs: row.durationMs,
    fundamentalHz: row.voices.reduce((best, voice) => (voice.gain > best.gain ? voice : best)).hz,
  }));
}

/** The plan for every sound named, keyed by name. */
export function callSoundPlans(mod, names = BASELINE_SOUNDS, cycles = BASELINE_CYCLES) {
  const out = {};
  for (const name of names) out[name] = callSoundPlan(mod, name, cycles);
  return out;
}

/** The module as it is in the working tree. */
export async function loadWorkingModule() {
  return import(pathToFileURL(path.join(ROOT, MODULE_PATH)).href);
}

/**
 * The module as it is at a git revision.
 *
 * The bytes are written as bytes. A text write on Windows rewrites every
 * newline, and a module whose bytes differ from the revision's is not the
 * revision's module — see the note in CLAUDE.md that cost a cycle already.
 */
export async function loadRevisionModule(ref) {
  const bytes = execFileSync("git", ["show", `${ref}:${MODULE_PATH}`], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  const dir = mkdtempSync(path.join(tmpdir(), "call-sound-baseline-"));
  const file = path.join(dir, "callSounds.ts");
  writeFileSync(file, bytes);
  const mod = await import(pathToFileURL(file).href);
  return { mod, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

function rowText(row) {
  if (row.fundamentalHz !== undefined) {
    return `at ${row.atMs}ms  for ${row.durationMs}ms  on ${row.fundamentalHz}Hz`;
  }
  const tones = row.voices.map((voice) => `${voice.hz}@${voice.gain.toFixed(5)}`).join(" + ");
  return [
    `at ${row.atMs}ms`,
    `for ${row.durationMs}ms`,
    `${tones}`,
    `attack ${row.attackMs}ms`,
    `${row.decay} release ${row.releaseMs}ms`,
  ].join("  ");
}

function compare(before, after) {
  const problems = [];
  for (const name of Object.keys(before)) {
    const a = before[name];
    const b = after[name] ?? [];
    if (a.length !== b.length) {
      problems.push(`${name}: ${a.length} bursts before, ${b.length} after`);
      continue;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (JSON.stringify(a[index]) === JSON.stringify(b[index])) continue;
      problems.push(`${name} burst ${index}:`);
      problems.push(`  before  ${rowText(a[index])}`);
      problems.push(`  after   ${rowText(b[index])}`);
    }
  }
  return problems;
}

async function main(argv) {
  const againstAt = argv.indexOf("--against");
  const working = await loadWorkingModule();
  if (againstAt === -1) {
    const plans = callSoundPlans(working);
    console.log(JSON.stringify(plans, null, 2));
    return 0;
  }
  const ref = argv[againstAt + 1];
  if (!ref) {
    console.error("--against needs a git revision");
    return 2;
  }
  const { mod, dispose } = await loadRevisionModule(ref);
  try {
    const before = callSoundPlans(mod);
    const after = callSoundPlans(working);
    const problems = compare(before, after);
    for (const name of BASELINE_SOUNDS) {
      console.log(`${name}: ${before[name].length} bursts over ${BASELINE_CYCLES} cycles`);
      for (const row of before[name]) console.log(`  ${rowText(row)}`);
    }

    // The four whose timbre was allowed to move. Only compared where the
    // revision has them at all, so this still works against a revision from
    // before they existed — and it says which, rather than passing quietly.
    const shared = TIMBRE_SOUNDS.filter((name) => mod.CALL_SOUNDS[name] && working.CALL_SOUNDS[name]);
    const skeletonsBefore = {};
    const skeletonsAfter = {};
    for (const name of shared) {
      skeletonsBefore[name] = callSoundSkeleton(mod, name);
      skeletonsAfter[name] = callSoundSkeleton(working, name);
    }
    const skeletonProblems = compare(skeletonsBefore, skeletonsAfter);
    console.log("");
    for (const name of shared) {
      console.log(`${name}: pitches and lengths`);
      for (const row of skeletonsBefore[name]) console.log(`  ${rowText(row)}`);
    }
    if (shared.length < TIMBRE_SOUNDS.length) {
      console.log(`  (${TIMBRE_SOUNDS.filter((n) => !shared.includes(n)).join(", ")} absent at ${ref})`);
    }

    console.log("");
    if (problems.length === 0 && skeletonProblems.length === 0) {
      console.log(`identical to ${ref} for: ${BASELINE_SOUNDS.join(", ")}`);
      if (shared.length > 0) {
        console.log(`same pitches and lengths at ${ref} for: ${shared.join(", ")}`);
      }
      return 0;
    }
    console.log(`DIFFERENT from ${ref}:`);
    for (const line of [...problems, ...skeletonProblems]) console.log(line);
    return 1;
  } finally {
    dispose();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
