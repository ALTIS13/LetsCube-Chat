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

export function safeStorageFailureDetails(
  err: unknown,
): { name?: string; code?: string; status?: number } | null {
  if (!err || typeof err !== "object") return null;
  const record = err as { name?: unknown; code?: unknown; status?: unknown };
  const details: { name?: string; code?: string; status?: number } = {};
  const name = safeStorageErrorText(record.name);
  const code = safeStorageErrorText(record.code);
  const status = safeStorageStatus(record.status);
  if (name) details.name = name;
  if (code) details.code = code;
  if (status !== undefined) details.status = status;
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
};
