/**
 * Who may confirm, reject, assign, cancel and edit a task — one copy per RPC of
 * the gate that RPC actually applies.
 *
 * `public.tasks` carries `tasks insert/update/delete blocked` (`with check
 * false` / `using false`), so **no** write reaches this table through RLS. Every
 * state change is a SECURITY DEFINER function, and those functions are the only
 * authority there is. The five gates below were read off production on
 * 2026-09-15 with `pg_get_functiondef`:
 *
 *     task_confirm / task_reject
 *         if not public.is_manager_or_admin(caller) then raise …
 *         if cur.status <> 'waiting_confirmation' then raise …
 *         if cur.assignee_id = caller then raise …   -- «собственную задачу»
 *
 *     task_assign
 *         if not public.is_manager_or_admin(caller) then raise …
 *         if cur.status not in ('new', 'assigned') then raise …
 *
 *     task_cancel
 *         if not (cur.created_by = caller
 *                 or public.is_manager_or_admin(caller)) then raise …
 *         if cur.status in ('confirmed','rejected','cancelled') then raise …
 *
 *     task_update_v3
 *         if v_task.status in ('confirmed', 'cancelled') then raise 'task_locked'
 *         if v_caller <> v_task.created_by
 *            and not public.is_manager_or_admin(v_caller)
 *            and not (
 *              coalesce(p_location_id, v_task.location_id) is not null
 *              and public.is_location_admin(
 *                    coalesce(p_location_id, v_task.location_id), v_caller)
 *            ) then raise 'forbidden'
 *
 * **The register's proposed fix for D-124 was wrong, and measuring it is the
 * whole point of this module.** D-124 asked for confirm/reject/assign/cancel to
 * be gated on `has_location_permission(task.location_id, 'tasks.manage')`,
 * «the grants the server functions check». The server functions check no such
 * thing: three of them ask `is_manager_or_admin`, which knows global roles and
 * the legacy `profiles.role` column and nothing whatever about locations.
 * Proved on production inside a rolled-back transaction, impersonating the one
 * account that holds `location_admin` on two locations with no global role:
 *
 *     loc_perm(tasks.manage)=true  is_manager_or_admin=false
 *     task_confirm : REFUSED -> Подтверждать может только администратор или менеджер
 *     task_assign  : REFUSED -> Только администратор или менеджер может назначать задачи
 *     task_cancel  : SUCCEEDED (creator branch)
 *     control, an account the server does call staff:
 *     task_confirm : SUCCEEDED
 *
 * So widening those three to location grants would have drawn three buttons the
 * database refuses — D-202's defect pointing the other way. What the same
 * measurement did find is two gates the client draws **too narrow**:
 *
 *   - cancel forgot `created_by = caller`, so the person who created a task is
 *     not offered «Отменить задачу» on it unless they are also staff, while the
 *     RPC accepts them. `canEdit` already had the creator branch; cancel did
 *     not.
 *   - edit forgot the location branch, so a location administrator is refused
 *     «Редактировать» on a task at their own location unless they created it,
 *     while `task_update_v3` accepts them.
 *
 * **Why the staff input is a boolean rather than a role.** The predicate that
 * answers `public.is_manager_or_admin` already exists once, in
 * `lib/serverRoleAccess.ts`, and re-deriving it here would be the fourth
 * spelling that D-202 was closed to stop. `isLocationAdmin` is likewise not
 * derived here: `public.is_location_admin` ORs a global permission, a location
 * permission **and** the legacy `location_members.role` text column, and on
 * this deployment the account holding `location_manager` satisfies it through
 * the legacy branch alone — `location_members.manage` and `tasks.manage` both
 * measure false for them while `is_location_admin` measures true. A client copy
 * built on permissions would therefore be narrower than the database. So the
 * caller asks the database for that one and passes the answer in; see
 * `hooks/useLocationAdmin.ts`.
 *
 * Deliberately not mirrored: `is_banned(caller)`, which every one of these RPCs
 * checks first. A banned person is stopped by the overlay long before a task
 * modal, and `hooks/useBanState.ts` owns that decision (D-198).
 */

/** `public.task_status`, the values these gates branch on. */
export type TaskActionStatus =
  | "new"
  | "assigned"
  | "accepted"
  | "in_progress"
  | "waiting_confirmation"
  | "confirmed"
  | "rejected"
  | "cancelled";

export interface TaskActionActor {
  /**
   * `public.is_manager_or_admin(auth.uid())`. Ask
   * `matchesIsManagerOrAdmin` from `lib/serverRoleAccess.ts` for this — not the
   * client's own `isStaff`, which is wider than the database function.
   */
  isManagerOrAdmin: boolean;
  /** `auth.uid() = tasks.created_by`. */
  isCreator: boolean;
  /** `auth.uid() = tasks.assignee_id`. */
  isAssignee: boolean;
  /**
   * `public.is_location_admin(tasks.location_id, auth.uid())`, and `false`
   * when the task has no location — which is how `task_update_v3` reads it,
   * since its branch requires the location to be non-null first.
   */
  isLocationAdmin: boolean;
}

/** `task_confirm`: staff only, on a task waiting for confirmation that is not their own. */
export function canConfirmTask(actor: TaskActionActor, status: TaskActionStatus): boolean {
  return actor.isManagerOrAdmin && status === "waiting_confirmation" && !actor.isAssignee;
}

/** `task_reject`: the same gate as confirm, byte for byte. */
export function canRejectTask(actor: TaskActionActor, status: TaskActionStatus): boolean {
  return canConfirmTask(actor, status);
}

/** `task_assign`: staff only, while the task has not been picked up. */
export function canAssignTask(actor: TaskActionActor, status: TaskActionStatus): boolean {
  return actor.isManagerOrAdmin && (status === "new" || status === "assigned");
}

const CANCEL_LOCKED_STATUSES: readonly TaskActionStatus[] = ["confirmed", "rejected", "cancelled"];

/** `task_cancel`: the creator **or** staff, until the task reaches a final status. */
export function canCancelTask(actor: TaskActionActor, status: TaskActionStatus): boolean {
  if (CANCEL_LOCKED_STATUSES.includes(status)) return false;
  return actor.isCreator || actor.isManagerOrAdmin;
}

const EDIT_LOCKED_STATUSES: readonly TaskActionStatus[] = ["confirmed", "cancelled"];

/**
 * `task_update_v3`: the creator, staff, or an administrator of the task's own
 * location. `rejected` is editable here and not cancellable above — the two
 * RPCs really do lock on different sets.
 */
export function canEditTask(actor: TaskActionActor, status: TaskActionStatus): boolean {
  if (EDIT_LOCKED_STATUSES.includes(status)) return false;
  return actor.isCreator || actor.isManagerOrAdmin || actor.isLocationAdmin;
}
