import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPublicAndroidBuildEnv,
  parseEnvText,
} from "../../scripts/build-android-production.mjs";

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
