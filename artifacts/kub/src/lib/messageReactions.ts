import { isMissingRpcError } from "./rpcAvailability.ts";
import { selectRussianPluralForm } from "./messageMediaSections.ts";

/**
 * One reaction per person, as in Telegram — the owner's decision of 2026-09-11.
 *
 * Choosing another reaction replaces yours; choosing yours again removes it.
 * Several reactions per person belong to a future paid subscription, so nothing
 * here assumes there can only ever be one row: every row of the person's is
 * collected, which is what a later "up to three" rule would widen.
 *
 * The database holds the rule since 20260911142000: `set_message_reaction`
 * makes the whole toggle in one call under a lock, and a trigger refuses a
 * second emoji from the same person on every path. What is planned here is the
 * picture shown before the server answers, and the three requests — look up,
 * delete, insert — a client still makes where that function is not deployed.
 *
 * The limit itself is the database's, not this file's (F-7 of the 2026-09-15
 * survey). It was a constant here while `private.reaction_limit_per_message(user)`
 * held it there, already parameterised for the subscription, and
 * `public.reaction_limit_per_message()` was published for the client to ask —
 * so the day a subscriber's limit becomes 2, a constant of 1 would still paint
 * their first reaction away. It is asked for once and remembered; until the
 * answer lands, or where the function is not deployed, the rule is the one the
 * product ships with.
 *
 * Kept free of React and Supabase so `node --test` can load it.
 */

/** The quick reaction: a double tap on a phone, a click on the desktop hover button. */
export const QUICK_REACTION = "❤️";

export const SET_REACTION_RPC = "set_message_reaction";

/** `public.reaction_limit_per_message()` — the caller's own limit, and nobody else's. */
export const REACTION_LIMIT_RPC = "reaction_limit_per_message";

/**
 * How many different reactions one person may put on one message, until the
 * database says otherwise. One, as the owner decided and as
 * `private.reaction_limit_per_message` returns today.
 */
export const DEFAULT_REACTION_LIMIT = 1;

/**
 * A limit is a whole number of reactions, at least one.
 *
 * Bounded above because a nonsense answer must not become the rule: the
 * subscription being planned is «up to three», so anything past a hundred is a
 * wrong answer rather than a generous one, and the shipped default is kept.
 */
export function parseReactionLimit(data: unknown): number | null {
  const raw =
    typeof data === "number" ? data : typeof data === "string" && data.trim() !== "" ? Number(data) : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  const whole = Math.floor(raw);
  if (whole < 1 || whole > 100) return null;
  return whole;
}

/** The limit in force for the signed-in account, and whose turn it is to go and ask. */
export interface ReactionLimitSource {
  /** What to plan with now. Read it after `claimRead`, which is what notices a new account. */
  value(): number;
  /**
   * True for the one caller that should ask the database; false for everyone
   * else. The account is passed because the limit belongs to it: signing in as
   * somebody else forgets the answer rather than planning by their entitlement.
   */
  claimRead(userId: string): boolean;
  /** The database's answer, or its refusal. Returns the limit in force afterwards. */
  accept(result: { data?: unknown; error?: unknown } | null | undefined): number;
}

/**
 * The limit, asked for at most a few times per account.
 *
 * An answer settles it: an entitlement does not change under a person's hands,
 * and a reload — or another account — is what picks up a new one. A server
 * without the function settles it too, that deployment having neither this
 * function nor the RPC the toggle prefers, both being of the same migration;
 * any other refusal leaves one more attempt for the next toggle, bounded so a
 * refusing server does not turn every tap into two requests forever.
 */
export function createReactionLimit(options: { attempts?: number } = {}): ReactionLimitSource {
  const maxAttempts = options.attempts ?? 3;
  let limit = DEFAULT_REACTION_LIMIT;
  let attempts = 0;
  let asking = false;
  let settled = false;
  let owner: string | null = null;
  return {
    value: () => limit,
    claimRead(userId) {
      if (userId !== owner) {
        owner = userId;
        limit = DEFAULT_REACTION_LIMIT;
        attempts = 0;
        asking = false;
        settled = false;
      }
      if (settled || asking || attempts >= maxAttempts) return false;
      asking = true;
      attempts += 1;
      return true;
    },
    accept(result) {
      asking = false;
      const answered = parseReactionLimit(result?.error ? undefined : result?.data);
      if (answered !== null) {
        limit = answered;
        settled = true;
        return limit;
      }
      if (result?.error && isMissingRpcError(result.error)) settled = true;
      return limit;
    },
  };
}

