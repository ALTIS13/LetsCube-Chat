import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../scripts/ops/uptime-canary.mjs", import.meta.url), "utf8")
  .replaceAll("\r\n", "\n");
const suite = readFileSync(new URL("../unit/uptime-canary.test.mjs", import.meta.url), "utf8");
const mutants = [
  ["poll slot length", "POLL_SECONDS = 60", "POLL_SECONDS = 30"],
  ["observation age", "MAX_SAMPLE_AGE_SECONDS = 120", "MAX_SAMPLE_AGE_SECONDS = 121"],
  ["future observations", "observedAt <= now && ", ""],
  ["old slots", "slot <= state.lastSlot", "slot === state.lastSlot"],
  ["duplicate slots", "slot <= state.lastSlot", "slot < state.lastSlot"],
  ["two confirmations", "vote && state.pendingAt !== null && slot === state.lastSlot + 1 &&\n    now - state.pendingAt <= MAX_SAMPLE_AGE_SECONDS", "vote"],
  ["missing slot", "slot === state.lastSlot + 1 &&", ""],
  ["expired previous vote", " &&\n    now - state.pendingAt <= MAX_SAMPLE_AGE_SECONDS", ""],
  ["unknown resets", "pendingAt: vote ? observedAt : null", 'pendingAt: vote ? observedAt : outcome === "UNKNOWN" ? state.pendingAt : null'],
  ["private fields", "Object.keys(sample).length !== 2 || ", ""],
  ["retired fence", 'state.phase === "RETIRED" || ', ""],
  ["retirement is not recovery", 'notice("RETIRED",', 'notice("RECOVERED",'],
];

function run(candidate) {
  // Load each variant in a fresh Node process without writing to the checkout.
  const url = "data:text/javascript;base64," + Buffer.from(candidate).toString("base64");
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: suite.replace("../../scripts/ops/uptime-canary.mjs", url),
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

const baseline = run(source);
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
assert.match(baseline.stdout, /\btests 10\b/);
console.log("PASS unmodified uptime canary control (10 tests)");
for (const [label, before, after] of mutants) {
  assert.equal(source.split(before).length, 2, label + ": unique anchor");
  const result = run(source.replace(before, after));
  assert.equal(result.status, 1, label + ": mutation must fail");
  assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/, label + ": must fail an assertion");
  console.log("KILLED " + label);
}
