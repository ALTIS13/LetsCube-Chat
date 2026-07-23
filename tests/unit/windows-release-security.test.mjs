import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readText = (path) => readFileSync(path, "utf8");
const readJson = (path) => JSON.parse(readText(path));

test("Windows production build uses a dedicated fail-closed Authenticode path", () => {
  assert.equal(existsSync("scripts/windows-authenticode.ps1"), true);
  assert.equal(
    existsSync("windows-tauri/src-tauri/tauri.authenticode.conf.json"),
    true,
  );

  const rootPackage = readJson("package.json");
  const signingConfig = readJson(
    "windows-tauri/src-tauri/tauri.authenticode.conf.json",
  );
  const signingScript = readText("scripts/windows-authenticode.ps1");

  assert.equal(
    rootPackage.scripts["windows:tauri:signing:preflight"],
    "pwsh -NoLogo -NoProfile -NonInteractive -File scripts/windows-authenticode.ps1 -Mode Preflight",
  );
  assert.match(
    rootPackage.scripts["windows:tauri:build:signed"],
    /tauri\.authenticode\.conf\.json/,
  );
  assert.match(
    rootPackage.scripts["windows:tauri:build:signed"],
    /VerifyBundle/,
  );
  assert.equal(signingConfig.bundle.windows.signCommand.cmd, "pwsh");
  assert.deepEqual(signingConfig.bundle.windows.signCommand.args.slice(-4), [
    "-Mode",
    "Sign",
    "-Path",
    "%1",
  ]);

  assert.match(signingScript, /WINDOWS_SIGNING_PROVIDER/);
  assert.match(signingScript, /artifact-signing-cli/);
  assert.match(signingScript, /WINDOWS_CERTIFICATE_THUMBPRINT/);
  assert.match(signingScript, /Get-AuthenticodeSignature/);
  assert.match(
    signingScript,
    /Status\s+-ne\s+\[System\.Management\.Automation\.SignatureStatus\]::Valid/,
  );
  assert.match(signingScript, /signtool(?:\.exe)?/i);
  assert.doesNotMatch(signingScript, /client_secret\s*=\s*["'][^"']+/i);
  assert.doesNotMatch(signingScript, /password\s*=\s*["'][^"']+/i);
});

test("Windows signing configuration does not affect the unsigned internal QA build", () => {
  const rootPackage = readJson("package.json");
  const baseConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const internalConfig = readJson(
    "windows-tauri/src-tauri/tauri.internal.conf.json",
  );

  assert.equal(baseConfig.bundle.windows.signCommand, undefined);
  assert.equal(internalConfig.bundle.createUpdaterArtifacts, false);
  assert.match(
    rootPackage.scripts["windows:tauri:build:internal"],
    /tauri\.internal\.conf\.json/,
  );
  assert.doesNotMatch(
    rootPackage.scripts["windows:tauri:build:internal"],
    /tauri\.authenticode\.conf\.json/,
  );
});
