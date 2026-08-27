import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";

import * as releaseVerifier from "../../scripts/verify-android-release.mjs";

const { resolveAndroidTools, verifyAndroidRelease } = releaseVerifier;

const fingerprint = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";
const approvedExportedManifest = '<manifest><application android:debuggable="false">'
  + '<activity android:name="com.kub.messenger.MainActivity" android:exported="true" />'
  + '<receiver android:name="com.google.firebase.iid.FirebaseInstanceIdReceiver" android:exported="true" android:permission="com.google.android.c2dm.permission.SEND" />'
  + '<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" android:exported="true" android:permission="android.permission.DUMP" />'
  + "</application></manifest>";
const approvedPermissions = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAMERA",
  "android.permission.INTERNET",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.RECORD_AUDIO",
  "android.permission.WAKE_LOCK",
  "com.google.android.c2dm.permission.RECEIVE",
  "com.kub.messenger.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
];

function createFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "letscube-release-verifier-"));
  const apkPath = resolve(directory, "app-release.apk");
  const assetLinksPath = resolve(directory, "assetlinks.json");
  writeFileSync(apkPath, "signed release fixture");
  writeFileSync(assetLinksPath, JSON.stringify([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.kub.messenger",
      sha256_cert_fingerprints: [fingerprint],
    },
  }]));
  return { directory, apkPath, assetLinksPath };
}

function assertAssetLinksRejected(document) {
  const fixture = createFixture();
  try {
    writeFileSync(fixture.assetLinksPath, JSON.stringify(document));
    assert.throws(() => verifyAndroidRelease(fixture.apkPath, {
      assetLinksPath: fixture.assetLinksPath,
      expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
      tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
      run: createRunner().run,
    }), /does not match Digital Asset Links/);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
}

function createRunner(overrides = {}) {
  const calls = [];
  const output = {
    "verify --verbose --print-certs": `Verified using v1 scheme (JAR signing): true\nVerified using v2 scheme (APK Signature Scheme v2): true\nSigner #1 certificate SHA-256 digest: ${fingerprint.replaceAll(":", "")}`,
    "manifest application-id": "com.kub.messenger",
    "manifest version-name": "0.1.1",
    "manifest version-code": "2",
    "manifest debuggable": "false",
    "manifest print": approvedExportedManifest,
    "manifest permissions": approvedPermissions.join("\n"),
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

test("Android release verifier accepts pnpm's argument separator", () => {
  assert.equal(typeof releaseVerifier.readAndroidReleaseCliApk, "function");
  assert.equal(releaseVerifier.readAndroidReleaseCliApk(["--", "candidate.apk"]), "candidate.apk");
  assert.equal(releaseVerifier.readAndroidReleaseCliApk(["candidate.apk"]), "candidate.apk");
  assert.throws(() => releaseVerifier.readAndroidReleaseCliApk(["--"]), /Usage/);
});

test("Android release verifier accepts only the protected exported dependency receivers", () => {
  const fixture = createFixture();
  const options = {
    assetLinksPath: fixture.assetLinksPath,
    expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
    tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
  };

  try {
    assert.doesNotThrow(() => verifyAndroidRelease(fixture.apkPath, {
      ...options,
      run: createRunner({ "manifest print": approvedExportedManifest }).run,
    }));
    assert.throws(() => verifyAndroidRelease(fixture.apkPath, {
      ...options,
      run: createRunner({
        "manifest print": approvedExportedManifest.replace(' android:permission="android.permission.DUMP"', ""),
      }).run,
    }), /exported components do not match/);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android release verifier accepts only the required FCM permission additions", () => {
  const fixture = createFixture();
  const options = {
    assetLinksPath: fixture.assetLinksPath,
    expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
    tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
  };

  try {
    assert.doesNotThrow(() => verifyAndroidRelease(fixture.apkPath, {
      ...options,
      run: createRunner({ "manifest permissions": approvedPermissions.join("\n") }).run,
    }));
    assert.throws(() => verifyAndroidRelease(fixture.apkPath, {
      ...options,
      run: createRunner({
        "manifest permissions": [...approvedPermissions, "android.permission.QUERY_ALL_PACKAGES"].join("\n"),
      }).run,
    }), /permissions do not match the approved contract/);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

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
      /exported components do not match/,
    );
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        ...options,
        run: createRunner({ "manifest permissions": "android.permission.QUERY_ALL_PACKAGES" }).run,
      }),
      /permissions do not match the approved contract/,
    );
    writeFileSync(fixture.assetLinksPath, JSON.stringify([{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { package_name: "com.kub.messenger", sha256_cert_fingerprints: ["AA:BB"] },
    }]));
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, { ...options, run: createRunner().run }),
      /does not match Digital Asset Links/,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android release verifier fails closed for missing SDK tools and bad signature output", () => {
  const fixture = createFixture();
  const sdkRoot = resolve(fixture.directory, "android-sdk");
  mkdirSync(resolve(sdkRoot, "build-tools", "36.0.0"), { recursive: true });

  try {
    assert.throws(() => resolveAndroidTools(sdkRoot), /Required Android SDK/);
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        assetLinksPath: fixture.assetLinksPath,
        expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
        tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
        run: createRunner({
          "verify --verbose --print-certs": [
            "Verifies",
            "Verified using v2 scheme (APK Signature Scheme v2): true",
            "DOES NOT CONTAIN A CERTIFICATE",
          ].join("\n"),
        }).run,
      }),
      /exactly one SHA-256 signing certificate/,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android release verifier rejects a v1-only APK signature", () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        assetLinksPath: fixture.assetLinksPath,
        expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
        tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
        run: createRunner({
          "verify --verbose --print-certs": `Verified using v1 scheme (JAR signing): true\nVerified using v2 scheme (APK Signature Scheme v2): false\nSigner #1 certificate SHA-256 digest: ${fingerprint.replaceAll(":", "")}`,
        }).run,
      }),
      /v2 signature scheme/,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android release verifier requires a valid authorizing Asset Links statement", () => {
  const fixture = createFixture();
  const options = {
    expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
    tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
    run: createRunner().run,
  };

  try {
    rmSync(fixture.assetLinksPath);
    assert.throws(() => verifyAndroidRelease(fixture.apkPath, { ...options, assetLinksPath: fixture.assetLinksPath }), /association is required/);
    writeFileSync(fixture.assetLinksPath, "not json");
    assert.throws(() => verifyAndroidRelease(fixture.apkPath, { ...options, assetLinksPath: fixture.assetLinksPath }), /association is invalid/);
    writeFileSync(fixture.assetLinksPath, JSON.stringify([{
      relation: ["delegate_permission/common.get_login_creds"],
      target: { package_name: "com.kub.messenger", sha256_cert_fingerprints: [fingerprint] },
    }]));
    assert.throws(() => verifyAndroidRelease(fixture.apkPath, { ...options, assetLinksPath: fixture.assetLinksPath }), /does not match Digital Asset Links/);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Android release verifier rejects an Asset Links target without android_app namespace", () => {
  assertAssetLinksRejected([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { package_name: "com.kub.messenger", sha256_cert_fingerprints: [fingerprint] },
  }]);
});

