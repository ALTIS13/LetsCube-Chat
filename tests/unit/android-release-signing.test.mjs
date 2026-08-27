import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readAndroidReleaseMetadata } from "../../scripts/android-release-metadata.mjs";
import * as releaseBuilder from "../../scripts/build-android-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { verifyAndroidReleaseArtifactMetadata } = releaseBuilder;

test("Android release metadata has the canonical production version", () => {
  assert.deepEqual(readAndroidReleaseMetadata(root), {
    versionName: "0.1.2",
    versionCode: 3,
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
  assert.match(gradle, /gradle\.taskGraph\.whenReady/);
  assert.doesNotMatch(gradle, /gradle\.startParameter\.taskNames/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.doesNotMatch(gradle, /signingConfig\s+signingConfigs\.debug/);
});

test("Android aggregate assemble fails closed without release signing inputs", { timeout: 30_000 }, () => {
  const capacitorDirectory = resolve(root, "android/capacitor-cordova-android-plugins");
  const capacitorVariables = resolve(capacitorDirectory, "cordova.variables.gradle");
  const capacitorBuild = resolve(capacitorDirectory, "build.gradle");
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "letscube-android-task-graph-"));
  const initScript = resolve(fixtureRoot, "release-task-graph.init.gradle");
  const createdDirectory = !existsSync(capacitorDirectory);
  const createdVariables = !existsSync(capacitorVariables);
  const createdBuild = !existsSync(capacitorBuild);

  if (createdDirectory) mkdirSync(capacitorDirectory, { recursive: true });
  if (createdVariables) writeFileSync(capacitorVariables, "");
  if (createdBuild) {
    writeFileSync(
      capacitorBuild,
      `plugins {
    id "com.android.library"
}

android {
    namespace "com.letscube.test.cordova"
    compileSdk rootProject.ext.compileSdkVersion
}
`,
    );
  }
  writeFileSync(
    initScript,
    `gradle.projectsEvaluated {
    rootProject.project(":app").tasks.named("assemble") {
        dependsOn(rootProject.project(":app").tasks.named("assembleRelease"))
    }
}
`,
  );

  try {
    const command = [
      'set "LETSCUBE_ANDROID_KEYSTORE_PATH="',
      'set "LETSCUBE_ANDROID_KEY_ALIAS="',
      'set "LETSCUBE_ANDROID_STORE_PASSWORD="',
      'set "LETSCUBE_ANDROID_KEY_PASSWORD="',
      `gradlew.bat assemble --init-script ${initScript}`,
    ].join(" && ");
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
      cwd: resolve(root, "android"),
      encoding: "utf8",
      timeout: 25_000,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0);
    assert.match(output, /Android release signing requires LETSCUBE_ANDROID_KEYSTORE_PATH\./);
    assert.doesNotMatch(output, /LETSCUBE_ANDROID_STORE_PASSWORD/);
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
    if (createdBuild) rmSync(capacitorBuild, { force: true });
    if (createdVariables) rmSync(capacitorVariables, { force: true });
    if (createdDirectory) rmSync(capacitorDirectory, { force: true, recursive: true });
  }
});

test("Android release builder creates and verifies signed release artifacts", () => {
  const releaseBuilder = readFileSync(resolve(root, "scripts/build-android-release.mjs"), "utf8");

  assert.match(releaseBuilder, /assembleRelease/);
  assert.match(releaseBuilder, /bundleRelease/);
  assert.match(releaseBuilder, /apksigner/);
});

