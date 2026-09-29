/**
 * How the search orders the conversations it finds on this device (tracker
 * item 36, c).
 *
 * Section 15.3 of `docs/operations/reference-clients.md` read Discord's quick
 * switcher: a match-quality ladder — exact 10, prefix 7, contains 5, every word
 * present 3, fuzzy 1 — multiplied by a usage booster, `1000 × quality × booster`.
 * Ours used to score a conversation by `indexOf` over one string that joined its
 * name, its description and its last message. Two things followed. A query
 * whose words came in another order found nothing: «проекта команда» missed
 * «Команда проекта». And a conversation matched by the last thing said in it
 * ranked with one matched by its name.
 *
 * What is taken, and where ours differs, with the reason:
 *
 *  - **The ladder**, as read. It is scored against the conversation's name, and
 *    against its handle when the query is one (`@…`).
 *  - **One rung of our own: a word's start, 6.** «про» typed from the start of a
 *    word names that word, as in «Команда проекта». The same letters inside a
 *    word, as in «спросить», are usually an accident. Discord's ladder has no
 *    rung between prefix and contains, so its switcher ranks the two alike.
 *  - **What was said is not what it is called.** A match found only in the
 *    description or the last message scores 2: above a fuzzy guess at the name,
 *    below any real match on it.
 *  - **The booster is recency, not frecency.** Discord's counts visits. Ours has
 *    only the order of the last visits on this device (`lib/recentChats.ts`,
 *    ids only), so the most recent gets up to 2 and the rest less in turn.
 *    Frequency is not kept, and nothing here pretends it is.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

/** The ladder, with our one extra rung. 0 is no match. */
export const MATCH = {
  exact: 10,
  prefix: 7,
  wordStart: 6,
  contains: 5,
  allWords: 3,
  elsewhere: 2,
  fuzzy: 1,
  none: 0,
} as const;

export type MatchQuality = (typeof MATCH)[keyof typeof MATCH];

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
}

function words(value: string): string[] {
  return value.split(/[\s.,;:!?«»"'()[\]{}\-–—/\\|]+/).filter(Boolean);
}

/** Every letter of the needle, in order, somewhere in the text. */
function isSubsequence(needle: string, text: string): boolean {
  let at = 0;
  for (const char of needle) {
    at = text.indexOf(char, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * Where a name stands on the ladder for a query.
 *
 * `fuzzy` ignores the query's spaces. A single letter never reaches it: a name
 * that holds the letter has already matched as `contains`.
 */
export function matchQuality(text: string, query: string): MatchQuality {
  const name = normalize(text);
  const needle = normalize(query);
  if (!name || !needle) return MATCH.none;
  if (name === needle) return MATCH.exact;
  if (name.startsWith(needle)) return MATCH.prefix;
  if (words(name).some((word) => word.startsWith(needle))) return MATCH.wordStart;
  if (name.includes(needle)) return MATCH.contains;
  const parts = words(needle);
  if (parts.length > 1 && parts.every((part) => name.includes(part))) return MATCH.allWords;
  if (isSubsequence(needle.replace(/\s+/g, ""), name)) return MATCH.fuzzy;
  return MATCH.none;
}

/**
 * How much more a recently visited conversation weighs: 2 for the last one,
 * falling to just above 1 for the oldest remembered, and 1 for any other.
 */
export function recencyBooster(chatId: string, recent: readonly string[]): number {
  const index = recent.indexOf(chatId);
  if (index === -1 || recent.length === 0) return 1;
  return 1 + (recent.length - index) / recent.length;
}

export interface LocalChatEntry {
  id: string;
  /** What the list calls it. */
  name: string;
  /** The other person's handle, with its «@», in a private chat. */
  handle?: string | null;
  /** The description and the last message, which are not what it is called. */
  elsewhere?: readonly (string | null | undefined)[];
}

/** A conversation's score for a query, 0 when it does not match at all. */
export function scoreLocalChat(entry: LocalChatEntry, query: string, recent: readonly string[] = []): number {
  const trimmed = query.trim();
  const isHandleQuery = trimmed.startsWith("@");
  const needle = trimmed.replace(/^@+/, "");
  if (!needle) return 0;
  let quality: number = matchQuality(entry.name, needle);
  const handle = (entry.handle ?? "").replace(/^@+/, "");
  if (handle) {
    const handleQuality = matchQuality(handle, needle);
    // Somebody who typed a handle means that person: a handle that begins
    // with it outranks any name, as the old scorer's «preferred» did.
    if (isHandleQuery && handleQuality >= MATCH.prefix) quality = MATCH.exact + 1;
    else quality = Math.max(quality, handleQuality);
  }
  if (quality === MATCH.none) {
    const said = normalize((entry.elsewhere ?? []).filter(Boolean).join(" "));
    if (said.includes(normalize(needle))) quality = MATCH.elsewhere;
  }
  if (quality === MATCH.none) return 0;
  return 1000 * quality * recencyBooster(entry.id, recent);
}
