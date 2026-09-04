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

interface MessageRowCandidate {
  id: string;
  chat_id: string;
  user_id: string | null;
}

interface StoragePointerValue {
  bucket: string;
  path: string;
}

interface GeneratedVariantValue {
  kind: string;
  path: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export function buildVideo720pFfmpegArgs(
  inputPath: string,
  outputPath: string,
  threads: number,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    `scale=w=min(${VIDEO_720P_ENCODING.width}\\,iw):h=min(${VIDEO_720P_ENCODING.height}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2`,
    "-c:v",
    "libx264",
    "-preset",
    VIDEO_720P_ENCODING.preset,
    "-crf",
    String(VIDEO_720P_ENCODING.crf),
    "-maxrate",
    VIDEO_720P_ENCODING.maxRate,
    "-bufsize",
    VIDEO_720P_ENCODING.bufferSize,
    "-pix_fmt",
    VIDEO_720P_ENCODING.pixelFormat,
    "-c:a",
    "aac",
    "-b:a",
    VIDEO_720P_ENCODING.audioBitrate,
    "-threads",
    String(threads),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

export function parseVideoDimensions(stdout: string): { width: number; height: number } | null {
  try {
    const stream = (JSON.parse(stdout) as { streams?: Array<{ width?: unknown; height?: unknown }> })
      .streams?.[0];
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
      return { width, height };
    }
  } catch {
    // The caller maps invalid probe output to a bounded error code.
  }
  return null;
}

export function buildMessageVariantReadyRow(
  message: MessageRowCandidate,
  source: StoragePointerValue,
  variant: GeneratedVariantValue,
  updatedAt: string,
) {
  return {
    message_id: message.id,
    chat_id: message.chat_id,
    owner_id: message.user_id,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: variant.kind,
    variant_bucket: "media",
    variant_path: variant.path,
    mime_type: variant.mimeType,
    width: variant.width,
    height: variant.height,
    size_bytes: variant.sizeBytes,
    status: "ready",
    updated_at: updatedAt,
  };
}

export function buildMessageVariantFailedRow(
  message: MessageRowCandidate,
  source: StoragePointerValue,
  kind: string,
  path: string,
  mimeType: string,
  errorCode: string,
  updatedAt: string,
) {
  return {
    message_id: message.id,
    chat_id: message.chat_id,
    owner_id: message.user_id,
    source_bucket: source.bucket,
    source_path: source.path,
    variant_kind: kind,
    variant_bucket: "media",
    variant_path: path,
    mime_type: mimeType,
    status: "failed",
    error_code: errorCode,
    updated_at: updatedAt,
  };
}

/**
 * Failures that describe the source rather than the moment.
 *
 * The worker has no queue: it finds its own work by scanning `messages` every
 * tick, so nothing ever takes a message out of the candidate set. A message it
 * can never convert is therefore rediscovered forever — which is exactly what
 * D-034 was, two `storage download failed` warnings a minute, indefinitely,
 * for two rows whose objects were left behind by the move off the hosted
 * Supabase project.
 *
 * These two read the same way in a minute and in a year:
 *
 * - `source_missing`    — storage has no object at the recorded path.
 * - `source_unreadable` — the object is there and cannot be decoded.
 *
 * A kind whose recorded failure is one of these, against the same source, is
 * not attempted again. Every other failure — a timeout, a 5xx, an upload the
 * service refused — is about this attempt, and is retried next tick exactly as
 * it always was.
 */
export const TERMINAL_VARIANT_ERROR_CODES: ReadonlySet<string> = new Set([
  "source_missing",
  "source_unreadable",
]);

/**
 * Whether a storage download failed because there is no such object.
 *
 * Supabase's storage service answers a missing object with **HTTP 400** and a
 * body that says 404: `{"statusCode":"404","error":"not_found",...}`. The
 * client keeps both numbers — `status` is the transport's, `statusCode` the
 * service's — and the worker's log printed only `status`, so a gone object was
 * indistinguishable from a malformed request for as long as the defect ran.
 * Both are read here, because which one carries the truth is the service's to
 * change, not ours.
 */
export function isMissingStorageObjectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as { status?: unknown; statusCode?: unknown };
  if (record.status === 404 || record.statusCode === 404) return true;
  return record.statusCode === "404";
}

/**
 * libvips loader failures, which mean the bytes are not a picture.
 *
 * libvips reports a source it cannot read as a plain `Error` with no code, so
 * the message is the only signal there is. Matched narrowly on purpose: a miss
 * costs one retry per tick — today's behaviour — while a false positive would
 * abandon a picture a later attempt could have converted.
 */
const UNREADABLE_SOURCE_PATTERNS = [
  /unsupported image format/i,
  /libpng (read )?error/i,
  /^vips(png|jpeg|gif|webp|tiff|heif|magick)/i,
  /corrupt header/i,
  /premature end of/i,
] as const;

export function isUnreadableSourceError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return UNREADABLE_SOURCE_PATTERNS.some((pattern) => pattern.test(err.message));
}

/** What `media_variants` already records about one owner's one variant kind. */
export interface RecordedVariantAttempt {
  status: string;
  errorCode: string | null;
  sourceBucket: string | null;
  sourcePath: string | null;
}

/**
 * Whether one variant kind is worth attempting on this tick.
 *
 * `ready` is done. A terminal failure recorded against *this same source* is
 * not attempted again — that is the whole of the fix for D-034. A terminal
 * failure recorded against a different bucket or path was about different
 * bytes, so the current ones are unproven and get their attempt.
 */
export function shouldAttemptVariantKind(
  attempt: RecordedVariantAttempt | undefined,
  source: { bucket: string; path: string },
): boolean {
  if (!attempt) return true;
  if (attempt.status === "ready") return false;
  if (attempt.status !== "failed") return true;
  if (!attempt.errorCode || !TERMINAL_VARIANT_ERROR_CODES.has(attempt.errorCode)) return true;
  return attempt.sourceBucket !== source.bucket || attempt.sourcePath !== source.path;
}

export function safeStorageFailureDetails(
  err: unknown,
): { name?: string; code?: string; status?: number; statusCode?: string } | null {
  if (!err || typeof err !== "object") return null;
  const record = err as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };
  const details: { name?: string; code?: string; status?: number; statusCode?: string } = {};
  const name = safeStorageErrorText(record.name);
  const code = safeStorageErrorText(record.code);
  const status = safeStorageStatus(record.status);
  // The transport status and the service's own are different numbers: storage
  // answers a missing object with 400 over 404. Logging only the first is what
  // kept D-034 unreadable for 826 warnings, so both are carried.
  const statusCode =
    safeStorageErrorText(record.statusCode) ??
    (safeStorageStatus(record.statusCode) !== undefined ? String(record.statusCode) : undefined);
  if (name) details.name = name;
  if (code) details.code = code;
  if (status !== undefined) details.status = status;
  if (statusCode) details.statusCode = statusCode;
  return Object.keys(details).length > 0 ? details : null;
}

function safeStorageErrorText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[A-Za-z0-9_]{1,80}$/.test(value) ? value : undefined;
}

function safeStorageStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

export const mediaVariantWorkerTestSeams = {
  buildVideo720pFfmpegArgs,
  parseVideoDimensions,
  buildMessageVariantReadyRow,
  buildMessageVariantFailedRow,
  safeStorageFailureDetails,
  isMissingStorageObjectError,
  isUnreadableSourceError,
  shouldAttemptVariantKind,
  TERMINAL_VARIANT_ERROR_CODES,
};
