import {
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  getFirstEncodableAudioCodec,
  type AudioCodec,
  type InputAudioTrack,
  type InputVideoTrack,
} from "mediabunny";
import { MAX_ORIGINAL_ATTACHMENT_BYTES } from "./mediaCompression.ts";
import { SENDABLE_FORMATS } from "./videoSource.ts";
import { canEncodeFrame, videoTranscodeSupport } from "./videoTranscodeSupport.ts";

export interface VideoEditInfo {
  width: number;
  height: number;
  duration: number;
}

export interface VideoEditResult extends VideoEditInfo {
  file: File;
  changed: boolean;
}

interface VideoEditOptions {
  signal?: AbortSignal;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Video edit canceled", "AbortError");
}

function checkFile(file: File): void {
  if (!(file instanceof File) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_ORIGINAL_ATTACHMENT_BYTES) {
    throw new Error("VIDEO_EDIT_INVALID_FILE");
  }
}

async function readInfo(input: Input, signal?: AbortSignal) {
  const readable = await input.canRead();
  checkAbort(signal);
  if (!readable) throw new Error("VIDEO_EDIT_UNREADABLE");
  const video = await input.getPrimaryVideoTrack();
  checkAbort(signal);
  if (!video) throw new Error("VIDEO_EDIT_NO_VIDEO");
  const audio = await input.getPrimaryAudioTrack();
  checkAbort(signal);
  const width = await video.getDisplayWidth();
  checkAbort(signal);
  const height = await video.getDisplayHeight();
  checkAbort(signal);
  const duration = await input.computeDuration(audio ? [video, audio] : [video]);
  checkAbort(signal);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || !Number.isSafeInteger(width * height) || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("VIDEO_EDIT_INVALID_METADATA");
  }
  return { video, audio, info: { width, height, duration } };
}

