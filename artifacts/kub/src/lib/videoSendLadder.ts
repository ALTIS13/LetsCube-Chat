/**
 * What a video may be sent at, and roughly what it will weigh (D-175).
 *
 * Free of React, of the `@/` alias and of every browser API, so `node --test`
 * can execute it directly and so the arithmetic can be argued about without a
 * page. Nothing here encodes anything; it decides what to offer and what number
 * to put beside each offer.
 *
 * **Where the numbers come from.** Telegram solves this four times, differently,
 * and the desktop client solves it best — so that is the one copied, with its
 * reasoning rather than only its constants:
 *
 * - the ladder is counted on the **short** side, as tdesktop does, because
 *   «720p» has always named the short side. Android counts the long one, which
 *   makes «854» mean different pictures for a landscape and a portrait clip.
 * - the bitrate is **0.07 bits per pixel per frame**, clamped between 600 kbit/s
 *   and 6.8 Mbit/s (tdesktop `TargetBitrate`).
 * - a target **never exceeds what the source already spent** (tdesktop:
 *   «Quality mode never spends much more than the source did»). Re-encoding a
 *   2 Mbit/s clip at 6 Mbit/s makes a bigger file that is not a better one.
 * - the container is modelled rather than ignored: fixed boxes plus per-frame
 *   tables, which is where the last few per cent of a real mp4 goes.
 *
 * **What this module cannot do, and says so.** Android asks the hardware what
 * bitrate it will actually apply (`extractRealEncoderBitrate`) and computes the
 * estimate from the answer. A browser has no such call — `isConfigSupported`
 * answers yes or no. So every size here is an estimate and must be shown as
 * one; `estimateIsApproximate` exists to make that impossible to forget.
 */

/** A rung of the ladder, named by its short side the way people say it. */
export type VideoSendHeight = 480 | 720 | 1080 | 1440 | 2160;

export interface VideoSendLevel {
  /** The short side, and the identity of the rung. */
  height: VideoSendHeight;
  /** «480p», «2K», «4K» — what a person reads. */
  label: string;
}

/**
 * The rungs, smallest first. 1440 and 2160 are named 2K and 4K because that is
 * what the owner asked for and what a phone camera writes on its own setting;
 * they are not exact cinema dimensions and this module does not pretend they
 * are.
 */
export const VIDEO_SEND_LEVELS: readonly VideoSendLevel[] = [
  { height: 480, label: "480p" },
  { height: 720, label: "720p" },
  { height: 1080, label: "1080p" },
  { height: 1440, label: "2K" },
  { height: 2160, label: "4K" },
];

/** Bits per pixel per frame. tdesktop `TargetBitrate`. */
const BITS_PER_PIXEL_FRAME = 0.07;
const MIN_BITRATE = 600_000;
const MAX_BITRATE = 6_800_000;

/**
 * Frames per second when a file does not say, or says something absurd.
 * A container reporting 1000 fps would otherwise ask for a bitrate no encoder
 * would produce and an estimate no upload could match.
 */
const FPS_FALLBACK = 30;
const FPS_MAX = 120;

/** Audio, where the source is re-encoded rather than carried across. */
const AUDIO_BITRATE_PER_CHANNEL = 64_000;

/**
 * Container overhead, from tdesktop `EstimateTranscodedSize`, whose own comment
 * calls these «Measured mp4 overhead». Kept as three numbers rather than one
 * percentage because a long clip at a low bitrate is mostly tables.
 */
const CONTAINER_BYTES = 2_000;
const CONTAINER_BYTES_PER_VIDEO_FRAME = 24;
const CONTAINER_BYTES_PER_AUDIO_FRAME = 12;
const AUDIO_FRAME_SAMPLES = 1024;
const AUDIO_FREQUENCY = 44_100;

/**
 * A number and its unit are not separated by a breakable space here, as
 * formatSizeRoundedUp in mediaCompression already does. Written as a code
 * point rather than typed: an invisible character in a literal is a trap, and
 * this one already produced a test failure where two identical-looking strings
 * compared unequal.
 */
const NBSP = String.fromCharCode(160);

/**
 * Encoders take macroblocks, and Chromium crops to 16x16 on Android rather than
 * refusing — «MediaCodec encoder requires 16x16 aligned resolution. Cropping
 * to…». A rung that asks for 854x480 can therefore silently become 848x480, so
 * the alignment is done here where it can be seen and tested.
 */
export function alignTo16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}

export interface SourceVideo {
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  /** Bytes of the file as picked. */
  sizeBytes: number;
  /** Frames per second, if the container said. */
  fps?: number;
  /** Bits per second of the source video track, if known. */
  bitrate?: number;
  /** Audio channels, 0 for a silent clip. */
  audioChannels?: number;
}

/** The short side of a picture, whichever way round it is. */
export function shortSideOf(source: Pick<SourceVideo, "width" | "height">): number {
  return Math.min(source.width, source.height);
}

/** A sane frames-per-second, whatever the container claimed. */
export function usableFps(fps: number | undefined): number {
  if (!Number.isFinite(fps) || (fps ?? 0) <= 0) return FPS_FALLBACK;
  return Math.min(fps as number, FPS_MAX);
}

/**
 * The rungs worth offering for this source.
 *
 * Only those **below** what the source already is: a 720p clip offered at 1080p
 * would be upscaled, which costs bytes and adds nothing. The source itself is
 * always offered as the top rung, so there is always a way to send it as it is
 * — which is also the only path a browser without an encoder has.
 */
