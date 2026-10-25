export interface MediaCacheScope {
  partition: string;
  chatId: string;
  bucket: string;
  path: string;
  version?: string;
}

export interface MediaCacheStats { bytes: number; count: number; limitBytes: number }
export interface MediaCacheLease {
  readonly scope: Readonly<MediaCacheScope>;
  readonly partitionGeneration: string;
  readonly chatGeneration: string;
}
export interface MediaCacheEntry { blob: Blob; digest: string; stamp: string }
export interface MediaCacheStorage {
  capture(scope: MediaCacheScope): Promise<MediaCacheLease>;
  read(lease: MediaCacheLease, now: number): Promise<MediaCacheEntry | null>;
  confirm(lease: MediaCacheLease, stamp: string, now: number, valid: boolean): Promise<boolean>;
  write(lease: MediaCacheLease, value: { blob: Blob; digest: string }, now: number, isCurrent?: () => boolean): Promise<boolean>;
  retire(partition: string, chatId?: string): Promise<void>;
  stats(partition: string, now: number): Promise<MediaCacheStats>;
  setLimit(partition: string, bytes: number, now: number): Promise<boolean>;
}

const DEFAULT_LIMIT_BYTES = 128 * 1024 * 1024;
const GLOBAL_LIMIT_BYTES = 256 * 1024 * 1024;
const OBJECT_LIMIT_BYTES = 32 * 1024 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDB_TIMEOUT_MS = 1500;
const DB_NAME = "kub-media-cache";
const STORES = ["state", "metadata", "bodies"];
const unavailable = () => new Error("MEDIA_CACHE_UNAVAILABLE");
const requireValue = (valid: boolean): void => { if (!valid) throw unavailable(); };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const token = () => { const value = crypto.randomUUID(); requireValue(uuid(value)); return value; };
export function mediaCacheIdentifier(value: unknown, max = 2048): asserts value is string {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
}
export function snapshotMediaScope(input: MediaCacheScope): Readonly<MediaCacheScope> {
  requireValue(!!input && typeof input === "object");
  const { partition, chatId, bucket, path, version } = input;
  mediaCacheIdentifier(partition); mediaCacheIdentifier(chatId, 256); mediaCacheIdentifier(bucket, 64); mediaCacheIdentifier(path);
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bucket) && !/[\\?#]/.test(path));
  for (const part of path.split("/")) {
    const decoded = decodeURIComponent(part);
    requireValue(!!decoded && decoded !== "." && decoded !== ".." && !/[\\/?#:\u0000-\u001f\u007f]/.test(decoded));
  }
  if (version !== undefined) mediaCacheIdentifier(version, 128);
  return Object.freeze({ partition, chatId, bucket, path, ...(version === undefined ? {} : { version }) });
}
export const mediaCacheLimit = (bytes: number): boolean => [64 * 1024 * 1024, 128 * 1024 * 1024, 256 * 1024 * 1024].includes(bytes);
export const mediaCacheBlob = (blob: Blob): boolean => typeof Blob !== "undefined" && blob instanceof Blob &&
  blob.size > 0 && blob.size <= OBJECT_LIMIT_BYTES && blob.type.length <= 256 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?$/i.test(blob.type);
const time = (now: number) => requireValue(Number.isSafeInteger(now) && now >= 0);
const keyOf = (scope: MediaCacheScope) => JSON.stringify([scope.partition, scope.chatId, scope.bucket, scope.path, scope.version ?? null]);
const partitionKey = (partition: string) => JSON.stringify(["partition", partition]);
const chatKey = (scope: Pick<MediaCacheScope, "partition" | "chatId">) => JSON.stringify(["chat", scope.partition, scope.chatId]);
const rangeOf = (parts: string[]) => { const prefix = JSON.stringify(parts).slice(0, -1) + ","; return IDBKeyRange.bound(prefix, prefix + "\uffff", false, true); };
interface PartitionRow { key: string; generation: string; limitBytes: number }
interface ChatRow { key: string; generation: string }
interface Metadata { key: string; scope: MediaCacheScope; digest: string; stamp: string; bytes: number; mime: string; storedAt: number; access: number }
type Tables = { state: IDBObjectStore; metadata: IDBObjectStore; bodies: IDBObjectStore };
type Watch = <T>(request: IDBRequest<T>, accept: (value: T) => void) => void;
function metadataValid(row: Metadata): boolean {
  try {
    return !!row && row.key === keyOf(snapshotMediaScope(row.scope)) && uuid(row.stamp) && /^[a-f0-9]{64}$/.test(row.digest) &&
      Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= OBJECT_LIMIT_BYTES && typeof row.mime === "string" &&
      Number.isSafeInteger(row.storedAt) && row.storedAt >= 0 && Number.isSafeInteger(row.access) && row.access > 0;
  } catch { return false; }
}
const fresh = (row: Metadata, now: number) => row.storedAt <= now && now - row.storedAt < TTL_MS;
const discard = (tables: Tables, key: IDBValidKey) => { tables.metadata.delete(key); tables.bodies.delete(key); };

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let stopped = false;
    const fail = () => { stopped = true; clearTimeout(timer); reject(unavailable()); };
    const timer = setTimeout(fail, IDB_TIMEOUT_MS);
    let request: IDBOpenDBRequest;
    try { request = factory.open(DB_NAME, 1); } catch { fail(); return; }
    request.onerror = request.onblocked = fail;
    request.onupgradeneeded = () => {
      try {
        if (stopped) { request.transaction?.abort(); return; }
        request.result.createObjectStore("state", { keyPath: "key" });
        const metadata = request.result.createObjectStore("metadata", { keyPath: "key" });
        metadata.createIndex("partition", "scope.partition");
        metadata.createIndex("lru", "access");
        request.result.createObjectStore("bodies", { keyPath: "key" });
      } catch { request.transaction?.abort(); fail(); }
    };
    request.onsuccess = () => { clearTimeout(timer); if (stopped) request.result.close(); else resolve(request.result); };
  });
}

