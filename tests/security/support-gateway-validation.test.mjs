import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGuestMessage,
  normalizeSupportTicketRequest,
} from "../../supabase/functions/support-gateway/validation.mjs";

const NOW = 1_785_131_200_000;

test("support gateway independently normalizes a valid public ticket request", () => {
  const result = normalizeSupportTicketRequest(
    {
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
      formStartedAt: NOW - 5_000,
    },
    { now: () => NOW },
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.fullName, "Анна Иванова");
  assert.equal(result.value.email, "anna@example.test");
  assert.equal(result.value.phone, "+79991234567");
  assert.equal(result.value.category, "technical");
});

test("support gateway blocks honeypots, instant submits, and invalid policy versions", () => {
  assert.equal(
    normalizeSupportTicketRequest(
      validBody({ website: "https://bot.example" }),
      { now: () => NOW },
    ).error,
    "invalid_request",
  );
  assert.equal(
    normalizeSupportTicketRequest(
      validBody({ formStartedAt: NOW - 100 }),
      { now: () => NOW },
    ).error,
    "invalid_request",
  );
  assert.equal(
    normalizeSupportTicketRequest(
      validBody({ privacyVersion: "latest" }),
      { now: () => NOW },
    ).error,
    "invalid_request",
  );
});

test("support gateway rejects oversized fields and never accepts client-supplied identity fields", () => {
  const result = normalizeSupportTicketRequest(
    validBody({
      subject: "x".repeat(121),
      userId: "attacker-selected-user",
      assignedTo: "attacker-selected-operator",
      status: "closed",
    }),
    { now: () => NOW },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_request");
});

test("guest message validation accepts bounded text only", () => {
  assert.deepEqual(normalizeGuestMessage({ body: "  Нужна дополнительная помощь.  " }), {
    ok: true,
    value: "Нужна дополнительная помощь.",
  });
  assert.deepEqual(normalizeGuestMessage({ body: "" }), {
    ok: false,
    error: "invalid_request",
  });
  assert.deepEqual(normalizeGuestMessage({ body: "x".repeat(4_001) }), {
    ok: false,
    error: "message_too_long",
  });
  assert.deepEqual(normalizeGuestMessage({ body: "text", attachmentUrl: "https://private.example" }), {
    ok: false,
    error: "invalid_request",
  });
});

function validBody(overrides = {}) {
  return {
    fullName: "Анна Иванова",
    email: "anna@example.test",
    phone: "+79991234567",
    category: "technical",
    subject: "Не открывается переписка",
    message: "После входа приложение не загружает историю сообщений.",
    privacyAccepted: true,
    privacyVersion: "2026-07-27",
    captchaToken: "captcha-token",
    website: "",
    formStartedAt: NOW - 5_000,
    ...overrides,
  };
}
