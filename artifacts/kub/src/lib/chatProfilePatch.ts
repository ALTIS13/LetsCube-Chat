/**
 * Applies a live `profiles` row to the chat list.
 *
 * The chat header and the sidebar read a peer's presence from `chat.other_user`
 * (and the member rows behind it), not from the messages on screen. Nothing
 * refreshed either of those while you sat in a chat: `fetchChats` runs on tab
 * focus, reconnect and message traffic, and none of those happen while two
 * people are simply looking at each other's conversation.
 *
 * Measured on production on 2026-09-05. One account signed in, heartbeating
 * correctly every 60 seconds — five `PATCH /profiles` writes, all landing —
 * while the peer's view of the same account went from 23 seconds stale to 203
 * seconds stale without one refresh, crossing the 90-second
 * `USER_ONLINE_THRESHOLD_MS` at about a minute and a half and rendering
 * "был(а) N минут назад" for someone who was sitting right there. Adding a
 * second device changed nothing about this, in either direction: the two
 * devices do not fight over `online_at`, they just both write it, and the
 * database value was fresh throughout.
 *
 * `chatListChange.ts` had already fixed the other half of this — a refetch
 * carrying only fresh presence used to be judged identical and discarded — but
 * a comparison can only help a refetch that happens.
 *
 * The data was already arriving. `profiles:chat:{chatId}` in `useMessages`
 * subscribes to every `profiles` UPDATE and receives each peer's heartbeat; it
 * simply spent the row on `message.sender` and dropped the rest. So this adds
 * no subscription, no polling and no request volume — it reads a row the client
 * was already being handed.
 */

/** The only field this needs to identify a profile row. */
export interface ChatProfileSnapshot {
  id?: string | null;
}

/** The parts of a chat this reads. Everything else is carried through. */
export interface PatchableChat {
  other_user?: ChatProfileSnapshot | null;
  members?: readonly { user_id?: string | null; profile?: ChatProfileSnapshot | null }[] | null;
}

/**
 * Returns a new chat list with the profile merged in, or `null` when nothing
 * referenced it.
 *
 * Returning `null` rather than an equal array matters: this handler runs for
 * every profile update the client can see, which is every user's heartbeat, and
 * most of them belong to nobody in this list. The caller skips the store write
 * entirely on `null` instead of leaning on `setChats` to decide it was a no-op.
 *
 * The merge is a spread, so fields the realtime row does not carry are kept.
 */
export function applyProfileToChats<T extends PatchableChat>(
  chats: readonly T[],
  profile: ChatProfileSnapshot | null | undefined,
): T[] | null {
  const profileId = profile?.id;
  if (!profile || !profileId) return null;

  let changed = false;
  const next = chats.map((chat) => {
    const otherMatches = Boolean(chat.other_user && chat.other_user.id === profileId);
    const patchedOther = otherMatches ? { ...chat.other_user, ...profile } : chat.other_user;

    let membersChanged = false;
    const patchedMembers = chat.members?.map((member) => {
      if (member.user_id !== profileId || !member.profile) return member;
      membersChanged = true;
      return { ...member, profile: { ...member.profile, ...profile } };
    });

    if (!otherMatches && !membersChanged) return chat;

    changed = true;
    // The spreads widen the member and profile types past what `T` declares,
    // which is exactly what a partial realtime row is. The shape is unchanged —
    // only the values of fields the row carried — so the cast reasserts `T`
    // rather than inventing anything.
    return {
      ...chat,
      ...(otherMatches ? { other_user: patchedOther } : {}),
      ...(membersChanged ? { members: patchedMembers } : {}),
    } as T;
  });

  return changed ? next : null;
}
