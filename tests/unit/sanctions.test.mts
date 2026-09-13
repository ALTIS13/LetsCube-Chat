// Lifting a ban or a mute (D-134).
//
// «Снять блокировку» deleted every `bans` row for the person, expired ones
// included, so lifting a week-old ban erased the record that it had ever
// happened — and it did that on one press with nothing asked.
import assert from "node:assert/strict";
import test from "node:test";

import {
  activeSanctionFilter,
  isSanctionActive,
  sanctionLiftPrompt,
} from "../../artifacts/kub/src/lib/sanctions.ts";

const NOW = new Date("2026-09-14T09:00:00.000Z");

test("the filter names both shapes of a restriction in force", () => {
  // A null `expires_at` is permanent, which is why this cannot be one
  // comparison, and why leaving the null branch out would quietly make every
  // permanent ban unliftable.
  assert.equal(
    activeSanctionFilter(NOW),
    "expires_at.is.null,expires_at.gt.2026-09-14T09:00:00.000Z",
  );
});

test("the filter is the instant it was given, not the clock", () => {
  // The read that decides whether «Снять блокировку» appears and the delete
  // behind it must be able to agree on one instant.
  const other = new Date("2026-01-02T03:04:05.000Z");
  assert.notEqual(activeSanctionFilter(other), activeSanctionFilter(NOW));
  assert.match(activeSanctionFilter(other), /2026-01-02T03:04:05\.000Z$/);
});

test("a restriction is in force until it is not", () => {
  assert.equal(isSanctionActive({ expires_at: null }, NOW), true, "permanent");
  assert.equal(isSanctionActive({}, NOW), true, "an absent field is permanent");
  assert.equal(
    isSanctionActive({ expires_at: "2026-09-14T09:00:01.000Z" }, NOW),
    true,
    "a second from now",
  );
  assert.equal(
    isSanctionActive({ expires_at: "2026-09-14T08:59:59.000Z" }, NOW),
    false,
    "a second ago",
  );
  // Exactly now is over: the same boundary `expires_at.gt.` uses, so the two
  // cannot disagree about one row.
  assert.equal(isSanctionActive({ expires_at: NOW.toISOString() }, NOW), false);
  // An unreadable value is not evidence that a restriction has ended.
  assert.equal(isSanctionActive({ expires_at: "не дата" }, NOW), true);
});

test("the question says what ends and what is kept", () => {
  const ban = sanctionLiftPrompt("ban", "Фиктивный Участник");
  assert.match(ban.title, /Снять блокировку/);
  assert.match(ban.description, /Фиктивный Участник/);
  assert.match(ban.description, /останутся в истории/);
  assert.equal(ban.confirmLabel, "Снять блокировку");

  const mute = sanctionLiftPrompt("mute", "@fixture_user");
  assert.match(mute.title, /Снять мьют/);
  assert.match(mute.description, /@fixture_user/);
  assert.equal(mute.confirmLabel, "Снять мьют");

  // The two must not be interchangeable: an administrator reading «Снять мьют»
  // over a ban would confirm the wrong thing.
  assert.notEqual(ban.title, mute.title);
  assert.notEqual(ban.description, mute.description);
});

test("a person with no name is still described, not left blank", () => {
  for (const name of ["", "   "]) {
    const prompt = sanctionLiftPrompt("ban", name);
    assert.match(prompt.description, /этого пользователя/);
    assert.doesNotMatch(prompt.description, /для\s+будет/);
  }
});
