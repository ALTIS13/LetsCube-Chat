// The ladder the roles panel draws, and the arithmetic behind its arrows.
//
// The fixture is the production `roles` table read on 2026-09-04, in the order
// the panel's own query returns it — scope, then is_system, then name — which
// is exactly the order the owner complained about: «Администратор» above
// «Владелец», and nothing on screen saying which one outranks which.
//
// Every test below is about *presentation*. Nothing here decides access, and
// the last test in the file is the one that says so.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ROLE_PRIORITY_MAX,
  ROLE_PRIORITY_MIN,
  buildRoleHierarchy,
  clampRolePriority,
  isValidRoleColour,
  normalizeRoleColour,
  parseRolePriorityInput,
  planPriorityMove,
  rankLevels,
  roleFormSignature,
  roleSwatchColour,
  sortRolesByHierarchy,
  type PriorityMoveDirection,
  type RoleRankFields,
} from "../../artifacts/kub/src/lib/roleHierarchy.ts";

type Role = RoleRankFields & { colour: string | null; is_active: boolean };

/** public.roles as measured in production, query order. */
const PRODUCTION_ROLES: Role[] = [
  { id: "r-chat-admin", key: "chat_admin", name: "Администратор чата", scope: "chat", priority: 40, colour: "#f04a92", is_active: false },
  { id: "r-chat-owner", key: "chat_owner", name: "Владелец чата", scope: "chat", priority: 50, colour: "#F5B50A", is_active: false },
  { id: "r-chat-member", key: "chat_member", name: "Участник", scope: "chat", priority: 10, colour: null, is_active: false },
  { id: "r-admin", key: "admin", name: "Администратор", scope: "global", priority: 80, colour: "#f04a92", is_active: true },
  { id: "r-owner", key: "owner", name: "Владелец", scope: "global", priority: 100, colour: "#F5B50A", is_active: true },
  { id: "r-manager", key: "manager", name: "Менеджер", scope: "global", priority: 60, colour: "#4DCD5E", is_active: true },
  { id: "r-user", key: "user", name: "Пользователь", scope: "global", priority: 10, colour: null, is_active: true },
  { id: "r-tech", key: "tech_admin", name: "Тех. администратор", scope: "global", priority: 100, colour: "#4d8bd0", is_active: true },
  { id: "r-loc-admin", key: "location_admin", name: "Администратор локации", scope: "location", priority: 40, colour: "#f04a92", is_active: true },
  { id: "r-loc-owner", key: "location_owner", name: "Владелец локации", scope: "location", priority: 50, colour: "#F5B50A", is_active: true },
  { id: "r-loc-manager", key: "location_manager", name: "Менеджер локации", scope: "location", priority: 30, colour: "#4DCD5E", is_active: true },
  { id: "r-loc-staff", key: "location_staff", name: "Сотрудник локации", scope: "location", priority: 20, colour: "#4d8bd0", is_active: true },
  { id: "r-loc-client", key: "location_client", name: "Участник локации", scope: "location", priority: 10, colour: null, is_active: true },
];

const keysOf = (roles: readonly RoleRankFields[]) => roles.map((role) => role.key);

/** Where a role sits in the flat rendered order. */
function renderedIndex(roles: readonly Role[], id: string): number {
  return buildRoleHierarchy(roles)
    .flatMap((group) => group.entries)
    .findIndex((entry) => entry.role.id === id);
}

function applyMove(roles: readonly Role[], id: string, priority: number): Role[] {
  return roles.map((role) => (role.id === id ? { ...role, priority } : role));
}

// ---------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------

test("the ladder runs from the founder down, not alphabetically", () => {
  const global = sortRolesByHierarchy(PRODUCTION_ROLES).filter((role) => role.scope === "global");
  assert.deepEqual(keysOf(global), ["owner", "tech_admin", "admin", "manager", "user"]);

  // The order the panel used to render, kept here so this test states what it
  // is replacing: `admin` was first and `owner` third.
  const byName = [...PRODUCTION_ROLES]
    .filter((role) => role.scope === "global")
    .sort((a, b) => a.name.localeCompare(b.name, "ru-RU"));
  assert.equal(byName[0].key, "admin");
  assert.equal(keysOf(byName)[0] !== keysOf(global)[0], true);
});

test("scopes are grouped in reading order and never interleaved", () => {
  const groups = buildRoleHierarchy(PRODUCTION_ROLES);
  assert.deepEqual(groups.map((group) => group.scope), ["global", "location", "chat"]);
  assert.deepEqual(
    groups.map((group) => group.entries.length),
    [5, 5, 3],
  );
});

