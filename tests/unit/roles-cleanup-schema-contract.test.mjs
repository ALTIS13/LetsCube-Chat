// Contract for 20260904060000_roles_retire_dead_tiers_and_club_naming.sql.
//
// Two layers, on purpose:
//
//   Layer A models the three-tier resolution order of public.has_permission and
//   public.has_location_permission and asserts what the migration claims about
//   behaviour — that retiring the chat tier and backfilling the legacy accounts
//   moves nobody, and that retiring the roles the migration KEEPS would have
//   moved somebody. Fixtures are the production sets measured on 2026-09-04.
//
//   Layer B asserts the migration file actually performs those changes and none
//   of the dangerous ones. Reverting any single change in the .sql turns Layer B
//   red; breaking the model or the fixtures turns Layer A red.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  ".migration-backup/supabase/migrations/20260904060000_roles_retire_dead_tiers_and_club_naming.sql";
const SEED_PATH =
  ".migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql";
const ROLE_LABELS_PATH = "artifacts/kub/src/lib/rolePermissions.ts";

const sql = readFileSync(MIGRATION_PATH, "utf8");
const seedSql = readFileSync(SEED_PATH, "utf8");
const roleLabelsSource = readFileSync(ROLE_LABELS_PATH, "utf8");

// ---------------------------------------------------------------------
// Production fixtures, measured 2026-09-04 against supabase-db.
// ---------------------------------------------------------------------

const ALL_PERMISSIONS = [
  "audit.view", "bots.suspend", "chats.invite", "chats.invite_any",
  "chats.manage_invites", "chats.manage_roles", "chats.moderate",
  "folders.manage_shared", "location_members.manage", "location_members.view",
  "locations.manage", "locations.view", "media.moderate", "permissions.manage",
  "roles.manage", "roles.view", "support.claim", "support.escalate",
  "support.lookup_customer", "support.manage", "support.reply",
  "support.settings", "support.transfer", "support.view", "system.manage",
  "tasks.assign", "tasks.bulk_delete", "tasks.claim", "tasks.create",
  "tasks.delete", "tasks.manage", "tasks.manage_admin_tasks",
  "tasks.manage_all_locations", "tasks.restore", "tasks.view",
  "tasks.view_admin_tasks", "tasks.view_all_locations", "users.assign_roles",
  "users.manage", "users.view",
];

// role_permissions, per scope. owner/tech_admin hold all 40 rows, but see
// resolve() — those rows are never read, the bypass answers first.
const ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS,
  tech_admin: ALL_PERMISSIONS,
  admin: [
    "audit.view", "chats.invite", "chats.invite_any", "chats.manage_invites",
    "chats.manage_roles", "chats.moderate", "location_members.manage",
    "location_members.view", "locations.manage", "locations.view", "roles.view",
    "tasks.assign", "tasks.claim", "tasks.create", "tasks.manage",
    "tasks.manage_admin_tasks", "tasks.manage_all_locations", "tasks.view",
    "tasks.view_admin_tasks", "tasks.view_all_locations", "users.assign_roles",
    "users.manage", "users.view",
  ],
  manager: [
    "chats.invite", "location_members.view", "locations.view", "tasks.assign",
    "tasks.claim", "tasks.create", "tasks.manage", "tasks.view", "users.view",
  ],
  user: ["chats.invite"],
  location_owner: [
    "location_members.manage", "location_members.view", "locations.view",
    "tasks.assign", "tasks.claim", "tasks.create", "tasks.manage",
    "tasks.manage_admin_tasks", "tasks.view", "tasks.view_admin_tasks",
  ],
  location_admin: [
    "location_members.manage", "location_members.view", "locations.view",
    "tasks.assign", "tasks.claim", "tasks.create", "tasks.manage", "tasks.view",
    "tasks.view_admin_tasks",
  ],
  location_manager: [
    "location_members.view", "locations.view", "tasks.assign", "tasks.claim",
    "tasks.create", "tasks.view",
  ],
  location_staff: ["locations.view", "tasks.claim", "tasks.view"],
  location_client: ["locations.view"],
  chat_owner: [
    "chats.invite", "chats.manage_invites", "chats.manage_roles",
    "chats.moderate",
  ],
  chat_admin: ["chats.invite", "chats.manage_invites", "chats.moderate"],
  chat_member: ["chats.invite"],
};

