/**
 * The playback rendition every video message gets.
 *
 * `shortSide` and `longSide` replaced a single 1280x720 box on 2026-09-13, and
 * the difference is not cosmetic. The box was applied to the picture whichever
 * way round it was, so a portrait clip - which is most of what a phone takes -
 * was fitted inside 1280x720 and came out 405 points wide. The name 720p has
 * always meant the SHORT side, tdesktop counts it that way, and the client
 * ladder added in D-175 counts it that way. A portrait video now comes out
 * 720x1280 and a landscape one 1280x720. The long side keeps a cap of its own so
 * an extreme aspect cannot produce an absurd frame.
 */
export const VIDEO_720P_ENCODING = {
  shortSide: 720,
  longSide: 1280,
  preset: "veryfast",
  crf: 24,
  maxRate: "3M",
  bufferSize: "6M",
  audioBitrate: "128k",
  pixelFormat: "yuv420p",
  fastStart: true,
} as const;

/** What a probe of the uploaded file tells us about it. */
export interface VideoSourceProbe {
  width: number;
  height: number;
  /** ffprobe codec_name for the first video stream. */
  videoCodec: string | null;
  /** The first audio stream codec_name, or null for a silent file. */
  audioCodec: string | null;
  /** format_name split on commas: an mp4 reports mov,mp4,m4a,3gp,3g2,mj2. */
  formatNames: string[];
}

/** Ask ffprobe about the source rather than about our own output. */
export function buildVideoProbeArgs(inputPath: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height:format=format_name",
    "-of",
    "json",
    inputPath,
  ];
}

export function parseVideoProbe(stdout: string): VideoSourceProbe | null {
  try {
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: unknown; codec_name?: unknown; width?: unknown; height?: unknown }>;
      format?: { format_name?: unknown };
    };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    const width = Number(video?.width);
    const height = Number(video?.height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null;
    const formatName = typeof parsed.format?.format_name === "string" ? parsed.format.format_name : "";
    return {
      width,
      height,
      videoCodec: typeof video?.codec_name === "string" ? video.codec_name : null,
      audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : null,
      formatNames: formatName ? formatName.split(",").map((name) => name.trim()).filter(Boolean) : [],
    };
  } catch {
    // The caller maps invalid probe output to a bounded error code.
    return null;
  }
}

/** Even, because H.264 in yuv420p cannot encode an odd dimension. */
function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * The frame the rendition is encoded at, from the source own frame.
 *
 * Computed here rather than in an ffmpeg expression, for the same reason the
 * client ladder computes it in TypeScript: the rule is the part that can be
 * quietly wrong, and an expression inside a -vf string cannot be unit-tested.
 * Never larger than the source, so a small clip is left at its own size - which
 * is also what makes the reuse below possible.
 */
export function video720pTargetSize(source: { width: number; height: number }): { width: number; height: number } {
  const shortSide = Math.min(source.width, source.height);
  const longSide = Math.max(source.width, source.height);
  if (shortSide <= 0 || longSide <= 0) return { width: 0, height: 0 };
  const scale = Math.min(
    1,
    VIDEO_720P_ENCODING.shortSide / shortSide,
    VIDEO_720P_ENCODING.longSide / longSide,
  );
  if (scale >= 1) return { width: toEven(source.width), height: toEven(source.height) };
  return { width: toEven(source.width * scale), height: toEven(source.height * scale) };
}

/**
 * Whether an uploaded file is already the rendition, so nothing has to be made.
 *
 * This is what the client-side transcoding of D-175 buys: the device produced a
 * 720p H.264 mp4, and re-encoding it here would spend a CPU minute to produce a
 * slightly worse copy of the same thing.
 *
 * Nothing here trusts the client. Every condition is measured on the server from
 * the bytes that arrived: ffprobe for the codecs and the frame, and the file own
 * top-level boxes for where its metadata sits. A claim in media_metadata would
 * have been the easy way and would have let any caller skip the pipeline by
 * asserting that it had already done the work.
 *
 * The bucket check is not a formality: a ready row names a bucket and a path,
 * and buildMessageVariantReadyRow writes the variant bucket. Reusing a source
 * that lives anywhere else would write a row pointing at the wrong object.
 */
export function canReuseSourceAsVideo720p(input: {
  probe: VideoSourceProbe;
  sourceBucket: string;
  variantBucket: string;
  /** The moov box lies before the mdat box, so playback can start on the first bytes. */
  frontLoadedMoov: boolean;
}): boolean {
  const { probe, sourceBucket, variantBucket, frontLoadedMoov } = input;
  if (sourceBucket !== variantBucket) return false;
  if (!frontLoadedMoov) return false;
  if ((probe.videoCodec ?? "").toLowerCase() !== "h264") return false;
  const audio = (probe.audioCodec ?? "").toLowerCase();
  if (audio && audio !== "aac") return false;
  if (!probe.formatNames.some((name) => name === "mp4" || name === "mov")) return false;
  const target = video720pTargetSize(probe);
  return target.width === probe.width && target.height === probe.height;
}

/**
 * Whether an MP4 metadata sits in front of its media.
 *
 * A file whose moov box follows its mdat has to be fetched whole before it can
 * start playing, which is what -movflags +faststart exists to prevent. The
 * top-level boxes are a length and a four-character name each, so the answer is
 * a short walk through the head of the file rather than a second ffprobe.
 *
 * A 64-bit box length (declared size 1) and the to-end-of-file length (declared
 * size 0) are both handled: a large upload uses the first and a last box often
 * uses the second.
 */
export function hasFrontLoadedMoov(buffer: Uint8Array): boolean {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let at = 0;
  // A handful of boxes: ftyp, free, moov and mdat are all that precede the media.
  for (let box = 0; box < 16; box += 1) {
    if (at + 8 > buffer.byteLength) return false;
    const declared = view.getUint32(at);
    const type = String.fromCharCode(buffer[at + 4], buffer[at + 5], buffer[at + 6], buffer[at + 7]);
    if (type === "moov") return true;
    if (type === "mdat") return false;
    let size = declared;
    if (declared === 1) {
      if (at + 16 > buffer.byteLength) return false;
      const large = view.getBigUint64(at + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      size = Number(large);
    } else if (declared === 0) {
      // To the end of the file: nothing follows, so nothing more can be moov.
      return false;
    }
    if (size < 8) return false;
    at += size;
  }
  return false;
}

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
  target: { width: number; height: number },
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
    // Explicit numbers, computed by video720pTargetSize from a probe of
    // the source. The expression this replaced fitted every picture into
    // one landscape box and so cut portrait video to 405 points wide.
    `scale=w=${target.width}:h=${target.height}`,
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
  buildVideoProbeArgs,
  canReuseSourceAsVideo720p,
  hasFrontLoadedMoov,
  parseVideoDimensions,
  parseVideoProbe,
  video720pTargetSize,
  buildMessageVariantReadyRow,
  buildMessageVariantFailedRow,
  safeStorageFailureDetails,
  isMissingStorageObjectError,
  isUnreadableSourceError,
  shouldAttemptVariantKind,
  TERMINAL_VARIANT_ERROR_CODES,
};
