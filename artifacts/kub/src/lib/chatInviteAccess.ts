/**
 * Who may invite somebody into a group or a channel (D-165, part 2).
 *
 * The client had its own idea of the rule, written inline in the information
 * card (`ChatInfoPanel.tsx:388`):
 *
 *     canSendInvites = isGroup && Boolean(myRole)
 *       && (isOwnerOrAdmin || (invitePolicySupported && invitePolicy === "members_can_invite"))
 *
 * `public.group_invite_create(uuid, uuid)`, read off production on 2026-09-17,
 * decides it with four branches rather than two:
 *
 *     if v_chat.type not in ('group', 'channel') then raise group_invite_not_group_chat
 *     v_policy := coalesce(v_chat.invite_policy, 'owner_admin_only')
 *     if not v_has_system_manage then
 *       if v_has_invite_any then
 *         if not v_is_member then raise group_invite_member_required
 *       elsif v_policy = 'members_can_invite' then
 *         if not (v_is_member and v_has_invite) then raise group_invite_member_required
 *       elsif not v_is_admin then
 *         raise group_invite_admin_required
 *       end if
 *     end if
 *
 * So the two branches the client never had are `system.manage` — which needs no
 * membership at all — and `chats.invite_any`, which needs membership and then
 * ignores the policy. Both are real and both are reachable on this deployment.
 *
 * **Measured, not argued.** Four arms against production on 2026-09-17, each
 * inside `begin; … rollback;`, each with a control that had to succeed first
 * (impersonation confirmed by `current_user` + `auth.uid()`, and a readable
 * `chat_members` count), on group `3a06b075` whose policy is `owner_admin_only`:
 *
 *     A  plain member                     -> refused, 42501 group_invite_admin_required
 *     B  the chat's owner                 -> SUCCEEDED (the control: the function works)
 *     C  plain member, policy flipped to
 *        members_can_invite in-transaction -> SUCCEEDED
 *     D  legacy-admin who is a plain
 *        member of that same group         -> SUCCEEDED
 *
 * Arm D is the divergence. The server admits that person through
 * `chats.invite_any`; the client's two-branch rule computes `isOwnerOrAdmin =
 * false`, `invitePolicy !== 'members_can_invite'`, and hides the button with
 * nothing said. That is this entry's own defect — «silently takes the invite
 * button away» — in the direction the entry did not name.
 *
 * **What an unread policy means here.** `chats.invite_policy` is `not null` in
 * production with a default of `owner_admin_only`, and its CHECK admits only
 * that and `members_can_invite`; all 40 chats carry the first. So the server
 * never sees a null. `null` on the client means the *client* could not read the
 * column — an old schema cache, PGRST204 — and the old rule turned that into a
 * silent refusal for every ordinary member. It does not refuse here: the column
 * is read authoritatively by the function, so the honest answer is to offer the
 * action and let the server judge it. `policyUnread` says which case this is so
 * the interface can stop claiming to know a policy it never read.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

import type { InvitePolicy } from "./groupInvites.ts";

/** A chat role as `chat_members.role` holds it, or null for a non-member. */
export type ChatMemberRole = "owner" | "admin" | "member";

/** Which branch of the server function admitted the caller. */
export type ChatInviteGrant =
  /** `system.manage`: allowed without being in the chat at all. */
  | "system_manage"
  /** `chats.invite_any` plus membership: the policy is not consulted. */
  | "invite_any"
  /** The chat's own owner or administrator. */
  | "chat_admin"
  /** The chat's policy says members may invite, and this member may. */
  | "chat_policy";

/** Why the action must not be offered. Named after the server's own errors. */
export type ChatInviteDenial =
  /** `group_invite_not_group_chat`: a private conversation has no invitations. */
  | "not_group_chat"
  /** `group_invite_member_required`: you are not in this chat. */
  | "member_required"
  /** `group_invite_admin_required`: the policy leaves it to administrators. */
  | "admin_required";

