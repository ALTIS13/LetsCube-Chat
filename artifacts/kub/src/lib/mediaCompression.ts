/**
 * Whether a photo or a video goes compressed or as the original, and every
 * decision that follows from that choice.
 *
 * Testers' complaint 2: photos and videos could only be sent compressed. A
 * picture was re-encoded on the canvas to a 1920px WebP whatever the sender
 * picked — through «Фото или видео», through «Файл», pasted or dropped — so the
 * original never left the device, and «Открыть оригинал» opened the copy.
 *
 * Approved by the owner, as in Telegram: compressed stays the default, and no
 * quality is ever asked for (D-119). «Файл» in the attach menu sends as it is,
 * on every device, and says «Без сжатия». On a desktop a photo or a video that
 * arrives any other way — «Фото или видео», pasted, dropped — opens a send
 * dialog with «Сжать изображение», checked by default. An original goes as it
 * is — no resize, no re-encode — up to 50 MB a file, with a light preview
 * uploaded beside it so the conversation does not download the original to
 * draw a bubble.
 *
 * Nothing here touches the DOM, the network or React, and the only imports are
 * other modules that import nothing, so `node --test` loads it directly:
 * `tests/unit/media-compression.test.mts`.
 */

import { MEDIA_QUALITY_METADATA_KEY, type MediaQuality } from "./mediaQuality.ts";
import { selectRussianPluralForm } from "./messageMediaSections.ts";
import { JPEG_TYPE, WEBP_TYPE, isCanvasPhotoCandidate } from "./photoEncoding.ts";
import {
  MAX_VIDEO_ATTACHMENT_BYTES,
  MAX_VIDEO_ATTACHMENT_SIZE_LABEL,
  type StagedAttachmentKind,
} from "./stagedAttachments.ts";

const MiB = 1024 * 1024;

/** An original is refused above this, before any upload starts. */
export const MAX_ORIGINAL_ATTACHMENT_BYTES = 50 * MiB;
// A non-breaking space, here and in every message below: a number is never left
// at the end of a line without its unit, and a quoted control name is never
// split across two.
export const MAX_ORIGINAL_ATTACHMENT_SIZE_LABEL = "50\u00a0МБ";

/**
 * The preview beside an original: the same size and quality as the server's
 * `image_preview` variant (`MESSAGE_IMAGE_VARIANTS` and `imagePreviewSize` in
 * `artifacts/api-server/src/workers/mediaVariantRules.ts`), so the bubble does
 * not change when the worker's copy takes over.
 */
export const ORIGINAL_PREVIEW_MAX_DIMENSION = 1280;
/**
 * What a tall picture's width keeps, when the source has it (D-116).
 *
 * A long-side cap on its own makes a tall picture thin: 1290x2796 came out
 * 591x1280, and the reader was shown it stretched to fill the bubble.
 *
 * The number is the bubble's own box in device pixels on the phone the tester
 * holds: 430 CSS px of screen gives a 310 px bubble, and a phone has three
 * device pixels to the point. A picture taller than 2:1 is drawn 310x550 CSS —
 * 930x1650 — and 930 across the short side carries a 0.5 picture to 1860 down
 * the long one, so neither axis is enlarged. On a phone wider than about
 * 480 CSS px the bubble reaches its own cap of 360 px and a tall preview is
 * then drawn about 1.16x up; that is the one case left, and it is small.
 *
 * It floors the short side only when the short side is the width — when the
 * picture is taller than it is wide. A landscape picture fills the bubble with
 * its long side, which the cap already leaves at 1280, comfortably past 930;
 * flooring its short side would only buy height the bubble never draws. That is
 * why 4:3, 16:9 and a panorama are all sized exactly as they were.
 */
export const ORIGINAL_PREVIEW_MIN_SHORT_SIDE = 930;
/** Whatever the short side asks for, the long side stops here: a preview is not a second original. */
export const ORIGINAL_PREVIEW_MAX_LONG_SIDE = 2560;
export const ORIGINAL_PREVIEW_QUALITY = 0.82;
/** What a preview is written as. An engine that cannot write WebP writes a JPEG, and the preview says so. */
export const ORIGINAL_PREVIEW_MIME_TYPE = WEBP_TYPE;
/** Below this an original small enough to fit is its own preview. */
export const ORIGINAL_PREVIEW_MIN_SOURCE_BYTES = 512 * 1024;

/**
 * What the canvas can re-encode. A GIF is left alone because a still WebP would
 * stop its animation; HEIC and the rest cannot be decoded by every browser.
 */
const RECODABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type MediaSendShape = "phone" | "desktop";
export type IncomingFilesSource = "picker" | "paste" | "drop" | "camera";
export type AttachmentPreparation = "compress" | "original" | "as-is";
function normalizedType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").trim().toLowerCase();
}

/** A photo or a video: the kinds a compression choice means anything for. */
export function isCompressibleMediaType(mimeType: string | null | undefined): boolean {
  const type = normalizedType(mimeType);
  return type.startsWith("image/") || type.startsWith("video/");
}

/**
 * Which way a picked file is prepared.
 *
 * - `compress`: re-encoded on the canvas, as every picture was before. A HEIC
 *   is tried too — an iPhone hands its camera photos over as HEIC — and an
 *   engine that cannot decode one sends it as picked (`lib/photoEncoding.ts`).
 * - `original`: the picked bytes, marked as the original, with nothing taken
 *   out of them but the place they were taken (`lib/mediaLocation.ts`).
 * - `as-is`: untouched because there is nothing to choose — a document, a
 *   sound, a GIF, or a video, which the server compresses with its 720p copy.
 */
export function planAttachmentPreparation(
  mimeType: string | null | undefined,
  compress: boolean,
): AttachmentPreparation {
  const type = normalizedType(mimeType);
  if (!compress) return isCompressibleMediaType(type) ? "original" : "as-is";
  return isCanvasPhotoCandidate(type) ? "compress" : "as-is";
}

export function exceedsOriginalLimit(sizeBytes: number): boolean {
  return sizeBytes > MAX_ORIGINAL_ATTACHMENT_BYTES;
}

/**
 * What of a pick asked for as it is can go, and what is refused. Only a photo or
 * a video has an original to refuse: «Файл» takes any file (D-119), and a
 * document over its own limit is refused by the check every attachment meets,
 * in that check's words.
 */
export function splitByOriginalLimit<T extends { size: number; type: string }>(files: readonly T[]): { within: T[]; over: T[] } {
  const within: T[] = [];
  const over: T[] = [];
  for (const file of files) {
    (isCompressibleMediaType(file.type) && exceedsOriginalLimit(file.size) ? over : within).push(file);
  }
  return { within, over };
}

/** Whole megabytes, rounded up, so a file over the limit never prints as the limit. */
export function formatSizeRoundedUp(sizeBytes: number): string {
  return `${Math.ceil(sizeBytes / MiB)}\u00a0МБ`;
}

function keepTogether(text: string): string {
  return text.replace(/ /g, "\u00a0");
}

/** The name of a control, quoted as the interface writes it. */
function controlName(text: string): string {
  return `«${keepTogether(text)}»`;
}

/**
 * What to tell a person whose original is over the limit, or null when it is not.
 *
 * It names the file and its size, the limit, and the way out that exists on the
 * screen in front of them: from the menu the compressed choice is the menu's
 * other item, in the dialog it is the box. A video that compression cannot
 * rescue either is not offered compression.
 */
export function originalLimitMessage(
  file: { name: string; size: number; type: string },
): string | null {
  if (!exceedsOriginalLimit(file.size)) return null;
  const video = normalizedType(file.type).startsWith("video/");
  const subject = video ? "это видео" : "это фото";
  // A dash is kept on the line of the word before it, and «до» on the line of
  // its number: rendered, «— до | 50 МБ» had left the preposition hanging.
  const problem = `${file.name || "Файл"}\u00a0— ${formatSizeRoundedUp(file.size)}. Без сжатия можно отправить файл до\u00a0${MAX_ORIGINAL_ATTACHMENT_SIZE_LABEL}`;
  if (video && file.size > MAX_VIDEO_ATTACHMENT_BYTES) {
    const remedy = "Сократите видео и попробуйте снова.";
    return `${problem}, со сжатием\u00a0— видео до\u00a0${keepTogether(MAX_VIDEO_ATTACHMENT_SIZE_LABEL)}. ${remedy}`;
  }
  // On the sheet the gallery's own send button is the compressed way.
  return `${problem}. Со сжатием ${subject} можно отправить из ${controlName("Галереи")}.`;
}

export function originalLimitAlertTitle(count: number): string {
  return count > 1
    ? `Файлы больше ${MAX_ORIGINAL_ATTACHMENT_SIZE_LABEL}`
    : `Файл больше ${MAX_ORIGINAL_ATTACHMENT_SIZE_LABEL}`;
}

