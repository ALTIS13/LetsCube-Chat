import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readAndroidReleaseMetadata } from "../../scripts/android-release-metadata.mjs";
import { verifyAndroidReleaseArtifactMetadata } from "../../scripts/build-android-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("Android release metadata has the canonical production version", () => {
  assert.deepEqual(readAndroidReleaseMetadata(root), {
    versionName: "0.1.1",
    versionCode: 2,
  });
});

test("Android release metadata rejects malformed canonical values", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "letscube-android-release-"));
  const androidDirectory = resolve(fixtureRoot, "android");
  mkdirSync(androidDirectory);

  writeFileSync(
    resolve(androidDirectory, "version.properties"),
    "VERSION_NAME=01.1.0\nVERSION_CODE=0\n",
  );

  assert.throws(() => readAndroidReleaseMetadata(fixtureRoot), /VERSION_NAME/);

  writeFileSync(
    resolve(androidDirectory, "version.properties"),
    "VERSION_NAME=1.1.0\nVERSION_CODE=9007199254740992\n",
  );

  assert.throws(() => readAndroidReleaseMetadata(fixtureRoot), /VERSION_CODE/);
});

test("Android release Gradle signing requires dedicated signing inputs", () => {
  const gradle = readFileSync(resolve(root, "android/app/build.gradle"), "utf8");

  assert.match(gradle, /LETSCUBE_ANDROID_KEYSTORE_PATH/);
  assert.match(gradle, /LETSCUBE_ANDROID_KEY_ALIAS/);
  assert.match(gradle, /LETSCUBE_ANDROID_STORE_PASSWORD/);
  assert.match(gradle, /LETSCUBE_ANDROID_KEY_PASSWORD/);
  assert.doesNotMatch(gradle, /signingConfig\s+signingConfigs\.debug/);
});

test("Android release builder creates and verifies signed release artifacts", () => {
  const releaseBuilder = readFileSync(resolve(root, "scripts/build-android-release.mjs"), "utf8");

  assert.match(releaseBuilder, /assembleRelease/);
  assert.match(releaseBuilder, /bundleRelease/);
  assert.match(releaseBuilder, /apksigner/);
});

test("Android release artifact verification rejects metadata drift", () => {
  const expected = {
    applicationId: "com.kub.messenger",
    versionName: "0.1.1",
    versionCode: 2,
  };

  assert.doesNotThrow(() =>
    verifyAndroidReleaseArtifactMetadata(
      {
        applicationId: "com.kub.messenger",
        versionName: "0.1.1",
        versionCode: "2",
      },
      expected,
    ),
  );
  assert.throws(
    () =>
      verifyAndroidReleaseArtifactMetadata(
        { ...expected, applicationId: "com.example.other", versionCode: "2" },
        expected,
      ),
    /application ID/,
  );
  assert.throws(
    () => verifyAndroidReleaseArtifactMetadata({ ...expected, versionCode: "2" }, { ...expected, versionName: "0.1.2" }),
    /version name/,
  );
  assert.throws(
    () => verifyAndroidReleaseArtifactMetadata({ ...expected, versionCode: "3" }, expected),
    /version code/,
  );
});
