/**
 * The order, the rank and the colour of a role — and nothing about its power.
 *
 * The roles panel used to render `roles` in the order the query returned them,
 * which is scope, then `is_system`, then name. That puts «Администратор» above
 * «Владелец» and tells the reader nothing about who outranks whom. The owner
 * asked for the shape a Discord user expects: a ladder from the founder down to
 * an ordinary account, sorted by importance, with a colour per role.
 *
 * `roles.priority` and `roles.colour` (migration 20260904080000) carry that.
 * This module is the whole of the logic that reads them, kept free of React and
 * of the `@/` alias so `node --test` can execute it directly.
 *
 * READ THIS BEFORE USING ANY OF IT: priority is presentation. Neither
 * `has_permission` nor `has_location_permission` reads the column — access is
 * decided by the owner/tech_admin short-circuit, then by `role_permissions`,
 * then by the legacy `profiles.role` fallback, and by nothing else. Moving a
 * role to the top of this list grants it exactly nothing. A visible hierarchy
 * invites the opposite conclusion, so the panel says so in words and this file
 * says so here.
 *
 * Ties are deliberate, not a rounding error. `owner` and `tech_admin` both sit
 * at 100 because their equality is a product decision (see migration
 * 20260904070000), so every function here treats equal priorities as one rank
 * shared by several roles rather than as an ordering accident to be broken.
 */

/** The scopes, in the order a reader should meet them. */
export const ROLE_SCOPE_ORDER = ["global", "location", "chat"] as const;

/**
 * The writable range. The seeded ladder spans 10..100 with gaps of 10-20, so
 * these bounds are far outside anything in use; they exist to stop a stray
 * keystroke from writing 2^31 and to give the move buttons a place to stop.
 */
export const ROLE_PRIORITY_MIN = 0;
export const ROLE_PRIORITY_MAX = 1000;

/** `roles_colour_format_check`, restated for the client. */
const COLOUR_PATTERN = /^[0-9a-f]{6}$/;
const SHORT_COLOUR_PATTERN = /^[0-9a-f]{3}$/;

/** The fields this module reads. `DynamicRole` satisfies it structurally. */
export interface RoleRankFields {
  id: string;
  key: string;
  name: string;
  scope: string;
  priority: number;
}

export interface RoleHierarchyEntry<T extends RoleRankFields> {
  role: T;
  /** 1-based position of this role's rank within its scope. Tied roles share it. */
  rank: number;
  /** Another role in the same scope holds the same priority. */
  sharesRank: boolean;
}

export interface RoleHierarchyGroup<T extends RoleRankFields> {
  /** Narrower than `string` when the caller's role type narrows it. */
  scope: T["scope"];
  entries: RoleHierarchyEntry<T>[];
}

export type PriorityMoveDirection = "up" | "down";

function scopeIndex(scope: string): number {
  const index = (ROLE_SCOPE_ORDER as readonly string[]).indexOf(scope);
  // A scope this build has never heard of sorts last rather than disappearing.
  return index === -1 ? ROLE_SCOPE_ORDER.length : index;
}

/**
 * Within one scope: higher priority first, then name, then key.
 *
 * The name is the tiebreaker because it is what the reader sees; the key only
 * decides between two roles named identically, and exists so the order is
 * total and therefore stable across renders.
 */
export function compareRolesByHierarchy(a: RoleRankFields, b: RoleRankFields): number {
  const byScope = scopeIndex(a.scope) - scopeIndex(b.scope);
  if (byScope !== 0) return byScope;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const byName = a.name.localeCompare(b.name, "ru-RU");
  if (byName !== 0) return byName;
  return a.key.localeCompare(b.key, "ru-RU");
}

export function sortRolesByHierarchy<T extends RoleRankFields>(roles: readonly T[]): T[] {
  return [...roles].sort(compareRolesByHierarchy);
}

/** The distinct priorities present in one scope, highest first. */
export function rankLevels(roles: readonly RoleRankFields[], scope: string): number[] {
  const levels = new Set<number>();
  for (const role of roles) {
    if (role.scope === scope) levels.add(role.priority);
  }
  return [...levels].sort((a, b) => b - a);
}

/**
 * The list the panel renders: one group per scope, each already ordered, with
 * every role told which rank it occupies and whether it shares that rank.
 */
export function buildRoleHierarchy<T extends RoleRankFields>(roles: readonly T[]): RoleHierarchyGroup<T>[] {
  const groups: RoleHierarchyGroup<T>[] = [];
  const levelsByScope = new Map<string, number[]>();

  for (const role of sortRolesByHierarchy(roles)) {
    let group = groups.find((candidate) => candidate.scope === role.scope);
    if (!group) {
      group = { scope: role.scope, entries: [] };
      groups.push(group);
      levelsByScope.set(role.scope, rankLevels(roles, role.scope));
    }
    const levels = levelsByScope.get(role.scope) ?? [];
    group.entries.push({
      role,
      rank: levels.indexOf(role.priority) + 1,
      sharesRank: roles.some(
        (peer) => peer.id !== role.id && peer.scope === role.scope && peer.priority === role.priority,
      ),
    });
  }
  return groups;
}

