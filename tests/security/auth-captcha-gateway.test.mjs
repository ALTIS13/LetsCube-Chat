import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  resolveCaptchaVerificationConfig,
  verifyCaptchaToken,
} from "../../supabase/functions/auth-yandex-gateway/captchaProvider.mjs";

const root = new URL("../../", import.meta.url);

async function source(file) {
  return readFile(new URL(file, root), "utf8");
}

test("legacy requests without a provider keep the Yandex server default", () => {
  assert.deepEqual(
    resolveCaptchaVerificationConfig({
      requestedProvider: undefined,
      configuredProvider: undefined,
      yandexSecret: "server-yandex-secret",
      turnstileSecret: undefined,
    }),
    {
      ok: true,
      provider: "yandex-smartcaptcha",
      secret: "server-yandex-secret",
    },
  );
});

test("legacy Yandex requests do not switch verifier when Turnstile is configured", () => {
  assert.deepEqual(
    resolveCaptchaVerificationConfig({
      requestedProvider: undefined,
      configuredProvider: "turnstile",
      yandexSecret: "server-yandex-secret",
      turnstileSecret: "server-turnstile-secret",
    }),
    {
      ok: true,
      provider: "yandex-smartcaptcha",
      secret: "server-yandex-secret",
    },
  );
});

test("the requested provider must match server configuration and secret", () => {
  assert.deepEqual(
    resolveCaptchaVerificationConfig({
      requestedProvider: "turnstile",
      configuredProvider: "yandex-smartcaptcha",
      yandexSecret: "server-yandex-secret",
      turnstileSecret: "server-turnstile-secret",
    }),
    { ok: false, error: "not_configured", status: 500 },
  );
  assert.deepEqual(
    resolveCaptchaVerificationConfig({
      requestedProvider: "turnstile",
      configuredProvider: "turnstile",
      yandexSecret: undefined,
      turnstileSecret: undefined,
    }),
    { ok: false, error: "not_configured", status: 500 },
  );
  assert.deepEqual(
    resolveCaptchaVerificationConfig({
      requestedProvider: "unsupported",
      configuredProvider: "turnstile",
      yandexSecret: undefined,
      turnstileSecret: "server-turnstile-secret",
    }),
    { ok: false, error: "captcha_failed", status: 400 },
  );
});

test("Turnstile is verified server-side without exposing its secret", async () => {
  const calls = [];
  const result = await verifyCaptchaToken({
    requestedProvider: "turnstile",
    configuredProvider: "turnstile",
    yandexSecret: undefined,
    turnstileSecret: "server-turnstile-secret",
    token: "browser-turnstile-token",
    ip: "203.0.113.8",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"success":true}', { status: 200 });
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("secret"), "server-turnstile-secret");
  assert.equal(body.get("response"), "browser-turnstile-token");
  assert.equal(body.get("remoteip"), "203.0.113.8");
  assert.doesNotMatch(JSON.stringify(result), /secret|browser-turnstile-token/u);
});

test("signup, resend and recovery have no direct Supabase Auth fallback", async () => {
  const [captcha, gateway, register, login, opsReport] = await Promise.all([
    source("artifacts/kub/src/lib/authCaptcha.ts"),
    source("artifacts/kub/src/lib/authGateway.ts"),
    source("artifacts/kub/src/components/auth/RegisterForm.tsx"),
    source("artifacts/kub/src/components/auth/LoginForm.tsx"),
    source("artifacts/kub/src/pages/admin/OpsReportTab.tsx"),
  ]);

  assert.match(captcha, /getAuthCaptchaUnavailableMessage/);
  assert.match(gateway, /captchaProvider/);
  assert.match(register, /captchaProvider/);
  assert.match(login, /captchaProvider/);
  assert.doesNotMatch(register, /\.auth\.signUp\s*\(/);
  assert.doesNotMatch(login, /\.auth\.resetPasswordForEmail\s*\(/);
  assert.doesNotMatch(register, /shouldUseAuthCaptchaGateway/);
  assert.doesNotMatch(login, /shouldUseAuthCaptchaGateway/);
  assert.doesNotMatch(opsReport, /прямая ветка авторизации/u);
});
