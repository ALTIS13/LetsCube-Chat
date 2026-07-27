import type { GuestSupportSession } from "./types";

const SESSION_KEY = "current";
const DATABASE_NAME = "letscube-support";
const STORE_NAME = "guest-sessions";
const DATABASE_VERSION = 1;

export interface GuestSupportSessionBackend {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: GuestSupportSession): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createGuestSupportSessionStore(
  backend: GuestSupportSessionBackend,
  options: { now?: () => number } = {},
) {
  const now = options.now ?? Date.now;

  return {
    async save(session: GuestSupportSession): Promise<void> {
      if (!isValidSession(session)) throw new Error("Invalid guest support session");
      await backend.put(SESSION_KEY, session);
    },

    async load(): Promise<GuestSupportSession | null> {
      const record = await backend.get(SESSION_KEY);
      if (!isValidSession(record) || isExpired(record, now())) {
        await backend.delete(SESSION_KEY);
        return null;
      }
      return record;
    },

    async clear(): Promise<void> {
      await backend.delete(SESSION_KEY);
    },
  };
}

export const guestSupportSessionStore = createGuestSupportSessionStore(createIndexedDbBackend());

function createIndexedDbBackend(): GuestSupportSessionBackend {
  return {
    async get(key) {
      if (typeof indexedDB === "undefined") return null;
      const database = await openDatabase();
      return requestResult(
        database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
      );
    },
    async put(key, value) {
      if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB is unavailable");
      }
      const database = await openDatabase();
      await requestResult(
        database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key),
      );
    },
    async delete(key) {
      if (typeof indexedDB === "undefined") return;
      const database = await openDatabase();
      await requestResult(
        database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key),
      );
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Support session storage is unavailable"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Support session storage operation failed"));
  });
}

function isValidSession(value: unknown): value is GuestSupportSession {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GuestSupportSession>;
  return (
    typeof record.ticketId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(record.ticketId) &&
    typeof record.secret === "string" &&
    record.secret.length >= 24 &&
    record.secret.length <= 512 &&
    isIsoDate(record.idleExpiresAt) &&
    isIsoDate(record.absoluteExpiresAt) &&
    isIsoDate(record.updatedAt)
  );
}

function isExpired(session: GuestSupportSession, now: number): boolean {
  return (
    Date.parse(session.idleExpiresAt) <= now ||
    Date.parse(session.absoluteExpiresAt) <= now
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
