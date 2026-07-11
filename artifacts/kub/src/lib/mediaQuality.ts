export type MediaQuality = "compact" | "balanced" | "high";

export const DEFAULT_MEDIA_QUALITY: MediaQuality = "balanced";
export const MEDIA_QUALITY_STORAGE_KEY = "letscube:media-quality";
export const MEDIA_QUALITY_METADATA_KEY = "media_quality";

export const MEDIA_QUALITY_OPTIONS: ReadonlyArray<{
  value: MediaQuality;
  label: string;
  description: string;
}> = [
  {
    value: "compact",
    label: "Экономно",
    description: "Меньше размер, быстрее загрузка",
  },
  {
    value: "balanced",
    label: "Стандарт",
    description: "Оптимально для чатов",
  },
  {
    value: "high",
    label: "Высокое",
    description: "Лучше качество, больше размер",
  },
];

const IMAGE_PROFILES: Record<MediaQuality, { maxDimension: number; quality: number }> = {
  compact: { maxDimension: 1280, quality: 0.76 },
  balanced: { maxDimension: 1920, quality: 0.84 },
  high: { maxDimension: 2560, quality: 0.9 },
};

const VIDEO_PROFILES: Record<MediaQuality, {
  roundSize: number;
  regularWidth: number;
  regularHeight: number;
  roundVideoBitsPerSecond: number;
  regularVideoBitsPerSecond: number;
  audioBitsPerSecond: number;
  frameRate: number;
}> = {
  compact: {
    roundSize: 720,
    regularWidth: 1280,
    regularHeight: 720,
    roundVideoBitsPerSecond: 1_800_000,
    regularVideoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 96_000,
    frameRate: 30,
  },
  balanced: {
    roundSize: 1080,
    regularWidth: 1920,
    regularHeight: 1080,
    roundVideoBitsPerSecond: 3_200_000,
    regularVideoBitsPerSecond: 5_500_000,
    audioBitsPerSecond: 128_000,
    frameRate: 30,
  },
  high: {
    roundSize: 1080,
    regularWidth: 1920,
    regularHeight: 1080,
    roundVideoBitsPerSecond: 4_800_000,
    regularVideoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 160_000,
    frameRate: 30,
  },
};

export function normalizeMediaQuality(value: unknown): MediaQuality {
  return value === "compact" || value === "balanced" || value === "high"
    ? value
    : DEFAULT_MEDIA_QUALITY;
}

export function getMediaQualityFromMetadata(metadata: unknown): MediaQuality {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return DEFAULT_MEDIA_QUALITY;
  }
  return normalizeMediaQuality((metadata as Record<string, unknown>)[MEDIA_QUALITY_METADATA_KEY]);
}

export function selectVideoPlaybackUrl({
  originalUrl,
  video720pUrl,
  mediaMetadata,
}: {
  originalUrl: string;
  video720pUrl?: string | null;
  mediaMetadata: unknown;
}): string {
  return getMediaQualityFromMetadata(mediaMetadata) === "high" || !video720pUrl
    ? originalUrl
    : video720pUrl;
}

export function getVideoPlaybackFallbackUrl(activeUrl: string, originalUrl: string): string | null {
  return activeUrl === originalUrl ? null : originalUrl;
}

export function replacePlaybackItemUrl<T extends { id: string; url: string }>(
  currentItem: T | null,
  itemId: string,
  nextUrl: string,
): T | null {
  if (!currentItem || currentItem.id !== itemId || currentItem.url === nextUrl) return currentItem;
  return { ...currentItem, url: nextUrl };
}

export function getImageUploadProfile(quality: MediaQuality): { maxDimension: number; quality: number } {
  return IMAGE_PROFILES[quality] ?? IMAGE_PROFILES[DEFAULT_MEDIA_QUALITY];
}

export function getVideoRecordingProfile(
  quality: MediaQuality,
  variant: "round" | "regular",
): {
  width: number;
  height: number;
  frameRate: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
} {
  const profile = VIDEO_PROFILES[quality] ?? VIDEO_PROFILES[DEFAULT_MEDIA_QUALITY];
  return {
    width: variant === "round" ? profile.roundSize : profile.regularWidth,
    height: variant === "round" ? profile.roundSize : profile.regularHeight,
    frameRate: profile.frameRate,
    videoBitsPerSecond:
      variant === "round" ? profile.roundVideoBitsPerSecond : profile.regularVideoBitsPerSecond,
    audioBitsPerSecond: profile.audioBitsPerSecond,
  };
}
