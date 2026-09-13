// One slider over a batch of videos.
//
// D-175. The sheet sends up to ten files at once and the owner asked for one
// slider, so a stop has to mean something true about every file under it. These
// tests pin that meaning: a rung takes the files that are bigger than it, leaves
// the rest exactly as they were picked, and the number beside the slider says
// which of the two it is made of.

import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVER_RENDITION_HEIGHT,
  defaultStop,
  encodableStops,
  nearestStop,
  selectionStops,
  stopForVideo,
  stopLabel,
  stopSummary,
  videoBytesAt,
  videosToEncode,
  type SelectedVideo,
} from "../../artifacts/kub/src/lib/videoSendSelection.ts";
import type { SourceVideo } from "../../artifacts/kub/src/lib/videoSendLadder.ts";

const NBSP = String.fromCharCode(160);
const MiB = 1024 * 1024;

const source = (over: Partial<SourceVideo> = {}): SourceVideo => ({
  width: 1920,
  height: 1080,
  duration: 60,
  sizeBytes: 80 * MiB,
  fps: 30,
  bitrate: 9_000_000,
  audioChannels: 2,
  ...over,
});

const video = (id: string, over: Partial<SourceVideo> = {}): SelectedVideo => {
  const read = source(over);
  return { id, sizeBytes: read.sizeBytes, source: read };
};

const uhd = (id = "uhd") =>
  video(id, { width: 3840, height: 2160, sizeBytes: 400 * MiB, bitrate: 45_000_000 });
const sd = (id = "sd") =>
  video(id, { width: 854, height: 480, sizeBytes: 4 * MiB, bitrate: 400_000 });

test("the stops are the rungs below something in the selection, source last", () => {
  assert.deepEqual(selectionStops([video("hd")]), [480, 720, "source"]);
  assert.deepEqual(selectionStops([uhd()]), [480, 720, 1080, 1440, "source"]);
  // The union, in ladder order, not in the order the files were picked.
  assert.deepEqual(selectionStops([sd(), uhd()]), [480, 720, 1080, 1440, "source"]);
});

test("a clip smaller than every rung offers nothing but itself", () => {
  assert.deepEqual(selectionStops([sd()]), ["source"]);
  assert.deepEqual(selectionStops([]), ["source"]);
});

test("an unreadable file has no rungs to offer but still counts its own bytes", () => {
  const unread: SelectedVideo = { id: "unread", sizeBytes: 12 * MiB, source: null };
  assert.deepEqual(selectionStops([unread]), ["source"]);
  assert.deepEqual(selectionStops([unread, video("hd")]), [480, 720, "source"]);
  assert.equal(stopForVideo(unread, 480), "source");
  assert.equal(videoBytesAt(unread, 480), 12 * MiB, "its exact size, because nothing will touch it");
});

test("a stop takes the files above it and leaves the rest as they were picked", () => {
  const big = uhd();
  const small = sd();
  assert.equal(stopForVideo(big, 720), 720);
  assert.equal(stopForVideo(small, 720), "source", "480p is not made smaller by a 720p rung");
  assert.deepEqual(videosToEncode([big, small], 720).map((item) => item.id), ["uhd"]);
  assert.deepEqual(videosToEncode([big, small], "source"), []);
});

test("a rung equal to a file own short side is not a smaller picture", () => {
  // The boundary that decides whether a 720p clip is re-encoded at the 720p
  // rung. It is not: same picture, one more generation of loss.
  const exactly720 = video("hd720", { width: 1280, height: 720 });
  assert.equal(stopForVideo(exactly720, 720), "source");
  assert.equal(stopForVideo(exactly720, 480), 480);
});

