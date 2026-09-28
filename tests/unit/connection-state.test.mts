import assert from "node:assert/strict";
import test from "node:test";

import { CONNECTION_GRACE_MS, createConnectionStateMachine } from "../../artifacts/kub/src/lib/connectionState.ts";

/**
 * Tracker item 53: Telegram's «Соединение...» / «Ожидание сети...» where the
 * list's title is, so a list that looks current while nothing arrives says so.
 */

test("a device without network waits for it, at once", () => {
  let now = 0;
  const machine = createConnectionStateMachine(() => now);
  assert.equal(machine.next({ deviceOnline: false, socketOpen: false }), "waiting");
  now = 100;
  assert.equal(machine.next({ deviceOnline: false, socketOpen: false }), "waiting");
});

test("a connection that was up and dropped is announced after the grace, not before", () => {
  let now = 0;
  const machine = createConnectionStateMachine(() => now);
  assert.equal(machine.next({ deviceOnline: true, socketOpen: true }), "online");
  now = 1_000;
  assert.equal(machine.next({ deviceOnline: true, socketOpen: false }), "online");
  now = 1_000 + CONNECTION_GRACE_MS - 1;
  assert.equal(machine.next({ deviceOnline: true, socketOpen: false }), "online");
  now = 1_000 + CONNECTION_GRACE_MS;
  assert.equal(machine.next({ deviceOnline: true, socketOpen: false }), "connecting");
  // Back: gone at once.
  now += 500;
  assert.equal(machine.next({ deviceOnline: true, socketOpen: true }), "online");
  // A second drop starts its own grace.
  now += 100;
  assert.equal(machine.next({ deviceOnline: true, socketOpen: false }), "online");
});

test("a socket that has not opened yet in this run is the application starting, not a failure", () => {
  let now = 0;
  const machine = createConnectionStateMachine(() => now);
  assert.equal(machine.next({ deviceOnline: true, socketOpen: false }), "online");
  now = 60_000;
  assert.equal(machine.next({ deviceOnline: true, socketOpen: false }), "online");
  // But offline is offline, first second or not.
  assert.equal(machine.next({ deviceOnline: false, socketOpen: false }), "waiting");
});
