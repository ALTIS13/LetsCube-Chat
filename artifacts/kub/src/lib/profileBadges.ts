/**
 * What somebody else is allowed to see about who a person is (D-180).
 *
 * **The owner, 2026-09-13:** «есть роли также глобальные которые у нас отвечают
 * за работников, админов приложения и т.п … сделать по типу лычек как опять же
 * в дискорде, в которых написано кто такой, за что получил медальку … чем выше
 * статус тем красивее иконка».
 *
 * Almost all of it already existed. `roles` has carried `priority` and `colour`
 * since 2026-09-04, added for this same request; the administration panel edits
 * them; seven achievements have their catalogue, their criteria and their
 * granting. What was missing was a **read path**: measured on production today, a
 * signed-in account reading `roles` gets its own rows and nobody else's, so
 * `ProfileRoleSummary` — a component that already draws roles as chips — was
 * switched off for everyone but administrators.
 *
 * `public.profile_badges(uuid[])` is that path, and this module is what a strip
 * of chips is made of once the rows arrive. Pure: no React, no browser API, no
 * `@/` alias, so `node --test` reads it directly.
 *
 * **The ladder is the icon's weight.** «Чем выше статус тем красивее иконка» is
 * answered inside the icon set the product already has rather than with a second
 * asset pipeline: at 100 and above the glyph is filled, from 80 bold, below that
 * regular. If the rule is ever removed the badge degrades to a legible glyph
 * rather than to nothing.
 *
 * **Which glyph is not decided here.** Three medals name an icon a role has
 * already taken, so the strip would have shipped with `crown` meaning both
 * «Владелец» and «Ветеран». That is `badgeVocabulary.ts`, and it is applied in
 * the projection below rather than at each surface: a rule remembered per call
 * site is a rule the next call site forgets.
 */

import { resolveBadgeIcon } from "./badgeVocabulary.ts";

/** One row as `profile_badges` returns it. */
export interface ProfileBadgeRow {
  user_id: string;
  kind: string;
  key: string;
  title: string | null;
  detail: string | null;
  icon: string | null;
  colour: string | null;
  rank: number | null;
}

export type ProfileBadgeKind = "global_role" | "achievement";
export type ProfileBadgeWeight = "fill" | "bold" | "regular";

export interface ProfileBadge {
  kind: ProfileBadgeKind;
  key: string;
  /** What the chip says. */
  title: string;
  /** Why it is worn — the medal's own sentence, for a title attribute or a hint. */
  detail: string | null;
  /** A `KubIcon` name, or null when the row named none or named one this build does not have. */
  icon: string | null;
  colour: string | null;
  weight: ProfileBadgeWeight;
}

/**
 * Filled at the top of the ladder, bold in the middle, regular below.
 *
 * The thresholds are the seeded priorities: `owner` and `tech_admin` are 100,
 * `admin` is 80, `manager` is 60. A medal's rank is far above any of them by
 * construction — `100000 - sort_order` — so medals would all come out filled,
 * which is why `projectProfileBadges` gives them `regular` regardless: a medal
 * is not a rank and must not read as the top of one.
 */
export function badgeWeight(rank: number | null): ProfileBadgeWeight {
  const value = typeof rank === "number" && Number.isFinite(rank) ? rank : 0;
  if (value >= 100) return "fill";
  if (value >= 80) return "bold";
  return "regular";
}

export interface ProjectBadgesOptions {
  /**
   * The icon names this build actually has. A row naming one it does not — an
   * older client meeting a newer seed — renders without an icon rather than
   * throwing, which is why the check is here and not at the call site.
   */
  knownIcons?: ReadonlySet<string>;
  /** How many chips the surface has room for. The rest are counted, not dropped. */
  limit?: number;
}

/**
 * The chips for one person, in the order they are worn.
 *
 * **Standing first, then medals**, and that takes two keys rather than one. The
 * design said a single descending sort of `rank` would do it, and the
 * arithmetic says otherwise: a role's rank is its priority (100, 80, 60) while a
 * medal's is `100000 - sort_order` (99 990, 99 985, …), so one sort puts every
 * medal above every role. Rendered, it read backwards — «Ветеран» standing
 * before «Владелец» on a contact card. So the kind is the first key and the rank
 * the second, which keeps the priority order among roles and the catalogue's own
 * order among medals. Ties fall back to the title, so two answers to the same
 * question come out in the same order rather than in the server's.
 */
