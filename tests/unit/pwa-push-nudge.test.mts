import assert from "node:assert/strict";
import test from "node:test";

import { pushNudgeVariant, pushNudgeSnoozeUntil } from "../../artifacts/kub/src/lib/pwa/pushNudge.ts";

const now = Date.parse("2026-09-24T12:00:00Z");

test("only a ready, signed-in installed iPhone app offers push", () => {
  const base = { installed: true, ios: true, userId: "user-1", ready: true, status: "inactive" as const, snoozedUntil: 0, now };
  assert.equal(pushNudgeVariant(base), "enable");
  assert.equal(pushNudgeVariant({ ...base, installed: false }), null);
  assert.equal(pushNudgeVariant({ ...base, ios: false }), null);
  assert.equal(pushNudgeVariant({ ...base, userId: null }), null);
  assert.equal(pushNudgeVariant({ ...base, ready: false }), null);
  assert.equal(pushNudgeVariant({ ...base, status: "active" }), null);
  assert.equal(pushNudgeVariant({ ...base, status: "unsupported" }), null);
  assert.equal(pushNudgeVariant({ ...base, status: "missing_vapid" }), null);
});

test("denied permission offers settings guidance, never a repeat permission prompt", () => {
  const base = { installed: true, ios: true, userId: "user-1", ready: true, status: "denied" as const, snoozedUntil: 0, now };
  assert.equal(pushNudgeVariant(base), "settings");
  assert.equal(pushNudgeVariant({ ...base, snoozedUntil: now + 1 }), null);
  assert.equal(pushNudgeVariant({ ...base, snoozedUntil: now }), "settings");
});

test("dismissal lasts thirty days instead of nagging on every launch", () => {
  assert.equal(pushNudgeSnoozeUntil(now), now + 30 * 24 * 60 * 60 * 1000);
});
