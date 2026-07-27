import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVACY_POLICY,
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_VERSION,
} from "../../artifacts/kub/src/content/privacyPolicy.ts";

const policyText = JSON.stringify(PRIVACY_POLICY);

test("privacy policy publishes a stable version and operator identity", () => {
  assert.match(PRIVACY_POLICY_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(PRIVACY_POLICY_EFFECTIVE_DATE.length > 0);
  assert.match(policyText, /ООО «КУБ»/);
  assert.match(policyText, /3666275395/);
  assert.match(policyText, /1253600009630/);
  assert.match(policyText, /394033/);
  assert.match(policyText, /ул\. Димитрова, д\. 51\/3, офис 3/);
  assert.match(policyText, /Панков Никита Юрьевич/);
  assert.match(policyText, /privacy@app\.letscube\.ru/);
  assert.match(policyText, /support@app\.letscube\.ru/);
});

test("privacy policy covers every material LETSCUBE processing flow", () => {
  for (const requiredText of [
    "учётной записи",
    "сообщени",
    "вложени",
    "голосов",
    "видеозапис",
    "геолокац",
    "push",
    "технической поддержки",
    "Yandex SmartCaptcha",
    "Firebase Cloud Messaging",
    "Windows Push Notification Services",
    "не прода",
    "Российской Федерации",
  ]) {
    assert.ok(
      policyText.toLocaleLowerCase("ru").includes(requiredText.toLocaleLowerCase("ru")),
      `privacy policy must mention ${requiredText}`,
    );
  }
});

test("privacy policy states retention, rights, minors, and deletion controls", () => {
  for (const requiredText of [
    "14 лет",
    "законного представителя",
    "30 дней",
    "12 месяцев",
    "3 года",
    "90 дней",
    "исправлен",
    "удален",
    "отозвать согласие",
    "Роскомнадзор",
  ]) {
    assert.ok(
      policyText.toLocaleLowerCase("ru").includes(requiredText.toLocaleLowerCase("ru")),
      `privacy policy must mention ${requiredText}`,
    );
  }
});

test("privacy policy has unique navigable sections", () => {
  assert.ok(PRIVACY_POLICY.sections.length >= 12);
  const sectionIds = PRIVACY_POLICY.sections.map((section) => section.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length);
  for (const section of PRIVACY_POLICY.sections) {
    assert.match(section.id, /^[a-z0-9-]+$/);
    assert.ok(section.title.trim().length > 0);
    assert.ok(section.blocks.length > 0);
  }
});