const ROLE_SCOPE = {
  owner: "global", tech_admin: "global", admin: "global", manager: "global",
  user: "global",
  location_owner: "location", location_admin: "location",
  location_manager: "location", location_staff: "location",
  location_client: "location",
  chat_owner: "chat", chat_admin: "chat", chat_member: "chat",
};

// _legacy_role_has_permission, verbatim from the live function body.
const LEGACY_ROLE_PERMISSIONS = {
  admin: ROLE_PERMISSIONS.admin.filter((k) => k !== "tasks.claim").concat("folders.manage_shared"),
  manager: [
    "users.view", "locations.view", "location_members.view", "tasks.view",
    "tasks.create", "tasks.assign", "tasks.manage", "chats.invite",
  ],
  user: ["chats.invite"],
};

// The location_members.role -> role key fallback, verbatim from
// has_location_permission.
const LOCATION_ROLE_FALLBACK = {
  owner: "location_owner",
  admin: "location_admin",
  manager: "location_manager",
  client: "location_client",
};
const locationFallback = (role) => LOCATION_ROLE_FALLBACK[role] ?? "location_staff";

// The 14 production accounts, by shape.
const ACCOUNTS = [
  { id: "1532baab", legacy: "admin", global: ["owner"] },      // live administrator
  { id: "6f8b94d6", legacy: "admin", global: ["tech_admin"] }, // live administrator
  { id: "0255b507", legacy: "user", global: ["owner"] },
  { id: "2d0f6b72", legacy: "user", global: ["tech_admin"] },
  { id: "120eb229", legacy: "user", global: ["user"] },
  { id: "e4901e6d", legacy: "user", global: ["user"] },
  { id: "f31ebd8e", legacy: "user", global: ["user"] },
  { id: "04aabc04", legacy: "user", global: [] },
  { id: "3adfd4e6", legacy: "user", global: [] },
  { id: "3e7836d4", legacy: "user", global: [] },
  { id: "59d69959", legacy: "user", global: [] },
  { id: "dced6863", legacy: "user", global: [] },
  { id: "ddf034ba", legacy: "user", global: [] },
  { id: "ed68a6a6", legacy: "user", global: [] },
];

const LOCATION_MEMBERSHIPS = [
  { user: "1532baab", location: "250be78b", role: "owner", roleId: null },
  { user: "1532baab", location: "562371a5", role: "owner", roleId: "location_owner" },
  { user: "1532baab", location: "f1f4b3ba", role: "owner", roleId: "location_owner" },
  { user: "0255b507", location: "be51e3f9", role: "owner", roleId: "location_owner" },
  { user: "6f8b94d6", location: "be51e3f9", role: "owner", roleId: "location_owner" },
  { user: "2d0f6b72", location: "562371a5", role: "staff", roleId: "location_staff" },
  { user: "3e7836d4", location: "be51e3f9", role: "admin", roleId: "location_admin" },
  { user: "3e7836d4", location: "562371a5", role: "admin", roleId: "location_admin" },
  { user: "f31ebd8e", location: "f1f4b3ba", role: "manager", roleId: "location_manager" },
  { user: "f31ebd8e", location: "250be78b", role: "manager", roleId: "location_manager" },
  { user: "f31ebd8e", location: "562371a5", role: "manager", roleId: "location_manager" },
  { user: "e4901e6d", location: "562371a5", role: "staff", roleId: "location_staff" },
  { user: "e4901e6d", location: "be51e3f9", role: "staff", roleId: "location_staff" },
  { user: "3adfd4e6", location: "be51e3f9", role: "staff", roleId: "location_staff" },
  // The drift the migration deliberately leaves alone.
  { user: "ed68a6a6", location: "be51e3f9", role: "staff", roleId: "location_client" },
];

// ---------------------------------------------------------------------
// Layer A: the resolution model
// ---------------------------------------------------------------------

/** public.has_permission, tier for tier. `world.inactive` mirrors roles.is_active. */
function hasPermission(world, account, permission) {
  const active = (key) =>
    ROLE_SCOPE[key] === "global" && !world.inactive.has(key);

  // Tier 1: the owner / tech_admin bypass, which never reads role_permissions.
  if (account.global.some((key) => active(key) && (key === "owner" || key === "tech_admin"))) {
    return true;
  }
  // Tier 2: global roles via user_global_roles -> role_permissions.
  if (account.global.some((key) => active(key) && ROLE_PERMISSIONS[key]?.includes(permission))) {
    return true;
  }
  // Tier 3: the hardcoded legacy fallback on profiles.role.
  return Boolean(LEGACY_ROLE_PERMISSIONS[account.legacy]?.includes(permission));
}