test("the scope order is fixed, not inherited from whichever rank happens to be highest", () => {
  // Ranks are only ever compared inside a scope, so a location role numbered
  // above every global one must not drag its whole group to the top. The
  // production fixture cannot show this — its global ranks are the highest —
  // which is exactly why this case is written by hand.
  const inverted: Role[] = [
    ...PRODUCTION_ROLES.filter((role) => role.scope !== "location"),
    ...PRODUCTION_ROLES.filter((role) => role.scope === "location").map((role) => ({
      ...role,
      priority: role.priority + 900,
    })),
    { id: "r-alien", key: "alien", name: "Неизвестная область", scope: "district", priority: 5000, colour: null, is_active: true },
  ];
  const groups = buildRoleHierarchy(inverted);
  // An unfamiliar scope is shown last rather than dropped or promoted.
  assert.deepEqual(groups.map((group) => group.scope), ["global", "location", "chat", "district"]);
  assert.equal(groups[0].entries[0].role.key, "owner");
  assert.equal(groups[1].entries[0].role.key, "location_owner");
});

test("each scope is its own ladder: 50 leads the location list while 100 leads the global one", () => {
  const groups = buildRoleHierarchy(PRODUCTION_ROLES);
  const location = groups.find((group) => group.scope === "location")!;
  assert.deepEqual(
    keysOf(location.entries.map((entry) => entry.role)),
    ["location_owner", "location_admin", "location_manager", "location_staff", "location_client"],
  );
  // Rank is position within the scope, so the location owner is first there
  // even though its 50 is below every global rank.
  assert.equal(location.entries[0].rank, 1);
  assert.equal(location.entries[0].role.priority, 50);
});

test("a deactivated role keeps its place instead of vanishing from the list", () => {
  // The three chat roles are is_active = false since 20260904060000. The panel
  // still has to show them, badged, or an administrator cannot find them.
  const chat = buildRoleHierarchy(PRODUCTION_ROLES).find((group) => group.scope === "chat")!;
  assert.equal(chat.entries.length, 3);
  assert.equal(chat.entries.every((entry) => !entry.role.is_active), true);
});

// ---------------------------------------------------------------------
// The tie
// ---------------------------------------------------------------------

test("owner and tech_admin share rank 1, and admin is rank 2 rather than 3", () => {
  const global = buildRoleHierarchy(PRODUCTION_ROLES).find((group) => group.scope === "global")!;
  const byKey = new Map(global.entries.map((entry) => [entry.role.key, entry]));

  assert.equal(byKey.get("owner")!.rank, 1);
  assert.equal(byKey.get("tech_admin")!.rank, 1);
  assert.equal(byKey.get("owner")!.sharesRank, true);
  assert.equal(byKey.get("tech_admin")!.sharesRank, true);

  // A row index would say 3 here. Rank counts ranks, so the tie is one step.
  assert.equal(byKey.get("admin")!.rank, 2);
  assert.equal(byKey.get("admin")!.sharesRank, false);
  assert.equal(byKey.get("user")!.rank, 4);
});

test("rankLevels reports the distinct ranks of one scope, highest first", () => {
  assert.deepEqual(rankLevels(PRODUCTION_ROLES, "global"), [100, 80, 60, 10]);
  assert.deepEqual(rankLevels(PRODUCTION_ROLES, "location"), [50, 40, 30, 20, 10]);
});

// ---------------------------------------------------------------------
// The arrows
// ---------------------------------------------------------------------

test("a plan is refused exactly where the arrow must be disabled", () => {
  // Bottom of its scope and alone there.
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-user", "down"), null);
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-loc-client", "down"), null);
  // Not a role.
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-nope", "up"), null);
  // Alone at the top of its scope: nothing above to pass.
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-loc-owner", "up"), null);
});

test("the top of a tie can still be broken upward, which is the only move left there", () => {
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-owner", "up"), 101);
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-tech", "up"), 101);
});

test("moving up clears a whole shared rank rather than landing inside it", () => {
  // 100 is held by two roles whose equality is deliberate. Landing on 100 would
  // deny it; the plan goes past both.
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-admin", "up"), 101);
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-manager", "up"), 81);
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-owner", "down"), 79);
  assert.equal(planPriorityMove(PRODUCTION_ROLES, "r-manager", "down"), 9);
});

/** How many roles in the same scope this one is strictly above. */
function outranked(roles: readonly Role[], id: string): number {
  const role = roles.find((candidate) => candidate.id === id)!;
  return roles.filter(
    (peer) => peer.id !== role.id && peer.scope === role.scope && peer.priority < role.priority,
  ).length;
}

