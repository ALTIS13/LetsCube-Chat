const CLEARED_AT_REUSE_MS = 3_000;

type MembershipMark = { chat_id: string; cleared_at: string | null };
type MembershipRead = { startedAt: number; generation: number };
type DirectRead = { value: string | null; ok: boolean };

export class ClearedAtCache {
  private answers = new Map<string, { value: string | null; at: number }>();
  private pending = new Map<string, Promise<string | null | undefined>>();
  private generation = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private key(chatId: string, userId: string) {
    return `${chatId}:${userId}`;
  }

  beginMembershipRead(): MembershipRead {
    return { startedAt: this.now(), generation: this.generation };
  }

  seedFromMembershipRead(userId: string, rows: readonly MembershipMark[], read: MembershipRead) {
    if (read.generation !== this.generation || this.now() - read.startedAt >= CLEARED_AT_REUSE_MS) return;
    for (const row of rows) {
      const key = this.key(row.chat_id, userId);
      const held = this.answers.get(key);
      if (held && held.at >= read.startedAt) continue;
      this.answers.set(key, { value: row.cleared_at, at: read.startedAt });
    }
  }

  hasFresh(chatId: string, userId: string): boolean {
    const answer = this.answers.get(this.key(chatId, userId));
    return Boolean(answer && this.now() - answer.at < CLEARED_AT_REUSE_MS);
  }

  getOrLoad(chatId: string, userId: string, load: () => Promise<DirectRead>): Promise<string | null | undefined> {
    const key = this.key(chatId, userId);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const answer = this.answers.get(key);
    if (answer && this.now() - answer.at < CLEARED_AT_REUSE_MS) return Promise.resolve(answer.value);

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
      if (newer && newer.at > startedAt && this.now() - newer.at < CLEARED_AT_REUSE_MS) return newer.value;
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
