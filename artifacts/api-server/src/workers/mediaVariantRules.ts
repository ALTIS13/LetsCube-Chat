import { createHash } from "node:crypto";

export {
  VIDEO_720P_ENCODING,
  mediaVariantWorkerTestSeams,
} from "./mediaVariantsWorkerHelpers";

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

const VARIANT_ERROR_CODES = new Set(["enoent", "etimedout", "video_probe_failed"]);

export const AVATAR_VARIANTS = [
  { kind: "avatar_128", size: 128, quality: 78 },
  { kind: "avatar_256", size: 256, quality: 82 },
] as const;

export type AvatarVariantKind = (typeof AVATAR_VARIANTS)[number]["kind"];
export type MessageImageVariantKind = (typeof MESSAGE_IMAGE_VARIANTS)[number]["kind"];
export type MessageVideoVariantKind = (typeof MESSAGE_VIDEO_VARIANTS)[number]["kind"];
export type MessageVariantKind = MessageImageVariantKind | MessageVideoVariantKind;

export interface CandidatePageRange {
  from: number;
  to: number;
}

export function buildCandidatePageRanges(
  pageSizeValue: number,
  scanLimitValue: number,
): CandidatePageRange[] {
  const pageSize = Math.max(1, Math.floor(pageSizeValue));
  const scanLimit = Math.max(1, Math.floor(scanLimitValue));
  const ranges: CandidatePageRange[] = [];
  for (let from = 0; from < scanLimit; from += pageSize) {
    ranges.push({ from, to: Math.min(from + pageSize, scanLimit) - 1 });
  }
  return ranges;
}

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

/**
 * Where a profile's small avatar lives.
 *
 * Unlike a message variant this path is reused: changing your picture
 * overwrites it rather than minting a new name. That is why it gets the
 * shorter cache lifetime and why the client versions the URL — see
 * `artifacts/kub/src/lib/mediaCacheControl.ts`.
 */
export function buildProfileAvatarVariantPath(profileId: string, kind: AvatarVariantKind): string {
  return `variants/profiles/${profileId}/${kind}.webp`;
}

/**
 * The unguessable half of an avatar's address, carried over from the original.
 *
 * A chat's picture is uploaded to `chat-avatars/{chatId}/avatar-{uuid}.png`,
 * and that random stem is the only thing keeping it private: the file is served
 * publicly, and `chats` — the one place the address is written down — is
 * readable through `Chat members can view chats` and nothing else. So a
 * non-member holding a chat id cannot reach the picture.
 *
 * A variant addressed by chat id alone would hand exactly that back, and
 * scoping the variant *row* to members would not help, because the row is not
 * what serves the bytes. Deriving the folder from the source path keeps the
 * variant precisely as hard to find as the picture it was made from.
 *
 * A hash rather than the original's stem: it does not assume the upload naming
 * stays random, which is the kind of assumption that would fail silently and
 * publicly. Deterministic, so re-running the worker reuses the same address,
 * and a new picture — always a new source path — gets a new one.
 */
export function avatarPathToken(sourcePath: string): string {
  return createHash("sha256").update(sourcePath).digest("hex").slice(0, 32);
}

/**
 * Where a chat's own small avatar lives.
 *
 * A group or channel picture, not a person's. Same geometry and quality as a
 * profile's, but not the same addressing: see `avatarPathToken`. Because the
 * folder changes with the picture, this path is never overwritten in place, so
 * unlike a profile's it is immutable and needs no version token.
 */
export function buildChatAvatarVariantPath(
  chatId: string,
  kind: AvatarVariantKind,
  sourcePath: string,
): string {
  return `variants/chats/${chatId}/${avatarPathToken(sourcePath)}/${kind}.webp`;
}