test("every planned move gains ground on a role it did not outrank before", () => {
  // The property the arrows promise, stated so it also covers breaking out of a
  // tie: `owner` pressing ↑ does not change its row, it stops sharing rank 1
  // with `tech_admin`. A plan that lands *on* the rank above instead of past it
  // gains nothing for at least one role, so this fails if the planner stops
  // clearing the rank it is passing.
  let checked = 0;
  for (const role of PRODUCTION_ROLES) {
    for (const direction of ["up", "down"] as PriorityMoveDirection[]) {
      const target = planPriorityMove(PRODUCTION_ROLES, role.id, direction);
      if (target === null) continue;
      checked += 1;
      const moved = applyMove(PRODUCTION_ROLES, role.id, target);
      const before = outranked(PRODUCTION_ROLES, role.id);
      const after = outranked(moved, role.id);
      if (direction === "up") {
        assert.ok(after > before, `${role.key} gained nothing moving up: ${before} -> ${after}`);
      } else {
        assert.ok(after < before, `${role.key} lost nothing moving down: ${before} -> ${after}`);
      }

      // A role that is alone at its rank must also visibly change row.
      const alone = !PRODUCTION_ROLES.some(
        (peer) => peer.id !== role.id && peer.scope === role.scope && peer.priority === role.priority,
      );
      if (!alone) continue;
      const rowBefore = renderedIndex(PRODUCTION_ROLES, role.id);
      const rowAfter = renderedIndex(moved, role.id);
      if (direction === "up") assert.ok(rowAfter < rowBefore, `${role.key} did not move up a row`);
      else assert.ok(rowAfter > rowBefore, `${role.key} did not move down a row`);
    }
  }
  assert.ok(checked >= 20, `too few moves exercised: ${checked}`);
});

test("a move rewrites one role and leaves every other rank alone", () => {
  const target = planPriorityMove(PRODUCTION_ROLES, "r-admin", "up")!;
  const after = applyMove(PRODUCTION_ROLES, "r-admin", target);
  for (const role of PRODUCTION_ROLES) {
    if (role.id === "r-admin") continue;
    assert.equal(
      after.find((candidate) => candidate.id === role.id)!.priority,
      role.priority,
      `${role.key} was renumbered by someone else's move`,
    );
  }
  // And the deliberate tie survives a move that passed it.
  const global = buildRoleHierarchy(after).find((group) => group.scope === "global")!;
  const byKey = new Map(global.entries.map((entry) => [entry.role.key, entry]));
  assert.equal(byKey.get("owner")!.rank, byKey.get("tech_admin")!.rank);
  assert.equal(byKey.get("owner")!.sharesRank, true);
});

test("a role never leaves its own scope, however often it is pushed", () => {
  let roles = PRODUCTION_ROLES;
  for (let step = 0; step < 40; step += 1) {
    const target = planPriorityMove(roles, "r-loc-client", "up");
    if (target === null) break;
    roles = applyMove(roles, "r-loc-client", target);
  }
  const groups = buildRoleHierarchy(roles);
  assert.equal(groups.map((group) => group.scope).join(","), "global,location,chat");
  assert.equal(groups.find((group) => group.scope === "location")!.entries[0].role.key, "location_client");
  assert.equal(groups.find((group) => group.scope === "global")!.entries[0].role.key, "owner");
});

test("the plan stops at the ends of the writable range instead of running away", () => {
  const capped: Role[] = [
    { id: "a", key: "a", name: "A", scope: "global", priority: ROLE_PRIORITY_MAX, colour: null, is_active: true },
    { id: "b", key: "b", name: "B", scope: "global", priority: ROLE_PRIORITY_MAX, colour: null, is_active: true },
  ];
  // Both are at the ceiling and tied: up has nowhere to go, down does.
  assert.equal(planPriorityMove(capped, "a", "up"), null);
  assert.equal(planPriorityMove(capped, "a", "down"), ROLE_PRIORITY_MAX - 1);

  const floored: Role[] = [
    { id: "a", key: "a", name: "A", scope: "global", priority: ROLE_PRIORITY_MIN, colour: null, is_active: true },
    { id: "b", key: "b", name: "B", scope: "global", priority: ROLE_PRIORITY_MIN, colour: null, is_active: true },
  ];
  assert.equal(planPriorityMove(floored, "a", "down"), null);
  assert.equal(planPriorityMove(floored, "a", "up"), ROLE_PRIORITY_MIN + 1);
});

