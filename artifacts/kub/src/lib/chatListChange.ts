/**
 * Whether a freshly fetched chat list differs from the one on screen.
 *
 * `setChats` returns the previous state when this says "same", which discards
 * the fetched rows entirely. So anything the interface renders and this does
 * not compare is a field that can go stale and stay stale until a reload.
 *
 * That is not hypothetical: presence was exactly this bug. The signature
 * covered `last_read_at` and `last_delivered_at` but not `online_at`, so a
 * refetch carrying only a fresh presence timestamp was judged identical and
 * thrown away — while a refetch carrying a read receipt was kept. Returning to
 * a backgrounded tab therefore showed the other person's receipt updating while
 * their "был(а) N минут назад" went on counting up from a timestamp 38 minutes
 * old, until the page was reloaded.
 *
 * `online_at` is compared exactly rather than bucketed. A coarser comparison
 * would be cheaper, but the online threshold is 90 seconds
 * (`USER_ONLINE_THRESHOLD_MS`) and any bucket wide enough to be worth having
 * can hold someone at "в сети" after they have gone, or the reverse. The cost
 * of comparing exactly is a re-render of the list when a member's heartbeat
 * lands — `setChats` triggers no resubscription, and the only effect keyed on
 * `chats` sets `document.title` — and receipts, which change just as often,
 * were already in here.
 */

/** The parts of a member this comparison reads. */
export interface ChatMemberSnapshot {
  user_id?: string | null;
  role?: string | null;
  last_read_at?: string | null;
  last_delivered_at?: string | null;
  profile?: { online_at?: string | null } | null;
}

/** The parts of a chat this comparison reads. */
export interface ChatSnapshot {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  is_forum?: boolean | null;
  invite_policy?: string | null;
  updated_at?: string | null;
  unread_count?: number | null;
  is_pinned?: boolean | null;
  pinned_at?: string | null;
  pinned_order?: number | null;
  hidden_at?: string | null;
  cleared_at?: string | null;
  last_message?: {
    id?: string | null;
    created_at?: string | null;
    edited_at?: string | null;
    deleted_at?: string | null;
  } | null;
  members?: readonly ChatMemberSnapshot[] | null;
  other_user?: { online_at?: string | null } | null;
}

/**
 * One member's contribution, including their presence.
 *
 * Sorted by the caller so member order from the server cannot register as a
 * change on its own.
 */
export function chatMemberSignature(member: ChatMemberSnapshot): string {
  return [
    member.user_id ?? "",
    member.role ?? "",
    member.last_read_at ?? "",
    member.last_delivered_at ?? "",
    member.profile?.online_at ?? "",
  ].join(":");
}

export function chatMembersSignature(chat: ChatSnapshot): string {
  return (chat.members ?? []).map(chatMemberSignature).sort().join("|");
}

export function sameChat(a: ChatSnapshot, b: ChatSnapshot): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    a.avatar_url === b.avatar_url &&
    a.is_forum === b.is_forum &&
    a.invite_policy === b.invite_policy &&
    a.updated_at === b.updated_at &&
    a.unread_count === b.unread_count &&
    a.is_pinned === b.is_pinned &&
    a.pinned_at === b.pinned_at &&
    a.pinned_order === b.pinned_order &&
    a.hidden_at === b.hidden_at &&
    a.cleared_at === b.cleared_at &&
    a.last_message?.id === b.last_message?.id &&
    a.last_message?.created_at === b.last_message?.created_at &&
    a.last_message?.edited_at === b.last_message?.edited_at &&
    a.last_message?.deleted_at === b.last_message?.deleted_at &&
    // The chat header reads `other_user`, not `members`, so it is compared in
    // its own right: a private chat whose peer went online must not be judged
    // unchanged because the members array happened to agree.
    (a.other_user?.online_at ?? null) === (b.other_user?.online_at ?? null) &&
    chatMembersSignature(a) === chatMembersSignature(b)
  );
}

export function sameChatList(a: readonly ChatSnapshot[], b: readonly ChatSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((chat, index) => {
    const next = b[index];
    return next !== undefined && sameChat(chat, next);
  });
}
