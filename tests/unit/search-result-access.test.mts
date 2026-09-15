// A location found in search must lead somewhere (D-139).
//
// `public.locations` is readable by `is_admin(auth.uid())` **or** any member of
// that location — measured on production on 2026-09-15 — so search returns a
// location to people well outside the administration. Pressing it ran into one
// of two dead ends, and the register had only found the first:
//
//   - not staff: an alert, «Локация недоступна для вашего профиля», for a row
//     the product had just offered;
//   - a manager: worse. The gate was `isStaff` and `/admin/locations` is mounted
//     behind `isAdmin`, so the press navigated and was redirected back to the
//     dashboard without a word.
import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCATION_RESULT_PATH,
  canOpenAdminPath,
  canOpenLocationResult,
  openableSearchResults,
} from "../../artifacts/kub/src/lib/searchResultAccess.ts";

/** The four people this deployment actually produces. */
const OWNER = { isStaff: true, isAdmin: true, canViewSupport: true };
const MANAGER = { isStaff: true, isAdmin: false, canViewSupport: false };
/** `support.view` and nothing else: reaches the shell, and only one tab in it. */
const SUPPORT_ONLY = { isStaff: false, isAdmin: false, canViewSupport: true };
const MEMBER = { isStaff: false, isAdmin: false, canViewSupport: false };

const RESULTS = [
  { resultType: "chat", id: "c1" },
  { resultType: "location", id: "l1" },
  { resultType: "user", id: "u1" },
  { resultType: "location", id: "l2" },
];

test("the destination is the tab the row opens", () => {
  assert.equal(LOCATION_RESULT_PATH, "/admin/locations");
});

test("a manager is not admitted — the bug the entry did not have", () => {
  // `isStaff` and not `isAdmin`. The old gate said yes and the route said no.
  assert.equal(canOpenLocationResult(MANAGER), false);
  assert.equal(canOpenLocationResult(OWNER), true);
  assert.equal(canOpenLocationResult(MEMBER), false);
  assert.equal(canOpenLocationResult(SUPPORT_ONLY), false);
});

test("the gate is a copy of AdminLayout's, both halves of it", () => {
  // The shell: neither staff nor a support operator never gets in at all.
  assert.equal(canOpenAdminPath("/admin", MEMBER), false);
  assert.equal(canOpenAdminPath("/admin", MANAGER), true);
  assert.equal(canOpenAdminPath("/admin", SUPPORT_ONLY), true);

  // The `adminOnly` routes, which the shell alone does not open.
  for (const path of ["/admin/locations", "/admin/invites", "/admin/roles", "/admin/ops", "/admin/audit"]) {
    assert.equal(canOpenAdminPath(path, OWNER), true, path);
    assert.equal(canOpenAdminPath(path, MANAGER), false, path);
  }

  // Support is its own permission, not `isAdmin`: an owner without it is
  // redirected exactly as anybody else would be.
  assert.equal(canOpenAdminPath("/admin/support", SUPPORT_ONLY), true);
  assert.equal(canOpenAdminPath("/admin/support", { isStaff: true, isAdmin: true }), false);
});

test("nothing is claimed while the roles are still being read", () => {
  // A list built during the check must not be actionable for a frame.
  assert.equal(canOpenLocationResult({ ...OWNER, checking: true }), false);
  assert.equal(canOpenAdminPath("/admin", { ...OWNER, checking: true }), false);
});

test("a location is dropped from the list rather than drawn and refused", () => {
  const forManager = openableSearchResults(RESULTS, MANAGER);
  assert.deepEqual(forManager.map((row) => row.id), ["c1", "u1"]);

  // Everything else survives untouched, in order.
  const forOwner = openableSearchResults(RESULTS, OWNER);
  assert.deepEqual(forOwner.map((row) => row.id), ["c1", "l1", "u1", "l2"]);
});

test("the filter returns a copy, so a memoised list is never mutated in place", () => {
  const source = [...RESULTS];
  const filtered = openableSearchResults(source, OWNER);
  assert.notEqual(filtered, source);
  filtered.pop();
  assert.equal(source.length, 4);
});

test("an empty list stays empty for everybody", () => {
  assert.deepEqual(openableSearchResults([], MEMBER), []);
  assert.deepEqual(openableSearchResults([], OWNER), []);
});
