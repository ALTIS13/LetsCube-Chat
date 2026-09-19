import assert from "node:assert/strict";
import test from "node:test";

import {
  isSignedUrlUsable,
  shouldRenewSignedUrl,
  signedUrlLifetime,
  signedUrlState,
  SIGNED_URL_MIN_REMAINING_MS,
  SIGNED_URL_REFRESH_RATIO,
  SIGNED_URL_TTL_SECONDS,
} from "../../artifacts/kub/src/lib/media/signedUrlLifetime.ts";

/**
 * D-208, step two: how long a signature lives and when it is replaced.
 *
 * The numbers are not arbitrary and a test that only asserted them back would
 * prove nothing, so what is pinned here is the *ordering* the design rests on —
 * that renewal comes strictly before the floor, and the floor strictly before
 * expiry, with room between each. Change the constants and these stay green;
 * invert the relationship and they go red, which is the failure that matters.
 */

const T0 = 1_700_000_000_000;

test("the three moments are in the order the design needs", () => {
  const life = signedUrlLifetime(T0);
  assert.ok(life.renewAtMs > life.issuedAtMs, "renewal is not immediate");
  assert.ok(
    life.renewAtMs < life.expiresAtMs - SIGNED_URL_MIN_REMAINING_MS,
    "renewal must come before the floor, or a URL is spent before anything asks for a new one",
  );
  assert.ok(life.expiresAtMs - SIGNED_URL_MIN_REMAINING_MS > life.issuedAtMs, "the floor is not at issue");
});

test("the margin left after renewal is minutes, not seconds", () => {
  // The reason is measured: the token is checked at request time, so a `<video>`
  // seeking, or a retry after a dropped connection, makes a *new* request that
  // must still land inside the old signature's life while the new one arrives.
  const life = signedUrlLifetime(T0);
  const margin = life.expiresAtMs - life.renewAtMs;
  assert.ok(margin >= 5 * 60_000, `only ${margin}ms of margin`);
});

test("fresh, then renewing, then spent", () => {
  const life = signedUrlLifetime(T0);
  assert.equal(signedUrlState(life, T0), "fresh");
  assert.equal(signedUrlState(life, life.renewAtMs - 1), "fresh");
  assert.equal(signedUrlState(life, life.renewAtMs), "renewing");
  assert.equal(signedUrlState(life, life.expiresAtMs - SIGNED_URL_MIN_REMAINING_MS - 1), "renewing");
  assert.equal(signedUrlState(life, life.expiresAtMs - SIGNED_URL_MIN_REMAINING_MS), "spent");
  assert.equal(signedUrlState(life, life.expiresAtMs + 60_000), "spent");
});

test("a renewing URL is still handed out — that is what stops the blink", () => {
  // The whole point of renewing early: between the renewal point and the floor
  // the address still works, so a picture on screen keeps its src while its
  // replacement is fetched. If this ever became false a renewal would blank
  // every visible image for the length of one round trip.
  const life = signedUrlLifetime(T0);
  assert.equal(signedUrlState(life, life.renewAtMs), "renewing");
  assert.equal(isSignedUrlUsable(life, life.renewAtMs), true);
  assert.equal(shouldRenewSignedUrl(life, life.renewAtMs), true);
});

test("a spent URL is neither usable nor left alone", () => {
  const life = signedUrlLifetime(T0);
  const spent = life.expiresAtMs - SIGNED_URL_MIN_REMAINING_MS;
  assert.equal(isSignedUrlUsable(life, spent), false);
  assert.equal(shouldRenewSignedUrl(life, spent), true);
});

test("a fresh URL is left alone", () => {
  const life = signedUrlLifetime(T0);
  assert.equal(shouldRenewSignedUrl(life, T0), false);
  assert.equal(isSignedUrlUsable(life, T0), true);
});

test("a shorter ttl keeps the same shape, which is what makes a test able to move", () => {
  const life = signedUrlLifetime(T0, 100);
  assert.equal(life.expiresAtMs, T0 + 100_000);
  assert.equal(life.renewAtMs, T0 + Math.round(100_000 * SIGNED_URL_REFRESH_RATIO));
});

test("a ttl too short to have a usable window is spent from birth, not pretended fresh", () => {
  // Five minutes is the floor; a sixty-second signature has no window at all.
  // Saying so is better than handing out an address that dies mid-download.
  const life = signedUrlLifetime(T0, 60);
  assert.equal(signedUrlState(life, T0), "spent");
  assert.equal(isSignedUrlUsable(life, T0), false);
});

test("the shipped ttl bounds how long a removed member keeps working addresses", () => {
  // This is the number the defect is actually about: with a public bucket the
  // window is unbounded — leaving a chat, deleting the message and being banned
  // all change nothing. Signing makes the window exactly this.
  assert.equal(SIGNED_URL_TTL_SECONDS, 3600);
  assert.ok(SIGNED_URL_TTL_SECONDS <= 6 * 3600, "a revocation window measured in days is not one");
  assert.ok(
    SIGNED_URL_TTL_SECONDS * 1000 > SIGNED_URL_MIN_REMAINING_MS * 2,
    "the ttl must be long enough to have a life either side of the floor",
  );
});
