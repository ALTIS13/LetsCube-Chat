/**
 * Which glyph a badge wears, and the rule that no glyph means two things (D-180).
 *
 * D-180 is «nobody could see who anybody was»: a contact card said
 * «Пользователь» to everyone. Slice 1 opened the read path. This module is the
 * defect one level down — a strip that finally shows who somebody is, drawn with
 * icons that say two different things at once.
 *
 * **The two collisions, read out of the seeds rather than guessed.** The role
 * badges are set by `20260913140000_profile_badges.sql`: `owner` wears `crown`,
 * `tech_admin` `admin`, `admin` `shield`, `manager` `manager`. The medals come
 * from `20260903210000_profile_achievements_cosmetics.sql` and the two that
 * follow it, and three of them name an icon a role has already taken:
 *
 *   - `crown` would mean «Владелец» and «Ветеран»;
 *   - `shield` would mean «Администратор», «Тестировщик» and «Альфа-тестер» —
 *     and the last two already collide with each other in the settings screen
 *     today, which is the oldest half of this defect.
 *
 * **Resolved here rather than in the database, deliberately.** Section 4.5 of
 * the proposal names the fix as four `update public.achievements` statements,
 * and says in as many words that it «changes a badge somebody already holds, so
 * it is an owner decision and its own step, shown as pixels before it is
 * applied». So the interface resolves it and the data is left alone: nothing
 * ships wearing a borrowed glyph, and the owner still gets to decide what the
 * catalogue says. The overrides below name exactly the icons that step would
 * write, so applying it later makes this table agree with the database rather
 * than fight it.
 *
 * The reasons for each choice are the proposal's: a year is time rather than
 * rank, so `veteran` takes `clock`; the testers who came before the first
 * applications were the first people let in, so `tester` takes `key`; and
 * `alpha_tester` takes `zap` from `beta_tester`, which moves to `bookmark`.
 * That last pair has to move together or the two testers simply swap which of
 * them is wrong, which is why they are one table and not two decisions.
 *
 * Pure: no React, no browser API, no `@/` alias, so `node --test` reads it.
 */

/** Which family a badge belongs to; section 4.5's own word. */
export type BadgeFamily = "standing" | "medal";

/**
 * The icons the global roles wear, as `20260913140000_profile_badges.sql` seeds
 * them.
 *
 * This is the list a medal may not borrow from. It is written out rather than
 * derived, because the roles live in a table an administrator may edit and a
 * rule that reads its own input cannot refuse anything.
 */
export const STANDING_BADGE_ICONS: ReadonlySet<string> = new Set([
  "crown",
  "admin",
  "shield",
  "manager",
]);

/**
 * What a medal wears instead of the icon its catalogue row names.
 *
 * Only the three that collide and the one that has to move out of their way.
 * Every other medal keeps the icon the catalogue gives it, so this table stays
 * the record of a decision rather than a second catalogue.
 */
export const MEDAL_ICON_OVERRIDES: Readonly<Record<string, string>> = {
  veteran: "clock",
  tester: "key",
  alpha_tester: "zap",
  beta_tester: "bookmark",
};

/**
 * What a medal wears when it still collides after the table above.
 *
 * A future medal seeded with `crown` would otherwise reintroduce the exact
 * defect this module exists for, and it would do it silently, months after
 * anybody read this file. `verified` is a seal rather than a rank, so it says
 * «earned» without claiming a place on any ladder.
 */
export const MEDAL_FALLBACK_ICON = "verified";

/**
 * The glyph a badge actually renders with.
 *
 * A standing wears whatever its role names: the roles are the ladder, and an
 * administrator editing one is making a deliberate choice. A medal is checked,
 * because the two catalogues were seeded months apart by people who could not
 * see each other's icons.
 */
export function resolveBadgeIcon(
  family: BadgeFamily,
  key: string,
  icon: string | null | undefined,
): string | null {
  if (!icon) return null;
  if (family !== "medal") return icon;
  const override = MEDAL_ICON_OVERRIDES[key];
  if (override) return override;
  return STANDING_BADGE_ICONS.has(icon) ? MEDAL_FALLBACK_ICON : icon;
}

/**
 * The tone a chip is drawn in.
 *
 * Section 4.5 separates the families by shape first and tone second: a standing
 * is coloured, a medal is neutral. That is not decoration — a person wearing
 * «Владелец» and «Ветеран» reads the first as a rank and the second as
 * something earned, and if both were cyan the only difference left would be the
 * word.
 *
 * The tone never reaches a text node. `KubBadge` puts it on the dot and the
 * border because the role tones measure 4.05, 4.18 and 3.82 against the
 * surfaces they sit on, under the 4.5 a label needs;
 * `tests/unit/status-badge-contrast.test.mjs` is what refuses the other choice.
 */
export function badgeTone(family: BadgeFamily, key: string): "pink" | "cyan" | "muted" {
  if (family === "medal") return "muted";
  return key === "owner" || key === "tech_admin" ? "pink" : "cyan";
}

/**
 * What the two catalogues seed today, for a test to hold the vocabulary against.
 *
 * Copied from the migrations named in the header rather than read from them, so
 * the test fails when a seed changes underneath the interface instead of
 * agreeing with it by construction. `sortOrder` is the catalogue's own, which is
 * the order the medals come out in.
 */
export interface SeededBadge {
  family: BadgeFamily;
  key: string;
  title: string;
  /** The icon the database names today, before any of the above applies. */
  seededIcon: string;
  sortOrder: number;
}

export const SEEDED_BADGES: readonly SeededBadge[] = [
  { family: "standing", key: "owner", title: "Владелец", seededIcon: "crown", sortOrder: 100 },
  { family: "standing", key: "tech_admin", title: "Тех. администратор", seededIcon: "admin", sortOrder: 100 },
  { family: "standing", key: "admin", title: "Администратор", seededIcon: "shield", sortOrder: 80 },
  { family: "standing", key: "manager", title: "Менеджер", seededIcon: "manager", sortOrder: 60 },
  { family: "medal", key: "tester", title: "Тестировщик", seededIcon: "shield", sortOrder: 10 },
  { family: "medal", key: "alpha_tester", title: "Альфа-тестер", seededIcon: "shield", sortOrder: 15 },
  { family: "medal", key: "beta_tester", title: "Бета-тестер", seededIcon: "zap", sortOrder: 20 },
  { family: "medal", key: "settled_in", title: "Освоился", seededIcon: "check", sortOrder: 30 },
  { family: "medal", key: "veteran", title: "Ветеран", seededIcon: "crown", sortOrder: 40 },
  { family: "medal", key: "conversationalist", title: "Собеседник", seededIcon: "chats", sortOrder: 50 },
  { family: "medal", key: "storyteller", title: "Рассказчик", seededIcon: "chatRect", sortOrder: 60 },
];
