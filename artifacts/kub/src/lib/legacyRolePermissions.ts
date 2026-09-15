/**
 * The client's offline copy of `public._legacy_role_has_permission`.
 *
 * It is consulted only on the fallback path — when the access snapshot RPC is
 * disabled, returns nothing, or throws — so a wrong entry here is invisible
 * until the day the RPC is unavailable, which is the day it matters most.
 *
 * It lived inline in `hooks/useRole.ts` until 2026-09-15 and could therefore not
 * be reached from a test at all: that module imports React, the store and
 * supabase-js. It had drifted by one key (F-8), and nothing could have caught
 * that. Same lesson as `lib/supabase/config.ts`: a decision that cannot be
 * reached from a test is a gap in the module boundary, not in the suite, and
 * moving the decision is cheaper than building a harness around it.
 *
 * The database function, read off production on 2026-09-15 (23 / 8 / 1 keys):
 *
 *     when p_role = 'admin' then p_permission_key in (
 *       'roles.view',
 *       'users.view', 'users.manage', 'users.assign_roles',
 *       'locations.view', 'locations.manage',
 *       'location_members.view', 'location_members.manage',
 *       'tasks.view', 'tasks.create', 'tasks.assign', 'tasks.manage',
 *       'tasks.view_admin_tasks', 'tasks.manage_admin_tasks',
 *       'tasks.view_all_locations', 'tasks.manage_all_locations',
 *       'chats.invite', 'chats.invite_any', 'chats.manage_invites',
 *       'chats.moderate', 'chats.manage_roles',
 *       'audit.view',
 *       'folders.manage_shared')
 *     when p_role = 'manager' then p_permission_key in (
 *       'users.view',
 *       'locations.view', 'location_members.view',
 *       'tasks.view', 'tasks.create', 'tasks.assign', 'tasks.manage',
 *       'chats.invite')
 *     else p_permission_key in ('chats.invite')
 *
 * The lists below are the same sets, sorted, so a future drift is one line of
 * diff rather than a reading exercise.
 */

/** Legacy `profiles.role = 'admin'`. 23 keys. */
export const LEGACY_ADMIN_PERMISSION_KEYS = [
  "audit.view",
  "chats.invite",
  "chats.invite_any",
  "chats.manage_invites",
  "chats.manage_roles",
  "chats.moderate",
  "folders.manage_shared",
  "location_members.manage",
  "location_members.view",
  "locations.manage",
  "locations.view",
  "roles.view",
  "tasks.assign",
  "tasks.create",
  "tasks.manage",
  "tasks.manage_admin_tasks",
  "tasks.manage_all_locations",
  "tasks.view",
  "tasks.view_admin_tasks",
  "tasks.view_all_locations",
  "users.assign_roles",
  "users.manage",
  "users.view",
] as const;

/** Legacy `profiles.role = 'manager'`. 8 keys. */
export const LEGACY_MANAGER_PERMISSION_KEYS = [
  "chats.invite",
  "location_members.view",
  "locations.view",
  "tasks.assign",
  "tasks.create",
  "tasks.manage",
  "tasks.view",
  "users.view",
] as const;

/** Every other legacy role, `user` included. 1 key. */
export const LEGACY_DEFAULT_PERMISSION_KEYS = ["chats.invite"] as const;

/**
 * The client's copy of `public._legacy_role_has_permission(p_role, p_permission_key)`.
 *
 * `null` is not a role and gets nothing — the database is called with a real
 * `app_role`, and the client reaches this only once it knows `profiles.role`.
 */
export function legacyRoleHasPermission(
  role: string | null | undefined,
  permissionKey: string,
): boolean {
  if (!role) return false;
  if (role === "admin") {
    return (LEGACY_ADMIN_PERMISSION_KEYS as readonly string[]).includes(permissionKey);
  }
  if (role === "manager") {
    return (LEGACY_MANAGER_PERMISSION_KEYS as readonly string[]).includes(permissionKey);
  }
  return (LEGACY_DEFAULT_PERMISSION_KEYS as readonly string[]).includes(permissionKey);
}
