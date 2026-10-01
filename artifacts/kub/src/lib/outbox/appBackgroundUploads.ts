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
  outgoingEntry,
  rememberOutgoing,
  type OutgoingMediaEntry,
} from "@/lib/outgoingMedia";
import { revokeAttachmentPreview, stagedAttachmentMentionEntities } from "@/lib/stagedAttachments";
import { createClient } from "@/lib/supabase/client";
import { describeUploadFailure, uploadFailureMessage } from "@/lib/uploadFailure";
import { useAppStore } from "@/store/app.store";
import { appOutbox } from "./appOutbox";
import { createBackgroundUploadSender } from "./backgroundUploads";
import type { OutboxEntry } from "./outboxRules";
import { browserOutboxStorage } from "./outboxStorage";

/** As the chat's view frees a sent attachment's preview: once the stored picture has had time to replace it. */
const PREVIEW_GRACE_MS = 60_000;

function placeholder(chatId: string, tempId: string): MessageWithSender | null {
  return useAppStore.getState().messages[chatId]?.find((message) => message.id === tempId) ?? null;
}

type CaptionLinkedMedia = OutgoingMediaEntry & {
  captionPrefix?: { entry: OutboxEntry; accepted: boolean };
};

function prefixAcknowledged(entry: CaptionLinkedMedia): boolean {
  const prefix = entry.captionPrefix;
  const userId = useAppStore.getState().currentUser?.id;
  if (!prefix || prefix.entry.userId !== userId || prefix.entry.chatId !== entry.chatId
    || (prefix.entry.topicId ?? null) !== (entry.topicId ?? null) || prefix.entry.type !== "text") return false;
  return prefix.accepted || Boolean(useAppStore.getState().messages[entry.chatId]?.some((message) =>
    message.user_id === userId && message.client_message_id === prefix.entry.clientMessageId
    && !message.failed && !message.pending && !message.checking));
}

function acceptPrefix(entry: CaptionLinkedMedia): void {
  const current = outgoingEntry(entry.tempId) as CaptionLinkedMedia | null;
  if (!current?.captionPrefix || current.captionPrefix.entry.clientMessageId !== entry.captionPrefix?.entry.clientMessageId
    || isOutgoingCancelled(entry.attachment.id)) return;
  rememberOutgoing({ ...current, captionPrefix: { ...current.captionPrefix, accepted: true } } as CaptionLinkedMedia);
}

async function ensureCaptionPrefix(entry: CaptionLinkedMedia): Promise<void> {
  const prefix = entry.captionPrefix;
  if (!prefix) return;
  const store = useAppStore.getState();
  const userId = store.currentUser?.id;
  const epoch = store.accountEpoch;
  const owns = () => useAppStore.getState().currentUser?.id === userId
    && useAppStore.getState().accountEpoch === epoch && !isOutgoingCancelled(entry.attachment.id)
    && (outgoingEntry(entry.tempId) as CaptionLinkedMedia | null)?.captionPrefix?.entry.clientMessageId === prefix.entry.clientMessageId;
  if (!userId || prefix.entry.userId !== userId || prefix.entry.chatId !== entry.chatId
    || (prefix.entry.topicId ?? null) !== (entry.topicId ?? null) || prefix.entry.type !== "text") {
    throw new Error("Caption prefix owner mismatch");
  }
  if (prefixAcknowledged(entry)) { acceptPrefix(entry); return; }
  // Do not replace a foreground/startup attempt's waiter with a second enqueue.
  if (appOutbox.has(prefix.entry.clientMessageId)) throw new TypeError("Caption prefix is waiting");
  const outcome = await appOutbox.enqueue(structuredClone(prefix.entry));
  if (!owns()) throw new TypeError("Caption prefix scope changed");
  if (outcome.kind === "sent") { acceptPrefix(entry); return; }
  if (outcome.kind === "waiting") throw new TypeError("Caption prefix is waiting");
  // Refusal removes the text runner's entry; its stable identity and media bytes must survive.
  await browserOutboxStorage().put(structuredClone(prefix.entry));
  const afterRetention = useAppStore.getState();
  const retained = outgoingEntry(entry.tempId) as CaptionLinkedMedia | null;
  const prefixStillShown = afterRetention.messages[entry.chatId]?.some((message) =>
    message.user_id === userId && message.client_message_id === prefix.entry.clientMessageId);
  if (afterRetention.currentUser?.id === userId && afterRetention.accountEpoch === epoch && !prefixStillShown
    && retained?.captionPrefix?.entry.clientMessageId !== prefix.entry.clientMessageId) {
    await browserOutboxStorage().remove(prefix.entry.clientMessageId);
  }
  throw new Error("Caption prefix was refused");
}

export const appBackgroundUploads = createBackgroundUploadSender({
  currentUserId: () => useAppStore.getState().currentUser?.id ?? null,
  currentAccountEpoch: () => useAppStore.getState().accountEpoch,
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
  entries: () => {
    for (const entry of allOutgoingEntries() as CaptionLinkedMedia[]) {
      if (!entry.captionPrefix || entry.captionPrefix.accepted || !prefixAcknowledged(entry)) continue;
      acceptPrefix(entry);
      const shown = placeholder(entry.chatId, entry.tempId);
      if (shown?.failed && !shown.media_path) {
        useAppStore.getState().updateMessage(entry.chatId, {
          ...shown, pending: true, failed: false, send_error: null, upload_waiting: true,
        });
      }
    }
    return allOutgoingEntries();
  },
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
  upload: async (entry, onProgress) => {
    const store = useAppStore.getState();
    const userId = store.currentUser?.id;
    const epoch = store.accountEpoch;
    if (!userId) return Promise.reject(new Error("auth"));
    const ownsUpload = () => useAppStore.getState().currentUser?.id === userId && useAppStore.getState().accountEpoch === epoch
      && !isOutgoingCancelled(entry.attachment.id);
    await ensureCaptionPrefix(entry);
    if (!ownsUpload()) throw new TypeError("Background upload scope changed");
    const uploaded = await uploadAttachmentBytes(createClient(), userId, entry.chatId, entry.attachment, {
      onProgress,
      isCancelled: () => isOutgoingCancelled(entry.attachment.id),
    });
    if (!ownsUpload()) throw new TypeError("Background upload scope changed");
    return uploaded;
  },
  insert: async (entry, uploaded) => {
    const store = useAppStore.getState();
    const user = store.currentUser;
    if (!user) return;
    const { attachment } = entry;
    const topicId = entry.topicId ?? null;
    const type = attachmentMessageType(attachment);
    const content = attachmentMessageContent(attachment, entry.caption);
    const mentionEntities = stagedAttachmentMentionEntities(attachment.kind, entry.caption, entry.mentionEntities ?? attachment.mentionEntities);
    const mediaMetadata = buildAttachmentMediaMetadata(attachment, uploaded) as Json | undefined;
    const row = buildOptimisticMessage({
      chatId: entry.chatId,
      topicId,
      user,
      type,
      content,
      ...(mentionEntities === undefined ? {} : { mentionEntities }),
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
      ...(mentionEntities === undefined ? {} : { mentionEntities }),
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
