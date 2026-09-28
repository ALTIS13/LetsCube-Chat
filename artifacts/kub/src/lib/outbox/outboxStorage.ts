/**
 * Where waiting messages are kept so that a restart does not lose them
 * (tracker item 52).
 *
 * IndexedDB, because it is the one store every engine this product ships in —
 * Safari in the installed iPhone app, Android's WebView, WebView2 on Windows —
 * keeps across a restart, and because a voice note's bytes will live here too,
 * which `localStorage` cannot hold. Where it cannot be opened — a private
 * window, storage refused — the outbox still works in memory for the life of
 * the page, which is what it did before this existed.
 */

import type { OutboxEntry } from "./outboxRules.ts";

export interface OutboxStorage {
  put(entry: OutboxEntry): Promise<void>;
  remove(clientMessageId: string): Promise<void>;
  list(userId: string): Promise<OutboxEntry[]>;
}

export function memoryOutboxStorage(): OutboxStorage {
  const entries = new Map<string, OutboxEntry>();
  return {
    async put(entry) {
      entries.set(entry.clientMessageId, { ...entry });
    },
    async remove(clientMessageId) {
      entries.delete(clientMessageId);
    },
    async list(userId) {
      return [...entries.values()].filter((entry) => entry.userId === userId).map((entry) => ({ ...entry }));
    },
  };
}

const DB_NAME = "kub-outbox";
const DB_VERSION = 1;
const STORE = "entries";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientMessageId" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("outbox database blocked"));
  });
}

/**
 * The persistent store, falling back to memory the first time IndexedDB fails
 * and staying there: a store that works for one write and fails the next would
 * lose exactly the messages it was asked to keep.
 */
export function browserOutboxStorage(factory: IDBFactory | undefined = globalThis.indexedDB): OutboxStorage {
  const memory = memoryOutboxStorage();
  let database: Promise<IDBDatabase> | null = null;
  let failed = !factory;

  const db = (): Promise<IDBDatabase> | null => {
    if (failed || !factory) return null;
    database ??= openDatabase(factory).catch((error: unknown) => {
      failed = true;
      throw error;
    });
    return database;
  };

  const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
    const opening = db();
    if (!opening) return undefined;
    try {
      const handle = await opening;
      return await request(run(handle.transaction(STORE, mode).objectStore(STORE)));
    } catch {
      failed = true;
      return undefined;
    }
  };

  return {
    async put(entry) {
      await memory.put(entry);
      await withStore("readwrite", (store) => store.put(entry));
    },
    async remove(clientMessageId) {
      await memory.remove(clientMessageId);
      await withStore("readwrite", (store) => store.delete(clientMessageId));
    },
    async list(userId) {
      const stored = await withStore("readonly", (store) => store.index("userId").getAll(userId) as IDBRequest<OutboxEntry[]>);
      const held = await memory.list(userId);
      // Both, by id: what this page holds in memory is at least as new as what
      // it wrote to disk.
      const byId = new Map<string, OutboxEntry>();
      for (const entry of stored ?? []) byId.set(entry.clientMessageId, entry);
      for (const entry of held) byId.set(entry.clientMessageId, entry);
      return [...byId.values()];
    },
  };
}
