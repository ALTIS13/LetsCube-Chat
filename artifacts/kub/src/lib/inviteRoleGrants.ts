/**
 * Which global role an invitation may carry — decided the way the database
 * decides it, and therefore before the select is drawn rather than after the
 * press (D-142, A-37).
 *
 * `public.registration_invite_create`, read off production on 2026-09-15:
 *
 *     perform public._require_permission('users.assign_roles');
 *     ...
 *     if p_global_role_id is not null then
 *       select * into v_global_role
 *         from public.roles
 *        where id = p_global_role_id and scope = 'global' and is_active;
 *       if not found then
 *         raise exception 'invite_global_role_invalid' ...
 *       end if;
 *       if v_global_role.key in ('owner', 'tech_admin')
 *          and not public.has_permission(auth.uid(), 'system.manage') then
 *         raise exception 'invite_critical_role_forbidden' using errcode = '42501';
 *       end if;
 *     end if;
 *
 * **The register's own words for this defect are wrong about the server, and
 * building the fix from them would have drawn the wrong gate.** The entry — and
 * the refusal message the screen has been showing since — says «Критические
 * роли может выдавать только тех. администратор», naming a *role*. The database
 * names a *permission*: `system.manage`. The two are not the same set.
 * `public.has_permission` (also read the same day) answers true for
 * `has_global_role(uid,'owner')` and `has_global_role(uid,'tech_admin')`
 * unconditionally, **and** for anybody holding a global role whose
 * `role_permissions` carry the key, **and** for the legacy `profiles.role`
 * column through `_legacy_role_has_permission`. So a global «Администратор»
 * granted `system.manage` may create such an invitation and would have been
 * refused by a role check; and the permission is global-scoped in that function
 * (`r.scope = 'global'`), so a location role carrying it grants nothing here.
 *
 * Which is why this module takes the permission keys the caller actually holds
 * and never a role name. The screen already asks for exactly that
 * (`usePermissionAccess(["system.manage"])`), so nothing new is fetched.
 *
 * Not in `lib/serverRoleAccess.ts`: that module is the two *role* predicates
 * (`is_manager_or_admin`, `is_admin`) which RLS policies gate on. This is a
 * permission gate inside one `security definer` function, and folding it in
 * would blur the distinction that module exists to keep.
 */

/** The permission `registration_invite_create` asks for before a critical role. */
export const INVITE_CRITICAL_ROLE_PERMISSION = "system.manage";

/**
 * The role keys that permission guards.
 *
 * Keys, not labels: `public.roles` is editable, and «Владелец» could be renamed
 * tomorrow while `owner` stays what the function compares against.
 */
export const INVITE_CRITICAL_ROLE_KEYS: readonly string[] = ["owner", "tech_admin"];

/** The least a role has to carry for this module to decide anything about it. */
export interface GrantableRole {
  readonly key: string;
  readonly scope?: string | null;
  readonly is_active?: boolean | null;
}

export interface InviteGrantAccess {
  /** The permission keys the caller holds. */
  readonly permissions: Iterable<string> | null | undefined;
  /**
   * Whether the permission lookup is still in flight.
   *
   * While it is, nothing critical is offered. Offering first and withdrawing a
   * frame later is the same defect one step smaller: a control that was there
   * when the person reached for it and refuses when they press.
   */
  readonly checking?: boolean;
}

function holds(access: InviteGrantAccess, permission: string): boolean {
  if (access.checking) return false;
  for (const key of access.permissions ?? []) {
    if (key === permission) return true;
  }
  return false;
}

/** Whether `registration_invite_create` would accept this role from this caller. */
export function canGrantGlobalRole(
  role: GrantableRole | null | undefined,
  access: InviteGrantAccess,
): boolean {
  if (!role) return true; // «Без глобальной роли» — the function skips the block entirely.
  if (!INVITE_CRITICAL_ROLE_KEYS.includes(role.key)) return true;
  return holds(access, INVITE_CRITICAL_ROLE_PERMISSION);
}

