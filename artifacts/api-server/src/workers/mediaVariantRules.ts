export const MESSAGE_IMAGE_VARIANTS = [
  { kind: "image_thumb", max: 360, quality: 76 },
  { kind: "image_preview", max: 1280, quality: 82 },
] as const;

export const VIDEO_POSTER_VARIANT = { kind: "video_poster", max: 720, quality: 78 } as const;
export const VIDEO_720P_VARIANT = { kind: "video_720p", extension: "mp4", mimeType: "video/mp4" } as const;

export const MESSAGE_VIDEO_VARIANTS = [
  VIDEO_POSTER_VARIANT,
  VIDEO_720P_VARIANT,
] as const;

export const VIDEO_720P_ENCODING = {
  width: 1280,
  height: 720,
  preset: "veryfast",
  crf: 24,
  maxRate: "3M",
  bufferSize: "6M",
  audioBitrate: "128k",
  pixelFormat: "yuv420p",
  fastStart: true,
} as const;

const VARIANT_ERROR_CODES = new Set(["enoent", "etimedout", "video_probe_failed"]);

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

export function getMissingMessageVariantKinds(
  message: { type?: string | null },
  readyKinds: ReadonlySet<string>,
): MessageVariantKind[] {
  return getExpectedMessageVariantKinds(message).filter((kind) => !readyKinds.has(kind));
}

export function sanitizeVariantErrorCode(value: unknown): string {
  if (typeof value !== "string") return "variant_generation_failed";
  const normalized = value.toLowerCase();
  if (!/^[a-z0-9_]{1,80}$/.test(normalized)) return "variant_generation_failed";
  return VARIANT_ERROR_CODES.has(normalized) ? normalized : "variant_generation_failed";
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
