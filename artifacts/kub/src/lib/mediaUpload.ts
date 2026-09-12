import { DEFAULT_MEDIA_QUALITY, getImageUploadProfile, type MediaQuality } from "./mediaQuality.ts";
import {
  ORIGINAL_PREVIEW_MAX_DIMENSION,
  ORIGINAL_PREVIEW_QUALITY,
  originalPreviewDimensions,
} from "./mediaCompression.ts";
import {
  JPEG_TYPE,
  WEBP_TYPE,
  compressedPhotoEncoding,
  compressedPhotoSize,
  encodedFileIdentity,
  encoderWroteType,
  isCanvasPhotoCandidate,
  preferEncodedPhoto,
  shouldKeepPickedJpeg,
} from "./photoEncoding.ts";

const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_SOURCE_BYTES = 15 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 512;
const AVATAR_QUALITY = 0.82;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function validateAvatarImage(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Выберите файл изображения.";
  }
  if (!IMAGE_EXTENSIONS[file.type]) {
    return "Поддерживаются JPG, PNG, WEBP и GIF.";
  }
  if (file.type === "image/gif" && file.size > MAX_AVATAR_UPLOAD_BYTES) {
    return "GIF-аватар слишком большой. Максимум 2 МБ.";
  }
  if (file.size > MAX_AVATAR_SOURCE_BYTES) {
    return "Файл слишком большой. Максимум 15 МБ.";
  }
  return null;
}

export function validateAvatarUploadImage(file: File): string | null {
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    return "Не удалось ужать аватар до 2 МБ. Выберите изображение меньшего размера.";
  }
  return null;
}

export interface MediaDimensions {
  width: number;
  height: number;
}

export async function prepareAvatarImage(file: File): Promise<File> {
  if (!canOptimizeRasterImage(file)) return file;
  return optimizeRasterImage(file, {
    maxDimension: AVATAR_MAX_DIMENSION,
    quality: AVATAR_QUALITY,
    suffix: "avatar",
  });
}

export interface PreparedChatImage {
  /** What goes up: the encoded photo, or the picked file when encoding had nothing better to offer. */
  file: File;
  /** The size of `file`, from the one decode made here; null when it was not decoded. */
  dimensions: MediaDimensions | null;
}

/**
 * A chat photo, compressed. Every decision is in `lib/photoEncoding.ts`: the
 * encoder the engine really has, the name and type from the bytes it really
 * wrote, HEIC wherever it decodes, and no encode for nothing.
 *
 * The photo is decoded once, and that decode's size comes back with it, so
 * staging no longer decodes it a second time to measure it.
 */
export async function prepareChatImageAttachment(
  file: File,
  mediaQuality: MediaQuality = DEFAULT_MEDIA_QUALITY,
): Promise<PreparedChatImage> {
  if (!isCanvasPhotoCandidate(file.type) || typeof document === "undefined") return { file, dimensions: null };

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    // An engine that cannot decode it — a HEIC outside Safari — sends it as picked, as before.
    return { file, dimensions: null };
  }
  const source = normalizeDimensions(image.naturalWidth, image.naturalHeight);
  if (!source) return { file, dimensions: null };

  try {
    const profile = getImageUploadProfile(mediaQuality);
    const target = compressedPhotoSize(source.width, source.height, profile.maxDimension);
    const encoding = compressedPhotoEncoding({ webpEncodes: await canvasEncodesWebp(), webpQuality: profile.quality });
    if (shouldKeepPickedJpeg({
      type: file.type,
      size: file.size,
      width: source.width,
      height: source.height,
      resized: target.resized,
      outputType: encoding.type,
    })) {
      return { file, dimensions: source };
    }

    const blob = await drawImageToBlob(image, target, encoding);
    const identity = blob ? encodedFileIdentity(file.name, "image", blob.type) : null;
    if (!blob || !identity || !preferEncodedPhoto({ sourceType: file.type, sourceSize: file.size, encodedSize: blob.size })) {
      return { file, dimensions: source };
    }
    return {
      file: new File([blob], identity.name, { type: identity.type, lastModified: Date.now() }),
      dimensions: { width: target.width, height: target.height },
    };
  } catch {
    return { file, dimensions: source };
  }
}

/**
 * A lighter picture of an original, for the conversation to draw.
 *
 * The original itself is never touched; this is a second file uploaded beside
 * it. Null when the canvas cannot read the original, or when the preview would
 * be no lighter than the original — then the original is its own preview. A
 * preview is a WebP, or a JPEG from an engine that cannot write WebP: the two
 * addresses a reader derives (`originalPreviewPath`).
 */