/** The roles to put in the select: the active global ones this caller may grant. */
export function grantableGlobalRoles<T extends GrantableRole>(
  roles: readonly T[],
  access: InviteGrantAccess,
): T[] {
  return roles.filter(
    (role) =>
      role.scope === "global" && role.is_active !== false && canGrantGlobalRole(role, access),
  );
}

/** The roles withheld from this caller, so the screen can say which and why. */
export function withheldGlobalRoles<T extends GrantableRole>(
  roles: readonly T[],
  access: InviteGrantAccess,
): T[] {
  return roles.filter(
    (role) =>
      role.scope === "global" && role.is_active !== false && !canGrantGlobalRole(role, access),
  );
}

/**
 * Why those roles are not on the list, in the permission's own words.
 *
 * `label` is `PERMISSION_LABEL[INVITE_CRITICAL_ROLE_PERMISSION]`, passed in
 * rather than imported, so this module stays free of the whole permission
 * catalogue and a `node --test` process can read it. The caller names the roles
 * from `getRoleLabel`, which is where every other role label on that screen
 * comes from.
 */
export function withheldGlobalRolesNote(roleLabels: readonly string[], permissionLabel: string): string | null {
  if (roleLabels.length === 0) return null;
  const list = roleLabels.map((label) => `«${label}»`).join(" и ");
  // «Роль»/«Роли» is not decoration. Without it the sentence reads as though
  // the roles were its subject — «"Владелец" и "Тех. администратор" может
  // выдать…», which is both ungrammatical and the wrong parse. With it, the
  // roles are the object and «тот» is the subject, and the verb agrees. Caught
  // by looking at the rendered frame, not by a test.
  const noun = roleLabels.length === 1 ? "Роль" : "Роли";
  return `${noun} ${list} может выдать только тот, кому разрешено «${permissionLabel}».`;
}

/**
 * The same sentence for the refusal that comes back anyway.
 *
 * It can still happen: the permission may be taken away between the render and
 * the press, and a second tab can create the invitation first.
 */
export function inviteCriticalRoleRefusal(permissionLabel: string): string {
  return `Эту глобальную роль может выдать только тот, кому разрешено «${permissionLabel}».`;
}

/**
 * Which role in the location the invitation form should hold (D-142, A-36).
 *
 * «Автоматически» is gone from the select, and this is why. It was the empty
 * value, and an effect put `location_staff` back the instant it was chosen, so
 * it could not stay selected — but removing the effect would have been the
 * wrong repair, because the option never named a different outcome.
 * `registration_invite_create` resolves an absent role itself:
 *
 *     if p_location_role_id is null then
 *       select * into v_location_role
 *         from public.roles
 *        where key = 'location_staff' and scope = 'location' and is_active
 *        limit 1;
 *       p_location_role_id := v_location_role.id;
 *
 * — the same role the preselect was already showing. What the option did cost
 * was «Основной администратор»: the field is enabled only while the chosen role
 * is `location_staff`, and with the empty value chosen the screen also stopped
 * sending `p_primary_admin_id`, although the server under that same branch
 * calls `_location_assert_admin_member` and would have accepted one. An option
 * that changes nothing, cannot be kept, and switches off a working field is not
 * a choice.
 *
 * What is left is this: hold a role the list still contains, and otherwise fall
 * to `location_staff`. Written as a rule rather than as an effect so that it
 * cannot go back to fighting a deliberate choice — the old effect listed the
 * value it was setting among its own dependencies.
 */
export function resolveLocationRoleId<T extends { id: string; key: string }>(
  current: string | null | undefined,
  roles: readonly T[],
): string {
  const held = (current ?? "").trim();
  if (held && roles.some((role) => role.id === held)) return held;
  const fallback = roles.find((role) => role.key === "location_staff") ?? roles[0] ?? null;
  return fallback?.id ?? "";
}
