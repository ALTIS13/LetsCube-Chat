import { createContext } from "react";

import type { BoxEdges } from "@/lib/messageMenuPlacement";
import type { Profile } from "@/types/database";

export type ReactionPerson = Pick<Profile, "id" | "full_name" | "username" | "avatar_url">;

/**
 * What the small pieces inside a message need from the list around it.
 *
 * A context rather than props, for the reason D-086 gives: every prop a bubble
 * takes is a reason for every bubble on screen to render again when it
 * changes. The quick row re-ranks after a reaction and the people of a chat
 * change when someone joins; only the chips and the hover button read these,
 * so only they render when they change.
 */
export interface MessageActionsContextValue {
  /** The six beside ❤️, most used first. */
  quickReactions: readonly string[];
  /** Who is who, for «who reacted». */
  people: ReadonlyMap<string, ReactionPerson>;
  currentUserId: string | null;
  /** The full emoji panel for a message, opened beside a control. */
  openEmojiPanel: (messageId: string, anchor: BoxEdges) => void;
  /** The message's menu, opened from the keyboard at a control. */
  openMenuAt: (messageId: string, anchor: BoxEdges) => void;
}

export const MessageActionsContext = createContext<MessageActionsContextValue | null>(null);

/** «Вы», a profile's name, or a neutral word for someone no longer in the chat. */
export function reactionPersonName(
  person: ReactionPerson | undefined,
  userId: string,
  currentUserId: string | null,
): string {
  if (userId === currentUserId) return "Вы";
  return person?.full_name?.trim() || person?.username?.trim() || "Участник";
}
