import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createAndroidBuildProcessEnv,
  collectPublicAndroidBuildEnv,
  parseEnvText,
} from "../../scripts/build-android-production.mjs";
import { readAndroidReleaseMetadata } from "../../scripts/android-release-metadata.mjs";

test("Android production build forwards only public Vite settings", () => {
  const source = parseEnvText(`
VITE_SUPABASE_URL=https://core.example.com
VITE_SUPABASE_ANON_KEY=public-anon
VITE_VAPID_PUBLIC_KEY=public-vapid
VITE_AUTH_CAPTCHA_PROVIDER=yandex-smartcaptcha
VITE_AUTH_CAPTCHA_SITE_KEY=public-captcha
VITE_AUTH_GATEWAY_URL=https://core.example.com/functions/v1/auth-gateway
SELFHOST_SERVICE_ROLE_KEY=private-service-role
VAPID_PRIVATE_KEY=private-vapid
`);

  const result = collectPublicAndroidBuildEnv(source, {
    commit: "abc123",
    version: "0.1.0",
  });

  assert.equal(result.VITE_SUPABASE_URL, "https://core.example.com");
  assert.equal(result.VITE_ACCESS_SNAPSHOT_RPC_ENABLED, "1");
  assert.equal(result.VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED, "1");
  assert.equal(result.VITE_APP_ENV, "production");
  assert.equal(result.VITE_APP_VERSION, "0.1.0");
  assert.equal(result.VITE_APP_COMMIT, "abc123");
  assert.equal(result.BASE_PATH, "/");
  assert.equal(result.PORT, "5173");
  assert.equal("SELFHOST_SERVICE_ROLE_KEY" in result, false);
  assert.equal("VAPID_PRIVATE_KEY" in result, false);
});

test("Android Vite and Capacitor children receive only platform settings and approved public values", () => {
  const publicEnv = {
    VITE_SUPABASE_URL: "https://core.example.com",
    VITE_SUPABASE_ANON_KEY: "public-anon",
    VITE_UNAPPROVED_SECRET: "must-not-forward",
  };
  const result = createAndroidBuildProcessEnv(
    {
      Path: "C:\\tools\\alternate",
      TEMP: "C:\\temp",
      TMP: "C:\\tmp",
      HOME: "C:\\Users\\builder",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      JAVA_HOME: "C:\\Java\\jdk",
      ANDROID_HOME: "C:\\Android\\sdk",
      ANDROID_SDK_ROOT: "C:\\Android\\sdk",
      GRADLE_USER_HOME: "C:\\gradle",
      CI: "1",
      FORCE_COLOR: "1",
      LANG: "en_US.UTF-8",
      VITE_UNAPPROVED_SECRET: "must-not-leak",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
      SUPABASE_ACCESS_TOKEN: "must-not-leak",
      LETSCUBE_ANDROID_STORE_PASSWORD: "must-not-leak",
      LETSCUBE_ANDROID_KEYSTORE_PATH: "C:\\secure\\release.p12",
      DATABASE_URL: "postgres://secret",
      PGPASSWORD: "database-password",
      GITHUB_PAT: "github-token",
      EXAMPLE_AUTHTOKEN: "arbitrary-token",
      HTTPS_PROXY: "https://user:password@proxy.example.com",
    },
    publicEnv,
  );

  assert.equal(result.PATH, "C:\\tools\\alternate");
  assert.equal(result.Path, undefined);
  assert.equal(result.TEMP, "C:\\temp");
  assert.equal(result.TMP, "C:\\tmp");
  assert.equal(result.HOME, "C:\\Users\\builder");
  assert.equal(result.SystemRoot, "C:\\Windows");
  assert.equal(result.ComSpec, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(result.JAVA_HOME, "C:\\Java\\jdk");
  assert.equal(result.ANDROID_HOME, "C:\\Android\\sdk");
  assert.equal(result.ANDROID_SDK_ROOT, "C:\\Android\\sdk");
  assert.equal(result.GRADLE_USER_HOME, "C:\\gradle");
  assert.equal(result.CI, "1");
  assert.equal(result.FORCE_COLOR, "1");
  assert.equal(result.LANG, "en_US.UTF-8");
  assert.equal(result.VITE_SUPABASE_URL, publicEnv.VITE_SUPABASE_URL);
  assert.equal(result.VITE_SUPABASE_ANON_KEY, publicEnv.VITE_SUPABASE_ANON_KEY);
  assert.equal(result.VITE_UNAPPROVED_SECRET, undefined);
  assert.equal(result.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(result.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(result.LETSCUBE_ANDROID_STORE_PASSWORD, undefined);
  assert.equal(result.LETSCUBE_ANDROID_KEYSTORE_PATH, undefined);
  assert.equal(result.DATABASE_URL, undefined);
  assert.equal(result.PGPASSWORD, undefined);
  assert.equal(result.GITHUB_PAT, undefined);
  assert.equal(result.EXAMPLE_AUTHTOKEN, undefined);
  assert.equal(result.HTTPS_PROXY, undefined);
});

test("Android production build rejects missing public Supabase settings", () => {
  assert.throws(
    () =>
      collectPublicAndroidBuildEnv(new Map(), {
        commit: "abc123",
        version: "0.1.0",
      }),
    /VITE_SUPABASE_URL/,
  );
});

test("Android phone activity stays in portrait orientation", () => {
  const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.match(manifest, /android:screenOrientation="portrait"/);
});

test("Android production debug build reads canonical release metadata", () => {
  assert.deepEqual(readAndroidReleaseMetadata(process.cwd()), {
    versionName: "0.1.3",
    versionCode: 4,
  });
});
