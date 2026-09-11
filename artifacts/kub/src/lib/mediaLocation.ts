/**
 * The place a photo or a video was taken, removed before the file leaves the
 * device.
 *
 * A compressed picture is re-encoded on the canvas, and nothing it carried
 * survives that. An original goes as it was picked, and so does every video —
 * with whatever the camera wrote, which on a phone includes where it was. This
 * removes that and nothing else. Every change is made in place, so the file
 * keeps its length, its picture, its orientation and every other field, and
 * what does not change is passed on as slices of the original rather than read
 * into memory.
 *
 * What it knows: the GPS directory of a JPEG's EXIF, the fields of an XMP
 * packet that name a place, in a JPEG or in a video, and the location items of
 * a QuickTime or MP4 file. A HEIC, a PNG or a WebP goes as it was.
 *
 * Imports nothing, so the unit suite loads it directly.
 */

export type LocationRemoval =
  /** A JPEG's GPS directory, emptied. */
  | "exif-gps"
  /** A JPEG's EXIF that could not be walked, blanked whole: its orientation goes with it. */
  | "exif-unreadable"
  /** The fields of an XMP packet that name a place, blanked. */
  | "xmp-location"
  /** A QuickTime or MP4 location item, turned into padding. */
  | "video-location";

export interface BytePatch {
  /** Where in the file the replacement starts. */
  offset: number;
  /** Exactly as many bytes as it replaces. */
  bytes: Uint8Array<ArrayBuffer>;
}

export interface LocationPlan {
  patches: BytePatch[];
  removed: LocationRemoval[];
}

export interface JpegLocationPlan extends LocationPlan {
  /** False when the bytes ended before the image data began: read more and plan again. */
  complete: boolean;
}

export interface LocationOptions {
  /** How much of a JPEG is read first; grown until its image data is reached. */
  jpegHeadBytes?: number;
}

const NUL = String.fromCharCode(0);
const EXIF_HEADER = `Exif${NUL}${NUL}`;
const XMP_HEADER = `http://ns.adobe.com/xap/1.0/${NUL}`;
const XMP_EXTENSION_HEADER = `http://ns.adobe.com/xmp/extension/${NUL}`;
/** The extension's namespace, a 32-character GUID, the full length and this part's offset. */
const XMP_EXTENSION_PREAMBLE = XMP_EXTENSION_HEADER.length + 32 + 4 + 4;
const GPS_POINTER_TAG = 0x8825;
/** Bytes per value, by TIFF field type. */
const TIFF_TYPE_BYTES: Readonly<Record<number, number>> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};
/**
 * The local names XMP writes a place under: EXIF's GPS fields, a drone's Gps
 * ones, and the address fields of IPTC and Photoshop.
 */
const XMP_LOCATION_NAME = /^(gps|city|state|country|location|sublocation|provincestate|worldregion)/i;

const JPEG_HEAD_BYTES = 256 * 1024;
const LOCATION_BOXES = new Set([`${String.fromCharCode(0xa9)}xyz`, "loci"]);
const LOCATION_KEY_PREFIX = "com.apple.quicktime.location.";
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];
/** The boxes a QuickTime or MP4 file can open with. */
const FIRST_BOX_TYPES = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip"]);
/** The top-level boxes that can hold a location; `mdat` is never read. */
const METADATA_BOX_TYPES = new Set(["moov", "udta", "meta", "uuid"]);
const MAX_METADATA_BOX_BYTES = 64 * 1024 * 1024;

/** The file without the place it was taken, and what was removed. The same `File` when there was nothing. */
export async function removeLocation(
  file: File,
  options: LocationOptions = {},
): Promise<{ file: File; removed: LocationRemoval[] }> {
  const plan = await planFileLocation(file, options);
  return { file: applyLocationPatches(file, plan.patches), removed: plan.removed };
}

