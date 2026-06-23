export const MESSAGE_IMAGE_VARIANTS = [
  { kind: "image_thumb", max: 360, quality: 76 },
  { kind: "image_preview", max: 1280, quality: 82 },
] as const;

export const MESSAGE_VIDEO_VARIANTS = [
  { kind: "video_poster", max: 720, quality: 78 },
] as const;

export const AVATAR_VARIANTS = [
  { kind: "avatar_128", size: 128, quality: 78 },
  { kind: "avatar_256", size: 256, quality: 82 },
] as const;

export type MessageImageVariantKind = (typeof MESSAGE_IMAGE_VARIANTS)[number]["kind"];
export type MessageVideoVariantKind = (typeof MESSAGE_VIDEO_VARIANTS)[number]["kind"];
export type MessageVariantKind = MessageImageVariantKind | MessageVideoVariantKind;

export function getExpectedMessageVariantKinds(message: { type?: string | null }): MessageVariantKind[] {
  if (message.type === "image") return MESSAGE_IMAGE_VARIANTS.map((variant) => variant.kind);
  if (message.type === "video") return MESSAGE_VIDEO_VARIANTS.map((variant) => variant.kind);
  return [];
}

export function buildMessageVariantPath(
  chatId: string,
  messageId: string,
  kind: MessageVariantKind,
  extension = "webp",
): string {
  const normalizedExtension = extension.replace(/^\./, "") || "webp";
  return `variants/messages/${chatId}/${messageId}/${kind}.${normalizedExtension}`;
}
