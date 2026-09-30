import assert from "node:assert/strict";
import test from "node:test";

import {
  STRANGER_HANDLE_MIN,
  knownPeopleIds,
  peopleSearchNeedle,
  personMatchesSearch,
  personOfSearchRow,
} from "../../artifacts/kub/src/lib/peopleSearchScope.ts";

// 2026-09-30, a tester: «Мы можем не показывать всех пользователей, а только
// тех кого ищем». Telegram's split: people the reader has by name, strangers by
// the handle only.

const anna = { id: "a", full_name: "Анна Смирнова", username: "anna_s" };
const troll = { id: "t", full_name: "Анальный дебошир", username: "zzz_troll" };
const ivan = { id: "i", full_name: "Иван Жанов", username: null };
const hyphen = { id: "h", full_name: "Анна-Мария Лёвина", username: "am" };

test("somebody the reader has is found by the start of the name or of any word in it, or of the handle", () => {
  const needle = peopleSearchNeedle;
  assert.equal(personMatchesSearch(anna, needle("Ан"), true), true);
  assert.equal(personMatchesSearch(anna, needle("смир"), true), true, "a word inside the name");
  assert.equal(personMatchesSearch(anna, needle("анна смир"), true), true, "the whole name as typed");
  assert.equal(personMatchesSearch(anna, needle("@anna"), true), true, "the handle, with or without «@»");
  assert.equal(personMatchesSearch(anna, needle("нна"), true), false, "letters from the middle of a word are not a match");
  assert.equal(personMatchesSearch(ivan, needle("ан"), true), false, "«ан» inside «Жанов» is not a word's start");
  assert.equal(personMatchesSearch(hyphen, needle("мари"), true), true, "a hyphenated name's second half is a word");
  assert.equal(personMatchesSearch(hyphen, needle("левина"), true), true, "«ё» and «е» are one letter to a search");
});

test("a stranger is found only by the start of the handle, from the third letter — never by the name", () => {
  const needle = peopleSearchNeedle;
  assert.equal(STRANGER_HANDLE_MIN, 3);
  // The tester's complaint: two letters brought up whatever the display name said.
  assert.equal(personMatchesSearch(troll, needle("ан"), false), false);
  assert.equal(personMatchesSearch(troll, needle("анальный"), false), false, "the display name is not searchable by strangers");
  assert.equal(personMatchesSearch(anna, needle("Анна Смирнова"), false), false);
  assert.equal(personMatchesSearch(anna, needle("an"), false), false, "two letters of a handle are too few");
  assert.equal(personMatchesSearch(anna, needle("ann"), false), true);
  assert.equal(personMatchesSearch(anna, needle("@anna_s"), false), true);
  assert.equal(personMatchesSearch(troll, needle("tro"), false), false, "the middle of a handle is not its start");
  assert.equal(personMatchesSearch(ivan, needle("иван"), false), false, "no handle, so nothing to find a stranger by");
});

test("the reader has themselves, their contacts and everybody in their conversations", () => {
  const known = knownPeopleIds(
    [{ members: [{ user_id: "me" }, { user_id: "a" }] }, { members: [{ user_id: "b" }] }, { members: null }],
    ["c"],
    "me",
  );
  assert.deepEqual([...known].sort(), ["a", "b", "c", "me"]);
  assert.equal(knownPeopleIds([], [], null).size, 0);
});

test("a search row's person is read from what the row carries", () => {
  assert.deepEqual(personOfSearchRow({ id: "a", title: "Анна Смирнова", subtitle: "@anna_s" }), { id: "a", full_name: "Анна Смирнова", username: "anna_s" });
  assert.deepEqual(personOfSearchRow({ id: "b", title: "@bob", subtitle: "@bob" }), { id: "b", full_name: null, username: "bob" });
  assert.deepEqual(personOfSearchRow({ id: "c", title: "Пользователь", subtitle: "Профиль" }), { id: "c", full_name: "Пользователь", username: null });
  assert.deepEqual(
    personOfSearchRow({ id: "d", title: "Анна", subtitle: null, profile: { full_name: "Анна Смирнова", username: "anna_s" } }),
    { id: "d", full_name: "Анна Смирнова", username: "anna_s" },
    "a row that carries the profile is read from it",
  );
});
