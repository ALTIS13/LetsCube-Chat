import assert from "node:assert/strict";
import test from "node:test";

import {
  blankXmpLocation,
  planJpegLocation,
  removeLocation,
} from "../../artifacts/kub/src/lib/mediaLocation.ts";

/**
 * An original photo, and every video, left the device with the place it was
 * taken: an original is sent as it was picked, a video always is, and a phone
 * writes where it was into both. `lib/mediaLocation.ts` removes that before the
 * file is staged, in place, so it keeps its length, its picture, its
 * orientation and every other field.
 *
 * The files here are built byte by byte, small and exact, so that every
 * assertion names the bytes it is about.
 */

const NUL = String.fromCharCode(0);
const COPYRIGHT = String.fromCharCode(0xa9);
const utf8 = new TextEncoder();
const LAST_MODIFIED = 1_757_000_000_000;

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[at + index] !== needle[index]) continue outer;
    }
    return at;
  }
  return -1;
}

async function bytesOf(file: Blob): Promise<Buffer> {
  return Buffer.from(await file.arrayBuffer());
}

type ByteOrder = "II" | "MM";

/**
 * A TIFF structure of 158 bytes. IFD0 at 8 holds Make (out of line, "LETS"),
 * Orientation 6 and the GPS pointer; the GPS directory at 56 holds the version,
 * "N", and a latitude and a longitude as three rationals each, at 110 and 134.
 */
function tiff(order: ByteOrder, { gpsAt = 56 }: { gpsAt?: number } = {}): Uint8Array {
  const little = order === "II";
  const bytes = new Uint8Array(158);
  const data = new DataView(bytes.buffer);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    data.setUint16(at, tag, little);
    data.setUint16(at + 2, type, little);
    data.setUint32(at + 4, count, little);
    data.setUint32(at + 8, value, little);
  };
  const rationals = (at: number, values: number[]) =>
    values.forEach((value, index) => data.setUint32(at + index * 4, value, little));
  bytes.set(ascii(order), 0);
  data.setUint16(2, 42, little);
  data.setUint32(4, 8, little);
  data.setUint16(8, 3, little);
  entry(10, 0x010f, 2, 5, 50);
  entry(22, 0x0112, 3, 1, 0);
  // A SHORT sits at the start of its four bytes, in either byte order.
  data.setUint16(30, 6, little);
  entry(34, 0x8825, 4, 1, gpsAt);
  bytes.set(ascii(`LETS${NUL}`), 50);
  data.setUint16(56, 4, little);
  entry(58, 0x0000, 1, 4, 0);
  bytes.set([2, 3, 0, 0], 66);
  entry(70, 0x0001, 2, 2, 0);
  bytes.set(ascii(`N${NUL}`), 78);
  entry(82, 0x0002, 5, 3, 110);
  entry(94, 0x0004, 5, 3, 134);
  rationals(110, [55, 1, 45, 1, 2088, 100]);
  rationals(134, [37, 1, 37, 1, 1234, 100]);
  return bytes;
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat(Uint8Array.of(0xff, marker, length >> 8, length & 0xff), payload);
}

/** The start of the scan, entropy-coded bytes that never hold 0xFF, and the end. */
const SCAN = concat(
  Uint8Array.of(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00),
  Uint8Array.from({ length: 64 }, (_, index) => (index * 37) & 0x7f),
  Uint8Array.of(0xff, 0xd9),
);
const JFIF = segment(0xe0, concat(ascii(`JFIF${NUL}`), Uint8Array.of(1, 1, 0, 0, 1, 0, 1, 0, 0)));

function exif(order: ByteOrder, options?: { gpsAt?: number }): Uint8Array {
  return segment(0xe1, concat(ascii(`Exif${NUL}${NUL}`), tiff(order, options)));
}

function xmp(packet: string): Uint8Array {
  return segment(0xe1, concat(ascii(`http://ns.adobe.com/xap/1.0/${NUL}`), utf8.encode(packet)));
}

function jpeg(...segments: Uint8Array[]): Uint8Array {
  return concat(Uint8Array.of(0xff, 0xd8), ...segments, SCAN);
}

function jpegFile(bytes: Uint8Array, name = "IMG_0001.jpg"): File {
  return new File([bytes], name, { type: "image/jpeg", lastModified: LAST_MODIFIED });
}

/** The TIFF structure of the first EXIF segment, read back without the module. */
function readTiff(file: Uint8Array) {
  const start = indexOfBytes(file, ascii(`Exif${NUL}${NUL}`));
  assert.ok(start >= 0, "the EXIF segment is still there");
  const little = file[start + 6] === 0x49;
  const data = new DataView(file.buffer, file.byteOffset + start + 6);
  const entries = (at: number) =>
    Array.from({ length: data.getUint16(at, little) }, (_, index) => {
      const entry = at + 2 + index * 12;
      return { tag: data.getUint16(entry, little), field: entry + 8 };
    });
  return { data, little, entries };
}

