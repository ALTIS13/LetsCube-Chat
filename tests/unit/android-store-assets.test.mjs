import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import sharp from "sharp";

import { createFeatureSurface, generateAndroidStoreAssets } from "../../scripts/generate-android-store-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function assertOpaquePng(path, width, height) {
  const image = sharp(path);
  const metadata = await image.metadata();
  const pixels = await image.ensureAlpha().raw().toBuffer();

  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.ok([3, 4].includes(metadata.channels));
  for (let index = 3; index < pixels.length; index += 4) assert.equal(pixels[index], 255);
}

test("Android store assets are deterministic opaque Google Play PNGs", async () => {
  const icon = resolve(root, "assets/android/store/icon-512.png");
  const featureGraphic = resolve(root, "assets/android/store/feature-graphic-1024x500.png");

  await assertOpaquePng(icon, 512, 512);
  await assertOpaquePng(featureGraphic, 1024, 500);

  const before = [icon, featureGraphic].map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));
  await generateAndroidStoreAssets(root);
  const after = [icon, featureGraphic].map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));
  assert.deepEqual(after, before);
});

test("Android feature graphic source has no host-rendered text or font dependency", () => {
  assert.doesNotMatch(createFeatureSurface().toString("utf8"), /<(?:text|style)\b|font-/i);
});
