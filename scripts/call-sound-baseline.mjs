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

/** One burst, as everything that decides what it sounds like. */
export function callSoundPlan(mod, name, cycles = BASELINE_CYCLES) {
  const spec = mod.CALL_SOUNDS[name];
  if (!spec) throw new Error(`no such sound: ${name}`);
  const cycle = mod.callSoundCycleMs(spec);
  const bursts = mod.callSoundBursts(spec, { fromMs: 0, untilMs: cycle * cycles });
  return bursts.map((burst) => {
    const frequencies = [...(burst.frequencies ?? spec.frequencies)];
    const toneGain =
      mod.callSoundToneGain.length >= 2
        ? mod.callSoundToneGain(spec, burst)
        : mod.callSoundToneGain(spec);
    const envelope = mod.callSoundEnvelope(spec, burst.durationMs);
    return {
      atMs: burst.atMs,
      durationMs: burst.durationMs,
      frequencies,
      toneGain,
      attackMs: envelope.attackMs,
      releaseMs: envelope.releaseMs,
    };
  });
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
  const tones = row.frequencies.join("+");
  return [
    `at ${row.atMs}ms`,
    `for ${row.durationMs}ms`,
    `tones ${tones}`,
    `gain/osc ${row.toneGain}`,
    `attack ${row.attackMs}ms`,
    `release ${row.releaseMs}ms`,
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
    if (problems.length === 0) {
      console.log("");
      console.log(`identical to ${ref} for: ${BASELINE_SOUNDS.join(", ")}`);
      return 0;
    }
    console.log("");
    console.log(`DIFFERENT from ${ref}:`);
    for (const line of problems) console.log(line);
    return 1;
  } finally {
    dispose();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
