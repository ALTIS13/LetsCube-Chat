import type { Message } from "@/types/database";

type PreviewMessage = Pick<Message, "type" | "content" | "media_url" | "deleted_at"> & {
  media_metadata?: Message["media_metadata"];
};

export function formatChatMessagePreview(message: PreviewMessage | null | undefined): string {
  if (!message) return "";
  if (message.deleted_at) return "Сообщение удалено";
  if (isGifMessage(message)) return "GIF";
  if (isRoundVideoMessage(message)) return "Видео-сообщение";
  if (message.type === "image") return "Фото";
  if (message.type === "video") return "Видео";
  if (message.type === "audio") return "Голосовое";
  if (message.type === "file") return "Файл";
  if (message.media_url && !message.content?.trim()) return "Файл";
  return message.content ?? "";
}

export function formatReplyMessagePreview(message: PreviewMessage | null | undefined): string {
  if (!message || message.deleted_at) return "Сообщение недоступно";
  if (isLocationMessage(message.content)) return "Местоположение";
  return formatChatMessagePreview(message) || "Сообщение";
}

function isRoundVideoMessage(message: Pick<Message, "type" | "content"> & { media_metadata?: Message["media_metadata"] }): boolean {
  return message.type === "video" && (
    getMediaMetadataString(message, "kind") === "video_message" ||
    getMediaMetadataString(message, "shape") === "round" ||
    /^Видео-сообщение(?:\s|\(|$)/i.test(message.content?.trim() ?? "")
  );
}

function getMediaMetadataString(message: { media_metadata?: Message["media_metadata"] }, key: string): string | null {
  const metadata = message.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function isGifMessage(message: Pick<Message, "type" | "content" | "media_url">): boolean {
  if (message.type !== "image") return false;
  const source = `${message.content ?? ""} ${message.media_url ?? ""}`.toLowerCase();
  return source.includes(".gif") || source.includes("image/gif");
}

function isLocationMessage(content: string | null | undefined): boolean {
  if (!content) return false;
  return /(^|\s)(📍\s*)?Местоположение:\s*https:\/\/maps\.google\.com\/\?q=/i.test(content);
}
