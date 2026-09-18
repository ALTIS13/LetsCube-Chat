import assert from "node:assert/strict";
import test from "node:test";

import {
  chatMemberRowFacts,
  compareChatMembers,
  formatJoinedAt,
  formatUsername,
  memberDisplayName,
  memberListFailure,
  sortChatMembers,
  MEMBERS_EMPTY,
  MEMBERS_UNAVAILABLE,
  MEMBERS_UNAVAILABLE_DETAIL,
  MEMBER_JOINED_UNKNOWN,
  MEMBER_LIST_MESSAGES,
  MEMBER_NO_USERNAME,
  MEMBER_UNNAMED,
  type ChatMemberListEntry,
} from "../../artifacts/kub/src/lib/chatMemberList.ts";
import { INTERNALS_PATTERN, MAPPER_GENERIC_FAILURE } from "../../artifacts/kub/src/lib/plainMessages.ts";

/**
 * D-168: «the list has no order», and «an ordinary member's row carries nothing
 * at all».
 *
 * Written against the entry's sentences rather than against the module, so a
 * rewrite that keeps the shape and loses the guarantee goes red. Each test
 * below was mutation-checked — the mutations and their results are in the
 * report for this change.
 */

const who = (over: Partial<ChatMemberListEntry> & { id: string }): ChatMemberListEntry => ({
  full_name: null,
  username: null,
  chat_role: "member",
  ...over,
});

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

test("role decides before name, so an owner never sorts below a member", () => {
  const owner = who({ id: "b", full_name: "Яков", chat_role: "owner" });
  const member = who({ id: "a", full_name: "Анна" });
  assert.ok(compareChatMembers(owner, member) < 0);
  assert.ok(compareChatMembers(member, owner) > 0);

  const list = sortChatMembers([
    who({ id: "3", full_name: "Анна" }),
    who({ id: "2", full_name: "Яков", chat_role: "admin" }),
    who({ id: "1", full_name: "Пётр", chat_role: "owner" }),
  ]);
  assert.deepEqual(
    list.map((m) => m.chat_role),
    ["owner", "admin", "member"],
  );
});

test("inside a role, names are in Russian alphabetical order", () => {
  const list = sortChatMembers([
    who({ id: "1", full_name: "Пётр" }),
    who({ id: "2", full_name: "Анна" }),
    who({ id: "3", full_name: "Борис" }),
  ]);
  assert.deepEqual(list.map((m) => m.full_name), ["Анна", "Борис", "Пётр"]);
});

test("case does not split a name away from its neighbours", () => {
  // The reason `localeCompare` is used rather than a hand-rolled lowercase
  // compare: code-unit order puts every capital before every lower case, so
  // «анна» would sort after «Яков» — and folding Cyrillic by hand is exactly
  // the thing that has been measured wrong in this repository before.
  const list = sortChatMembers([
    who({ id: "1", full_name: "яков" }),
    who({ id: "2", full_name: "Анна" }),
    who({ id: "3", full_name: "БОРИС" }),
  ]);
  assert.deepEqual(list.map((m) => m.full_name), ["Анна", "БОРИС", "яков"]);
});

test("somebody with no name of their own sorts last in their role", () => {
  const list = sortChatMembers([
    who({ id: "1" }),
    who({ id: "2", full_name: "Яков" }),
    who({ id: "3", username: "anna" }),
  ]);
  assert.deepEqual(list.map((m) => m.id), ["2", "3", "1"]);
});

test("two people with one name keep a stable order rather than the database's", () => {
  const a = who({ id: "aaa", full_name: "Анна" });
  const b = who({ id: "bbb", full_name: "Анна" });
  assert.ok(compareChatMembers(a, b) < 0, "the id breaks the tie");
  assert.deepEqual(sortChatMembers([b, a]).map((m) => m.id), ["aaa", "bbb"]);
  assert.deepEqual(sortChatMembers([a, b]).map((m) => m.id), ["aaa", "bbb"]);
});

test("the sort leaves the caller's array alone", () => {
  const rows = [who({ id: "1", full_name: "Яков" }), who({ id: "2", full_name: "Анна" })];
  const sorted = sortChatMembers(rows);
  assert.deepEqual(rows.map((m) => m.id), ["1", "2"], "the input was reordered in place");
  assert.deepEqual(sorted.map((m) => m.id), ["2", "1"]);
});

// ---------------------------------------------------------------------------
// What a row says
// ---------------------------------------------------------------------------

