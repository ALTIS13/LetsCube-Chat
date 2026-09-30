import assert from "node:assert/strict";
import test from "node:test";

import {
  MICRO_GROUP_CAP,
  isMicroGroup,
  microGroupDrawnName,
  microGroupErrorText,
  microGroupFirstName,
  microGroupOwnerId,
  microGroupRoom,
  microGroupRoomLabel,
} from "../../artifacts/kub/src/lib/microGroup.ts";

// Tracker item 45: the micro-group, «групповой чат».

const member = (user_id: string, full_name: string | null, joined_at: string, role = "member", username: string | null = null) => ({
  user_id,
  joined_at,
  role,
  profile: { full_name, username },
});

const ME = member("u0", "Зоя Яблокова", "2026-09-30T10:00:00Z", "owner");
const ANNA = member("u1", "Анна Смирнова", "2026-09-30T10:00:01Z");
const BORIS = member("u2", "Борис Ильин", "2026-09-30T10:00:02Z");
const VIKA = member("u3", null, "2026-09-30T10:00:03Z", "member", "vika");
const GLEB = member("u4", "Глеб", "2026-09-30T10:00:04Z");
const DINA = member("u5", "  ", "2026-09-30T10:00:05Z");

test("the kind, told by its database value alone", () => {
  assert.equal(isMicroGroup({ type: "dm_group" }), true);
  assert.equal(isMicroGroup({ type: "group" }), false, "a server is not a micro-group");
  assert.equal(isMicroGroup({ type: "private" }), false);
  assert.equal(isMicroGroup(null), false);
  assert.equal(MICRO_GROUP_CAP, 10, "Discord's group DM limit");
});

test("a nameless group is called by the others' first names, in the order they came", () => {
  assert.equal(microGroupDrawnName([ME, ANNA, BORIS], "u0"), "Анна, Борис");
  assert.equal(microGroupDrawnName([BORIS, ME, ANNA], "u1"), "Зоя, Борис", "the reader is never in their own group's name");
  assert.equal(microGroupDrawnName([ME, ANNA, BORIS, VIKA, GLEB, DINA], "u0"), "Анна, Борис, @vika и ещё 2");
  assert.equal(microGroupDrawnName([ME], "u0"), "Групповой чат");
  assert.equal(microGroupFirstName(DINA.profile), "Участник", "a blank name and no handle");
});

test("the crown and the room left", () => {
  assert.equal(microGroupOwnerId([ANNA, ME, BORIS]), "u0");
  assert.equal(microGroupOwnerId([ANNA, BORIS]), null);
  assert.equal(microGroupRoom(3), 7);
  assert.equal(microGroupRoom(12), 0);
  assert.equal(microGroupRoomLabel(3), "Можно добавить ещё 7 человек");
  assert.equal(microGroupRoomLabel(8), "Можно добавить ещё 2 человека");
  assert.equal(microGroupRoomLabel(9), "Можно добавить ещё 1 человека");
  assert.match(microGroupRoomLabel(10), /больше нельзя/);
});

test("a refusal is a sentence, and a block against you is not named", () => {
  assert.match(microGroupErrorText({ message: "micro_group_full" }, "x"), /не больше 10/);
  assert.match(microGroupErrorText({ message: "micro_group_blocked_by_you" }, "x"), /Вы заблокировали/);
  const theirs = microGroupErrorText({ message: "micro_group_unavailable" }, "x");
  assert.doesNotMatch(theirs, /заблокир/i, "that somebody blocked you is not yours to learn");
  assert.equal(microGroupErrorText({ message: "permission denied for table chats" }, "Не удалось."), "Не удалось.");
});