/** Whether an original needs a lighter picture beside it for the conversation. */
export function shouldBuildOriginalPreview(input: {
  mimeType: string;
  width: number | null | undefined;
  height: number | null | undefined;
  size: number;
}): boolean {
  if (!RECODABLE_IMAGE_TYPES.has(normalizedType(input.mimeType))) return false;
  const longSide = Math.max(input.width ?? 0, input.height ?? 0);
  if (!(longSide > 0)) return true;
  return longSide > ORIGINAL_PREVIEW_MAX_DIMENSION || input.size > ORIGINAL_PREVIEW_MIN_SOURCE_BYTES;
}

/**
 * The preview's size, with the same rounding the canvas encoder uses.
 *
 * The long side stops at `max`, as it always did — unless the picture is taller
 * than it is wide and that would take its width under
 * `ORIGINAL_PREVIEW_MIN_SHORT_SIDE`. Then the width keeps 930 px, or all of
 * itself when the source has less, and the long side follows it up to
 * `ORIGINAL_PREVIEW_MAX_LONG_SIDE`. A preview is never enlarged.
 *
 * 4032x3024 -> 1280x960, as before, and so is every landscape picture.
 * 1080x2341 -> 930x2016, not 591x1280.
 *
 * The same arithmetic as `imagePreviewSize` in
 * `artifacts/api-server/src/workers/mediaVariantRules.ts`, which is what the
 * bubble ends up drawing once the worker's copy is ready. The two have to agree
 * or the picture changes size under the reader.
 */
export function originalPreviewDimensions(
  width: number,
  height: number,
  max = ORIGINAL_PREVIEW_MAX_DIMENSION,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: Math.max(1, Math.round(width) || 1), height: Math.max(1, Math.round(height) || 1) };
  }
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const capped = max / longSide;
  // Only a picture taller than it is wide fills the bubble with its short side;
  // a landscape one fills it with the long side the cap already keeps.
  const keepsDrawnWidth =
    height > width ? Math.min(1, ORIGINAL_PREVIEW_MIN_SHORT_SIDE / shortSide) : 0;
  const ceiling = Math.max(max, ORIGINAL_PREVIEW_MAX_LONG_SIDE) / longSide;
  const scale = Math.min(1, Math.max(capped, keepsDrawnWidth), ceiling);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Where an original's preview is stored: beside it, same stem.
 *
 * Derived rather than chosen, and that is the security of it. The storage
 * policy lets a person write only inside their own folder, and a reader accepts
 * a preview only at exactly this address — so metadata, which the sender's
 * client writes, cannot point a bubble at anything but the sender's own upload.
 *
 * The extension is the preview's real type: `.preview.webp`, or `.preview.jpg`
 * from an engine that cannot write WebP, whose preview used to be a PNG stored
 * under `.webp`.
 */
