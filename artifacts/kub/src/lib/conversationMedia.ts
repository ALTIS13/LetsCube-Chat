/**
 * The pictures and videos of a conversation, as a sequence you can move along.
 *
 * D-288, from the tester of 2026-09-20: «я не могу влево-вправо свайп сделать
 * и те же 2 отправленные фото сравнить». The viewer opened from a bubble was a
 * dead end — `MediaViewer` has had arrows, arrow keys and a touch swipe since
 * D-171, but all of it sits behind a `sequence` prop that only the shared-media
 * sub-view ever passed. Nothing was missing from the viewer; the conversation
 * simply never told it where the picture stood.
 *
 * ## What the sequence is, measured rather than chosen
 *
 * «Every image in the conversation», «the ones loaded» and «the ones in that
 * message» are three different products, so Telegram was asked on the device
 * (2026-09-20, section 16 of `docs/operations/reference-clients.md`). Opening a
 * picture from a feed there draws **«237 из 244»** — the whole chat's media,
 * far past anything the feed had loaded — and a swipe left moved it to
 * «238 из 244». So:
 *
 *   - the unit is **the chat**, not the message and not the album;
 *   - the order is **chronological**, because 1 is the oldest and a swipe left
 *     walks towards the newer end, which is the direction the reader was
 *     already travelling down the conversation;
 *   - the count is the chat's own, so the far end is not a wall.
 *
 * Ours holds the chronological order and the chat as the unit. What it cannot
 * hold for nothing is Telegram's *count*: Telegram keeps a shared-media index
 * per chat and we would have to query one before the viewer could open, which
 * would put a round trip in front of a tap. So the sequence here is the media
 * of the **loaded** conversation, and reaching its old end asks the
 * conversation for its next page of history — the same mechanic `planMediaStep`
 * already runs at the shared-media grid's end, pointed the other way. The label
 * says «3 из 7+» while more history exists, which is the hedge the counted rows
 * already use and is true, rather than a total this surface has not read.
 *
 * ## Why the order is not the grid's
 *
 * «Общие медиа» is newest-first and its viewer steps that way. This one is
 * oldest-first. That is not an inconsistency to be tidied away: **the viewer's
 * order is the order of the surface that opened it.** A reader who taps a photo
 * in the conversation and swipes forward expects the next photo *down* the
 * conversation; giving them the grid's order would walk them backwards, away
 * from where they were reading.
 *
 * Nothing here imports anything. The decision is words and arithmetic, so
 * `node --test` reads this file directly.
 */

/**
 * What this module needs from a message row.
 *
 * Structural, as `DatedMediaRow` in `sharedMediaBrowsing.ts` is: the generated
 * `Message` satisfies it and no type has to be imported.
 */
export interface ConversationMediaRow {
  id: string;
  type?: string | null;
  media_url?: string | null;
  deleted_at?: string | null;
}

/** The two kinds the viewer can show. A file, a voice message and an audio are not pictures. */
export function isConversationMediaRow(row: ConversationMediaRow): boolean {
  if (row.deleted_at) return false;
  if (!row.media_url) return false;
  return row.type === "image" || row.type === "video";
}

/**
 * The conversation's pictures and videos, in the conversation's own order.
 *
 * The caller's order is kept and never re-sorted: `useMessages` hands its pages
 * over oldest-first already, and re-sorting here would hide a paging fault
 * rather than show it — the rule `groupMediaByMonth` keeps for the same reason.
 *
 * A round video message is included. It is a video, it opens in the viewer from
 * its own bubble, and leaving it out would make the count disagree with what a
 * reader can actually reach.
 */
export function conversationMediaRows<T extends ConversationMediaRow>(messages: readonly T[]): T[] {
  return messages.filter((message) => isConversationMediaRow(message));
}

/**
 * Where a message sits among them, or `null` when it is not one of them.
 *
 * The open item is held by **id** rather than by index, and that is the whole
 * reason this function exists. A page of older history lands at the *front* of
 * the conversation, so every index shifts by however many pictures it brought;
 * an index remembered across that prepend would silently point at a different
 * photograph. An id cannot drift.
 */
export function conversationMediaIndex(
  rows: readonly ConversationMediaRow[],
  messageId: string | null | undefined,
): number | null {
  if (!messageId) return null;
  const index = rows.findIndex((row) => row.id === messageId);
  return index < 0 ? null : index;
}
