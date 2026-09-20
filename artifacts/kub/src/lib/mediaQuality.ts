export type MediaQuality = "compact" | "balanced" | "original";

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
    value: "original",
    label: "Исходное",
    description: "Без снижения качества",
  },
];

const IMAGE_PROFILES: Record<MediaQuality, { maxDimension: number; quality: number }> = {
  compact: { maxDimension: 1280, quality: 0.76 },
  balanced: { maxDimension: 1920, quality: 0.84 },
  original: { maxDimension: 2560, quality: 0.9 },
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
  original: {
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
  if (value === "high") return "original";
  return value === "compact" || value === "balanced" || value === "original"
    ? value
    : DEFAULT_MEDIA_QUALITY;
}

export function applyVideoQualityToAttachments<
  T extends { kind: string; mediaQuality?: MediaQuality; uncompressed?: boolean },
>(attachments: T[], quality: MediaQuality): T[] {
  // An original is not compressed at any quality: choosing one for the
  // compressed videos in the tray must not quietly turn an original into one.
  return attachments.map((attachment) =>
    (attachment.kind === "video" || attachment.kind === "video_message") && attachment.uncompressed !== true
      ? { ...attachment, mediaQuality: quality }
      : attachment
  );
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
  return getMediaQualityFromMetadata(mediaMetadata) === "original" || !video720pUrl
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

// ── what a photo is sent at (D-174) ──────────────────────────────────────────

/**
 * The two states the attach sheet offers for a photo, named so they cannot be
 * confused with the other meaning of «original» in this file.
 *
 * `original` here is still a re-encode — 2560px at 0.90 — and has nothing to do
 * with `uncompressed: true`, which is the «Отправить без сжатия» path that
 * uploads the picked bytes untouched. HD is a smaller photo than an original;
 * it is only a larger one than SD.
 *
 * D-119 removed a five-stop selector that asked on every send and remembered
 * what it was told. This is not that returning: the default needs no thought,
 * nothing is remembered between sends, and the composer still asks nothing.
 */
export const PHOTO_SEND_SD: MediaQuality = "compact";
export const PHOTO_SEND_HD: MediaQuality = "original";

/**
 * What a photo goes at when nobody says otherwise — the owner's instruction of
 * 2026-09-13, «по стоку загрузку в sd качестве».
 *
 * Deliberately not `DEFAULT_MEDIA_QUALITY`: that constant is also what the
 * camera recorder reads for its bitrates (`getVideoRecordingProfile`), so
 * moving it to answer a question about photographs would quietly re-tune video
 * recording as well.
 */
export const DEFAULT_PHOTO_SEND_QUALITY: MediaQuality = PHOTO_SEND_SD;

/** The sheet's two-state control, as a value rather than a boolean at the call site. */
export function photoSendQuality(hd: boolean): MediaQuality {
  return hd ? PHOTO_SEND_HD : PHOTO_SEND_SD;
}

/** Whether a value is the high-quality one, for reading a sent photo back. */
export function isHdPhotoQuality(value: MediaQuality): boolean {
  return value === PHOTO_SEND_HD;
}

// ── what the control says it does (D-290) ──────────────────────────────

/**
 * D-290, from the tester of 2026-09-20: «он по прежнему сжимает фото, даже
 * с включенной настройкой HD. Вместо 5 Мб к примеру, он отправил 200 КБ».
 *
 * **He read the control correctly and it was the control that was wrong.** HD
 * moves the re-encode from 1280px at 0.76 to 2560px at 0.90 — see
 * `IMAGE_PROFILES` above. It raises a **resolution cap**. It does not stop the
 * re-encode, and it never could: whether a photograph is compressed at all is
 * decided by which control sends it, not by this flag. A 5 MB picture comes out
 * at a megabyte or so with HD on, which is not 200 KB and is also not 5 MB.
 *
 * Two things were saying otherwise, and both are fixed here rather than
 * explained away.
 *
 * **The word.** Ours said «качество», which in this context reads as «без
 * сжатия» — the name of the *other* path, the one under «…» that really does
 * upload the picked bytes. Telegram says **«разрешение»**, measured on the
 * device on 2026-09-20: pressing its HD badge draws «Фотография будет в
 * высоком разрешении.» and pressing it again «… в обычном разрешении.». That
 * is exactly what the mechanism does, so it is what ours says now.
 *
 * **The badge.** Ours read «HD» whether HD was on or off, and left the state to
 * a fill colour. Telegram's badge **is** the state: **SD** when the photograph
 * will go at the ordinary resolution and **HD** when it will not. A control
 * whose face is its name rather than its state is the same defect one size
 * smaller, so ours is the state now too.
 */

/** What the badge reads: the state it is in, not the name of the control. */
export function photoSendQualityBadge(hd: boolean): string {
  return hd ? "HD" : "SD";
}

/**
 * The sentence the control makes true, said at the moment of pressing.
 *
 * «Разрешение», never «качество» and never «без сжатия» — the second of
 * those is a different control and saying it here is the whole defect.
 */
export function photoSendQualitySentence(hd: boolean): string {
  return hd
    ? "Фото уйдут в высоком разрешении"
    : "Фото уйдут в обычном разрешении";
}

/**
 * The second line, which names the path this control is **not**.
 *
 * The tester wanted his 5 MB back and pressed the only thing that looked like
 * it would do that. Saying where the real one is costs a line and answers the
 * question the control raises.
 */
export const PHOTO_SEND_ORIGINAL_HINT = "Исходный файл — «Отправить без сжатия» в меню «…»";

/** One key, so pressing the badge twice replaces the line rather than stacking two. */
export const PHOTO_SEND_QUALITY_FEEDBACK_KEY = "attach-photo-quality";