/** public.has_location_permission. */
function hasLocationPermission(world, account, membership, permission) {
  if (hasPermission(world, account, permission)) return true;
  const effective = membership.roleId ?? locationFallback(membership.role);
  if (world.inactive.has(effective)) return false;
  return Boolean(ROLE_PERMISSIONS[effective]?.includes(permission));
}

function globalMatrix(world, accounts) {
  const cells = [];
  for (const account of accounts) {
    for (const permission of ALL_PERMISSIONS) {
      if (hasPermission(world, account, permission)) cells.push(`${account.id}:${permission}`);
    }
  }
  return cells.sort();
}

function locationMatrix(world, accounts, memberships) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cells = [];
  for (const membership of memberships) {
    const account = byId.get(membership.user);
    for (const permission of ALL_PERMISSIONS) {
      if (hasLocationPermission(world, account, membership, permission)) {
        cells.push(`${membership.user}@${membership.location}:${permission}`);
      }
    }
  }
  return cells.sort();
}

const BEFORE = { inactive: new Set() };

test("model reproduces the measured production baseline: only two global permission sets", () => {
  const sizes = new Map();
  for (const account of ACCOUNTS) {
    const n = ALL_PERMISSIONS.filter((p) => hasPermission(BEFORE, account, p)).length;
    sizes.set(n, (sizes.get(n) ?? 0) + 1);
  }
  // Measured: 4 accounts on 40 permissions, 10 accounts on 1.
  assert.deepEqual([...sizes.entries()].sort((a, b) => b[0] - a[0]), [[40, 4], [1, 10]]);
});

test("both live administrators resolve to every permission, before and after", () => {
  const admins = ACCOUNTS.filter((a) => a.legacy === "admin");
  assert.equal(admins.length, 2);
  const after = { inactive: new Set(["chat_owner", "chat_admin", "chat_member"]) };
  for (const admin of admins) {
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(hasPermission(BEFORE, admin, permission), true, `${admin.id} before ${permission}`);
      assert.equal(hasPermission(after, admin, permission), true, `${admin.id} after ${permission}`);
    }
  }
});

test("model reproduces the measured per-membership location permission counts", () => {
  // Absolute, not a before/after comparison: this pins the fixture to the
  // numbers measured in production and fails if a role's set is edited.
  const byId = new Map(ACCOUNTS.map((a) => [a.id, a]));
  const counts = LOCATION_MEMBERSHIPS.map((m) =>
    ALL_PERMISSIONS.filter((p) =>
      hasLocationPermission(BEFORE, byId.get(m.user), m, p),
    ).length,
  ).sort((a, b) => b - a);
  assert.deepEqual(counts, [40, 40, 40, 40, 40, 40, 10, 10, 7, 7, 7, 4, 4, 4, 2]);
});

test("a chat-scope role grants nothing, even to a holder", () => {
  // This is why the chat tier is the only genuinely dead one: has_permission
  // filters scope='global' and has_location_permission filters scope='location',
  // so a chat role is never read. Holding one must be worth exactly nothing.
  const bare = { id: "bare", legacy: "user", global: [] };
  for (const key of ["chat_owner", "chat_admin", "chat_member"]) {
    const holder = { id: "holder", legacy: "user", global: [key] };
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(
        hasPermission(BEFORE, holder, permission),
        hasPermission(BEFORE, bare, permission),
        `${key} changed the answer for ${permission}`,
      );
    }
    assert.ok(
      ROLE_PERMISSIONS[key].length > 0,
      `${key} must still carry rows, or this proves nothing`,
    );
  }
});

test("the owner/tech_admin bypass, not their permission rows, is what grants access", () => {
  // Emptying their role_permissions must not change the answer. If it does,
  // the model has stopped modelling the tier-1 short-circuit.
  const ownerOnly = { id: "x", legacy: "user", global: ["owner"] };
  const saved = ROLE_PERMISSIONS.owner;
  try {
    ROLE_PERMISSIONS.owner = [];
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(hasPermission(BEFORE, ownerOnly, permission), true, permission);
    }
  } finally {
    ROLE_PERMISSIONS.owner = saved;
  }
});

