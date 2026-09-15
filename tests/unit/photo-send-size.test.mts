/**
 * What an SD send actually comes out at — the two decisions composed, which
 * nothing composed before.
 *
 * `photo-send-quality.test.mts` pins D-174: SD is `compact`, a 1280 px long
 * side. `photo-encoding.test.mts` pins D-116: a compressed photo keeps at least
 * 1080 px of its short side where the source had it — and every case it checks
 * passes 1920, the cap of the `balanced` profile that used to be the default.
 * Neither file ever puts 1280 and 1080 in the same call, so what a photograph
 * is actually sent at on 2026-09-15 was not written down anywhere, and the one
 * place that held a number for it — `media-send-path.spec.ts` — still held the
 * pre-D-174 one and went red without anybody reading why (D-206).
 *
 * This file is that number, measured from the shipped constants. It is a record
 * of what the composition does, not an endorsement of it: **for every ordinary
 * aspect ratio the 1080 floor decides and SD's 1280 never binds at all**, so a
 * 16:9 photograph goes at 1920x1080 — pixel for pixel what the old `balanced`
 * default gave it. Whether that is what «по стоку загрузку в sd качестве» was
 * meant to mean is a product question, open at the time of writing. If it is
 * answered «SD means 1280 on the long side», this file and the JPEG case in
 * `media-send-path.spec.ts` are the two places that change.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PHOTO_MIN_SHORT_SIDE, compressedPhotoSize } from "../../artifacts/kub/src/lib/photoEncoding.ts";
import {
  DEFAULT_PHOTO_SEND_QUALITY,
  PHOTO_SEND_HD,
  getImageUploadProfile,
} from "../../artifacts/kub/src/lib/mediaQuality.ts";

const sdCap = getImageUploadProfile(DEFAULT_PHOTO_SEND_QUALITY).maxDimension;
const hdCap = getImageUploadProfile(PHOTO_SEND_HD).maxDimension;
const at = (cap: number, width: number, height: number) => {
  const size = compressedPhotoSize(width, height, cap);
  return [size.width, size.height];
};

test("a photograph sent at the default never meets SD's 1280: the 1080 floor decides first", () => {
  // 4:3, the shape `media-send-path.spec.ts` sends. Telegram's SD, which D-174
  // took its two numbers from, would make this 1280x960.
  assert.deepEqual(at(sdCap, 1600, 1200), [1440, 1080]);
  assert.deepEqual(at(sdCap, 2400, 1800), [1440, 1080]);
  assert.deepEqual(at(sdCap, 4032, 3024), [1440, 1080], "an iPhone camera photo");

  // 3:2 and 16:9, where the gap is widest. 1920x1080 is exactly what `balanced`
  // gave before D-174 made SD the default, so for these two SD changed nothing.
  assert.deepEqual(at(sdCap, 3000, 2000), [1620, 1080]);
  assert.deepEqual(at(sdCap, 4000, 2250), [1920, 1080]);
  assert.deepEqual(at(1920, 4000, 2250), [1920, 1080], "the old default, for the same picture");

  // Where the cap does bind: near-square, and a screenshot, which is the shape
  // D-116's floor was written for in the first place.
  assert.deepEqual(at(sdCap, 2000, 2000), [1280, 1280]);
  assert.deepEqual(at(sdCap, 1290, 2796), [1080, 2341]);

  // The crossover, stated rather than implied: the long side stops deciding
  // once a picture is more oblong than 1280/1080, which is 1.185 — narrower
  // than 4:3, so every ordinary photograph is past it.
  const ratio = sdCap / PHOTO_MIN_SHORT_SIDE;
  assert.ok(ratio < 4 / 3, `SD's cap binds only below ${ratio.toFixed(3)}:1, and a photograph is 1.333:1 or wider`);
});

test("HD is still the cap's own answer, so the two are not the same encode", () => {
  assert.deepEqual(at(hdCap, 4032, 3024), [2560, 1920]);
  assert.deepEqual(at(hdCap, 4000, 2250), [2560, 1440]);
  // The property D-174's byte test rests on, as arithmetic: HD is wider than SD
  // for every source large enough for the two to differ at all.
  for (const [width, height] of [
    [1600, 1200],
    [2400, 1800],
    [4032, 3024],
    [4000, 2250],
    [3000, 2000],
  ]) {
    const [sdWidth] = at(sdCap, width, height);
    const [hdWidth] = at(hdCap, width, height);
    assert.ok(hdWidth > sdWidth, `HD must be the wider encode for ${width}x${height}: ${hdWidth} vs ${sdWidth}`);
  }
});