export function originalPreviewPath(mediaPath: string, previewType: string = ORIGINAL_PREVIEW_MIME_TYPE): string {
  const slash = mediaPath.lastIndexOf("/");
  const folder = slash >= 0 ? mediaPath.slice(0, slash + 1) : "";
  const name = mediaPath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${folder}${stem}.preview.${normalizedType(previewType) === JPEG_TYPE ? "jpg" : "webp"}`;
}

/** The type a preview is recorded as: JPEG when it is one, WebP otherwise, as `originalPreviewPath` names it. */
export function originalPreviewMimeType(previewType: string | null | undefined): string {
  return normalizedType(previewType) === JPEG_TYPE ? JPEG_TYPE : ORIGINAL_PREVIEW_MIME_TYPE;
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null;
}

function isPositiveDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Whether a message's media was sent as the original. */
export function isUncompressedMedia(metadata: unknown): boolean {
  return metadataRecord(metadata)?.uncompressed === true;
}

export interface OriginalPreview {
  path: string;
  width: number;
  height: number;
}

/**
 * The preview of an original photo, if the message carries a valid one.
 *
 * Only a photo marked as an original, stored in a bucket, with its preview at
 * the address derived from its own path. The caller turns the path into a URL
 * in the message's bucket; nothing here ever reads a URL from metadata.
 */
export function readOriginalPreview(message: {
  type: string | null;
  media_bucket: string | null;
  media_path: string | null;
  media_metadata: unknown;
}): OriginalPreview | null {
  if (message.type !== "image" || !message.media_bucket || !message.media_path) return null;
  const metadata = metadataRecord(message.media_metadata);
  if (!metadata || metadata.uncompressed !== true) return null;
  const preview = metadataRecord(metadata.preview);
  if (!preview) return null;
  const { path, width, height } = preview;
  if (typeof path !== "string" || path.startsWith("/")) return null;
  if (path.split("/").some((segment) => segment === ".." || segment === ".")) return null;
  const mediaPath = message.media_path;
  if (![WEBP_TYPE, JPEG_TYPE].some((type) => path === originalPreviewPath(mediaPath, type))) return null;
  if (!isPositiveDimension(width) || !isPositiveDimension(height)) return null;
  return { path, width, height };
}

export interface MediaMetadataSource {
  kind: StagedAttachmentKind;
  mimeType: string;
  size: number;
  originalSize?: number;
  originalMimeType?: string;
  optimized?: boolean;
  width?: number;
  height?: number;
  mediaQuality?: MediaQuality;
  durationMs?: number;
  uncompressed?: boolean;
  previewFile?: { size: number; type?: string } | null;
  previewWidth?: number;
  previewHeight?: number;
}

/**
 * The `media_metadata` a staged attachment is sent with.
 *
 * Every key a message already carried keeps its meaning. A photo or a video now
 * also says `uncompressed`, true only for an original; an original video plays
 * the original whatever quality was chosen for compressed ones; and an original
 * photo names its preview once that preview is actually in storage.
 */
export function buildAttachmentMediaMetadata(
  attachment: MediaMetadataSource,
  upload: { path: string; previewPath?: string | null } | null,
): Record<string, unknown> | undefined {
  if (attachment.kind === "video_message") {
    return withoutUndefined({
      kind: "video_message",
      shape: "round",
      duration_ms: attachment.durationMs ?? null,
      mime_type: attachment.mimeType,
      size_bytes: attachment.size,
      [MEDIA_QUALITY_METADATA_KEY]: attachment.mediaQuality,
    });
  }
  if (
    attachment.kind !== "image" &&
    attachment.kind !== "video" &&
    attachment.kind !== "audio" &&
    attachment.kind !== "file"
  ) {
    return undefined;
  }

  const visual = attachment.kind === "image" || attachment.kind === "video";
  const uncompressed = visual && attachment.uncompressed === true;
  const metadata: Record<string, unknown> = {
    kind: attachment.kind,
    mime_type: attachment.mimeType,
    size_bytes: attachment.size,
    original_size_bytes: attachment.originalSize ?? attachment.size,
    original_mime_type: attachment.originalMimeType ?? null,
    optimized: attachment.optimized ?? false,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
  };
  if (!visual) return metadata;

  const quality = attachment.kind === "video" && uncompressed ? "original" : attachment.mediaQuality;
  if (quality !== undefined) metadata[MEDIA_QUALITY_METADATA_KEY] = quality;
  metadata.uncompressed = uncompressed;

  if (
    uncompressed &&
    attachment.kind === "image" &&
    upload?.previewPath &&
    attachment.previewFile &&
    isPositiveDimension(attachment.previewWidth) &&
    isPositiveDimension(attachment.previewHeight)
  ) {
    metadata.preview = {
      path: upload.previewPath,
      width: attachment.previewWidth,
      height: attachment.previewHeight,
      mime_type: originalPreviewMimeType(attachment.previewFile.type),
      size_bytes: attachment.previewFile.size,
    };
  }
  return metadata;
}

function withoutUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export type MatchMedia = (query: string) => { matches: boolean };

/**
 * A phone or a desktop, for this choice.
 *
 * Decided by the pointer, not the width: a phone held sideways is still a phone,
 * and a narrow desktop window is still a desktop. The installed iPhone app and
 * the Android shell report a coarse pointer; the Windows client a fine one.
 */
export function mediaSendShape(matchMedia: MatchMedia | null | undefined): MediaSendShape {
  try {
    return matchMedia?.("(pointer: coarse)").matches ? "phone" : "desktop";
  } catch {
    return "desktop";
  }
}

const FILE_FORMS = ["файл", "файла", "файлов"] as const;

/** The send button's name on the attach sheet: «Отправить 2 фото», «Отправить видео», «Отправить 3 файла». */
export function mediaSendTitle(files: ReadonlyArray<{ type: string }>): string {
  const count = files.length;
  const allOf = (prefix: string) => count > 0 && files.every((file) => normalizedType(file.type).startsWith(prefix));
  // «фото» and «видео» do not decline, so the count needs no agreement.
  const noun = allOf("image/") ? "фото" : allOf("video/") ? "видео" : null;
  if (noun) return count === 1 ? `Отправить ${noun}` : `Отправить ${count} ${noun}`;
  return count === 1 ? "Отправить файл" : `Отправить ${count} ${selectRussianPluralForm(count, FILE_FORMS)}`;
}