test("retiring the chat tier moves nobody, globally or per location", () => {
  const after = { inactive: new Set(["chat_owner", "chat_admin", "chat_member"]) };
  assert.deepEqual(globalMatrix(after, ACCOUNTS), globalMatrix(BEFORE, ACCOUNTS));
  assert.deepEqual(
    locationMatrix(after, ACCOUNTS, LOCATION_MEMBERSHIPS),
    locationMatrix(BEFORE, ACCOUNTS, LOCATION_MEMBERSHIPS),
  );
});

test("backfilling the global user role onto legacy accounts grants nothing new", () => {
  const backfilled = ACCOUNTS.map((a) =>
    a.legacy === "user" && a.global.length === 0 ? { ...a, global: ["user"] } : a,
  );
  assert.equal(backfilled.filter((a) => a.global[0] === "user").length, 10);
  const before = globalMatrix(BEFORE, ACCOUNTS);
  const after = globalMatrix(BEFORE, backfilled).map((cell) => cell);
  assert.deepEqual(after, before);
});

test("backfilling the null location role_id equals the CASE fallback", () => {
  const backfilled = LOCATION_MEMBERSHIPS.map((m) =>
    m.roleId === null ? { ...m, roleId: locationFallback(m.role) } : m,
  );
  assert.equal(LOCATION_MEMBERSHIPS.filter((m) => m.roleId === null).length, 1);
  assert.deepEqual(
    locationMatrix(BEFORE, ACCOUNTS, backfilled),
    locationMatrix(BEFORE, ACCOUNTS, LOCATION_MEMBERSHIPS),
  );
});

test("the roles the migration keeps are kept because retiring them would move somebody", () => {
  // `user` is the only global role three accounts hold; retiring it must be
  // visible in the model even though the legacy fallback grants the same key.
  const withoutUser = { inactive: new Set(["user"]) };
  const holders = ACCOUNTS.filter((a) => a.global.includes("user"));
  assert.ok(holders.length > 0, "fixture no longer has global user holders");
  // Same effective set only because tier 3 still answers. That is precisely why
  // the role row may not simply be deleted: the FK would cascade the rows away.
  assert.deepEqual(globalMatrix(withoutUser, ACCOUNTS), globalMatrix(BEFORE, ACCOUNTS));

  // Retiring owner/tech_admin, by contrast, strips four accounts to almost nothing.
  const withoutBypass = { inactive: new Set(["owner", "tech_admin"]) };
  const stripped = globalMatrix(withoutBypass, ACCOUNTS);
  assert.ok(
    stripped.length < globalMatrix(BEFORE, ACCOUNTS).length,
    "retiring the bypass roles must lose permissions",
  );
});

test("owner and tech_admin are indistinguishable because the bypass precedes role_permissions", () => {
  const ownerOnly = { id: "x", legacy: "user", global: ["owner"] };
  const techOnly = { id: "x", legacy: "user", global: ["tech_admin"] };
  for (const permission of ALL_PERMISSIONS) {
    assert.equal(
      hasPermission(BEFORE, ownerOnly, permission),
      hasPermission(BEFORE, techOnly, permission),
      permission,
    );
  }
  // And the bypass wins even if their permission rows were emptied, which is
  // why this duplication cannot be resolved by data alone.
  const emptied = { ...ROLE_PERMISSIONS, owner: [], tech_admin: [] };
  const saved = ROLE_PERMISSIONS.owner;
  try {
    ROLE_PERMISSIONS.owner = emptied.owner;
    assert.equal(hasPermission(BEFORE, ownerOnly, "system.manage"), true);
  } finally {
    ROLE_PERMISSIONS.owner = saved;
  }
});

// ---------------------------------------------------------------------
// Layer B: the migration file implements exactly that
// ---------------------------------------------------------------------

const CLUB_RENAMES = [
  ["location_owner", "Владелец локации"],
  ["location_admin", "Администратор локации"],
  ["location_manager", "Менеджер локации"],
  ["location_staff", "Сотрудник локации"],
  ["location_client", "Участник локации"],
];

test("every club-branded role name is renamed", () => {
  for (const [key, name] of CLUB_RENAMES) {
    const pattern = new RegExp(
      `update public\\.roles set name = '${name}'\\s+where key = '${key}'`,
      "u",
    );
    assert.match(sql, pattern, `missing rename for ${key}`);
  }
});

