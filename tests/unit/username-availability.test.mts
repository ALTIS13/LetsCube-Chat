// Whether a никнейм is free, while it is being typed (D-132, settings-profile C4).
//
// C4 asked for a taken name to be caught where it is typed. It was not, and the
// note explaining why said `profiles` hides a banned account's row from
// everybody else. Read again on production on 2026-09-14, that restrictive
// policy is `(NOT is_banned(uid())) OR (id = uid())` — it restricts what a
// **banned caller** reads, not what anybody reads about a banned account. So the
// lookup is possible after all, and these are the states the field can be in.
import assert from "node:assert/strict";
import test from "node:test";

import {
  usernameAvailability,
  usernameAvailabilityNote,
} from "../../artifacts/kub/src/lib/profileValidation.ts";

const base = {
  value: "olga",
  ruleError: null as string | null,
  current: "maks" as string | null | undefined,
  checking: false,
  taken: null as boolean | null,
};

test("an empty field asks nothing and says nothing", () => {
  assert.equal(usernameAvailability({ ...base, value: "" }), "idle");
  assert.equal(usernameAvailability({ ...base, value: "   " }), "idle");
  assert.equal(usernameAvailabilityNote("idle"), null);
});

test("a name that breaks its own rules is not looked up", () => {
  // Asking the server about «привет!» spends a request to be told what
  // `validateUsername` already said.
  const state = usernameAvailability({ ...base, ruleError: "Недопустимые символы", checking: true });
  assert.equal(state, "invalid");
  assert.equal(usernameAvailabilityNote(state), null, "the rule error is the field's own line");
});

test("the name you already hold is yours, not «занято»", () => {
  // The case that makes a working field look broken: telling somebody their own
  // никнейм is taken.
  assert.equal(usernameAvailability({ ...base, value: "maks", current: "maks" }), "mine");
  assert.equal(usernameAvailability({ ...base, value: " maks ", current: "maks" }), "mine");
  assert.equal(usernameAvailability({ ...base, value: "@maks", current: "maks" }), "mine");
  assert.equal(usernameAvailabilityNote("mine"), null);

  // **Case is not folded, because the database does not fold it.**
  // `profiles_username_key` is `btree(username)` on plain `text`, read off
  // production on 2026-09-14 — so «MAKS» and «maks» really are two names, and a
  // rule that treated them as one would tell somebody their own никнейм was
  // free when it is somebody else's to take.
  assert.notEqual(usernameAvailability({ ...base, value: "MAKS", current: "maks" }), "mine");
});

test("a lookup in flight says so, and a finished one says what it found", () => {
  assert.equal(usernameAvailability({ ...base, checking: true }), "checking");
  assert.deepEqual(usernameAvailabilityNote("checking"), { text: "Проверяем…", tone: "muted" });

  assert.equal(usernameAvailability({ ...base, taken: true }), "taken");
  assert.deepEqual(usernameAvailabilityNote("taken"), {
    text: "Это имя пользователя уже занято.",
    tone: "danger",
  });

  assert.equal(usernameAvailability({ ...base, taken: false }), "free");
  assert.deepEqual(usernameAvailabilityNote("free"), { text: "Свободно", tone: "muted" });
});

test("a lookup that never answered says nothing at all", () => {
  // A refused or failed request must not read as «Свободно»: an empty result
  // means "I do not know", and the field stays quiet rather than encouraging a
  // save that will fail.
  assert.equal(usernameAvailability({ ...base, taken: null, checking: false }), "idle");
});

test("a stale answer is not worn by a newer name", () => {
  // The caller attaches an answer to the value it was asked about; this is the
  // shape of that contract. Typing `an`, `ann`, `anna` must not leave `anna`
  // wearing the verdict on `ann`.
  const stale = usernameAvailability({ ...base, value: "anna", taken: null, checking: true });
  assert.equal(stale, "checking");
});
