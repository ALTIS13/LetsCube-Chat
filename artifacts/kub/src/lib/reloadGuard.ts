/**
 * What a reload would take away from somebody right now.
 *
 * The quiet restart of `lib/pwa/appUpdateNotice.ts` reloads a tab nobody is
 * using, so that it takes a new build. It used to refuse whenever a
 * conversation was open, because a reload landed on the chat list. Item 35 of
 * `docs/PRODUCTION_PRIORITY_TRACKER.md` gave the conversation an address
 * (`lib/chatRoute.ts`), so a reload now comes back to the same conversation, at
 * the place a click would open it — and «a conversation is open» stopped
 * meaning «a reload costs something».
 *
 * What that veto had been standing in front of did not stop costing, though.
 * On a desktop a conversation is open nearly all the time, so it quietly
 * covered everything opened over one as well. This is that list, said out loud
 * instead of implied:
 *
 *  - **something in hand in the composer**: a voice or video note being
 *    recorded or waiting to be listened to, files staged above the composer, a
 *    message being edited, a reply or a forward waiting to be written;
 *  - **files picked into the attach sheet** and not sent yet;
 *  - **a place in the history**: a reader scrolled away from the bottom comes
 *    back after a reload to where a click lands — the bottom, or the first
 *    unread — and not to where they had scrolled. Nothing keeps a scroll
 *    offset, and `lib/chatRoute.ts` says why nothing should; but that argument
 *    is about opening a conversation, where the person chose to move. Here the
 *    product would be the one moving them;
 *  - **the conversation's search**, whose query and results are nowhere else;
 *  - **an open dialog**: every `KubModal` is on `lib/modalStack.ts`, and what
 *    was typed into one — the settings, a task, a report, a new group — is in
 *    that dialog and nowhere else;
 *  - **an attachment on its way that lives only in memory**: a file above
 *    `PERSIST_LIMIT_BYTES` is not written to the device (item 52), so a reload
 *    would drop it, where a smaller one is sent again after the reload.
 *
 * The composer's text is deliberately not on it: it is written to
 * `localStorage` per chat and read back when the composer mounts, so a reload
 * gives it back. A condition that cannot decide anything reads like a
 * guarantee, which is worse than a missing one.
 *
 * The first four are held by the components that own them, through
 * `hooks/useReloadGuard.ts`; the last two are read from registries that already
 * exist. A registry rather than a store field, so holding costs no render, and
 * the update path reads it from a snapshot like everything else it reads.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

import { openModalLayerCount } from "./modalStack.ts";
import { allOutgoingEntries } from "./outgoingMedia.ts";
import { persistable } from "./outbox/outgoingMediaStorage.ts";

/** Why a reload would cost something, named so a test or a console can say which. */
export type ReloadLoss =
  | "attach-sheet"
  | "chat-search"
  | "dialog"
  | "editing"
  | "forward"
  | "outgoing-in-memory"
  | "reading-history"
  | "recording"
  | "reply"
  | "staged-attachments";

const held = new Map<number, ReloadLoss>();
let nextHold = 0;

/**
 * Says that a reload would now lose `loss`, until the returned function is
 * called. Each hold has its own identity, so a cleanup that runs twice cannot
 * release somebody else's.
 */
export function guardAgainstReload(loss: ReloadLoss): () => void {
  nextHold += 1;
  const id = nextHold;
  held.set(id, loss);
  return () => {
    held.delete(id);
  };
}

/** Everything a reload would lose now, each named once, in a stable order. */
export function reloadWouldLose(): ReloadLoss[] {
  const losses = new Set<ReloadLoss>(held.values());
  if (openModalLayerCount() > 0) losses.add("dialog");
  if (allOutgoingEntries().some((entry) => !persistable(entry))) losses.add("outgoing-in-memory");
  return [...losses].sort();
}

/** Drops every hold. Tests only — nothing in the product should need it. */
export function resetReloadGuards(): void {
  held.clear();
}