test("no user-facing club wording survives anywhere the migration writes", () => {
  // Only the rollback block and the prose explaining the change may say «клуб».
  const executable = sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(executable, /клуб/iu, "an executable statement still writes club wording");
  // And the strings it does write are club-free.
  for (const [, name] of CLUB_RENAMES) assert.doesNotMatch(name, /клуб/iu);
});

test("the renamed roles match the labels the client already falls back to", () => {
  const block = roleLabelsSource.match(
    /SYSTEM_ROLE_LABEL[^{]*\{([\s\S]*?)\n\};/u,
  );
  assert.ok(block, "SYSTEM_ROLE_LABEL not found in rolePermissions.ts");
  for (const [key, name] of CLUB_RENAMES) {
    const entry = new RegExp(`${key}:\\s*"([^"]+)"`, "u").exec(block[1]);
    assert.ok(entry, `SYSTEM_ROLE_LABEL has no ${key}`);
    assert.equal(
      entry[1],
      name,
      `DB rename for ${key} disagrees with the client fallback label`,
    );
  }
});

test("the chat tier is deactivated, guarded, and not deleted", () => {
  assert.match(sql, /update public\.roles\s+set is_active = false\s+where scope = 'chat'/u);
  assert.match(sql, /refusing to retire chat-scope roles/u);
  // A DELETE would cascade assignment rows away through the FKs.
  assert.doesNotMatch(sql, /delete\s+from\s+public\.roles/iu);
});

test("the migration never writes profiles.role and never touches the kept roles' access", () => {
  const executable = sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(executable, /update\s+public\.profiles\s+set\s+role/iu);
  assert.doesNotMatch(executable, /delete\s+from\s+public\.role_permissions/iu);
  assert.doesNotMatch(executable, /insert\s+into\s+public\.role_permissions/iu);
  // is_active is only ever written for the chat scope.
  const activeWrites = [...executable.matchAll(/set\s+is_active\s*=\s*(\w+)/giu)];
  assert.equal(activeWrites.length, 1, "is_active is written more than once");
  assert.equal(activeWrites[0][1], "false");
});

test("the backfills are additive, scoped, and idempotent", () => {
  assert.match(sql, /insert into public\.user_global_roles/u);
  assert.match(sql, /on conflict do nothing/u);
  // Only accounts that are legacy 'user' AND hold no global role at all.
  assert.match(sql, /p\.role = 'user'::public\.app_role/u);
  assert.match(sql, /not exists \(\s*select 1 from public\.user_global_roles ugr where ugr\.user_id = p\.id\s*\)/u);
  // The location backfill only fills NULLs.
  assert.match(sql, /update public\.location_members lm\s+set role_id = r\.id/u);
  assert.match(sql, /where lm\.role_id is null/u);
  // Renames are no-ops on a second run.
  for (const [, name] of CLUB_RENAMES) {
    assert.ok(
      sql.includes(`name is distinct from '${name}'`),
      `rename to ${name} is not guarded for re-run`,
    );
  }
});

test("the migration proves no access moved and aborts if it did", () => {
  assert.match(sql, /_roles_cleanup_global_before/u);
  assert.match(sql, /_roles_cleanup_location_before/u);
  assert.match(sql, /global permission drift: % gained, % lost/u);
  assert.match(sql, /location permission drift: % gained, % lost/u);
  assert.match(sql, /administrator lost a permission/u);
  // Both directions are checked, so a widening fails as loudly as a loss.
  const excepts = sql.match(/\bexcept\b/gu) ?? [];
  assert.ok(excepts.length >= 4, `expected 4 EXCEPT comparisons, found ${excepts.length}`);
  assert.match(sql, /^begin;$/mu);
  assert.match(sql, /^commit;$/mu);
});

test("the re-run hazard from the original seed is recorded", () => {
  // 20260514 upserts roles with `is_active = true` and the club names, so
  // replaying it silently reverts sections 2 and 3.
  assert.match(seedSql, /on conflict \(key\) do update/u);
  assert.match(seedSql, /is_active = true/u);
  assert.match(sql, /Re-run hazard/u);
  assert.match(sql, /20260514_dynamic_roles_permissions\.sql/u);
});

test("the deliberate non-changes are written down rather than silently skipped", () => {
  assert.match(sql, /Left alone on purpose/u);
  assert.match(sql, /location_client/u);
  assert.match(sql, /owner and tech_admin remain indistinguishable/u);
});
