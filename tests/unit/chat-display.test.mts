import assert from "node:assert/strict";
import test from "node:test";

import { getChatDisplayInfo, memberCountLabel } from "../../artifacts/kub/src/lib/chatDisplay.ts";

/**
 * D-093: a group's member count was always written in the form for many —
 * «4 участников» — in the chat list's second line, the chat header and the
 * chat's info panel. Russian takes the form from the last two digits.
 */

test("a member count takes the form Russian gives it", () => {
  const cases: Array<[number, string]> = [
    [1, "1 участник"],
    [2, "2 участника"],
    [4, "4 участника"],
    [5, "5 участников"],
    [11, "11 участников"],
    [12, "12 участников"],
    [14, "14 участников"],
    [21, "21 участник"],
    [22, "22 участника"],
    [111, "111 участников"],
    [0, "0 участников"],
  ];
  for (const [count, label] of cases) assert.equal(memberCountLabel(count), label, `for ${count}`);
});

test("a group without a description counts its members in that form, and one without members says it is a group", () => {
  const group = (memberCount: number, description: string | null = null) => ({
    id: "chat",
    name: "Команда",
    type: "group" as const,
    description,
    created_by: "owner",
    members: Array.from({ length: memberCount }, (_, index) => ({ user_id: `user-${index}` })),
    other_user: null,
  });
  assert.equal(getChatDisplayInfo(group(3) as never, "user-0").subtitle, "3 участника");
  assert.equal(getChatDisplayInfo(group(0) as never, "user-0").subtitle, "Группа");
  assert.equal(getChatDisplayInfo(group(3, "Проект на осень") as never, "user-0").subtitle, "Проект на осень");
});
