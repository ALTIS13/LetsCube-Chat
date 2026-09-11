import { QUICK_REACTION } from "./messageReactions.ts";

/**
 * The reactions a person uses most, for the quick row beside ❤️.
 *
 * Counted on this device only. Nothing on the server records which reactions a
 * person favours, so a second phone starts from the defaults below — carrying
 * the ranking across devices needs a backend, and that is recorded in the
 * register rather than guessed at here.
 *
 * ❤️ is never part of the ranking: it is the quick reaction and always stands
 * first, so counting it would only push a real favourite off the row.
 */

export const RECENT_REACTIONS_STORAGE_KEY = "kub:reactions:recent";
export const RECENT_REACTIONS_EVENT = "kub:recent-reactions";

/** What a new person sees, in Telegram's spirit: agreement, laughter, surprise, sympathy. */
export const DEFAULT_QUICK_REACTIONS: readonly string[] = ["👍", "😂", "😮", "😢", "🔥", "🙏", "👏", "🎉"];

export interface RecentReactionEntry {
  emoji: string;
  count: number;
  lastUsedAt: number;
}

/** Bounded, so a long life of reactions cannot grow storage without end. */
const MAX_ENTRIES = 24;

export function rankRecentReactions(entries: readonly RecentReactionEntry[]): string[] {
  return [...entries]
    .filter((entry) => entry.emoji && entry.emoji !== QUICK_REACTION && entry.count > 0)
    .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
    .map((entry) => entry.emoji);
}

/** The six beside ❤️: the person's favourites, topped up from the defaults. */
export function quickReactionRow(entries: readonly RecentReactionEntry[], limit = 6): string[] {
  const row: string[] = [];
  for (const emoji of [...rankRecentReactions(entries), ...DEFAULT_QUICK_REACTIONS]) {
    if (emoji === QUICK_REACTION || row.includes(emoji)) continue;
    row.push(emoji);
    if (row.length === limit) break;
  }
  return row;
}

export function recordReactionUse(
  entries: readonly RecentReactionEntry[],
  emoji: string,
  now: number,
): RecentReactionEntry[] {
  const next = entries.map((entry) => ({ ...entry }));
  const existing = next.find((entry) => entry.emoji === emoji);
  if (existing) {
    existing.count += 1;
    existing.lastUsedAt = now;
  } else {
    next.push({ emoji, count: 1, lastUsedAt: now });
  }
  return next.sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt).slice(0, MAX_ENTRIES);
}

/** Anything stored that is not an entry is dropped rather than trusted. */
export function parseRecentReactions(raw: string | null | undefined): RecentReactionEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is RecentReactionEntry =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as RecentReactionEntry).emoji === "string" &&
        (value as RecentReactionEntry).emoji.length > 0 &&
        (value as RecentReactionEntry).emoji.length <= 16 &&
        Number.isFinite((value as RecentReactionEntry).count) &&
        Number.isFinite((value as RecentReactionEntry).lastUsedAt),
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function readStoredRecentReactions(): RecentReactionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecentReactions(window.localStorage.getItem(RECENT_REACTIONS_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Records one use and tells any open list to re-rank. Never throws. */
export function rememberReactionUse(emoji: string): void {
  if (typeof window === "undefined" || !emoji) return;
  try {
    const next = recordReactionUse(readStoredRecentReactions(), emoji, Date.now());
    window.localStorage.setItem(RECENT_REACTIONS_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RECENT_REACTIONS_EVENT));
  } catch {
    // Storage can be refused (a private window, a full quota). The reaction
    // itself is not affected; only the ranking stops learning.
  }
}
