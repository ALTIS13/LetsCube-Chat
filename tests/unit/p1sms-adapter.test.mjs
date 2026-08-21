import assert from "node:assert/strict";
import test from "node:test";

import {
  P1SMS_ENDPOINT,
  P1SMS_TAG,
  SMS_MAX_LENGTH,
  buildP1SmsRequest,
  renderSmsOtp,
  sendP1Sms,
} from "../../supabase/functions/auth-send-sms/p1sms.mjs";
import { readSendSmsDestination } from "../../supabase/functions/auth-send-sms/hookPayload.mjs";

test("LETSCUBE p1sms OTP remains one short message", () => {
  const message = renderSmsOtp("123456");
  assert.equal(message, "LETSCUBE: код 123456. Никому его не сообщайте.");
  assert.equal(message.length, 46);
  assert.equal(SMS_MAX_LENGTH, 65);
  assert.ok(message.length <= SMS_MAX_LENGTH);
  assert.throws(() => renderSmsOtp("12345"), /invalid_otp/u);
});

test("p1sms request sends digit first and falls back to Telegram only after not_delivered", () => {
  const request = buildP1SmsRequest({
    apiKey: "private-api-key",
    phone: "+79991234567",
    message: renderSmsOtp("123456"),
  });
  const payload = JSON.parse(request.body);

  assert.equal(request.url, P1SMS_ENDPOINT);
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(request.url.includes("private-api-key"), false);
  assert.deepEqual(payload, {
    apiKey: "private-api-key",
    sms: [
      {
        channel: "digit",
        text: "LETSCUBE: код 123456. Никому его не сообщайте.",
        phone: "79991234567",
        tag: P1SMS_TAG,
        cascade: {
          schemeDetail: [
            {
              needStatus: "not_delivered",
              channel: "telegram_auth",
              smstemplate: {
                texts: ["LETSCUBE: код 123456. Никому его не сообщайте."],
              },
            },
          ],
        },
      },
    ],
  });
  assert.equal(payload.sms.length, 1);
  assert.equal("sender" in payload.sms[0], false);
  assert.equal("plannedAt" in payload.sms[0], false);
  assert.equal("cascadeSchemeId" in payload.sms[0], false);
  assert.equal("webhookUrl" in payload, false);
  assert.equal(
    payload.sms[0].cascade.schemeDetail.some((step) => step.needStatus === "delivered"),
    false,
  );
});

test("p1sms request rejects destinations outside the documented Russian 11-digit contract", () => {
  const message = renderSmsOtp("123456");
  assert.throws(
    () => buildP1SmsRequest({ apiKey: "key", phone: "+12025550123", message }),
    /invalid_sms_request/u,
  );
  assert.throws(
    () => buildP1SmsRequest({ apiKey: "key", phone: "79991234567", message }),
    /invalid_sms_request/u,
  );
});

test("phone-change delivery uses the explicit GoTrue sms.phone destination", () => {
  assert.equal(
    readSendSmsDestination(
      { phone: "+79990000001", new_phone: "+79990000002" },
      { phone: "79990000003" },
    ),
    "+79990000003",
  );
  assert.equal(
    readSendSmsDestination({ phone: "+79990000001" }, { phone: "invalid" }),
    null,
  );
});

test("legacy hook payload fallback prefers new_phone and rejects malformed destinations", () => {
  assert.equal(
    readSendSmsDestination({ phone: "+79990000001", new_phone: "+79990000002" }),
    "+79990000002",
  );
  assert.equal(readSendSmsDestination({ phone: "+79990000001" }), "+79990000001");
  assert.equal(readSendSmsDestination({ phone: "+79990000001", new_phone: "invalid" }), null);
});

test("provider-disabled p1sms adapter never contacts the network", async () => {
  let calls = 0;
  const result = await sendP1Sms(
    { enabled: false, apiKey: "private-api-key", phone: "+79991234567", otp: "123456" },
    async () => {
      calls += 1;
      throw new Error("network must not be called");
    },
  );

  assert.deepEqual(result, { ok: false, category: "disabled" });
  assert.equal(calls, 0);
});