test("an ordinary member's row is never empty", () => {
  // The entry's own sentence, as an assertion: «An ordinary member's row
  // carries nothing at all».
  const bare = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Ольга" }),
    roleLabel: "",
    presence: null,
  });
  assert.equal(bare.secondary, MEMBER_NO_USERNAME);
  assert.notEqual(bare.secondary, "");

  const named = chatMemberRowFacts({
    member: who({ id: "2", full_name: "Ольга", username: "olga" }),
    roleLabel: "",
    presence: null,
  });
  assert.equal(named.secondary, "@olga");
});

test("a role takes the identity slot, and presence stands beside it", () => {
  const facts = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Пётр", username: "petr", chat_role: "owner" }),
    roleLabel: "Владелец группы",
    presence: { isOnline: true, label: "в сети" },
  });
  assert.equal(facts.secondary, "Владелец группы · в сети");
});

test("a group's own word takes the role's place, the way a Telegram title does", () => {
  // D-215. The group chose the word, and the word says more than the tier.
  // Telegram prints a custom admin title instead of «админ» for exactly this
  // reason, and Discord's member list shows the role rather than «Moderator».
  const facts = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Пётр", username: "petr", chat_role: "admin" }),
    roleLabel: "Администратор группы",
    tagLabel: "Наставник",
    presence: { isOnline: true, label: "в сети" },
  });
  assert.equal(facts.secondary, "Наставник · в сети");
  assert.ok(
    !facts.secondary.includes("Администратор"),
    "the tier and the group's word are both on the line — three facts on a 280px row",
  );
});

test("a blank tag is not a tag, and the tier comes back", () => {
  // The hook answers with an empty list before it has read anything, and a
  // role whose name is whitespace is a row the database would have refused.
  // Either way the row must not lose the fact it had.
  for (const tagLabel of [undefined, null, "", "   "]) {
    const facts = chatMemberRowFacts({
      member: who({ id: "1", full_name: "Пётр", chat_role: "owner" }),
      roleLabel: "Владелец группы",
      tagLabel,
      presence: null,
    });
    assert.equal(facts.secondary, "Владелец группы", `tagLabel ${JSON.stringify(tagLabel)}`);
  }
});

test("an ordinary member's tag reaches the line that used to hold their nickname", () => {
  // Somebody with no tier had `@petr` in that slot. A tag outranks it: it is
  // what this group calls them, and the nickname is on their card.
  const facts = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Пётр", username: "petr", chat_role: "member" }),
    roleLabel: "",
    tagLabel: "Дежурный",
    presence: null,
  });
  assert.equal(facts.secondary, "Дежурный");
});

test("the second line is never more than two facts", () => {
  // Measured rather than preferred: `d424f96` photographed this row at 390 and
  // rejected a third element for wrapping every decorated row onto a third
  // line. A role, a nickname and a presence sentence is longer than what it
  // rejected.
  for (const roleLabel of ["", "Администратор группы"]) {
    for (const presence of [null, { isOnline: false, label: "был(а) 12 мин назад" }]) {
      const facts = chatMemberRowFacts({
        member: who({ id: "1", full_name: "Пётр", username: "petr" }),
        roleLabel,
        presence,
      });
      assert.ok(
        facts.secondary.split(" · ").length <= 2,
        `three facts on one line: ${facts.secondary}`,
      );
    }
  }
});

test("presence that could not be read is not reported as being offline", () => {
  // `usePrivacyPreferences` writes `online_at = null` when somebody turns the
  // setting off, and `getUserPresenceState` answers with an empty label. That
  // is «we were not allowed to look», not «не в сети» (D-140, D-193).
  const unknown = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Ольга", username: "olga" }),
    roleLabel: "",
    presence: { isOnline: false, label: "" },
  });
  assert.equal(unknown.secondary, "@olga", "an empty presence label became a claim");
  assert.equal(unknown.showOnlineDot, false);
});

test("the dot follows the presence answer and nothing else", () => {
  const on = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Пётр" }),
    roleLabel: "Владелец группы",
    presence: { isOnline: true, label: "в сети" },
  });
  const off = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Пётр" }),
    roleLabel: "Владелец группы",
    presence: { isOnline: false, label: "был(а) 2 ч назад" },
  });
  assert.equal(on.showOnlineDot, true);
  assert.equal(off.showOnlineDot, false);
});

test("a person with no name at all still has one on the row", () => {
  assert.equal(memberDisplayName(who({ id: "1" })), MEMBER_UNNAMED);
  assert.equal(memberDisplayName(who({ id: "1", username: "anna" })), "anna");
  assert.equal(memberDisplayName(who({ id: "1", full_name: "  Анна  ", username: "anna" })), "Анна");
  assert.equal(memberDisplayName(who({ id: "1", full_name: "   ", username: "anna" })), "anna");
});

