"use client";

import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubBadge, KubButton, KubIcon } from "@/components/kub";
import { ProfileBadgeChip } from "@/components/profile/ProfileBadgeChip";
import { ProfileUsernameLine } from "@/components/profile/ProfileUsernameLine";
import { memberDisplayName } from "@/lib/chatMemberList";
import type { BadgeStrip } from "@/lib/profileBadges";
import type { Profile } from "@/types/database";

/**
 * The small surface: who this is, in one glance, with a way to the whole thing.
 *
 * ## Why this is a different component and not the card with a `compact` prop
 *
 * Because Discord's is. `docs/operations/reference-clients.md` §15.1 read the
 * shipped bundle: the popout body is module **851588** and the human modal is
 * module **808261**, and they share the *leaves* — bio, roles, connections, the
 * note, the overflow menu — not a root. Module 207634 is one table keyed by
 * presentation for the numbers that differ (80px avatar over a 300x105 banner
 * for the popout, 120 over 600x210 for the modal), and each presentation passes
 * its own tag into the same hooks.
 *
 * What keeps them honest is **not** the markup, which was this project's
 * assumption and the correction that mattered most: both read one
 * `UserProfileStore` through one gated fetch. Ours is `lib/profileCache.ts` and
 * `hooks/useUserProfile.ts`, and it was written before this file existed for
 * exactly that reason.
 *
 * ## What it carries, and the rule for what it may carry
 *
 * **Everything here must also be on the full card.** That is what makes this a
 * summary rather than a second implementation of a person, and it is asserted
 * mechanically rather than promised in prose — see
 * `tests/unit/profile-tier.test.mts`, which reads both files and refuses a
 * block that exists only here.
 *
 * So: the face, the name, the никнейм with the copy control the search's
 * «Мини-профиль» used to own, presence when it can be said, a **capped** badge
 * strip, a clamped bio, «Открыть чат», and the escalation.
 *
 * What it deliberately leaves to the full card: the group's roles and the
 * vocabulary for handing them out (a management affordance — one door per
 * action), the join date, the uncapped strip, and the whole of the bio.
 */
export function UserProfileCompact({
  profile,
  isSelf,
  presenceLabel,
  showOnlineDot,
  badges,
  opening,
  onOpenChat,
  onEscalate,
}: {
  profile: Profile;
  isSelf: boolean;
  /** «в сети», «был(а) 12 мин назад» — empty when presence cannot be read. */
  presenceLabel: string;
  showOnlineDot: boolean;
  /** Capped by `PROFILE_COMPACT_BADGE_LIMITS`; the remainder is one «+N». */
  badges: BadgeStrip | null;
  opening: boolean;
  onOpenChat: () => void;
  /**
   * «Полный профиль». Always drawn on this surface and never on the other one,
   * because Discord's modal does not carry the string at all — a control that
   * opens the surface you are looking at is the inert control §8 refuses.
   */
  onEscalate: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center px-5 py-5 text-center"
      data-profile-tier="compact"
      data-member-card-id={profile.id}
    >
      <UserAvatar user={profile} size="lg" showOnline={showOnlineDot} />
      <div className="mt-3 max-w-full text-base font-bold text-[color:var(--kub-text)] [overflow-wrap:anywhere]">
        {memberDisplayName(profile)}
      </div>
      <ProfileUsernameLine username={profile.username} className="mt-1" />
      {/* Said only when it can be, exactly as the full card says it: a person
          who turned presence off writes `online_at = null`, and «не в сети»
          would report that refusal as a fact about where they are. */}
      {presenceLabel && (
        <div className="mt-1 text-sm text-[color:var(--kub-muted)]" data-testid="member-card-presence">
          {presenceLabel}
        </div>
      )}
      {badges && (
        <div
          className="mt-3 flex max-w-full flex-wrap items-center justify-center gap-1.5"
          data-testid="member-card-badges"
        >
          {badges.shown.map((badge) => (
            <ProfileBadgeChip key={`${badge.kind}:${badge.key}`} badge={badge} />
          ))}
          {badges.hidden > 0 && (
            <KubBadge tone="muted" pill>
              +{badges.hidden}
            </KubBadge>
          )}
        </div>
      )}
      {profile.bio && (
        <p
          className="mt-3 line-clamp-2 max-w-xs text-sm leading-relaxed text-[color:var(--kub-muted)] [overflow-wrap:anywhere]"
          data-testid="member-card-bio"
        >
          {profile.bio}
        </p>
      )}
      <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
        <KubButton
          variant="primary"
          fullWidth
          // Your own row opens your own card, because hiding it would make the
          // list inconsistent for exactly one reader. The action that makes no
          // sense there is the one refused, not the card.
          disabled={isSelf}
          loading={opening}
          leftIcon={<KubIcon name="chatBubble" size={14} />}
          onClick={onOpenChat}
          data-testid="member-card-open-chat"
        >
          Открыть чат
        </KubButton>
        {/* A full-width secondary button rather than an item in an overflow
            menu. Discord places the same string by how much room the
            presentation has — hidden in the popout's «…» menu, promoted to a
            full-width secondary button in the SIDEBAR presentation — and this
            card has no overflow menu at all, so building one to hide a single
            control behind would be less discoverable than the placement
            Discord itself uses where there is no menu. */}
        <KubButton
          variant="secondary"
          fullWidth
          rightIcon={<KubIcon name="chevronRight" size={14} />}
          onClick={onEscalate}
          data-testid="profile-open-full"
        >
          Полный профиль
        </KubButton>
      </div>
    </div>
  );
}
