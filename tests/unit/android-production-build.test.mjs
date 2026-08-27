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

test("Android child processes drop inherited secrets and unapproved Vite settings", () => {
  const publicEnv = {
    VITE_SUPABASE_URL: "https://core.example.com",
    VITE_SUPABASE_ANON_KEY: "public-anon",
  };
  const result = createAndroidBuildProcessEnv(
    {
      PATH: "C:\\tools",
      TEMP: "C:\\temp",
      VITE_UNAPPROVED_SECRET: "must-not-leak",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
      SUPABASE_ACCESS_TOKEN: "must-not-leak",
      LETSCUBE_ANDROID_STORE_PASSWORD: "must-not-leak",
    },
    publicEnv,
  );

  assert.equal(result.PATH, "C:\\tools");
  assert.equal(result.TEMP, "C:\\temp");
  assert.equal(result.VITE_SUPABASE_URL, publicEnv.VITE_SUPABASE_URL);
  assert.equal(result.VITE_SUPABASE_ANON_KEY, publicEnv.VITE_SUPABASE_ANON_KEY);
  assert.equal(result.VITE_UNAPPROVED_SECRET, undefined);
  assert.equal(result.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(result.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(result.LETSCUBE_ANDROID_STORE_PASSWORD, undefined);
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
    versionName: "0.1.2",
    versionCode: 3,
  });
});
