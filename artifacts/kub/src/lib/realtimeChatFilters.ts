/**
 * Realtime filters that name the chats a reader holds — D-327.
 *
 * A `chat_members` DELETE is not checked against row-level security, and its
 * old row carries the table's key, `(chat_id, user_id)`. Unfiltered, every
 * signed-in client was handed the pair for every departure from every chat in
 * the deployment. A filter on the key does reach a DELETE: measured on
 * production on 2026-09-30 with one real departure in a QA group — `chat_id=eq`
 * and `chat_id=in` on the chat heard it, the same on another chat did not, and
 * so for `user_id` (register D-327, whose question this settles).
 *
 * Pure, so `node --test` holds it (`tests/unit/realtime-chat-filters.test.mts`).
 */

/** Realtime takes at most 100 values in one `in` filter. */
export const REALTIME_IN_FILTER_MAX = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The chats a reader holds, as one key: sorted, unique, comma-joined. The same
 * set gives the same string whatever order the list is in, so a subscription
 * keyed on it is made again only when a chat is joined or left — not on every
 * message that reorders the list. Anything that is not a chat id is left out:
 * it would break the filter's own syntax.
 */
export function heldChatIdsKey(chats: readonly { id?: string | null }[]): string {
  const ids = new Set<string>();
  for (const chat of chats) {
    if (chat.id && UUID.test(chat.id)) ids.add(chat.id.toLowerCase());
  }
  return [...ids].sort().join(",");
}

/** `chat_id=in.(…)` filters covering the key's chats, `max` to a filter; none for none. */
export function chatIdInFilters(key: string, max = REALTIME_IN_FILTER_MAX): string[] {
  const ids = key ? key.split(",") : [];
  const filters: string[] = [];
  for (let start = 0; start < ids.length; start += max) {
    filters.push(`chat_id=in.(${ids.slice(start, start + max).join(",")})`);
  }
  return filters;
}
