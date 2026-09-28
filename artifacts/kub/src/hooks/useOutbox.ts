"use client";

import { useEffect } from "react";
import { buildAttachmentPlaceholder } from "@/lib/attachmentPlaceholder";
import { appBackgroundUploads } from "@/lib/outbox/appBackgroundUploads";
import { WAITING_UPLOAD_SWEEP_MS } from "@/lib/outbox/backgroundUploads";
import { appOutbox } from "@/lib/outbox/appOutbox";
import { keepOutgoingMediaFor, restoreOutgoingMedia } from "@/lib/outbox/appOutgoingMedia";
import { buildOptimisticMessage } from "@/lib/optimisticMessage";
import { CONNECTION_REVIVED_EVENT } from "@/lib/realtimeRevival";
import { useAppStore } from "@/store/app.store";

/**
 * Starts the outbox for the signed-in account (tracker item 52).
 *
 * On start, whatever a restart left waiting comes back on screen with its
 * clock, in the conversation it was written in, and the outbox sends it — the
 * restart is itself a moment to try. After that, every moment the connection
 * may be back tries again at once rather than waiting out the backoff: the
 * browser's `online`, a network change that stranded something
 * (`CONNECTION_REVIVED_EVENT`, item 53), and the return to the app.
 *
 * Files and voice notes that waited go at the same moments, from whichever
 * conversation they were sent in (`appBackgroundUploads`), and every half
 * minute while any waits — an upload the network cut while the device never
 * said it was offline has no other moment to go.
 */
export function useOutbox(): void {
  const userId = useAppStore((state) => state.currentUser?.id ?? null);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    // Files and voice notes on their way are kept on the device for this
    // account from here on, and what a restart left there comes back.
    keepOutgoingMediaFor(userId);
    void restoreOutgoingMedia(userId).then((waiting) => {
      if (!active) return;
      const store = useAppStore.getState();
      const user = store.currentUser;
      if (!user || user.id !== userId) return;
      for (const entry of waiting) {
        store.addMessage(entry.chatId, {
          ...buildAttachmentPlaceholder({
            chatId: entry.chatId,
            topicId: entry.topicId ?? null,
            user,
            attachment: entry.attachment,
            caption: entry.caption,
            replyToId: entry.replyToId,
            clientSentAt: entry.clientSentAt,
            tempId: entry.tempId,
          }),
          // With its clock: it goes once the connection answers, from its own
          // conversation's view if that is open and from the background if not.
          upload_waiting: true,
        });
      }
      void appBackgroundUploads.run();
    });

    void appOutbox.start(userId).then((waiting) => {
      if (!active) return;
      const store = useAppStore.getState();
      const user = store.currentUser;
      if (!user || user.id !== userId) return;
      for (const entry of waiting) {
        // `addMessage` upserts by id and by client id, so a bubble already on
        // screen is not drawn twice.
        store.addMessage(
          entry.chatId,
          buildOptimisticMessage({
            chatId: entry.chatId,
            topicId: entry.topicId,
            user,
            type: entry.type,
            content: entry.content,
            mediaBucket: entry.mediaBucket,
            mediaPath: entry.mediaPath,
            mediaUrl: entry.mediaUrl,
            replyToId: entry.replyToId,
            forwardedFromId: entry.forwardedFromId,
            mediaMetadata: entry.mediaMetadata,
            clientMessageId: entry.clientMessageId,
            clientSentAt: entry.clientSentAt,
            tempId: entry.tempId,
          }),
        );
      }
    });

    const retry = () => {
      appOutbox.retryNow();
      void appBackgroundUploads.run();
    };
    const sweep = window.setInterval(() => void appBackgroundUploads.run(), WAITING_UPLOAD_SWEEP_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    window.addEventListener(CONNECTION_REVIVED_EVENT, retry);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(sweep);
      window.removeEventListener("online", retry);
      window.removeEventListener(CONNECTION_REVIVED_EVENT, retry);
      document.removeEventListener("visibilitychange", onVisibility);
      appOutbox.stop();
      keepOutgoingMediaFor(null);
    };
  }, [userId]);
}
