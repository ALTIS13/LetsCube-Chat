import { mediaCacheBlob, mediaCacheIdentifier, mediaCacheLimit, snapshotMediaScope } from "./storage";
import type { MediaCacheLease, MediaCacheScope, MediaCacheStats, MediaCacheStorage } from "./storage";
export type { MediaCacheScope, MediaCacheStats, MediaCacheStorage } from "./storage";
export interface MediaCacheProducer { put(blob: Blob): Promise<boolean> }

const OPERATION_TIMEOUT_MS = 2000;
const unavailable = () => new Error("MEDIA_CACHE_UNAVAILABLE");
type LocalState = { epoch: symbol; chats: Map<string, symbol>; failed: Map<string | null, symbol>; barrier: Promise<void> };

/** No auth, URL, fetch or display policy lives here. Callers admit downloads. */
export function createMediaCache({ storage, now = Date.now }: { storage: MediaCacheStorage; now?: () => number }) {
  const owners = new Map<string, LocalState>();
  const writes = new Map<string, Promise<unknown>>();
  const stateFor = (partition: string) => {
    let state = owners.get(partition);
    if (!state) { state = { epoch: Symbol(), chats: new Map(), failed: new Map(), barrier: Promise.resolve() }; owners.set(partition, state); }
    return state;
  };
  const bounded = <T>(task: (live: () => boolean) => Promise<T>, fallback?: { value: T }): Promise<T> => new Promise((resolve, reject) => {
    let active = true;
    const fail = () => { if (!active) return; active = false; clearTimeout(timer); if (fallback) resolve(fallback.value); else reject(unavailable()); };
    const timer = setTimeout(fail, OPERATION_TIMEOUT_MS);
    void Promise.resolve().then(() => task(() => active)).then(value => {
      if (!active) return; active = false; clearTimeout(timer); resolve(value);
    }, fail);
  });
  const ticket = (input: MediaCacheScope) => {
    const scope = snapshotMediaScope(input), state = stateFor(scope.partition);
    const epoch = state.epoch, chatEpoch = state.chats.get(scope.chatId);
    return { scope, state, current: () => state.epoch === epoch && state.chats.get(scope.chatId) === chatEpoch &&
      !state.failed.has(null) && !state.failed.has(scope.chatId) };
  };
  const hash = async (blob: Blob) => {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  };
  const writeWithLease = (held: ReturnType<typeof ticket>, blob: Blob, preparedLease?: MediaCacheLease): Promise<boolean> => {
    try {
      if (!mediaCacheBlob(blob)) return Promise.resolve(false);
      const key = JSON.stringify(held.scope), previous = writes.get(key) ?? Promise.resolve();
      const operation = bounded(async live => {
        await held.state.barrier; if (!live() || !held.current()) return false;
        // A prepared download must keep its pre-fetch lease, never recapture
        // after a remote clear. Ordinary puts capture before the writer queue.
        const lease = preparedLease ?? await storage.capture(held.scope);
        await previous; if (!live() || !held.current()) return false;
        const digest = await hash(blob); if (!live() || !held.current()) return false;
        const result = await storage.write(lease, { blob, digest }, now(), () => live() && held.current());
        return result && live() && held.current();
      }, { value: false });
      writes.set(key, operation);
      void operation.then(() => { if (writes.get(key) === operation) writes.delete(key); });
      return operation;
    } catch { return Promise.resolve(false); }
  };
  return {
    get(input: MediaCacheScope): Promise<Blob | null> {
      try {
        const held = ticket(input);
        return bounded(async live => {
          await held.state.barrier; if (!live() || !held.current()) return null;
          const lease = await storage.capture(held.scope); if (!live() || !held.current()) return null;
          const row = await storage.read(lease, now()); if (!row || !live() || !held.current()) return null;
          const valid = mediaCacheBlob(row.blob) && await hash(row.blob) === row.digest;
          if (!live() || !held.current()) return null;
          const confirmed = await storage.confirm(lease, row.stamp, now(), valid);
          return valid && confirmed && live() && held.current() ? row.blob : null;
        }, { value: null });
      } catch { return Promise.resolve(null); }
    },
    put(input: MediaCacheScope, blob: Blob): Promise<boolean> {
      try { return writeWithLease(ticket(input), blob); }
      catch { return Promise.resolve(false); }
    },
    prepare(input: MediaCacheScope): Promise<MediaCacheProducer | null> {
      try {
        const held = ticket(input);
        return bounded(async live => {
          await held.state.barrier; if (!live() || !held.current()) return null;
          const lease = await storage.capture(held.scope);
          if (!live() || !held.current()) return null;
          return Object.freeze({ put: (blob: Blob) => writeWithLease(held, blob, lease) });
        }, { value: null });
      } catch { return Promise.resolve(null); }
    },
    retire(partition: string, chatId?: string): Promise<void> {
      try {
        mediaCacheIdentifier(partition); if (chatId !== undefined) mediaCacheIdentifier(chatId, 256);
        const state = stateFor(partition), failureKey = chatId ?? null;
        // This happens synchronously, before opening IDB or awaiting any task.
        if (chatId === undefined) { state.epoch = Symbol(); state.chats.clear(); }
        else state.chats.set(chatId, Symbol());
        const failure = Symbol();
        state.failed.set(failureKey, failure);
        const inheritedFailures = new Map(state.failed);
        const previous = state.barrier;
        const operation = bounded(async live => {
          await previous; if (!live()) throw unavailable();
          await storage.retire(partition, chatId); if (!live()) throw unavailable();
          // An older completion cannot clear a newer pending/failed retirement.
          for (const [key, marker] of inheritedFailures) {
            if ((chatId === undefined || key === failureKey) && state.failed.get(key) === marker) state.failed.delete(key);
          }
        });
        state.barrier = operation.catch(() => {});
        return operation;
      } catch { return Promise.reject(unavailable()); }
    },
    stats(partition: string): Promise<MediaCacheStats> {
      try { mediaCacheIdentifier(partition); return bounded(() => storage.stats(partition, now())); }
      catch { return Promise.reject(unavailable()); }
    },
    setLimit(partition: string, bytes: number): Promise<boolean> {
      try {
        mediaCacheIdentifier(partition); if (!mediaCacheLimit(bytes)) return Promise.resolve(false);
        return bounded(() => storage.setLimit(partition, bytes, now()), { value: false });
      } catch { return Promise.resolve(false); }
    },
  };
}