/** Separate metadata and Blob stores: pruning never materializes a Blob set.
 * A successful operation is acknowledged only by IDBTransaction.complete. */
export function browserMediaCacheStorage(factory: IDBFactory | undefined = globalThis.indexedDB): MediaCacheStorage {
  let database: Promise<IDBDatabase> | null = null;
  const transact = async <T>(mode: IDBTransactionMode, run: (tables: Tables, watch: Watch, set: (value: T) => void) => void): Promise<T> => {
    if (!factory) throw unavailable();
    database ??= openDatabase(factory).then(db => {
      db.onversionchange = () => { db.close(); database = null; };
      db.onclose = () => { database = null; };
      return db;
    }).catch(() => { database = null; throw unavailable(); });
    const db = await database;
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(STORES, mode); } catch { database = null; reject(unavailable()); return; }
      let value: T;
      const timer = setTimeout(() => { try { tx.abort(); } catch { /* Already inactive. */ } reject(unavailable()); }, IDB_TIMEOUT_MS);
      const fail = () => { try { tx.abort(); } catch { /* Already inactive. */ } clearTimeout(timer); reject(unavailable()); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(unavailable()); };
      tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
      const watch: Watch = (request, accept) => {
        request.onerror = fail;
        request.onsuccess = () => { try { accept(request.result); } catch { fail(); } };
      };
      try { run({ state: tx.objectStore("state"), metadata: tx.objectStore("metadata"), bodies: tx.objectStore("bodies") }, watch, next => { value = next; }); }
      catch { fail(); }
    });
  };
  const partition = (tables: Tables, watch: Watch, name: string, create: boolean, accept: (row: PartitionRow | null) => void) => {
    watch(tables.state.get(partitionKey(name)), (row: PartitionRow | undefined) => {
      if (!row && !create) { accept(null); return; }
      const result = row ?? { key: partitionKey(name), generation: token(), limitBytes: DEFAULT_LIMIT_BYTES };
      requireValue(uuid(result.generation) && mediaCacheLimit(result.limitBytes));
      if (!row) tables.state.put(result);
      accept(result);
    });
  };
  const current = (tables: Tables, watch: Watch, lease: MediaCacheLease, accept: (row: PartitionRow | null) => void) => {
    partition(tables, watch, lease.scope.partition, false, owner => {
      if (!owner || owner.generation !== lease.partitionGeneration) { accept(null); return; }
      watch(tables.state.get(chatKey(lease.scope)), (chat: ChatRow | undefined) => accept(chat?.generation === lease.chatGeneration ? owner : null));
    });
  };
  const leaseCopy = (lease: MediaCacheLease): MediaCacheLease => {
    const scope = snapshotMediaScope(lease.scope);
    requireValue(uuid(lease.partitionGeneration) && uuid(lease.chatGeneration));
    return { scope, partitionGeneration: lease.partitionGeneration, chatGeneration: lease.chatGeneration };
  };
  const tick = (tables: Tables, watch: Watch, accept: (access: number) => void) => {
    watch(tables.state.get("clock"), (row: { value: number } | undefined) => {
      const value = (row?.value ?? 0) + 1;
      requireValue(Number.isSafeInteger(value) && value > 0);
      tables.state.put({ key: "clock", value }); accept(value);
    });
  };
  const prune = (tables: Tables, rows: Metadata[], now: number) => rows.filter(row => {
    if (metadataValid(row) && fresh(row, now)) return true;
    discard(tables, row.key); return false;
  });
  const trim = (tables: Tables, rows: Metadata[], name: string, limit: number) => {
    rows.sort((a, b) => a.access - b.access || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    let owned = rows.filter(row => row.scope.partition === name).reduce((sum, row) => sum + row.bytes, 0);
    const retained = rows.filter(row => {
      if (owned <= limit || row.scope.partition !== name) return true;
      owned -= row.bytes; discard(tables, row.key); return false;
    });
    let global = retained.reduce((sum, row) => sum + row.bytes, 0);
    return retained.filter(row => {
      if (global <= GLOBAL_LIMIT_BYTES) return true;
      global -= row.bytes; discard(tables, row.key); return false;
    });
  };
  return {
    async capture(input) {
      const scope = snapshotMediaScope(input);
      return transact<MediaCacheLease>("readwrite", (tables, watch, set) => {
        partition(tables, watch, scope.partition, true, owner => {
          watch(tables.state.get(chatKey(scope)), (row: ChatRow | undefined) => {
            const generation = row?.generation ?? token(); requireValue(uuid(generation));
            if (!row) tables.state.put({ key: chatKey(scope), generation });
            set(Object.freeze({ scope, partitionGeneration: owner!.generation, chatGeneration: generation }));
          });
        });
      });
    },
    async read(held, now) {
      const lease = leaseCopy(held), key = keyOf(lease.scope); time(now);
      return transact<MediaCacheEntry | null>("readwrite", (tables, watch, set) => {
        current(tables, watch, lease, owner => {
          if (!owner) { set(null); return; }
          watch(tables.metadata.get(key), (row: Metadata | undefined) => {
            if (!row || !metadataValid(row) || row.key !== key || !fresh(row, now)) { discard(tables, key); set(null); return; }
            watch(tables.bodies.get(key), (body: { key: string; data: ArrayBuffer } | undefined) => {
              if (!body || body.key !== key || !(body.data instanceof ArrayBuffer) || body.data.byteLength !== row.bytes) {
                discard(tables, key); set(null); return;
              }
              const blob = new Blob([body.data], { type: row.mime });
              if (!mediaCacheBlob(blob) || blob.type !== row.mime) { discard(tables, key); set(null); return; }
              set({ blob, digest: row.digest, stamp: row.stamp });
            });
          });
        });
      });
    },
    async confirm(held, stamp, now, valid) {
      const lease = leaseCopy(held), key = keyOf(lease.scope); time(now); requireValue(uuid(stamp));
      return transact<boolean>("readwrite", (tables, watch, set) => {
        current(tables, watch, lease, owner => {
          if (!owner) { set(false); return; }
          watch(tables.metadata.get(key), (row: Metadata | undefined) => {
            if (!row || row.stamp !== stamp) { set(false); return; }
            if (!valid || !metadataValid(row) || !fresh(row, now)) { discard(tables, key); set(false); return; }
            tick(tables, watch, access => { tables.metadata.put({ ...row, access }); set(true); });
          });
        });
      });
    },
    async write(held, value, now, isCurrent = () => true) {
      const lease = leaseCopy(held), scope = lease.scope; time(now);
      if (!value || !mediaCacheBlob(value.blob) || !/^[a-f0-9]{64}$/.test(value.digest)) return false;
      // ArrayBuffer also commits on WebKit ports where structured-cloned Blob
      // transactions abort. Only one object's bytes are materialized at a time.
      const data = await value.blob.arrayBuffer();
      if (!isCurrent()) return false;
      requireValue(data.byteLength === value.blob.size);
      const base = { key: keyOf(scope), scope, stamp: token(), digest: value.digest, bytes: value.blob.size, mime: value.blob.type, storedAt: now };
      return transact<boolean>("readwrite", (tables, watch, set) => {
        current(tables, watch, lease, owner => {
          if (!owner) { set(false); return; }
          watch(tables.metadata.getAll(), (all: Metadata[]) => {
            const rows = prune(tables, all, now).filter(row => row.key !== base.key);
            tick(tables, watch, access => {
              requireValue(isCurrent());
              const row = { ...base, access };
              const kept = trim(tables, [...rows, row], scope.partition, owner.limitBytes).some(item => item.key === row.key);
              if (kept) { tables.metadata.put(row); tables.bodies.put({ key: row.key, data }); }
              set(kept);
            });
          });
        });
      });
    },
    async retire(name, chatId) {
      mediaCacheIdentifier(name); if (chatId !== undefined) mediaCacheIdentifier(chatId, 256);
      await transact<void>("readwrite", (tables, watch, set) => {
        partition(tables, watch, name, true, owner => {
          if (chatId === undefined) {
            tables.state.put({ ...owner!, generation: token() });
            tables.state.delete(rangeOf(["chat", name]));
          } else tables.state.put({ key: chatKey({ partition: name, chatId }), generation: token() });
          // Primary-key ranges also remove rows with corrupted secondary indexes.
          const range = rangeOf(chatId === undefined ? [name] : [name, chatId]);
          tables.metadata.delete(range); tables.bodies.delete(range); set(undefined);
        });
      });
    },
    async stats(name, now) {
      mediaCacheIdentifier(name); time(now);
      return transact<MediaCacheStats>("readwrite", (tables, watch, set) => {
        partition(tables, watch, name, false, owner => {
          watch(tables.metadata.getAll(rangeOf([name])), (all: Metadata[]) => {
            const rows = prune(tables, all, now);
            set({ bytes: rows.reduce((sum, row) => sum + row.bytes, 0), count: rows.length, limitBytes: owner?.limitBytes ?? DEFAULT_LIMIT_BYTES });
          });
        });
      });
    },
    async setLimit(name, bytes, now) {
      mediaCacheIdentifier(name); time(now); if (!mediaCacheLimit(bytes)) return false;
      return transact<boolean>("readwrite", (tables, watch, set) => {
        partition(tables, watch, name, true, owner => {
          tables.state.put({ ...owner!, limitBytes: bytes });
          watch(tables.metadata.getAll(), (all: Metadata[]) => { trim(tables, prune(tables, all, now), name, bytes); set(true); });
        });
      });
    },
  };
}
