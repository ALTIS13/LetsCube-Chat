/**
 * Which ban or mute is in force, and what lifting one means (D-134).
 *
 * «Снять блокировку» deleted **every** `bans` row for the person — expired ones
 * included — so lifting a week-old ban erased the record that it had ever
 * happened. The audit log keeps a trace (both tables carry insert and delete
 * triggers, checked on production on 2026-09-14), but «История санкций» in the
 * administration reads the rows, and that history is what an administrator
 * deciding a second sanction looks at.
 *
 * The predicate lives here because two places need it and they must not drift:
 * the query that decides whether a row shows «Снять блокировку» at all, and the
 * delete behind that item. If they disagreed, the button would appear for a
 * restriction the delete does not match, and pressing it would do nothing at
 * all while looking like it worked.
 */

export type SanctionKind = "ban" | "mute";

/**
 * The PostgREST `or=(…)` filter for restrictions that have not run out.
 *
 * A null `expires_at` is permanent, which is why it cannot be expressed as a
 * single comparison. The instant is an argument rather than `Date.now()` so a
 * test can state it, and so the read and the delete in one interaction can be
 * given the same one.
 */
export function activeSanctionFilter(now: Date): string {
  return `expires_at.is.null,expires_at.gt.${now.toISOString()}`;
}

/** Whether one row is a restriction in force at `now`. */
export function isSanctionActive(
  sanction: { expires_at?: string | null },
  now: Date,
): boolean {
  const expires = sanction.expires_at;
  if (expires === null || expires === undefined) return true;
  const at = Date.parse(expires);
  return Number.isFinite(at) ? at > now.getTime() : true;
}

