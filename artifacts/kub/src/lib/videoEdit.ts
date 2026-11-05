import {
  BlobSource,
  AudioBufferSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
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

class PcmCandidate extends Error {
  constructor() { super("VIDEO_EDIT_UNSUPPORTED"); }
}

class NativeCodecFailure extends Error {
  constructor(readonly original: unknown) { super("VIDEO_EDIT_NATIVE_CODEC_FAILED"); }
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
  if (!audioDecodable) throw new PcmCandidate();
  return { video: { codec: support.codec }, audio: audioCodec ? { codec: audioCodec } : undefined };
}

async function pcmAdmission(file: File, input: Input, video: InputVideoTrack, audio: InputAudioTrack | null, signal?: AbortSignal) {
  if (typeof AudioContext !== "function") throw new Error("VIDEO_EDIT_UNSUPPORTED");
  const pcm = await import("./videoEditPcm.ts");
  const plan = await pcm.inspectPcmFallback(file, input, video, audio, signal);
  // Probe the exact fallback encoder, not merely the native path's chosen codec.
  const codec = await getFirstEncodableAudioCodec(["aac"], { numberOfChannels: 1, sampleRate: 48000,
    bitrate: 96_000 });
  checkAbort(signal);
  if (!codec) throw new Error("VIDEO_EDIT_UNSUPPORTED");
  return { pcm, plan };
}

/** Read the actual primary tracks and check that this browser can precisely trim both. */
export async function inspectVideoEdit(file: File, { signal }: VideoEditOptions = {}): Promise<VideoEditInfo> {
  checkAbort(signal);
  checkFile(file);
  const input = new Input({ source: new BlobSource(file), formats: SENDABLE_FORMATS });
  try {
    const { video, audio, info } = await readInfo(input, signal);
    try {
      await encoding(video, audio, info, new Mp4OutputFormat({ fastStart: "in-memory" }), signal);
    } catch (error) {
      if (!(error instanceof PcmCandidate)) throw error;
      await pcmAdmission(file, input, video, audio, signal);
    }
    checkAbort(signal);
    return info;
  } finally {
    input.dispose();
  }
}

/** Editing failures reject: the original must never masquerade as an applied trim. */
async function trimNativeVideo(
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
  let fallbackFailure = false;
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
    try {
      await conversion.execute();
    } catch (error) {
      // The installed Conversion preserves DOMException but does not expose pump
      // origin. Never broaden this to arbitrary Error messages or init failures.
      if (typeof AudioContext === "function") {
        const pcm = await import("./videoEditPcm.ts");
        if (pcm.isPcmCodecFailure(error, "execute")) throw new NativeCodecFailure(error);
      }
      throw error;
    }
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
    fallbackFailure = error instanceof NativeCodecFailure || error instanceof PcmCandidate;
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      if (conversion && conversion.state !== "done") cancel();
      if (canceling) await canceling;
      if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel();
      if (cleanupFailed && fallbackFailure) throw new Error("VIDEO_EDIT_CLEANUP_FAILED");
    } finally {
      input.dispose();
    }
  }
}

/** One fresh, bounded compatibility attempt, only after native ownership settles. */
export async function trimVideo(
  file: File,
  range: { start: number; end: number },
  options: VideoEditOptions & { onProgress?: (progress: number) => void } = {},
): Promise<VideoEditResult> {
  // Both attempts own the same immutable selection, including during native init.
  const selected = range && { start: range.start, end: range.end };
  try {
    return await trimNativeVideo(file, selected, options);
  } catch (error) {
    checkAbort(options.signal);
    if (!(error instanceof PcmCandidate) && !(error instanceof NativeCodecFailure)) throw error;
    return trimPcmVideo(file, selected, options);
  }
}

async function trimPcmVideo(
  file: File, range: { start: number; end: number },
  { signal, onProgress }: VideoEditOptions & { onProgress?: (progress: number) => void },
): Promise<VideoEditResult> {
  checkAbort(signal);
  const input = new Input({ source: new BlobSource(file), formats: SENDABLE_FORMATS });
  let output: Output | undefined, conversion: Conversion | undefined;
  let audioSource: AudioBufferSource | undefined;
  let target: ReturnType<typeof import("./videoEditPcm.ts").boundedPcmTarget> | undefined;
  let canceling: Promise<void> | undefined;
  let cleanupFailed = false;
  let cancelConversion: (() => Promise<void>) | undefined;
  const cancel = () => canceling ??= (async () => {
    try {
      if (cancelConversion) await cancelConversion();
    } finally {
      if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel();
    }
  })().catch(() => { cleanupFailed = true; });
  const jobs: Promise<unknown>[] = [];
  try {
    const { video, audio, info } = await readInfo(input, signal);
    const { pcm, plan } = await pcmAdmission(file, input, video, audio, signal);
    const format = new Mp4OutputFormat({ fastStart: false });
    const codecs = await encoding(video, null, info, format, signal);
    const selected = { start: Math.round(range.start * 48000) / 48000, end: Math.round(range.end * 48000) / 48000 };
    const buffer = await pcm.decodePcmSelection(file, selected, plan, signal);
    checkAbort(signal);
    target = pcm.boundedPcmTarget(plan.outputBytes);
    output = new Output({ format, target: target.target });
    audioSource = new AudioBufferSource({ codec: "aac", quality: new Quality({ bitrate: 96_000 }) }, { startTimestamp: 0 });
    output.addAudioTrack(audioSource);
    output.setMetadataTags({});
    conversion = await Conversion.init({ input, output, composable: true, tracks: "primary",
      audio: { discard: true }, video: codecs.video, copy: false, trim: selected, showWarnings: false });
    cancelConversion = conversion.cancel.bind(conversion);
    conversion.cancel = cancel;
    checkAbort(signal);
    if (!conversion.isValid || conversion.utilizedTracks.length !== 1 || conversion.utilizedTracks[0] !== video) {
      throw new Error("VIDEO_EDIT_MISSING_TRACK");
    }
    conversion.onProgress = progress => {
      if (!signal?.aborted && Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    checkAbort(signal);
    await output.start();
    checkAbort(signal);
    // Run both tracks concurrently for muxer backpressure. Always join both,
    // including the surviving pump after either one fails or is canceled.
    jobs.push(conversion.execute(), audioSource.add(buffer).then(() => audioSource!.close()));
    await Promise.all(jobs);
    checkAbort(signal);
    await output.finalize();
    checkAbort(signal);
    if (cleanupFailed) throw new Error("VIDEO_EDIT_CLEANUP_FAILED");
    const stem = file.name.replace(/\.[^.]*$/, "") || "video";
    const result = new File([target.finish()], `${stem}.mp4`, { type: "video/mp4" });
    const verification = new Input({ source: new BlobSource(result), formats: SENDABLE_FORMATS });
    try {
      await pcm.verifyPcmOutput(verification, info.width, info.height, selected.end - selected.start, signal);
      const actual = await readInfo(verification, signal);
      checkAbort(signal);
      return { file: result, ...actual.info, changed: true };
    } finally { verification.dispose(); }
  } catch (error) {
    checkAbort(signal);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      if (output && output.state !== "finalized") await cancel();
      if (canceling) await canceling;
      await Promise.allSettled(jobs);
      audioSource?.close();
      if (cleanupFailed) throw new Error("VIDEO_EDIT_CLEANUP_FAILED");
    } finally {
      target?.dispose();
      input.dispose();
    }
  }
}
