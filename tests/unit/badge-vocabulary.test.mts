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
import { readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// And the glyphs have to be tellable apart at the size they are drawn.
//
// Every test above pins which NAME a badge wears. None of them noticed that
// two of those names pointed at the same picture: `admin` was `ShieldCheck`
// and `shield` is `Shield`, so «Тех. администратор» and «Администратор» were
// a shield with a tick beside a shield — one object at the 11px a chip draws
// at. The owner's report of 2026-09-18 asked for «значки», and two glyphs
// nobody can separate are not two.
//
// Read as source rather than imported: `icons.ts` pulls in
// `@phosphor-icons/react`, which `node --test` has no business loading, and
// the mapping is a flat table a reader can parse exactly.
// ---------------------------------------------------------------------------

/** `name: { Icon: Component }` from the build's own icon table. */
function iconTable(): Map<string, string> {
  const source = readFileSync("artifacts/kub/src/components/kub/icons.ts", "utf8");
  const table = new Map<string, string>();
  for (const line of source.split(String.fromCharCode(10))) {
    const marked = line.indexOf("{ Icon: ");
    if (marked < 0) continue;
    const colon = line.indexOf(":");
    if (colon < 0 || colon > marked) continue;
    const name = line.slice(0, colon).trim();
    if (!name || name.includes(" ") || name.startsWith("/")) continue;
    const rest = line.slice(marked + "{ Icon: ".length);
    const component = rest.split(",")[0].split(" ")[0].split("}")[0].trim();
    if (component) table.set(name, component);
  }
  return table;
}

test("the icon table is readable, and knows the names this file names", () => {
  // The control first: a guard that parsed nothing would pass every assertion
  // below by having nothing to check.
  const table = iconTable();
  assert.ok(table.size > 40, `only ${table.size} icons parsed — the table's shape changed`);
  for (const name of STANDING_BADGE_ICONS) {
    assert.ok(table.has(name), `the standing glyph «${name}» is not in the build's icon table`);
  }
});

/**
 * Phosphor components that read as the same object at the 11px a chip draws at.
 *
 * Written down rather than computed, because «these two look alike» is a human
 * observation about pictures and there is nothing in a component name to derive
 * it from. That is the whole point: the first version of the test below simply
 * compared component names, `ShieldCheck` came back different from `Shield`,
 * and the mutation that put «Тех. администратор» back on a shield beside
 * «Администратор»'s shield **stayed green**. The check was not weak, it was
 * measuring a different thing than the sentence above it claimed.
 *
 * A group here is a silhouette. At 11px the tick inside `ShieldCheck` is about
 * one pixel of ink and the eye gets a shield; the same is true of a person with
 * anything attached to them, and of the four speech bubbles.
 */
const ONE_PICTURE_AT_BADGE_SIZE: readonly (readonly string[])[] = [
  ["Shield", "ShieldCheck", "ShieldSlash", "ShieldStar", "ShieldPlus", "ShieldWarning"],
  ["User", "UserCircle", "UserGear", "UserPlus", "UserMinus", "UsersThree", "IdentificationBadge"],
  ["ChatCircle", "ChatsCircle", "ChatText", "ChatRect"],
  ["Gear", "GearSix", "Sliders"],
  ["SealCheck", "CheckCircle", "Check", "Checks"],
];

/** Which silhouette a component belongs to, or the component itself. */
function silhouette(component: string): string {
  for (const group of ONE_PICTURE_AT_BADGE_SIZE) {
    if (group.includes(component)) return group[0];
  }
  return component;
}

test("the four standings wear four pictures a person can tell apart", () => {
  const table = iconTable();
  const drawn = new Map<string, string[]>();
  for (const name of STANDING_BADGE_ICONS) {
    const component = table.get(name) ?? name;
    drawn.set(silhouette(component), [...(drawn.get(silhouette(component)) ?? []), name]);
  }
  const shared = [...drawn.entries()].filter(([, names]) => names.length > 1);
  assert.deepEqual(
    shared,
    [],
    "two standings draw one picture: " +
      shared
        .map(([shape, names]) => `${names.join(" and ")} both read as ${shape}`)
        .join("; "),
  );
  assert.equal(drawn.size, STANDING_BADGE_ICONS.size);
});

test("the silhouette table is reached, and is not a list of names nothing uses", () => {
  // A table of groups that matched no component would make the test above the
  // naive one again, silently. So: every standing's component must be *in* a
  // group, and the groups must be the reason the answer is what it is.
  const table = iconTable();
  const components = [...STANDING_BADGE_ICONS].map((name) => table.get(name) ?? name);
  const grouped = components.filter((component) => silhouette(component) !== component);
  assert.ok(
    grouped.length >= 2,
    `only ${grouped.length} of the four standings is covered by a silhouette group ` +
      `(${components.join(", ")}) — the table has stopped describing this icon set`,
  );
});

test("no medal borrows a standing's picture either, after resolution", () => {
  // The names are already separated by `MEDAL_ICON_OVERRIDES`; this asks the
  // question one level down, of the pictures those names resolve to. Three
  // medals are seeded with `shield` and a fourth with `crown`, so the override
  // table is what has to hold — and it holds names, not pictures.
  const table = iconTable();
  const standingPictures = new Set(
    [...STANDING_BADGE_ICONS].map((name) => table.get(name) ?? name),
  );
  for (const badge of SEEDED_BADGES.filter((entry) => entry.family === "medal")) {
    const resolved = resolveBadgeIcon("medal", badge.key, badge.seededIcon);
    const picture = resolved ? table.get(resolved) ?? resolved : null;
    assert.ok(
      picture && !standingPictures.has(picture),
      `«${badge.title}» resolves to ${resolved} which draws ${picture} — a standing's own picture`,
    );
  }
});