/** The application's one record of the limit. */
export const reactionLimit = createReactionLimit();

/** What `set_message_reaction` returns: every reaction on the message after the change. */
export function parseReactionRows(data: unknown): ReactionRowLike[] | null {
  if (!Array.isArray(data)) return null;
  const rows: ReactionRowLike[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.message_id !== "string" ||
      typeof row.user_id !== "string" ||
      typeof row.emoji !== "string" ||
      typeof row.created_at !== "string"
    ) {
      return null;
    }
    rows.push({ id: row.id, message_id: row.message_id, user_id: row.user_id, emoji: row.emoji, created_at: row.created_at });
  }
  return rows;
}

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

/**
 * The same toggle `set_message_reaction` makes, planned here so the screen can
 * show it before the server answers.
 *
 * Choosing the emoji you already have removes that row and nothing else.
 * Choosing another keeps the newest `limit - 1` of yours, so the new one fits,
 * and removes the rest — which at a limit of one is all of them. Both halves
 * are the RPC's own rule, read off `20260911142000_one_reaction_per_person.sql`;
 * a plan that differed from it would paint a picture the next answer undoes.
 */
export function planReactionToggle(
  reactions: readonly ReactionRowLike[] | null | undefined,
  userId: string,
  emoji: string,
  limit: number = DEFAULT_REACTION_LIMIT,
): ReactionTogglePlan {
  const mine = (reactions ?? []).filter((reaction) => reaction.user_id === userId);
  const sameEmoji = mine.filter((reaction) => reaction.emoji === emoji);
  if (sameEmoji.length) return { remove: sameEmoji.map((reaction) => reaction.id), add: null };
  const keep = Math.max(0, boundedLimit(limit) - 1);
  const newestFirst = [...mine].sort(
    (a, b) => createdAtMs(b) - createdAtMs(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  const kept = new Set(newestFirst.slice(0, keep).map((reaction) => reaction.id));
  return { remove: mine.filter((reaction) => !kept.has(reaction.id)).map((reaction) => reaction.id), add: emoji };
}

/** `greatest(limit, 1)`, as the RPC reads it, and the shipped default for nonsense. */
function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_REACTION_LIMIT;
  return Math.max(1, Math.floor(limit));
}

/** `order by created_at desc, id desc`, with an unreadable date sorting oldest. */
function createdAtMs(reaction: ReactionRowLike): number {
  const parsed = Date.parse(reaction.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** What the older three-request toggle deletes before it inserts. */
export type ReactionDeleteScope =
  | { kind: "none" }
  | { kind: "mine" }
  | { kind: "ids"; ids: string[] };

/**
 * Which rows the delete takes, where `set_message_reaction` is not deployed.
 *
 * At a limit of one, replacing a reaction takes every row of this person's on
 * this message rather than the ids on screen — a stray row the client never saw
 * would otherwise outlive the next choice, and the RPC clears it too (it keeps
 * the newest `limit - 1`, which is none). Anything else takes exactly the rows
 * the plan names: sweeping them all is how a subscriber with a limit of two
 * would lose their first reaction on adding a second.
 */
export function reactionDeleteScope(
  plan: ReactionTogglePlan,
  limit: number = DEFAULT_REACTION_LIMIT,
): ReactionDeleteScope {
  if (!plan.remove.length) return { kind: "none" };
  if (plan.add && boundedLimit(limit) === 1) return { kind: "mine" };
  return { kind: "ids", ids: plan.remove };
}

/** What a call to `set_message_reaction` came back as, and so what to do next. */
export type ReactionRpcOutcome =
  | { kind: "rows"; rows: ReactionRowLike[] }
  | { kind: "missing" }
  | { kind: "refused"; error: unknown }
  | { kind: "unreadable" };

/**
 * The RPC's answer, sorted into the four things it can be.
 *
 * `refused` is the one this used to lose. The toggle painted its guess, logged
 * whatever came back and left the guess standing, so «На это сообщение больше
 * реакций поставить нельзя.» — written, translated and waiting in `errors.ts` —
 * could not be reached by any path, and the person found their old reaction
 * back after a reload.
 */
export function reactionRpcOutcome(
  result: { data?: unknown; error?: unknown } | null | undefined,
): ReactionRpcOutcome {
  if (result?.error) {
    return isMissingRpcError(result.error) ? { kind: "missing" } : { kind: "refused", error: result.error };
  }
  const rows = parseReactionRows(result?.data);
  return rows ? { kind: "rows", rows } : { kind: "unreadable" };
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
