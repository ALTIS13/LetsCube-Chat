/**
 * One slider over a whole selection of videos (D-175).
 *
 * `videoSendLadder.ts` answers about one file. The attach sheet sends up to ten
 * at once, and the owner asked for a slider — one control, with a weight beside
 * it. So the rungs offered are the union of what the selected videos can offer,
 * and a rung means «every video that is bigger than this comes down to it; the
 * rest go as they are». Telegram asks per video because it opens an editor per
 * video; a sheet that sends a batch cannot, and pretending otherwise would mean
 * a number beside the slider that belongs to only one of the files.
 *
 * The counter is therefore a sum, and it is honest about which half of the sum
 * is an estimate: a file being encoded contributes an estimate, a file going as
 * it was picked contributes its own exact size, and `approximate` says whether
 * any estimate went into the total at all.
 *
 * Pure, and free of every browser API, so `node --test` reads it directly.
 */

import {
  VIDEO_SEND_LEVELS,
  estimateBytes,
  formatEstimate,
  shortSideOf,
  worthEncoding,
  type SourceVideo,
  type VideoSendHeight,
} from "./videoSendLadder.ts";

/** A rung, or the files as they were picked. */
export type VideoSendStop = VideoSendHeight | "source";

/** One selected video, whether or not its container could be read. */
export interface SelectedVideo {
  id: string;
  /** Bytes of the file as picked. Known even when nothing else is. */
  sizeBytes: number;
  /**
   * What the container said, or null when it could not be read. An unreadable
   * file is not an error here: it has no rungs to offer, it goes as it was
   * picked, and its exact size still counts towards the total.
   */
  source: SourceVideo | null;
}

export const SOURCE_STOP = "source" as const;

/**
 * The rendition the server makes anyway.
 *
 * `buildVideo720pFfmpegArgs` produces a 720p H.264 copy of every video that is
 * uploaded, and `selectVideoPlaybackUrl` hands that copy to the player. So 720p
 * is not an arbitrary default: it is the picture the conversation was going to
 * show regardless, and a client that produces it is doing the work in the place
 * where it costs a person nothing extra to wait.
 */
export const SERVER_RENDITION_HEIGHT: VideoSendHeight = 720;

const isRung = (stop: VideoSendStop): stop is VideoSendHeight => stop !== SOURCE_STOP;

/**
 * The stops a slider offers for this selection, smallest first, with the source
 * always last.
 *
 * A rung is offered only where it would actually do something to some selected
 * file. A rung nothing is bigger than, or one that would shave a few per cent
 * off a file already near its own floor, still has to show a number — and the
 * number would be the same one the stop beside it shows, which teaches a person
 * that the slider is decorative.
 */
export function selectionStops(videos: readonly SelectedVideo[]): VideoSendStop[] {
  const rungs = VIDEO_SEND_LEVELS.filter((level) =>
    videos.some((video) => isRung(stopForVideo(video, level.height))),
  ).map((level) => level.height);
  return [...rungs, SOURCE_STOP];
}

/**
 * What one video does at a chosen stop.
 *
 * Two rules, both of which end in «as it was picked»: a rung at or above a
 * file's own short side is not a smaller picture, and a rung that would not make
 * the file meaningfully smaller is not worth a generation of loss. The second is
 * `worthEncoding`, which `planVideoSend` applies as well — the slider and the
 * encoder have to agree, or the number beside a rung promises a saving that the
 * send then declines to deliver.
 */
export function stopForVideo(video: SelectedVideo, stop: VideoSendStop): VideoSendStop {
  if (!isRung(stop) || !video.source) return SOURCE_STOP;
  if (stop >= shortSideOf(video.source)) return SOURCE_STOP;
  return worthEncoding(video.source, stop) ? stop : SOURCE_STOP;
}

/** The videos a chosen stop would actually encode. */
export function videosToEncode(videos: readonly SelectedVideo[], stop: VideoSendStop): SelectedVideo[] {
  return videos.filter((video) => isRung(stopForVideo(video, stop)));
}

