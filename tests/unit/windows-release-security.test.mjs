import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
  assert.match(signingScript, /Expected exactly one release application executable/);
  assert.match(signingScript, /Invoke-Verify \$applications\[0\]\.FullName/);
  assert.match(signingScript, /Invoke-Verify \$installers\[0\]\.FullName/);
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

test("first-party updater signing remains independent of Authenticode", () => {
  const rootPackage = readJson("package.json");
  const baseConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const updaterBuild = readText("scripts/windows-tauri-updater-build.ps1");
  const publisher = readText("scripts/publish-native-release.sh");

  assert.match(rootPackage.scripts["windows:tauri:build:updater"], /windows-tauri-updater-build\.ps1/);
  assert.equal(baseConfig.bundle.createUpdaterArtifacts, true);
  assert.equal(baseConfig.bundle.windows.signCommand, undefined);
  assert.match(updaterBuild, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(updaterBuild, /localPublicKey -ne \$trackedPublicKey/);
  assert.doesNotMatch(updaterBuild, /windows-authenticode|WINDOWS_SIGNING_PROVIDER/);
  assert.match(publisher, /verify_updater_signature/);
});

test("bundle verification ignores old installers and reaches the current app signature gate", (t) => {
  if (process.platform !== "win32") {
    t.skip("Authenticode verification requires Windows");
    return;
  }

  const version = readJson("windows-tauri/src-tauri/tauri.conf.json").version;
  const release = mkdtempSync(join(tmpdir(), "letscube-signing-"));
  const nsis = join(release, "bundle", "nsis");
  mkdirSync(nsis, { recursive: true });
  t.after(() => rmSync(release, { recursive: true, force: true }));

  writeFileSync(join(release, "letscube-windows-tauri.exe"), "not a signed executable");
  writeFileSync(join(nsis, "LETSCUBE_0.0.1_x64-setup.exe"), "old installer");
  writeFileSync(join(nsis, `LETSCUBE_${version}_x64-setup.exe`), "current installer");

  const result = spawnSync("pwsh", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
    "scripts/windows-authenticode.ps1", "-Mode", "VerifyBundle", "-Path", nsis,
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Authenticode verification failed/);
  assert.doesNotMatch(result.stderr, /Expected exactly one NSIS setup executable/);

  copyFileSync(process.execPath,
    join(release, "letscube-windows-tauri.exe"));
  const installerResult = spawnSync("pwsh", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
    "scripts/windows-authenticode.ps1", "-Mode", "VerifyBundle", "-Path", nsis,
  ], { encoding: "utf8" });

  assert.notEqual(installerResult.status, 0);
  assert.match(installerResult.stdout, /Verified letscube-windows-tauri\.exe/);
  assert.match(installerResult.stderr, /Authenticode verification failed/);
});