export interface ChatInviteAdmissionInput {
  /** `chats.type`. */
  chatType: string | null | undefined;
  /** The caller's `chat_members.role` in this chat, or null when not a member. */
  chatRole: ChatMemberRole | null | undefined;
  /** `chats.invite_policy`, or null when the client could not read the column. */
  invitePolicy: InvitePolicy | null | undefined;
  /** `has_permission(caller, 'chats.invite')`. Every measured role holds it. */
  hasInvite: boolean;
  /** `has_permission(caller, 'chats.invite_any')`. */
  hasInviteAny: boolean;
  /** `has_permission(caller, 'system.manage')`. */
  hasSystemManage: boolean;
}

export interface ChatInviteAdmission {
  /** Whether the interface should offer the invite action. */
  canInvite: boolean;
  /**
   * Which server branch grants it. `null` with `canInvite` true means only the
   * server can tell, because the policy could not be read.
   */
  grantedBy: ChatInviteGrant | null;
  /** Why not, when the action must not be offered at all. */
  denial: ChatInviteDenial | null;
  /** Whether `chats.invite_policy` was unreadable on this client. */
  policyUnread: boolean;
}

/** The two values `chats_invite_policy_check` admits, and nothing else. */
export function isInvitePolicy(value: unknown): value is InvitePolicy {
  return value === "owner_admin_only" || value === "members_can_invite";
}

/**
 * `chats.invite_policy` as the client managed to read it.
 *
 * `null` for anything the CHECK would refuse, which is the whole point: a value
 * the client does not recognise is a value it has not read, and the card used
 * to print the default beside it as though it had. All 40 chats in production
 * carry `owner_admin_only`; a third spelling has never existed there.
 */
export function readInvitePolicy(value: unknown): InvitePolicy | null {
  return isInvitePolicy(value) ? value : null;
}

/**
 * The client's copy of `group_invite_create`'s admission gate.
 *
 * The branches are in the server's order, because the order is load-bearing:
 * the chat's type is checked before any permission, so `system.manage` does not
 * open invitations on a private conversation; and `chats.invite_any` is checked
 * before the policy, so it ignores it.
 */
export function chatInviteAdmission(input: ChatInviteAdmissionInput): ChatInviteAdmission {
  const policy = readInvitePolicy(input.invitePolicy);
  const policyUnread = policy === null;
  const isMember = input.chatRole === "owner" || input.chatRole === "admin" || input.chatRole === "member";
  const isChatAdmin = input.chatRole === "owner" || input.chatRole === "admin";

  const refuse = (denial: ChatInviteDenial): ChatInviteAdmission => ({
    canInvite: false,
    grantedBy: null,
    denial,
    policyUnread,
  });
  const allow = (grantedBy: ChatInviteGrant | null): ChatInviteAdmission => ({
    canInvite: true,
    grantedBy,
    denial: null,
    policyUnread,
  });

  // The server's first statement, and the only one that runs before the
  // permissions: `if v_chat.type not in ('group', 'channel')`.
  if (input.chatType !== "group" && input.chatType !== "channel") return refuse("not_group_chat");

  if (input.hasSystemManage) return allow("system_manage");
  if (input.hasInviteAny) return isMember ? allow("invite_any") : refuse("member_required");

  // An unread policy is not a policy. The column is `not null` in production
  // and the function reads it itself, so the action is offered and the server
  // answers — rather than being removed from somebody the policy may well allow.
  if (policyUnread) return isMember ? allow(null) : refuse("member_required");

  if (policy === "members_can_invite") {
    // Faithful to the server, including the part that cannot currently happen:
    // it raises `member_required` here without falling through to the
    // administrator branch, so a chat owner who somehow lacked `chats.invite`
    // would be refused in a group that lets members invite. Every global role
    // and the legacy fallback hold `chats.invite`, so nobody is in that state
    // today; mirroring it is cheaper than discovering the day somebody is.
    return isMember && input.hasInvite ? allow("chat_policy") : refuse("member_required");
  }

  return isChatAdmin ? allow("chat_admin") : refuse("admin_required");
}
