/**
 * A tag a group defines for itself (D-215).
 *
 * Three levels of standing existed before this — `chat_members.role` is the
 * enum `owner | admin | member`, the same three words in every group — and
 * nothing could say «Основатель», «Наставник» or «Дежурный» in one group and
 * mean nothing in the next. `public.chat_roles` and `public.chat_member_roles`
 * were applied to production on 2026-09-18; this module is the client's copy of
 * the rules they enforce, so the interface refuses what the database refuses
 * instead of drawing a control that answers 403.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 *
 * ## The two gates, and why they are different
 *
 * Read off the applied migration rather than reasoned from the design:
 *
 *     "owners manage chat roles"        for all  using (is_chat_owner(chat_id))
 *     "admins assign chat member roles" for all  using (is_chat_admin(chat_id))
 *
 * Inventing, renaming, recolouring or deleting a group's vocabulary is the
 * owner's; handing an existing tag to somebody is an administrator's, which is
 * the same power `chat_members insert` and `chat_members update` already give
 * them. The split is copied from `enforce_chat_member_update`, which lets an
 * administrator promote a member and refuses them the owner.
 *
 * ## What the database refuses that a screen has to refuse first
 *
 * - **A private chat has no roles at all.** `private.enforce_chat_role_scope`
 *   raises `chat_role_private_chat`. This is not tidiness: 24 of this
 *   deployment's 27 private conversations carry an `owner` row from the
 *   2026-09-11 artefact, so `is_chat_owner` is true for one side of most of
 *   them, and without the trigger that side could invent a tag and pin it on
 *   the other person.
 * - **Twenty-five roles in a group, five tags on a person**, both AFTER INSERT
 *   triggers so a multi-row insert cannot walk past them.
 * - **One name per group, folded and trimmed** — `chat_roles_chat_name_idx` is
 *   unique on `(chat_id, lower(btrim(name)))`, so «Наставник» and «наставник »
 *   are the same name.
 * - **1 to 32 characters** after trimming, and **a palette key** rather than a
 *   hex colour: D-214 measured the global catalogue's free hex values at
 *   1.50–2.06 against a 3:1 floor in the light theme, and a free hex column
 *   here would repeat that once per group with nobody to audit it.
 */

/** A chat role as the table holds one. */
export interface ChatRoleRow {
  id: string;
  chat_id: string;
  name: string;
  colour: string | null;
  icon: string | null;
  priority: number;
  created_at?: string | null;
}

/** A (chat, person, tag) row. */
export interface ChatMemberRoleRow {
  chat_id: string;
  user_id: string;
  role_id: string;
}

/** A tag as the interface uses one, after the row has been read. */
export interface ChatRole {
  readonly id: string;
  readonly name: string;
  /** A palette key, or null when the stored value is not one this build knows. */
  readonly colour: string | null;
  /** A `KubIcon` name, or null when this build has no such glyph. */
  readonly icon: string | null;
  readonly priority: number;
}

/** A chat role as `chat_members.role` holds it, or null for a non-member. */
export type ChatMemberStanding = "owner" | "admin" | "member" | null;

/** What the database will accept. Every number is the migration's, not a guess. */
export const CHAT_ROLE_LIMITS = {
  /** `chat_roles_limit`, raised by an AFTER INSERT trigger. */
  perChat: 25,
  /** `chat_member_roles_limit`, the same shape. */
  perMember: 5,
  /** `chat_roles_name_length`, measured on the trimmed name. */
  nameMin: 1,
  nameMax: 32,
} as const;

/**
 * The name as the database will store and compare it.
 *
 * Trimmed, because the CHECK measures `char_length(btrim(name))` and the unique
 * index folds `lower(btrim(name))`. A screen that trims differently shows a
 * name as free and then watches the insert fail on a duplicate.
 */
export function normalizeChatRoleName(raw: string): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** Whether a name would survive `chat_roles_name_length`. */
export function isChatRoleNameValid(raw: string): boolean {
  const length = [...normalizeChatRoleName(raw)].length;
  return length >= CHAT_ROLE_LIMITS.nameMin && length <= CHAT_ROLE_LIMITS.nameMax;
}

/**
 * Whether this name is already taken in this group.
 *
 * Folded with `toLocaleLowerCase("ru-RU")` rather than `toLowerCase()`: the
 * names are Russian, and this project has already been bitten once by a case
 * fold that does not know Cyrillic — a count that answered 1 and 7 where the
 * truth was 7 and 13. Postgres folds with `lower()` under the database's
 * collation, so the two agree on every letter these names actually use.
 */
export function chatRoleNameTaken(
  name: string,
  roles: readonly ChatRole[],
  exceptId?: string,
): boolean {
  const wanted = normalizeChatRoleName(name).toLocaleLowerCase("ru-RU");
  if (!wanted) return false;
  return roles.some(
    (role) =>
      role.id !== exceptId &&
      normalizeChatRoleName(role.name).toLocaleLowerCase("ru-RU") === wanted,
  );
}

