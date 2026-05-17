export type StagedAttachmentKind = "image" | "video" | "audio" | "voice" | "video_message" | "file";

export type StagedAttachmentStatus =
  | "staged"
  | "uploading"
  | "sending"
  | "failed"
  | "cancelled";

export interface StagedAttachmentUpload {
  bucket: string;
  path: string;
  publicUrl: string;
}

export interface StagedAttachment {
  id: string;
  file: File;
  kind: StagedAttachmentKind;
  previewUrl: string | null;
  name: string;
  size: number;
  mimeType: string;
  status: StagedAttachmentStatus;
  progress: number | null;
  error: string | null;
  clientMessageId: string;
  uploaded: StagedAttachmentUpload | null;
  durationMs?: number;
}

export const CHAT_MEDIA_BUCKET = "media";
export const MAX_STAGED_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_SIZE_LABEL = "25 МБ";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

export function validateStagedAttachment(file: File): string | null {
  if (!file) return "Файл недоступен.";
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `Файл слишком большой. Максимум ${MAX_ATTACHMENT_SIZE_LABEL}.`;
  }
  return null;
}

export function createStagedAttachment(file: File): StagedAttachment {
  const id = safeUuid();
  const kind = getAttachmentKind(file);
  const previewUrl = kind === "image" || kind === "video" ? URL.createObjectURL(file) : null;

  return {
    id,
    file,
    kind,
    previewUrl,
    name: file.name || fallbackFileName(file),
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    status: "staged",
    progress: null,
    error: null,
    clientMessageId: safeUuid(),
    uploaded: null,
  };
}

export function createStagedVoiceAttachment(blob: Blob, durationMs: number, mimeType: string): StagedAttachment {
  const ext = MIME_EXTENSIONS[mimeType] ?? (mimeType.includes("mp4") ? "mp4" : "webm");
  const file = new File([blob], `voice-${timestampLabel()}.${ext}`, {
    type: mimeType || blob.type || "audio/webm",
    lastModified: Date.now(),
  });
  const id = safeUuid();

  return {
    id,
    file,
    kind: "voice",
    previewUrl: URL.createObjectURL(file),
    name: "Голосовое сообщение",
    size: file.size,
    mimeType: file.type || "audio/webm",
    status: "staged",
    progress: null,
    error: null,
    clientMessageId: safeUuid(),
    uploaded: null,
    durationMs,
  };
}

export function createStagedVideoMessageAttachment(blob: Blob, durationMs: number, mimeType: string): StagedAttachment {
  const ext = MIME_EXTENSIONS[mimeType] ?? (mimeType.includes("mp4") ? "mp4" : "webm");
  const file = new File([blob], `video-message-${timestampLabel()}.${ext}`, {
    type: mimeType || blob.type || "video/webm",
    lastModified: Date.now(),
  });
  const id = safeUuid();

  return {
    id,
    file,
    kind: "video_message",
    previewUrl: URL.createObjectURL(file),
    name: "Видео-сообщение",
    size: file.size,
    mimeType: file.type || "video/webm",
    status: "staged",
    progress: null,
    error: null,
    clientMessageId: safeUuid(),
    uploaded: null,
    durationMs,
  };
}

export function normalizeClipboardFile(file: File): File {
  if (!file.type.startsWith("image/")) return file;
  const genericImageName = /^image\.(png|jpe?g|webp|gif)$/i.test(file.name);
  if (file.name && !genericImageName) return file;
  return new File([file], fallbackScreenshotName(file.type), {
    type: file.type,
    lastModified: Date.now(),
  });
}

export function getAttachmentKind(file: File): StagedAttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

export function chatAttachmentUploadPath(chatId: string, userId: string, attachment: StagedAttachment): string {
  const ext = fileExtension(attachment.file);
  // Keep the first path segment as userId: existing Storage RLS for the media
  // bucket allows authenticated users to write inside their own folder.
  return `${userId}/${Date.now()}-${chatId}-${attachment.id}.${ext}`;
}

export function revokeAttachmentPreview(attachment: Pick<StagedAttachment, "previewUrl">): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
}

function fileExtension(file: File): string {
  const byName = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : null;
  if (byName && /^[a-z0-9]{1,8}$/.test(byName)) return byName;
  return MIME_EXTENSIONS[file.type] ?? "bin";
}

function fallbackFileName(file: File): string {
  const ext = fileExtension(file);
  const prefix =
    file.type.startsWith("image/") ? "image"
    : file.type.startsWith("video/") ? "video"
    : file.type.startsWith("audio/") ? "audio"
    : "file";
  return `${prefix}-${timestampLabel()}.${ext}`;
}

function fallbackScreenshotName(mimeType: string): string {
  const ext = MIME_EXTENSIONS[mimeType] ?? "png";
  return `screenshot-${timestampLabel()}.${ext}`;
}

function timestampLabel(): string {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ];
  return parts.join("");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
