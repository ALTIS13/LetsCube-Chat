/**
 * How a compressed photo is encoded, how large it comes out, and what it is
 * called: the decisions of the iPhone photo path (D-114, D-116).
 *
 * WebKit hands a page a picked photo in its original format, so on an iPhone a
 * camera photo arrives as HEIC and a screenshot as PNG. The compressed path went
 * wrong there in three ways, and in a fourth everywhere:
 *
 * - It asked the canvas for WebP. An engine that cannot write a type returns a
 *   PNG instead, as the HTML standard requires, and Safari on Apple platforms
 *   most likely cannot write WebP. Those PNG bytes were typed `image/webp` and
 *   named `*.webp`.
 * - It left a HEIC as picked: the worker cannot make previews of one, and
 *   Chromium cannot show one at all.
 * - It re-encoded a small JPEG and then kept the JPEG it started from, because
 *   the result was no smaller — an encode for nothing — and it decoded every
 *   photo twice, once to encode it and once more to measure it.
 * - A tall screenshot came out thin: 1290x2796 became 886x1920, and a phone at
 *   3x stretched that across the viewer.
 *
 * So the engine is asked once whether it really writes WebP, and JPEG at 0.85
 * is used where it does not; the output is named and typed from the bytes the
 * engine wrote; a HEIC goes through the canvas wherever the engine can decode
 * it; a small JPEG that needs no resize is not re-encoded into JPEG; and the
 * long side is capped as before, but not by taking the short side under
 * 1080 px when the source had that much.
 *
 * Imports nothing, so `node --test` loads it directly:
 * `tests/unit/photo-encoding.test.mts`.
 */

export const WEBP_TYPE = "image/webp";
export const JPEG_TYPE = "image/jpeg";
export const PNG_TYPE = "image/png";

/** What a photo is written as where the engine has no WebP encoder. */
export const JPEG_FALLBACK_QUALITY = 0.85;

/** A compressed photo keeps at least this much of its short side, when the source has it. */
export const PHOTO_MIN_SHORT_SIDE = 1080;

/**
 * Whatever the short side asks for, the long side stops here. A scrolling
 * capture 1080x20000 would otherwise go up whole, and a canvas that large is
 * past what an iPhone will allocate.
 */
export const PHOTO_MAX_LONG_SIDE = 4096;

/**
 * A JPEG at or under this many bytes per pixel — 2 bits — is already about as
 * dense as a JPEG written at 0.85, so writing it again as JPEG saves next to
 * nothing and adds a second generation of loss. Measured on a 1280x960 ladder
 * in Chromium and in Playwright's WebKit: re-encoding at 0.85 came out 3%
 * larger from 0.21 bytes per pixel and 5% smaller from 0.26, and only from 0.36
 * did it save a third.
 */
export const KEEP_JPEG_MAX_BYTES_PER_PIXEL = 0.25;

const RECODABLE_TYPES: ReadonlySet<string> = new Set([JPEG_TYPE, PNG_TYPE, WEBP_TYPE]);
const HEIF_TYPES: ReadonlySet<string> = new Set(["image/heic", "image/heif"]);
const EXTENSIONS: Readonly<Record<string, string>> = {
  [JPEG_TYPE]: "jpg",
  [PNG_TYPE]: "png",
  [WEBP_TYPE]: "webp",
};

export function normalizeImageType(type: string | null | undefined): string {
  return (type ?? "").trim().toLowerCase();
}

export function isHeifType(type: string | null | undefined): boolean {
  return HEIF_TYPES.has(normalizeImageType(type));
}

/**
 * What the compressed path puts through the canvas: what every engine decodes,
 * and a HEIC, which is tried — an engine that cannot decode it keeps the file as
 * picked, as before. A GIF stays out: a still frame would stop its animation.
 */
export function isCanvasPhotoCandidate(type: string | null | undefined): boolean {
  const normalized = normalizeImageType(type);
  return RECODABLE_TYPES.has(normalized) || HEIF_TYPES.has(normalized);
}

/**
 * Whether an encoder probe shows the engine wrote the type it was asked for.
 * An engine that cannot write a type answers with a PNG, so the answer's own
 * type is the only honest test; an empty type proves nothing.
 */
export function encoderWroteType(blobType: string | null | undefined, requestedType: string): boolean {
  const written = normalizeImageType(blobType);
  return written !== "" && written === normalizeImageType(requestedType);
}

