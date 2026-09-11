import assert from "node:assert/strict";
import test from "node:test";

import { createResumeRevalidationGate } from "../../artifacts/kub/src/lib/resumeRevalidation.ts";

/**
 * D-088: coming back to the page asks the server again only when the page was
 * actually away, and never talks a reconnect out of it.
 */

function gateWith(minHiddenMs = 15_000, minIntervalMs = 15_000) {
  let now = 1_000_000;
  const gate = createResumeRevalidationGate({ minHiddenMs, minIntervalMs, now: () => now });
  return {
    gate,
    advance(ms: number) {
      now += ms;
    },
  };
}

test("becoming visible without having been hidden asks for nothing", () => {
  const { gate } = gateWith();
  assert.equal(gate.visible(), false);
});

test("a short absence is not a reason", () => {
  const { gate, advance } = gateWith();
  gate.hidden();
  advance(5_000);
  assert.equal(gate.visible(), false);
});

test("a long absence is, once per absence", () => {
  const { gate, advance } = gateWith();
  gate.hidden();
  advance(16_000);
  assert.equal(gate.visible(), true);
  assert.equal(gate.visible(), false, "a second visibilitychange without a hide is not another absence");
});

test("absences inside the interval revalidate once", () => {
  const { gate, advance } = gateWith(15_000, 60_000);
  gate.hidden();
  advance(16_000);
  assert.equal(gate.visible(), true);
  gate.hidden();
  advance(16_000);
  assert.equal(gate.visible(), false, "32 seconds after the last one, inside a 60 second interval");
  gate.hidden();
  advance(45_000);
  assert.equal(gate.visible(), true, "77 seconds after the last one");
});

test("coming back online always revalidates, and restarts the interval", () => {
  const { gate, advance } = gateWith(15_000, 60_000);
  assert.equal(gate.online(), true);
  assert.equal(gate.online(), true, "a reconnect is never throttled away");
  gate.hidden();
  advance(20_000);
  assert.equal(gate.visible(), false, "the reconnect a moment ago already asked");
});

test("only a page restored from the back/forward cache revalidates on pageshow", () => {
  const { gate } = gateWith();
  assert.equal(gate.pageShow(false), false);
  assert.equal(gate.pageShow(true), true);
});

test("a second hide keeps the time of the first", () => {
  const { gate, advance } = gateWith();
  gate.hidden();
  advance(10_000);
  gate.hidden();
  advance(6_000);
  assert.equal(gate.visible(), true);
});
