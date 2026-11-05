import assert from "node:assert/strict";
import test from "node:test";
import {
  createUptimeCanary,
  observeUptimeCanary,
  retireUptimeCanary,
} from "../../scripts/ops/uptime-canary.mjs";

const START = 180_000;

function fixture() {
  let state = createUptimeCanary();
  const receipts = [];
  function apply(result) {
    state = result.state;
    if (result.notice) receipts.push(result.notice);
  }
  return {
    receipts,
    get phase() { return state.phase; },
    observe(sample, now = sample?.observedAt) {
      apply(observeUptimeCanary(state, sample, now));
    },
    poll(offset, outcome) {
      this.observe({ observedAt: START + offset, outcome });
    },
    retire() {
      apply(retireUptimeCanary(state));
    },
  };
}

test("emits one open and one recovery per incident and can open a new incident", () => {
  const canary = fixture();
  canary.poll(0, "PASS");
  canary.poll(60, "FAIL");
  assert.equal(canary.phase, "WATCHING");
  assert.deepEqual(canary.receipts, []);
  canary.poll(120, "FAIL");
  assert.equal(canary.phase, "OPEN");
  assert.deepEqual(canary.receipts, [
    { monitor: "uptime-canary", kind: "OPENED", incidentOpenedAt: 180_120 },
  ]);
  canary.poll(180, "FAIL");
  canary.poll(240, "FAIL");
  canary.poll(300, "PASS");
  assert.equal(canary.phase, "OPEN");
  assert.equal(canary.receipts.length, 1);
  canary.poll(360, "PASS");
  assert.equal(canary.phase, "WATCHING");
  canary.poll(420, "PASS");
  canary.poll(480, "FAIL");
  canary.poll(540, "FAIL");
  assert.deepEqual(canary.receipts, [
    { monitor: "uptime-canary", kind: "OPENED", incidentOpenedAt: 180_120 },
    { monitor: "uptime-canary", kind: "RECOVERED", incidentOpenedAt: 180_120 },
    { monitor: "uptime-canary", kind: "OPENED", incidentOpenedAt: 180_540 },
  ]);
});

test("replayed, out-of-order and conflicting same-slot observations cannot vote again", () => {
  const canary = fixture();
  canary.poll(60, "FAIL");
  canary.poll(60, "FAIL");
  canary.poll(61, "FAIL");
  canary.poll(0, "FAIL");
  canary.poll(62, "PASS");
  assert.deepEqual(canary.receipts, []);
  canary.poll(120, "FAIL");
  assert.equal(canary.phase, "OPEN");
  canary.poll(180, "PASS");
  canary.poll(180, "PASS");
  canary.poll(185, "PASS");
  canary.poll(120, "PASS");
  canary.poll(190, "FAIL");
  assert.equal(canary.receipts.length, 1);
  canary.poll(240, "PASS");
  assert.equal(canary.phase, "WATCHING");
  assert.equal(canary.receipts[1]?.kind, "RECOVERED");
});

for (const [label, interrupt] of [
  ["missing", () => {}],
  ["unknown", (canary, offset) => canary.poll(offset, "UNKNOWN")],
  ["opposite", (canary, offset, opposite) => canary.poll(offset, opposite)],
]) {
  test(`${label} poll breaks both confirmation streaks`, () => {
    const canary = fixture();
    canary.poll(0, "FAIL");
    interrupt(canary, 60, "PASS");
    canary.poll(120, "FAIL");
    assert.equal(canary.phase, "WATCHING");
    canary.poll(180, "FAIL");
    assert.equal(canary.phase, "OPEN");
    canary.poll(240, "PASS");
    interrupt(canary, 300, "FAIL");
    canary.poll(360, "PASS");
    assert.equal(canary.phase, "OPEN");
    canary.poll(420, "PASS");
    assert.equal(canary.phase, "WATCHING");
  });
}

