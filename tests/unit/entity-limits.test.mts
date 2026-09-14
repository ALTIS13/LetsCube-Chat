// Cutting a name to its limit, and the two ways the old cut was wrong.
//
// `limitText` guards four user-facing fields — a group's name, a chat's name, a
// folder's name and a text channel's name. It was `value.slice(0, maxLength)`
// until 2026-09-14.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_NAME_MAX_LENGTH,
  FOLDER_NAME_MAX_LENGTH,
  TOPIC_NAME_MAX_LENGTH,
  limitText,
  textRemaining,
} from "../../artifacts/kub/src/lib/entityLimits.ts";

const roundTrips = (value: string) =>
  Buffer.from(value, "utf8").toString("utf8") === value;

test("a name that fits is returned untouched", () => {
  assert.equal(limitText("Команда проекта", 64), "Команда проекта");
  assert.equal(limitText("", 64), "");
  // The limit itself is not one under it.
  const exact = "я".repeat(64);
  assert.equal(limitText(exact, 64), exact);
});

test("the cut never splits a surrogate pair", () => {
  // The measured case: one letter and forty emoji. `slice(0, 64)` landed
  // mid-pair and left the lone high surrogate \ud83e, which does not round-trip
  // through UTF-8 — so the JSON body leaving the client held bytes Postgres
  // cannot store as written.
  // The string has to be longer than the limit for a cut to happen at all:
  // seventy-one characters against a limit of sixty-four. The odd leading
  // letter is what puts the code-unit boundary in the middle of a pair.
  const mixed = "a" + "🧊".repeat(70);
  assert.ok(Array.from(mixed).length > 64, "the fixture is not long enough to be cut");
  const naive = mixed.slice(0, 64);
  assert.equal(roundTrips(naive), false, "the case this test exists for stopped reproducing");
  assert.equal(naive.charCodeAt(63) >= 0xd800 && naive.charCodeAt(63) <= 0xdbff, true);

  const cut = limitText(mixed, 64);
  assert.equal(roundTrips(cut), true, "the cut still leaves a lone surrogate");
  assert.equal(Array.from(cut).length, 64, "the cut did not deliver the whole limit");
  assert.equal(cut.startsWith("a"), true);
});

test("the cut counts characters, which is what the database counts", () => {
  // `char_length` in Postgres counts characters; `String.length` counts UTF-16
  // code units. Forty emoji sliced to 64 units gave 33 characters against a
  // limit of 64, while the counter beside the field said 64.
  const emoji = "🧊".repeat(40);
  assert.equal(emoji.slice(0, 64).length, 64, "the old cut measured code units");
  assert.equal(Array.from(emoji.slice(0, 64)).length, 32, "and delivered half the characters");

  const cut = limitText(emoji, 64);
  assert.equal(Array.from(cut).length, 40, "a name inside the limit was cut anyway");
  assert.equal(limitText(emoji, 10), "🧊".repeat(10));
});

test("what is left is counted the same way", () => {
  assert.equal(textRemaining("", 64), 64);
  assert.equal(textRemaining("🧊🧊", 64), 62, "two emoji counted as four");
  assert.equal(textRemaining("привет", 64), 58);
});

test("a limit of zero or less is an empty name, not the whole string", () => {
  assert.equal(limitText("что-нибудь", 0), "");
  assert.equal(limitText("что-нибудь", -5), "");
});

test("the three limits the product actually uses are the same 64", () => {
  // Not a coincidence worth hiding: all three columns carry the same bound, and
  // a fourth field added with a different one should be a deliberate act.
  assert.equal(CHAT_NAME_MAX_LENGTH, 64);
  assert.equal(FOLDER_NAME_MAX_LENGTH, 64);
  assert.equal(TOPIC_NAME_MAX_LENGTH, 64);
});
