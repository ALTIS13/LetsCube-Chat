/**
 * Where waiting messages are kept so that a restart does not lose them
 * (tracker item 52).
 *
 * IndexedDB, because it is the one store every engine this product ships in —
 * Safari in the installed iPhone app, Android's WebView, WebView2 on Windows —
 * keeps across a restart. Where it cannot be opened, the caller keeps the
 * failed local message but must not claim that it is saved for a restart.
 */

import type { OutboxEntry } from "./outboxRules.ts";
import { idbTransaction } from "./idbTransaction.ts";

export interface OutboxStorage {
  put(entry: OutboxEntry): Promise<void>;
  remove(clientMessageId: string): Promise<void>;
  list(userId: string): Promise<OutboxEntry[]>;
}

export function memoryOutboxStorage(): OutboxStorage {
  const entries = new Map<string, OutboxEntry>();
  return {
    async put(entry) {
      entries.set(entry.clientMessageId, structuredClone(entry));
    },
    async remove(clientMessageId) {
      entries.delete(clientMessageId);
    },
    async list(userId) {
      return [...entries.values()].filter((entry) => entry.userId === userId).map((entry) => structuredClone(entry));
    },
  };
}

const DB_NAME = "kub-outbox";
const DB_VERSION = 1;
const STORE = "entries";

const unavailable = () => Object.assign(new Error("OUTBOX_STORAGE_UNAVAILABLE"), { code: "OUTBOX_STORAGE_UNAVAILABLE" });

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let refused = false;
    const fail = () => { refused = true; reject(unavailable()); };
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientMessageId" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
    open.onsuccess = () => { if (refused) open.result.close(); else resolve(open.result); };
    open.onerror = open.onblocked = fail;
  });
}

/**
 * A successful operation means the transaction committed, not just its request.
 * Unavailable storage rejects; it must not masquerade as a durable memory copy.
 */
export function browserOutboxStorage(factory: IDBFactory | undefined = globalThis.indexedDB): OutboxStorage {
  let database: Promise<IDBDatabase> | null = null;
  const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    if (!factory) throw unavailable();
    try {
      database ??= openDatabase(factory).then((handle) => {
        handle.onversionchange = () => { handle.close(); database = null; };
        handle.onclose = () => { database = null; };
        return handle;
      }).catch(() => { database = null; throw unavailable(); });
      const handle = await database;
      return await idbTransaction(handle, STORE, mode, run);
    } catch {
      throw unavailable();
    }
  };

  return {
    async put(entry) {
      await withStore("readwrite", (store) => store.put(entry));
    },
    async remove(clientMessageId) {
      await withStore("readwrite", (store) => store.delete(clientMessageId));
    },
    async list(userId) {
      return withStore("readonly", (store) => store.index("userId").getAll(userId) as IDBRequest<OutboxEntry[]>);
    },
  };
}
