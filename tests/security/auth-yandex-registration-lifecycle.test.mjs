import assert from "node:assert/strict";
import test from "node:test";

import {
  lifecycleKind,
  lifecycleRpcBody,
  normalizeLifecycleUserId,
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
