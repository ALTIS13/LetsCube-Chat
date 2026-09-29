/**
 * Whether a `chat_members` UPDATE changes what a member list shows (D-260).
 *
 * The table carries every member's read and delivery marks, so nearly every
 * UPDATE on it is somebody reading. The information panel reloaded on all of
 * them — its members, its invitations, its invite policy and, through
 * `dispatchChatsRefresh`, the whole chat list — once for each time anybody in
 * the group read anything, for as long as the panel stayed open.
 *
 * What a member list shows of a member is who they are and their role. The
 * payload's new row carries the role, and with the table's `default` replica
 * identity its old row carries the key alone — so the role it is compared with
 * is the one the list already holds. A row for somebody the list does not hold
 * means the list is behind, and is read again.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

export interface MemberListEntry {
  /** The member's user id. */
  id: string;
  /** Their role in the chat, as the list shows it. */
  chat_role?: string | null;
}

export function memberUpdateChangesList(
  row: { user_id?: unknown; role?: unknown } | null | undefined,
  members: readonly MemberListEntry[],
): boolean {
  if (!row || typeof row.user_id !== "string") return false;
  const member = members.find((entry) => entry.id === row.user_id);
  if (!member) return true;
  return typeof row.role === "string" && row.role !== member.chat_role;
}
