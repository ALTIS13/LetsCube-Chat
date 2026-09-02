import assert from "node:assert/strict";
import test from "node:test";

import { hasLiveSession } from "../e2e/helpers/auth.ts";

/**
 * The rule that decides whether a saved sign-in is worth restoring.
 *
 * A session lasts about an hour. Restoring a dead one does not fail loudly — it
 * boots the app, fails to refresh, and lands on the public home, after which the
 * helper waits out its full six-second shell timeout before doing what it could
 * have done immediately. The cost is per test, and invisible.
 *
 * The margin is the part worth pinning: a session with four seconds left is not
 * usable, because it dies in the middle of the test that restored it.
 */

const seconds = (offset: number) => Math.floor(Date.now() / 1000) + offset;

function session(expiresAt: number) {
  return [{ name: "kub-auth", value: JSON.stringify({ access_token: "x", expires_at: expiresAt }) }];
}

test("a session with real time left is restored", () => {
  assert.equal(hasLiveSession(session(seconds(3600))), true);
});

test("an expired session is not restored", () => {
  assert.equal(hasLiveSession(session(seconds(-1))), false);
});

test("a session about to expire is treated as dead", () => {
  // It would die mid-test, which is worse than not restoring it: the test would
  // start authenticated and lose the session part-way through.
  assert.equal(hasLiveSession(session(seconds(5))), false);
  assert.equal(hasLiveSession(session(seconds(59))), false);
  assert.equal(hasLiveSession(session(seconds(120))), true);
});

test("entries that are not sessions do not count as one", () => {
  assert.equal(hasLiveSession([{ name: "theme", value: '"dark"' }]), false);
  assert.equal(hasLiveSession([{ name: "cache", value: "not json at all" }]), false);
  assert.equal(hasLiveSession([]), false);
});

test("a stored expiry that is not a number is not trusted", () => {
  const entries = [
    { name: "kub-auth", value: JSON.stringify({ expires_at: "later" }) },
  ];
  assert.equal(hasLiveSession(entries), false);
});

test("the session entry is found among unrelated ones", () => {
  const entries = [
    { name: "theme", value: '"dark"' },
    { name: "release-catalog", value: JSON.stringify({ version: "1.2.3" }) },
    ...session(seconds(3600)),
  ];
  assert.equal(hasLiveSession(entries), true);
});
