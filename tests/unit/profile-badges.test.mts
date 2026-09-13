// What a strip of badges is made of.
//
// D-180. The rows come from `profile_badges`, a SECURITY DEFINER function that
// returns presentation fields only; everything a surface then decides — the
// order, the icon weight, what to do with an icon this build does not know — is
// here, where it can be argued about without a browser and without a database.

import assert from "node:assert/strict";
import test from "node:test";

import {
  badgeStrip,
  badgeUserIds,
  badgeWeight,
  hiddenBadgeCount,
  MEMBER_ROW_BADGE_LIMITS,
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

// The member list's half of the same answer (D-180, slice 3). A row shows the
// chat's own role, then one standing and at most two medals; anything past that
// is counted rather than dropped silently.

test("a member row wears one standing and one medal, whatever else is held", () => {
  const worn = projectProfileBadges(
    [
      role({ key: "owner", title: "Владелец", rank: 100 }),
      role({ key: "admin", title: "Администратор", rank: 80 }),
      medal({ key: "tester", title: "Тестировщик", rank: 100000 - 10 }),
      medal({ key: "settled_in", title: "Освоился", rank: 100000 - 30 }),
      medal({ key: "veteran", title: "Ветеран", rank: 100000 - 40 }),
    ],
    ME,
  );
  const strip = badgeStrip(worn);
  // One of each family, decided by looking at the rendered list rather than by
  // the proposal's two medals: at 390 points a second medal wrapped the row to a
  // second line of chips and the panel stopped reading as a list of people.
  assert.deepEqual(
    strip.shown.map((badge) => badge.title),
    ["Владелец", "Тестировщик"],
  );
  assert.equal(strip.hidden, 3, "the rest are counted, not forgotten");
});

test("a second rank does not take the room the medals were given", () => {
  // This is the whole reason the limits are per family rather than one «first
  // three», and the first version of this test claimed the opposite — that a
  // flat limit would push the standing off. It cannot: standings sort first.
  // What a flat limit really does is spend a row on two ranks and show nothing
  // the person earned, which is section 4.5's «at most one chip» broken.
  const worn = projectProfileBadges(
    [
      role({ key: "owner", title: "Владелец", rank: 100 }),
      role({ key: "admin", title: "Администратор", rank: 80 }),
      medal({ key: "tester", title: "Тестировщик", rank: 100000 - 10 }),
      medal({ key: "settled_in", title: "Освоился", rank: 100000 - 30 }),
    ],
    ME,
  );
  const strip = badgeStrip(worn);
  assert.deepEqual(
    strip.shown.map((badge) => badge.title),
    ["Владелец", "Тестировщик"],
  );
  assert.equal(strip.hidden, 2, "the second rank is counted away, not promoted");
});

test("a person wearing nothing gets an empty strip and no «+0»", () => {
  const strip = badgeStrip([]);
  assert.deepEqual(strip.shown, []);
  assert.equal(strip.hidden, 0, "«+0» beside a name is a count of nothing");
});

test("a strip with room to spare hides nothing", () => {
  const worn = projectProfileBadges([role(), medal()], ME);
  const strip = badgeStrip(worn);
  assert.equal(strip.shown.length, 2);
  assert.equal(strip.hidden, 0);
});

test("a surface may ask for other room, and the limits are the member row's default", () => {
  assert.deepEqual({ ...MEMBER_ROW_BADGE_LIMITS }, { standings: 1, medals: 1 });
  const worn = projectProfileBadges([role(), medal(), medal({ key: "settled_in", title: "Освоился" })], ME);
  const oneChip = badgeStrip(worn, { standings: 1, medals: 0 });
  assert.deepEqual(oneChip.shown.map((badge) => badge.title), ["Владелец"]);
  assert.equal(oneChip.hidden, 2);
  // And a surface with room — a person's own card — may show the lot.
  const roomy = badgeStrip(worn, { standings: 4, medals: 8 });
  assert.equal(roomy.shown.length, 3);
  assert.equal(roomy.hidden, 0);
});

// The icon resolution, proved where every surface meets it rather than only in
// `badgeVocabulary.ts`: a rule applied at the call sites is a rule the next call
// site forgets, so it belongs inside the projection itself.

test("a medal never reaches a surface wearing a role's glyph", () => {
  const [veteran] = projectProfileBadges([medal({ key: "veteran", icon: "crown" })], ME);
  assert.equal(veteran.icon, "clock", "«Ветеран» wore the owner's crown until this was resolved");

  const [tester] = projectProfileBadges([medal({ key: "tester", title: "Тестировщик", icon: "shield" })], ME);
  assert.equal(tester.icon, "key");

  const [owner] = projectProfileBadges([role({ key: "owner", icon: "crown" })], ME);
  assert.equal(owner.icon, "crown", "the role keeps it; it is the role's own");
});

test("the resolved glyph is what the build's icon set is asked about", () => {
  // Order matters here. Resolving after the check would hand a surface an icon
  // nobody verified this build has; checking a name the surface will not draw
  // proves nothing about the one it will.
  const [resolved] = projectProfileBadges([medal({ key: "veteran", icon: "crown" })], ME, {
    knownIcons: new Set(["crown"]),
  });
  assert.equal(resolved.icon, null, "«clock» is what it would draw, and this build has no clock");

  const [drawn] = projectProfileBadges([medal({ key: "veteran", icon: "crown" })], ME, {
    knownIcons: new Set(["clock"]),
  });
  assert.equal(drawn.icon, "clock");
});
