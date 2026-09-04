import type { MessageWithSender, Profile } from "@/types/database";

/**
 * Who sent the row Realtime just delivered.
 *
 * Realtime sends the raw `messages` row. `sender` is a join the client makes
 * itself, so it is absent — and `resolveMessageActor` treats a message with a
 * `user_id` but no `sender` as `{ kind: "invalid" }`, not as a user. `isMe` in
 * `MessageList` is `actor.kind === "user" && actor.id === userId`, so an
 * invalid actor is not you: your own message paints on the LEFT, without a
 * name, and hops to the right a moment later when the joined REST fetch
 * replaces it. That is the "сообщение прыгает то влево, то вправо" the owner
 * reported, and it is visible on every send.
 *
 * The joined fetch is still the source of truth; this only stops the first
 * paint from being wrong. Two senders are known without asking the server:
 *
 *   - your own profile, for your own messages;
 *   - anyone who already has a message on screen in that chat, which covers
 *     essentially every incoming message in a conversation already open.
 *
 * A sender that cannot be resolved is left absent rather than invented. The
 * bubble is briefly anonymous, which is what it does today, instead of
 * carrying a name that might be wrong.
 */
export function attachKnownSender(
  row: MessageWithSender,
  currentUser: Profile | null | undefined,
  knownMessages: readonly Pick<MessageWithSender, "user_id" | "sender">[] = [],
): MessageWithSender {
  // A bot message has no `user_id` and must not be given one; a system message
  // has no sender at all. Both already resolve correctly without help.
  if (row.sender || !row.user_id) return row;

  if (currentUser && row.user_id === currentUser.id) {
    return { ...row, sender: currentUser };
  }

  for (const known of knownMessages) {
    if (known.user_id === row.user_id && known.sender) {
      return { ...row, sender: known.sender };
    }
  }

  return row;
}
