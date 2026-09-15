/**
 * Who may read the moderation queue.
 *
 * `public.content_reports` is readable through one policy —
 * `is_manager_or_admin(auth.uid())` — so this is not its own rule at all: it is
 * one *use* of that database function, and the copy of it lives in
 * `lib/serverRoleAccess.ts` together with the production function body and the
 * measured population. This file only says which database predicate the queue
 * is gated on, so a reader of `AdminLayout` finds the reason here.
 *
 * The reason the queue is not gated on the client's own `isStaff`: that
 * predicate also admits anybody holding one of `STAFF_ACCESS_PERMISSIONS`,
 * which a location role can carry without any global role. Somebody like that,
 * shown this screen, would read zero rows for ever, and an empty queue and a
 * queue you may not read look exactly alike. Where the interface cannot show
 * what a screen is for, it should not offer the screen: that is the same rule
 * as «a failed read must not render as nothing» (D-140), one step earlier.
 *
 * **The same mismatch already applies to «Блокировки»**, which is mounted with
 * no gate at all while `bans` and `mutes` carry the same policy. That is not
 * changed here — taking an existing tab away from somebody who can see it today
 * is a decision about people rather than about a new screen — and it is recorded
 * in the register instead.
 */

import {
  matchesIsManagerOrAdmin,
  SERVER_MANAGER_OR_ADMIN_LEGACY_ROLES,
  SERVER_MANAGER_OR_ADMIN_ROLE_KEYS,
  type ServerRoleInput,
} from "./serverRoleAccess.ts";

/** The global role keys `public.is_manager_or_admin` accepts. */
export const MODERATION_QUEUE_ROLE_KEYS = SERVER_MANAGER_OR_ADMIN_ROLE_KEYS;

/** The legacy `profiles.role` values it accepts. */
export const MODERATION_QUEUE_LEGACY_ROLES = SERVER_MANAGER_OR_ADMIN_LEGACY_ROLES;

export function canReadModerationQueue(input: ServerRoleInput): boolean {
  return matchesIsManagerOrAdmin(input);
}