/** What the canvas is asked to write: WebP at the profile's quality where the engine writes it, JPEG otherwise. */
export function compressedPhotoEncoding(input: {
  webpEncodes: boolean;
  webpQuality: number;
}): { type: string; quality: number } {
  return input.webpEncodes
    ? { type: WEBP_TYPE, quality: input.webpQuality }
    : { type: JPEG_TYPE, quality: JPEG_FALLBACK_QUALITY };
}

export interface PhotoSize {
  width: number;
  height: number;
  /** False when the photo keeps the size it has. */
  resized: boolean;
}

/**
 * The size a compressed photo comes out at, from the one decode's size.
 *
 * The long side is capped at `maxLongSide`, as it always was — unless that
 * would take the short side under `PHOTO_MIN_SHORT_SIDE`. Then the short side
 * keeps 1080 px, or all of itself when the source has less, and the long side
 * follows it up to `PHOTO_MAX_LONG_SIDE`. A photo is never enlarged.
 *
 * 4032x3024 -> 1920x1440, as before. 1290x2796 -> 1080x2341, not 886x1920.
 */
export function compressedPhotoSize(width: number, height: number, maxLongSide: number): PhotoSize {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: Math.max(1, Math.round(width) || 1), height: Math.max(1, Math.round(height) || 1), resized: false };
  }
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const capped = maxLongSide / longSide;
  const keepsShortSide = Math.min(1, PHOTO_MIN_SHORT_SIDE / shortSide);
  const ceiling = Math.max(maxLongSide, PHOTO_MAX_LONG_SIDE) / longSide;
  const scale = Math.min(1, Math.max(capped, keepsShortSide), ceiling);
  const nextWidth = Math.max(1, Math.round(width * scale));
  const nextHeight = Math.max(1, Math.round(height * scale));
  return {
    width: nextWidth,
    height: nextHeight,
    resized: nextWidth !== Math.round(width) || nextHeight !== Math.round(height),
  };
}

/**
 * Whether a picked JPEG goes as it is instead of through the canvas.
 *
 * Only when nothing about it needs changing and the only encoder there is
 * JPEG: it needs no resize, and it is small — no denser than the encoder would
 * make it. Where the engine writes WebP the encode still earns its keep, and is
 * kept only when it comes out smaller, as before.
 */
export function shouldKeepPickedJpeg(input: {
  type: string | null | undefined;
  size: number;
  width: number;
  height: number;
  resized: boolean;
  outputType: string;
}): boolean {
  if (normalizeImageType(input.type) !== JPEG_TYPE) return false;
  if (normalizeImageType(input.outputType) !== JPEG_TYPE) return false;
  if (input.resized) return false;
  const pixels = input.width * input.height;
  if (!(pixels > 0) || !(input.size > 0)) return false;
  return input.size <= pixels * KEEP_JPEG_MAX_BYTES_PER_PIXEL;
}

/**
 * Whether the encoded file replaces the one that was picked.
 *
 * A smaller file does, as before. A HEIC is replaced even by a larger one: kept
 * as it was picked it gets no previews and Chromium cannot draw it.
 */
export function preferEncodedPhoto(input: {
  sourceType: string | null | undefined;
  sourceSize: number;
  encodedSize: number;
}): boolean {
  if (!(input.encodedSize > 0)) return false;
  if (isHeifType(input.sourceType)) return true;
  return input.encodedSize < input.sourceSize;
}

export function extensionForImageType(type: string | null | undefined): string | null {
  return EXTENSIONS[normalizeImageType(type)] ?? null;
}

function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : dot === 0 ? "" : name;
}

/**
 * The name and type an encoded file carries, from the bytes the engine actually
 * wrote — never from what it was asked for. Null for a type this cannot name,
 * and then the picked file is kept.
 *
 * `IMG_0042.HEIC` written as JPEG is `IMG_0042-image.jpg`, `image/jpeg`.
 */
export function encodedFileIdentity(
  sourceName: string,
  suffix: string,
  blobType: string | null | undefined,
): { name: string; type: string } | null {
  const type = normalizeImageType(blobType);
  const extension = extensionForImageType(type);
  if (!extension) return null;
  return { name: `${fileStem(sourceName) || suffix}-${suffix}.${extension}`, type };
}
