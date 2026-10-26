export interface HistoryCacheLease {
  readonly namespace: string;
  readonly ownerId: string;
  readonly generation: string;
}

export interface HistoryCacheValue {
  payload: string;
  digest: string;
  verifiedAt: number;
}

export interface HistoryCacheStorage {
  capture(namespace: string, ownerId: string): Promise<HistoryCacheLease>;
  read(lease: HistoryCacheLease, scope: string, now?: number): Promise<HistoryCacheValue | null>;
  write(lease: HistoryCacheLease, scope: string, value: Pick<HistoryCacheValue, "payload" | "digest">, now: number | (() => number)): Promise<boolean>;
  invalidate(namespace: string, ownerId: string, scope?: string): Promise<void>;
  invalidatePrefix?(namespace: string, ownerId: string, prefix: string): Promise<void>;
}

interface OwnerRow { key: string; generation: string }
interface ScopeRow extends HistoryCacheValue { key: string; ownerKey: string; scope: string }

const DB_NAME = "kub-history-cache";
const STORE = "records";
const MAX_SCOPES = 10;
const MAX_BYTES = 8 * 1024 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_IDENTIFIER_LENGTH = 1024;
const encoder = new TextEncoder();
const unavailable = () => new Error("HISTORY_CACHE_STORAGE_UNAVAILABLE");
const invalid = () => new Error("HISTORY_CACHE_INVALID_INPUT");
const ownerKey = (namespace: string, ownerId: string) => JSON.stringify(["owner", namespace, ownerId]);
const scopeKey = (namespace: string, ownerId: string, scope: string) => JSON.stringify(["scope", namespace, ownerId, scope]);
const validGeneration = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

function newGeneration(): string {
  // A counter can repeat after database deletion. Each owner incarnation and
  // invalidation needs fresh entropy, including when no owner row survives.
  const token = globalThis.crypto.randomUUID();
  if (!validGeneration(token)) throw unavailable();
  return token;
}

function identifier(value: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_IDENTIFIER_LENGTH) throw invalid();
}

function snapshotLease(lease: HistoryCacheLease, scope: string, now: number): HistoryCacheLease {
  if (!lease) throw invalid();
  const { namespace, ownerId, generation } = lease;
  if (!validGeneration(generation)) throw invalid();
  identifier(namespace); identifier(ownerId); identifier(scope);
  if (!Number.isSafeInteger(now) || now < 0) throw invalid();
  return { namespace, ownerId, generation };
}

// Charge serialized UTF8 including keys/index copies, plus a conservative 1KiB
// per record. This is an application bound, not a claim about engine disk usage.
function rowBytes(row: OwnerRow | ScopeRow): number {
  return encoder.encode(JSON.stringify(row)).byteLength + encoder.encode(row.key).byteLength
    + ("ownerKey" in row ? encoder.encode(row.ownerKey).byteLength : 0) + 1024;
}

function validRow(row: ScopeRow, key: string, owner: string): boolean {
  return !!row && row.key === key && row.ownerKey === owner && typeof row.scope === "string"
    && row.scope.length > 0 && row.scope.length <= MAX_IDENTIFIER_LENGTH && !!row.scope.trim()
    && typeof row.payload === "string" && typeof row.digest === "string" && /^[0-9a-f]{64}$/.test(row.digest)
    && Number.isSafeInteger(row.verifiedAt) && row.verifiedAt >= 0 && rowBytes(row) <= MAX_BYTES;
}

function ownerScopeRows(store: IDBObjectStore, namespace: string, ownerId: string): IDBRequest<ScopeRow[]> {
  // Primary-key ownership cannot be hidden or widened by corrupt row/index
  // metadata. The range also includes malformed suffixes that must be pruned.
  const prefix = JSON.stringify(["scope", namespace, ownerId]).slice(0, -1) + ",";
  const range = IDBKeyRange.bound(prefix, prefix + "\uffff", false, true);
  return store.getAll(range) as IDBRequest<ScopeRow[]>;
}