test("a nickname is printed with its sign, or its absence is named", () => {
  assert.equal(formatUsername("anna"), "@anna");
  assert.equal(formatUsername("  anna  "), "@anna");
  assert.equal(formatUsername(""), MEMBER_NO_USERNAME);
  assert.equal(formatUsername(null), MEMBER_NO_USERNAME);
  assert.equal(formatUsername(undefined), MEMBER_NO_USERNAME);
});

// ---------------------------------------------------------------------------
// The join date
// ---------------------------------------------------------------------------

test("a join date is spelled out, and an absent one says so", () => {
  assert.equal(formatJoinedAt("2026-05-09T10:00:00Z"), "В группе с 9 мая 2026 г.");
  assert.equal(formatJoinedAt(null), MEMBER_JOINED_UNKNOWN);
  assert.equal(formatJoinedAt(undefined), MEMBER_JOINED_UNKNOWN);
  assert.equal(formatJoinedAt("not a date"), MEMBER_JOINED_UNKNOWN);
});

// ---------------------------------------------------------------------------
// The two different facts
// ---------------------------------------------------------------------------

test("a refused list and an empty one do not say the same thing", () => {
  assert.notEqual(MEMBERS_UNAVAILABLE, MEMBERS_EMPTY);
});

test("no sentence here explains the machine", () => {
  for (const sentence of MEMBER_LIST_MESSAGES) {
    assert.doesNotMatch(sentence, INTERNALS_PATTERN, `«${sentence}» names an internal`);
  }
});

test("a database's own words never reach the member list", () => {
  // The filter `plainFailure` applies, reached through this module so the
  // decision is testable without a browser. The inputs are the shapes
  // `mapPgError` really answers with, not invented ones.
  assert.equal(
    memberListFailure("Не найдена таблица chat_members."),
    MEMBERS_UNAVAILABLE,
    "a sentence naming a table reached the screen",
  );
  assert.equal(memberListFailure("Требуется миграция базы данных."), MEMBERS_UNAVAILABLE);
  assert.equal(
    memberListFailure(MAPPER_GENERIC_FAILURE),
    MEMBERS_UNAVAILABLE,
    "«операцию» is worse than this surface's own name for what failed",
  );
  assert.equal(memberListFailure(null), MEMBERS_UNAVAILABLE);
  assert.equal(memberListFailure(""), MEMBERS_UNAVAILABLE);
  // A sentence a person can act on is worth more than either and survives.
  assert.equal(
    memberListFailure("Недостаточно прав."),
    "Недостаточно прав.",
    "the one failure a person could have fixed was flattened away",
  );
});

test("the detail line says what state the list is in, not what broke", () => {
  assert.doesNotMatch(MEMBERS_UNAVAILABLE_DETAIL, INTERNALS_PATTERN);
  assert.ok(MEMBERS_UNAVAILABLE_DETAIL.length > 0);
});

/**
 * The absence wording is the last resort, not the identity slot.
 *
 * The module's own note says «Без имени пользователя» is for someone with no
 * chat role, no username **and** no readable presence. The first implementation
 * put it in the identity slot whenever there was no role and no username, so a
 * row read «Без имени пользователя · был(а) недавно» — which tells the reader
 * what the person does not have, and is a line neither Telegram nor Discord
 * writes. Seen in the rendered list before it was measured here.
 */
test("a member with no nickname says where they are, not what they lack", () => {
  const seen = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Анна Тихая" }),
    roleLabel: "",
    presence: { isOnline: false, label: "был(а) недавно" },
  });
  assert.equal(seen.secondary, "был(а) недавно");
  assert.ok(
    !seen.secondary.includes(MEMBER_NO_USERNAME),
    "the row announces a missing username beside a presence that already fills the line",
  );

  // And the guarantee underneath it is untouched: with nothing else to say the
  // row still is not empty.
  const nothing = chatMemberRowFacts({
    member: who({ id: "2", full_name: "Анна Тихая" }),
    roleLabel: "",
    presence: null,
  });
  assert.equal(nothing.secondary, MEMBER_NO_USERNAME);
});

test("a role still wins the identity slot over a username", () => {
  const facts = chatMemberRowFacts({
    member: who({ id: "1", full_name: "Пётр", username: "petr", chat_role: "admin" }),
    roleLabel: "Администратор группы",
    presence: { isOnline: false, label: "был(а) недавно" },
  });
  assert.equal(facts.secondary, "Администратор группы · был(а) недавно");
});
