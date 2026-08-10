import assert from "node:assert/strict";
import test from "node:test";

import {
  SMS_MAX_LENGTH,
  buildSmsRuRequest,
  renderSmsOtp,
  sendSmsRu,
} from "../../supabase/functions/auth-send-sms/smsRu.mjs";

test("LETSCUBE SMS OTP remains one short message", () => {
  const message = renderSmsOtp("123456");
  assert.equal(message, "LETSCUBE: код 123456. Никому его не сообщайте.");
  assert.equal(message.length, 46);
  assert.equal(SMS_MAX_LENGTH, 65);
  assert.ok(message.length <= SMS_MAX_LENGTH);
  assert.throws(() => renderSmsOtp("12345"), /invalid_otp/u);
});

test("SMS.RU request keeps credentials and message out of the URL", () => {
  const request = buildSmsRuRequest({
    apiId: "private-api-id",
    phone: "+79991234567",
    message: renderSmsOtp("123456"),
  });

  assert.equal(request.url, "https://sms.ru/sms/send");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded;charset=UTF-8");
  assert.equal(request.url.includes("private-api-id"), false);
  assert.equal(request.url.includes("+79991234567"), false);
});

test("provider-disabled SMS adapter never contacts the network", async () => {
  let calls = 0;
  const result = await sendSmsRu(
    {
      enabled: false,
      apiId: "private-api-id",
      phone: "+79991234567",
      otp: "123456",
    },
    async () => {
      calls += 1;
      throw new Error("network must not be called");
    },
  );

  assert.deepEqual(result, { ok: false, category: "disabled" });
  assert.equal(calls, 0);
});
