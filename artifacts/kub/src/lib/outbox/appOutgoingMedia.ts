/**
 * Keeping files and voice notes on their way across a restart, for the
 * signed-in account (tracker item 52): the device half of `outgoingMedia.ts`.
 *
 * `keepOutgoingMediaFor` installs the persistence while an account is signed
 * in; `restoreOutgoingMedia` puts back in memory what a restart left on the
 * device, with a fresh preview, so the conversation it belongs to can show it
 * and send it again — «Повторить» works on it exactly as it does on one that
 * never left memory, and it goes by itself once its chat is open and the
 * connection answers.
 */

import {
  outgoingEntry,
  allOutgoingEntries,
  persistOutgoingWith,
  rememberOutgoing,
  type OutgoingMediaEntry,
} from "../outgoingMedia.ts";
import { browserOutgoingMediaStorage, persistable } from "./outgoingMediaStorage.ts";

const storage = browserOutgoingMediaStorage();
let activeUserId: string | null = null;
let accountEpoch = 0;
type Persistence = {
  userId: string;
  tempId: string;
  entry: OutgoingMediaEntry | null;
  status: "pending" | "committed" | "failed";
};
const records = new Map<string, Persistence>();
const restoring = new Map<string, number>();
const key = (userId: string, tempId: string) => JSON.stringify([userId, tempId]);

function pruneDrops(userId: string): void {
  if (restoring.get(userId)) return;
  for (const [id, record] of records) {
    if (record.userId === userId && record.entry === null && record.status === "committed") records.delete(id);
  }
}

function save(userId: string, entry: OutgoingMediaEntry): void {
  const id = key(userId, entry.tempId);
  const record: Persistence = { userId, tempId: entry.tempId, entry, status: "pending" };
  records.set(id, record); // An explicit re-enqueue supersedes this owner's cancellation.
  if (!persistable(entry)) { record.status = "failed"; return; }
  void storage.save(userId, entry).then(() => {
    if (records.get(id) === record) record.status = "committed";
  }, () => {
    if (records.get(id) === record) record.status = "failed";
  });
}

function drop(userId: string, tempId: string): void {
  const id = key(userId, tempId);
  const record: Persistence = { userId, tempId, entry: null, status: "pending" };
  records.set(id, record);
  void storage.drop(tempId).then(() => {
    if (records.get(id) !== record) return;
    record.status = "committed";
    pruneDrops(userId);
  }, () => {
    if (records.get(id) === record) record.status = "failed";
  });
}

/** Byte-size eligibility alone is not evidence that a reload can recover the entry. */
export function outgoingMediaPersistenceWouldLose(): boolean {
  if ([...records.values()].some(record => record.entry === null && record.status !== "committed")) return true;
  return allOutgoingEntries().some(entry => {
    const record = activeUserId ? records.get(key(activeUserId, entry.tempId)) : null;
    return record?.entry !== entry || record.status !== "committed";
  });
}

export function keepOutgoingMediaFor(userId: string | null): void {
  if (activeUserId !== userId) {
    activeUserId = userId;
    accountEpoch += 1;
  }
  persistOutgoingWith(
    userId
      ? {
          save: (entry) => save(userId, entry),
          drop: (tempId) => drop(userId, tempId),
        }
      : null,
  );
  // One explicit initialization retry, not a background retry scheduler.
  if (userId) for (const record of records.values()) {
    if (record.userId === userId && record.entry === null && record.status === "failed") drop(userId, record.tempId);
  }
}

/** A preview for what the bubble plays or shows from the device while it waits. */
function previewFor(entry: OutgoingMediaEntry): string | null {
  const { kind, file } = entry.attachment;
  if (kind === "image" || kind === "video" || kind === "voice" || kind === "video_message") {
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }
  return null;
}

export async function restoreOutgoingMedia(userId: string): Promise<OutgoingMediaEntry[]> {
  if (activeUserId !== userId) return [];
  const epoch = accountEpoch;
  restoring.set(userId, (restoring.get(userId) ?? 0) + 1);
  try {
    const kept = await storage.list(userId);
    if (epoch !== accountEpoch || activeUserId !== userId) return [];
    const restored: OutgoingMediaEntry[] = [];
    for (const entry of kept) {
      if (records.get(key(userId, entry.tempId))?.entry === null || outgoingEntry(entry.tempId)) continue;
      const back: OutgoingMediaEntry = {
        ...entry,
        attachment: { ...entry.attachment, previewUrl: previewFor(entry), status: "failed", progress: null, error: null, uploaded: null },
      };
      rememberOutgoing(back, { persist: false });
      records.set(key(userId, entry.tempId), { userId, tempId: entry.tempId,
        entry: outgoingEntry(entry.tempId), status: "committed" });
      restored.push(back);
    }
    return restored;
  } catch {
    return []; // No false restoration or unhandled rejection; live memory remains usable.
  } finally {
    const remaining = (restoring.get(userId) ?? 1) - 1;
    if (remaining) restoring.set(userId, remaining);
    else restoring.delete(userId);
    pruneDrops(userId);
  }
}
