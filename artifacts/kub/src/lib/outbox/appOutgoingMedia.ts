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
  persistOutgoingWith,
  rememberOutgoing,
  type OutgoingMediaEntry,
} from "../outgoingMedia";
import { browserOutgoingMediaStorage } from "./outgoingMediaStorage";

const storage = browserOutgoingMediaStorage();

export function keepOutgoingMediaFor(userId: string | null): void {
  persistOutgoingWith(
    userId
      ? {
          save: (entry) => void storage.save(userId, entry),
          drop: (tempId) => void storage.drop(tempId),
        }
      : null,
  );
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
  const kept = await storage.list(userId);
  const restored: OutgoingMediaEntry[] = [];
  for (const entry of kept) {
    if (outgoingEntry(entry.tempId)) continue;
    const back: OutgoingMediaEntry = {
      ...entry,
      attachment: { ...entry.attachment, previewUrl: previewFor(entry), status: "failed", progress: null, error: null, uploaded: null },
    };
    // Already on the device: writing it again would only cost the write.
    rememberOutgoing(back, { persist: false });
    restored.push(back);
  }
  return restored;
}