test("Android release verifier rejects extra Asset Links statements", () => {
  const statement = {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.kub.messenger",
      sha256_cert_fingerprints: [fingerprint],
    },
  };
  assertAssetLinksRejected([statement, statement]);
});

test("Android release verifier rejects extra Asset Links relations", () => {
  assertAssetLinksRejected([{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: {
      namespace: "android_app",
      package_name: "com.kub.messenger",
      sha256_cert_fingerprints: [fingerprint],
    },
  }]);
});

test("Android release verifier rejects extra Asset Links fingerprints", () => {
  assertAssetLinksRejected([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.kub.messenger",
      sha256_cert_fingerprints: [fingerprint, "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA"],
    },
  }]);
});

test("Android release verifier rejects the wrong Asset Links package", () => {
  assertAssetLinksRejected([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.kub.other",
      sha256_cert_fingerprints: [fingerprint],
    },
  }]);
});

test("Android release verifier rejects the wrong Asset Links fingerprint", () => {
  assertAssetLinksRejected([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.kub.messenger",
      sha256_cert_fingerprints: ["22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22"],
    },
  }]);
});

test("Android release verifier requires the exact protected exported component contract", () => {
  const fixture = createFixture();
  const options = {
    assetLinksPath: fixture.assetLinksPath,
    expectedMetadata: { applicationId: "com.kub.messenger", versionName: "0.1.1", versionCode: 2 },
    tools: { apksigner: "apksigner", apkanalyzer: "apkanalyzer" },
  };

  try {
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, { ...options, run: createRunner({ "manifest print": "<manifest><application /></manifest>" }).run }),
      /exported components do not match/,
    );
    assert.throws(
      () => verifyAndroidRelease(fixture.apkPath, {
        ...options,
        run: createRunner({ "manifest print": '<manifest><application><activity android:name="com.kub.messenger.MainActivity" android:exported="true" /><activity android:name="com.kub.messenger.MainActivity" android:exported="true" /></application></manifest>' }).run,
      }),
      /exported components do not match/,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});
