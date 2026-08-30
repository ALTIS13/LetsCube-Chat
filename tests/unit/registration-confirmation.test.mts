import assert from "node:assert/strict";
import test from "node:test";
import { maskRegistrationEmail } from "../../artifacts/kub/src/lib/registrationConfirmation.ts";

test("registration email mask keeps enough context without echoing the full address", () => {
  assert.equal(maskRegistrationEmail("seraltis13@gmail.com"), "s***3@gmail.com");
  assert.equal(maskRegistrationEmail("a@x.ru"), "a***@x.ru");
  assert.equal(maskRegistrationEmail("invalid"), "");
});
