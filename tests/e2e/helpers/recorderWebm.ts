/**
 * A voice note shaped the way a browser's recorder writes one.
 *
 * `MediaRecorder` streams WebM as it records, so it cannot know the length in
 * advance: the Segment and every Cluster carry the «unknown size» marker, and
 * the Info element has no Duration. Chromium's recorder stops there; WebKit's —
 * the iPhone's — also appends a Cues element after the last Cluster, with no
 * SeekHead pointing at it. Every voice note in production on 2026-09-30 was
 * one of these two shapes, and an engine reads such a file with `duration`
 * Infinity or NaN until it has walked to the end.
 *
 * The audio is silence: 20 ms CELT frames of the three-byte packet WebRTC uses
 * for comfort silence, so the file is small, deterministic and carries nobody's
 * voice.
 */

const UNKNOWN_SIZE = Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const SILENT_OPUS_FRAME = Uint8Array.from([0xf8, 0xff, 0xfe]);
const FRAME_MS = 20;

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function id(value: number): Uint8Array {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Uint8Array.from(bytes);
}

/** An eight-byte size, the width recorders use for everything they can size. */
function size(value: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let rest = value;
  for (let index = 7; index >= 1; index -= 1) {
    out[index] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  return out;
}

function element(elementId: number, body: Uint8Array): Uint8Array {
  return concat([id(elementId), size(body.length), body]);
}

function uint(elementId: number, value: number, width = 4): Uint8Array {
  const body = new Uint8Array(width);
  let rest = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    body[index] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  return element(elementId, body);
}

function text(elementId: number, value: string): Uint8Array {
  return element(elementId, new TextEncoder().encode(value));
}

function float64(elementId: number, value: number): Uint8Array {
  const body = new Uint8Array(8);
  new DataView(body.buffer).setFloat64(0, value);
  return element(elementId, body);
}

function opusHead(): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  const view = new DataView(head.buffer);
  head[8] = 1; // version
  head[9] = 1; // channels
  view.setUint16(10, 312, true); // pre-skip
  view.setUint32(12, 48_000, true); // input sample rate
  view.setInt16(16, 0, true); // output gain
  head[18] = 0; // mapping family
  return head;
}

export interface RecorderWebmOptions {
  /** Length of the silence, in whole seconds. */
  seconds: number;
  /** Append WebKit's trailing Cues, without a SeekHead. */
  trailingCues?: boolean;
}

export function recorderShapedWebm({ seconds, trailingCues = false }: RecorderWebmOptions): Buffer {
  const header = element(0x1a45dfa3, concat([
    uint(0x4286, 1, 1),
    uint(0x42f7, 1, 1),
    uint(0x42f2, 4, 1),
    uint(0x42f3, 8, 1),
    text(0x4282, "webm"),
    uint(0x4287, 4, 1),
    uint(0x4285, 2, 1),
  ]));

  const info = element(0x1549a966, concat([
    uint(0x2ad7b1, 1_000_000, 3),
    text(0x4d80, "fixture"),
    text(0x5741, "fixture"),
  ]));

  const tracks = element(0x1654ae6b, element(0xae, concat([
    uint(0xd7, 1, 1),
    uint(0x73c5, 1, 1),
    uint(0x83, 2, 1),
    text(0x86, "A_OPUS"),
    element(0x63a2, opusHead()),
    element(0xe1, concat([float64(0xb5, 48_000), uint(0x9f, 1, 1)])),
  ])));

  const segmentBody: Uint8Array[] = [info, tracks];
  const clusterOffsets: Array<{ time: number; position: number }> = [];
  let position = info.length + tracks.length;

  for (let second = 0; second < seconds; second += 1) {
    const clusterTime = second * 1000;
    const blocks: Uint8Array[] = [uint(0xe7, clusterTime, 4)];
    for (let frame = 0; frame < 1000 / FRAME_MS; frame += 1) {
      const relative = frame * FRAME_MS;
      const block = concat([
        Uint8Array.from([0x81, (relative >> 8) & 0xff, relative & 0xff, 0x80]),
        SILENT_OPUS_FRAME,
      ]);
      blocks.push(element(0xa3, block));
    }
    const cluster = concat([id(0x1f43b675), UNKNOWN_SIZE, ...blocks]);
    clusterOffsets.push({ time: clusterTime, position });
    segmentBody.push(cluster);
    position += cluster.length;
  }

  if (trailingCues) {
    segmentBody.push(element(0x1c53bb6b, concat(clusterOffsets.map(({ time, position: at }) =>
      element(0xbb, concat([
        uint(0xb3, time, 4),
        element(0xb7, concat([uint(0xf7, 1, 1), uint(0xf1, at, 4)])),
      ])),
    ))));
  }

  const segment = concat([id(0x18538067), UNKNOWN_SIZE, ...segmentBody]);
  return Buffer.from(concat([header, segment]));
}
