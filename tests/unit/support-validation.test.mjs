import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSupportPhone,
  validateSupportRequest,
} from "../../artifacts/kub/src/lib/support/validation.ts";
import { getSupportErrorMessage } from "../../artifacts/kub/src/lib/support/errors.ts";

const VALID_REQUEST = {
  fullName: "  Анна   Иванова ",
  email: " ANNA@example.test ",
  phone: "+7 (999) 123-45-67",
  category: "technical",
  subject: "Не открывается переписка",
  message: "После входа приложение не загружает историю сообщений.",
  privacyAccepted: true,
  privacyVersion: "2026-07-27",
  captchaToken: "captcha-token",
  website: "",
  formStartedAt: Date.now() - 5_000,
};

test("support request validation normalizes bounded contact fields", () => {
  const result = validateSupportRequest(VALID_REQUEST, { now: () => Date.now() });

  assert.equal(result.ok, true);
  assert.equal(result.value.fullName, "Анна Иванова");
  assert.equal(result.value.email, "anna@example.test");
  assert.equal(result.value.phone, "+79991234567");
  assert.equal(result.value.category, "technical");
});

test("support phone normalization requires E.164 with a country code", () => {
  assert.equal(normalizeSupportPhone("+7 (999) 123-45-67"), "+79991234567");
  assert.equal(normalizeSupportPhone("8 999 123-45-67"), null);
  assert.equal(normalizeSupportPhone("+12"), null);
  assert.equal(normalizeSupportPhone("+1234567890123456"), null);
});

test("support request rejects missing consent, captcha, bots, and instant submits", () => {
  const missingConsent = validateSupportRequest(
    { ...VALID_REQUEST, privacyAccepted: false },
    { now: () => Date.now() },
  );
  assert.equal(missingConsent.ok, false);
  assert.equal(missingConsent.fields.privacyAccepted, "Подтвердите согласие с Политикой конфиденциальности.");

  const missingCaptcha = validateSupportRequest(
    { ...VALID_REQUEST, captchaToken: "" },
    { now: () => Date.now() },
  );
  assert.equal(missingCaptcha.ok, false);
  assert.equal(missingCaptcha.fields.captchaToken, "Подтвердите, что запрос отправляет человек.");

  const honeypot = validateSupportRequest(
    { ...VALID_REQUEST, website: "https://spam.example" },
    { now: () => Date.now() },
  );
  assert.equal(honeypot.ok, false);
  assert.equal(honeypot.formError, "Не удалось отправить обращение.");

  const tooFast = validateSupportRequest(
    { ...VALID_REQUEST, formStartedAt: Date.now() - 200 },
    { now: () => Date.now() },
  );
  assert.equal(tooFast.ok, false);
  assert.equal(tooFast.formError, "Подождите несколько секунд и отправьте обращение снова.");
});

test("support request rejects invalid and oversized values with friendly field errors", () => {
  const result = validateSupportRequest(
    {
      ...VALID_REQUEST,
      fullName: "A",
      email: "not-an-email",
      phone: "89991234567",
      category: "unknown",
      subject: "Нет",
      message: "Коротко",
      privacyVersion: "",
    },
    { now: () => Date.now() },
  );

  assert.equal(result.ok, false);
  for (const field of [
    "fullName",
    "email",
    "phone",
    "category",
    "subject",
    "message",
    "privacyVersion",
  ]) {
    assert.ok(result.fields[field], `${field} must have a friendly error`);
  }
});

test("support gateway errors never expose raw backend details", () => {
  assert.equal(
    getSupportErrorMessage("rate_limited"),
    "Слишком много обращений. Подождите и попробуйте позже.",
  );
  assert.equal(
    getSupportErrorMessage("support_closed"),
    "Приём новых обращений временно приостановлен.",
  );
  assert.equal(
    getSupportErrorMessage('PGRST301: relation "support_tickets" does not exist'),
    "Не удалось выполнить операцию. Попробуйте позже.",
  );
});
