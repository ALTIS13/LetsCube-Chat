/**
 * Messages hidden «for me» on another device, heard as they happen (tracker
 * item 58), so coming back to a conversation need not read them again.
 *
 * The tester, 2026-09-28: «из чата с тобой захожу в другой, потом
 * возвращаюсь к тебе и секунду жду прогрузки, а зачем? Если кэш существует».
 * The last round trip on the way back was the hidden ids of the rows already
 * held: a hide made elsewhere could not be heard, so every return asked.
 * `20260928220000_hides_heard_live.sql` broadcasts each hide and unhide on the
 * account's own private topic, `hides:<id>`, and this module decides when that
 * channel may be trusted in place of the read.
 *
 * Trusted is narrower than joined. A channel is live only once its own ping —
 * `hides_live_ping`, sent through the same database path as a hide — has come
 * back through it, so a channel that reports SUBSCRIBED while the database's
 * broadcasts do not reach it never stands in for a read. Any gap ends it. A
 * return skips the read only when every row it holds, and every row those
 * reply to, was verified by a read that began while the channel was live, or
 * arrived live after that; anything else is read as before. An unhide forgets
 * the chat, so its message is read back.
 *
 * Imports nothing, so `tests/unit/hidden-messages-live.test.mts` reaches it
 * directly.
 */

export type HideEvent = { chatId: string; messageId: string; hidden: boolean };

/** The payload the database broadcasts, or null for anything else. */
export function readHideEvent(payload: unknown): HideEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const messageId = typeof row.message_id === "string" && row.message_id ? row.message_id : null;
  const chatId = typeof row.chat_id === "string" && row.chat_id ? row.chat_id : null;
  if (!messageId || !chatId || typeof row.hidden !== "boolean") return null;
  return { chatId, messageId, hidden: row.hidden };
}

export class HiddenMessagesLive {
  private liveSince: number | null = null;
  private awaitingPing = false;
  private verified = new Map<string, { since: number; ids: Set<string> }>();
  private listeners = new Set<(event: HideEvent) => void>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The channel joined. It is live once its own ping comes back through it. */
  joined(): void {
    this.liveSince = null;
    this.awaitingPing = true;
  }

  /** The ping sent after the join came back: broadcasts reach this client. */
  pingReturned(): void {
    if (!this.awaitingPing) return;
    this.awaitingPing = false;
    this.liveSince = this.now();
  }

  /** Left, refused, timed out, offline or found dead: nothing is trusted until the next ping. */
  lost(): void {
    this.liveSince = null;
    this.awaitingPing = false;
  }

  isLive(): boolean {
    return this.liveSince !== null;
  }

  /**
   * The hidden state of these rows was read by a request that began at
   * `readStartedAt`. It counts only if the channel was already live then: a
   * hide made between an older read and the join was never heard.
   */
  markVerified(chatId: string, ids: Iterable<string>, readStartedAt: number): void {
    if (this.liveSince === null || readStartedAt < this.liveSince) return;
    const entry = this.verified.get(chatId);
    if (!entry || entry.since < this.liveSince) {
      this.verified.set(chatId, { since: readStartedAt, ids: new Set(ids) });
      return;
    }
    for (const id of ids) entry.ids.add(id);
  }

  /** Whether a return may draw these rows without reading their hidden ids again. */
  canSkip(chatId: string, ids: readonly string[]): boolean {
    if (this.liveSince === null) return false;
    const entry = this.verified.get(chatId);
    if (!entry || entry.since < this.liveSince) return false;
    return ids.every((id) => entry.ids.has(id));
  }

  /** A hide or unhide heard on the channel. An unhide forgets its chat, so its message is read back. */
  heard(event: HideEvent): void {
    if (!event.hidden) this.verified.delete(event.chatId);
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: HideEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const hiddenMessagesLive = new HiddenMessagesLive();
