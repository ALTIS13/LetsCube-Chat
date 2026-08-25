import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const matrixPath = resolve(root, "scripts/android-device-matrix.ps1");

function writeCommand(path, body) {
  writeFileSync(path, `@echo off\r\n${body}\r\n`, "utf8");
}

function runMatrix({ apkPackage, resolution, mode = "links" }) {
  const directory = mkdtempSync(resolve(tmpdir(), "letscube-device-matrix-"));
  const sdkBin = resolve(directory, "android-sdk", "cmdline-tools", "latest", "bin");
  const adbPath = resolve(directory, "adb.cmd");
  const markerPath = resolve(directory, "adb-called.txt");
  const apkPath = resolve(directory, "candidate.apk");
  const analyzerPath = resolve(sdkBin, "apkanalyzer.cmd");
  writeFileSync(apkPath, "fixture");
  mkdirSync(sdkBin, { recursive: true });
  writeFileSync(analyzerPath, `@echo off\r\necho ${apkPackage}\r\n`, "utf8");
  writeCommand(adbPath, [
    `echo %*>>"${markerPath}"`,
    'echo %* | findstr /c:"devices" >nul && (echo List of devices attached&echo emulator-5554 device&exit /b 0)',
    'echo %* | findstr /c:"ro.product.model" >nul && (echo Pixel_8&exit /b 0)',
    'echo %* | findstr /c:"ro.build.version.sdk" >nul && (echo 35&exit /b 0)',
    `echo %* | findstr /c:"resolve-activity" >nul && (echo ${resolution}&exit /b 0)`,
    'echo %* | findstr /c:"pm path" >nul && (echo package:base.apk&exit /b 0)',
    'echo %* | findstr /c:"get-app-links" >nul && (echo app.letscube.ru: verified&exit /b 0)',
    'echo %* | findstr /c:"am start" >nul && (echo Status: ok&exit /b 0)',
    'echo %* | findstr /c:"dumpsys activity top" >nul && (echo requestedOrientation=1&exit /b 0)',
    'exit /b 0',
  ].join("\r\n"));

  try {
    const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", matrixPath, "-Apk", apkPath, "-Mode", mode, "-AdbPath", adbPath, "-ApkAnalyzerPath", analyzerPath], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ANDROID_HOME: resolve(directory, "android-sdk"),
        PATH: `${directory}${delimiter}${process.env.PATH}`,
      },
    });
    return { directory, markerPath, result };
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

test("Android device matrix rejects a wrong APK package before invoking ADB", () => {
  const fixture = runMatrix({ apkPackage: "com.example.other", resolution: "com.kub.messenger/.MainActivity", mode: "install" });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(existsSync(fixture.markerPath), false);
    assert.match(fixture.result.stdout, /"command":\s*"apk_identity"/, fixture.result.stderr);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android device matrix rejects browser resolution and accepts LETSCUBE MainActivity", () => {
  const browser = runMatrix({ apkPackage: "com.kub.messenger", resolution: "com.android.chrome/com.google.android.apps.chrome.Main" });
  const letscube = runMatrix({ apkPackage: "com.kub.messenger", resolution: "com.kub.messenger/.MainActivity" });
  try {
    assert.notEqual(browser.result.status, 0, browser.result.stdout);
    assert.equal(letscube.result.status, 0, letscube.result.stdout);
  } finally {
    rmSync(browser.directory, { force: true, recursive: true });
    rmSync(letscube.directory, { force: true, recursive: true });
  }
});
