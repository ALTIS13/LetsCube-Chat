/**
 * Who may do what to whom inside one chat.
 *
 * This is the client's mirror of the SQL trigger `enforce_chat_member_update`
 * (`.migration-backup/supabase/migrations/20260504_chats_membership_hardening.sql:391-459`)
 * and of the delete policy beside it. It existed before as a handful of
 * expressions computed inside `members.map()` in `ChatInfoPanel.tsx`, with a
 * comment saying what it mirrored and **no test of any kind**. D-163 needed the
 * same answers in a second place — a menu built for one member rather than a
 * row drawn for each — and two copies of a mirror drift until the interface
 * offers what the server then refuses, which is already a recorded defect of
 * this product (D-142).
 *
 * Kept free of React and of the `@/` alias so `node --test` can execute it
 * directly, the way `roleHierarchy.ts` is.
 *
 * **What this module deliberately does not decide.** The trigger also refuses
 * to demote the *last* owner (`P0001`), holding an advisory lock and counting
 * the remaining owners. That answer depends on the whole chat, not on the two
 * people in hand, and a client that guessed it would sometimes hide a control
 * that would have worked. So the last-owner rule is the server's alone and its
 * error is shown to the reader rather than pre-empted.
 */

export type ChatMemberRole = "owner" | "admin" | "member";

export interface ChatMemberSubject {
  /** The role the person acting holds in this chat, if any. */
  myRole: ChatMemberRole | null;
  /** The role of the person being acted upon. */
  targetRole: ChatMemberRole;
  /** Whether the target is the person acting. */
  isSelf: boolean;
}

/**
 * Every role change the trigger will accept from this caller, in the order a
 * menu should offer them.
 *
 * Owner: full control, the new owner included — the trigger's own
 * `null; -- full control` branch. Admin: exactly two transitions, and never
 * touching an owner in either direction. Anyone else: nothing.
 */
export function allowedRoleChanges({ myRole, targetRole, isSelf }: ChatMemberSubject): ChatMemberRole[] {
  if (isSelf || !myRole) return [];
  if (myRole === "owner") {
    return (["owner", "admin", "member"] as ChatMemberRole[]).filter((role) => role !== targetRole);
  }
  if (myRole === "admin") {
    if (targetRole === "owner") return [];
    if (targetRole === "member") return ["admin"];
    if (targetRole === "admin") return ["member"];
  }
  return [];
}

/** Whether this caller may make this person an administrator. */
export function canPromoteToAdmin(subject: ChatMemberSubject): boolean {
  return allowedRoleChanges(subject).includes("admin") && subject.targetRole === "member";
}

/** Whether this caller may take the administrator's rights away. */
export function canDemoteFromAdmin(subject: ChatMemberSubject): boolean {
  return allowedRoleChanges(subject).includes("member") && subject.targetRole === "admin";
}

/**
 * Whether this caller may hand the chat over.
 *
 * Permitted by the trigger for an owner, and impossible from the interface
 * today because `setMemberRole` is typed `"admin" | "member"` — recorded in the
 * addendum to D-150. Exposed here so the control can be added without deriving
 * the rule a third time.
 */
export function canTransferOwnership(subject: ChatMemberSubject): boolean {
  return allowedRoleChanges(subject).includes("owner");
}

/**
 * Whether this caller may remove this person.
 *
 * The delete policy (`20260504_chats_membership_hardening.sql:351-358`) lets an
 * owner remove anyone who is not an owner, and an admin remove ordinary members
 * only.
 */
export function canRemoveMember({ myRole, targetRole, isSelf }: ChatMemberSubject): boolean {
  if (isSelf || !myRole) return false;
  if (targetRole === "owner") return false;
  if (myRole === "owner") return true;
  return myRole === "admin" && targetRole === "member";
}

/** Whether this person has any action at all — what decides if a control is drawn. */
export function hasAnyMemberAction(subject: ChatMemberSubject): boolean {
  return (
    canPromoteToAdmin(subject) || canDemoteFromAdmin(subject) || canRemoveMember(subject)
  );
}

/** «Владелец», «Администратор», or nothing for an ordinary member. */
export function chatRoleLabel(role: string): string {
  return role === "owner" ? "Владелец" : role === "admin" ? "Администратор" : "";
}
