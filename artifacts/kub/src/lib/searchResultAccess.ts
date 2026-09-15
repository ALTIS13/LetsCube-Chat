/**
 * Which search results lead somewhere this person can actually go (D-139).
 *
 * Global search returns a location to anybody the database lets read one, and
 * `public.locations` is readable well beyond the administration — measured on
 * production on 2026-09-15:
 *
 *     policy «locations select scoped» (SELECT):
 *       is_admin(auth.uid())
 *       or exists (select 1 from location_members lm
 *                   where lm.location_id = locations.id
 *                     and lm.user_id = auth.uid())
 *
 * So every member of a location finds their own location by name. Pressing it
 * then ran into one of two dead ends, and the register had only spotted the
 * first:
 *
 *   - somebody who is not staff got an alert, «Локация недоступна для вашего
 *     профиля», for a row the product had just offered them;
 *   - **and a manager got worse.** The gate in `SearchShared` was `isStaff`,
 *     but `/admin/locations` is mounted behind `isAdmin`
 *     (`AdminLayout.tsx`, the `adminOnly` tab flag and the route's own
 *     `{isAdmin ? <LocationsTab /> : <Redirect to="/admin" />}`). A manager is
 *     `isStaff` and not `isAdmin`, so the press navigated, redirected to the
 *     dashboard and said nothing at all.
 *
 * The rule here is therefore the route's gate rather than a neighbouring idea
 * of «staff» — the same lesson `lib/serverRoleAccess.ts` records for the RLS
 * predicates, one layer up: **where a control's destination is decided by a
 * route guard, the client predicate must be a copy of that guard.**
 *
 * The location's own page for the people who administer one is D-123, still
 * open and measured to have nothing to call. Until it exists, the honest answer
 * is not to offer a row that leads nowhere.
 *
 * No React and no client here, so `node --test` reads every branch.
 */

/** The access facts `AdminLayout` decides with, as `useRoleAccess()` returns them. */
export interface AdminRouteAccess {
  /** `useRoleAccess().isStaff` — the wide client predicate. */
  readonly isStaff: boolean;
  /** `useRoleAccess().isAdmin` — implies `isStaff`. */
  readonly isAdmin: boolean;
  /** `usePermissionAccess(["support.view"]).hasPermission("support.view")`. */
  readonly canViewSupport?: boolean;
  /** True while the roles are still being read; nothing is claimed until then. */
  readonly checking?: boolean;
}

/**
 * Whether `AdminLayout` would render this path rather than redirect.
 *
 * A copy of its two gates: the shell refuses anybody who is neither staff nor a
 * support operator, and each `adminOnly` route refuses anybody who is not
 * `isAdmin`. Only the paths a destination outside the administration points at
 * are listed; the rest are the administration's own business.
 */
export function canOpenAdminPath(path: string, access: AdminRouteAccess): boolean {
  if (access.checking) return false;
  const reachesShell = access.isStaff || access.canViewSupport === true;
  if (!reachesShell) return false;
  if (path === "/admin") return true;
  if (path === "/admin/support") return access.canViewSupport === true;
  // «Локации», «Инвайты», «Роли и права», «Операции», «Журнал».
  return access.isAdmin;
}

/** The path a location result opens. */
export const LOCATION_RESULT_PATH = "/admin/locations";

/** Whether a location found in search leads anywhere for this person. */
export function canOpenLocationResult(access: AdminRouteAccess): boolean {
  return canOpenAdminPath(LOCATION_RESULT_PATH, access);
}

/** The least a result has to carry for this module to decide about it. */
export interface OpenableResult {
  readonly resultType: string;
}

/**
 * The results worth drawing.
 *
 * Applied where the list is assembled rather than only where a row is pressed,
 * because a row that cannot be opened should not be on the screen taking up a
 * place and a keyboard stop. `activateResult` keeps its own check as the second
 * half of the same rule: a list built before the role read finished would
 * otherwise be actionable for a frame.
 */
export function openableSearchResults<T extends OpenableResult>(
  results: readonly T[],
  access: AdminRouteAccess,
): T[] {
  if (canOpenLocationResult(access)) return results.slice();
  return results.filter((result) => result.resultType !== "location");
}
