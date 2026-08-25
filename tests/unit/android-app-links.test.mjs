import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parserPath = resolve(root, "artifacts/kub/src/lib/platform/androidAppLinks.ts");
const generatorPath = resolve(root, "scripts/generate-android-assetlinks.mjs");

function loadParser() {
  const source = readFileSync(parserPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { exports: module.exports, module, URL });
  return module.exports;
}

test("Android auth app links accept only the canonical HTTPS callback and retain query and hash", () => {
  const { parseAndroidAuthAppLink } = loadParser();

  assert.equal(
    parseAndroidAuthAppLink("https://app.letscube.ru/auth/callback?code=opaque#type=recovery"),
    "/auth/callback?code=opaque#type=recovery",
  );
});

test("Android auth app links reject non-canonical callback URLs", () => {
  const { parseAndroidAuthAppLink } = loadParser();
  const rejected = [
    "http://app.letscube.ru/auth/callback",
    "https://other.letscube.ru/auth/callback",
    "https://app.letscube.ru:443/auth/callback",
    "https://user@app.letscube.ru/auth/callback",
    "https://user:pass@app.letscube.ru/auth/callback",
    "https://app.letscube.ru/auth/callback/next",
    "https://app.letscube.ru/auth/callback%2Fnext",
    "https://app.letscube.ru/auth%2Fcallback",
    "https://app.letscube.ru/login?returnTo=%2Fauth%2Fcallback",
  ];

  for (const value of rejected) {
    assert.equal(parseAndroidAuthAppLink(value), null, value);
  }
});

test("Android callback listener is scoped to native Android and mounted inside Wouter", () => {
  const hook = readFileSync(resolve(root, "artifacts/kub/src/hooks/useAndroidAppLinks.ts"), "utf8");
  const app = readFileSync(resolve(root, "artifacts/kub/src/App.tsx"), "utf8");

  assert.match(hook, /isNativeAndroid\(\)/);
  assert.match(hook, /App\.getLaunchUrl\(\)/);
  assert.match(hook, /App\.addListener\("appUrlOpen"/);
  assert.match(hook, /remove\(\)/);
  assert.match(app, /<WouterRouter[\s\S]*<AndroidAppLinkListener\s*\/>[\s\S]*<RootRoutes\s*\/>[\s\S]*<\/WouterRouter>/);
});

test("Android manifest and Nginx expose only the verified asset association endpoint", () => {
  const manifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  const nginx = readFileSync(resolve(root, "docs/deploy/nginx.conf"), "utf8");

  assert.match(
    manifest,
    /<intent-filter android:autoVerify="true">[\s\S]*android:name="android\.intent\.action\.VIEW"[\s\S]*android:name="android\.intent\.category\.DEFAULT"[\s\S]*android:name="android\.intent\.category\.BROWSABLE"[\s\S]*android:scheme="https"[\s\S]*android:host="app\.letscube\.ru"[\s\S]*android:path="\/auth\/callback"[\s\S]*<\/intent-filter>/,
  );
  assert.match(
    nginx,
    /location = \/\.well-known\/assetlinks\.json \{[\s\S]*try_files \$uri =404;[\s\S]*default_type application\/json;[\s\S]*X-Content-Type-Options "nosniff" always;[\s\S]*Cache-Control "public, max-age=3600" always;[\s\S]*\}/,
  );
});

test("asset links generator writes the single release-certificate association", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "letscube-assetlinks-"));
  const apk = resolve(fixture, "app-release.apk");
  const output = resolve(fixture, "assetlinks.json");
  const apksigner = resolve(fixture, "apksigner.cmd");
  const fingerprint = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00";

  writeFileSync(apk, "release fixture");
  writeFileSync(
    apksigner,
    `@echo off\r\necho Verifies\r\necho Signer #1 certificate DN: CN=LETSCUBE Release\r\necho Signer #1 certificate SHA-256 digest: ${fingerprint}\r\n`,
  );

  try {
    const result = spawnSync(process.execPath, [generatorPath, apk, output], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LETSCUBE_ANDROID_APKSIGNER: apksigner },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.kub.messenger",
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ]);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("asset links generator refuses an Android debug certificate fixture", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "letscube-assetlinks-debug-"));
  const apk = resolve(fixture, "app-release.apk");
  const output = resolve(fixture, "assetlinks.json");
  const apksigner = resolve(fixture, "apksigner.cmd");

  writeFileSync(apk, "debug fixture");
  writeFileSync(
    apksigner,
    "@echo off\r\necho Signer #1 certificate DN: CN=Android Debug\r\necho Signer #1 certificate SHA-256 digest: 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00\r\n",
  );

  try {
    const result = spawnSync(process.execPath, [generatorPath, apk, output], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LETSCUBE_ANDROID_APKSIGNER: apksigner },
    });

    assert.notEqual(result.status, 0);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});
