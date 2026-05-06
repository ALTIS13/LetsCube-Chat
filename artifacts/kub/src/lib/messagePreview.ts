import type { Message } from "@/types/database";

export function formatChatMessagePreview(message: Pick<Message, "type" | "content" | "media_url" | "deleted_at"> | null | undefined): string {
  if (!message) return "";
  if (message.deleted_at) return "Сообщение удалено";
  if (isGifMessage(message)) return "GIF";
  if (message.type === "image") return "Фото";
  if (message.type === "video") return "Видео";
  if (message.type === "audio") return "Голосовое";
  if (message.type === "file") return "Файл";
  if (message.media_url && !message.content?.trim()) return "Файл";
  return message.content ?? "";
}

function isGifMessage(message: Pick<Message, "type" | "content" | "media_url">): boolean {
  if (message.type !== "image") return false;
  const source = `${message.content ?? ""} ${message.media_url ?? ""}`.toLowerCase();
  return source.includes(".gif") || source.includes("image/gif");
}
