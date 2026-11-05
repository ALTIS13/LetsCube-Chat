import {
  EncodedPacketSink, MP4, StreamTarget,
  type Input, type InputAudioTrack, type InputVideoTrack,
} from "mediabunny";

const INPUT_BYTES = 8_388_608;
const DURATION_SECONDS = 15;
const PCM_BYTES = 3_145_728;
const COPY_BYTES = 12_582_912;
const OUTPUT_BYTES = 8_388_608;
const RATE = 48_000;
const AAC_FRAMES = 1024;
const TICK = 1 / RATE;

function unsupported(): never { throw new Error("VIDEO_EDIT_UNSUPPORTED"); }
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Video edit canceled", "AbortError");
}

interface Box { type: string; start: number; end: number }
function boxes(view: DataView, start: number, end: number): Box[] {
  const result: Box[] = [];
  while (start < end) {
    if (result.length >= 128 || end - start < 8) unsupported();
    const size = view.getUint32(start);
    if (size < 8 || size > end - start) unsupported(); // No extended/indefinite boxes.
    const type = String.fromCharCode(...new Uint8Array(view.buffer, start + 4, 4));
    result.push({ type, start, end: start + size });
    start += size;
  }
  return result;
}
function one(list: Box[], type: string): Box {
  const found = list.filter(box => box.type === type);
  if (found.length !== 1) unsupported();
  return found[0];
}

/** Narrow origin proof: nonfragmented MP4, no edits except one unit-rate priming edit. */
async function verifyMp4Origin(file: File, video: InputVideoTrack, audio: InputAudioTrack,
  audioStart: number, audioEnd: number, videoEnd: number, signal?: AbortSignal) {
  let offset = 0, count = 0, moov: ArrayBuffer | undefined;
  while (offset < file.size) {
    checkAbort(signal);
    if (++count > 128 || file.size - offset < 8) unsupported();
    const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
    const size = header.getUint32(0), type = String.fromCharCode(...new Uint8Array(header.buffer, 4, 4));
    if (size < 8 || size > file.size - offset || !["ftyp", "moov", "mdat", "free", "skip", "wide"].includes(type)) unsupported();
    if (type === "moov") {
      if (moov || size > 262_144) unsupported();
      moov = await file.slice(offset, offset + size).arrayBuffer();
    }
    offset += size;
  }
  checkAbort(signal);
  if (!moov) unsupported();
  const view = new DataView(moov), root = boxes(view, 8, moov.byteLength);
  if (root.some(box => box.type === "mvex")) unsupported();
  const mvhd = one(root, "mvhd");
  if (view.getUint8(mvhd.start + 8) !== 0 || mvhd.end - mvhd.start < 28) unsupported();
  const movieScale = view.getUint32(mvhd.start + 20);
  if (!movieScale) unsupported();
  const tracks = root.filter(box => box.type === "trak");
  if (tracks.length !== 2) unsupported();
  const ids = new Set<number>();
  for (const track of tracks) {
    const children = boxes(view, track.start + 8, track.end), tkhd = one(children, "tkhd");
    if (view.getUint8(tkhd.start + 8) !== 0 || tkhd.end - tkhd.start < 24) unsupported();
    const id = view.getUint32(tkhd.start + 20);
    if (ids.has(id) || (id !== audio.id && id !== video.id)) unsupported();
    ids.add(id);
    const isAudio = id === audio.id;
    const mdia = one(children, "mdia"), mdhd = one(boxes(view, mdia.start + 8, mdia.end), "mdhd");
    if (view.getUint8(mdhd.start + 8) !== 0 || mdhd.end - mdhd.start < 28) unsupported();
    const scale = view.getUint32(mdhd.start + 20);
    if (!scale || (isAudio && scale !== RATE)) unsupported();
    const edits = children.filter(box => box.type === "edts");
    if (edits.length === 0) {
      if (isAudio && Math.abs(audioStart) > TICK) unsupported();
      continue;
    }
    if (edits.length !== 1) unsupported();
    const entries = boxes(view, edits[0].start + 8, edits[0].end), elst = one(entries, "elst");
    if (entries.length !== 1 || elst.end - elst.start !== 28
      || view.getUint32(elst.start + 8) !== 0 || view.getUint32(elst.start + 12) !== 1
      || view.getInt32(elst.start + 24) !== 65536
      || view.getInt32(elst.start + 20) !== (isAudio ? Math.round(-audioStart * RATE) : 0)
      || Math.abs(view.getUint32(elst.start + 16) / movieScale - (isAudio ? audioEnd : videoEnd)) > 1 / movieScale + TICK) unsupported();
  }
}

