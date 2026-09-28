import type { Json, MessageWithSender, Profile } from "../types/database.ts";
import { buildAttachmentMediaMetadata } from "./mediaCompression.ts";
import { buildOptimisticMessage } from "./optimisticMessage.ts";
import { stagedAttachmentTextContent, type StagedAttachment } from "./stagedAttachments.ts";

/**
 * The placeholder an attachment puts in its conversation at the press (D-314),
 * built in one place for the two moments that make one: the press itself in
 * `ChatWindow`, and a restart that puts back what was still on its way
 * (tracker item 52). Two builders would drift, and a placeholder that differed
 * from its own replacement in any field the bubble reads would jump when it
 * was replaced.
 */

export function attachmentMessageType(attachment: Pick<StagedAttachment, "kind">): "image" | "video" | "audio" | "file" {
  if (attachment.kind === "voice") return "audio";
  if (attachment.kind === "video_message") return "video";
  if (attachment.kind === "image" || attachment.kind === "video" || attachment.kind === "audio") return attachment.kind;
  return "file";
}

export function formatVoiceDurationLabel(durationMs: number): string {
  const totalSec = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function attachmentMessageContent(
  attachment: Pick<StagedAttachment, "kind" | "durationMs" | "name">,
  caption: string | null,
): string {
  if (attachment.kind === "voice") {
    return `🎤 Голосовое сообщение (${formatVoiceDurationLabel(attachment.durationMs ?? 0)})`;
  }
  if (attachment.kind === "video_message") {
    return `Видео-сообщение (${formatVoiceDurationLabel(attachment.durationMs ?? 0)})`;
  }
  return stagedAttachmentTextContent(attachment.kind, caption, attachment.name);
}

export function buildAttachmentPlaceholder(input: {
  chatId: string;
  topicId: string | null;
  user: Profile;
  attachment: StagedAttachment;
  caption: string | null;
  replyToId: string | null;
  clientSentAt: string;
  tempId: string;
}): MessageWithSender {
  return {
    ...buildOptimisticMessage({
      chatId: input.chatId,
      topicId: input.topicId,
      user: input.user,
      type: attachmentMessageType(input.attachment),
      content: attachmentMessageContent(input.attachment, input.caption),
      mediaUrl: input.attachment.previewUrl,
      replyToId: input.replyToId,
      mediaMetadata: buildAttachmentMediaMetadata(input.attachment, null) as Json | undefined,
      clientMessageId: input.attachment.clientMessageId,
      clientSentAt: input.clientSentAt,
      tempId: input.tempId,
    }),
    upload_progress: null,
  };
}
