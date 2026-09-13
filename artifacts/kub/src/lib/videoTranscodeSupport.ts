/**
 * Whether this browser can encode video at all (D-175).
 *
 * The answer is not «probably»: `VideoEncoder` is absent from Firefox on
 * Android in every version that has ever shipped, and Safari only gained it in
 * 16.4. Telegram Web gates on the same question and falls back to sending the
 * picked file as it is. So must we — and the fallback is a full path rather
 * than an error, because a person whose browser cannot encode has done nothing
 * wrong.
 *
 * The question is put to the library that would do the encoding rather than
 * answered beside it. `canEncodeVideo` and `getFirstEncodableVideoCodec` ask
 * WebCodecs through the same configuration a real conversion would use, so a
 * yes here means the same thing a yes there means. A hand-written probe would
 * be a second opinion about someone else work.
 *
 * Deliberately says nothing about whether a transcode is a good idea. That
 * depends on how long the clip is and how long a person will wait, which is a
 * judgement for the surface that offers the choice, not for a capability check.
 */

import { canEncodeVideo, getFirstEncodableVideoCodec, type VideoCodec } from "mediabunny";

/**
 * The codecs worth asking about, in the order we would rather have them.
 *
 * H.264 first because it is what every player, every phone and our own server
 * pipeline already handle — `video_720p` is libx264 and `selectVideoPlaybackUrl`
 * hands it to a plain `<video>`. VP9 and AV1 are smaller at the same quality
 * and are the sensible second choice where a browser has them and H.264 is
 * missing, which happens on some Linux builds without the proprietary codecs.
 */
const PREFERRED_CODECS: VideoCodec[] = ["avc", "vp9", "av1", "vp8"];

/**
 * The frame the probe asks about.
 *
 * 1280x720 is the middle rung of the ladder and the one most clips will
 * actually land on, so a yes here is a yes about the common case rather than
 * about a frame nobody will encode.
 */
const PROBE_WIDTH = 1280;
const PROBE_HEIGHT = 720;

export type TranscodeUnavailable = "no-webcodecs" | "no-codec" | "probe-failed";

export interface TranscodeSupport {
  /** Whether anything can be encoded here. */
  available: boolean;
  /** The codec to encode with, when there is one. */
  codec: VideoCodec | null;
  /** Why not, for a log or a register entry — never for a person to read. */
  reason: TranscodeUnavailable | null;
}

const UNAVAILABLE = (reason: TranscodeUnavailable): TranscodeSupport => ({
  available: false,
  codec: null,
  reason,
});

/**
 * Memoised for the session.
 *
 * The probe constructs a real encoder configuration and asks the browser about
 * it, which on some devices spins up hardware. Asking once per page is the
 * difference between a capability check and a cost.
 */
let cached: Promise<TranscodeSupport> | null = null;

/** Whether the API exists at all, checked before anything heavier is attempted. */
function hasVideoEncoder(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === "function";
}

async function probe(): Promise<TranscodeSupport> {
  if (!hasVideoEncoder()) return UNAVAILABLE("no-webcodecs");
  try {
    const codec = await getFirstEncodableVideoCodec(PREFERRED_CODECS, {
      width: PROBE_WIDTH,
      height: PROBE_HEIGHT,
    });
    if (!codec) return UNAVAILABLE("no-codec");
    return { available: true, codec, reason: null };
  } catch {
    // A browser that throws on the question is a browser that answers no. This
    // is not an error worth surfacing: the file goes as it was picked.
    return UNAVAILABLE("probe-failed");
  }
}

/** What this browser can do, asked once and remembered. */
export function videoTranscodeSupport(): Promise<TranscodeSupport> {
  cached ??= probe();
  return cached;
}

/** For tests, and for a settings surface that wants to re-ask after a change. */
export function forgetVideoTranscodeSupport(): void {
  cached = null;
}

/**
 * Whether one specific frame can be encoded, for a rung the ladder is about to
 * offer.
 *
 * The session probe answers about 1280x720. A rung of 2160 on a device whose
 * encoder tops out lower would pass that probe and fail in the encoder, so the
 * rung itself is asked about before it is offered.
 */
export async function canEncodeFrame(codec: VideoCodec, width: number, height: number): Promise<boolean> {
  if (!hasVideoEncoder()) return false;
  try {
    return await canEncodeVideo(codec, { width, height });
  } catch {
    return false;
  }
}
