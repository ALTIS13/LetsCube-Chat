import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTaskMoment,
  formatTaskPeriod,
  taskNotStarted,
  taskPeriodError,
} from "../../artifacts/kub/src/lib/taskPeriod.ts";

// Tracker item 68: a task that runs from a date to a date.

const START = new Date(2026, 9, 1, 9, 0).toISOString();
const DUE = new Date(2026, 9, 30, 18, 0).toISOString();

test("a period reads from its start to its deadline; either alone reads as before", () => {
  assert.equal(formatTaskMoment(DUE), "30 окт., 18:00");
  assert.equal(formatTaskPeriod(START, DUE), "01 окт., 09:00 — 30 окт., 18:00");
  assert.equal(formatTaskPeriod(START, null), "с 01 окт., 09:00");
  assert.equal(formatTaskPeriod(null, DUE), "30 окт., 18:00");
  assert.equal(formatTaskPeriod(null, null), null);
  assert.equal(formatTaskPeriod("not a date", DUE), "30 окт., 18:00");
});

test("a start after the deadline is refused, and a missing half is not", () => {
  assert.equal(taskPeriodError(DUE, START), "Начало не может быть позже срока.");
  assert.equal(taskPeriodError(START, DUE), null);
  assert.equal(taskPeriodError(START, START), null, "a period may be a moment");
  assert.equal(taskPeriodError(null, DUE), null);
  assert.equal(taskPeriodError(START, null), null);
});

test("a period that has not begun says so until its start", () => {
  const start = Date.parse(START);
  assert.equal(taskNotStarted(START, start - 1), true);
  assert.equal(taskNotStarted(START, start), false);
  assert.equal(taskNotStarted(null, start), false);
});
