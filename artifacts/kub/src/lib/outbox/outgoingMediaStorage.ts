/**
 * Files and voice notes on their way, kept on the device so that a restart
 * does not lose them (tracker item 52, its second half).
 *
 * «Если у тебя голосовуха не отправляется — перезаписать вообще»: until now
 * the bytes of an attachment on its way lived only in memory
 * (`outgoingMedia.ts`), so a failed upload kept «Повторить» until the app
 * closed and a restart lost the recording. The entry — the file itself, its
 * caption, what it replied to, its chat, topic and place — is written here at
 * the press and removed when its row is in or its placeholder is taken away.
 *
 * A database of its own rather than a second store in the outbox's, so neither
 * has to migrate the other. Files above `PERSIST_LIMIT_BYTES` are not kept: a
 * long video written twice more to the device's storage is a cost the voice
 * notes and photos this is for do not need, and such a file still retries in
 * memory as before.
 */

import type { OutgoingMediaEntry } from "../outgoingMedia.ts";

/** The largest file kept across a restart. A voice note is well under 2 MB. */
export const PERSIST_LIMIT_BYTES = 25 * 1024 * 1024;

export interface PersistedOutgoingMedia {
  userId: string;
  entry: OutgoingMediaEntry;
}

export interface OutgoingMediaStorage {
  save(userId: string, entry: OutgoingMediaEntry): Promise<void>;
  drop(tempId: string): Promise<void>;
  list(userId: string): Promise<OutgoingMediaEntry[]>;
}

/** Whether this entry is kept across a restart at all. */
export function persistable(entry: OutgoingMediaEntry): boolean {
  return entry.attachment.file.size <= PERSIST_LIMIT_BYTES;
}

/** What is written: everything but the preview's object URL, which dies with the page. */
export function toPersisted(userId: string, entry: OutgoingMediaEntry): PersistedOutgoingMedia & { tempId: string } {
  return {
    tempId: entry.tempId,
    userId,
    entry: { ...entry, attachment: { ...entry.attachment, previewUrl: null, uploaded: null } },
  };
}

export function memoryOutgoingMediaStorage(): OutgoingMediaStorage {
  const records = new Map<string, PersistedOutgoingMedia>();
  return {
    async save(userId, entry) {
      if (!persistable(entry)) return;
      records.set(entry.tempId, toPersisted(userId, entry));
    },
    async drop(tempId) {
      records.delete(tempId);
    },
    async list(userId) {
      return [...records.values()].filter((record) => record.userId === userId).map((record) => record.entry);
    },
  };
}

const DB_NAME = "kub-outbox-media";
const DB_VERSION = 1;
const STORE = "media";

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "tempId" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("outgoing media database blocked"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB, and nothing at all once it has failed: memory already holds the entry. */
export function browserOutgoingMediaStorage(factory: IDBFactory | undefined = globalThis.indexedDB): OutgoingMediaStorage {
  let database: Promise<IDBDatabase> | null = null;
  let failed = !factory;

  const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
    if (failed || !factory) return undefined;
    try {
      database ??= openDatabase(factory);
      const handle = await database;
      return await request(run(handle.transaction(STORE, mode).objectStore(STORE)));
    } catch {
      failed = true;
      return undefined;
    }
  };

  return {
    async save(userId, entry) {
      if (!persistable(entry)) return;
      await withStore("readwrite", (store) => store.put(toPersisted(userId, entry)));
    },
    async drop(tempId) {
      await withStore("readwrite", (store) => store.delete(tempId));
    },
    async list(userId) {
      const records = await withStore(
        "readonly",
        (store) => store.index("userId").getAll(userId) as IDBRequest<Array<PersistedOutgoingMedia & { tempId: string }>>,
      );
      return (records ?? []).map((record) => record.entry);
    },
  };
}
