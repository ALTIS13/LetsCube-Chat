/**
 * The two role predicates the database actually gates on, written to match it
 * exactly — and deliberately narrower than the client's own `isStaff`.
 *
 * Read off production on 2026-09-15:
 *
 *     public.is_manager_or_admin(uid) =
 *         uid is not null and (
 *           exists (select 1 from profiles p
 *                    where p.id = uid and p.role in ('admin', 'manager'))
 *           or has_global_role(uid, 'owner')
 *           or has_global_role(uid, 'tech_admin')
 *           or has_global_role(uid, 'admin')
 *           or has_global_role(uid, 'manager'))
 *
 *     public.is_admin(uid) =
 *         uid is not null and (
 *           exists (select 1 from profiles p
 *                    where p.id = uid and p.role = 'admin')
 *           or has_global_role(uid, 'owner')
 *           or has_global_role(uid, 'tech_admin')
 *           or has_global_role(uid, 'admin'))
 *
 * **Why this is not `useRoleAccess().isStaff`.** That predicate is *wider*: it
 * also admits anybody holding one of `STAFF_ACCESS_PERMISSIONS` — `users.view`,
 * `chats.moderate`, the task grants — which a **location** role can carry with
 * no global role at all. Neither database function knows anything about
 * permissions. So an interface gated on `isStaff` offers controls the database
 * then refuses; an interface gated on the legacy `profiles.role` column alone
 * hides controls the database would allow. Both mistakes have been made here,
 * on the same screen, pointing in opposite directions (D-202 / F-5).
 *
 * The rule, learned twice: where a screen's controls are decided by an RLS
 * policy, the client predicate must be a copy of *that* policy's function, not
 * of a neighbouring idea of «staff».
 *
 * Measured on this deployment the same day, over all 18 profiles:
 *
 *     legacy column | is_manager_or_admin | is_admin | people
 *     f             | f                   | f        | 13
 *     f             | t                   | t        |  3   <-- the gap
 *     t             | t                   | t        |  2
 *
 * The three in the gap hold `owner` / `tech_admin` globally and carry
 * `profiles.role = 'user'`.
 */

/** The global role keys `public.is_manager_or_admin` accepts. */
export const SERVER_MANAGER_OR_ADMIN_ROLE_KEYS = [
  "owner",
  "tech_admin",
  "admin",
  "manager",
] as const;

/** The legacy `profiles.role` values `public.is_manager_or_admin` accepts. */
export const SERVER_MANAGER_OR_ADMIN_LEGACY_ROLES = ["admin", "manager"] as const;

/** The global role keys `public.is_admin` accepts — `manager` is not one of them. */
export const SERVER_ADMIN_ROLE_KEYS = ["owner", "tech_admin", "admin"] as const;

/** The legacy `profiles.role` values `public.is_admin` accepts. */
export const SERVER_ADMIN_LEGACY_ROLES = ["admin"] as const;

export interface ServerRoleInput {
  /** `profiles.role`, the legacy column, or null while it is unknown. */
  legacyRole: string | null | undefined;
  /** The caller's global role keys. Permission keys do not belong here. */
  globalRoleKeys: Iterable<string> | null | undefined;
}

function matches(
  input: ServerRoleInput,
  legacyRoles: readonly string[],
  roleKeys: readonly string[],
): boolean {
  const legacy = (input.legacyRole ?? "").trim();
  if (legacy && legacyRoles.includes(legacy)) return true;
  for (const key of input.globalRoleKeys ?? []) {
    if (roleKeys.includes(key)) return true;
  }
  return false;
}

/** True for exactly the people `public.is_manager_or_admin(auth.uid())` admits. */
export function matchesIsManagerOrAdmin(input: ServerRoleInput): boolean {
  return matches(
    input,
    SERVER_MANAGER_OR_ADMIN_LEGACY_ROLES,
    SERVER_MANAGER_OR_ADMIN_ROLE_KEYS,
  );
}

/** True for exactly the people `public.is_admin(auth.uid())` admits. */
export function matchesIsAdmin(input: ServerRoleInput): boolean {
  return matches(input, SERVER_ADMIN_LEGACY_ROLES, SERVER_ADMIN_ROLE_KEYS);
}