export async function prepareOriginalPreview(file: File): Promise<File | null> {
  if (!canOptimizeRasterImage(file)) return null;
  const preview = await optimizeRasterImage(file, {
    maxDimension: ORIGINAL_PREVIEW_MAX_DIMENSION,
    quality: ORIGINAL_PREVIEW_QUALITY,
    suffix: "preview",
    // A rule rather than a cap: a tall picture keeps its short side (D-116).
    // `ChatWindow` writes the same numbers into the message's metadata, so both
    // have to come from this one function — otherwise the bubble is told a size
    // the file it draws does not have.
    sizeFor: originalPreviewDimensions,
  });
  if (preview === file) return null;
  return preview.type === WEBP_TYPE || preview.type === JPEG_TYPE ? preview : null;
}

let webpEncoderProbe: Promise<boolean> | null = null;

/**
 * Whether this engine's canvas really writes WebP, asked once with a 1x1 canvas.
 *
 * Asked for a type it cannot write, a canvas answers with a PNG — as Safari on
 * Apple platforms most likely does for WebP — so only the answer's own type can
 * say yes (`encoderWroteType`).
 */
export function canvasEncodesWebp(): Promise<boolean> {
  if (!webpEncoderProbe) webpEncoderProbe = probeCanvasEncoder(WEBP_TYPE);
  return webpEncoderProbe;
}

async function probeCanvasEncoder(type: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const blob = await canvasToBlob(canvas, type, 0.8);
    return encoderWroteType(blob?.type, type);
  } catch {
    return false;
  }
}

export async function readMediaDimensions(file: File): Promise<MediaDimensions | null> {
  if (typeof document === "undefined" || typeof URL === "undefined") return null;

  try {
    if (file.type.startsWith("image/")) {
      const image = await loadImage(file);
      return normalizeDimensions(image.naturalWidth, image.naturalHeight);
    }
    if (file.type.startsWith("video/")) {
      return await readVideoDimensions(file);
    }
  } catch {
    return null;
  }

  return null;
}

const AVATAR_PREFIXES = {
  user: "avatars",
  chat: "chat-avatars",
  bot: "bot-avatars",
} as const;

export function avatarUploadPath(
  kind: keyof typeof AVATAR_PREFIXES,
  ownerId: string,
  file: File,
): string {
  const ext = IMAGE_EXTENSIONS[file.type] ?? "bin";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  // The prefix is what the storage policy keys on, so it is not a detail: each
  // one is a different question about who may write here.
  return `${AVATAR_PREFIXES[kind]}/${ownerId}/avatar-${unique}.${ext}`;
}

function readVideoDimensions(file: File): Promise<MediaDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    const finish = (dimensions: MediaDimensions | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(dimensions);
    };

    const timeoutId = window.setTimeout(() => finish(null), 2500);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => finish(normalizeDimensions(video.videoWidth, video.videoHeight));
    video.onerror = () => finish(null);
    video.src = url;
  });
}

function normalizeDimensions(width: number, height: number): MediaDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function canOptimizeRasterImage(file: File): boolean {
  return file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp";
}

/** The long side capped, nothing else: what every output here was sized by. */
function cappedLongSide(width: number, height: number, maxDimension: number): MediaDimensions {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function optimizeRasterImage(
  file: File,
  options: {
    maxDimension: number;
    quality: number;
    suffix: string;
    /** The output's size, where the long side alone does not decide it. An avatar's does. */
    sizeFor?: (width: number, height: number) => MediaDimensions;
  },
): Promise<File> {
  if (typeof document === "undefined") return file;

  try {
    const image = await loadImage(file);
    const target = options.sizeFor
      ? options.sizeFor(image.naturalWidth, image.naturalHeight)
      : cappedLongSide(image.naturalWidth, image.naturalHeight, options.maxDimension);
    const unresized = target.width === image.naturalWidth && target.height === image.naturalHeight;
    if (unresized && file.size <= MAX_AVATAR_UPLOAD_BYTES && options.maxDimension === AVATAR_MAX_DIMENSION) {
      return file;
    }

    const encoding = compressedPhotoEncoding({ webpEncodes: await canvasEncodesWebp(), webpQuality: options.quality });
    const blob = await drawImageToBlob(image, target, encoding);
    // Named and typed from what the engine wrote: PNG bytes were once labelled WebP here.
    const identity = blob ? encodedFileIdentity(file.name, options.suffix, blob.type) : null;
    if (!blob || !identity || blob.size >= file.size) return file;

    return new File([blob], identity.name, {
      type: identity.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

async function drawImageToBlob(
  image: HTMLImageElement,
  size: { width: number; height: number },
  encoding: { type: string; quality: number },
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const opaque = encoding.type === JPEG_TYPE;
  const context = canvas.getContext("2d", { alpha: !opaque });
  if (!context) return null;
  // A JPEG has no transparency: what is transparent would come out black.
  if (opaque) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);
  return canvasToBlob(canvas, encoding.type, encoding.quality);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