function canonicalScopeRow(row: ScopeRow, namespace: string, ownerId: string): boolean {
  try {
    const key: unknown = JSON.parse(row.key);
    return Array.isArray(key) && key.length === 4 && key[0] === "scope" && key[1] === namespace && key[2] === ownerId
      && typeof key[3] === "string" && row.scope === key[3] && row.key === scopeKey(namespace, ownerId, key[3])
      && validRow(row, row.key, ownerKey(namespace, ownerId));
  } catch { return false; }
}

async function matchesDigest(payload: string, digest: string): Promise<boolean> {
  try {
    const result = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(payload));
    const actual = Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
    return actual === digest;
  } catch { return false; }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let refused = false;
    const fail = () => { refused = true; reject(unavailable()); };
    const request = factory.open(DB_NAME, 1);
    request.onerror = request.onblocked = fail;
    request.onupgradeneeded = () => {
      try {
        if (refused) { request.transaction?.abort(); return; }
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("ownerKey", "ownerKey");
      } catch { request.transaction?.abort(); fail(); }
    };
    request.onsuccess = () => { if (refused) request.result.close(); else resolve(request.result); };
  });
}

type RequestHandler = <T>(request: IDBRequest<T>, accept: (value: T) => void) => void;

/** No memory fallback. Acknowledgement means tx.complete, including generation
 * updates and all row deletions in the same store's readwrite transaction. */
