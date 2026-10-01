import assert from "node:assert/strict";
import test from "node:test";
import { PHONE_FIND_DEFAULT, PHONE_FIND_OPTIONS, isPhoneFindableBy, phoneFindSummary, phoneFindNote } from "../../artifacts/kub/src/lib/phoneFindability.ts";
import { normalizePhoneSearchQuery } from "../../artifacts/kub/src/lib/phoneSearch.ts";

test("the phone privacy defaults and choices have only the approved answers", () => {
  assert.equal(PHONE_FIND_DEFAULT, "everybody");
  assert.deepEqual(PHONE_FIND_OPTIONS.map((option) => option.id), ["everybody", "contacts"]);
  assert.equal(phoneFindSummary("contacts"), "Мои контакты");
  assert.equal(isPhoneFindableBy("contacts"), true);
  for (const value of [null, undefined, true, "unknown", "friends"]) assert.equal(isPhoneFindableBy(value), false);
});

test("the note does not pretend an unverified number is searchable", () => {
  assert.match(phoneFindNote({ verified: false }), /Пока номер не подтверждён/);
  assert.doesNotMatch(phoneFindNote({ verified: true }), /Пока номер/);
  assert.doesNotMatch(phoneFindNote({ verified: null }), /Пока номер/);
});

test("normalization rejects malformed input and does not guess a country for local numbers", () => {
  for (const value of ["", "+", "7999", "9991234567", "phone +79991234567", "+09991234567", "++79991234567", "+7999123456789012"])
    assert.equal(normalizePhoneSearchQuery(value), null);
  assert.equal(normalizePhoneSearchQuery("8 (999) 123-45-67"), "+79991234567");
  assert.equal(normalizePhoneSearchQuery("+44 7700 900123"), "+447700900123");
});
