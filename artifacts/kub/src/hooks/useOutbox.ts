"use client";

import { useEffect } from "react";
import { appOutbox } from "@/lib/outbox/appOutbox";
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
 */
export function useOutbox(): void {
  const userId = useAppStore((state) => state.currentUser?.id ?? null);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;

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

    const retry = () => appOutbox.retryNow();
    const onVisibility = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    window.addEventListener(CONNECTION_REVIVED_EVENT, retry);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("online", retry);
      window.removeEventListener(CONNECTION_REVIVED_EVENT, retry);
      document.removeEventListener("visibilitychange", onVisibility);
      appOutbox.stop();
    };
  }, [userId]);
}