export function browserHistoryCacheStorage(factory: IDBFactory | undefined = globalThis.indexedDB): HistoryCacheStorage {
  let database: Promise<IDBDatabase> | null = null;
  const transact = async <T>(mode: IDBTransactionMode,
    run: (store: IDBObjectStore, request: RequestHandler, set: (value: T) => void) => void): Promise<T> => {
    try {
      if (!factory) throw unavailable();
      database ??= openDatabase(factory).then(handle => {
        handle.onversionchange = () => { handle.close(); database = null; };
        handle.onclose = () => { database = null; };
        return handle;
      }).catch(() => { database = null; throw unavailable(); });
      const db = await database;
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let value: T;
        const fail = () => { try { tx.abort(); } catch { /* Already inactive. */ } reject(unavailable()); };
        tx.onabort = tx.onerror = () => reject(unavailable());
        tx.oncomplete = () => resolve(value);
        const request: RequestHandler = (req, accept) => {
          req.onerror = fail;
          req.onsuccess = () => { try { accept(req.result); } catch { fail(); } };
        };
        try { run(tx.objectStore(STORE), request, next => { value = next; }); }
        catch { fail(); }
      });
    } catch { throw unavailable(); }
  };

  const generation = (row: OwnerRow | undefined): string => {
    if (!row || !validGeneration(row.generation)) throw unavailable();
    return row.generation;
  };
  const current = (lease: HistoryCacheLease) => transact<boolean>("readonly", (store, request, set) => {
    request(store.get(ownerKey(lease.namespace, lease.ownerId)), row => set(generation(row) === lease.generation));
  });

  return {
    async capture(namespace, ownerId) {
      identifier(namespace); identifier(ownerId);
      const key = ownerKey(namespace, ownerId);
      return transact<HistoryCacheLease>("readwrite", (store, request, set) => {
        request(store.get(key), (row: OwnerRow | undefined) => {
          const next = row ? generation(row) : newGeneration();
          if (!row) store.put({ key, generation: next });
          set(Object.freeze({ namespace, ownerId, generation: next }));
        });
      });
    },

    async read(lease, scope, now = Date.now()) {
      lease = snapshotLease(lease, scope, now);
      const owner = ownerKey(lease.namespace, lease.ownerId), key = scopeKey(lease.namespace, lease.ownerId, scope);
      const row = await transact<ScopeRow | null>("readonly", (store, request, set) => {
        request(store.get(owner), (ownerRow: OwnerRow | undefined) => {
          if (!ownerRow || generation(ownerRow) !== lease.generation) { set(null); return; }
          request(store.get(key), (stored: ScopeRow | undefined) => set(stored ?? null));
        });
      });
      if (!row || !validRow(row, key, owner) || row.scope !== scope || row.verifiedAt > now
        || now - row.verifiedAt >= TTL_MS || !await matchesDigest(row.payload, row.digest)) return null;
      // Hashing yields to another document; do not return data invalidated there.
      if (!await current(lease)) return null;
      return { payload: row.payload, digest: row.digest, verifiedAt: row.verifiedAt };
    },

    async write(lease, scope, value, now) {
      if (typeof now !== "number" && typeof now !== "function") throw invalid();
      const clock = typeof now === "function" ? now : null;
      lease = snapshotLease(lease, scope, typeof now === "number" ? now : 0);
      if (!value || typeof value.payload !== "string" || typeof value.digest !== "string"
        || !/^[0-9a-f]{64}$/i.test(value.digest)) return false;
      const owner = ownerKey(lease.namespace, lease.ownerId);
      const row: ScopeRow = { key: scopeKey(lease.namespace, lease.ownerId, scope), ownerKey: owner,
        scope, payload: value.payload, digest: value.digest.toLowerCase(), verifiedAt: typeof now === "number" ? now : 0 };
      const overhead = rowBytes({ key: owner, generation: lease.generation });
      if (rowBytes(row) + overhead > MAX_BYTES || !await matchesDigest(row.payload, row.digest)) return false;
      return transact<boolean>("readwrite", (store, request, set) => {
        request(store.get(owner), (ownerRow: OwnerRow | undefined) => {
          if (!ownerRow || generation(ownerRow) !== lease.generation) { set(false); return; }
          // The exclusive transaction is active now. Another document may have
          // committed while digest/lock acquisition awaited; that is not rollback.
          if (clock) row.verifiedAt = clock();
          snapshotLease(lease, scope, row.verifiedAt);
          if (rowBytes(row) + overhead > MAX_BYTES) { set(false); return; }
          const writeNow = row.verifiedAt;
          request(ownerScopeRows(store, lease.namespace, lease.ownerId), (rows: ScopeRow[]) => {
            const retained: ScopeRow[] = [];
            const prune: string[] = [];
            for (const item of rows) {
              if (!canonicalScopeRow(item, lease.namespace, lease.ownerId) || writeNow - item.verifiedAt >= TTL_MS) {
                prune.push(item.key); continue;
              }
              if (item.verifiedAt > writeNow) { set(false); return; }
              if (item.key !== row.key) retained.push(item);
            }
            for (const key of prune) store.delete(key);
            retained.push(row);
            retained.sort((a, b) => a.verifiedAt - b.verifiedAt || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
            let bytes = overhead + retained.reduce((sum, item) => sum + rowBytes(item), 0);
            while (retained.length > MAX_SCOPES || bytes > MAX_BYTES) {
              const evicted = retained.shift()!;
              bytes -= rowBytes(evicted); store.delete(evicted.key);
            }
            const kept = retained.includes(row);
            if (kept) store.put(row);
            set(kept);
          });
        });
      });
    },

    async invalidate(namespace, ownerId, scope) {
      identifier(namespace); identifier(ownerId);
      if (scope !== undefined) identifier(scope);
      const key = ownerKey(namespace, ownerId);
      await transact<void>("readwrite", (store, request, set) => {
        request(store.get(key), () => {
          const next = newGeneration();
          store.put({ key, generation: next });
          if (scope !== undefined) store.delete(scopeKey(namespace, ownerId, scope));
          else request(ownerScopeRows(store, namespace, ownerId), (rows: ScopeRow[]) => {
            for (const item of rows) store.delete(item.key);
          });
          set(undefined);
        });
      });
    },

    async invalidatePrefix(namespace, ownerId, prefix) {
      identifier(namespace); identifier(ownerId); identifier(prefix);
      const key = ownerKey(namespace, ownerId);
      await transact<void>("readwrite", (store, request, set) => {
        store.put({ key, generation: newGeneration() });
        request(ownerScopeRows(store, namespace, ownerId), (rows: ScopeRow[]) => {
          for (const row of rows) if (!canonicalScopeRow(row, namespace, ownerId) || row.scope.startsWith(prefix)) store.delete(row.key);
          set(undefined);
        });
      });
    },
  };
}
