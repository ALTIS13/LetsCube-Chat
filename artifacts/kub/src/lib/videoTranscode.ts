/**
 * Turning a chosen rung into an actual file (D-175).
 *
 * The split is the same one the ladder and the source reader use, for the same
 * reason: `planVideoSend` is pure and holds every decision — whether to encode
 * at all, at what frame, at what bitrate, and what to do when the browser
 * cannot — while `transcodeVideo` only carries that decision out. The decisions
 * are the part that can be wrong in a way nobody notices, so they are the part
 * that is tested.
 *
 * **What this does not do, deliberately.** It does not decide whether a
 * transcode is worth the wait. A browser encodes at roughly realtime, so a
 * five-minute clip costs five minutes, and whether that is acceptable is a
 * question for the person and the surface asking them — not for a module that
 * only knows about pixels.
 */

import {
  BufferTarget,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  type VideoCodec,
} from "mediabunny";
import { SENDABLE_FORMATS } from "./videoSource.ts";
import {
  estimateBytes,
  targetBitrate,
  targetSizeFor,
  usableFps,
  type SourceVideo,
  type VideoSendHeight,
} from "./videoSendLadder.ts";

/** A rung, or the file as it was picked. */
export type VideoSendChoice = VideoSendHeight | "source";

export type VideoSendAction = "transcode" | "as-is";

export interface VideoSendPlan {
  action: VideoSendAction;
  /** Present only for a transcode. */
  target: { width: number; height: number; bitrate: number; frameRate: number; codec: VideoCodec } | null;
  /**
   * Why this plan, in words meant for a log or a register entry rather than for
   * a person. A plan that silently declines to encode is indistinguishable from
   * one that encoded badly unless it says which it was.
   */
  reason:
    | "chose-source"
    | "no-encoder"
    | "rung-not-encodable"
    | "not-smaller"
    | "transcoding";
}

/**
 * How much smaller a rung has to promise to be before it is worth encoding.
 *
 * A tenth. Below that the person waits minutes, spends battery, and receives a
 * file of nearly the same size that has been through one more generation of
 * lossy encoding. The number is a judgement rather than a measurement, and it
 * is here rather than inline so it can be argued with.
 */
const WORTH_ENCODING = 0.9;

const asIs = (reason: VideoSendPlan["reason"]): VideoSendPlan => ({ action: "as-is", target: null, reason });

/**
 * What should happen to this file, given what the person chose and what the
 * browser can do.
 *
 * Pure. Every path that ends in «send it as it was picked» is named, because
 * that is the outcome a person cannot tell apart from a failure: the video
 * simply arrives large, and nothing says whether we declined, could not, or
 * tried and gave up.
 */
export function planVideoSend(
  source: SourceVideo,
  choice: VideoSendChoice,
  support: { available: boolean; codec: VideoCodec | null },
  rungIsEncodable = true,
): VideoSendPlan {
  if (choice === "source") return asIs("chose-source");
  if (!support.available || !support.codec) return asIs("no-encoder");
  if (!rungIsEncodable) return asIs("rung-not-encodable");

  const frame = targetSizeFor(source, choice);
  if (frame.width <= 0 || frame.height <= 0) return asIs("rung-not-encodable");

  const frameRate = usableFps(source.fps);
  const wanted = targetBitrate(frame.width, frame.height, frameRate);
  // The ladder rule, applied here rather than only in the estimate: asking for
  // more bits than the source spends produces a bigger file that is not a
  // better one, and a person who chose a smaller rung asked for the opposite.
  const bitrate = source.bitrate && source.bitrate > 0 ? Math.min(wanted, source.bitrate) : wanted;

  // And the honest refusal, measured in the thing a person actually cares
  // about rather than in pixels: if the rung would not make the file
  // meaningfully smaller, spending minutes of somebody battery to produce a
  // generation-lossed copy of nearly the same size is worse than sending what
  // they picked.
  //
  // Comparing pixel counts was the first attempt and it was wrong: aligning
  // 854 down to 848 counts as smaller while changing nothing anybody can see.
  const estimated = estimateBytes(source, choice);
  if (source.sizeBytes > 0 && estimated > source.sizeBytes * WORTH_ENCODING) {
    return asIs("not-smaller");
  }

  return {
    action: "transcode",
    target: { width: frame.width, height: frame.height, bitrate, frameRate, codec: support.codec },
    reason: "transcoding",
  };
}

export interface TranscodeHandle {
  /** 0 to 1, and the seconds of input already read. */
  onProgress?: (progress: number, processedSeconds: number) => void;
  /** Aborting asks the conversion to stop; the promise then resolves to null. */
  signal?: AbortSignal;
}

/**
 * Carry out a transcode.
 *
 * Answers `null` rather than throwing for every failure, including
 * cancellation. The caller has to have a «send it as it was picked» path
 * regardless — a browser without an encoder leaves no other one — so an
 * exception here would only be a second way to reach the same place.
 */
export async function transcodeVideo(
  file: File,
  plan: VideoSendPlan,
  handle: TranscodeHandle = {},
): Promise<File | null> {
  if (plan.action !== "transcode" || !plan.target) return null;

  let input: Input | null = null;
  try {
    input = new Input({ source: new BlobSource(file), formats: SENDABLE_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        width: plan.target.width,
        height: plan.target.height,
        // `contain` rather than `cover`: the frame was computed from the source
        // aspect, so nothing should be cropped. If a rounding to sixteen leaves
        // a pixel of disagreement, a letterbox is honest and a crop is not.
        fit: "contain",
        codec: plan.target.codec,
        bitrate: plan.target.bitrate,
        frameRate: plan.target.frameRate,
      },
    });

    if (!conversion.isValid) return null;

    if (handle.onProgress) {
      conversion.onProgress = (progress, processedTime) => handle.onProgress?.(progress, processedTime);
    }

    const onAbort = () => void conversion.cancel();
    handle.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (handle.signal?.aborted) return null;
      await conversion.execute();
    } finally {
      handle.signal?.removeEventListener("abort", onAbort);
    }

    const buffer = output.target.buffer;
    if (!buffer) return null;

    return new File([buffer], transcodedName(file.name), { type: "video/mp4" });
  } catch {
    // Cancellation lands here too, and means the same thing as any other
    // failure: the picked bytes go instead.
    return null;
  } finally {
    input?.dispose?.();
  }
}

/**
 * The name the transcoded file carries.
 *
 * The extension has to become mp4 because the container did, and a name whose
 * extension disagrees with its bytes is the kind of thing that is correct
 * everywhere until one reader trusts the name.
 */
export function transcodedName(original: string): string {
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem || "video"}.mp4`;
}
