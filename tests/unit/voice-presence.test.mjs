import assert from "node:assert/strict";
import test from "node:test";

import {
  chatVoicePresence,
  mergeVoicePresence,
  readVoicePresenceRows,
  voicePresenceTitle,
} from "../../artifacts/kub/src/lib/voicePresence.ts";

/**
 * Which conversations the chat list says have somebody talking in them.
 *
 * The defect this closes is slice 3's «chat-list indicator»: the call bar tells
 * a person about their own call from anywhere, and nothing told them about a
 * call in a group they were not looking at. A voice channel nobody happens to
 * be watching is a voice channel nobody joins.
 *
 * What is pinned here is the arithmetic and the sentence — the two things that
 * can be wrong while the mark still appears.
 */

const TEAM = "22222222-2222-4222-8222-000000000001";
const OTHER = "22222222-2222-4222-8222-000000000002";

const row = (over = {}) => ({
  id: "33333333-3333-4333-8333-000000000001",
  chat_id: TEAM,
  name: "Общая",
  participant_count: 2,
  archived: false,
  ...over,
});

test("a room with nobody in it is not presence, and neither is a broken counter", () => {
  // Zero is the absence of presence rather than a presence of nought, so the
  // row is dropped rather than kept with a count of 0 — a kept zero would put a
  // mark saying «0» on the list.
  assert.deepEqual(readVoicePresenceRows([row({ participant_count: 0 })]), []);
  // Negative is producible for a moment when a webhook and a reconciliation
  // disagree; `voiceOccupancyLabel` clamps it for the same reason.
  assert.deepEqual(readVoicePresenceRows([row({ participant_count: -3 })]), []);
  for (const bad of [null, undefined, "2", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      readVoicePresenceRows([row({ participant_count: bad })]),
      [],
      `a count of ${String(bad)} was read as presence`,
    );
  }
  // And an archived room, which is what «removed» means here: the row survives
  // an archive, so a stale read would otherwise announce a call in a room
  // nobody can join.
  assert.deepEqual(readVoicePresenceRows([row({ archived: true })]), []);
});

test("a row with no ids is not a room, whatever else it carries", () => {
  assert.deepEqual(readVoicePresenceRows([row({ id: null })]), []);
  assert.deepEqual(readVoicePresenceRows([row({ chat_id: null })]), []);
  assert.deepEqual(readVoicePresenceRows([null, undefined, 7, "x", []]), []);
  assert.deepEqual(readVoicePresenceRows(null), []);
  assert.deepEqual(readVoicePresenceRows({}), []);
});

test("a nameless room gets a floor rather than an empty pair of quotes", () => {
  for (const name of [null, "", "   ", 7]) {
    assert.equal(
      readVoicePresenceRows([row({ name })])[0].name,
      "Голосовой канал",
      `a room named ${JSON.stringify(name)} left the sentence with empty quotes`,
    );
  }
  // A fractional counter is floored rather than shown as «2.5 человека».
  assert.equal(readVoicePresenceRows([row({ participant_count: 2.7 })])[0].count, 2);
});

test("the count is everybody in the conversation, not the busiest room alone", () => {
  const folded = chatVoicePresence([
    { channelId: "a", chatId: TEAM, name: "Общая", count: 2 },
    { channelId: "b", chatId: TEAM, name: "Планёрка", count: 3 },
    { channelId: "c", chatId: OTHER, name: "Склад", count: 1 },
  ]);

  // Five people are talking in «Команда проекта». The row answers «is anything
  // happening here», so it says five — the mutation this exists for is taking
  // the busiest room's count, which would say three.
  assert.deepEqual(folded.get(TEAM), { count: 5, rooms: 2, name: "Планёрка" });
  assert.deepEqual(folded.get(OTHER), { count: 1, rooms: 1, name: "Склад" });
  assert.equal(folded.size, 2);
});

test("the room named in the sentence is the fullest one, and a tie has one answer", () => {
  const busiest = chatVoicePresence([
    { channelId: "a", chatId: TEAM, name: "Общая", count: 1 },
    { channelId: "b", chatId: TEAM, name: "Планёрка", count: 4 },
  ]);
  // The one somebody looking for company would join.
  assert.equal(busiest.get(TEAM).name, "Планёрка");

  // Two rooms with the same number must not swap between two reads that say
  // the same thing — the rule `orderVoiceParticipants` applies to two people
  // with one name.
  const tie = [
    { channelId: "a", chatId: TEAM, name: "Ёлка", count: 2 },
    { channelId: "b", chatId: TEAM, name: "Егор", count: 2 },
  ];
  assert.equal(chatVoicePresence(tie).get(TEAM).name, "Егор");
  assert.equal(chatVoicePresence([...tie].reverse()).get(TEAM).name, "Егор");
});

test("nothing anywhere folds to an empty map rather than to entries of zero", () => {
  assert.equal(chatVoicePresence([]).size, 0);
});

