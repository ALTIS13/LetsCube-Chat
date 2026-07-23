import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, "scripts", "windows-package-identity.ps1");
const rootPackage = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);

const identityEnvironment = {
  WINDOWS_PACKAGE_NAME: "LETSCUBE.Test.Identity",
  WINDOWS_PACKAGE_PUBLISHER: "CN=LETSCUBE Test",
  WINDOWS_PACKAGE_PUBLISHER_DISPLAY_NAME: "LETSCUBE Test",
  WINDOWS_PACKAGE_APPLICATION_ID: "LETSCUBE",
  WINDOWS_PACKAGE_VERSION: "0.2.7.0",
  WINDOWS_WNS_REMOTE_ID: "1c4eef27-51fd-43b8-9a31-c8be45fc0a66",
};

const runIdentityScript = (args, environment = {}) =>
  spawnSync(
    "pwsh",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      scriptPath,
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
      },
    },
  );

const findMakeAppx = () => {
  if (process.platform !== "win32") return null;
  const kitsBin = join(
    process.env["ProgramFiles(x86)"] ?? "",
    "Windows Kits",
    "10",
    "bin",
  );
  if (!existsSync(kitsBin)) return null;
  return readdirSync(kitsBin)
    .sort()
    .reverse()
    .map((version) => join(kitsBin, version, "x64", "makeappx.exe"))
    .find(existsSync) ?? null;
};

test("Windows package identity commands are isolated from the internal NSIS build", () => {
  assert.equal(existsSync(scriptPath), true);
  assert.match(
    rootPackage.scripts["windows:identity:preflight"],
    /windows-package-identity\.ps1 -Mode Preflight/,
  );
  assert.match(
    rootPackage.scripts["windows:identity:render"],
    /windows-package-identity\.ps1 -Mode Render/,
  );
  assert.doesNotMatch(
    rootPackage.scripts["windows:tauri:build:internal"],
    /windows-package-identity|windows:identity/,
  );
});

test(
  "Windows package identity render keeps package and executable manifests aligned",
  { skip: process.platform !== "win32" },
  () => {
    const outputDirectory = mkdtempSync(
      join(tmpdir(), "letscube-windows-identity-"),
    );

    try {
      const result = runIdentityScript(
        ["-Mode", "Render", "-OutputDirectory", outputDirectory],
        identityEnvironment,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(
        `${result.stdout}\n${result.stderr}`,
        new RegExp(identityEnvironment.WINDOWS_WNS_REMOTE_ID, "i"),
      );

      const packageManifest = readFileSync(
        join(outputDirectory, "AppxManifest.xml"),
        "utf8",
      );
      const executableManifest = readFileSync(
        join(outputDirectory, "letscube-windows-tauri.exe.manifest"),
        "utf8",
      );
      const clientConfig = JSON.parse(
        readFileSync(join(outputDirectory, "wns-client-config.json"), "utf8"),
      );

      assert.match(
        packageManifest,
        /Identity Name="LETSCUBE\.Test\.Identity" Publisher="CN=LETSCUBE Test" Version="0\.2\.7\.0"/,
      );
      assert.match(
        packageManifest,
        /Application Id="LETSCUBE" Executable="letscube-windows-tauri\.exe"/,
      );
      assert.match(packageManifest, /uap10:AllowExternalContent>true/);
      assert.match(packageManifest, /MinVersion="10\.0\.19041\.0"/);
      assert.match(
        executableManifest,
        /publisher="CN=LETSCUBE Test"/,
      );
      assert.match(
        executableManifest,
        /packageName="LETSCUBE\.Test\.Identity"/,
      );
      assert.match(executableManifest, /applicationId="LETSCUBE"/);
      assert.deepEqual(clientConfig, {
        applicationId: "LETSCUBE",
        packageName: "LETSCUBE.Test.Identity",
        remoteId: identityEnvironment.WINDOWS_WNS_REMOTE_ID,
      });
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "Windows package identity preflight fails closed when Microsoft identity is absent",
  { skip: process.platform !== "win32" },
  () => {
    const emptyIdentity = Object.fromEntries(
      Object.keys(identityEnvironment).map((name) => [name, ""]),
    );
    const result = runIdentityScript(["-Mode", "Preflight"], emptyIdentity);

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Required Windows identity configuration is missing/,
    );
  },
);

test(
  "Windows identity validation package contains only sparse package metadata",
  { skip: !findMakeAppx() },
  () => {
    const outputDirectory = mkdtempSync(
      join(tmpdir(), "letscube-windows-identity-pack-"),
    );
    const unpackDirectory = `${outputDirectory}-unpacked`;
    const packagePath = `${outputDirectory}.unsigned.msix`;

    try {
      const result = runIdentityScript(
        ["-Mode", "PackUnsigned", "-OutputDirectory", outputDirectory],
        identityEnvironment,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(packagePath), true);

      const unpack = spawnSync(
        findMakeAppx(),
        ["unpack", "/o", "/nv", "/p", packagePath, "/d", unpackDirectory],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.equal(unpack.status, 0, `${unpack.stdout}\n${unpack.stderr}`);
      assert.deepEqual(
        readdirSync(unpackDirectory).sort(),
        ["AppxBlockMap.xml", "AppxManifest.xml"],
      );
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
      rmSync(unpackDirectory, { recursive: true, force: true });
      rmSync(packagePath, { force: true });
    }
  },
);
