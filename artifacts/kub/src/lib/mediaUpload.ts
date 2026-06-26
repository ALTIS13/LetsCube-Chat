import { DEFAULT_MEDIA_QUALITY, getImageUploadProfile, type MediaQuality } from "./mediaQuality";

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

export async function prepareChatImageAttachment(
  file: File,
  mediaQuality: MediaQuality = DEFAULT_MEDIA_QUALITY,
): Promise<File> {
  if (!canOptimizeRasterImage(file)) return file;
  const profile = getImageUploadProfile(mediaQuality);
  return optimizeRasterImage(file, {
    maxDimension: profile.maxDimension,
    quality: profile.quality,
    suffix: "image",
  });
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

export function avatarUploadPath(kind: "user" | "chat", ownerId: string, file: File): string {
  const ext = IMAGE_EXTENSIONS[file.type] ?? "bin";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  const prefix = kind === "user" ? "avatars" : "chat-avatars";
  return `${prefix}/${ownerId}/avatar-${unique}.${ext}`;
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

async function optimizeRasterImage(
  file: File,
  options: { maxDimension: number; quality: number; suffix: string },
): Promise<File> {
  if (typeof document === "undefined") return file;

  try {
    const image = await loadImage(file);
    const scale = Math.min(1, options.maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale >= 1 && file.size <= MAX_AVATAR_UPLOAD_BYTES && options.maxDimension === AVATAR_MAX_DIMENSION) {
      return file;
    }

    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/webp", options.quality);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], optimizedFileName(file.name, options.suffix), {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
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

function optimizedFileName(name: string, suffix: string): string {
  const base = name.replace(/\.[^.]+$/, "") || suffix;
  return `${base}-${suffix}.webp`;
}