/**
 * Rows in the order they are worn: highest rank first, then by name.
 *
 * The same order `chat_roles_chat_priority_idx` is built in — `(chat_id,
 * priority desc, name)` — so the list a person sees and the list the database
 * hands back agree. The tiebreaker is not decoration: `priority` is not unique
 * and two tags at the same rank would otherwise swap places between reads.
 */
export function orderChatRoles(
  rows: readonly ChatRoleRow[],
  knownIcons?: ReadonlySet<string>,
): ChatRole[] {
  const projected = rows.map((row) => ({
    id: row.id,
    name: normalizeChatRoleName(row.name),
    // An unrecognised palette key renders plain rather than being dropped: the
    // migration's stated contract, and the same rule `resolveBadgeIcon` applies
    // to a glyph this build does not have.
    colour: typeof row.colour === "string" && row.colour ? row.colour : null,
    icon:
      typeof row.icon === "string" && row.icon && (!knownIcons || knownIcons.has(row.icon))
        ? row.icon
        : null,
    priority: typeof row.priority === "number" ? row.priority : 0,
  }));
  return projected.sort(
    (left, right) => right.priority - left.priority || left.name.localeCompare(right.name, "ru-RU"),
  );
}

/** The tags one person wears in one chat, in the order they are worn. */
export function chatRolesOfMember(
  userId: string,
  assignments: readonly ChatMemberRoleRow[],
  roles: readonly ChatRole[],
): ChatRole[] {
  const mine = new Set(
    assignments.filter((row) => row.user_id === userId).map((row) => row.role_id),
  );
  return roles.filter((role) => mine.has(role.id));
}

/**
 * The one tag a member row has room for.
 *
 * Telegram shows a group's own word for a person and nothing else — an
 * administrator with a custom title reads as that title rather than as
 * «админ» — and Discord shows one role icon beside a name whatever else is
 * held. Both put the full set on the person's card. So the row takes the
 * highest, and `orderChatRoles` has already decided what highest means.
 */
export function topChatRole(worn: readonly ChatRole[]): ChatRole | null {
  return worn.length > 0 ? worn[0] : null;
}

/** Why a write must not be offered. Named after the server's own refusals. */
export type ChatRoleDenial =
  /** `chat_role_private_chat`: a private conversation has no group to name. */
  | "not_group_chat"
  /** The policy: only the chat's owner may define the vocabulary. */
  | "owner_required"
  /** The policy: only an owner or administrator may hand a tag out. */
  | "admin_required"
  /** `chat_roles_limit`: twenty-five already exist. */
  | "chat_full"
  /** `chat_member_roles_limit`: this person already wears five. */
  | "member_full";

export interface ChatRoleGateInput {
  /** `chats.type`. */
  chatType: string | null | undefined;
  /** The caller's `chat_members.role` in this chat. */
  standing: ChatMemberStanding;
  /** How many roles the group has defined already. */
  definedCount?: number;
  /** How many tags the person being changed already wears. */
  wornCount?: number;
}

/**
 * May this account define the group's vocabulary — invent, rename, recolour,
 * reorder or delete a tag.
 *
 * The chat's type is checked before the standing, in the server's own order:
 * the trigger fires whatever the policy said, so a private chat is refused for
 * its owner too.
 */
export function chatRoleDefineDenial(input: ChatRoleGateInput): ChatRoleDenial | null {
  if (input.chatType !== "group" && input.chatType !== "channel") return "not_group_chat";
  if (input.standing !== "owner") return "owner_required";
  if (typeof input.definedCount === "number" && input.definedCount >= CHAT_ROLE_LIMITS.perChat) {
    return "chat_full";
  }
  return null;
}

/** May this account hand an existing tag to somebody. */
export function chatRoleAssignDenial(input: ChatRoleGateInput): ChatRoleDenial | null {
  if (input.chatType !== "group" && input.chatType !== "channel") return "not_group_chat";
  if (input.standing !== "owner" && input.standing !== "admin") return "admin_required";
  if (typeof input.wornCount === "number" && input.wornCount >= CHAT_ROLE_LIMITS.perMember) {
    return "member_full";
  }
  return null;
}

/** What to say, in the interface's own voice, when a write must not be offered. */
export function chatRoleDenialText(denial: ChatRoleDenial): string {
  switch (denial) {
    case "not_group_chat":
      return "Роли есть только у групп и каналов.";
    case "owner_required":
      return "Роли группы настраивает владелец.";
    case "admin_required":
      return "Выдавать роли могут владелец и администраторы.";
    case "chat_full":
      return `В группе уже ${CHAT_ROLE_LIMITS.perChat} ролей — больше добавить нельзя.`;
    case "member_full":
      return `У участника уже ${CHAT_ROLE_LIMITS.perMember} ролей — снимите одну, чтобы выдать другую.`;
  }
}