test("the sentence agrees with the number in Russian, including 11 to 14", () => {
  const say = (count, rooms = 1, name = "Общая") => voicePresenceTitle({ count, rooms, name });

  assert.equal(say(1), "1 человек в «Общая»");
  assert.equal(say(2), "2 человека в «Общая»");
  assert.equal(say(4), "4 человека в «Общая»");
  assert.equal(say(5), "5 человек в «Общая»");
  // The trap, and the reason this is a function rather than a ternary: 11 to 14
  // take the many-form against what their last digit would say. The first
  // version of `peopleWord` returned «человек» in every branch — right for 1, 5
  // and 11, wrong for every 2, 3 and 4 in the language.
  assert.equal(say(11), "11 человек в «Общая»");
  assert.equal(say(12), "12 человек в «Общая»");
  assert.equal(say(14), "14 человек в «Общая»");
  assert.equal(say(21), "21 человек в «Общая»");
  assert.equal(say(22), "22 человека в «Общая»");
  assert.equal(say(25), "25 человек в «Общая»");
  assert.equal(say(111), "111 человек в «Общая»");
  assert.equal(say(122), "122 человека в «Общая»");

  // Walked rather than sampled: a table of eight numbers can agree with a wrong
  // rule. Every count from 1 to 125 must take the form its last digits demand.
  for (let count = 1; count <= 125; count += 1) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    const many = mod100 >= 11 && mod100 <= 14 ? true : !(mod10 >= 2 && mod10 <= 4);
    const expected = many ? "человек" : "человека";
    assert.ok(
      say(count).startsWith(`${count} ${expected} `),
      `${count} should read «${count} ${expected}», got «${say(count)}»`,
    );
  }
});

test("more than one room is said as a count of rooms, in the prepositional case", () => {
  assert.equal(
    voicePresenceTitle({ count: 5, rooms: 2, name: "Планёрка" }),
    "5 человек в «Планёрка» и ещё в 1 канале",
  );
  assert.equal(
    voicePresenceTitle({ count: 9, rooms: 3, name: "Планёрка" }),
    "9 человек в «Планёрка» и ещё в 2 каналах",
  );
  assert.equal(
    voicePresenceTitle({ count: 40, rooms: 12, name: "Планёрка" }),
    "40 человек в «Планёрка» и ещё в 11 каналах",
  );
  // Six occupied rooms would put a paragraph in a tooltip, so the others are
  // counted rather than listed.
  assert.ok(!voicePresenceTitle({ count: 9, rooms: 3, name: "Планёрка" }).includes(","));
});

test("nothing changed means the held map itself, so the list is not notified", () => {
  // This is the whole of the chat list's render-cost promise. The read rebuilds
  // every entry from rows, so without the merge each entry would be a new
  // object on every event and every row with a call in it would render whenever
  // anybody anywhere joined or left one.
  const held = chatVoicePresence([
    { channelId: "a", chatId: TEAM, name: "Общая", count: 2 },
    { channelId: "c", chatId: OTHER, name: "Склад", count: 1 },
  ]);
  const same = chatVoicePresence([
    { channelId: "a", chatId: TEAM, name: "Общая", count: 2 },
    { channelId: "c", chatId: OTHER, name: "Склад", count: 1 },
  ]);
  // A fresh map with equal contents, and the merge must see through it.
  assert.notEqual(held, same, "the fixture built the same object twice, so this proves nothing");
  assert.equal(
    mergeVoicePresence(held, same),
    held,
    "an unchanged read produced a new map, so every row with a call would render",
  );
});

test("one conversation's call changing leaves every other entry the same object", () => {
  const held = chatVoicePresence([
    { channelId: "a", chatId: TEAM, name: "Общая", count: 2 },
    { channelId: "c", chatId: OTHER, name: "Склад", count: 1 },
  ]);
  const next = chatVoicePresence([
    { channelId: "a", chatId: TEAM, name: "Общая", count: 3 },
    { channelId: "c", chatId: OTHER, name: "Склад", count: 1 },
  ]);
  const merged = mergeVoicePresence(held, next);

  assert.notEqual(merged, held, "a real change did not reach the list");
  assert.equal(merged.get(TEAM).count, 3);
  // The row that matters: untouched, and therefore not re-rendered.
  assert.equal(
    merged.get(OTHER),
    held.get(OTHER),
    "a call in one conversation replaced another conversation's entry",
  );
});

test("a call that ended reaches the list even though every surviving entry matches", () => {
  const held = chatVoicePresence([
    { channelId: "a", chatId: TEAM, name: "Общая", count: 2 },
    { channelId: "c", chatId: OTHER, name: "Склад", count: 1 },
  ]);
  const next = chatVoicePresence([{ channelId: "a", chatId: TEAM, name: "Общая", count: 2 }]);
  const merged = mergeVoicePresence(held, next);

  // The mutation this exists for is comparing only the entries that are in the
  // new map: every one of them matches here, so a size-blind merge would hand
  // back the held map and the ended call would stay on the list for ever.
  assert.notEqual(merged, held, "a call that ended did not reach the list");
  assert.equal(merged.has(OTHER), false);
  assert.equal(merged.get(TEAM), held.get(TEAM), "the surviving entry was replaced for no reason");
});

test("a first read reaches the list, and an empty one after it does too", () => {
  const empty = new Map();
  const first = chatVoicePresence([{ channelId: "a", chatId: TEAM, name: "Общая", count: 2 }]);
  assert.notEqual(mergeVoicePresence(empty, first), empty);
  assert.notEqual(mergeVoicePresence(first, empty), first);
  // And nothing to nothing is still nothing, without a notification.
  assert.equal(mergeVoicePresence(empty, new Map()), empty);
});
