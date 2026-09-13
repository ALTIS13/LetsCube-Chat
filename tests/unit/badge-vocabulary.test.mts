// Which glyph a badge wears, and the rule that no glyph means two things.
//
// D-180 is «nobody could see who anybody was». This file holds the defect one
// level down: a strip that finally says who somebody is, drawn with icons that
// say two different things at once. `crown` was seeded for both «Владелец» and
// «Ветеран»; `shield` for «Администратор», «Тестировщик» and «Альфа-тестер» —
// and the last two have collided with each other inside the settings screen
// since the day they were seeded.
//
// The fix is resolved in the interface rather than in the catalogue, because
// changing `public.achievements.icon` changes a badge somebody already holds
// and that is the owner's decision. These tests pin the vocabulary as the
// interface draws it, so the day the owner applies the four updates the table
// and the database agree instead of arguing.

import assert from "node:assert/strict";
import test from "node:test";

import {
  badgeTone,
  MEDAL_FALLBACK_ICON,
  MEDAL_ICON_OVERRIDES,
  resolveBadgeIcon,
  SEEDED_BADGES,
  STANDING_BADGE_ICONS,
} from "../../artifacts/kub/src/lib/badgeVocabulary.ts";

const drawn = (badge: (typeof SEEDED_BADGES)[number]) =>
  resolveBadgeIcon(badge.family, badge.key, badge.seededIcon);

test("the catalogue this build draws is the eleven badges that exist", () => {
  // Four global roles, seeded by 20260913140000_profile_badges.sql, and seven
  // medals from the three achievement migrations. A row added to either seed
  // without being considered here is what this count catches.
  assert.equal(SEEDED_BADGES.filter((badge) => badge.family === "standing").length, 4);
  assert.equal(SEEDED_BADGES.filter((badge) => badge.family === "medal").length, 7);
  assert.deepEqual(
    SEEDED_BADGES.filter((badge) => badge.family === "medal").map((badge) => badge.key),
    ["tester", "alpha_tester", "beta_tester", "settled_in", "veteran", "conversationalist", "storyteller"],
  );
});

test("the seeds really do collide, so this module is not solving an imaginary problem", () => {
  // Written from the migrations rather than asserted about the fix: if somebody
  // later repairs the catalogue and deletes the overrides, this is the test
  // that says the repair happened and the rest may go.
  const seeded = SEEDED_BADGES.map((badge) => badge.seededIcon);
  assert.equal(seeded.filter((icon) => icon === "crown").length, 2, "owner and veteran");
  assert.equal(seeded.filter((icon) => icon === "shield").length, 3, "admin, tester and alpha_tester");
});

test("no two badges wear the same glyph once the interface has resolved them", () => {
  // The whole point, as one property rather than four assertions: a reader who
  // learns what an icon means must not meet it meaning something else.
  const seen = new Map<string, string>();
  for (const badge of SEEDED_BADGES) {
    const icon = drawn(badge);
    assert.ok(icon, `${badge.key} ended up with no icon at all`);
    const owner = seen.get(icon as string);
    assert.equal(
      owner,
      undefined,
      `«${badge.title}» and «${owner}» would both be drawn as ${icon}`,
    );
    seen.set(icon as string, badge.title);
  }
  assert.equal(seen.size, SEEDED_BADGES.length);
});

test("a standing keeps the glyph its role names, because a role is the ladder", () => {
  assert.equal(resolveBadgeIcon("standing", "owner", "crown"), "crown");
  assert.equal(resolveBadgeIcon("standing", "admin", "shield"), "shield");
  assert.equal(resolveBadgeIcon("standing", "tech_admin", "admin"), "admin");
  assert.equal(resolveBadgeIcon("standing", "manager", "manager"), "manager");
});

test("the two collisions the register names are resolved the way the design said", () => {
  // A year is time, not rank.
  assert.equal(resolveBadgeIcon("medal", "veteran", "crown"), "clock");
  // The first people let in, before there were any applications to let them in to.
  assert.equal(resolveBadgeIcon("medal", "tester", "shield"), "key");
  // These two move together or they only swap which of them is wrong.
  assert.equal(resolveBadgeIcon("medal", "alpha_tester", "shield"), "zap");
  assert.equal(resolveBadgeIcon("medal", "beta_tester", "zap"), "bookmark");
});

test("a medal that never collided keeps what its catalogue row names", () => {
  // The override table is the record of a decision, not a second catalogue.
  assert.equal(resolveBadgeIcon("medal", "settled_in", "check"), "check");
  assert.equal(resolveBadgeIcon("medal", "conversationalist", "chats"), "chats");
  assert.equal(resolveBadgeIcon("medal", "storyteller", "chatRect"), "chatRect");
  for (const key of ["settled_in", "conversationalist", "storyteller"]) {
    assert.equal(MEDAL_ICON_OVERRIDES[key], undefined, `${key} needs no override`);
  }
});

test("a medal seeded tomorrow with a role's glyph is caught without anybody reading this file", () => {
  // The overrides cover the medals that exist today. The backstop is what keeps
  // the promise for the next one: somebody adding «Спонсор» with a crown gets a
  // seal rather than a silent second meaning for the crown.
  for (const icon of STANDING_BADGE_ICONS) {
    assert.equal(
      resolveBadgeIcon("medal", "some_future_medal", icon),
      MEDAL_FALLBACK_ICON,
      `a medal wearing ${icon} would mean whatever the role wearing it means`,
    );
  }
  assert.ok(!STANDING_BADGE_ICONS.has(MEDAL_FALLBACK_ICON), "the fallback must not collide in its turn");
});

test("a row naming no icon renders no icon, rather than being given one", () => {
  assert.equal(resolveBadgeIcon("medal", "veteran", null), null, "an override does not invent an icon");
  assert.equal(resolveBadgeIcon("standing", "owner", null), null);
  assert.equal(resolveBadgeIcon("medal", "tester", ""), null, "an empty string is not a name");
});

test("a standing is coloured and a medal is not, so the families differ by more than the word", () => {
  assert.equal(badgeTone("standing", "owner"), "pink");
  assert.equal(badgeTone("standing", "tech_admin"), "pink");
  assert.equal(badgeTone("standing", "admin"), "cyan");
  assert.equal(badgeTone("standing", "manager"), "cyan");
  assert.equal(badgeTone("standing", "something_new"), "cyan", "an unknown role is still a standing");
  for (const badge of SEEDED_BADGES.filter((entry) => entry.family === "medal")) {
    assert.equal(
      badgeTone("medal", badge.key),
      "muted",
      `«${badge.title}» is earned, not a rank, and must not be drawn as one`,
    );
  }
});
