// Nothing typed and unsaved may be discarded silently.
//
// D-136: the personal settings screen threw away a typed «Имя», «Никнейм» or
// «О себе» on ✕, «Закрыть», Escape and a click on the backdrop, without asking
// — on a screen where every other control saves as it is flipped, so half of
// what a person did really had been kept. D-164 had already answered the same
// question one surface over, for a group's name and description.
//
// The rule is one module now rather than two copies. What is pinned here is the
// part that would rot quietly: which differences count as an edit, and that the
// save's own normaliser is applied to **both** sides — normalising only what is
// on screen would raise a question about a change the save would erase.

import assert from "node:assert/strict";
import test from "node:test";

import { chatProfileDirty } from "../../artifacts/kub/src/lib/chatSettings.ts";
import {
  PROFILE_LIMITS,
  normalizeBio,
  normalizeFullName,
  profileDraftDirty,
  type ProfileDraft,
} from "../../artifacts/kub/src/lib/profileValidation.ts";
import { fieldEdited, hasUnsavedEdits } from "../../artifacts/kub/src/lib/unsavedEdits.ts";

const draft = (over: Partial<ProfileDraft> = {}): ProfileDraft => ({
  fullName: "Максим Орлов",
  username: "maks",
  bio: "Собираю интерфейсы",
  ...over,
});

test("a field nobody touched is not an edit, and one typed into is", () => {
  assert.equal(fieldEdited({ saved: "Максим Орлов", edited: "Максим Орлов" }), false);
  assert.equal(fieldEdited({ saved: "Максим Орлов", edited: "Максим Орлов-Тестов" }), true);
});

test("whitespace is not an edit, and emptying a field is", () => {
  // A trailing space nobody meant to type must not raise a question somebody
  // then has to answer.
  assert.equal(fieldEdited({ saved: "Максим Орлов", edited: "Максим Орлов " }), false);
  assert.equal(fieldEdited({ saved: "  ", edited: "" }), false);
  assert.equal(fieldEdited({ saved: "Собираю интерфейсы", edited: "" }), true);
});

test("the normaliser is applied to the saved side too", () => {
  // The half that would break silently. With it applied only to what is on
  // screen, a name retyped with a double space reads as an edit, and leaving
  // the screen asks about a change the save itself would collapse.
  const doubled = { saved: "Максим Орлов", edited: "Максим  Орлов" };
  assert.equal(fieldEdited({ ...doubled, normalize: normalizeFullName }), false);
  assert.equal(fieldEdited(doubled), true, "trimming alone does not collapse an inner run of spaces");
});

test("one edited field out of several is enough to have to ask", () => {
  assert.equal(
    hasUnsavedEdits([
      { saved: "a", edited: "a" },
      { saved: "b", edited: "b" },
    ]),
    false,
  );
  assert.equal(
    hasUnsavedEdits([
      { saved: "a", edited: "a" },
      { saved: "b", edited: "c" },
    ]),
    true,
  );
  assert.equal(hasUnsavedEdits([]), false, "a screen holding no text can always be left");
});

test("the profile draft is the three fields «Сохранить» holds back", () => {
  const saved = draft();
  assert.equal(profileDraftDirty(saved, draft()), false);
  assert.equal(profileDraftDirty(saved, draft({ fullName: "Максим Орлов-Тестов" })), true);
  assert.equal(profileDraftDirty(saved, draft({ username: "maks2" })), true);
  assert.equal(profileDraftDirty(saved, draft({ bio: "" })), true, "clearing «О себе» is an edit too");
});

test("the profile asks only about what the save would really write", () => {
  const saved = draft();
  // Each of these three is the field's own normaliser, not a trim: the save
  // collapses runs of spaces in a name, strips «@» and anything outside
  // [A-Za-z0-9_.] from a никнейм, and cuts «О себе» to its limit.
  assert.equal(profileDraftDirty(saved, draft({ fullName: "Максим  Орлов " })), false);
  assert.equal(profileDraftDirty(saved, draft({ username: "@maks" })), false);
  assert.equal(profileDraftDirty(saved, draft({ username: "maks!" })), false);
  const atTheLimit = "я".repeat(PROFILE_LIMITS.bioMax);
  assert.equal(normalizeBio(atTheLimit + "ещё").length, PROFILE_LIMITS.bioMax);
  assert.equal(
    profileDraftDirty(draft({ bio: atTheLimit }), draft({ bio: atTheLimit + "ещё" })),
    false,
    "typing past the limit adds nothing that would be stored",
  );
});

test("a profile with nothing in it can be left alone", () => {
  // What the screen passes when the record carries nulls: it turns each into
  // «», and an untouched screen must not ask on the way out.
  const empty = draft({ fullName: "", username: "", bio: "" });
  assert.equal(profileDraftDirty(empty, draft({ fullName: "", username: "", bio: "" })), false);
  assert.equal(profileDraftDirty(empty, draft({ fullName: "Максим" })), true);
});

test("the group's name and description still answer as they did", () => {
  // `chatProfileDirty` is a call into the shared rule now rather than its own
  // comparison (D-164 wrote it first). Its contract is unchanged, which is the
  // point of sharing rather than rewriting.
  const saved = { name: "Команда", description: "Проект витрины" };
  assert.equal(chatProfileDirty(saved, { ...saved }), false);
  assert.equal(chatProfileDirty(saved, { ...saved, name: "Команда " }), false);
  assert.equal(chatProfileDirty(saved, { ...saved, name: "Команда проекта" }), true);
  assert.equal(chatProfileDirty(saved, { ...saved, description: "" }), true);
});
