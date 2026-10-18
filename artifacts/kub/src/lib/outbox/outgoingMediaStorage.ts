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

import { snapshotOutgoingEntry, type OutgoingMediaEntry } from "../outgoingMedia.ts";
import { idbTransaction } from "./idbTransaction.ts";

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
  return validSize(entry.attachment.file.size)
    && (entry.attachment.previewFile == null || validSize(entry.attachment.previewFile.size));
}

/** What is written: everything but the preview's object URL, which dies with the page. */
export function toPersisted(userId: string, entry: OutgoingMediaEntry): PersistedOutgoingMedia & { tempId: string } {
  return {
    tempId: entry.tempId,
    userId,
    entry: snapshotOutgoingEntry({ ...entry, attachment: { ...entry.attachment, previewUrl: null, uploaded: null } }),
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
      return [...records.values()].filter((record) => record.userId === userId).map((record) => snapshotOutgoingEntry(record.entry));
    },
  };
}

const DB_NAME = "kub-outbox-media";
const DB_VERSION = 1;
const STORE = "media";
const unavailable = () => new Error("OUTGOING_MEDIA_STORAGE_UNAVAILABLE");
const validSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
  && (value as number) <= PERSIST_LIMIT_BYTES;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024;
const nullableId = (value: unknown) => value === null || id(value);

type FileBytesV1 = { file_v: 1; bytes: ArrayBuffer; name: string; type: string; lastModified: number; size: number };
type FileSource = Omit<FileBytesV1, "bytes"> & { file: File };

function fileSource(file: File): FileSource {
  if (!(file instanceof File) || !validSize(file.size) || file.name.length > 4096 || file.type.length > 1024
    || !Number.isSafeInteger(file.lastModified)) throw unavailable();
  return { file_v: 1, file, name: file.name, type: file.type, lastModified: file.lastModified, size: file.size };
}

async function fileBytes(source: FileSource): Promise<FileBytesV1> {
  const { file, ...metadata } = source;
  const bytes = await file.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== metadata.size) throw unavailable();
  return { ...metadata, bytes };
}

function readFileBytes(value: unknown): FileBytesV1 | null {
  if (!record(value) || Object.keys(value).length !== 6
    || !["file_v", "bytes", "name", "type", "lastModified", "size"].every(key => Object.hasOwn(value, key))
    || value.file_v !== 1 || !validSize(value.size) || !(value.bytes instanceof ArrayBuffer)
    || value.bytes.byteLength !== value.size || typeof value.name !== "string" || value.name.length > 4096
    || typeof value.type !== "string" || value.type.length > 1024 || !/^[\x20-\x7e]*$/.test(value.type)
    || value.type !== value.type.toLowerCase() || !Number.isSafeInteger(value.lastModified)) return null;
  return value as FileBytesV1;
}

function entryShape(value: unknown): value is OutgoingMediaEntry {
  if (!record(value) || !id(value.tempId) || !id(value.chatId) || !nullableId(value.replyToId)
    || (value.topicId !== undefined && !nullableId(value.topicId))
    || (value.caption !== null && typeof value.caption !== "string")
    || typeof value.clientSentAt !== "string" || !Number.isFinite(Date.parse(value.clientSentAt))
    || !record(value.attachment)) return false;
  const attachment = value.attachment;
  return id(attachment.id) && id(attachment.clientMessageId) && validSize(attachment.size)
    && typeof attachment.name === "string" && typeof attachment.mimeType === "string"
    && ["image", "video", "audio", "voice", "video_message", "file"].includes(String(attachment.kind));
}

// Snapshot metadata before any asynchronous byte conversion; neither File reaches IDB.
function prepareBytes(userId: string, entry: OutgoingMediaEntry) {
  const held = toPersisted(userId, entry);
  if (!id(userId) || !entryShape(held.entry)) throw unavailable();
  const { file, previewFile, ...attachment } = held.entry.attachment;
  const main = fileSource(file), preview = previewFile == null ? previewFile : fileSource(previewFile);
  if (held.entry.attachment.size !== main.size) throw unavailable();
  const metadata = structuredClone({ ...held, entry: { ...held.entry, attachment } });
  return async () => ({ ...metadata, storage_v: 1,
    entry: { ...metadata.entry, attachment: { ...metadata.entry.attachment, file: await fileBytes(main),
      ...(preview === undefined ? {} : { previewFile: preview === null ? null : await fileBytes(preview) }) } } });
}

function readStored(value: unknown, userId: string): OutgoingMediaEntry | null {
  if (!record(value) || value.userId !== userId || !entryShape(value.entry) || value.tempId !== value.entry.tempId) return null;
  const entry = value.entry, attachment = entry.attachment;
  try {
    if (Object.hasOwn(value, "storage_v")) {
      if (value.storage_v !== 1) return null;
      const main = readFileBytes(attachment.file);
      const preview = attachment.previewFile == null ? attachment.previewFile : readFileBytes(attachment.previewFile);
      if (!main || main.size !== attachment.size || (attachment.previewFile != null && !preview)) return null;
      const restore = (file: FileBytesV1) => new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified });
      return snapshotOutgoingEntry({ ...entry, attachment: { ...attachment, file: restore(main),
        ...(preview === undefined ? {} : { previewFile: preview === null ? null : restore(preview) }),
        previewUrl: null, uploaded: null } });
    }
    // Existing v1 object stores contain unversioned native File records.
    const main = fileSource(attachment.file);
    if (main.size !== attachment.size) return null;
    if (attachment.previewFile != null) fileSource(attachment.previewFile);
    return snapshotOutgoingEntry(entry);
  } catch { return null; }
}

// All media-storage instances on the same factory share ordering, including byte reads.
const writes = new WeakMap<IDBFactory, Promise<void>>();

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
    open.onerror = () => reject(unavailable());
    open.onblocked = () => reject(unavailable());
  });
}

/** A successful write means commit; unavailable storage leaves memory as the only copy. */
export function browserOutgoingMediaStorage(factory: IDBFactory | undefined = globalThis.indexedDB): OutgoingMediaStorage {
  let database: Promise<IDBDatabase> | null = null;

  const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    if (!factory) throw unavailable();
    try {
      database ??= openDatabase(factory).then((handle) => {
        handle.onversionchange = () => { handle.close(); database = null; };
        return handle;
      }).catch(() => { database = null; throw unavailable(); });
      const handle = await database;
      return await idbTransaction(handle, STORE, mode, run);
    } catch {
      throw unavailable();
    }
  };

  const write = <T>(run: () => Promise<T>): Promise<T> => {
    if (!factory) return Promise.reject(unavailable());
    const work = (writes.get(factory) ?? Promise.resolve()).then(run);
    writes.set(factory, work.then(() => undefined, () => undefined));
    return work;
  };

  return {
    async save(userId, entry) {
      if (!persistable(entry)) return;
      const encode = prepareBytes(userId, entry);
      await write(async () => {
        const value = await encode();
        await withStore("readwrite", (store) => store.put(value));
      });
    },
    async drop(tempId) {
      await write(() => withStore("readwrite", (store) => store.delete(tempId)));
    },
    async list(userId) {
      if (factory) await writes.get(factory);
      const records = await withStore(
        "readonly",
        (store) => store.index("userId").getAll(userId) as IDBRequest<unknown[]>,
      );
      return records.flatMap(record => { const entry = readStored(record, userId); return entry ? [entry] : []; });
    },
  };
}
