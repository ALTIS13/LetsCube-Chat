import assert from "node:assert/strict";
import { statSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readAndroidReleaseMetadata } from "../../scripts/android-release-metadata.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("Android release identity stays on the LETSCUBE package contract", () => {
  const capacitorConfig = read("capacitor.config.ts");
  const strings = read("android/app/src/main/res/values/strings.xml");
  const gradle = read("android/app/build.gradle");

  assert.match(capacitorConfig, /appId:\s*"com\.kub\.messenger"/);
  assert.match(capacitorConfig, /appName:\s*"LETSCUBE"/);
  assert.match(strings, /<string name="app_name">LETSCUBE<\/string>/);
  assert.match(gradle, /versionProperties\.getProperty\("VERSION_CODE"\)/);
  assert.match(gradle, /versionProperties\.getProperty\("VERSION_NAME"\)/);
  assert.deepEqual(readAndroidReleaseMetadata(root), {
    versionName: "0.1.3",
    versionCode: 4,
  });
});

test("Android icon and splash use the official LETSCUBE mark", () => {
  const source = read("assets/logo.svg");
  const adaptiveIcon = read(
    "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
  );
  const foreground = resolve(
    root,
    "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png",
  );
  const splash = resolve(
    root,
    "android/app/src/main/res/drawable-port-xxxhdpi/splash.png",
  );

  assert.match(source, /#427fc2/);
  assert.match(source, /#ed1e7a/);
  assert.match(source, /viewBox="-195 -221 1146 1300"/);
  assert.match(adaptiveIcon, /@mipmap\/ic_launcher_background/);
  assert.match(adaptiveIcon, /@mipmap\/ic_launcher_foreground/);
  assert.doesNotMatch(adaptiveIcon, /@color\/ic_launcher_background/);
  assert.ok(statSync(foreground).size > 8_000);
  assert.ok(statSync(splash).size > 40_000);
});
