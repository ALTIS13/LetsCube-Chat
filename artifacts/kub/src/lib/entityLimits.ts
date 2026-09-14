export const CHAT_NAME_MAX_LENGTH = 64;
export const FOLDER_NAME_MAX_LENGTH = 64;
export const TOPIC_NAME_MAX_LENGTH = 64;

/**
 * A name cut to its limit, counted in characters rather than in code units.
 *
 * This was `value.slice(0, maxLength)` until 2026-09-14, and that is broken in
 * two ways for any name that mixes letters with emoji. Both were measured:
 *
 *   1. **It can cut a surrogate pair in half.** `limitText("a" + "🧊".repeat(40), 64)`
 *      ends in the lone high surrogate `\ud83e`, which does not round-trip
 *      through UTF-8 — `Buffer.from(cut, "utf8").toString("utf8") !== cut` — so
 *      what leaves the client is a JSON body Postgres cannot store as written.
 *      It reaches four user-facing fields: a group's name, a chat's name, a
 *      folder's name and a text channel's name.
 *   2. **It gives fewer characters than the limit promises.** `char_length` in
 *      Postgres counts characters and `String.length` counts UTF-16 code units,
 *      so a name of 40 emoji was cut to 33 characters against a limit of 64 and
 *      the counter beside the field said 64.
 *
 * The same cut `normalizeChannelName` and `normalizeReportNote` make, for the
 * same reason. `Array.from` iterates code points, so a pair is never split.
 *
 * Grapheme clusters are still counted as their code points — a flag or a
 * family emoji costs several. That matches what the database counts, which is
 * the number this has to agree with; agreeing with the database is the point.
 */
export function limitText(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  const points = Array.from(value);
  return points.length <= maxLength ? value : points.slice(0, maxLength).join("");
}

/** How many characters are left, counted the way the database counts them. */
export function textRemaining(value: string, maxLength: number): number {
  return maxLength - Array.from(value).length;
}