export async function planFileLocation(file: Blob, options: LocationOptions = {}): Promise<LocationPlan> {
  const start = await readBytes(file, 0, Math.min(file.size, 12));
  if (start.length >= 3 && start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff) {
    let length = Math.min(file.size, Math.max(16, options.jpegHeadBytes ?? JPEG_HEAD_BYTES));
    for (;;) {
      const plan = planJpegLocation(await readBytes(file, 0, length));
      if (plan.complete || length >= file.size) return { patches: plan.patches, removed: plan.removed };
      length = Math.min(file.size, length * 4);
    }
  }
  if (start.length >= 8 && FIRST_BOX_TYPES.has(fourcc(start, 4))) return planVideoLocation(file);
  return { patches: [], removed: [] };
}

export function applyLocationPatches(file: File, patches: readonly BytePatch[]): File {
  if (!patches.length) return file;
  const parts: BlobPart[] = [];
  let at = 0;
  for (const patch of [...patches].sort((a, b) => a.offset - b.offset)) {
    parts.push(file.slice(at, patch.offset), patch.bytes);
    at = patch.offset + patch.bytes.length;
  }
  parts.push(file.slice(at));
  return new File(parts, file.name, { type: file.type, lastModified: file.lastModified });
}

/**
 * Walks a JPEG's segments up to its image data and plans the changes to its
 * EXIF and XMP. Everything from the image data on is never looked at.
 */
export function planJpegLocation(head: Uint8Array): JpegLocationPlan {
  const plan: JpegLocationPlan = { patches: [], removed: [], complete: true };
  if (head.length < 2 || head[0] !== 0xff || head[1] !== 0xd8) return plan;
  let at = 2;
  for (;;) {
    while (at + 1 < head.length && head[at] === 0xff && head[at + 1] === 0xff) at += 1;
    if (at + 2 > head.length) return { ...plan, complete: false };
    // Not a marker where one has to be: the rest cannot be walked.
    if (head[at] !== 0xff) return plan;
    const marker = head[at + 1];
    if (marker === 0xda || marker === 0xd9) return plan;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (at + 4 > head.length) return { ...plan, complete: false };
    const length = (head[at + 2] << 8) | head[at + 3];
    if (length < 2) return plan;
    const end = at + 2 + length;
    if (end > head.length) return { ...plan, complete: false };
    if (marker === 0xe1) planApp1(head, at + 4, end, plan);
    at = end;
  }
}

function planApp1(head: Uint8Array, start: number, end: number, plan: LocationPlan): void {
  if (startsWith(head, start, EXIF_HEADER)) {
    const segment = head.slice(start, end);
    const outcome = emptyGpsDirectory(segment, EXIF_HEADER.length);
    if (outcome === "unchanged") return;
    if (outcome === "unreadable") {
      // What cannot be walked cannot be checked, so none of it goes.
      segment.fill(0);
      plan.removed.push("exif-unreadable");
    } else {
      plan.removed.push("exif-gps");
    }
    plan.patches.push({ offset: start, bytes: segment });
    return;
  }
  const preamble = startsWith(head, start, XMP_HEADER)
    ? XMP_HEADER.length
    : startsWith(head, start, XMP_EXTENSION_HEADER) ? XMP_EXTENSION_PREAMBLE : 0;
  if (!preamble) return;
  const segment = head.slice(start, end);
  if (blankXmpLocation(segment, Math.min(preamble, segment.length), segment.length)) {
    plan.removed.push("xmp-location");
    plan.patches.push({ offset: start, bytes: segment });
  }
}

/**
 * Empties the GPS directory of the TIFF structure at `tiff` in place: its
 * entries, the values they point to, and its count, which becomes zero. The
 * directory's pointer stays, so no other offset moves.
 */