for (const order of ["II", "MM"] as const) {
  test(`a JPEG in ${order} byte order loses its GPS directory and keeps its orientation, its make and its picture`, async () => {
    const original = jpeg(JFIF, exif(order));
    const { file, removed } = await removeLocation(jpegFile(original));
    const out = await bytesOf(file);
    assert.deepEqual(removed, ["exif-gps"]);
    assert.equal(out.length, original.length, "nothing moved");

    const { data, little, entries } = readTiff(out);
    const first = entries(8);
    const orientation = first.find((entry) => entry.tag === 0x0112);
    assert.equal(orientation && data.getUint16(orientation.field, little), 6, "orientation 6 still turns the picture");
    assert.equal(String.fromCharCode(...new Uint8Array(data.buffer, data.byteOffset + 50, 4)), "LETS");
    const pointer = first.find((entry) => entry.tag === 0x8825);
    assert.equal(pointer && data.getUint32(pointer.field, little), 56, "the pointer stays, so no offset moves");
    assert.equal(entries(56).length, 0, "the GPS directory is empty");
    assert.ok(
      new Uint8Array(data.buffer, data.byteOffset + 56, 158 - 56).every((byte) => byte === 0),
      "its fields, and the coordinates they pointed to, are zero",
    );

    const scan = indexOfBytes(original, Uint8Array.of(0xff, 0xda));
    assert.deepEqual(out.subarray(scan), Buffer.from(original.subarray(scan)), "the picture is the same, byte for byte");
    const beforeExif = 2 + JFIF.length;
    assert.deepEqual(out.subarray(0, beforeExif), Buffer.from(original.subarray(0, beforeExif)), "so is what came before the EXIF");
  });
}