async function encoding(
  video: InputVideoTrack,
  audio: InputAudioTrack | null,
  info: VideoEditInfo,
  format: Mp4OutputFormat,
  signal?: AbortSignal,
) {
  const videoDecodable = await video.canDecode();
  checkAbort(signal);
  if (!videoDecodable) throw new Error("VIDEO_EDIT_UNSUPPORTED");
  const audioDecodable = !audio || await audio.canDecode();
  checkAbort(signal);
  if (!audioDecodable) throw new Error("VIDEO_EDIT_UNSUPPORTED");
  const support = await videoTranscodeSupport();
  checkAbort(signal);
  if (!support.available || !support.codec || !format.getSupportedVideoCodecs().includes(support.codec)
    || !await canEncodeFrame(support.codec, info.width, info.height)) {
    throw new Error("VIDEO_EDIT_UNSUPPORTED");
  }
  checkAbort(signal);
  let audioCodec: AudioCodec | null = null;
  if (audio) {
    const sourceCodec = await audio.getCodec();
    checkAbort(signal);
    const numberOfChannels = await audio.getNumberOfChannels();
    checkAbort(signal);
    const sampleRate = await audio.getSampleRate();
    checkAbort(signal);
    if (!Number.isSafeInteger(numberOfChannels) || numberOfChannels <= 0
      || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error("VIDEO_EDIT_UNSUPPORTED");
    const candidates: AudioCodec[] = sourceCodec ? [sourceCodec, "aac", "opus"] : ["aac", "opus"];
    audioCodec = await getFirstEncodableAudioCodec(
      [...new Set(candidates)].filter(codec => format.getSupportedAudioCodecs().includes(codec)),
      { numberOfChannels, sampleRate },
    );
    checkAbort(signal);
    if (!audioCodec) throw new Error("VIDEO_EDIT_UNSUPPORTED");
  }
  return { video: { codec: support.codec }, audio: audioCodec ? { codec: audioCodec } : undefined };
}

/** Read the actual primary tracks and check that this browser can precisely trim both. */
export async function inspectVideoEdit(file: File, { signal }: VideoEditOptions = {}): Promise<VideoEditInfo> {
  checkAbort(signal);
  checkFile(file);
  const input = new Input({ source: new BlobSource(file), formats: SENDABLE_FORMATS });
  try {
    const { video, audio, info } = await readInfo(input, signal);
    await encoding(video, audio, info, new Mp4OutputFormat({ fastStart: "in-memory" }), signal);
    checkAbort(signal);
    return info;
  } finally {
    input.dispose();
  }
}

/** Editing failures reject: the original must never masquerade as an applied trim. */
export async function trimVideo(
  file: File,
  range: { start: number; end: number },
  { signal, onProgress }: VideoEditOptions & { onProgress?: (progress: number) => void } = {},
): Promise<VideoEditResult> {
  checkAbort(signal);
  checkFile(file);
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)
    || range.start < 0 || range.end <= range.start) throw new Error("VIDEO_EDIT_INVALID_RANGE");
  // Snapshot the caller's selection before any asynchronous work.
  const { start, end } = range;
  const input = new Input({ source: new BlobSource(file), formats: SENDABLE_FORMATS });
  let output: Output<Mp4OutputFormat, BufferTarget> | undefined;
  let conversion: Conversion | undefined;
  let cancelConversion: (() => Promise<void>) | undefined;
  let canceling: Promise<void> | undefined;
  let cleanupFailed = false;
  const cancel = () => {
    if (!cancelConversion) return Promise.resolve();
    return canceling ??= cancelConversion().catch(() => { cleanupFailed = true; });
  };
  try {
    const { video, audio, info } = await readInfo(input, signal);
    if (end > info.duration) throw new Error("VIDEO_EDIT_INVALID_RANGE");
    if (start === 0 && end === info.duration) return { file, ...info, changed: false };
    const format = new Mp4OutputFormat({ fastStart: "in-memory" });
    const codecs = await encoding(video, audio, info, format, signal);
    checkAbort(signal);
    output = new Output({ format, target: new BufferTarget() });
    // Init has no cancellation handle until it settles. Keep ownership until then,
    // even if the caller aborts, and close partial output if init rejects.
    conversion = await Conversion.init({
      input, output, tracks: "primary", trim: { start, end }, copy: false, tags: {},
      ...codecs, showWarnings: false,
    });
    // execute() also calls this public method internally on pump failure. Join
    // that same cancellation and observe its rejection before disposing input.
    cancelConversion = conversion.cancel.bind(conversion);
    conversion.cancel = cancel;
    checkAbort(signal);
    const required = audio ? [video, audio] : [video];
    if (!conversion.isValid || conversion.utilizedTracks.length !== required.length
      || required.some(track => !conversion!.utilizedTracks.includes(track))) {
      throw new Error("VIDEO_EDIT_MISSING_TRACK");
    }
    conversion.onProgress = progress => {
      if (!signal?.aborted && Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    checkAbort(signal);
    await conversion.execute();
    checkAbort(signal);
    if (cleanupFailed) throw new Error("VIDEO_EDIT_CLEANUP_FAILED");
    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_ORIGINAL_ATTACHMENT_BYTES) {
      throw new Error("VIDEO_EDIT_INVALID_OUTPUT");
    }
    const stem = file.name.replace(/\.[^.]*$/, "") || "video";
    const result = new File([buffer], `${stem}.mp4`, { type: "video/mp4" });
    const verification = new Input({ source: new BlobSource(result), formats: SENDABLE_FORMATS });
    try {
      const actual = await readInfo(verification, signal);
      const videoDuration = await actual.video.computeDuration();
      checkAbort(signal);
      const audioDuration = actual.audio ? await actual.audio.computeDuration() : null;
      checkAbort(signal);
      if (actual.info.width !== info.width || actual.info.height !== info.height || !!actual.audio !== !!audio
        || !Number.isFinite(videoDuration) || videoDuration <= 0
        || (audioDuration !== null && (!Number.isFinite(audioDuration) || audioDuration <= 0))) {
        throw new Error("VIDEO_EDIT_INVALID_OUTPUT");
      }
      checkAbort(signal);
      return { file: result, ...actual.info, changed: true };
    } finally {
      verification.dispose();
    }
  } catch (error) {
    checkAbort(signal);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      if (conversion && conversion.state !== "done") cancel();
      if (canceling) await canceling;
      if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel();
    } finally {
      input.dispose();
    }
  }
}