test("accepts observations at the 120-second limit but refuses stale and future votes", () => {
  const initial = createUptimeCanary();
  const sample = { observedAt: START, outcome: "FAIL" };
  assert.equal(observeUptimeCanary(initial, sample, START - 1).state, initial);
  assert.equal(observeUptimeCanary(initial, sample, START + 121).state, initial);
  const canary = fixture();
  canary.observe({ observedAt: START + 60, outcome: "FAIL" }, START + 180);
  assert.deepEqual(canary.receipts, []);
  canary.observe({ observedAt: START + 120, outcome: "FAIL" }, START + 180);
  assert.equal(canary.receipts[0]?.incidentOpenedAt, 180_120);
  canary.poll(180, "PASS");
  canary.observe({ observedAt: START + 240, outcome: "PASS" }, START + 361);
  assert.equal(canary.phase, "OPEN");
});

test("a previously accepted vote cannot confirm an incident or recovery after expiring", () => {
  const canary = fixture();
  canary.poll(0, "FAIL");
  canary.observe({ observedAt: START + 60, outcome: "FAIL" }, START + 121);
  assert.equal(canary.phase, "WATCHING");
  canary.observe({ observedAt: START + 120, outcome: "FAIL" }, START + 121);
  assert.equal(canary.phase, "OPEN");
  canary.poll(180, "PASS");
  canary.observe({ observedAt: START + 240, outcome: "PASS" }, START + 301);
  assert.equal(canary.phase, "OPEN");
  canary.observe({ observedAt: START + 300, outcome: "PASS" }, START + 301);
  assert.equal(canary.phase, "WATCHING");
});

test("rejects extra, malformed and control fields without exposing raw metadata", () => {
  const canary = fixture();
  const rejected = [
    { observedAt: START + 60, outcome: "FAIL", body: "PRIVATE_FIXTURE" },
    { observedAt: START + 60, outcome: "PRIVATE_FIXTURE" },
    { observedAt: START + 60, outcome: "RETIRE" },
    { observedAt: START + 60.5, outcome: "FAIL" },
    { observedAt: "180060", outcome: "FAIL" },
    { observedAt: START + 60 },
    [{ observedAt: START + 60, outcome: "FAIL" }],
    null,
  ];
  canary.poll(0, "FAIL");
  for (const sample of rejected) {
    const state = createUptimeCanary();
    const result = observeUptimeCanary(state, sample, START + 61);
    assert.equal(result.state, state);
    assert.equal(result.notice, null);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FIXTURE/);
    canary.observe(sample, START + 61);
  }
  canary.observe({ observedAt: START + 60, outcome: "FAIL" }, NaN);
  assert.deepEqual(canary.receipts, []);
  canary.poll(60, "FAIL");
  assert.deepEqual(canary.receipts, [
    { monitor: "uptime-canary", kind: "OPENED", incidentOpenedAt: 180_060 },
  ]);
});

test("retiring an open canary emits a single distinct closure and fences late polls", () => {
  const canary = fixture();
  canary.poll(0, "FAIL");
  canary.poll(60, "FAIL");
  canary.poll(120, "PASS");
  canary.retire();
  canary.retire();
  canary.poll(180, "PASS");
  canary.poll(240, "FAIL");
  canary.poll(300, "FAIL");
  assert.equal(canary.phase, "RETIRED");
  assert.deepEqual(canary.receipts, [
    { monitor: "uptime-canary", kind: "OPENED", incidentOpenedAt: 180_060 },
    { monitor: "uptime-canary", kind: "RETIRED", incidentOpenedAt: 180_060 },
  ]);
});

test("retiring a canary without an open incident emits no notice", () => {
  const canary = fixture();
  canary.poll(0, "FAIL");
  canary.retire();
  canary.poll(60, "FAIL");
  canary.poll(120, "FAIL");
  assert.equal(canary.phase, "RETIRED");
  assert.deepEqual(canary.receipts, []);
});