export function pcmBudget(bytes: number, duration: number, maxFrames: number) {
  const decodedBytes = maxFrames * 4;
  // Decoder result, selected AudioBuffer, library sample copy and encoder handoff.
  const copyBytes = decodedBytes * 4;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > INPUT_BYTES
    || !Number.isFinite(duration) || duration <= 0 || duration > DURATION_SECONDS
    || !Number.isSafeInteger(maxFrames) || maxFrames <= 0
    || decodedBytes > PCM_BYTES || copyBytes > COPY_BYTES) unsupported();
  return { maxFrames, decodedBytes, copyBytes, outputBytes: OUTPUT_BYTES };
}

export interface PcmPlan extends ReturnType<typeof pcmBudget> {
  sampleRate: number;
  channels: number;
  duration: number;
}

/** Metadata/packet-only admission. No AudioContext, complete-file read or decoding. */
export async function inspectPcmFallback(
  file: File, input: Input, video: InputVideoTrack, audio: InputAudioTrack | null, signal?: AbortSignal,
): Promise<PcmPlan> {
  pcmBudget(file.size, 1, 1);
  checkAbort(signal);
  if (!audio || await input.getFormat() !== MP4) unsupported();
  const tracks = await input.getTracks();
  checkAbort(signal);
  if (tracks.length !== 2 || !tracks.includes(video) || !tracks.includes(audio)
    || video.input !== input || audio.input !== input) unsupported();
  if (await video.getCodec() !== "avc" || await audio.getCodec() !== "aac") unsupported();
  const config = await audio.getDecoderConfig();
  checkAbort(signal);
  if (!config || config.codec !== "mp4a.40.2" || config.numberOfChannels !== 1 || config.sampleRate !== RATE
    || !config.description) unsupported();
  const description = ArrayBuffer.isView(config.description)
    ? new Uint8Array(config.description.buffer, config.description.byteOffset, config.description.byteLength)
    : new Uint8Array(config.description);
  // AAC-LC, 48 kHz, mono, 1024-frame GA config; no SBR/PS or extension ambiguity.
  if (description.length !== 2 || description[0] !== 0x11 || description[1] !== 0x88) unsupported();
  const width = await video.getDisplayWidth(), height = await video.getDisplayHeight();
  const videoStart = await video.getFirstTimestamp(), videoEnd = await video.computeDuration();
  const audioStart = await audio.getFirstTimestamp(), audioEnd = await audio.computeDuration();
  checkAbort(signal);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width * height > 921_600 || width > 1280 || height > 1280
    || Math.abs(videoStart) > TICK
    || !(Math.abs(audioStart) <= TICK || Math.abs(audioStart + AAC_FRAMES / RATE) <= TICK)
    || !Number.isFinite(audioEnd) || !Number.isFinite(videoEnd)
    || Math.abs(audioEnd - videoEnd) > 2 * AAC_FRAMES / RATE) unsupported();
  const duration = Math.max(videoEnd, audioEnd);
  pcmBudget(file.size, duration, Math.ceil(duration * RATE) + AAC_FRAMES);
  let count = 0, previousEnd = audioStart;
  for await (const packet of new EncodedPacketSink(audio).packets(undefined, undefined, { metadataOnly: true })) {
    checkAbort(signal);
    if (++count > 705 || !Number.isFinite(packet.timestamp) || !Number.isFinite(packet.duration)
      || Math.abs(packet.timestamp - previousEnd) > TICK
      || Math.abs(packet.duration * RATE - AAC_FRAMES) > 1) unsupported();
    previousEnd = packet.timestamp + packet.duration;
  }
  if (!count || Math.abs(previousEnd - audioEnd) > TICK) unsupported();
  await verifyMp4Origin(file, video, audio, audioStart, audioEnd, videoEnd, signal);
  // Count includes priming, so reserves at least the full decoder payload.
  return { ...pcmBudget(file.size, duration, count * AAC_FRAMES), sampleRate: RATE, channels: 1, duration: audioEnd };
}