test("a rung that would barely shrink a file is not offered at all", () => {
  // 960x540 at 900 kbit/s is already close to what the 480p rung would spend:
  // 6,456,080 estimated against 6,750,000 picked, which is inside the tenth
  // `worthEncoding` asks for. Offering it would put a second number on the
  // slider that reads almost the same as the first, and a control whose stops
  // do not differ teaches a person that none of them do.
  const thin = video("thin", { width: 960, height: 540, bitrate: 900_000, sizeBytes: 6_750_000, audioChannels: 0 });
  assert.deepEqual(selectionStops([thin]), ["source"]);
  assert.equal(stopForVideo(thin, 480), "source");

  // The same file beside one that does benefit: the rung comes back, because it
  // is real for the other file, and the thin one still goes as it was picked.
  const big = uhd();
  assert.ok(selectionStops([thin, big]).includes(480));
  assert.deepEqual(videosToEncode([thin, big], 480).map((item) => item.id), ["uhd"]);
});

test("the counter sums estimates and exact sizes, and says which it holds", () => {
  const big = uhd();
  const small = sd();

  const atSource = stopSummary([big, small], "source");
  assert.equal(atSource.label, "Исходное");
  assert.equal(atSource.approximate, false, "nothing is encoded, so nothing is estimated");
  assert.equal(atSource.encoding, 0);
  assert.equal(atSource.size, `404${NBSP}МБ`, "400 MiB and 4 MiB, exactly");

  const at720 = stopSummary([big, small], 720);
  assert.equal(at720.label, "720p");
  assert.equal(at720.approximate, true);
  assert.equal(at720.encoding, 1);
  const expected = videoBytesAt(big, 720) + 4 * MiB;
  assert.ok(expected < 404 * MiB, "the point of the rung");
  assert.ok(at720.size.endsWith(`${NBSP}МБ`));
});

test("the slider starts at the picture the server would have made anyway", () => {
  assert.equal(SERVER_RENDITION_HEIGHT, 720);
  assert.equal(defaultStop([uhd()]), 720);
  assert.equal(defaultStop([video("hd")]), 720);
  // Nothing above 720 in the selection: sending as picked beats losing a
  // generation for a picture nobody asked to be smaller.
  assert.equal(defaultStop([sd()]), "source");
  assert.equal(defaultStop([video("hd720", { width: 1280, height: 720 })]), "source");
  assert.equal(defaultStop([]), "source");
});

test("a rung no file can be encoded at is removed rather than quietly declined", () => {
  const videos = [uhd(), sd()];
  const all = () => true;
  assert.deepEqual(encodableStops(videos, all), [480, 720, 1080, 1440, "source"]);

  const notLarge = (_video: SelectedVideo, rung: number) => rung <= 720;
  assert.deepEqual(encodableStops(videos, notLarge), [480, 720, "source"]);

  const none = () => false;
  assert.deepEqual(encodableStops(videos, none), ["source"], "the one path that always exists");
});

test("a rung survives when any one file can take it", () => {
  // A mixed selection where the encoder refuses the tall file frame but takes
  // the wide one. The rung is real for that file, so it stays.
  const tall = video("tall", { width: 2160, height: 3840, sizeBytes: 400 * MiB });
  const wide = uhd();
  const refuseTall = (candidate: SelectedVideo) => candidate.id !== "tall";
  assert.ok(encodableStops([tall, wide], refuseTall).includes(1440));
  assert.deepEqual(encodableStops([tall], refuseTall), ["source"]);
});

test("a stop that is gone falls to the nearest one that exists", () => {
  assert.equal(nearestStop([480, 720, 1080, "source"], 720), 720);
  assert.equal(nearestStop([480, 720, 1080, "source"], 1440), 1080, "the closest rung that exists");
  assert.equal(nearestStop([1080, 1440, "source"], 480), 1080);
  assert.equal(nearestStop(["source"], 720), "source");
  assert.equal(nearestStop([], 720), "source");
  assert.equal(nearestStop([480, 720], "source"), 720, "the top of what is left");
});

test("every stop has a name a person can read", () => {
  assert.equal(stopLabel(480), "480p");
  assert.equal(stopLabel(1440), "2K");
  assert.equal(stopLabel(2160), "4K");
  assert.equal(stopLabel("source"), "Исходное");
});