function emptyGpsDirectory(segment: Uint8Array, tiff: number): "changed" | "unchanged" | "unreadable" {
  const size = segment.length - tiff;
  if (size < 8) return "unreadable";
  const little = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49;
  const big = segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d;
  if (!little && !big) return "unreadable";
  const data = new DataView(segment.buffer, segment.byteOffset + tiff, size);
  const fits = (at: number, length: number) => at >= 0 && length >= 0 && at + length <= size;
  if (data.getUint16(2, little) !== 42) return "unreadable";
  const first = data.getUint32(4, little);
  if (!fits(first, 2)) return "unreadable";
  const firstCount = data.getUint16(first, little);
  if (!fits(first + 2, firstCount * 12)) return "unreadable";
  let gps = -1;
  for (let index = 0; index < firstCount; index += 1) {
    const entry = first + 2 + index * 12;
    if (data.getUint16(entry, little) === GPS_POINTER_TAG) gps = data.getUint32(entry + 8, little);
  }
  if (gps < 0) return "unchanged";
  if (!fits(gps, 2)) return "unreadable";
  const count = data.getUint16(gps, little);
  if (count === 0) return "unchanged";
  if (!fits(gps + 2, count * 12 + 4)) return "unreadable";
  // Every value is found before anything is cleared: a directory with one
  // value out of reach is not half emptied.
  const values: Array<[number, number]> = [];
  for (let index = 0; index < count; index += 1) {
    const entry = gps + 2 + index * 12;
    const unit = TIFF_TYPE_BYTES[data.getUint16(entry + 2, little)];
    if (!unit) return "unreadable";
    const length = unit * data.getUint32(entry + 4, little);
    if (length <= 4) continue;
    const at = data.getUint32(entry + 8, little);
    if (!fits(at, length)) return "unreadable";
    values.push([at, length]);
  }
  for (const [at, length] of values) segment.fill(0, tiff + at, tiff + at + length);
  segment.fill(0, tiff + gps, tiff + gps + 2 + count * 12 + 4);
  return "changed";
}

/**
 * Blanks, in place and with spaces, the values of the XMP fields that name a
 * place — an attribute's value, or the text inside an element and everything
 * it nests — and leaves every tag, every other field and the length as they
 * were. True when a byte changed.
 */
