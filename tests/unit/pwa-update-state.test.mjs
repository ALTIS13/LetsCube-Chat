import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createPwaUpdateState, PWA_UPDATE_RECEIPT_KEY, PWA_UPDATE_TIMEOUT_MS, PWA_UPDATE_SUCCESS_MS } from "../../artifacts/kub/src/lib/pwa/pwaUpdateState.ts";

const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { transformSync } = createRequire(requireKub.resolve("vite"))("esbuild");
const source = readFileSync(new URL("../../artifacts/kub/src/lib/pwa/pwaUpdateState.ts", import.meta.url), "utf8");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const old = "/assets/index-old.js", next = "/assets/index-new.js";

function fixture(factory = createPwaUpdateState, options = {}) {
  const data = new Map(options.receipt ? [[PWA_UPDATE_RECEIPT_KEY, JSON.stringify(options.receipt)]] : []);
  const proof = { checks: 0, restarts: 0, resumes: 0, disposed: 0, signals: [], restart: null };
  const ports = {
    entry: old,
    storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) },
    async check(signal) { proof.checks++; proof.signals.push(signal); return { entry: next, registration: null, waiting: false }; },
    restart(registration, handlers) { proof.restarts++; proof.restart = handlers; return () => { proof.disposed++; }; },
    guard: () => null,
    beforeRestart() { proof.resumes++; },
    ...options.ports,
  };
  const state = factory(ports);
  return { state, proof, data, ports };
}

test("bounded check deduplicates consumers, fails at literal10s and ignores a late answer", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const held = deferred(), f = fixture(createPwaUpdateState, { ports: { check: () => held.promise } });
  const first = f.state.check(), second = f.state.check();
  assert.equal(first, second);
  assert.equal(f.state.getSnapshot().phase, "checking");
  t.mock.timers.tick(9_999); await Promise.resolve();
  assert.equal(f.state.getSnapshot().phase, "checking");
  t.mock.timers.tick(1); await first;
  assert.equal(f.state.getSnapshot().phase, "failed");
  assert.equal(f.state.getSnapshot().failure, "check");
  held.resolve({ entry: next, registration: null, waiting: false }); await Promise.resolve();
  assert.equal(f.state.getSnapshot().phase, "failed"); f.state.dispose();
});

test("ready -> updating is single-flight; a thrown restart becomes retryable, not endless pending", async () => {
  let throws = true;
  const f = fixture(createPwaUpdateState, { ports: { restart() { if (throws) throw Error("synthetic"); return () => {}; } } });
  await f.state.check(); f.state.apply();
  assert.equal(f.state.getSnapshot().phase, "failed");
  throws = false; f.state.apply();
  assert.equal(f.state.getSnapshot().phase, "updating"); f.state.dispose();
  const one = fixture(); await one.state.check(); one.state.apply(); one.state.apply();
  assert.equal(one.proof.restarts, 1); one.state.dispose();
});

test("missing navigation has a finite10s failure and releases its restart listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); await f.state.check(); f.state.apply();
  t.mock.timers.tick(9_999); assert.equal(f.state.getSnapshot().phase, "updating");
  t.mock.timers.tick(1); assert.equal(f.state.getSnapshot().phase, "failed");
  assert.equal(f.proof.disposed, 1); assert.equal(f.data.size, 0); f.state.dispose();
});

test("reload re-reads the safety guard after activation delay, before persisting a success candidate", async () => {
  let blocked = false;
  const f = fixture(createPwaUpdateState, { ports: { guard: () => blocked ? "blocked" : null } });
  await f.state.check(); f.state.apply(); blocked = true;
  assert.equal(f.proof.restart.beforeReload(), false);
  assert.equal(f.state.getSnapshot().failure, "blocked"); assert.equal(f.proof.resumes, 0); assert.equal(f.data.size, 0);
  blocked = false; f.state.apply(); assert.equal(f.proof.restart.beforeReload(), true);
  assert.equal(f.proof.resumes, 1);
  assert.deepEqual(JSON.parse(f.data.get(PWA_UPDATE_RECEIPT_KEY)), { from: old, target: next, at: JSON.parse(f.data.get(PWA_UPDATE_RECEIPT_KEY)).at, quiet: false });
  f.state.dispose();
});

test("boot success requires the actual expected entry, never controllerchange or same/stale document", () => {
  for (const entry of [old, "/assets/index-unexpected.js", next]) {
    const f = fixture(createPwaUpdateState, { receipt: { from: old, target: next, at: Date.now(), quiet: false }, ports: { entry } });
    assert.equal(f.state.getSnapshot().phase, entry === next ? "updated" : "failed");
    assert.equal(f.data.size, 0, "receipt is consumed once"); f.state.dispose();
  }
  const stale = fixture(createPwaUpdateState, { receipt: { from: old, target: next, at: Date.now() - 600_001 }, ports: { entry: next } });
  assert.equal(stale.state.getSnapshot().phase, "idle"); stale.state.dispose();
});