export function projectProfileBadges(
  rows: readonly ProfileBadgeRow[],
  userId: string,
  options: ProjectBadgesOptions = {},
): ProfileBadge[] {
  const mine = rows.filter((row) => row.user_id === userId && (row.title ?? "").trim() !== "");
  const projected = mine.map((row) => {
    const kind: ProfileBadgeKind = row.kind === "achievement" ? "achievement" : "global_role";
    // Resolved before the build's own icon set is consulted, so a medal that
    // borrows a role's glyph is corrected rather than merely dropped, and the
    // `knownIcons` guard below still catches a name this build does not have.
    const icon = resolveBadgeIcon(kind === "achievement" ? "medal" : "standing", row.key, row.icon);
    const known = !icon || !options.knownIcons || options.knownIcons.has(icon);
    return {
      kind,
      key: row.key,
      title: (row.title ?? "").trim(),
      detail: row.detail && row.detail.trim() !== "" ? row.detail.trim() : null,
      icon: known ? icon : null,
      colour: row.colour ?? null,
      // A medal is not a rank: see `badgeWeight`.
      weight: kind === "achievement" ? ("regular" as const) : badgeWeight(row.rank),
      rank: typeof row.rank === "number" ? row.rank : 0,
    };
  });

  const kindOrder = (kind: ProfileBadgeKind) => (kind === "global_role" ? 0 : 1);
  projected.sort(
    (left, right) =>
      kindOrder(left.kind) - kindOrder(right.kind) ||
      right.rank - left.rank ||
      left.title.localeCompare(right.title, "ru-RU"),
  );
  const stripped = projected.map(({ rank: _rank, ...badge }) => badge);
  return typeof options.limit === "number" ? stripped.slice(0, Math.max(0, options.limit)) : stripped;
}

/** How many were left over once the strip took what it had room for. */
export function hiddenBadgeCount(total: number, limit: number | undefined): number {
  if (typeof limit !== "number") return 0;
  return Math.max(0, total - Math.max(0, limit));
}

/** What a strip shows, and what it only counts. */
export interface BadgeStrip {
  shown: ProfileBadge[];
  /** Everything the surface had no room for, as one «+N». */
  hidden: number;
}

/**
 * How many of each family a strip beside a name has room for (D-180).
 *
 * Section 5.1 of the proposal: «then the standing chip, then at most two medals
 * and a «+N» for the rest». Counted per family rather than as one limit of
 * three, and the difference is section 4.5's «at most one chip» for the
 * standing: somebody holding two public roles would otherwise spend the row's
 * whole budget on two ranks and show nothing they earned. It is not about the
 * standing being pushed off — standings sort first, so a flat limit would never
 * drop one. That was the reason written here first, and the mutation that was
 * supposed to prove it stayed green, which is how it got corrected.
 */
export const MEMBER_ROW_BADGE_LIMITS = { standings: 1, medals: 1 } as const;

/**
 * One medal rather than the proposal's two, decided by looking at the rendered
 * list at 390 points.
 *
 * With two, a member holding a standing and two medals wrapped to a second line
 * of chips, and the four-person list grew from 223 to 331 points — the panel
 * stopped reading as a list of people and started reading as a list of chip
 * collections. Neither Telegram nor Discord stacks chips in a member list;
 * Discord puts one icon beside a name and keeps the rest for the profile.
 *
 * So the row shows the standing, the newest medal and «+N», and the whole strip
 * belongs where the whole strip has room — which is the person's own card,
 * opened from the row. That opening is D-168 and is not built yet, which is the
 * one cost of this decision and is written down rather than hidden.
 */

/**
 * The chips a strip shows, keeping the order `projectProfileBadges` put them in.
 *
 * A person may hold several public roles; only the highest is worn, which is
 * section 4.5's «at most one chip» for the standing. The rows arrive sorted, so
 * taking the first of each family takes the right ones.
 */
export function badgeStrip(
  worn: readonly ProfileBadge[],
  limits: { standings: number; medals: number } = MEMBER_ROW_BADGE_LIMITS,
): BadgeStrip {
  let standings = 0;
  let medals = 0;
  const shown: ProfileBadge[] = [];
  for (const badge of worn) {
    if (badge.kind === "achievement") {
      if (medals >= limits.medals) continue;
      medals += 1;
    } else {
      if (standings >= limits.standings) continue;
      standings += 1;
    }
    shown.push(badge);
  }
  return { shown, hidden: worn.length - shown.length };
}

/**
 * The key of every person whose badges an answer accounted for.
 *
 * A person with no badges is not in the answer at all, so «asked and got
 * nothing» and «never asked» look identical in the rows themselves. The caller
 * keeps the set of ids it asked about; this is only the other half of that
 * comparison.
 */
export function badgeUserIds(rows: readonly ProfileBadgeRow[]): Set<string> {
  return new Set(rows.map((row) => row.user_id));
}
