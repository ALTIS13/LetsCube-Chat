const CLEARED_AT_REUSE_MS = 3_000;

type MembershipMark = { chat_id: string; cleared_at: string | null };
type MembershipRead = { startedAt: number; generation: number };
type DirectRead = { value: string | null; ok: boolean };

export class ClearedAtCache {
  private answers = new Map<string, { value: string | null; at: number }>();
  private pending = new Map<string, Promise<string | null | undefined>>();
  private generation = 0;
  /**
   * Since when this client's own membership rows have been heard live, or null
   * while they are not (tracker item 58).
   *
   * Coming back to a conversation read its «cleared for me» mark again before
   * drawing anything, and then the hidden ids — two round trips in a row, the
   * second the tester felt: «из чата с тобой захожу в другой, потом
   * возвращаюсь к тебе и секунду жду прогрузки». But the mark only changes by
   * an UPDATE of this user's own `chat_members` row, and `useChats` hears
   * every one of those on `chat-members:user:<id>` and evicts the chat here.
   * So an answer read while that channel was joined, and still joined since,
   * cannot be stale without an eviction having removed it: it stays usable
   * past the three seconds, for as long as the channel stays up. A join after
   * any gap starts the clock again — whatever changed during the gap was not
   * heard — and so does a revival (`realtimeRevival.ts`), which is how a
   * socket that died without saying so is found.
   */
  private liveSince: number | null = null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private key(chatId: string, userId: string) {
    return `${chatId}:${userId}`;
  }

  /** The own-membership channel joined (true), or left, failed or was found dead (false). */
  setLive(live: boolean) {
    this.liveSince = live ? this.now() : null;
  }

  private usable(answer: { at: number }) {
    if (this.now() - answer.at < CLEARED_AT_REUSE_MS) return true;
    return this.liveSince !== null && answer.at >= this.liveSince;
  }

  beginMembershipRead(): MembershipRead {
    return { startedAt: this.now(), generation: this.generation };
  }

  seedFromMembershipRead(userId: string, rows: readonly MembershipMark[], read: MembershipRead) {
    if (read.generation !== this.generation || !this.usable({ at: read.startedAt })) return;
    for (const row of rows) {
      const key = this.key(row.chat_id, userId);
      const held = this.answers.get(key);
      if (held && held.at >= read.startedAt) continue;
      this.answers.set(key, { value: row.cleared_at, at: read.startedAt });
    }
  }

  hasFresh(chatId: string, userId: string): boolean {
    const answer = this.answers.get(this.key(chatId, userId));
    return Boolean(answer && this.usable(answer));
  }

  getOrLoad(chatId: string, userId: string, load: () => Promise<DirectRead>): Promise<string | null | undefined> {
    const key = this.key(chatId, userId);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const answer = this.answers.get(key);
    if (answer && this.usable(answer)) return Promise.resolve(answer.value);

    const startedAt = this.now();
    const generation = this.generation;
    let request: Promise<string | null | undefined>;
    request = (async () => {
      const result = await load();
      if (generation !== this.generation) {
        this.pending.delete(key);
        return this.getOrLoad(chatId, userId, load);
      }
      const newer = this.answers.get(key);
      if (newer && newer.at > startedAt && this.usable(newer)) return newer.value;
      if (!result.ok) return undefined;
      this.answers.set(key, { value: result.value, at: startedAt });
      return result.value;
    })().finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  evictChat(chatId: string) {
    this.generation += 1;
    const prefix = `${chatId}:`;
    for (const key of this.answers.keys()) if (key.startsWith(prefix)) this.answers.delete(key);
    for (const key of this.pending.keys()) if (key.startsWith(prefix)) this.pending.delete(key);
  }
}

export const clearedAtCache = new ClearedAtCache();
