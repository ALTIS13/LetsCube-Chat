import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";

import { verifyAndroidRelease } from "../../scripts/verify-android-release.mjs";

const fingerprint = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";

function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "letscube-release-verifier-"));
  const apkPath = resolve(directory, "app-release.apk");
  const assetLinksPath = resolve(directory, "assetlinks.json");
  writeFileSync(apkPath, "signed release fixture");
  writeFileSync(assetLinksPath, JSON.stringify([{ target: { package_name: "com.kub.messenger", sha256_cert_fingerprints: [fingerprint] } }]));
  return { directory, apkPath, assetLinksPath };
}

function createRunner(overrides = {}) {
  const calls = [];
  const output = {
    "verify --verbose --print-certs": `Verified using v1 scheme (JAR signing): true\nSigner #1 certificate SHA-256 digest: ${fingerprint.replaceAll(":", "")}`,
    "manifest application-id": "com.kub.messenger",
    "manifest version-name": "0.1.1",
    "manifest version-code": "2",
    "manifest debuggable": "false",
    "manifest print": '<manifest><application android:debuggable="false"><activity android:name="com.kub.messenger.MainActivity" android:exported="true" /></application></manifest>',
    "manifest permissions": "android.permission.INTERNET\nandroid.permission.CAMERA\nandroid.permission.RECORD_AUDIO",
    ...overrides,
  };
  return {
    calls,
    run(tool, args) {
      calls.push({ tool, args });
      const key = args.slice(0, -1).join(" ");
      if (!(key in output)) throw new Error(`Unexpected command: ${key}`);
      return output[key];
    },
  };
}

test("Android release verifier runs signature and manifest gates before returning a redacted summary", () => {
  const fixture = createFixture();
  const runner = createRunner();

  try {
    const summary = verifyAndroidRelease(fixture.apkPath, {
      assetLinksPath: fixture.assetLinksPath,
      expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
      tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
      run: runner.run,
    });

    assert.deepEqual(summary, {
      path: basename(fixture.apkPath),
      version: "0.1.1",
      build: 2,
      bytes: readFileSync(fixture.apkPath).byteLength,
      sha256: "a98c95afafc57d0f0907187ad24ddfb02b96de7c3e74beff53ab2d86b2cc7972",
    });
    assert.deepEqual(
      runner.calls.map(({ tool, args }) => ({ tool, args: args.slice(0, -1) })),
      [
        { tool: "apksigner", args: ["verify", "--verbose", "--print-certs"] },
        { tool: "apkanalyzer", args: ["manifest", "application-id"] },
        { tool: "apkanalyzer", args: ["manifest", "version-name"] },
        { tool: "apkanalyzer", args: ["manifest", "version-code"] },
        { tool: "apkanalyzer", args: ["manifest", "debuggable"] },
        { tool: "apkanalyzer", args: ["manifest", "print"] },
        { tool: "apkanalyzer", args: ["manifest", "permissions"] },
      ],
    );
    assert.equal(JSON.stringify(summary).includes("Signer"), false);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android release verifier rejects package and version drift", () => {
  const fixture = createFixture();

  try {
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        assetLinksPath: fixture.assetLinksPath,
        expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
        tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
        run: createRunner({ "manifest application-id": "com.example.other" }).run,
      }),
      /application ID/,
    );
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        assetLinksPath: fixture.assetLinksPath,
        expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
        tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
        run: createRunner({ "manifest version-code": "3" }).run,
      }),
      /version code/,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android release verifier rejects unsafe manifest and certificate contracts", () => {
  const fixture = createFixture();
  const options = {
    assetLinksPath: fixture.assetLinksPath,
    expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
    tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
  };

  try {
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, { ...options, run: createRunner({ "manifest debuggable": "true" }).run }),
      /must not be debuggable/,
    );
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        ...options,
        run: createRunner({ "manifest print": '<manifest><application><receiver android:name="com.example.Exported" android:exported="true" /></application></manifest>' }).run,
      }),
      /unexpected exported component/,
    );
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        ...options,
        run: createRunner({ "manifest permissions": "android.permission.READ_CONTACTS" }).run,
      }),
      /unexpected dangerous permission/,
    );
    writeFileSync(fixture.assetLinksPath, JSON.stringify([{ target: { package_name: "com.kub.messenger", sha256_cert_fingerprints: ["AA:BB"] } }]));
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, { ...options, run: createRunner().run }),
      /does not match Digital Asset Links/,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});
