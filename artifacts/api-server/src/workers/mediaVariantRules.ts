import { createHash } from "node:crypto";

export {
  VIDEO_720P_ENCODING,
  TERMINAL_VARIANT_ERROR_CODES,
  isMissingStorageObjectError,
  isUnreadableSourceError,
  shouldAttemptVariantKind,
  mediaVariantWorkerTestSeams,
} from "./mediaVariantsWorkerHelpers";
export type { RecordedVariantAttempt } from "./mediaVariantsWorkerHelpers";

import {
  isUnreadableSourceError,
  shouldAttemptVariantKind,
  type RecordedVariantAttempt,
} from "./mediaVariantsWorkerHelpers";

export const MESSAGE_IMAGE_VARIANTS = [
  { kind: "image_thumb", max: 360, quality: 76 },
  { kind: "image_preview", max: 1280, quality: 82 },
] as const;

/**
 * What a tall `image_preview`'s width keeps, when the source has it (D-116).
 *
 * A long-side cap on its own makes a tall picture thin: a 1080x2341 screenshot
 * came out 591x1280, and the reader was shown it stretched to fill the bubble.
 *
 * The number is the bubble's own box in device pixels on the phone the tester
 * holds: 430 CSS px of screen gives a 310 px bubble, three device pixels to the
 * point, and the bubble stops at 550 CSS px tall — 930x1650. A picture taller
 * than 2:1 kept at 930 across carries to 1860 down, so neither axis is
 * enlarged.
 *
 * It floors the short side only when the short side is the width — when the
 * picture is taller than it is wide. A landscape picture fills the bubble with
 * its long side, which the cap already leaves at 1280; flooring its short side
 * would only buy height the bubble never draws. So 4:3, 16:9 and a panorama are
 * sized exactly as they were.
 *
 * Must stay the same rule as `originalPreviewDimensions` in
 * `artifacts/kub/src/lib/mediaCompression.ts`.
 */
export const IMAGE_PREVIEW_MIN_SHORT_SIDE = 930;
/** Whatever the short side asks for, the long side stops here: a preview is not a second original. */
export const IMAGE_PREVIEW_MAX_LONG_SIDE = 2560;

/**
 * The box an `image_preview` is resized into, from the source's own size.
 *
 * The same arithmetic as `originalPreviewDimensions` in
 * `artifacts/kub/src/lib/mediaCompression.ts`, which is the preview a sender
 * uploads beside an original and which this variant replaces in the bubble once
 * it is ready. The two have to agree, or the picture changes size under the
 * reader when the worker catches up.
 *
 * Never enlarges: the caller resizes `fit: "inside"` with `withoutEnlargement`,
 * and the scale here is capped at 1 as well.
 */
export function imagePreviewSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: Math.max(1, Math.round(max) || 1), height: Math.max(1, Math.round(max) || 1) };
  }
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const capped = max / longSide;
  // Only a picture taller than it is wide fills the bubble with its short side;
  // a landscape one fills it with the long side the cap already keeps.
  const keepsDrawnWidth =
    height > width ? Math.min(1, IMAGE_PREVIEW_MIN_SHORT_SIDE / shortSide) : 0;
  const ceiling = Math.max(max, IMAGE_PREVIEW_MAX_LONG_SIDE) / longSide;
  const scale = Math.min(1, Math.max(capped, keepsDrawnWidth), ceiling);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * A source's size as `.rotate()` leaves it.
 *
 * `metadata()` reports the stored pixels and the EXIF orientation beside them,
 * so a portrait photograph from a phone arrives here as landscape numbers with
 * an orientation of 6. The preview box is asymmetric — a floor on the short
 * side — so taking the axes as stored would size a tall picture as a wide one.
 * Null when the header carries no size, and then the caller keeps the square
 * box every variant used before.
 */
export function orientedImageSize(metadata: {
  width?: number | null;
  height?: number | null;
  orientation?: number | null;
}): { width: number; height: number } | null {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!(width > 0) || !(height > 0)) return null;
  // 1 to 4 are the upright and mirrored cases; 5 to 8 carry a quarter turn.
  return (metadata.orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
}

export const VIDEO_POSTER_VARIANT = { kind: "video_poster", max: 720, quality: 78 } as const;
export const VIDEO_720P_VARIANT = { kind: "video_720p", extension: "mp4", mimeType: "video/mp4" } as const;

export const MESSAGE_VIDEO_VARIANTS = [
  VIDEO_POSTER_VARIANT,
  VIDEO_720P_VARIANT,
] as const;

const VARIANT_ERROR_CODES = new Set([
  "enoent",
  "etimedout",
  "video_probe_failed",
  // Terminal: see TERMINAL_VARIANT_ERROR_CODES. Both have to survive
  // sanitizing, or the row would record `variant_generation_failed` and the
  // candidate loader would keep retrying the thing it just gave up on.
  "source_missing",
  "source_unreadable",
]);

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

/**
 * The bounded code to record for a failed variant.
 *
 * Ahead of the existing `code`/`name` reading because libvips carries neither:
 * a picture it cannot decode arrives as a bare `Error` whose name is `Error`,
 * which sanitizes to `variant_generation_failed` — true, but indistinguishable
 * from a transient failure, so the worker retried three corrupt PNGs twice a
 * minute and rewrote six `media_variants` rows each time without logging once.
 */
export function classifyVariantError(err: unknown): string {
  if (isUnreadableSourceError(err)) return "source_unreadable";
  if (err && typeof err === "object" && "code" in err) {
    return sanitizeVariantErrorCode((err as { code?: unknown }).code);
  }
  if (err instanceof Error) return sanitizeVariantErrorCode(err.name);
  return sanitizeVariantErrorCode(undefined);
}

export function sanitizeVariantErrorCode(value: unknown): string {
  if (typeof value !== "string") return "variant_generation_failed";
  const normalized = value.toLowerCase();
  if (!/^[a-z0-9_]{1,80}$/.test(normalized)) return "variant_generation_failed";
  return VARIANT_ERROR_CODES.has(normalized) ? normalized : "variant_generation_failed";
}

/**
 * The kinds this message still owes that are worth attempting now.
 *
 * `getMissingMessageVariantKinds` answers "what is not ready"; this also drops
 * what has already been proven impossible against these exact bytes. Without
 * the second half the worker rediscovers its own dead ends on every tick,
 * because it has no queue — the candidate set is a fresh scan every minute.
 */
export function getAttemptableMessageVariantKinds(
  message: { type?: string | null },
  attempts: ReadonlyMap<string, RecordedVariantAttempt> | undefined,
  source: { bucket: string; path: string },
): MessageVariantKind[] {
  const readyKinds = new Set<string>();
  for (const [kind, attempt] of attempts ?? []) {
    if (attempt.status === "ready") readyKinds.add(kind);
  }
  return getMissingMessageVariantKinds(message, readyKinds).filter((kind) =>
    shouldAttemptVariantKind(attempts?.get(kind), source),
  );
}

/** Where one message variant kind is written, and what it is written as. */
export function getMessageVariantTarget(
  chatId: string,
  messageId: string,
  kind: MessageVariantKind,
): { path: string; mimeType: string } {
  const video = MESSAGE_VIDEO_VARIANTS.find((variant) => variant.kind === kind);
  const isTranscode = video !== undefined && "extension" in video;
  return {
    path: buildMessageVariantPath(
      chatId,
      messageId,
      kind,
      isTranscode ? (video as { extension: string }).extension : "webp",
    ),
    mimeType: isTranscode ? (video as { mimeType: string }).mimeType : "image/webp",
  };
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
