import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeInviteCode,
  shouldSendInviteCode,
  shouldValidateInviteGate,
} from "../../supabase/functions/auth-yandex-gateway/inviteCode.mjs";

test("normalizes invite codes to uppercase compact tokens", () => {
  assert.equal(normalizeInviteCode(" letscube-staff_01 "), "LETSCUBE-STAFF_01");
  assert.equal(normalizeInviteCode("abc 123"), "ABC123");
});

test("rejects empty, overlong and unsafe invite code values", () => {
  assert.equal(normalizeInviteCode(""), null);
  assert.equal(normalizeInviteCode("   "), null);
  assert.equal(normalizeInviteCode("ABC"), null);
  assert.equal(normalizeInviteCode("a".repeat(65)), null);
  assert.equal(normalizeInviteCode("ABC<script>"), null);
  assert.equal(normalizeInviteCode({ code: "ABC" }), null);
});

test("only signup payloads may send invite codes", () => {
  assert.equal(shouldSendInviteCode("signup", "STAFF-2026"), true);
  assert.equal(shouldSendInviteCode("recovery", "STAFF-2026"), false);
  assert.equal(shouldSendInviteCode("signup", null), false);
});

test("only signup payloads validate the invite gate", () => {
  assert.equal(shouldValidateInviteGate("signup"), true);
  assert.equal(shouldValidateInviteGate("recovery"), false);
});
