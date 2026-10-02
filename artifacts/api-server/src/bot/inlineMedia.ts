import { execFile } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotApiError } from "#bot/errors";
import { MAX_INLINE_PHOTO_BYTES } from "#bot/schemas";

export const INLINE_MEDIA_EXTENSION = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf", "video/mp4": "mp4", "video/webm": "webm",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3",
} as const;
export type InlineMediaMime = keyof typeof INLINE_MEDIA_EXTENSION;
export type MediaProbe = (tool: "ffprobe" | "pdfinfo", args: string[], bytes: Buffer) => Promise<string>;

export function decodeInlineMedia(input: { mime_type: string; bytes_base64: string }): Buffer {
  if (!Object.hasOwn(INLINE_MEDIA_EXTENSION, input.mime_type) ||
      typeof input.bytes_base64 !== "string" || input.bytes_base64.length < 4 ||
      input.bytes_base64.length > 8_388_608) throw new BotApiError("validation_failed");
  const bytes = Buffer.from(input.bytes_base64, "base64");
  if (bytes.length < 1 || bytes.length > MAX_INLINE_PHOTO_BYTES ||
      bytes.toString("base64") !== input.bytes_base64) throw new BotApiError("validation_failed");
  return bytes;
}

export const runMediaProbe: MediaProbe = async (tool, args, bytes) => {
  // MP4 with a trailing moov needs seeking. Only our private fixed-name file is
  // opened; MOV external references are disabled and network protocols excluded.
  const directory = tool === "ffprobe" ? await mkdtemp(join(tmpdir(), "letscube-bot-media-")) : undefined;
  const file = directory ? join(directory, "media.bin") : undefined;
  try {
    if (file) await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(tool, args.map(arg => arg === "@owned-media@" && file ? file : arg), {
        timeout: 8_000, killSignal: "SIGKILL", maxBuffer: 6_291_456,
        windowsHide: true, shell: false, encoding: "utf8",
        env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) },
      }, (error, stdout) => {
        // Neither parser diagnostics nor embedded document tags leave this boundary.
        if (error) reject(new BotApiError(error.code === "ENOENT" ? "internal_error" : "validation_failed"));
        else resolve(stdout);
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(file ? undefined : bytes);
    });
  } finally {
    // Delete only the exact file/directory just created, never a recursive target.
    if (file) await unlink(file).catch(error => { if (error.code !== "ENOENT") throw new BotApiError("internal_error"); });
    if (directory) await rmdir(directory).catch(() => { throw new BotApiError("internal_error"); });
  }
};

export function mediaProbeArgs(): string[] {
  return [
    "-v", "error", "-max_alloc", "16777216", "-probesize", "6291456",
    "-analyzeduration", "5000000", "-protocol_whitelist", "file", "-enable_drefs", "0", "-use_absolute_path", "0",
    "-format_whitelist", "mov,matroska,webm,ogg,mp3",
    "-show_entries", "stream=codec_type,codec_name,width,height:format=format_name,duration:packet=pts_time,duration_time",
    "-show_packets", "-of", "json", "-i", "@owned-media@",
  ];
}

function invalid(): never { throw new BotApiError("validation_failed"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function seconds(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseInlineMediaProbe(stdout: string, mime: InlineMediaMime): Record<string, number> {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { invalid(); }
  const data = record(parsed);
  const format = record(data.format);
  const formatNames = typeof format.format_name === "string" ? format.format_name.split(",") : [];
  const container = mime === "video/mp4" ? "mov" : mime.endsWith("webm") ? "webm" : mime === "audio/ogg" ? "ogg" : "mp3";
  if (!formatNames.includes(container) || !Array.isArray(data.streams) || data.streams.length < 1 || data.streams.length > 2) invalid();
  const streams = data.streams.map(record);
  if (streams.some((stream) => !["audio", "video"].includes(String(stream.codec_type)))) invalid();
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const isVideo = mime.startsWith("video/");
  if (isVideo ? videos.length !== 1 || audios.length > 1 : audios.length !== 1 || videos.length !== 0) invalid();
  const audioCodecs = container === "mov" ? ["aac"] : container === "mp3" ? ["mp3"] : ["opus", "vorbis"];
  if (audios.some((stream) => !audioCodecs.includes(String(stream.codec_name)))) invalid();
  let dimensions: Record<string, number> = {};
  if (isVideo) {
    const video = videos[0];
    if (!(container === "mov" ? ["h264"] : ["vp8", "vp9"]).includes(String(video.codec_name))) invalid();
    if (!Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) ||
        Number(video.width) < 1 || Number(video.height) < 1 || Number(video.width) > 4096 || Number(video.height) > 4096) invalid();
    dimensions = { width: Number(video.width), height: Number(video.height) };
  }
  if (!Array.isArray(data.packets) || data.packets.length < 1 || data.packets.length > 100_000) invalid();
  let duration = Math.max(0, seconds(format.duration) ?? 0);
  for (const value of data.packets) {
    const packet = record(value);
    const start = seconds(packet.pts_time);
    const length = seconds(packet.duration_time) ?? 0;
    if (start === undefined || length < 0) invalid();
    duration = Math.max(duration, start + length);
  }
  const durationMs = Math.ceil(duration * 1000);
  if (durationMs < 1 || durationMs > 1_800_000) invalid();
  return { ...dimensions, duration_ms: durationMs };
}

export async function inspectInlineMedia(
  bytes: Buffer, mime: InlineMediaMime, fileName?: string, probe: MediaProbe = runMediaProbe,
): Promise<Record<string, string | number>> {
  if (mime === "application/pdf") {
    if (!/^%PDF-[12]\.\d/.test(bytes.toString("ascii", 0, 8)) ||
        !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"))) invalid();
    if (fileName !== undefined && (fileName.length > 128 || !fileName.trim() ||
        /[/\\\u0000-\u001f\u007f]/.test(fileName) || [".", ".."].includes(fileName))) invalid();
    const output = await probe("pdfinfo", ["-"], bytes);
    // Unicode separators in a document title are not pdfinfo field boundaries.
    const lines = output.split(/\r?\n/);
    const pageFields = lines.filter(line => line.startsWith("Pages:"));
    const encryptionFields = lines.filter(line => line.startsWith("Encrypted:"));
    const pages = pageFields.length === 1 ? /^Pages:[ \t]+(\d+)[ \t]*$/.exec(pageFields[0]) : null;
    if (!pages || Number(pages[1]) < 1 || Number(pages[1]) > 10_000 ||
        encryptionFields.length !== 1 || !/^Encrypted:[ \t]+no[ \t]*$/.test(encryptionFields[0])) invalid();
    return { file_name: fileName ?? "document.pdf" };
  }
  return parseInlineMediaProbe(await probe("ffprobe", mediaProbeArgs(), bytes), mime);
}
