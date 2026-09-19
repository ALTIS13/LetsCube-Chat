import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import ts from "typescript";

import {
  effectiveGlobalRolePriority,
  sanctionMatrixVerdict,
  type GlobalRoleRank,
  type SanctionMatrixInput,
  type SanctionVerdict,
} from "../../artifacts/kub/src/lib/sanctions.ts";

/**
 * D-200: the users tab offered a manager a button the database refuses.
 *
 * The rule pinned here was read off production on 2026-09-19 rather than taken
 * from the register entry. `public.enforce_sanction_matrix()` is a BEFORE
 * INSERT and BEFORE DELETE trigger on `bans` and `mutes` and, since D-197,
 * ranks BOTH sides through `public.roles.priority`:
 *
 *     target = caller              -> refuse, before any rank is read
 *     caller_rank >= admin_rank    -> allow, whoever the target is
 *     caller_rank >= manager_rank  -> refuse iff target_rank >= admin_rank
 *     otherwise                    -> refuse
 *
 * The manager branch never compares the caller with the target; it asks only
 * whether the TARGET reaches the admin threshold.
 *
 * **The case is unreachable on this deployment, re-measured the same day**: all
 * 18 accounts rank either 100 (5 of them) or 10 (13), the `manager` and `admin`
 * global roles carry 0 assignments, no account carries `profiles.role =
 * 'manager'`, and the client's own `isStaff && !isAdmin` band is empty too.
 * Nothing in production can exercise the branch, so these fixtures build it.
 */

// The live global role table that day.
const OWNER = 100;
const TECH_ADMIN = 100;
const ADMIN = 80;
const MANAGER = 60;
const USER = 10;

const LIVE_ROLES: GlobalRoleRank[] = [
  { key: "owner", scope: "global", is_active: true, priority: OWNER },
  { key: "tech_admin", scope: "global", is_active: true, priority: TECH_ADMIN },
  { key: "admin", scope: "global", is_active: true, priority: ADMIN },
  { key: "manager", scope: "global", is_active: true, priority: MANAGER },
  { key: "user", scope: "global", is_active: true, priority: USER },
];

