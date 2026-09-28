import type { MessageWithSender } from "../types/database.ts";

/**
 * Every message the open conversation's socket hears, whichever channel of the
 * server it is in (tracker item 54).
 *
 * The conversation listens to its whole chat and keeps only the channel on
 * screen; the channel list needs the rest to keep each channel's last line
 * current. Handing them over here costs nothing, where a second subscription
 * to the same chat would cost a socket join per open conversation.
 */

type Listener = (message: MessageWithSender) => void;

const listeners = new Set<Listener>();

export function emitChannelActivity(message: MessageWithSender): void {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // A listener's failure is its own; the conversation must not lose the row.
    }
  }
}

export function onChannelActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
