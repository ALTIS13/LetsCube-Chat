/**
 * The background sender of `backgroundUploads.ts`, given the real store,
 * storage and outbox (tracker item 52). `useOutbox` runs it on start and at
 * every moment the connection may be back.
 */

import type { Json, MessageWithSender } from "@/types/database";
import { attachmentMessageContent, attachmentMessageType } from "@/lib/attachmentPlaceholder";
import { uploadAttachmentBytes } from "@/lib/attachmentUpload";
import { buildAttachmentMediaMetadata } from "@/lib/mediaCompression";
import { buildOptimisticMessage } from "@/lib/optimisticMessage";
import {
  allOutgoingEntries,
  forgetOutgoing,
  isChatViewed,
  isOutgoingCancelled,
  isOutgoingUploading,
} from "@/lib/outgoingMedia";
import { revokeAttachmentPreview } from "@/lib/stagedAttachments";
import { createClient } from "@/lib/supabase/client";
import { describeUploadFailure, uploadFailureMessage } from "@/lib/uploadFailure";
import { useAppStore } from "@/store/app.store";
import { appOutbox } from "./appOutbox";
import { createBackgroundUploadSender } from "./backgroundUploads";

/** As the chat's view frees a sent attachment's preview: once the stored picture has had time to replace it. */
const PREVIEW_GRACE_MS = 60_000;

function placeholder(chatId: string, tempId: string): MessageWithSender | null {
  return useAppStore.getState().messages[chatId]?.find((message) => message.id === tempId) ?? null;
}

export const appBackgroundUploads = createBackgroundUploadSender({
  currentUserId: () => useAppStore.getState().currentUser?.id ?? null,
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
  entries: allOutgoingEntries,
  viewed: isChatViewed,
  uploading: isOutgoingUploading,
  cancelled: isOutgoingCancelled,
  placeholder,
  patch: (chatId, tempId, change) => {
    const current = placeholder(chatId, tempId);
    // Only while it is still a placeholder: once the row is in, it has a path.
    if (!current || current.media_path) return;
    useAppStore.getState().updateMessage(chatId, change(current));
  },
  upload: (entry, onProgress) => {
    const userId = useAppStore.getState().currentUser?.id;
    if (!userId) return Promise.reject(new Error("auth"));
    return uploadAttachmentBytes(createClient(), userId, entry.chatId, entry.attachment, {
      onProgress,
      isCancelled: () => isOutgoingCancelled(entry.attachment.id),
    });
  },
  insert: async (entry, uploaded) => {
    const store = useAppStore.getState();
    const user = store.currentUser;
    if (!user) return;
    const { attachment } = entry;
    const topicId = entry.topicId ?? null;
    const type = attachmentMessageType(attachment);
    const content = attachmentMessageContent(attachment, entry.caption);
    const mediaMetadata = buildAttachmentMediaMetadata(attachment, uploaded) as Json | undefined;
    const row = buildOptimisticMessage({
      chatId: entry.chatId,
      topicId,
      user,
      type,
      content,
      mediaBucket: uploaded.bucket,
      mediaPath: uploaded.path,
      mediaUrl: uploaded.publicUrl,
      replyToId: entry.replyToId,
      mediaMetadata,
      clientMessageId: attachment.clientMessageId,
      clientSentAt: entry.clientSentAt,
      tempId: entry.tempId,
    });
    // The row takes the placeholder's place, and the outbox has it from here —
    // kept on the device, retried, and red only on a refusal, as any row is.
    store.replaceMessage(entry.chatId, entry.tempId, row);
    store.updateChatLastMessage(entry.chatId, row);
    await appOutbox.enqueue({
      clientMessageId: attachment.clientMessageId,
      userId: user.id,
      chatId: entry.chatId,
      topicId,
      type,
      content: content ?? null,
      replyToId: entry.replyToId,
      forwardedFromId: null,
      mediaBucket: uploaded.bucket,
      mediaPath: uploaded.path,
      mediaUrl: uploaded.publicUrl,
      ...(mediaMetadata === undefined ? {} : { mediaMetadata }),
      clientSentAt: entry.clientSentAt,
      tempId: entry.tempId,
      attempts: 0,
      nextAttemptAt: 0,
    });
  },
  forget: (entry) => {
    forgetOutgoing(entry.tempId);
    if (typeof window !== "undefined") {
      window.setTimeout(() => revokeAttachmentPreview(entry.attachment), PREVIEW_GRACE_MS);
    }
  },
  describe: describeUploadFailure,
  refusal: (entry, failure) => uploadFailureMessage(entry.attachment.name, failure),
});