function verdict(overrides: Partial<SanctionMatrixInput>): SanctionVerdict {
  return sanctionMatrixVerdict({
    isSelf: false,
    callerIsServerStaff: true,
    callerPriority: MANAGER,
    targetPriority: USER,
    adminPriority: ADMIN,
    managerPriority: MANAGER,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test("the trigger refuses the caller themselves before it ranks anybody", () => {
  // `if subject = caller then raise` sits above the two threshold reads, so
  // even an owner is refused, and refused before any rank has been read.
  for (const callerPriority of [OWNER, ADMIN, MANAGER, USER, null]) {
    assert.equal(verdict({ isSelf: true, callerPriority }), "refused");
  }
  assert.equal(
    verdict({ isSelf: true, adminPriority: null, managerPriority: null, targetPriority: null }),
    "refused",
  );
});

test("RLS refuses anybody `is_manager_or_admin` does not admit, whatever they rank", () => {
  // `managers insert bans`, `managers delete bans` and the two `mutes` twins
  // all gate on it, so the row never reaches the trigger at all.
  assert.equal(verdict({ callerIsServerStaff: false, callerPriority: OWNER }), "refused");
  assert.equal(verdict({ callerIsServerStaff: false, callerPriority: null }), "refused");
});

test("«not asked yet» is not «the database says no»", () => {
  // D-198's lesson one layer up: both hide the control, but only one of them
  // is an answer, and a helper that spells them the same way cannot later tell
  // a caller why the control is missing.
  assert.equal(verdict({ callerIsServerStaff: null, callerPriority: OWNER }), "unknown");
  assert.equal(verdict({ callerIsServerStaff: null, callerPriority: USER }), "unknown");
  // Except about themselves, which the client always knows.
  assert.equal(verdict({ callerIsServerStaff: null, isSelf: true }), "refused");
});

test("at or above the admin threshold the target does not matter", () => {
  for (const callerPriority of [ADMIN, ADMIN + 1, OWNER]) {
    for (const targetPriority of [0, USER, MANAGER, ADMIN, OWNER]) {
      assert.equal(
        verdict({ callerPriority, targetPriority }),
        "allowed",
        `caller ${callerPriority} target ${targetPriority}`,
      );
    }
  }
});

test("a manager may not sanction somebody who is an owner by global role alone", () => {
  // THE DEFECT. `profiles.role` says `user`; three accounts on this deployment
  // are shaped exactly like that. The old client test `target.role !== "admin"`
  // said yes, and the database says no.
  assert.equal(verdict({ callerPriority: MANAGER, targetPriority: OWNER }), "refused");
  assert.equal(verdict({ callerPriority: MANAGER, targetPriority: TECH_ADMIN }), "refused");
});

test("a manager may sanction an ordinary account, and another manager", () => {
  assert.equal(verdict({ callerPriority: MANAGER, targetPriority: USER }), "allowed");
  // The trigger holds no caller-vs-target comparison at all: equal ranks are
  // not a tie to be broken, they are simply both below the admin threshold.
  assert.equal(verdict({ callerPriority: MANAGER, targetPriority: MANAGER }), "allowed");
});

test("both comparisons are non-strict, in both directions", () => {
  // Exactly at the admin threshold the caller takes the first branch rather
  // than the manager branch; exactly at it, a target is refused to a manager.
  assert.equal(verdict({ callerPriority: ADMIN, targetPriority: OWNER }), "allowed");
  assert.equal(verdict({ callerPriority: ADMIN - 1, targetPriority: ADMIN }), "refused");
  assert.equal(verdict({ callerPriority: ADMIN - 1, targetPriority: ADMIN - 1 }), "allowed");
  assert.equal(verdict({ callerPriority: MANAGER, targetPriority: USER }), "allowed");
  assert.equal(verdict({ callerPriority: MANAGER - 1, targetPriority: USER }), "refused");
});

test("outranking the caller is not the same question as reaching the threshold", () => {
  // A role seeded between the two thresholds outranks a manager and is still
  // not an administrator, so the trigger allows it. A client that compared the
  // two ranks with each other instead of the target with the threshold would
  // refuse here, and would be wrong in the other direction.
  assert.equal(verdict({ callerPriority: MANAGER, targetPriority: 70 }), "allowed");
});

test("a caller below the manager threshold is refused even though RLS let them in", () => {
  assert.equal(verdict({ callerPriority: USER, targetPriority: USER }), "refused");
});

// ---------------------------------------------------------------------------
// What the client does not know
// ---------------------------------------------------------------------------

test("an unknown caller rank is never an answer", () => {
  assert.equal(verdict({ callerPriority: null }), "unknown");
  assert.equal(verdict({ callerPriority: null, targetPriority: USER }), "unknown");
});

test("an unknown target rank is unknown, not permission", () => {
  assert.equal(verdict({ callerPriority: MANAGER, targetPriority: null }), "unknown");
  // Except where the trigger never reads the target at all.
  assert.equal(verdict({ callerPriority: ADMIN, targetPriority: null }), "allowed");
});

test("without the thresholds only the arithmetic the branches guarantee is used", () => {
  // A manager reads one row of `public.roles` (measured), so `admin_rank` is
  // not knowable to them. A target who does not outrank the caller is below the
  // admin threshold whenever the caller is, and irrelevant when the caller is
  // above it; anybody higher could be on either side of it.
  const blind = { adminPriority: null, managerPriority: null } as const;
  assert.equal(verdict({ ...blind, callerPriority: MANAGER, targetPriority: USER }), "allowed");
  assert.equal(verdict({ ...blind, callerPriority: MANAGER, targetPriority: MANAGER }), "allowed");
  assert.equal(verdict({ ...blind, callerPriority: MANAGER, targetPriority: OWNER }), "unknown");
  assert.equal(verdict({ ...blind, callerPriority: MANAGER, targetPriority: null }), "unknown");
});

test("a missing manager threshold alone does not invent permission", () => {
  assert.equal(
    verdict({ managerPriority: null, callerPriority: USER, targetPriority: USER }),
    "allowed",
  );
  // ...while the admin threshold still bites, which is the half that matters.
  assert.equal(
    verdict({ managerPriority: null, callerPriority: USER, targetPriority: OWNER }),
    "refused",
  );
});

// ---------------------------------------------------------------------------
// The rank itself
// ---------------------------------------------------------------------------

test("the legacy column still ranks, exactly as `has_global_role` folds it in", () => {
  // Two accounts here are `admin` by the column with no assignment at all.
  assert.equal(
    effectiveGlobalRolePriority({ legacyRole: "admin", assignedRoleKeys: [], globalRoles: LIVE_ROLES }),
    ADMIN,
  );
  assert.equal(
    effectiveGlobalRolePriority({ legacyRole: "manager", assignedRoleKeys: [], globalRoles: LIVE_ROLES }),
    MANAGER,
  );
});

test("a global assignment outranks the column, which is the shape D-200 misread", () => {
  // `profiles.role = 'user'` with `owner` held globally: three accounts today.
  assert.equal(
    effectiveGlobalRolePriority({ legacyRole: "user", assignedRoleKeys: ["owner"], globalRoles: LIVE_ROLES }),
    OWNER,
  );
  assert.equal(
    effectiveGlobalRolePriority({ legacyRole: "user", assignedRoleKeys: ["tech_admin"], globalRoles: LIVE_ROLES }),
    TECH_ADMIN,
  );
  // And the highest of several wins, the way `max(priority)` does.
  assert.equal(
    effectiveGlobalRolePriority({
      legacyRole: "user",
      assignedRoleKeys: ["manager", "owner"],
      globalRoles: LIVE_ROLES,
    }),
    OWNER,
  );
});

test("the floor is the `user` role, not zero", () => {
  // `profiles.role` is an enum whose three values are exactly the keys the
  // column branch of `has_global_role` accepts, so everybody matches `user` at
  // least. Measured: 13 accounts at 10 and none at 0.
  assert.equal(
    effectiveGlobalRolePriority({ legacyRole: "user", assignedRoleKeys: [], globalRoles: LIVE_ROLES }),
    USER,
  );
});

test("a value the column cannot hold matches no key", () => {
  // `has_global_role` consults the column only for 'admin', 'manager', 'user'.
  assert.equal(
    effectiveGlobalRolePriority({ legacyRole: "owner", assignedRoleKeys: [], globalRoles: LIVE_ROLES }),
    0,
  );
});

test("location and retired roles do not rank", () => {
  const roles: GlobalRoleRank[] = [
    ...LIVE_ROLES,
    { key: "location_owner", scope: "location", is_active: true, priority: 1000 },
    { key: "retired", scope: "global", is_active: false, priority: 999 },
  ];
  assert.equal(
    effectiveGlobalRolePriority({
      legacyRole: "user",
      assignedRoleKeys: ["location_owner", "retired"],
      globalRoles: roles,
    }),
    USER,
  );
});

test("an empty role table is «not loaded», never «holds nothing»", () => {
  assert.equal(
    effectiveGlobalRolePriority({ legacyRole: "admin", assignedRoleKeys: ["owner"], globalRoles: [] }),
    null,
  );
});

// ---------------------------------------------------------------------------
// The wiring. Without this the rule above can be perfect while the tab still
// asks the legacy column, which is exactly the state D-200 recorded. Read off
// the syntax tree, so a comment quoting the old line neither satisfies these
// nor breaks them.
// ---------------------------------------------------------------------------

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const TAB = path.resolve(HERE, "../../artifacts/kub/src/pages/admin/UsersTab.tsx");

function tabSource(): ts.SourceFile {
  const raw = fs.readFileSync(TAB, "utf8");
  return ts.createSourceFile(TAB, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** The initializer text of `const NAME = ...`, wherever it is declared. */
function initializerOf(source: ts.SourceFile, name: string): string {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer.getText(source);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  assert.ok(found !== undefined, `no const ${name} in UsersTab.tsx`);
  return found as string;
}

test("the tab's sanction control is decided by the matrix, not by a column", () => {
  const source = tabSource();

  const canSanction = initializerOf(source, "canSanction");
  assert.ok(canSanction.includes("sanctionVerdict("), canSanction);
  assert.ok(canSanction.includes('=== "allowed"'), canSanction);
  assert.ok(!canSanction.includes(".role"), "canSanction reads a role column again");
  assert.ok(!canSanction.includes("isAdmin"), "canSanction is back on the wide client predicate");

  const sanctionVerdict = initializerOf(source, "sanctionVerdict");
  assert.ok(sanctionVerdict.includes("sanctionMatrixVerdict("), sanctionVerdict);
  // Both sides ranked, and ranked by the same function.
  assert.ok(sanctionVerdict.includes("callerPriority,"), sanctionVerdict);
  assert.ok(
    sanctionVerdict.includes("targetPriority: priorityOf(target.id, target.role)"),
    sanctionVerdict,
  );
  // The RLS mirror, and «still checking» passed through as unknown rather than
  // flattened into the refusal it is not.
  assert.ok(sanctionVerdict.includes("serverStaff.allowed"), sanctionVerdict);
  assert.ok(sanctionVerdict.includes("serverStaff.checking ? null"), sanctionVerdict);
  assert.ok(sanctionVerdict.includes("adminPriority,"), sanctionVerdict);
  assert.ok(sanctionVerdict.includes("managerPriority,"), sanctionVerdict);
});

test("the rank the tab hands the matrix is the database's, from either route", () => {
  const source = tabSource();

  const priorityOf = initializerOf(source, "priorityOf");
  // The local route is the mirror of the database function...
  assert.ok(priorityOf.includes("effectiveGlobalRolePriority("), priorityOf);
  assert.ok(priorityOf.includes("globalRoles: activeGlobalRoles"), priorityOf);
  // ...and the fallback is the database function itself, for the callers who
  // may not read `public.roles`.
  assert.ok(priorityOf.includes("askedPriorities[userId]"), priorityOf);

  const adminPriority = initializerOf(source, "adminPriority");
  assert.ok(adminPriority.includes('key === "admin"'), adminPriority);
  assert.ok(adminPriority.includes(".priority"), adminPriority);
  assert.ok(
    adminPriority.includes("?? null"),
    "a missing admin role must read as unknown, not as 0",
  );

  const raw = fs.readFileSync(TAB, "utf8");
  assert.ok(
    raw.includes('supabase.rpc("effective_global_role_priority"'),
    "the fallback rank must come from the database's own function",
  );
});
