import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthGatewayRedirect } from "../../artifacts/kub/src/lib/authGatewayRedirect.mjs";
import {
  lifecycleKind,
  lifecycleRpcBody,
  normalizeLifecycleUserId,
  resendSignupAndExtend,
} from "../../supabase/functions/auth-yandex-gateway/registrationLifecycle.mjs";

test("invite presence selects invite lifecycle", () => {
  assert.equal(lifecycleKind("STAFF-2026"), "invite");
  assert.equal(lifecycleKind(null), "public");
});

test("only UUID auth response ids are accepted", () => {
  assert.equal(
    normalizeLifecycleUserId({ id: "5f36f4ea-4696-4d5f-b2d8-c760ad6ddff8" }),
    "5f36f4ea-4696-4d5f-b2d8-c760ad6ddff8",
  );
  assert.equal(normalizeLifecycleUserId({ id: "not-a-user" }), null);
});

test("RPC body never carries plaintext email or invite code", () => {
  const body = lifecycleRpcBody("5f36f4ea-4696-4d5f-b2d8-c760ad6ddff8", "invite", "ABCDEF");
  assert.equal("email" in body, false);
  assert.equal(JSON.stringify(body).includes("ABCDEF"), false);
});

test("explicit resend redirect takes precedence over the callback fallback", () => {
  let fallbackCalls = 0;
  const fallback = () => {
    fallbackCalls += 1;
    return "https://app.example.test/callback";
  };

  assert.equal(
    resolveAuthGatewayRedirect("https://app.example.test/confirm", fallback),
    "https://app.example.test/confirm",
  );
  assert.equal(fallbackCalls, 0);
  assert.equal(
    resolveAuthGatewayRedirect(undefined, fallback),
    "https://app.example.test/callback",
  );
  assert.equal(fallbackCalls, 1);
});

test("successful signup resend extends the registration lifecycle once", async () => {
  const calls = [];
  const result = await resendSignupAndExtend({
    supabaseUrl: "https://project.example.test",
    supabaseKey: "public-test-key",
    serviceRoleKey: "service-role-test-key",
    email: "member@example.test",
    redirectTo: "https://app.example.test/confirm",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    },
    log: () => assert.fail("a successful resend must not log"),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://project.example.test/auth/v1/resend");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    type: "signup",
    email: "member@example.test",
    options: { emailRedirectTo: "https://app.example.test/confirm" },
  });
  assert.equal(
    calls[1].url,
    "https://project.example.test/rest/v1/rpc/registration_lifecycle_extend_by_email_internal",
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_email: "member@example.test" });
});

test("failed signup resend does not extend the registration lifecycle", async () => {
  let calls = 0;
  const result = await resendSignupAndExtend({
    supabaseUrl: "https://project.example.test",
    supabaseKey: "public-test-key",
    serviceRoleKey: "service-role-test-key",
    email: "member@example.test",
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"message":"auth-response-secret"}', { status: 400 });
    },
    log: () => assert.fail("an Auth resend failure must not be logged by the lifecycle helper"),
  });

  assert.deepEqual(result, { ok: false, status: 400 });
  assert.equal(calls, 1);
});

test("lifecycle resend failure keeps generic success and logs no sensitive values", async () => {
  const logs = [];
  let calls = 0;
  const result = await resendSignupAndExtend({
    supabaseUrl: "https://project.example.test",
    supabaseKey: "public-test-key",
    serviceRoleKey: "service-role-test-key",
    email: "member@example.test",
    captchaToken: "captcha-secret",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response('{"auth":"auth-response-secret"}', { status: 200 })
        : new Response('{"code":"PGRST202","message":"lifecycle-response-secret"}', {
            status: 500,
          });
    },
    log: (...args) => logs.push(args),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(logs, [
    ["auth-yandex-gateway lifecycle extension failed", { status: 500, code: "PGRST202" }],
  ]);
  assert.doesNotMatch(
    JSON.stringify({ result, logs }),
    /member@example\.test|captcha-secret|service-role-test-key|p_email|auth-response-secret|lifecycle-response-secret/u,
  );
});
