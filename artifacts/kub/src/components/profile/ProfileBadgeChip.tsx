"use client";

import { KubBadge, KubIcon } from "@/components/kub";
import { KUB_ICON_NAMES, type KubIconName } from "@/components/kub/icons";
import { badgeTone } from "@/lib/badgeVocabulary";
import { chatRoleColourValue } from "@/lib/chatRolePalette";
import { badgeColourKey, type ProfileBadge } from "@/lib/profileBadges";

/**
 * One badge, wherever it is worn (D-180).
 *
 * It started inside `ProfileRoleSummary` and moved here when the member list
 * needed the same chip. That is rule 6 of `interface-material.md` read
 * literally: a member row repeats, so nothing in it may be glass, and the
 * product's answer for a flat chip that keeps a perimeter is `KubBadge`. Two
 * hand-written chips would have drifted apart by the second surface.
 *
 * **The colour never touches the words, and after D-214 that is a smaller claim
 * than it used to be.** The rule was written when the tone was the only colour
 * available: measured in this product and pinned by
 * `tests/unit/status-badge-contrast.test.mjs`, the role tones read 4.05, 4.18
 * and 3.82 against the surfaces they sit on, under the 4.5 a body of text
 * needs. A palette key is not under that ceiling — the eight are pinned at
 * 4.5:1 as TEXT — so the words could take it now. They do not, for a reason
 * that is about this card rather than about contrast:
 *
 *   `ChatRoleChip` sits directly above this strip on a member's card and does
 *   colour its word. The two answer different questions — «кто он здесь» and
 *   «кто он вообще» — and the colour on the word is the only thing that tells
 *   the two rows apart at a glance. Painting both would leave a person looking
 *   at two rows of coloured pills with no way to know which is the group's.
 *
 * **What the colour does take is the mark**, which is where the standing was
 * indistinguishable before. `badgeTone` collapses `owner` and `tech_admin` — the
 * only two standings anybody wears — into one `pink`, so the founder and the
 * technical administrator were drawn identically on a card while the catalogue
 * said amber and blue. The glyph is the one marker this chip carries («one
 * marker, not two», below), so the glyph is what carries the hue, at the token's
 * full strength rather than the perimeter's 55%.
 *
 * **The perimeter follows the mark rather than the tone**, and that is
 * deliberate rather than symmetric. Measured off the rendered pixels on the
 * ground the chip really composites on — which is neither `--kub-surface` nor
 * any other declared token — a 55% border reads 2.06:1 to 3.14:1: under the
 * 3:1 a mark needs on every ground but the dark theme at 1440, and a hair over
 * it there. It bounds the chip; it carries nothing. So a
 * border in a different hue from the mark cannot be a second signal, only a
 * contradiction, and that contradiction is what the administration panel had
 * been showing since the migration.
 *
 * «Чем выше статус тем красивее иконка» is the icon's weight — filled at the top
 * of the ladder, bold in the middle, regular below — inside the icon set the
 * product already has rather than a second set of assets.
 *
 * **Colour is never alone here.** Every standing keeps its own glyph, which
 * `badge-vocabulary.test.mts` refuses to let two badges share even by
 * silhouette; its own word; and its weight. Remove the hue and the chip says
 * exactly what it said before this change.
 */
export function ProfileBadgeChip({ badge }: { badge: ProfileBadge }) {
  const icon = badge.icon && KUB_ICON_NAMES.has(badge.icon) ? (badge.icon as KubIconName) : null;
  // One of eight enumerated keys or nothing: the stored string is never
  // interpolated, so what reaches the style attribute is one of eight fixed
  // references this build wrote. See `badgeColourKey` for the three refusals.
  const colourKey = badgeColourKey(badge);
  const accent = colourKey ? chatRoleColourValue(colourKey) : null;
  return (
    <KubBadge
      tone={badgeTone(badge.kind === "achievement" ? "medal" : "standing", badge.key)}
      accent={accent}
      pill
      // One marker, not two: the dot and the icon say the same thing, and a chip
      // wearing both reads as a bullet point with a picture in it.
      dot={!icon}
      title={badge.detail ?? undefined}
      data-badge-key={badge.key}
      data-badge-kind={badge.kind}
      data-badge-icon={icon ?? ""}
      data-badge-colour={colourKey ?? ""}
    >
      {icon && (
        // Wrapped whether or not there is an accent, so the box is the same in
        // both branches and a role with no colour renders byte for byte what it
        // rendered before. `KubIcon` defaults to `currentColor`.
        <span className="inline-flex shrink-0" style={accent ? { color: accent } : undefined}>
          <KubIcon name={icon} size={11} weight={badge.weight} />
        </span>
      )}
      {badge.title}
    </KubBadge>
  );
}
