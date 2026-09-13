// What a strip of badges is made of.
//
// D-180. The rows come from `profile_badges`, a SECURITY DEFINER function that
// returns presentation fields only; everything a surface then decides — the
// order, the icon weight, what to do with an icon this build does not know — is
// here, where it can be argued about without a browser and without a database.

import assert from "node:assert/strict";
import test from "node:test";

import {
  badgeUserIds,
  badgeWeight,
  hiddenBadgeCount,
  projectProfileBadges,
  type ProfileBadgeRow,
} from "../../artifacts/kub/src/lib/profileBadges.ts";

const ME = "11111111-1111-4111-8111-000000000001";
const SOMEBODY_ELSE = "11111111-1111-4111-8111-000000000002";

const role = (over: Partial<ProfileBadgeRow> = {}): ProfileBadgeRow => ({
  user_id: ME,
  kind: "global_role",
  key: "owner",
  title: "Владелец",
  detail: "Полный доступ",
  icon: "crown",
  colour: "#F5B50A",
  rank: 100,
  ...over,
});

const medal = (over: Partial<ProfileBadgeRow> = {}): ProfileBadgeRow => ({
  user_id: ME,
  kind: "achievement",
  key: "veteran",
  title: "Ветеран",
  detail: "Давно с нами",
  icon: "crown",
  colour: null,
  rank: 100000 - 40,
  ...over,
});

test("a person wears their own rows and nobody else's", () => {
  const rows = [role(), role({ user_id: SOMEBODY_ELSE, key: "admin", title: "Администратор" })];
  const mine = projectProfileBadges(rows, ME);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, "Владелец");
});

test("the standing comes first, and the catalogue keeps its own order inside the medals", () => {
  // Two keys, not one. The design proposed a single descending sort of `rank`,
  // and the arithmetic refuses it: a medal's rank is `100000 - sort_order`, so
  // every medal outranks every role and the strip reads backwards — which is
  // exactly how it rendered before this was fixed, «Ветеран» standing in front
  // of «Владелец». Shuffled on the way in, because a server's order is not a
  // contract.
  const rows = [
    medal({ key: "storyteller", title: "Рассказчик", rank: 100000 - 60 }),
    role({ key: "manager", title: "Менеджер", rank: 60 }),
    medal({ key: "tester", title: "Тестировщик", rank: 100000 - 10 }),
    role({ key: "owner", title: "Владелец", rank: 100 }),
  ];
  assert.deepEqual(
    projectProfileBadges(rows, ME).map((badge) => badge.title),
    ["Владелец", "Менеджер", "Тестировщик", "Рассказчик"],
  );
});

test("the ladder is the icon's weight, at the seeded priorities", () => {
  assert.equal(badgeWeight(100), "fill", "owner and tech_admin");
  assert.equal(badgeWeight(80), "bold", "admin");
  assert.equal(badgeWeight(60), "regular", "manager");
  assert.equal(badgeWeight(0), "regular");
  assert.equal(badgeWeight(null), "regular", "a row with no rank is not the top of the ladder");
});

test("a medal is never drawn as the top of the ladder", () => {
  // Its rank is enormous by construction, so the weight rule alone would fill
  // every medal and a «Тестировщик» would outrank «Владелец» at a glance.
  const [badge] = projectProfileBadges([medal()], ME);
  assert.equal(badge.kind, "achievement");
  assert.equal(badge.weight, "regular");
});

test("an icon this build does not have is dropped, and the chip still says who somebody is", () => {
  const known = new Set(["crown", "shield"]);
  const [unknown] = projectProfileBadges([role({ icon: "sparkleGalaxy" })], ME, { knownIcons: known });
  assert.equal(unknown.icon, null, "an unknown name would render nothing at all");
  assert.equal(unknown.title, "Владелец", "and the name it names is still there");

  const [plain] = projectProfileBadges([role({ icon: null })], ME, { knownIcons: known });
  assert.equal(plain.icon, null);

  const [good] = projectProfileBadges([role()], ME, { knownIcons: known });
  assert.equal(good.icon, "crown");
});

test("a row with no title is not a chip", () => {
  // The strip is words. A chip with an icon and no name says nothing at all.
  assert.deepEqual(projectProfileBadges([role({ title: "" })], ME), []);
  assert.deepEqual(projectProfileBadges([role({ title: "   " })], ME), []);
});

test("a surface with room for two says how many it did not show", () => {
  const rows = [role(), role({ key: "admin", title: "Администратор", rank: 80 }), medal()];
  const strip = projectProfileBadges(rows, ME, { limit: 2 });
  assert.equal(strip.length, 2);
  assert.equal(hiddenBadgeCount(rows.length, 2), 1);
  assert.equal(hiddenBadgeCount(rows.length, undefined), 0, "no limit hides nothing");
  assert.equal(hiddenBadgeCount(1, 3), 0, "fewer than the room is not a negative count");
});

test("an empty answer is an empty strip, not a placeholder", () => {
  assert.deepEqual(projectProfileBadges([], ME), []);
});

test("who an answer accounted for is a set, because a person with nothing is simply absent", () => {
  const ids = badgeUserIds([role(), medal(), role({ user_id: SOMEBODY_ELSE })]);
  assert.deepEqual([...ids].sort(), [ME, SOMEBODY_ELSE].sort());
  assert.equal(badgeUserIds([]).size, 0);
});

test("a detail that is only whitespace is no detail", () => {
  const [badge] = projectProfileBadges([role({ detail: "   " })], ME);
  assert.equal(badge.detail, null);
});
