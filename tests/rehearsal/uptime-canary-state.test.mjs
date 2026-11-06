import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createUptimeCanaryState, openUptimeCanaryState } from "../../scripts/ops/uptime-canary-state.mjs";

const moduleUrl = new URL("../../scripts/ops/uptime-canary-state.mjs", import.meta.url).href;
const start = 1_800_000_000;
const sample = (observedAt, outcome = "FAIL") => ({ observedAt, outcome });
const idFor = (runId, at, kind) => createHash("sha256")
  .update(JSON.stringify(["uptime-canary", runId, at, kind])).digest("hex");

function fixture(t, verifyQaReceipt) {
  const root = realpathSync(tmpdir());
  const directory = mkdtempSync(join(root, "letscube-canary-state-"));
  const file = join(directory, "state.sqlite");
  let now = start;
  let clockReadings = [];
  const options = { directory, runId: randomUUID(), clock: () => clockReadings.shift() ?? now, verifyQaReceipt };
  const handles = [];
  t.after(() => {
    for (const store of handles.reverse()) store.close();
    assert.equal(dirname(realpathSync(directory)), root);
    assert.match(basename(directory), /^letscube-canary-state-[A-Za-z0-9]+$/);
    rmSync(directory, { recursive: true });
  });
  const create = (expiresAt = start + 1200) => {
    const store = createUptimeCanaryState({ ...options, startsAt: start, expiresAt });
    handles.push(store);
    return store;
  };
  const open = () => {
    const store = openUptimeCanaryState(options);
    handles.push(store);
    return store;
  };
  const tick = at => { now = at; };
  const clockSteps = (...readings) => { clockReadings = readings; now = readings.at(-1); };
  const first = store => assert.equal(store.observe(sample(start)), null);
  const second = store => {
    tick(start + 60);
    const event = store.observe(sample(start + 60));
    assert.equal(event?.id, idFor(options.runId, start + 60, "OPENED"));
    return event;
  };
  return { create, open, first, second, tick, clockSteps, file, directory, runId: options.runId };
}

test("reopen preserves pending votes and the unique exact event committed with its reducer transition", t => {
  const f = fixture(t);
  const original = f.create();
  f.first(original);
  original.close();
  const reopened = f.open();
  const event = f.second(reopened);
  assert.equal(reopened.observe(sample(start + 60)), null);
  reopened.close();
  const snapshot = f.open().snapshot();
  assert.equal(snapshot.state.phase, "OPEN");
  assert.equal(snapshot.state.incidentOpenedAt, start + 60);
  assert.equal(snapshot.state.pendingAt, null);
  assert.equal(snapshot.events.length, 1);
  assert.deepEqual(snapshot.events[0], {
    id: event.id, kind: "OPENED", incidentOpenedAt: start + 60, emittedAt: start + 60,
    dispatch: "NOT_CLAIMED", intentAt: null, dispatchAckAt: null, qaReceiptAt: null,
  });
});

test("a real SQLite event insert failure rolls back the reducer transition as well", t => {
  const f = fixture(t);
  const original = f.create();
  f.first(original);
  original.close();
  const injector = new DatabaseSync(f.file);
  try {
    injector.exec("CREATE TRIGGER force_failure BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'fictional diagnostic'); END");
    const reopened = f.open();
    f.tick(start + 60);
    assert.throws(() => reopened.observe(sample(start + 60)), { message: "STATE_WRITE_FAILED" });
    reopened.close();
    const unchanged = f.open();
    assert.equal(unchanged.snapshot().state.phase, "WATCHING");
    assert.equal(unchanged.snapshot().state.pendingAt, start);
    assert.equal(unchanged.snapshot().events.length, 0);
    unchanged.close();
    injector.exec("DROP TRIGGER force_failure");
    assert.equal(f.second(f.open()).kind, "OPENED");
  } finally {
    injector.close();
  }
});