test("Android release Gradle environment restores only dedicated signing inputs", () => {
  const baseEnv = {
    PATH: "C:\\tools",
    JAVA_HOME: "C:\\Java\\jdk",
    ANDROID_HOME: "C:\\Android\\sdk",
    GRADLE_USER_HOME: "C:\\gradle",
    VITE_UNAPPROVED_SECRET: "must-not-leak",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
    LETSCUBE_ANDROID_KEYSTORE_PATH: "C:\\secure\\release.p12",
    LETSCUBE_ANDROID_KEY_ALIAS: "letscube-release",
    LETSCUBE_ANDROID_STORE_PASSWORD: "store-password",
    LETSCUBE_ANDROID_KEY_PASSWORD: "key-password",
    DATABASE_URL: "postgres://secret",
    PGPASSWORD: "database-password",
    GITHUB_PAT: "github-token",
    EXAMPLE_AUTHTOKEN: "arbitrary-token",
    HTTPS_PROXY: "https://user:password@proxy.example.com",
  };
  const result = releaseBuilder.createAndroidReleaseProcessEnv(baseEnv, {
    VITE_SUPABASE_URL: "https://core.example.com",
  });

  assert.equal(result.PATH, "C:\\tools");
  assert.equal(result.JAVA_HOME, "C:\\Java\\jdk");
  assert.equal(result.ANDROID_HOME, "C:\\Android\\sdk");
  assert.equal(result.GRADLE_USER_HOME, "C:\\gradle");
  assert.equal(result.VITE_SUPABASE_URL, "https://core.example.com");
  assert.equal(result.VITE_UNAPPROVED_SECRET, undefined);
  assert.equal(result.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(result.LETSCUBE_ANDROID_KEYSTORE_PATH, baseEnv.LETSCUBE_ANDROID_KEYSTORE_PATH);
  assert.equal(result.LETSCUBE_ANDROID_KEY_ALIAS, baseEnv.LETSCUBE_ANDROID_KEY_ALIAS);
  assert.equal(result.LETSCUBE_ANDROID_STORE_PASSWORD, baseEnv.LETSCUBE_ANDROID_STORE_PASSWORD);
  assert.equal(result.LETSCUBE_ANDROID_KEY_PASSWORD, baseEnv.LETSCUBE_ANDROID_KEY_PASSWORD);
  assert.equal(result.DATABASE_URL, undefined);
  assert.equal(result.PGPASSWORD, undefined);
  assert.equal(result.GITHUB_PAT, undefined);
  assert.equal(result.EXAMPLE_AUTHTOKEN, undefined);
  assert.equal(result.HTTPS_PROXY, undefined);
});

test("Android release Git and artifact inspection children exclude inherited credentials", () => {
  const result = releaseBuilder.createAndroidReleaseToolProcessEnv({
    PATH: "C:\\tools",
    JAVA_HOME: "C:\\Java\\jdk",
    ANDROID_HOME: "C:\\Android\\sdk",
    LETSCUBE_ANDROID_KEYSTORE_PATH: "C:\\secure\\release.p12",
    DATABASE_URL: "postgres://secret",
    PGPASSWORD: "database-password",
    GITHUB_PAT: "github-token",
    EXAMPLE_AUTHTOKEN: "arbitrary-token",
    HTTPS_PROXY: "https://user:password@proxy.example.com",
  });

  assert.equal(result.PATH, "C:\\tools");
  assert.equal(result.JAVA_HOME, "C:\\Java\\jdk");
  assert.equal(result.ANDROID_HOME, "C:\\Android\\sdk");
  assert.equal(result.LETSCUBE_ANDROID_KEYSTORE_PATH, undefined);
  assert.equal(result.DATABASE_URL, undefined);
  assert.equal(result.PGPASSWORD, undefined);
  assert.equal(result.GITHUB_PAT, undefined);
  assert.equal(result.EXAMPLE_AUTHTOKEN, undefined);
  assert.equal(result.HTTPS_PROXY, undefined);
});

test("Android release builder preserves Windows command options containing equals signs", {
  skip: process.platform !== "win32",
}, () => {
  const expected = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(expected.status, 0);
  assert.equal(typeof releaseBuilder.runReleaseCommand, "function");
  assert.equal(
    releaseBuilder.runReleaseCommand("git", ["rev-parse", "--short=12", "HEAD"], process.env, root),
    expected.stdout.trim(),
  );
});

test("Android release builder resolves inspection tools from the Android SDK", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "letscube-android-sdk-"));
  const buildTools = resolve(fixtureRoot, "build-tools/36.0.0");
  const commandLineTools = resolve(fixtureRoot, "cmdline-tools/latest/bin");
  const executableSuffix = process.platform === "win32" ? ".bat" : "";
  const apksigner = resolve(buildTools, `apksigner${executableSuffix}`);
  const apkanalyzer = resolve(commandLineTools, `apkanalyzer${executableSuffix}`);
  mkdirSync(buildTools, { recursive: true });
  mkdirSync(commandLineTools, { recursive: true });
  writeFileSync(apksigner, "");
  writeFileSync(apkanalyzer, "");

  try {
    assert.equal(typeof releaseBuilder.resolveAndroidReleaseCommands, "function");
    assert.deepEqual(releaseBuilder.resolveAndroidReleaseCommands(fixtureRoot), {
      apksigner,
      apkanalyzer,
    });
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
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
