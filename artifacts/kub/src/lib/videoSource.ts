/**
 * What a picked video actually is, read from the file rather than guessed
 * (D-175).
 *
 * `videoSendLadder.ts` needs width, height, duration, frames per second,
 * bitrate and audio channels to offer a rung and put a number beside it. Before
 * this module the client could measure **two** of those: `readVideoDimensions`
 * loads a hidden element and reads `videoWidth`/`videoHeight`. Frames per
 * second, bitrate and the codec string had no source in this codebase at all,
 * which meant the ladder was arithmetic that could not be fed — and the rule it
 * cares most about, «never spend more than the source already spends», could
 * never fire.
 *
 * `mediabunny` reads them from the container: `computePacketStats` returns the
 * average packet rate (which for a video track is the frame rate) and the
 * average bitrate, and `getCodecParameterString` gives the codec string that
 * `canRemux` needs to decide whether anything has to be re-encoded at all.
 *
 * **The split here is deliberate.** `toSourceVideo` is pure and is where every
 * judgement lives — what counts as a usable number, what a missing track means,
 * what to fall back to. The reading is a thin shell around it that can only be
 * exercised in a browser. The ladder module was written the same way and its
 * tests caught a real inversion that no amount of looking at a control would
 * have.
 */

import { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } from "mediabunny";
import type { SourceVideo } from "./videoSendLadder.ts";

/**
 * How many packets to sample when averaging the rate and the bitrate.
 *
 * Bounded on purpose: a 2 GB clip has hundreds of thousands of packets, and the
 * question being answered — «roughly what does a second of this cost» — does not
 * improve past a few hundred. The library takes this as a target rather than a
 * promise.
 */
const PACKET_SAMPLE = 200;

/**
 * The containers a person actually sends to a chat, rather than every one the
 * library can read.
 *
 * This is what keeps the dependency small: the parsers are tree-shaken per
 * format, and ALL_FORMATS would pull in MPEG-TS, HLS, OGG, FLAC, WAV and MP3
 * to answer questions nobody asks about a video attachment. MP4 is the common
 * case, QTFF is what an iPhone writes, and WebM and Matroska cover Android and
 * desktop recordings — including the ones this product records itself.
 */
const SENDABLE_FORMATS = [MP4, QTFF, WEBM, MATROSKA];

/** What a container can tell us, before any judgement is applied. */
export interface RawVideoFacts {
  /** Bytes of the file as picked. */
  sizeBytes: number;
  /** Seconds, as the container reports them. */
  duration: number | null;
  width: number | null;
  height: number | null;
  /** Frames per second, averaged over the sampled packets. */
  fps: number | null;
  /** Bits per second of the video track, averaged over the sampled packets. */
  bitrate: number | null;
  audioChannels: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export interface VideoSourceFacts {
  source: SourceVideo;
  codecs: { video?: string; audio?: string };
  /**
   * Whether the numbers came from the container or from a fallback. A rung
   * offered on guessed numbers is still a rung, but the estimate beside it is
   * weaker, and a surface may want to say so.
   */
  measured: boolean;
}

/** A number a container reported that is actually usable. */
function usable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The facts, turned into what the ladder reads.
 *
 * Pure, and the only place that decides what a missing number means:
 *
 * - **no width or height** is fatal — without them there is no short side, no
 *   rung and no target frame, so the caller must fall back to sending the file
 *   as it is;
 * - **no duration** is fatal for the same reason in practice: every estimate is
 *   a rate multiplied by seconds, and a rung whose size cannot be stated should
 *   not be offered;
 * - **no frame rate** falls back to the ladder own 30, which is what
 *   `usableFps` already does and is documented there;
 * - **no bitrate** falls back to the whole file over its duration. That
 *   over-states the video track, because it includes the audio and the
 *   container — and over-stating is the safe direction here, since the number
 *   is used as a ceiling («never spend more than the source») rather than as a
 *   target;
 * - **no audio track** means no channels, which the estimate already handles.
 */
export function toSourceVideo(facts: RawVideoFacts): VideoSourceFacts | null {
  const width = usable(facts.width);
  const height = usable(facts.height);
  const duration = usable(facts.duration);
  if (!width || !height || !duration) return null;

  const measuredBitrate = usable(facts.bitrate);
  const derivedBitrate = facts.sizeBytes > 0 ? (facts.sizeBytes * 8) / duration : null;
  const bitrate = measuredBitrate ?? usable(derivedBitrate) ?? undefined;

  return {
    source: {
      width,
      height,
      duration,
      sizeBytes: facts.sizeBytes,
      fps: usable(facts.fps) ?? undefined,
      bitrate,
      audioChannels: usable(facts.audioChannels) ?? 0,
    },
    codecs: {
      video: facts.videoCodec ?? undefined,
      audio: facts.audioCodec ?? undefined,
    },
    measured: measuredBitrate !== null,
  };
}

/**
 * Read a picked file.
 *
 * Answers `null` for anything it cannot read rather than throwing: an
 * unreadable container is not an error a person should see, it is a video that
 * goes as it is. Every caller must have that path anyway, because a browser
 * without an encoder has no other one.
 */
export async function readVideoSource(file: File): Promise<VideoSourceFacts | null> {
  let input: Input | null = null;
  try {
    input = new Input({ source: new BlobSource(file), formats: SENDABLE_FORMATS });
    if (!(await input.canRead())) return null;

    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    const audio = await input.getPrimaryAudioTrack();

    const [duration, stats, videoCodec, audioCodec] = await Promise.all([
      input.computeDuration().catch(() => null),
      video.computePacketStats(PACKET_SAMPLE).catch(() => null),
      video.getCodecParameterString().catch(() => null),
      audio ? audio.getCodecParameterString().catch(() => null) : Promise.resolve(null),
    ]);

    return toSourceVideo({
      sizeBytes: file.size,
      duration,
      width: video.displayWidth,
      height: video.displayHeight,
      fps: stats?.averagePacketRate ?? null,
      bitrate: stats?.averageBitrate ?? null,
      audioChannels: audio ? audio.numberOfChannels : 0,
      videoCodec,
      audioCodec,
    });
  } catch {
    // A container this library cannot parse, a file that vanished, a browser
    // refusing the read: all the same answer, which is that the picked bytes go
    // as they are.
    return null;
  } finally {
    input?.dispose?.();
  }
}
