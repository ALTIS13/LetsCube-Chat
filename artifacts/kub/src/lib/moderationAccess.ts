/**
 * Who may read the moderation queue, written to match the database exactly.
 *
 * `public.content_reports` is readable through one policy —
 * `is_manager_or_admin(auth.uid())` — and that function is, read off production
 * on 2026-09-14:
 *
 *     profiles.role in ('admin', 'manager')
 *     or has_global_role(uid, 'owner' | 'tech_admin' | 'admin' | 'manager')
 *
 * The client's own `isStaff` is **wider**: it also admits anybody holding one of
 * `STAFF_ACCESS_PERMISSIONS` — `users.view`, `chats.moderate`, the task grants —
 * which a location role can carry without any global role at all. Somebody like
 * that, shown this screen, would read zero rows for ever, and an empty queue and
 * a queue you may not read look exactly alike.
 *
 * So the tab is gated on this instead. Where the interface cannot show what a
 * screen is for, it should not offer the screen: that is the same rule as
 * «a failed read must not render as nothing» (D-140), one step earlier.
 *
 * **The same mismatch already applies to «Блокировки»**, which is mounted with
 * no gate at all while `bans` and `mutes` carry the same policy. That is not
 * changed here — taking an existing tab away from somebody who can see it today
 * is a decision about people rather than about a new screen — and it is recorded
 * in the register instead.
 *
 * On this deployment, measured the same day: 18 accounts, of which 5 satisfy the
 * database predicate; the global roles in use are `owner`×3, `tech_admin`×2 and
 * `user`×14, with no `manager` and no dynamic `admin`.
 */

/** The global role keys `public.is_manager_or_admin` accepts. */
export const MODERATION_QUEUE_ROLE_KEYS = [
  "owner",
  "tech_admin",
  "admin",
  "manager",
] as const;

/** The legacy `profiles.role` values it accepts. */
export const MODERATION_QUEUE_LEGACY_ROLES = ["admin", "manager"] as const;

export function canReadModerationQueue(input: {
  /** `profiles.role`, the legacy column, or null while it is unknown. */
  legacyRole: string | null | undefined;
  /** The caller's global role keys. */
  globalRoleKeys: Iterable<string> | null | undefined;
}): boolean {
  const legacy = (input.legacyRole ?? "").trim();
  if ((MODERATION_QUEUE_LEGACY_ROLES as readonly string[]).includes(legacy)) return true;
  for (const key of input.globalRoleKeys ?? []) {
    if ((MODERATION_QUEUE_ROLE_KEYS as readonly string[]).includes(key)) return true;
  }
  return false;
}
