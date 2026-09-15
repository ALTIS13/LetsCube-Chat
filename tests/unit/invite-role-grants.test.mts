// What an invitation may carry, and what the form holds (D-142, A-37 and A-36).
//
// Two complaints, one shape: a control offered and then refused. «Владелец» and
// «Тех. администратор» sat in «Глобальная роль» for every administrator and
// were refused after the press; «Автоматически» in «Роль в локации» could be
// chosen and not kept.
//
// The gate here is the one the database has, not the one the register
// described. `public.registration_invite_create`, read off production on
// 2026-09-15:
//
//   if v_global_role.key in ('owner', 'tech_admin')
//      and not public.has_permission(auth.uid(), 'system.manage') then
//     raise exception 'invite_critical_role_forbidden' using errcode = '42501';
//
// The entry — and the refusal message that shipped — said «только тех.
// администратор», which is a role. Building the fix from that sentence would
// have hidden the two roles from a global «Администратор» who holds
// `system.manage` and is allowed to grant them.
import assert from "node:assert/strict";
import test from "node:test";

import {
  INVITE_CRITICAL_ROLE_KEYS,
  INVITE_CRITICAL_ROLE_PERMISSION,
  canGrantGlobalRole,
  grantableGlobalRoles,
  inviteCriticalRoleRefusal,
  resolveLocationRoleId,
  withheldGlobalRoles,
  withheldGlobalRolesNote,
} from "../../artifacts/kub/src/lib/inviteRoleGrants.ts";

/** The five active global roles this deployment really has. */
const GLOBAL = [
  { id: "r-owner", key: "owner", scope: "global", is_active: true, name: "Владелец" },
  { id: "r-tech", key: "tech_admin", scope: "global", is_active: true, name: "Тех. администратор" },
  { id: "r-admin", key: "admin", scope: "global", is_active: true, name: "Администратор" },
  { id: "r-manager", key: "manager", scope: "global", is_active: true, name: "Менеджер" },
  { id: "r-user", key: "user", scope: "global", is_active: true, name: "Пользователь" },
];

/** And the five location ones, which belong to the other select. */
const LOCATION = [
  { id: "l-owner", key: "location_owner", scope: "location", is_active: true },
  { id: "l-admin", key: "location_admin", scope: "location", is_active: true },
  { id: "l-manager", key: "location_manager", scope: "location", is_active: true },
  { id: "l-staff", key: "location_staff", scope: "location", is_active: true },
  { id: "l-client", key: "location_client", scope: "location", is_active: true },
];

const ALL = [...GLOBAL, ...LOCATION];

const withPermission = { permissions: ["system.manage", "users.assign_roles"] };
const withoutPermission = { permissions: ["users.assign_roles"] };

test("the two critical keys are the two the function names", () => {
  assert.deepEqual([...INVITE_CRITICAL_ROLE_KEYS].sort(), ["owner", "tech_admin"]);
  assert.equal(INVITE_CRITICAL_ROLE_PERMISSION, "system.manage");
});

test("a caller without system.manage is offered exactly what the server accepts", () => {
  const offered = grantableGlobalRoles(ALL, withoutPermission).map((role) => role.key);
  assert.deepEqual(offered, ["admin", "manager", "user"]);

  // The location roles are a different select and never leak into this one,
  // whatever the permission is.
  assert.ok(!offered.some((key) => key.startsWith("location_")));
});

test("a caller with system.manage is offered all five, whatever their own role is", () => {
  const offered = grantableGlobalRoles(ALL, withPermission).map((role) => role.key);
  assert.deepEqual(offered, ["owner", "tech_admin", "admin", "manager", "user"]);
});

test("the permission decides, not the role — the register's own sentence is wrong", () => {
  // A global «Администратор» granted `system.manage`. `public.has_permission`
  // answers true for them through `role_permissions`, so the function accepts
  // the invitation. A gate written as «only tech_admin» would refuse it.
  assert.equal(canGrantGlobalRole(GLOBAL[0], { permissions: ["system.manage"] }), true);

  // And the reverse: holding `users.assign_roles` — which is what opens this
  // form at all — is not enough.
  assert.equal(canGrantGlobalRole(GLOBAL[1], { permissions: ["users.assign_roles"] }), false);
});

