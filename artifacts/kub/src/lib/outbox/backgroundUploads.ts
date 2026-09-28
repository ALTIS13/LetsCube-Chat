/**
 * Files and voice notes that waited for the network go by themselves from
 * wherever the reader is — tracker item 52's last step.
 *
 * Until now a waiting attachment was sent again by its own conversation's
 * view: when that conversation opened, and at every moment the connection might
 * be back while it was open. Recorded offline in one chat and left for
 * another, a voice note sat with its clock until somebody went back. Telegram
 * uploads in the background whatever is on screen, and so does this.
 *
 * A conversation whose view is mounted still sends its own — this sender leaves
 * it alone — so nothing has two owners. The placeholder's `upload_waiting` is
 * the claim: whoever clears it first sends it, and it is cleared synchronously
 * before anything is awaited.
 *
 * Kept free of the store, the network and the browser, so the unit suite can
 * drive it; `appBackgroundUploads.ts` gives it the real ones.
 */

import type { MessageWithSender } from "../../types/database.ts";
import type { OutgoingMediaEntry } from "../outgoingMedia.ts";
import type { StagedAttachmentUpload } from "../stagedAttachments.ts";
import { uploadMayWait, type UploadFailure } from "../uploadFailure.ts";

/**
 * How often what waits is tried when nothing says the connection is back: a
 * storage that answered 503 comes back without the device ever going offline,
 * and no `online` announces it.
 */
export const WAITING_UPLOAD_SWEEP_MS = 30_000;

export interface BackgroundUploadDeps {
  /** The signed-in account now. A change stops the sender between two steps. */
  currentUserId(): string | null;
  /** Whether the device says it has a network at all. */
  online(): boolean;
  /** Everything on its way, from every conversation. */
  entries(): OutgoingMediaEntry[];
  /** Whether that conversation's view is mounted, and so sends its own. */
  viewed(chatId: string): boolean;
  /** Whether an upload of this attachment is running now. */
  uploading(attachmentId: string): boolean;
  /** Whether its placeholder was taken away. */
  cancelled(attachmentId: string): boolean;
  /** The placeholder as it stands in its conversation, or null. */
  placeholder(chatId: string, tempId: string): MessageWithSender | null;
  /** Change the placeholder where it stands, while it is still one. */
  patch(chatId: string, tempId: string, change: (message: MessageWithSender) => MessageWithSender): void;
  upload(entry: OutgoingMediaEntry, onProgress: (progress: number) => void): Promise<StagedAttachmentUpload>;
  /** The row, in the placeholder's place, handed to the outbox. */
  insert(entry: OutgoingMediaEntry, uploaded: StagedAttachmentUpload): Promise<void>;
  /** Done with: the row is the outbox's now. */
  forget(entry: OutgoingMediaEntry): void;
  describe(error: unknown): UploadFailure;
  /** What a refused upload says on its placeholder. */
  refusal(entry: OutgoingMediaEntry, failure: UploadFailure): string;
}

export interface BackgroundUploadSender {
  /** Send what waits, once. A call while one runs makes it look again after. */
  run(): Promise<void>;
}

/** Oldest first, conversation by conversation: a chat's attachments keep the order they were picked in. */
function byConversationAndTime(a: OutgoingMediaEntry, b: OutgoingMediaEntry): number {
  if (a.chatId !== b.chatId) return a.chatId < b.chatId ? -1 : 1;
  return a.clientSentAt < b.clientSentAt ? -1 : a.clientSentAt > b.clientSentAt ? 1 : 0;
}

export function createBackgroundUploadSender(deps: BackgroundUploadDeps): BackgroundUploadSender {
  let running: Promise<void> | null = null;
  let again = false;

  const waitingNow = (): OutgoingMediaEntry[] =>
    deps
      .entries()
      .filter((entry) =>
        !deps.viewed(entry.chatId) &&
        !deps.uploading(entry.attachment.id) &&
        !deps.cancelled(entry.attachment.id) &&
        Boolean(deps.placeholder(entry.chatId, entry.tempId)?.upload_waiting),
      )
      .sort(byConversationAndTime);

  const pass = async (): Promise<void> => {
    if (!deps.online()) return;
    const userId = deps.currentUserId();
    if (!userId) return;
    // A conversation whose upload the network cut is not tried again in this
    // pass: what comes after it in that chat would overtake it, and the same
    // network would cut it too. Other conversations still go.
    const held = new Set<string>();
    for (const entry of waitingNow()) {
      if (deps.currentUserId() !== userId) return;
      if (held.has(entry.chatId) || deps.viewed(entry.chatId)) continue;
      const shown = deps.placeholder(entry.chatId, entry.tempId);
      if (!shown?.upload_waiting || deps.cancelled(entry.attachment.id)) continue;
      // The claim, before anything is awaited: the view's own sender and the
      // next trigger both pass over it from here.
      deps.patch(entry.chatId, entry.tempId, (message) => ({ ...message, upload_waiting: false, upload_progress: 0 }));
      try {
        const uploaded = await deps.upload(entry, (progress) => {
          if (deps.cancelled(entry.attachment.id)) return;
          deps.patch(entry.chatId, entry.tempId, (message) => ({ ...message, upload_progress: progress }));
        });
        if (deps.cancelled(entry.attachment.id) || deps.currentUserId() !== userId) continue;
        await deps.insert(entry, uploaded);
        deps.forget(entry);
      } catch (error) {
        if (deps.cancelled(entry.attachment.id)) continue;
        const failure = deps.describe(error);
        if (uploadMayWait(failure)) {
          // Still nobody answering, or the storage still down: back to
          // waiting, with its clock.
          deps.patch(entry.chatId, entry.tempId, (message) => {
            const { upload_progress: _progress, ...rest } = message;
            return { ...rest, pending: true, failed: false, send_error: null, upload_waiting: true };
          });
          held.add(entry.chatId);
          continue;
        }
        // The server said no: red, with the reason and «Повторить», as a view
        // would have left it. The attachments after it still go (D-113).
        deps.patch(entry.chatId, entry.tempId, (message) => {
          const { upload_progress: _progress, ...rest } = message;
          return { ...rest, pending: false, failed: true, upload_waiting: false, send_error: deps.refusal(entry, failure) };
        });
      }
    }
  };

  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  return { run };
}
