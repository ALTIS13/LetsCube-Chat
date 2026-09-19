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
import { readChatRoleColour, type ChatRoleColour } from "./chatRolePalette.ts";

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

/**
 * The colour a chip may paint, or `null` for «take the tone» (D-214).
 *
 * Three refusals, each measured rather than chosen, and each one a way this
 * could look right and be wrong:
 *
 *   1. **A medal never takes a colour.** `profile_badges` answers `null::text`
 *      for the achievement half, so today this cannot happen — but the family
 *      separation is the reason the rule is here rather than in the SQL. A
 *      standing is a rank and is coloured; a medal is earned and is neutral,
 *      and a person wearing «Владелец» and «Ветеран» reads the first as a rank
 *      only because of that. A colour arriving on a medal would destroy it
 *      silently, and `badgeTone`'s `muted` is the decision being protected.
 *   2. **A hex is refused.** `roles.colour` held one until 2026-09-19 and holds
 *      one again if that migration is rolled back. D-214 measured those hexes
 *      at 1.50–2.06:1 in the light theme against a 3:1 floor, because they were
 *      the DARK palette's values used in a theme nobody checked them in. So a
 *      hex is not «a colour we cannot name», it is a colour known to be
 *      illegible, and the chip keeps the tone instead. This is also what makes
 *      the rollback safe without a second client deploy.
 *   3. **A key this build does not know is refused**, which is
 *      `readChatRoleColour`'s own contract: the column's constraint bounds the
 *      SHAPE of a key and cannot enumerate the palette, so a row may hold an
 *      entry a later build added. Falling back to the tone is visible; guessing
 *      is not.
 *
 * What survives all three is one of eight `--kub-role-*` keys, each pinned at
 * 4.5:1 as TEXT on all three panel surfaces in both themes by
 * `tests/unit/chat-role-palette.test.mts` — well above the 3:1 a mark needs.
 */
export function badgeColourKey(
  badge: Pick<ProfileBadge, "kind" | "colour">,
): ChatRoleColour | null {
  if (badge.kind !== "global_role") return null;
  return readChatRoleColour(badge.colour);
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
 * Where a badge belongs, and where it does not (D-213).
 *
 * This used to be a pair of counts — one standing and one medal beside a name
 * in the member list — and the question it answered was «how many fit». The
 * owner of this deployment answered a different question on 2026-09-18:
 *
 *   «оно до сих пор отображается как роли глобальные с надписями вместо
 *    значков»
 *
 * These badges are global by construction, not by accident. `profile_badges`
 * joins `user_global_roles ⋈ roles` filtered to `scope = 'global'`; it takes no
 * `chat_id` and never reads `chat_members`, and the client type says so —
 * `ProfileBadgeKind` is `"global_role" | "achievement"`. So a member row was
 * putting LETSCUBE-wide standing into a list about one group, one line below
 * that group's own standing, and the word «Владелец» stood on the row twice
 * meaning two different facts.
 *
 * **Both references agree, and neither does this.** In a Discord server's
 * member list a person carries their standing *in that server* — the name's
 * colour, at most one role icon, a crown for the owner — and Discord's own
 * account badges (Nitro, HypeSquad, staff) never appear there; they live on
 * the profile popout. Telegram prints a short grey word for the group role,
 * «админ» or a custom title the owner typed, and shows no site-wide rank at
 * all. Premium and verification are profile properties in both.
 *
 * So the rule is about scope rather than about room:
 *
 *   - **a member row** carries this group's standing and nothing else. It is
 *     already drawn the way the owner asked for — `crown` or `shield` at 12px
 *     with the words only in the accessible name — and the second line names
 *     the scope in Telegram's own manner («Владелец группы»).
 *   - **a person's card** carries who they are on LETSCUBE: every badge, in
 *     full, words included. The card is where a name is the subject rather
 *     than one entry in a list, and where a word has room to be read.
 *
 * `PROFILE_CARD_BADGE_LIMITS` is therefore uncapped, and that is the whole
 * reason the counts are gone rather than merely raised. The note that stood
 * here reached the same conclusion — «the whole strip belongs where the whole
 * strip has room, which is the person's own card» — and kept the row's chips
 * only because the card did not exist yet. D-168 built it on 2026-09-15.
 *
 * The measurement that produced the old count is worth keeping: with two
 * medals a member holding a standing and two medals wrapped to a second line
 * of chips and the four-person list grew from 223 points to 331, so the panel
 * read as a list of chip collections rather than a list of people. Removing
 * them takes that back to 223 and further.
 */
export const PROFILE_CARD_BADGE_LIMITS = { standings: Infinity, medals: Infinity } as const;
/**
 * The chips a strip shows, keeping the order `projectProfileBadges` put them in.
 *
 * A person may hold several public roles; only the highest is worn, which is
 * section 4.5's «at most one chip» for the standing. The rows arrive sorted, so
 * taking the first of each family takes the right ones.
 */
export function badgeStrip(
  worn: readonly ProfileBadge[],
  limits: { standings: number; medals: number } = PROFILE_CARD_BADGE_LIMITS,
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