test("process exit after committed intent leaves UNKNOWN_ACK and cannot release the claim on restart", t => {
  const f = fixture(t, ({ event, evidence }) =>
    evidence === "fictional independent match" ? { eventId: event.eventId, receivedAt: start + 61 } : null);
  const original = f.create();
  f.first(original);
  const event = f.second(original);
  original.close();
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { openUptimeCanaryState } from ${JSON.stringify(moduleUrl)};
    const input = JSON.parse(process.argv[1]);
    const state = openUptimeCanaryState({ directory: input.directory, runId: input.runId, clock: () => input.now });
    if (!state.claim(input.eventId)) process.exit(20);
    process.exit(73);
  `, JSON.stringify({ directory: f.directory, runId: f.runId, eventId: event.id, now: start + 60 })],
  { timeout: 10000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 73, result.stderr);
  f.tick(start + 62);
  const reopened = f.open();
  assert.equal(reopened.claim(event.id), null);
  assert.equal(reopened.snapshot().events[0].dispatch, "ACK_UNKNOWN");
  assert.equal(reopened.snapshot().events[0].intentAt, start + 60);
  assert.equal(reopened.snapshot().events[0].qaReceiptAt, null);
  assert.equal(reopened.recordQaReceipt(event.id, "fictional independent match"), true);
  assert.equal(reopened.snapshot().events[0].qaReceiptAt, start + 61);
  assert.equal(reopened.snapshot().events[0].dispatch, "ACK_UNKNOWN");
  assert.equal(reopened.claim(event.id), null);
});

async function race(input) {
  const code = `
    import { openUptimeCanaryState } from ${JSON.stringify(moduleUrl)};
    const data = JSON.parse(process.argv[1]);
    const store = openUptimeCanaryState({ directory: data.directory, runId: data.runId, clock: () => data.now });
    process.once("message", () => {
      const value = data.kind === "claim" ? store.claim(data.id) : store.observe(data.sample);
      store.close();
      process.send({ won: value !== null }, () => process.disconnect());
    });
    process.send({ ready: true });
  `;
  const children = Array.from({ length: 2 }, () => spawn(process.execPath,
    ["--input-type=module", "-e", code, JSON.stringify(input)],
    { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true }));
  let release, rejectReady, readyCount = 0;
  const ready = new Promise((ok, fail) => { release = ok; rejectReady = fail; });
  const settled = children.map(child => new Promise(resolve => {
    let won, error;
    child.on("error", cause => { error = cause; rejectReady(cause); });
    child.on("message", msg => {
      if (msg.ready && ++readyCount === 2) release();
      if (typeof msg.won === "boolean") won = msg.won;
    });
    child.once("close", code => {
      if (typeof won !== "boolean" || code !== 0) rejectReady(new Error("worker did not complete"));
      resolve({ code, won, error });
    });
  }));
  let timer;
  const timeout = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error("worker timeout")), 10000); });
  try {
    await Promise.race([ready, timeout]);
    for (const child of children) child.send("go");
    const done = await Promise.race([Promise.all(settled), timeout]);
    assert.ok(done.every(x => x.code === 0 && typeof x.won === "boolean" && !x.error));
    return done.map(x => x.won).sort();
  } finally {
    clearTimeout(timer);
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    await Promise.all(settled);
  }
}

test("two actual writers can confirm one transition and obtain only one dispatch claim", async t => {
  const f = fixture(t);
  const store = f.create();
  f.first(store);
  const input = { directory: f.directory, runId: f.runId, now: start + 60 };
  assert.deepEqual(await race({ ...input, kind: "observe", sample: sample(start + 60) }), [false, true]);
  const [event] = store.snapshot().events;
  assert.equal(event.id, idFor(f.runId, start + 60, "OPENED"));
  assert.deepEqual(await race({ ...input, kind: "claim", id: event.id }), [false, true]);
  const after = store.snapshot().events;
  assert.equal(after.length, 1);
  assert.equal(after[0].dispatch, "ACK_UNKNOWN");
});

test("transport ACK and injected exact recipient decision are distinct and persist only redacted evidence", t => {
  const secret = "fictional-provider-body-NEVER-PERSIST";
  const f = fixture(t, ({ event, evidence }) => {
    if (evidence === "throw") throw new Error(secret);
    return { eventId: evidence.id ?? event.eventId, receivedAt: evidence.at, ...evidence.extra };
  });
  const store = f.create();
  assert.equal(store.observe({ ...sample(start), endpoint: secret }), null);
  assert.equal(store.snapshot().state.lastSlot, null);
  f.first(store);
  const event = f.second(store);
  assert.equal(store.recordQaReceipt(event.id, { at: start + 60 }), false);
  const claim = store.claim(event.id);
  assert.deepEqual(claim.envelope, { monitor: "uptime-canary", runId: f.runId, eventId: event.id,
    kind: "OPENED", incidentOpenedAt: start + 60 });
  assert.match(claim.attemptId, /^[a-f0-9-]{36}$/);
  const ack = { eventId: event.id, attemptId: claim.attemptId };
  f.tick(start + 64);
  assert.equal(store.recordDispatchAck({ ...ack, attemptId: randomUUID() }), false);
  assert.equal(store.recordDispatchAck({ ...ack, body: secret }), false);
  assert.equal(store.recordDispatchAck(ack), true);
  assert.equal(store.recordDispatchAck(ack), false);
  assert.equal(store.snapshot().events[0].dispatch, "ACKNOWLEDGED");
  assert.equal(store.snapshot().events[0].qaReceiptAt, null);
  assert.equal(store.recordQaReceipt(event.id, { id: "a".repeat(64), at: start + 61 }), false);
  assert.equal(store.recordQaReceipt(event.id, { at: start + 59 }), false);
  assert.equal(store.recordQaReceipt(event.id, { at: start + 65 }), false);
  assert.equal(store.recordQaReceipt(event.id, { at: start + 61, extra: { body: secret } }), false);
  assert.throws(() => store.recordQaReceipt(event.id, "throw"), { message: "QA_DECISION_FAILED" });
  assert.equal(store.recordQaReceipt(event.id, { at: start + 61, raw: secret }), true);
  assert.equal(store.recordQaReceipt(event.id, { at: start + 62 }), false);
  store.close();
  const snapshot = f.open().snapshot();
  assert.equal(snapshot.events[0].dispatchAckAt, start + 64);
  assert.equal(snapshot.events[0].qaReceiptAt, start + 61);
  assert.ok(!JSON.stringify(snapshot).includes(claim.attemptId));
  assert.ok(!JSON.stringify(snapshot).includes(secret));
  for (const name of readdirSync(f.directory)) {
    assert.ok(!readFileSync(join(f.directory, name)).includes(Buffer.from(secret)));
  }
});

test("an unresolved intent fences other claims until independent reconciliation, without replaying the first", t => {
  const f = fixture(t, ({ event, evidence }) =>
    evidence === "exact" ? { eventId: event.eventId, receivedAt: start + 62 } : null);
  const store = f.create();
  f.first(store);
  const opened = f.second(store);
  assert.ok(store.claim(opened.id));
  f.tick(start + 120);
  assert.equal(store.observe(sample(start + 120, "PASS")), null);
  f.tick(start + 180);
  const recovered = store.observe(sample(start + 180, "PASS"));
  assert.equal(recovered.kind, "RECOVERED");
  assert.equal(store.claim(recovered.id), null);
  assert.equal(store.recordQaReceipt(opened.id, "exact"), true);
  assert.equal(store.claim(opened.id), null);
  assert.equal(store.claim(recovered.id)?.envelope.kind, "RECOVERED");
});

test("normal claims cannot overtake earlier unclaimed events after reopening", t => {
  const f = fixture(t);
  const store = f.create();
  f.first(store);
  const opened = f.second(store);
  f.tick(start + 120);
  assert.equal(store.observe(sample(start + 120, "PASS")), null);
  f.tick(start + 180);
  const recovered = store.observe(sample(start + 180, "PASS"));
  f.tick(start + 240);
  assert.equal(store.observe(sample(start + 240)), null);
  f.tick(start + 300);
  const laterOpened = store.observe(sample(start + 300));
  store.close();

  const reopened = f.open();
  assert.equal(recovered.kind, "RECOVERED");
  assert.equal(laterOpened.kind, "OPENED");
  assert.equal(reopened.claim(recovered.id), null, "recovery cannot precede its opening");
  assert.equal(reopened.claim(laterOpened.id), null, "a later incident cannot skip pending events");
  assert.deepEqual(reopened.snapshot().events.map(event => event.intentAt), [null, null, null]);

  const ack = id => {
    const { eventId, attemptId } = reopened.claim(id);
    assert.equal(eventId, id);
    assert.equal(reopened.recordDispatchAck({ eventId, attemptId }), true);
  };
  ack(opened.id);
  assert.equal(reopened.claim(laterOpened.id), null, "ACK does not skip the next unclaimed event");
  ack(recovered.id);
  assert.equal(reopened.claim(laterOpened.id)?.envelope.kind, "OPENED");
  assert.deepEqual(reopened.snapshot().events.map(event => event.qaReceiptAt), [null, null, null]);
});

test("explicit retirement persists a distinct notice but fences older pending sends and late observations", t => {
  const f = fixture(t);
  const store = f.create();
  f.first(store);
  const opened = f.second(store);
  f.tick(start + 61);
  const retired = store.retire();
  assert.equal(retired.id, idFor(f.runId, opened.incidentOpenedAt, "RETIRED"));
  store.close();
  const reopened = f.open();
  assert.equal(reopened.snapshot().termination, "RETIRED");
  assert.equal(reopened.claim(opened.id), null);
  assert.equal(reopened.claim(retired.id)?.envelope.kind, "RETIRED");
  assert.equal(reopened.claim(retired.id), null);
  assert.equal(reopened.retire(), null);
  f.tick(start + 120);
  assert.equal(reopened.observe(sample(start + 120, "PASS")), null);
  assert.equal(reopened.snapshot().state.phase, "RETIRED");
  assert.deepEqual(reopened.snapshot().events.map(e => e.kind), ["OPENED", "RETIRED"]);
});

test("RETIRED bypasses unclaimed normal events but not an unresolved earlier claim", t => {
  const f = fixture(t, ({ event, evidence }) =>
    evidence === "exact" ? { eventId: event.eventId, receivedAt: start + 62 } : null);
  const store = f.create();
  f.first(store);
  const opened = f.second(store);
  assert.ok(store.claim(opened.id));
  f.tick(start + 120);
  assert.equal(store.observe(sample(start + 120, "PASS")), null);
  f.tick(start + 180);
  const recovered = store.observe(sample(start + 180, "PASS"));
  f.tick(start + 240);
  assert.equal(store.observe(sample(start + 240)), null);
  f.tick(start + 300);
  const laterOpened = store.observe(sample(start + 300));
  f.tick(start + 301);
  const retired = store.retire();
  store.close();

  const reopened = f.open();
  assert.equal(reopened.claim(retired.id), null, "retirement cannot bypass ACK_UNKNOWN");
  assert.equal(reopened.recordQaReceipt(opened.id, "exact"), true);
  assert.equal(reopened.claim(retired.id)?.envelope.kind, "RETIRED");
  assert.equal(reopened.claim(recovered.id), null);
  assert.equal(reopened.claim(laterOpened.id), null);
  assert.deepEqual(reopened.snapshot().events.map(event => [event.kind, event.dispatch]), [
    ["OPENED", "ACK_UNKNOWN"], ["RECOVERED", "NOT_CLAIMED"],
    ["OPENED", "NOT_CLAIMED"], ["RETIRED", "ACK_UNKNOWN"],
  ]);
});

test("hard expiry records retirement without admitting sends, even after reopening or a clock rewind", t => {
  const f = fixture(t);
  const store = f.create(start + 120);
  f.first(store);
  const opened = f.second(store);
  f.tick(start + 120);
  assert.equal(store.claim(opened.id), null);
  assert.equal(store.snapshot().termination, "EXPIRED");
  assert.equal(store.snapshot().events.length, 2);
  const retired = store.snapshot().events[1];
  assert.equal(retired.kind, "RETIRED");
  assert.equal(store.claim(retired.id), null);
  store.close();
  const reopened = f.open();
  f.tick(start + 119);
  assert.throws(() => reopened.claim(opened.id), { message: "CLOCK_REWOUND" });
  f.tick(start + 121);
  assert.equal(reopened.claim(opened.id), null);
  assert.equal(reopened.retire(), null);
});

test("a claim is withheld if the window expires before handoff, with its durable intent fenced", t => {
  const f = fixture(t);
  const store = f.create(start + 120);
  f.first(store);
  const opened = f.second(store);
  f.clockSteps(start + 119, start + 120);
  assert.equal(store.claim(opened.id), null);
  store.close();
  const reopened = f.open();
  assert.equal(reopened.snapshot().termination, "EXPIRED");
  assert.equal(reopened.snapshot().events[0].intentAt, start + 119);
  assert.equal(reopened.snapshot().events[0].dispatch, "ACK_UNKNOWN");
  assert.equal(reopened.claim(opened.id), null);
});

test("reopen refuses missing or mismatched state without creating or resetting it", t => {
  const f = fixture(t);
  assert.throws(() => f.open(), { message: "STATE_MISSING" });
  assert.equal(existsSync(f.file), false);
  assert.throws(() => f.create(start + 1201), { message: "INVALID_WINDOW" });
  const store = f.create();
  assert.throws(() => f.create(), { message: "STATE_EXISTS" });
  assert.throws(() => openUptimeCanaryState({ directory: f.directory, runId: randomUUID() }), { message: "RUN_MISMATCH" });
  assert.equal(store.snapshot().runId, f.runId);
  if (process.platform !== "win32") assert.equal(statSync(f.file).mode & 0o777, 0o600);
});
