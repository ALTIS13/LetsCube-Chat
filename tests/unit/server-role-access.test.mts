// The client's copies of `public.is_manager_or_admin` and `public.is_admin`
// (D-202 / F-5), generalised out of `lib/moderationAccess.ts` — which named one
// use of the first function after the screen it guarded, so the folders screen
// went and wrote a third and a fourth spelling of the same rule instead of
// reusing it.
//
// Both function bodies were read off production on 2026-09-15 and are quoted in
// `lib/serverRoleAccess.ts`. The two differ by exactly one role key, `manager`,
// and that difference is load-bearing: `folders` gates its `shared` branch on
// the first and its `system` branch on the second.
import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesIsAdmin,
  matchesIsManagerOrAdmin,
  SERVER_ADMIN_LEGACY_ROLES,
  SERVER_ADMIN_ROLE_KEYS,
  SERVER_MANAGER_OR_ADMIN_LEGACY_ROLES,
  SERVER_MANAGER_OR_ADMIN_ROLE_KEYS,
} from "../../artifacts/kub/src/lib/serverRoleAccess.ts";

const staff = (legacyRole: string | null, keys: string[] = []) =>
  matchesIsManagerOrAdmin({ legacyRole, globalRoleKeys: keys });
const admin = (legacyRole: string | null, keys: string[] = []) =>
  matchesIsAdmin({ legacyRole, globalRoleKeys: keys });

test("is_manager_or_admin: the legacy column admits admin and manager only", () => {
  assert.equal(staff("admin"), true);
  assert.equal(staff("manager"), true);
  assert.equal(staff("user"), false);
  assert.equal(staff(null), false);
  assert.equal(staff(""), false);
  assert.deepEqual([...SERVER_MANAGER_OR_ADMIN_LEGACY_ROLES], ["admin", "manager"]);
});

test("is_manager_or_admin: the four global role keys admit, and nothing else does", () => {
  for (const key of SERVER_MANAGER_OR_ADMIN_ROLE_KEYS) {
    assert.equal(staff("user", [key]), true, key);
  }
  // The other keys this deployment carries, read off `public.roles`.
  for (const key of [
    "chat_owner",
    "location_owner",
    "location_admin",
    "chat_admin",
    "location_manager",
    "location_staff",
    "location_client",
    "user",
    "chat_member",
  ]) {
    assert.equal(staff("user", [key]), false, key);
  }
  assert.deepEqual(
    [...SERVER_MANAGER_OR_ADMIN_ROLE_KEYS],
    ["owner", "tech_admin", "admin", "manager"],
  );
});

test("is_admin: one key narrower — a manager is not an admin", () => {
  assert.equal(admin("manager"), false);
  assert.equal(admin("user", ["manager"]), false);
  assert.equal(admin("admin"), true);
  for (const key of SERVER_ADMIN_ROLE_KEYS) {
    assert.equal(admin("user", [key]), true, key);
  }
  assert.deepEqual([...SERVER_ADMIN_LEGACY_ROLES], ["admin"]);
  assert.deepEqual([...SERVER_ADMIN_ROLE_KEYS], ["owner", "tech_admin", "admin"]);
});

test("everything is_admin admits, is_manager_or_admin admits too", () => {
  for (const legacyRole of [...SERVER_ADMIN_LEGACY_ROLES, "user"]) {
    for (const key of [...SERVER_ADMIN_ROLE_KEYS, "user"]) {
      if (!admin(legacyRole, [key])) continue;
      assert.equal(staff(legacyRole, [key]), true, `${legacyRole} + ${key}`);
    }
  }
});

test("a permission is not a role, which is the whole point of these two", () => {
  // `chats.moderate` and `users.view` make somebody `isStaff` in the client and
  // nothing at all to either database function. Passing one here as if it were
  // a role must not open anything.
  assert.equal(staff("user", ["chats.moderate"]), false);
  assert.equal(staff("user", ["users.view", "tasks.manage"]), false);
  assert.equal(admin("user", ["system.manage", "roles.manage"]), false);
});

test("one qualifying key among several is enough", () => {
  assert.equal(staff("user", ["user", "location_staff", "manager"]), true);
  assert.equal(admin("user", ["user", "manager", "tech_admin"]), true);
});

test("nothing at all is nobody", () => {
  assert.equal(matchesIsManagerOrAdmin({ legacyRole: null, globalRoleKeys: null }), false);
  assert.equal(matchesIsAdmin({ legacyRole: undefined, globalRoleKeys: undefined }), false);
  assert.equal(staff(null, []), false);
  assert.equal(admin(null, []), false);
});

test("a Set works as well as an array, because that is what the hook holds", () => {
  assert.equal(
    matchesIsManagerOrAdmin({ legacyRole: "user", globalRoleKeys: new Set(["owner"]) }),
    true,
  );
  assert.equal(
    matchesIsAdmin({ legacyRole: "user", globalRoleKeys: new Set(["manager"]) }),
    false,
  );
});

test("the three accounts measured on production come out staff", () => {
  // The cross-tab over all 18 profiles, read 2026-09-15: 13 satisfy neither
  // predicate, 3 satisfy both through a global role while carrying
  // `profiles.role = 'user'`, and 2 carry the legacy column as well. The 3 are
  // the ones the folders sidebar used to refuse.
  assert.equal(staff("user", ["owner"]), true);
  assert.equal(staff("user", ["tech_admin"]), true);
  assert.equal(admin("user", ["owner"]), true);
  assert.equal(admin("user", ["tech_admin"]), true);
});