export function blankXmpLocation(bytes: Uint8Array, start: number, end: number): boolean {
  let text = "";
  for (let at = start; at < end; at += 8192) {
    text += String.fromCharCode(...bytes.subarray(at, Math.min(end, at + 8192)));
  }
  let changed = false;
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at += 1) {
      const code = text.charCodeAt(at);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) continue;
      bytes[start + at] = 0x20;
      changed = true;
    }
  };

  const attribute = /([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)\s*=\s*(["'])/g;
  for (let match = attribute.exec(text); match; match = attribute.exec(text)) {
    const close = text.indexOf(match[3], attribute.lastIndex);
    if (close < 0) break;
    // A namespace declaration is structure, whatever its prefix is called.
    if (match[1] !== "xmlns" && XMP_LOCATION_NAME.test(match[2])) blank(attribute.lastIndex, close);
    attribute.lastIndex = close + 1;
  }

  const element = /<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)(?:\s[^<>]*?)?(\/?)>/g;
  for (let match = element.exec(text); match; match = element.exec(text)) {
    if (match[3] === "/" || !XMP_LOCATION_NAME.test(match[2])) continue;
    const closing = text.indexOf(`</${match[1]}:${match[2]}`, element.lastIndex);
    if (closing < 0) continue;
    let markup = false;
    for (let at = element.lastIndex; at < closing; at += 1) {
      if (text[at] === "<") markup = true;
      if (!markup) blank(at, at + 1);
      if (text[at] === ">") markup = false;
    }
    element.lastIndex = closing;
  }
  return changed;
}

async function planVideoLocation(file: Blob): Promise<LocationPlan> {
  const plan: LocationPlan = { patches: [], removed: [] };
  for (let at = 0; at + 8 <= file.size; ) {
    const head = await readBytes(file, at, Math.min(file.size, at + 16));
    let size = readUint32(head, 0);
    let headerBytes = 8;
    if (size === 1) {
      if (head.length < 16 || readUint32(head, 8) > 0x1fffff) break;
      size = readUint32(head, 8) * 0x100000000 + readUint32(head, 12);
      headerBytes = 16;
    } else if (size === 0) {
      size = file.size - at;
    }
    if (size < headerBytes || at + size > file.size) break;
    if (METADATA_BOX_TYPES.has(fourcc(head, 4)) && size <= MAX_METADATA_BOX_BYTES) {
      const bytes = await readBytes(file, at, at + size);
      const removed: LocationRemoval[] = [];
      removeBoxLocation(bytes, 0, bytes.length, removed);
      if (removed.length) {
        plan.patches.push({ offset: at, bytes });
        plan.removed.push(...removed);
      }
    }
    at += size;
  }
  return plan;
}

interface Box {
  type: string;
  /** Where the box starts: its size, then its type. */
  start: number;
  body: number;
  next: number;
}

function readBox(bytes: Uint8Array, at: number, end: number): Box | null {
  if (at + 8 > end) return null;
  let size = readUint32(bytes, at);
  let body = at + 8;
  if (size === 1) {
    if (at + 16 > end || readUint32(bytes, at + 8) > 0x1fffff) return null;
    size = readUint32(bytes, at + 8) * 0x100000000 + readUint32(bytes, at + 12);
    body = at + 16;
  } else if (size === 0) {
    size = end - at;
  }
  if (size < body - at || at + size > end) return null;
  return { type: fourcc(bytes, at + 4), start: at, body, next: at + size };
}

/** A box of the same size that says nothing: `free`, zeroed. */
function padBox(bytes: Uint8Array, box: Box): void {
  bytes.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
  bytes.fill(0, box.body, box.next);
}

function removeBoxLocation(bytes: Uint8Array, start: number, end: number, removed: LocationRemoval[]): void {
  for (let at = start; at < end; ) {
    const box = readBox(bytes, at, end);
    if (!box) return;
    if (LOCATION_BOXES.has(box.type)) {
      padBox(bytes, box);
      removed.push("video-location");
    } else if (box.type === "moov" || box.type === "trak" || box.type === "udta") {
      removeBoxLocation(bytes, box.body, box.next, removed);
    } else if (box.type === "meta") {
      removeMetaLocation(bytes, box, removed);
    } else if (box.type === "uuid" && isXmpUuid(bytes, box)) {
      if (blankXmpLocation(bytes, box.body + 16, box.next)) removed.push("xmp-location");
    }
    at = box.next;
  }
}

/**
 * A `meta` box: an iTunes-style list keyed by four characters, where a place
 * is `©xyz`, or QuickTime's, keyed by number through `keys`, where it is
 * whatever key starts with `com.apple.quicktime.location.`.
 */
function removeMetaLocation(bytes: Uint8Array, meta: Box, removed: LocationRemoval[]): void {
  // An ISO `meta` opens with a version and flags; QuickTime's holds its boxes directly.
  const start = meta.body + 4 <= meta.next && readUint32(bytes, meta.body) === 0 ? meta.body + 4 : meta.body;
  const locationKeys = new Set<number>();
  for (let at = start; at < meta.next; ) {
    const box = readBox(bytes, at, meta.next);
    if (!box) break;
    if (box.type === "keys") collectLocationKeys(bytes, box, locationKeys);
    at = box.next;
  }
  for (let at = start; at < meta.next; ) {
    const box = readBox(bytes, at, meta.next);
    if (!box) return;
    if (box.type === "ilst") {
      for (let itemAt = box.body; itemAt < box.next; ) {
        const item = readBox(bytes, itemAt, box.next);
        if (!item) break;
        if (LOCATION_BOXES.has(item.type) || locationKeys.has(readUint32(bytes, item.start + 4))) {
          padBox(bytes, item);
          removed.push("video-location");
        }
        itemAt = item.next;
      }
    } else if (LOCATION_BOXES.has(box.type)) {
      padBox(bytes, box);
      removed.push("video-location");
    }
    at = box.next;
  }
}

/** The 1-based numbers of the location keys in a QuickTime `keys` box. */
function collectLocationKeys(bytes: Uint8Array, keys: Box, into: Set<number>): void {
  if (keys.body + 8 > keys.next) return;
  const count = readUint32(bytes, keys.body + 4);
  let at = keys.body + 8;
  for (let index = 1; index <= count; index += 1) {
    if (at + 8 > keys.next) return;
    const size = readUint32(bytes, at);
    if (size < 8 || at + size > keys.next) return;
    if (asciiText(bytes, at + 8, at + size).startsWith(LOCATION_KEY_PREFIX)) into.add(index);
    at += size;
  }
}

function isXmpUuid(bytes: Uint8Array, box: Box): boolean {
  return box.body + 16 <= box.next && XMP_UUID.every((value, index) => bytes[box.body + index] === value);
}

async function readBytes(file: Blob, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function readUint32(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x1000000 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);
}

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function asciiText(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function startsWith(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}