test("success notice is brief and quiet restarts remain quiet", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const f = fixture(createPwaUpdateState, { receipt: { from: old, target: next, at: Date.now() }, ports: { entry: next } });
  assert.equal(f.state.getSnapshot().phase, "updated");
  t.mock.timers.tick(4_199); assert.equal(f.state.getSnapshot().phase, "updated");
  t.mock.timers.tick(1); assert.equal(f.state.getSnapshot().phase, "current"); assert.equal(f.state.getSnapshot().notice, false);
  const quiet = fixture(createPwaUpdateState, { receipt: { from: old, target: next, at: Date.now(), quiet: true }, ports: { entry: next } });
  assert.equal(quiet.state.getSnapshot().phase, "current"); assert.equal(quiet.state.getSnapshot().notice, false);
  f.state.dispose(); quiet.state.dispose();
});

test("stopped check cannot overwrite a newer mounted lifetime, including StrictMode reacquire", async () => {
  const held = deferred(); let count = 0;
  const f = fixture(createPwaUpdateState, { ports: { check: () => ++count === 1 ? held.promise : Promise.resolve({ entry: old, registration: null, waiting: false }) } });
  const first = f.state.check(); f.state.dispose(); await f.state.check();
  assert.equal(f.state.getSnapshot().phase, "current");
  held.resolve({ entry: next, registration: null, waiting: false }); await first;
  assert.equal(f.state.getSnapshot().phase, "current"); assert.equal(f.state.getSnapshot().available, false); f.state.dispose();
});

test("routine background failure preserves a known update without a noisy error notice", async () => {
  const f = fixture(createPwaUpdateState, { ports: { check: async () => { throw Error("synthetic-offline"); } } });
  f.state.announce({}); await f.state.check(false);
  assert.equal(f.state.getSnapshot().phase, "ready"); assert.equal(f.state.getSnapshot().notice, false);
  await f.state.check(true); assert.equal(f.state.getSnapshot().phase, "failed"); f.state.dispose();
});

test("exact call proof reaches both guards in RAM, never receipt; quiet has no inherited proof", async () => {
  let call = { phase: 'connected', channelId: 'synthetic-a' };
  const initial = call, observed = [];
  const guard = proof => { observed.push(proof); return proof === call ? null : 'call'; };
  const f = fixture(createPwaUpdateState, { ports: { guard } });
  await f.state.check();f.state.apply({ confirmedCall: initial });
  assert.equal(observed[0], initial);
  assert.equal(f.proof.restart.beforeReload(), true);
  assert.equal(observed[1], initial);
  assert.equal(f.proof.resumes, 1);
  assert.deepEqual(Object.keys(JSON.parse(f.data.get(PWA_UPDATE_RECEIPT_KEY))).sort(), ['at', 'from', 'quiet', 'target']);
  f.state.dispose();
  const late = fixture(createPwaUpdateState, { ports: { guard } });
  await late.state.check();late.state.apply({ confirmedCall: initial });
  call = { phase: 'connected', channelId: 'synthetic-a' };
  assert.equal(late.proof.restart.beforeReload(), false);
  assert.equal(late.proof.resumes, 0);assert.equal(late.data.size, 0);
  assert.equal(late.state.getSnapshot().failure, 'call');late.state.dispose();
  const quiet = fixture(createPwaUpdateState, { ports: { guard } });
  await quiet.state.check();quiet.state.apply({ quiet: true });
  assert.equal(observed.at(-1), null);assert.equal(quiet.proof.restarts, 0);
  assert.equal(quiet.state.getSnapshot().notice, false);quiet.state.dispose();
});

test("literal omissions fail the late-guard, actual-entry and finite-timeout oracles", async () => {
  assert.equal(PWA_UPDATE_TIMEOUT_MS, 10_000); assert.equal(PWA_UPDATE_SUCCESS_MS, 4_200);
  const load = async (from, to) => {
    assert.ok(source.includes(from));
    const js = transformSync(source.replace(from, to), { loader: "ts", format: "esm" }).code;
    return (await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"))).createPwaUpdateState;
  };
  const unguarded = fixture(await load("const lateRefusal = ports.guard(confirmedCall);", "const lateRefusal = null;"), { ports: { guard: () => null } });
  await unguarded.state.check(); unguarded.state.apply(); unguarded.ports.guard = () => "blocked";
  assert.throws(() => assert.equal(unguarded.proof.restart.beforeReload(), false)); unguarded.state.dispose();
  const falseSuccess = fixture(await load("ports.entry !== receipt.from", "true"), { receipt: { from: old, at: Date.now() } });
  assert.throws(() => assert.equal(falseSuccess.state.getSnapshot().phase, "failed")); falseSuccess.state.dispose();
  const js = transformSync(source.replace("PWA_UPDATE_TIMEOUT_MS = 10_000", "PWA_UPDATE_TIMEOUT_MS = 100_000"), { loader: "ts", format: "esm" }).code;
  const changed = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
  assert.throws(() => assert.equal(changed.PWA_UPDATE_TIMEOUT_MS, 10_000));
});
