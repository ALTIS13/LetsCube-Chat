import { selectRussianPluralForm } from "./messageMediaSections.ts";

/**
 * One reaction per person, as in Telegram — the owner's decision of 2026-09-11.
 *
 * Choosing another reaction replaces yours; choosing yours again removes it.
 * Several reactions per person belong to a future paid subscription, so nothing
 * here assumes there can only ever be one row: every row of the person's is
 * collected, which is what a later "up to three" rule would widen.
 *
 * The rule is enforced in the client only. The database still accepts a second
 * row from the same person, so a constraint is a separate, approved migration —
 * until then this is what every surface goes through, and two clients racing
 * each other can still leave two rows behind.
 *
 * Kept free of React and Supabase so `node --test` can load it.
 */

/** The quick reaction: a double tap on a phone, a click on the desktop hover button. */
export const QUICK_REACTION = "❤️";

/** The shape this module needs from a reaction row. */
export interface ReactionRowLike {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** What one toggle does: which of the person's rows go, and what, if anything, comes in. */
export interface ReactionTogglePlan {
  remove: string[];
  add: string | null;
}

export function planReactionToggle(
  reactions: readonly ReactionRowLike[] | null | undefined,
  userId: string,
  emoji: string,
): ReactionTogglePlan {
  const mine = (reactions ?? []).filter((reaction) => reaction.user_id === userId);
  const hadThis = mine.some((reaction) => reaction.emoji === emoji);
  return { remove: mine.map((reaction) => reaction.id), add: hadThis ? null : emoji };
}

/**
 * The reactions as they will be once the plan has been applied, for the screen
 * to show before the server answers. The added row carries a local id, and the
 * refetch that follows every toggle replaces it with the real one.
 */
export function applyReactionPlan<T extends ReactionRowLike>(
  reactions: readonly T[] | null | undefined,
  userId: string,
  plan: ReactionTogglePlan,
  added: { messageId: string; createdAt: string },
): ReactionRowLike[] {
  const removed = new Set(plan.remove);
  const kept: ReactionRowLike[] = (reactions ?? []).filter(
    (reaction) => !(reaction.user_id === userId && removed.has(reaction.id)),
  );
  if (!plan.add) return kept;
  return [
    ...kept,
    {
      id: `local:${userId}:${plan.add}`,
      message_id: added.messageId,
      user_id: userId,
      emoji: plan.add,
      created_at: added.createdAt,
    },
  ];
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
  /** Who put it, in the order the rows arrived. */
  userIds: string[];
}

/** One entry per emoji, in the order each emoji first appeared. */
export function groupReactions(
  reactions: readonly Pick<ReactionRowLike, "emoji" | "user_id">[] | null | undefined,
  userId: string | null | undefined,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions ?? []) {
    let group = groups.get(reaction.emoji);
    if (!group) {
      group = { emoji: reaction.emoji, count: 0, mine: false, userIds: [] };
      groups.set(reaction.emoji, group);
    }
    group.count += 1;
    if (!group.userIds.includes(reaction.user_id)) group.userIds.push(reaction.user_id);
    if (userId && reaction.user_id === userId) group.mine = true;
  }
  return [...groups.values()];
}

/** The emoji this person has put on the message, or null. */
export function myReaction(
  reactions: readonly Pick<ReactionRowLike, "emoji" | "user_id">[] | null | undefined,
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return (reactions ?? []).find((reaction) => reaction.user_id === userId)?.emoji ?? null;
}

/** «1 реакция», «3 реакции», «11 реакций». */
export function reactionCountLabel(count: number): string {
  return `${count} ${selectRussianPluralForm(count, ["реакция", "реакции", "реакций"])}`;
}

/**
 * The emoji a header row names, most used first and ties in arrival order —
 * the order a person reading «❤️ 👍 3 реакции» expects.
 */
export function leadingReactionEmoji(groups: readonly ReactionGroup[], limit = 3): string[] {
  return [...groups]
    .map((group, index) => ({ group, index }))
    .sort((a, b) => b.group.count - a.group.count || a.index - b.index)
    .slice(0, limit)
    .map(({ group }) => group.emoji);
}
