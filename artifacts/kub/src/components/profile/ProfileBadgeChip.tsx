"use client";

import { KubBadge, KubIcon } from "@/components/kub";
import { KUB_ICON_NAMES, type KubIconName } from "@/components/kub/icons";
import { badgeTone } from "@/lib/badgeVocabulary";
import type { ProfileBadge } from "@/lib/profileBadges";

/**
 * One badge, wherever it is worn (D-180).
 *
 * It started inside `ProfileRoleSummary` and moved here when the member list
 * needed the same chip. That is rule 6 of `interface-material.md` read
 * literally: a member row repeats, so nothing in it may be glass, and the
 * product's answer for a flat chip that keeps a perimeter is `KubBadge`. Two
 * hand-written chips would have drifted apart by the second surface.
 *
 * **The colour never touches the words.** Measured in this product and pinned by
 * `tests/unit/status-badge-contrast.test.mjs`: the role tones read 4.05, 4.18
 * and 3.82 against the surfaces they sit on, under the 4.5 a body of text needs.
 * So the tone goes on `KubBadge`'s dot and border, where the requirement is 3:1
 * and every tone clears it, and the name stays in the interface text colour.
 *
 * «Чем выше статус тем красивее иконка» is the icon's weight — filled at the top
 * of the ladder, bold in the middle, regular below — inside the icon set the
 * product already has rather than a second set of assets.
 */
export function ProfileBadgeChip({ badge }: { badge: ProfileBadge }) {
  const icon = badge.icon && KUB_ICON_NAMES.has(badge.icon) ? (badge.icon as KubIconName) : null;
  return (
    <KubBadge
      tone={badgeTone(badge.kind === "achievement" ? "medal" : "standing", badge.key)}
      pill
      // One marker, not two: the dot and the icon say the same thing, and a chip
      // wearing both reads as a bullet point with a picture in it.
      dot={!icon}
      title={badge.detail ?? undefined}
      data-badge-key={badge.key}
      data-badge-kind={badge.kind}
      data-badge-icon={icon ?? ""}
    >
      {icon && <KubIcon name={icon} size={11} weight={badge.weight} />}
      {badge.title}
    </KubBadge>
  );
}
