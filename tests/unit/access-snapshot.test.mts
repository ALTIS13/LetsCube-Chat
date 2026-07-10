import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  isAccessSnapshotUnavailable,
  isAccessSnapshotEnabled,
  normalizeAccessSnapshot,
  selectAnyLocationPermissionKeys,
  selectPermissionKeys,
} from "../../artifacts/kub/src/lib/accessSnapshot.ts";

test("normalizeAccessSnapshot deduplicates roles and permissions", () => {
  const snapshot = normalizeAccessSnapshot({
    global_role_keys: ["manager", "manager", null],
    global_permission_keys: ["tasks.view", "tasks.view", "tasks.create"],
    location_permissions: {
      "location-1": ["tasks.view", "tasks.assign", "tasks.assign"],
      "location-2": null,
    },
  });

  assert.deepEqual([...snapshot.globalRoleKeys], ["manager"]);
  assert.deepEqual(
    [...snapshot.globalPermissionKeys],
    ["tasks.view", "tasks.create"],
  );
  assert.deepEqual(
    [...snapshot.locationPermissionKeys.get("location-1")!],
    ["tasks.view", "tasks.assign"],
  );
  assert.deepEqual([...snapshot.locationPermissionKeys.get("location-2")!], []);
});

test("normalizeAccessSnapshot rejects malformed values without throwing", () => {
  const snapshot = normalizeAccessSnapshot({
    global_role_keys: "admin",
    global_permission_keys: ["tasks.view", 42, ""],
    location_permissions: ["not-an-object"],
  });

  assert.deepEqual([...snapshot.globalRoleKeys], []);
  assert.deepEqual([...snapshot.globalPermissionKeys], ["tasks.view"]);
  assert.equal(snapshot.locationPermissionKeys.size, 0);
});

test("isAccessSnapshotUnavailable only matches a missing snapshot RPC", () => {
  assert.equal(
    isAccessSnapshotUnavailable({
      code: "PGRST202",
      message:
        "Could not find the function public.current_user_access_snapshot",
    }),
    true,
  );
  assert.equal(
    isAccessSnapshotUnavailable({
      code: "42883",
      message: "function public.current_user_access_snapshot() does not exist",
    }),
    true,
  );
  assert.equal(
    isAccessSnapshotUnavailable({
      code: "42501",
      message: "permission denied",
    }),
    false,
  );
});

test("isAccessSnapshotEnabled requires an explicit rollout flag", () => {
  assert.equal(isAccessSnapshotEnabled("1"), true);
  assert.equal(isAccessSnapshotEnabled("true"), false);
  assert.equal(isAccessSnapshotEnabled(undefined), false);
});

test("snapshot selectors preserve global and location permission semantics", () => {
  const snapshot = normalizeAccessSnapshot({
    global_permission_keys: ["tasks.view"],
    location_permissions: {
      "location-1": ["tasks.assign"],
      "location-2": ["tasks.create"],
    },
  });

  assert.deepEqual(
    [...selectPermissionKeys(snapshot, ["tasks.view", "tasks.assign"], {})],
    ["tasks.view"],
  );
  assert.deepEqual(
    [
      ...selectPermissionKeys(snapshot, ["tasks.view", "tasks.assign"], {
        locationId: "location-1",
        locationOnly: true,
      }),
    ],
    ["tasks.view", "tasks.assign"],
  );
  assert.deepEqual(
    [
      ...selectAnyLocationPermissionKeys(
        snapshot,
        ["tasks.assign", "tasks.create", "tasks.delete"],
        ["location-1", "location-2"],
      ),
    ],
    ["tasks.assign", "tasks.create"],
  );
});

test("snapshot RPC proposal is self-scoped and denies anonymous execution", () => {
  const sql = readFileSync(
    resolve(
      ".migration-backup/supabase/migrations/20260710_current_user_access_snapshot.sql",
    ),
    "utf8",
  );

  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(
    sql,
    /revoke all on function public\.current_user_access_snapshot\(\) from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public\.current_user_access_snapshot\(\) to authenticated/,
  );
  assert.doesNotMatch(sql, /current_user_access_snapshot\s*\(\s*p_user_id/i);
});