export function selectPcmFrames(
  decoded: AudioBuffer, context: Pick<AudioContext, "createBuffer">,
  range: { start: number; end: number }, plan: PcmPlan,
): AudioBuffer {
  const start = Math.round(range.start * RATE), end = Math.round(range.end * RATE);
  if (decoded.sampleRate !== RATE || decoded.numberOfChannels !== 1
    || !Number.isSafeInteger(decoded.length) || decoded.length > plan.maxFrames
    || Math.abs(decoded.length / RATE - plan.duration) > TICK
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > decoded.length
    || (end - start) * 4 > plan.decodedBytes || plan.copyBytes > COPY_BYTES) {
    throw new Error("VIDEO_EDIT_INVALID_PCM");
  }
  const selected = context.createBuffer(1, end - start, RATE);
  selected.copyToChannel(decoded.getChannelData(0).subarray(start, end), 0);
  return selected;
}

/** decodeAudioData cannot be aborted. Retain ownership until it and close settle. */
export async function decodePcmSelection(file: File, range: { start: number; end: number }, plan: PcmPlan, signal?: AbortSignal) {
  checkAbort(signal);
  pcmBudget(file.size, plan.duration, plan.maxFrames);
  const context = new AudioContext({ sampleRate: RATE });
  try {
    const encoded = await file.arrayBuffer();
    checkAbort(signal);
    const decoded = await context.decodeAudioData(encoded);
    checkAbort(signal);
    return selectPcmFrames(decoded, context, range, plan);
  } finally {
    await context.close();
  }
}

/** Fixed capacity, random-access writes; never grow an output buffer after encoding. */
export function boundedPcmTarget(capacity: number) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > OUTPUT_BYTES) unsupported();
  let bytes: Uint8Array<ArrayBuffer> | undefined = new Uint8Array(capacity);
  let length = 0;
  const target = new StreamTarget(new WritableStream({
    write({ position, data }) {
      const end = position + data.byteLength;
      if (!bytes || !Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(end) || end > capacity) {
        throw new Error("VIDEO_EDIT_OUTPUT_BUDGET");
      }
      bytes.set(data, position);
      length = Math.max(length, end);
    },
  }), { chunked: false });
  return {
    target,
    finish() {
      if (!bytes || length === 0) throw new Error("VIDEO_EDIT_INVALID_OUTPUT");
      return bytes.subarray(0, length);
    },
    dispose() { bytes = undefined; },
  };
}

export function isPcmCodecFailure(error: unknown, phase: string): boolean {
  return phase === "execute" && error instanceof DOMException && error.name === "EncodingError";
}

/** Fail closed on rendition, timestamps, both durations, extra tracks or copied tags. */
export async function verifyPcmOutput(input: Input, width: number, height: number, duration: number, signal?: AbortSignal) {
  const tracks = await input.getTracks();
  const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
  checkAbort(signal);
  if (tracks.length !== 2 || !video || !audio || !tracks.includes(video) || !tracks.includes(audio)
    || await video.getDisplayWidth() !== width || await video.getDisplayHeight() !== height
    || await audio.getSampleRate() !== RATE || await audio.getNumberOfChannels() !== 1
    || await video.getCodec() !== "avc" || await audio.getCodec() !== "aac"
    || Object.keys(await input.getMetadataTags()).length !== 0) throw new Error("VIDEO_EDIT_INVALID_OUTPUT");
  const vStart = await video.getFirstTimestamp(), aStart = await audio.getFirstTimestamp();
  const vEnd = await video.computeDuration(), aEnd = await audio.computeDuration();
  checkAbort(signal);
  if (!Number.isFinite(vStart) || Math.abs(vStart) > TICK
    || !Number.isFinite(aStart) || aStart < -AAC_FRAMES / RATE - TICK || aStart > TICK
    || !Number.isFinite(vEnd) || vEnd <= 0 || Math.abs(vEnd - duration) > TICK
    || !Number.isFinite(aEnd) || aEnd <= 0 || Math.abs(aEnd - duration) > 2 * AAC_FRAMES / RATE) {
    throw new Error("VIDEO_EDIT_INVALID_OUTPUT");
  }
}
