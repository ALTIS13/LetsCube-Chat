import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("Windows Tauri QA exposes a bounded native soak suite", () => {
  assert.equal(
    existsSync("tests/e2e/windows-tauri-long-session.spec.ts"),
    true,
  );
  assert.match(
    packageJson.scripts["windows:tauri:qa:long-session"],
    /LETSCUBE_TAURI_QA_SUITE=long-session/,
  );
  assert.match(
    packageJson.scripts["windows:tauri:qa:long-session"],
    /windows-tauri-qa\.mjs/,
  );

  const runner = readFileSync("scripts/windows-tauri-qa.mjs", "utf8");
  assert.match(runner, /LETSCUBE_TAURI_QA_SUITE/);
  assert.match(runner, /windows-tauri-long-session\.spec\.ts/);
  assert.match(runner, /long-session/);

  const spec = readFileSync(
    "tests/e2e/windows-tauri-long-session.spec.ts",
    "utf8",
  );
  assert.match(spec, /LETSCUBE_TAURI_SOAK_SECONDS/);
  assert.match(spec, /setOffline\(true\)/);
  assert.match(spec, /setOffline\(false\)/);
  assert.match(spec, /framenavigated/);
  assert.match(spec, /requestfailed/);
  assert.match(spec, /Произошла ошибка интерфейса/);
});

test("Windows matrix report is local-only, sanitized and covers release gates", () => {
  assert.equal(existsSync("scripts/windows-device-matrix.ps1"), true);
  assert.equal(existsSync("docs/native/WINDOWS_QA_MATRIX.md"), true);
  assert.match(
    packageJson.scripts["windows:matrix"],
    /windows-device-matrix\.ps1/,
  );

  const report = readFileSync("scripts/windows-device-matrix.ps1", "utf8");
  assert.match(report, /Win32_OperatingSystem/);
  assert.match(report, /WebView2/);
  assert.match(report, /Get-AuthenticodeSignature/);
  assert.doesNotMatch(report, /COMPUTERNAME|UserName|RegisteredUser/);
});