export function offeredLevels(source: Pick<SourceVideo, "width" | "height">): VideoSendHeight[] {
  const short = shortSideOf(source);
  if (!Number.isFinite(short) || short <= 0) return [];
  return VIDEO_SEND_LEVELS.filter((level) => level.height < short).map((level) => level.height);
}

/** The frame a rung asks for, keeping the source aspect and the encoder alignment. */
export function targetSizeFor(source: Pick<SourceVideo, "width" | "height">, height: VideoSendHeight): {
  width: number;
  height: number;
} {
  const short = shortSideOf(source);
  if (short <= 0) return { width: 0, height: 0 };
  const scale = height / short;
  const portrait = source.height >= source.width;
  // Portrait: the short side is the width, so the rung names the width.
  // Landscape: the short side is the height. Getting these the wrong way
  // round turned 1920x1080 at 720p into a 720x720 square, which the unit test
  // caught and no amount of looking at a slider would have.
  return portrait
    ? { width: alignTo16(height), height: alignTo16(source.height * scale) }
    : { width: alignTo16(source.width * scale), height: alignTo16(height) };
}

/** tdesktop `TargetBitrate`: bits per pixel per frame, clamped. */
export function targetBitrate(width: number, height: number, fps: number): number {
  const pixels = width * height;
  const bits = pixels * usableFps(fps) * BITS_PER_PIXEL_FRAME;
  return Math.round(Math.min(Math.max(bits, MIN_BITRATE), MAX_BITRATE));
}

/**
 * What a rung would weigh, in bytes.
 *
 * Never larger than what the source spent: a rung asking for more bits than the
 * file already has would produce a bigger file that is not a better one.
 */
export function estimateBytes(source: SourceVideo, height: VideoSendHeight): number {
  const target = targetSizeFor(source, height);
  const fps = usableFps(source.fps);
  const wanted = targetBitrate(target.width, target.height, fps);
  const video = source.bitrate && source.bitrate > 0 ? Math.min(wanted, source.bitrate) : wanted;
  const channels = Math.min(Math.max(source.audioChannels ?? 0, 0), 2);
  const audio = channels > 0 ? AUDIO_BITRATE_PER_CHANNEL * channels : 0;
  const seconds = Math.max(source.duration, 0);
  const container =
    CONTAINER_BYTES +
    CONTAINER_BYTES_PER_VIDEO_FRAME * seconds * fps +
    (channels > 0 ? (CONTAINER_BYTES_PER_AUDIO_FRAME * seconds * AUDIO_FREQUENCY) / AUDIO_FRAME_SAMPLES : 0);
  return Math.round(((video + audio) * seconds) / 8 + container);
}

/**
 * How much smaller a rung has to promise to be before it is worth encoding.
 *
 * A tenth. Below that a person waits minutes, spends battery, and receives a
 * file of nearly the same size that has been through one more generation of
 * lossy encoding. The number is a judgement rather than a measurement, and it is
 * named here so it can be argued with.
 */
export const WORTH_ENCODING = 0.9;

/**
 * Whether a rung would actually make this file meaningfully smaller.
 *
 * Measured in bytes rather than in pixels, which was the first attempt and was
 * wrong: aligning 854 down to 848 counts as a smaller picture while changing
 * nothing anybody can see.
 *
 * This lives beside the estimate rather than beside the encoder because two
 * places have to agree about it — the slider, which must not show a saving it
 * will not deliver, and the plan, which must not spend the minutes. A rule
 * written twice is a rule that will disagree with itself.
 */
export function worthEncoding(source: SourceVideo, height: VideoSendHeight): boolean {
  if (!(source.sizeBytes > 0)) return true;
  return estimateBytes(source, height) <= source.sizeBytes * WORTH_ENCODING;
}

/**
 * Every estimate this module produces is an estimate.
 *
 * Exported as a constant rather than left as a comment because the number is
 * going next to a control, and the one thing that must not happen is a person
 * reading it as a promise. Android can be exact because it asks the hardware;
 * a browser cannot ask.
 */
export const estimateIsApproximate = true;

/** «12,4 МБ», «1,2 ГБ» — what goes beside a rung. Russian decimal comma. */
export function formatEstimate(bytes: number): string {
  const MiB = 1024 * 1024;
  const GiB = MiB * 1024;
  if (bytes >= GiB) {
    return (bytes / GiB).toFixed(1).replace(".", ",") + `${NBSP}ГБ`;
  }
  if (bytes >= MiB) {
    const value = bytes / MiB;
    return (value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(".", ",")) + `${NBSP}МБ`;
  }
  return Math.max(1, Math.round(bytes / 1024)) + `${NBSP}КБ`;
}

/**
 * Whether the file can be repackaged instead of re-encoded.
 *
 * The cheapest win there is, and both tdesktop and Telegram web keep it as a
 * fast path: an H.264 video with AAC audio, unchanged in size, only needs its
 * frames moved into a new container. Their own note — «remuxing is I/O-bound,
 * so even a huge H.264 file converts in moments» against «an actual transcode
 * runs at roughly realtime».
 *
 * Codec strings are the ones a browser reports, so this is a prefix test rather
 * than an equality one: `avc1.640028` and `avc1.42001f` are both H.264.
 */
export function canRemux(
  source: Pick<SourceVideo, "width" | "height">,
  chosen: VideoSendHeight | "source",
  codecs: { video?: string; audio?: string },
): boolean {
  if (chosen !== "source") return false;
  const video = (codecs.video ?? "").toLowerCase();
  const audio = (codecs.audio ?? "").toLowerCase();
  const h264 = video.startsWith("avc1") || video.startsWith("h264");
  const aac = audio === "" || audio.startsWith("mp4a") || audio.startsWith("aac");
  return h264 && aac && shortSideOf(source) > 0;
}
