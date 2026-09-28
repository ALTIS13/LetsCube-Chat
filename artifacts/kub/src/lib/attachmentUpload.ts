import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheControlFor } from "@/lib/mediaCacheControl";
import { originalPreviewPath } from "@/lib/mediaCompression";
import { publicMediaObjectUrl } from "@/lib/media/mediaUrl";
import { holdOutgoingAbort, releaseOutgoingAbort } from "@/lib/outgoingMedia";
import {
  shouldUseResumableUpload,
  startResumableStorageUpload,
  type ResumableStorageUploadHandle,
} from "@/lib/resumableStorageUpload";
import {
  CHAT_MEDIA_BUCKET,
  chatAttachmentUploadPath,
  type StagedAttachment,
  type StagedAttachmentUpload,
} from "@/lib/stagedAttachments";
import { getSupabasePublicUrl } from "@/lib/supabase/client";

export interface AttachmentUploadHooks {
  /** Progress of a resumable upload, 0 to 100. A plain upload reports none. */
  onProgress?: (progress: number) => void;
  /** Whether the send was taken away meanwhile; asked before the preview goes. */
  isCancelled?: () => boolean;
  /**
   * The view's own registry for a resumable upload, so taking the attachment
   * out of the tray can stop it; answers how to let it go again.
   */
  register?: (handle: ResumableStorageUploadHandle) => () => void;
}

/**
 * An attachment's bytes, into chat storage: the file, and an original's small
 * preview beside it. What a chat's view and the background sender of tracker
 * item 52 both run, so a file that waited for the network goes up the same way
 * whichever of the two sends it.
 *
 * A resumable upload is stoppable through `outgoingMedia` for as long as it
 * runs — the ring on the placeholder, and an account change, stop it from
 * wherever they are pressed.
 */
export async function uploadAttachmentBytes(
  supabase: SupabaseClient,
  userId: string,
  chatId: string,
  attachment: StagedAttachment,
  hooks: AttachmentUploadHooks = {},
): Promise<StagedAttachmentUpload> {
  const path = chatAttachmentUploadPath(chatId, userId, attachment);
  const contentType = attachment.mimeType || attachment.file.type || "application/octet-stream";
  let uploadedPath = path;

  if (shouldUseResumableUpload(attachment.file.size)) {
    const handle = startResumableStorageUpload({
      supabaseClient: supabase,
      supabaseUrl: getSupabasePublicUrl(),
      file: attachment.file,
      bucketName: CHAT_MEDIA_BUCKET,
      objectName: path,
      contentType,
      onProgress: hooks.onProgress,
    });
    const release = hooks.register?.(handle);
    const stop = () => void handle.abort(true).catch(() => undefined);
    holdOutgoingAbort(attachment.id, stop);
    try {
      const result = await handle.result;
      uploadedPath = result.path;
    } finally {
      release?.();
      releaseOutgoingAbort(attachment.id, stop);
    }
  } else {
    const { data, error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, attachment.file, {
        contentType,
        upsert: false,
        cacheControl: cacheControlFor(path),
      });
    if (error || !data) throw error ?? new Error("upload_failed");
    uploadedPath = data.path;
  }

  // An original's preview goes beside it, at the address a reader derives from
  // the original's own path. It is small, so a plain upload; and it is only a
  // lighter picture for the conversation, so a failure costs the bubble a
  // heavier download and never fails the send.
  let previewPath: string | null = null;
  if (attachment.uncompressed && attachment.previewFile && !hooks.isCancelled?.()) {
    // `.preview.webp`, or `.preview.jpg` from an engine that cannot write WebP.
    const candidate = originalPreviewPath(uploadedPath, attachment.previewFile.type);
    const { error: previewError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(candidate, attachment.previewFile, {
        contentType: attachment.previewFile.type || "image/webp",
        upsert: false,
        cacheControl: cacheControlFor(candidate),
      });
    if (previewError) console.warn("[attachments] preview upload failed.");
    else previewPath = candidate;
  }

  // D-208: the row records the bucket and the path beside this, and those two
  // are what a reader resolves from. The URL is still written because 20 rows
  // predate the columns and the projection reads it as a fallback; it is the
  // public one, because a signature would be dead long before the message is.
  const publicUrl = publicMediaObjectUrl({ bucket: CHAT_MEDIA_BUCKET, path: uploadedPath });
  return {
    bucket: CHAT_MEDIA_BUCKET,
    path: uploadedPath,
    publicUrl: publicUrl ?? "",
    previewPath,
  };
}