export interface SanctionLiftPrompt {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

/**
 * What to ask before lifting one.
 *
 * It says what is ended and what is kept, because the thing an administrator
 * cannot see from the menu is which of those two this does. «Отменить» is not
 * offered as the confirm label anywhere in this product — the confirming button
 * names the action.
 */
export function sanctionLiftPrompt(
  kind: SanctionKind,
  personName: string,
): SanctionLiftPrompt {
  const name = personName.trim() || "этого пользователя";
  return kind === "ban"
    ? {
      title: "Снять блокировку?",
      description:
        `Действующая блокировка для ${name} будет снята сразу. ` +
        "Истёкшие блокировки останутся в истории санкций.",
      confirmLabel: "Снять блокировку",
      cancelLabel: "Отмена",
    }
    : {
      title: "Снять мьют?",
      description:
        `Действующий мьют для ${name} будет снят сразу. ` +
        "Истёкшие мьюты останутся в истории санкций.",
      confirmLabel: "Снять мьют",
      cancelLabel: "Отмена",
    };
}

/** Where a sanction notice in the notification centre leads, if anywhere. */
export type SanctionNoticeTarget = { readonly kind: "chat"; readonly chatId: string } | null;

/**
 * What opens when somebody presses their own ban or mute notice (D-139).
 *
 * `ban_issued` used to open `/admin`, which nobody who receives one can reach:
 * `AdminLayout` redirects anybody who is neither staff nor a support operator
 * straight back to `/`, so the press bounced. And it is not a near miss for a
 * staff member either — measured on production on 2026-09-15,
 * `public._notify_bans_after_insert` posts the notice to `new.user_id` and to
 * nobody else, so its only recipient is ever the banned person. Two such rows
 * exist today.
 *
 * The server had already decided this. Its own push payload builds a `url` for
 * `chat_added`, `mute_issued`, the task kinds — and for `ban_issued` leaves it
 * null, because «Вы заблокированы» is the whole message and there is nothing to
 * open. The client invented a destination the server never claimed.
 *
 * A mute is different and keeps its behaviour: it is issued in a chat, and that
 * chat is where the person finds out what it means. Without a `chat_id` in the
 * payload it too leads nowhere rather than somewhere arbitrary.
 */
export function sanctionNoticeTarget(
  kind: string,
  chatId: string | null | undefined,
): SanctionNoticeTarget {
  if (kind === "mute_issued") {
    const chat = (chatId ?? "").trim();
    return chat ? { kind: "chat", chatId: chat } : null;
  }
  return null;
}

/** The three answers a sanction control can have about its own outcome. */
export type SanctionVerdict = "allowed" | "refused" | "unknown";

/**
 * The fields this module reads off a `roles` row. `DynamicRole` satisfies it
 * structurally.
 */
export interface GlobalRoleRank {
  readonly key: string;
  readonly scope: string;
  readonly is_active: boolean;
  readonly priority: number;
}

/** The keys `has_global_role` will match against the legacy column. */
const LEGACY_COLUMN_ROLE_KEYS: readonly string[] = ["admin", "manager", "user"];

/**
 * `public.effective_global_role_priority(uuid)`, mirrored on the client.
 *
 * Read off production on 2026-09-19:
 *
 *     select coalesce(max(r.priority), 0)
 *       from public.roles r
 *      where r.scope = 'global' and r.is_active
 *        and public.has_global_role(p_user_id, r.key)
 *
 * and `has_global_role(u, k)` is «an active global assignment with key `k`, or
 * the legacy `profiles.role` column spelling `k`» — the column only for the
 * three values it can hold. Both halves carry weight here: two accounts on this
 * deployment are `admin` by the column with no assignment at all, and every
 * account is `user` by the column, which is why the floor a person can measure
 * is the `user` role's priority and not 0.
 *
 * Null when no active global role is supplied: an empty role table means «not
 * loaded», never «this person holds nothing». A manager reads exactly one row
 * of `public.roles` (their own) and cannot use this at all — see
 * `sanctionMatrixVerdict`.
 */
export function effectiveGlobalRolePriority(input: {
  legacyRole: string | null | undefined;
  assignedRoleKeys: Iterable<string> | null | undefined;
  globalRoles: readonly GlobalRoleRank[];
}): number | null {
  const active = input.globalRoles.filter(
    (role) => role.scope === "global" && role.is_active,
  );
  if (active.length === 0) return null;

  const assigned = new Set(input.assignedRoleKeys ?? []);
  const legacy = (input.legacyRole ?? "").trim();
  let best = 0;
  for (const role of active) {
    const holds =
      assigned.has(role.key) ||
      (legacy === role.key && LEGACY_COLUMN_ROLE_KEYS.includes(legacy));
    if (holds && role.priority > best) best = role.priority;
  }
  return best;
}

export interface SanctionMatrixInput {
  /** The target is the caller. The trigger refuses that before ranking anybody. */
  readonly isSelf: boolean;
  /**
   * `public.is_manager_or_admin(auth.uid())`, mirrored on the client — the RLS
   * gate the write has to pass before the trigger ever runs. Use
   * `matchesIsManagerOrAdmin` from `lib/serverRoleAccess.ts`: it reads the
   * caller's own legacy column and own global role keys, both of which a person
   * may always read about themselves.
   *
   * `null` while that check has not finished. Not the same as `false`, which is
   * a refusal: «we have not asked» and «the database says no» look alike on
   * screen and must not look alike here (D-198).
   */
  readonly callerIsServerStaff: boolean | null;
  /** `effective_global_role_priority(auth.uid())`, or null while unknown. */
  readonly callerPriority: number | null;
  /** `effective_global_role_priority(target)`, or null while unknown. */
  readonly targetPriority: number | null;
  /** `roles.priority` of the active global `admin` role, or null while unknown. */
  readonly adminPriority: number | null;
  /** `roles.priority` of the active global `manager` role, or null while unknown. */
  readonly managerPriority: number | null;
}

/**
 * Whether the database will accept a sanction, refuse it, or whether the client
 * cannot yet tell.
 *
 * `public.enforce_sanction_matrix()` guards `bans` and `mutes` on BEFORE INSERT
 * **and** BEFORE DELETE — four triggers, read off production on 2026-09-19.
 * Since D-197 it ranks both sides through `public.roles.priority` instead of
 * the legacy `profiles.role` column:
 *
 *     target = caller              -> refuse, before any rank is read
 *     caller_rank >= admin_rank    -> allow, whoever the target is
 *     caller_rank >= manager_rank  -> refuse iff target_rank >= admin_rank
 *     otherwise                    -> refuse
 *
 * Both comparisons are non-strict, and **neither compares the caller with the
 * target**: the manager branch asks only whether the target reaches the admin
 * threshold, so two managers may sanction each other. Live priorities that day:
 * owner 100, tech_admin 100, admin 80, manager 60, user 10.
 *
 * `UsersTab` used to ask `isAdmin || target.role !== "admin"`, which reads the
 * one column the database stopped ranking by. Three accounts carry
 * `profiles.role = 'user'` and rank 100, so a manager would have been offered
 * «Заблокировать…» for each of them and told «Менеджер не может применять
 * санкции к администратору» only after filling in the form (D-200).
 *
 * **Why every input is nullable.** Measured on production the same day from a
 * signed-in non-staff session: `public.roles` returns one row and
 * `user_global_roles` returns one row — both policies are scoped to the roles
 * you hold, and neither `roles.view` nor `users.assign_roles` belongs to
 * `manager`. So a manager can compute neither rank nor either threshold from
 * the tables. `public.effective_global_role_priority(uuid)` is SECURITY
 * DEFINER with EXECUTE granted to `authenticated`, and that same session read
 * 100 through it for a staff target, so the **ranks** are always obtainable and
 * the **thresholds** are not. `unknown` is the answer for the gap, and a
 * control must not be offered on it.
 */
export function sanctionMatrixVerdict(input: SanctionMatrixInput): SanctionVerdict {
  if (input.isSelf) return "refused";
  // RLS runs first: `managers insert bans` / `managers delete bans` and their
  // `mutes` twins all ask `is_manager_or_admin(auth.uid())`, and the row never
  // reaches the trigger without it.
  if (input.callerIsServerStaff === null) return "unknown";
  if (!input.callerIsServerStaff) return "refused";

  const { callerPriority, targetPriority, adminPriority, managerPriority } = input;
  if (callerPriority === null) return "unknown";

  if (adminPriority === null) {
    // No threshold, so only what the trigger's own branches guarantee whichever
    // one the caller is in. A target who does not outrank the caller is below
    // the admin threshold whenever the caller is below it, and irrelevant when
    // the caller is at or above it. Anybody ranking higher could be on either
    // side of a threshold this client cannot read.
    if (targetPriority === null) return "unknown";
    return targetPriority <= callerPriority ? "allowed" : "unknown";
  }

  if (callerPriority >= adminPriority) return "allowed";
  if (managerPriority !== null && callerPriority < managerPriority) return "refused";
  if (targetPriority === null) return "unknown";
  return targetPriority >= adminPriority ? "refused" : "allowed";
}