test("a JPEG with no location is returned as the same File, and a changed one keeps its name, type and date", async () => {
  const plain = jpegFile(jpeg(JFIF));
  const untouched = await removeLocation(plain);
  assert.equal(untouched.file, plain);
  assert.deepEqual(untouched.removed, []);

  const located = jpegFile(jpeg(JFIF, exif("II")), "IMG_0002.jpg");
  const { file } = await removeLocation(located);
  assert.notEqual(file, located);
  assert.equal(file.name, "IMG_0002.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.lastModified, LAST_MODIFIED);
});

test("an EXIF segment whose GPS directory is out of reach is blanked whole, orientation and all", async () => {
  const broken = exif("II", { gpsAt: 4096 });
  const original = jpeg(JFIF, broken);
  const { file, removed } = await removeLocation(jpegFile(original));
  const out = await bytesOf(file);
  assert.deepEqual(removed, ["exif-unreadable"]);
  assert.equal(out.length, original.length);
  assert.equal(indexOfBytes(out, ascii(`Exif${NUL}${NUL}`)), -1, "no reader finds EXIF in it any more");
  const payload = 2 + JFIF.length + 4;
  assert.ok(out.subarray(payload, payload + broken.length - 4).every((byte) => byte === 0));
  assert.deepEqual(out.subarray(0, payload), Buffer.from(original.subarray(0, payload)), "the segment's marker and length stay");
});

const PACKET = [
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"',
  ' xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" exif:GPSLatitude="55,45.348N" exif:GPSLongitude="37,37.206E"',
  ' hdrgm:Version="1.0">',
  "<photoshop:City>Москва</photoshop:City>",
  "<Iptc4xmpExt:LocationCreated><rdf:Bag><rdf:li>Тверская, 7</rdf:li></rdf:Bag></Iptc4xmpExt:LocationCreated>",
  "</rdf:Description></rdf:RDF></x:xmpmeta>",
].join("");

test("an XMP packet loses the fields that name a place and keeps every tag and every other field", async () => {
  const original = jpeg(JFIF, xmp(PACKET));
  const { file, removed } = await removeLocation(jpegFile(original));
  const out = await bytesOf(file);
  assert.deepEqual(removed, ["xmp-location"]);
  assert.equal(out.length, original.length);
  for (const gone of ["55,45.348N", "37,37.206E", "Москва", "Тверская"]) {
    assert.equal(out.includes(Buffer.from(gone)), false, `${gone} is gone`);
  }
  for (const kept of [
    'hdrgm:Version="1.0"',
    'xmlns:exif="http://ns.adobe.com/exif/1.0/"',
    "<photoshop:City>",
    "</photoshop:City>",
    "<rdf:li>",
    "</Iptc4xmpExt:LocationCreated>",
  ]) {
    assert.equal(out.includes(Buffer.from(kept)), true, `${kept} is kept`);
  }
  assert.match(out.toString("latin1"), /exif:GPSLatitude=" +"/, "the attribute stays, with nothing in it");
});

test("a namespace declaration is never blanked, whatever its prefix is called", () => {
  const bytes = ascii('<rdf:Description xmlns:location="http://example.com/location/" location:City="Moscow"/>');
  assert.equal(blankXmpLocation(bytes, 0, bytes.length), true);
  const text = String.fromCharCode(...bytes);
  assert.match(text, /xmlns:location="http:\/\/example\.com\/location\/"/);
  assert.match(text, /location:City=" {6}"/);
});

test("a JPEG whose EXIF lies past the first read is still found", async () => {
  const icc = segment(0xe2, new Uint8Array(6000).fill(0x41));
  const original = jpeg(JFIF, icc, exif("MM"));
  assert.equal(planJpegLocation(original.subarray(0, 64)).complete, false, "the first read alone does not reach the picture");
  const { removed } = await removeLocation(jpegFile(original), { jpegHeadBytes: 64 });
  assert.deepEqual(removed, ["exif-gps"]);
});

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function box(type: string | number, ...children: Uint8Array[]): Uint8Array {
  const body = concat(...children);
  return concat(uint32(body.length + 8), typeof type === "number" ? uint32(type) : ascii(type), body);
}

const dataBox = (text: string) => box("data", uint32(1), uint32(0), ascii(text));
const keyEntry = (name: string) => concat(uint32(name.length + 8), ascii("mdta"), ascii(name));
const handler = (kind: string) => box("hdlr", uint32(0), uint32(0), ascii(kind), new Uint8Array(12), Uint8Array.of(0));
const PLACE = "+55.7558+037.6173/";

/**
 * A QuickTime movie with a place in each of the four spots a phone or an
 * editor writes one: `©xyz` in the movie's `udta`, `loci` in a track's, a
 * QuickTime `keys` item, and `©xyz` in an iTunes-style list.
 */
function movie(order: "moov first" | "mdat first"): Uint8Array {
  const ftyp = box("ftyp", ascii("qt  "), uint32(0x200), ascii("qt  "));
  const moov = box(
    "moov",
    box("mvhd", new Uint8Array(100)),
    box("udta", box(`${COPYRIGHT}xyz`, Uint8Array.of(0x00, 0x12, 0x15, 0xc7), ascii(PLACE))),
    box("trak", box("tkhd", new Uint8Array(84)), box("udta", box("loci", uint32(0), ascii(`home${NUL}`), new Uint8Array(12)))),
    box(
      "meta",
      handler("mdta"),
      box("keys", uint32(0), uint32(2), keyEntry("com.apple.quicktime.location.ISO6709"), keyEntry("com.apple.quicktime.make")),
      box("ilst", box(1, dataBox(`${PLACE}+000.000/`)), box(2, dataBox("Apple"))),
    ),
    box(
      "udta",
      box("meta", uint32(0), handler("mdir"), box("ilst", box(`${COPYRIGHT}xyz`, dataBox(PLACE)), box(`${COPYRIGHT}too`, dataBox("Lavf")))),
    ),
  );
  const mdat = box("mdat", Uint8Array.from({ length: 256 }, (_, index) => index));
  return order === "moov first" ? concat(ftyp, moov, mdat) : concat(ftyp, mdat, moov);
}

function topLevelTypes(bytes: Uint8Array): string[] {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  for (let at = 0; at + 8 <= bytes.length; at += data.getUint32(at)) {
    types.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
  }
  return types;
}

for (const order of ["moov first", "mdat first"] as const) {
  test(`a movie with its moov ${order === "moov first" ? "before" : "after"} its media loses every location item and nothing else`, async () => {
    const original = movie(order);
    const input = new File([original], "VID_0001.mov", { type: "video/quicktime", lastModified: LAST_MODIFIED });
    const { file, removed } = await removeLocation(input);
    const out = await bytesOf(file);
    assert.equal(out.length, original.length, "nothing moved, so every chunk offset still points at its sample");
    assert.deepEqual(removed, ["video-location", "video-location", "video-location", "video-location"]);
    assert.equal(out.includes(Buffer.from("+55.7558")), false, "no coordinate is left");
    assert.equal(out.includes(Buffer.from(`home${NUL}`)), false, "nor the place's name");
    for (const kept of ["Apple", "Lavf", "com.apple.quicktime.make", "mvhd", "tkhd"]) {
      assert.equal(out.includes(Buffer.from(kept)), true, `${kept} is kept`);
    }
    const mdat = indexOfBytes(original, ascii("mdat")) - 4;
    assert.deepEqual(out.subarray(mdat, mdat + 264), Buffer.from(original.subarray(mdat, mdat + 264)), "the media is untouched");
    assert.deepEqual(topLevelTypes(out), order === "moov first" ? ["ftyp", "moov", "mdat"] : ["ftyp", "mdat", "moov"]);
    assert.equal(file.name, "VID_0001.mov");
    assert.equal(file.type, "video/quicktime");
  });
}

test("a movie whose boxes do not add up is returned as it was rather than guessed at", async () => {
  const original = movie("moov first");
  const truncated = new File([original.subarray(0, original.length - 300)], "cut.mov", { type: "video/quicktime" });
  const result = await removeLocation(truncated);
  assert.equal(result.file, truncated);
  assert.deepEqual(result.removed, []);
});

test("a file that is neither a JPEG nor a QuickTime or MP4 movie is returned as it was", async () => {
  const png = new File([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)], "a.png", { type: "image/png" });
  const result = await removeLocation(png);
  assert.equal(result.file, png);
  assert.deepEqual(result.removed, []);
});