/** What one video weighs at a chosen stop: its estimate, or its own exact size. */
export function videoBytesAt(video: SelectedVideo, stop: VideoSendStop): number {
  const effective = stopForVideo(video, stop);
  if (!isRung(effective) || !video.source) return video.sizeBytes;
  return estimateBytes(video.source, effective);
}

export interface StopSummary {
  /** «720p», «Исходное». */
  label: string;
  /** «24,8 МБ». */
  size: string;
  /**
   * Whether any part of that number is an estimate. False when every file at
   * this stop goes as it was picked, which is the one case where the number is
   * exactly what will be uploaded.
   */
  approximate: boolean;
  /** How many of the selected videos this stop would re-encode. */
  encoding: number;
}

/** What a rung is called. */
export function stopLabel(stop: VideoSendStop): string {
  if (!isRung(stop)) return "Исходное";
  return VIDEO_SEND_LEVELS.find((level) => level.height === stop)?.label ?? `${stop}p`;
}

/**
 * The line under the slider.
 *
 * The sum, and whether it is an estimate. Shown together on purpose: a number
 * that is sometimes exact and sometimes not, with nothing saying which, is
 * worse than a number that is always marked.
 */
export function stopSummary(videos: readonly SelectedVideo[], stop: VideoSendStop): StopSummary {
  const encoding = videosToEncode(videos, stop);
  const bytes = videos.reduce((sum, video) => sum + videoBytesAt(video, stop), 0);
  return {
    label: stopLabel(stop),
    size: formatEstimate(bytes),
    approximate: encoding.length > 0,
    encoding: encoding.length,
  };
}

/**
 * Where the slider starts.
 *
 * At the picture the server was going to produce anyway, when anything in the
 * selection is bigger than it; otherwise at the source, because a clip already
 * at or under 720p has nothing to gain from being made smaller and would only
 * lose a generation of encoding.
 */
export function defaultStop(videos: readonly SelectedVideo[]): VideoSendStop {
  return selectionStops(videos).includes(SERVER_RENDITION_HEIGHT) ? SERVER_RENDITION_HEIGHT : SOURCE_STOP;
}

/**
 * The stops left after asking whether this browser can encode them.
 *
 * A rung stays if **any** selected video can be encoded at it, because at a
 * given stop some files go as they were picked anyway — that is the ordinary
 * case for a mixed selection, not a failure. A rung no file can be encoded at
 * is removed rather than shown and then quietly declined: D-175 exists because
 * a silent decline and a broken transcode look identical to a person.
 *
 * The source stop is never removed. It is the one path that always works,
 * including in a browser with no encoder at all.
 */
export function encodableStops(
  videos: readonly SelectedVideo[],
  canEncode: (video: SelectedVideo, rung: VideoSendHeight) => boolean,
): VideoSendStop[] {
  return selectionStops(videos).filter((stop) => {
    if (!isRung(stop)) return true;
    return videos.some((video) => isRung(stopForVideo(video, stop)) && canEncode(video, stop));
  });
}

/** The stop a slider lands on, when the one it held is no longer offered. */
export function nearestStop(stops: readonly VideoSendStop[], wanted: VideoSendStop): VideoSendStop {
  if (stops.includes(wanted)) return wanted;
  if (!stops.length) return SOURCE_STOP;
  if (!isRung(wanted)) return stops[stops.length - 1];
  const rungs = stops.filter(isRung);
  if (!rungs.length) return SOURCE_STOP;
  // The nearest rung, and upwards when two are equally near: a person who asked
  // for a smaller picture and cannot have it should be given the closest one
  // that exists rather than the smallest that does.
  let best = rungs[0];
  for (const rung of rungs) {
    if (Math.abs(rung - wanted) < Math.abs(best - wanted)) best = rung;
  }
  return best;
}
