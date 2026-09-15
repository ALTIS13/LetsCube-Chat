// F-8: the client's offline copy of `public._legacy_role_has_permission`.
//
// The table is consulted only when the access-snapshot RPC is disabled, returns
// nothing or throws — so a wrong entry is invisible until the day the RPC is
// unavailable, which is the day it matters most. It had drifted by one key:
// the database grants legacy `admin` 23 keys, the client granted 22, and the
// missing one was `folders.manage_shared`.
//
// It could not have been caught: the table was inline in `hooks/useRole.ts`,
// which imports React, the store and supabase-js, so no `node --test` process
// could reach it. Moving the decision into `lib/legacyRolePermissions.ts` is
// the fix for that half; this file is the fix for the other half.
//
// The three lists below are transcribed from the production function body, read
// on 2026-09-15 with `pg_get_functiondef`, and cross-checked the same day
// against a full `_legacy_role_has_permission(role, key)` cross-tab over every
// key in `public.permissions`.
import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_ADMIN_PERMISSION_KEYS,
  LEGACY_DEFAULT_PERMISSION_KEYS,
  LEGACY_MANAGER_PERMISSION_KEYS,
  legacyRoleHasPermission,
} from "../../artifacts/kub/src/lib/legacyRolePermissions.ts";

/** `public._legacy_role_has_permission`, admin branch, as production has it. */
const DATABASE_ADMIN_KEYS = [
  "roles.view",
  "users.view",
  "users.manage",
  "users.assign_roles",
  "locations.view",
  "locations.manage",
  "location_members.view",
  "location_members.manage",
  "tasks.view",
  "tasks.create",
  "tasks.assign",
  "tasks.manage",
  "tasks.view_admin_tasks",
  "tasks.manage_admin_tasks",
  "tasks.view_all_locations",
  "tasks.manage_all_locations",
  "chats.invite",
  "chats.invite_any",
  "chats.manage_invites",
  "chats.moderate",
  "chats.manage_roles",
  "audit.view",
  "folders.manage_shared",
];

/** The manager branch. */
const DATABASE_MANAGER_KEYS = [
  "users.view",
  "locations.view",
  "location_members.view",
  "tasks.view",
  "tasks.create",
  "tasks.assign",
  "tasks.manage",
  "chats.invite",
];

/** The `else` branch — every other legacy role. */
const DATABASE_DEFAULT_KEYS = ["chats.invite"];

/** Keys that exist in `public.permissions` and no legacy role is granted. */
const DATABASE_DENIES_EVERY_LEGACY_ROLE = [
  "bots.suspend",
  "media.moderate",
  "permissions.manage",
  "roles.manage",
  "support.claim",
  "support.escalate",
  "support.lookup_customer",
  "support.manage",
  "support.reply",
  "support.settings",
  "support.transfer",
  "support.view",
  "system.manage",
  "tasks.bulk_delete",
  "tasks.claim",
  "tasks.delete",
  "tasks.restore",
];

const sorted = (keys: readonly string[]) => [...keys].sort();

test("the admin list is the database's admin list, 23 keys", () => {
  assert.deepEqual(sorted(LEGACY_ADMIN_PERMISSION_KEYS), sorted(DATABASE_ADMIN_KEYS));
  assert.equal(LEGACY_ADMIN_PERMISSION_KEYS.length, 23);
});

test("folders.manage_shared is in it — the one key that was missing", () => {
  // The whole of F-8 in one line. A legacy admin on the fallback path was
  // denied the shared-folder capability the database grants them.
  assert.equal(legacyRoleHasPermission("admin", "folders.manage_shared"), true);
});

test("the manager list is the database's manager list, 8 keys", () => {
  assert.deepEqual(sorted(LEGACY_MANAGER_PERMISSION_KEYS), sorted(DATABASE_MANAGER_KEYS));
  assert.equal(LEGACY_MANAGER_PERMISSION_KEYS.length, 8);
  // And it does not carry the admin-only key, in either direction.
  assert.equal(legacyRoleHasPermission("manager", "folders.manage_shared"), false);
});

test("every other legacy role gets chats.invite and nothing else", () => {
  assert.deepEqual(sorted(LEGACY_DEFAULT_PERMISSION_KEYS), sorted(DATABASE_DEFAULT_KEYS));
  assert.equal(legacyRoleHasPermission("user", "chats.invite"), true);
  assert.equal(legacyRoleHasPermission("user", "folders.manage_shared"), false);
  assert.equal(legacyRoleHasPermission("user", "users.view"), false);
});

test("the function answers the way the database answers, key by key", () => {
  for (const key of DATABASE_ADMIN_KEYS) {
    assert.equal(legacyRoleHasPermission("admin", key), true, `admin / ${key}`);
  }
  for (const key of DATABASE_MANAGER_KEYS) {
    assert.equal(legacyRoleHasPermission("manager", key), true, `manager / ${key}`);
  }
  for (const key of DATABASE_ADMIN_KEYS) {
    const expected = DATABASE_MANAGER_KEYS.includes(key);
    assert.equal(legacyRoleHasPermission("manager", key), expected, `manager / ${key}`);
  }
  for (const key of DATABASE_DENIES_EVERY_LEGACY_ROLE) {
    assert.equal(legacyRoleHasPermission("admin", key), false, `admin / ${key}`);
    assert.equal(legacyRoleHasPermission("manager", key), false, `manager / ${key}`);
    assert.equal(legacyRoleHasPermission("user", key), false, `user / ${key}`);
  }
});

test("no role at all gets nothing, not even the default key", () => {
  assert.equal(legacyRoleHasPermission(null, "chats.invite"), false);
  assert.equal(legacyRoleHasPermission(undefined, "chats.invite"), false);
  assert.equal(legacyRoleHasPermission("", "chats.invite"), false);
});

test("the lists carry no duplicate and stay sorted, so drift is one line of diff", () => {
  for (const list of [
    LEGACY_ADMIN_PERMISSION_KEYS,
    LEGACY_MANAGER_PERMISSION_KEYS,
    LEGACY_DEFAULT_PERMISSION_KEYS,
  ]) {
    assert.deepEqual([...list], sorted(list));
    assert.equal(new Set(list).size, list.length);
  }
});