test("«Без глобальной роли» is always allowed: the function skips the block", () => {
  assert.equal(canGrantGlobalRole(null, withoutPermission), true);
  assert.equal(canGrantGlobalRole(undefined, withoutPermission), true);
});

test("an inactive or non-global role is never offered", () => {
  const roles = [
    { id: "x", key: "admin", scope: "global", is_active: false },
    { id: "y", key: "chat_admin", scope: "chat", is_active: true },
  ];
  assert.deepEqual(grantableGlobalRoles(roles, withPermission), []);
  assert.deepEqual(withheldGlobalRoles(roles, withoutPermission), []);
});

test("nothing critical is offered while the permission read is still in flight", () => {
  // Offering first and withdrawing a frame later is the same defect one step
  // smaller: the control was there when the person reached for it.
  const offered = grantableGlobalRoles(ALL, {
    permissions: ["system.manage"],
    checking: true,
  }).map((role) => role.key);
  assert.deepEqual(offered, ["admin", "manager", "user"]);
});

test("the withheld roles are named, and the note names the permission", () => {
  const withheld = withheldGlobalRoles(ALL, withoutPermission).map((role) => role.name);
  assert.deepEqual(withheld, ["Владелец", "Тех. администратор"]);

  const note = withheldGlobalRolesNote(withheld, "Менять технические настройки");
  assert.equal(
    note,
    "Роли «Владелец» и «Тех. администратор» может выдать только тот, кому разрешено «Менять технические настройки».",
  );

  // One withheld role takes the singular. Without the noun in front, the
  // sentence reads as though the roles were its subject.
  assert.equal(
    withheldGlobalRolesNote(["Владелец"], "Менять технические настройки"),
    "Роль «Владелец» может выдать только тот, кому разрешено «Менять технические настройки».",
  );

  // Nothing withheld, nothing said.
  assert.equal(withheldGlobalRolesNote([], "Менять технические настройки"), null);
});

test("the refusal that still comes back says the same thing as the note", () => {
  const refusal = inviteCriticalRoleRefusal("Менять технические настройки");
  assert.match(refusal, /Менять технические настройки/);
  // The sentence that shipped named a role. It must not come back.
  assert.doesNotMatch(refusal, /тех\. администратор/i);
});

// --- A-36: «Роль в локации» ------------------------------------------------

test("a role the list still has is kept — the old effect refilled it", () => {
  // The defect: the effect listed `locationRoleId` among its own dependencies
  // and overwrote every empty value, so «Автоматически» snapped back. The rule
  // keeps a deliberate choice.
  assert.equal(resolveLocationRoleId("l-admin", LOCATION), "l-admin");
  assert.equal(resolveLocationRoleId("l-manager", LOCATION), "l-manager");
});

test("nothing held, or something the list no longer has, falls to location_staff", () => {
  assert.equal(resolveLocationRoleId("", LOCATION), "l-staff");
  assert.equal(resolveLocationRoleId(null, LOCATION), "l-staff");
  assert.equal(resolveLocationRoleId(undefined, LOCATION), "l-staff");
  // A role archived while the form was open.
  assert.equal(resolveLocationRoleId("l-gone", LOCATION), "l-staff");
  // `location_staff` is picked by key rather than by position: it is fourth in
  // the list, so a rule that took the first would answer `l-owner` — which is
  // not what `registration_invite_create` resolves a null to.
  assert.notEqual(resolveLocationRoleId("", LOCATION), LOCATION[0].id);
});

test("with no location roles at all the answer is empty, and the server resolves it", () => {
  // Dynamic roles unavailable. The form sends `p_location_role_id: null` and
  // the function picks `location_staff` itself.
  assert.equal(resolveLocationRoleId("", []), "");
  assert.equal(resolveLocationRoleId("l-staff", []), "");
});

test("without location_staff the first role is the fallback, not an empty select", () => {
  const partial = [LOCATION[1], LOCATION[2]];
  assert.equal(resolveLocationRoleId("", partial), "l-admin");
});
