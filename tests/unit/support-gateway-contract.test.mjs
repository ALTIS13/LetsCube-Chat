import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../supabase/functions/support-gateway/index.ts", import.meta.url),
  "utf8",
);

test("support gateway keeps privileged credentials in the Edge Function", () => {
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /SUPPORT_GUEST_SECRET_HMAC_KEY/);
  assert.match(source, /YANDEX_SMARTCAPTCHA_SECRET/);
  assert.match(source, /crypto\.subtle/);
  assert.doesNotMatch(source, /VITE_/);
});

test("support gateway validates CAPTCHA and handles the public ticket routes", () => {
  assert.match(source, /smartcaptcha\.cloud\.yandex\.ru\/validate/);
  assert.match(source, /path\[0\]\s*===\s*"tickets"/);
  assert.match(source, /path\[2\]\s*===\s*"messages"/);
  assert.match(source, /x-letscube-support-secret/i);
  assert.match(source, /support_guest_ticket_create/);
  assert.match(source, /support_guest_message_create/);
});

test("support gateway converts unexpected failures into a sanitized response", () => {
  assert.match(source, /async function handleRequest/);
  assert.match(source, /catch\s*\{/);
  assert.match(source, /error:\s*"service_unavailable"/);
});

test("support gateway has allowlisted CORS and does not emit raw private values", () => {
  assert.match(source, /SUPPORT_ALLOWED_ORIGINS/);
  assert.doesNotMatch(source, /access-control-allow-origin["']?\s*[:,]\s*["']\*/i);
  assert.doesNotMatch(source, /console\.(log|debug)\s*\(/);
  assert.doesNotMatch(source, /JSON\.stringify\([^)]*(secret|token|email|phone)/i);
});

test("support gateway projects bounded public ticket fields", () => {
  assert.match(source, /publicReference/);
  assert.match(source, /authorType/);
  assert.match(source, /absoluteExpiresAt/);
  assert.match(source, /idleExpiresAt/);
  assert.doesNotMatch(source, /select\(["'`]\*["'`]\)/);
});