export function clampRolePriority(value: number): number {
  if (!Number.isFinite(value)) return ROLE_PRIORITY_MIN;
  return Math.min(ROLE_PRIORITY_MAX, Math.max(ROLE_PRIORITY_MIN, Math.trunc(value)));
}

/**
 * A rank typed into the number field. `null` means "not a rank" — an empty box
 * or a word — and the caller must refuse to save rather than guess a value.
 */
export function parseRolePriorityInput(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  if (!Number.isFinite(value)) return null;
  return clampRolePriority(value);
}

/**
 * Where a role lands when someone presses ↑ or ↓, or `null` when it cannot move.
 *
 * The unit of movement is a *rank*, not a row, because a tie is one rank held
 * by several roles. Moving `admin` up past a shared rank of 100 puts it above
 * both `owner` and `tech_admin`: landing between two roles whose equality is
 * the point would silently deny that equality.
 *
 * The result is always a single write. Renumbering the scope would be tidier
 * arithmetic and N round trips through `role_update`, each one able to fail on
 * its own and leave the ladder half-applied.
 *
 * `null` is what disables the button, so the control and the action are decided
 * by the same function and cannot disagree.
 */
export function planPriorityMove(
  roles: readonly RoleRankFields[],
  roleId: string,
  direction: PriorityMoveDirection,
): number | null {
  const role = roles.find((candidate) => candidate.id === roleId);
  if (!role) return null;

  const levels = rankLevels(roles, role.scope);
  const index = levels.indexOf(role.priority);
  if (index === -1) return null;

  const shared = roles.some(
    (peer) => peer.id !== role.id && peer.scope === role.scope && peer.priority === role.priority,
  );

  let target: number;
  if (direction === "up") {
    // At the top: the only move left is out of a tie. Alone up there, none.
    if (index === 0) {
      if (!shared) return null;
      target = role.priority + 1;
    } else {
      // One past the rank above. If that rank happens to sit one below the next
      // one up, this lands on a tie with it instead of between them — still a
      // move up, and the honest outcome when there is no room in between.
      target = levels[index - 1] + 1;
    }
  } else {
    if (index === levels.length - 1) {
      if (!shared) return null;
      target = role.priority - 1;
    } else {
      target = levels[index + 1] - 1;
    }
  }

  const clamped = clampRolePriority(target);
  return clamped === role.priority ? null : clamped;
}

/**
 * A hex colour the panel may put in a `style` attribute, or `null`.
 *
 * The database constraint is the real guarantee, but the value reaches a style
 * attribute before any round trip, so it is validated here too — an unvalidated
 * string interpolated into a style is the whole of the vulnerability. Anything
 * that is not six hex digits comes back `null` and the caller draws a neutral.
 *
 * Kindnesses that stay inside the constraint: a missing `#`, upper case, and
 * the three-digit shorthand a person types by hand, which Postgres would
 * otherwise reject outright.
 */
export function normalizeRoleColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^#/, "").toLowerCase();
  if (SHORT_COLOUR_PATTERN.test(text)) {
    return `#${text.split("").map((channel) => channel + channel).join("")}`;
  }
  if (COLOUR_PATTERN.test(text)) return `#${text}`;
  return null;
}

export function isValidRoleColour(value: unknown): boolean {
  return normalizeRoleColour(value) !== null;
}

/** The swatch colour for a role, or `null` when it has none and gets a neutral. */
export function roleSwatchColour(role: { colour?: string | null }): string | null {
  return normalizeRoleColour(role.colour);
}

/**
 * Everything the role form shows, as one string.
 *
 * The form used to be refilled from the database on every change to any role or
 * any role's permissions, because the effect watched two whole arrays. A
 * realtime event about an unrelated role therefore threw away whatever the
 * administrator was in the middle of typing. Comparing this signature instead
 * refills the form only when the selected role's own data actually changed —
 * after a save, or when somebody else edited this very role.
 *
 * Permission keys are sorted, so the same set arriving in a different row order
 * is not mistaken for a change. The fields are JSON-encoded rather than joined
 * on a separator, so a name that ends where a description begins cannot forge a
 * match against a different pair of values.
 */
export function roleFormSignature(
  role: {
    id: string;
    name: string;
    description?: string | null;
    is_active: boolean;
    priority: number;
    colour?: string | null;
  },
  permissionKeys: readonly string[],
): string {
  return JSON.stringify([
    role.id,
    role.name,
    role.description ?? "",
    role.is_active,
    role.priority,
    role.colour ?? "",
    [...permissionKeys].sort(),
  ]);
}