test("p1sms adapter accepts only a successful single-message provider envelope", async () => {
  let redirect;
  const result = await sendP1Sms(
    { enabled: true, apiKey: "private-api-key", phone: "+79991234567", otp: "123456" },
    async (_url, init) => {
      redirect = init.redirect;
      return new Response(
        JSON.stringify({
          status: "success",
          data: [{ id: 370506708, status: "sent", phone: "79991234567" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.deepEqual(result, { ok: true, category: "accepted" });
  assert.equal(redirect, "error");
});

test("p1sms adapter maps provider failures without exposing the raw response", async () => {
  const result = await sendP1Sms(
    { enabled: true, apiKey: "private-api-key", phone: "+79991234567", otp: "123456" },
    async () =>
      new Response(JSON.stringify({ status: "error", message: "account-wide private detail" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  assert.deepEqual(result, { ok: false, category: "provider_rejected" });
  assert.equal(JSON.stringify(result).includes("account-wide private detail"), false);
});

test("p1sms adapter rejects an uncorrelated or oversized success response", async () => {
  const input = {
    enabled: true,
    apiKey: "private-api-key",
    phone: "+79991234567",
    otp: "123456",
  };
  const wrongDestination = await sendP1Sms(
    input,
    async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: [{ id: 370506708, status: "sent", phone: "79990000000" }],
        }),
        { status: 200 },
      ),
  );
  const missingId = await sendP1Sms(
    input,
    async () =>
      new Response(
        JSON.stringify({ status: "success", data: [{ status: "sent", phone: "79991234567" }] }),
        { status: 200 },
      ),
  );
  const oversized = await sendP1Sms(
    input,
    async () => new Response(JSON.stringify({ status: "success", padding: "x".repeat(40_000) })),
  );

  assert.deepEqual(wrongDestination, { ok: false, category: "provider_rejected" });
  assert.deepEqual(missingId, { ok: false, category: "provider_rejected" });
  assert.deepEqual(oversized, { ok: false, category: "provider_rejected" });
});

test("p1sms timeout is ambiguous and is never retried", async () => {
  let calls = 0;
  const result = await sendP1Sms(
    { enabled: true, apiKey: "private-api-key", phone: "+79991234567", otp: "123456" },
    async () => {
      calls += 1;
      throw new DOMException("request timed out", "TimeoutError");
    },
  );

  assert.deepEqual(result, { ok: false, category: "timeout_unknown" });
  assert.equal(calls, 1);
});

test("p1sms delivery can continue after the Auth hook acknowledges the request", async () => {
  const adapter = await import("../../supabase/functions/auth-send-sms/p1sms.mjs");
  assert.equal(typeof adapter.scheduleP1SmsDelivery, "function");

  let finishResult;
  let releaseDelivery;
  let trackedTask;
  const pendingDelivery = new Promise((resolve) => {
    releaseDelivery = resolve;
  });

  adapter.scheduleP1SmsDelivery({
    waitUntil(task) {
      trackedTask = task;
    },
    deliver: () => pendingDelivery,
    finish: async (result) => {
      finishResult = result;
    },
  });

  assert.ok(trackedTask instanceof Promise);
  assert.equal(finishResult, undefined);

  releaseDelivery({ ok: true, category: "accepted" });
  await trackedTask;
  assert.deepEqual(finishResult, { ok: true, category: "accepted" });
});

test("p1sms background request has a bounded provider timeout", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../../supabase/functions/auth-send-sms/p1sms.mjs", import.meta.url), "utf8"),
  );
  const timeout = source.match(/AbortSignal\.timeout\(([\d_]+)\)/u);
  assert.ok(timeout, "adapter must bound the provider request");
  const timeoutMs = Number(timeout[1].replaceAll("_", ""));
  assert.ok(timeoutMs >= 10_000);
  assert.ok(timeoutMs <= 20_000);
});