test("a rank typed by hand is clamped, and nonsense is refused rather than guessed", () => {
  assert.equal(parseRolePriorityInput("75"), 75);
  assert.equal(parseRolePriorityInput("  75  "), 75);
  assert.equal(parseRolePriorityInput("-5"), ROLE_PRIORITY_MIN);
  assert.equal(parseRolePriorityInput("99999"), ROLE_PRIORITY_MAX);
  assert.equal(parseRolePriorityInput(""), null);
  assert.equal(parseRolePriorityInput("высоко"), null);
  assert.equal(parseRolePriorityInput("7.5"), null);
  assert.equal(clampRolePriority(Number.NaN), ROLE_PRIORITY_MIN);
});

// ---------------------------------------------------------------------
// The colour
// ---------------------------------------------------------------------

test("only six hex digits reach a style attribute", () => {
  // Everything a person might type, and everything an attacker might.
  assert.equal(normalizeRoleColour("#4d8bd0"), "#4d8bd0");
  assert.equal(normalizeRoleColour("#F5B50A"), "#f5b50a");
  assert.equal(normalizeRoleColour("  4d8bd0 "), "#4d8bd0");
  assert.equal(normalizeRoleColour("#fff"), "#ffffff");

  for (const rejected of [
    "red",
    "#12345",
    "#1234567",
    "rgb(0,0,0)",
    "#00ff00; background-image: url(https://example.test/x)",
    "url(javascript:alert(1))",
    "var(--kub-danger)",
    "expression(alert(1))",
    "",
    "   ",
    null,
    undefined,
    42,
    { toString: () => "#ffffff" },
  ]) {
    assert.equal(normalizeRoleColour(rejected), null, `${String(rejected)} must not become a colour`);
    assert.equal(isValidRoleColour(rejected), false);
  }
});

test("a role with no colour asks for a neutral rather than a broken one", () => {
  assert.equal(roleSwatchColour({ colour: null }), null);
  assert.equal(roleSwatchColour({ colour: "#F5B50A" }), "#f5b50a");
  assert.equal(
    roleSwatchColour(PRODUCTION_ROLES.find((role) => role.key === "user")!),
    null,
  );
});

// ---------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------

test("the form is refilled for a real change and left alone for a reordering of the same data", () => {
  const role = PRODUCTION_ROLES.find((candidate) => candidate.key === "manager")!;
  const base = roleFormSignature({ ...role, description: "Операционная роль" }, ["tasks.view", "tasks.create"]);

  // The same set arriving in another row order is not a change.
  assert.equal(
    roleFormSignature({ ...role, description: "Операционная роль" }, ["tasks.create", "tasks.view"]),
    base,
  );

  // Each field the form shows is a change.
  const variants = [
    { ...role, description: "Операционная роль", name: "Менеджер смены" },
    { ...role, description: "Другое описание" },
    { ...role, description: "Операционная роль", is_active: false },
    { ...role, description: "Операционная роль", priority: 61 },
    { ...role, description: "Операционная роль", colour: "#000000" },
  ];
  for (const variant of variants) {
    assert.notEqual(roleFormSignature(variant, ["tasks.view", "tasks.create"]), base);
  }
  assert.notEqual(roleFormSignature({ ...role, description: "Операционная роль" }, ["tasks.view"]), base);
});

test("two roles cannot forge the same signature by moving text across fields", () => {
  const left = roleFormSignature(
    { id: "x", name: "Смена", description: "Ночь", is_active: true, priority: 10, colour: null },
    [],
  );
  const right = roleFormSignature(
    { id: "x", name: "Смена Ночь", description: "", is_active: true, priority: 10, colour: null },
    [],
  );
  assert.notEqual(left, right);
});

// ---------------------------------------------------------------------
// The thing the whole list must not imply
// ---------------------------------------------------------------------

test("rank is presentation: the module reads nothing that decides access", () => {
  // has_permission answers from the owner/tech_admin short-circuit, then
  // role_permissions, then the legacy profiles.role fallback. None of them is
  // reachable from here, and this asserts it structurally: the ordering is
  // identical whether a role is active, and whatever permissions it holds.
  const withPermissions = PRODUCTION_ROLES.map((role) => ({
    ...role,
    permissions: role.key === "user" ? ["system.manage"] : [],
    is_active: role.key === "owner" ? false : role.is_active,
  }));
  assert.deepEqual(
    keysOf(sortRolesByHierarchy(withPermissions)),
    keysOf(sortRolesByHierarchy(PRODUCTION_ROLES)),
  );
  assert.equal(
    planPriorityMove(withPermissions, "r-admin", "up"),
    planPriorityMove(PRODUCTION_ROLES, "r-admin", "up"),
  );
});
