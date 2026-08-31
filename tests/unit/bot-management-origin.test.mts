import assert from "node:assert/strict";
import test from "node:test";

import { resolveBotManagementOrigin } from "../../artifacts/kub/src/lib/botManagementOrigin.ts";

test("bot management origin requires HTTPS outside explicit local QA hosts", () => {
  for (const origin of [
    "https://api.letscube.ru",
    "https://qa.example.test:8443",
    "http://localhost:5173",
    "http://127.0.0.1:54322",
  ]) {
    assert.equal(resolveBotManagementOrigin(origin), origin);
  }

  for (const value of [
    "http://api.letscube.ru",
    "http://localhost.attacker.example",
    "http://127.0.0.2:54322",
    "http://[::1]:54322",
    "https://api.letscube.ru/path",
    "https://user@example.test",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => resolveBotManagementOrigin(value), /bot_management_origin_invalid/);
  }
});
