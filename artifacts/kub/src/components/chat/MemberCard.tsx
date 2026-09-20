"use client";

/**
 * The one card this product draws for a person.
 *
 * It was a local function inside `ChatInfoPanel` until D-283, and that was the
 * whole of the regression: the card lived *inside* a conversation, so the only
 * route to it went through opening one. The consolidation comment in
 * `ChatList` that removed the second profile modal was right about the danger
 * and wrong about nothing else — two implementations do drift. A component in
 * its own file, drawn by both the panel's fourth layer and the standalone
 * overlay, keeps the one implementation and gives back the route.
 *
 * Nothing about the markup changed in the move. What the two callers differ in
 * is what they can say: the panel knows this person's standing in this chat and
 * the group's vocabulary of roles, and the overlay knows neither, so it passes
 * the empty answers this card already draws nothing for.
 */

import { ChatAvatar, UserAvatar } from "@/components/ui/ChatAvatar";
import { KubBadge, KubButton, KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import { ChatRoleChip } from "./ChatRoleChip";
import { DISABLED_SINK } from "@/lib/controlSurface";
import type { ChatRole } from "@/lib/chatRoles";
import { ProfileBadgeChip } from "@/components/profile/ProfileBadgeChip";
import { ProfileUsernameLine } from "@/components/profile/ProfileUsernameLine";
import { memberDisplayName } from "@/lib/chatMemberList";
import type { BadgeStrip } from "@/lib/profileBadges";
import type { MutualChats } from "@/lib/profileMutualChats";
import type { Profile } from "@/types/database";

/**
 * A person, plus the two facts a chat knows about them.
 *
 * `chat_role` and `joined_at` are the chat's, so the overlay that draws this
 * card outside any chat passes «member» and `null` — and `formatJoinedAt`
 * already answers `MEMBER_JOINED_UNKNOWN` for the second, which is why the
 * line is suppressed by the caller rather than faked here.
 */
export type MemberRow = Profile & {
  chat_role: "owner" | "admin" | "member";
  joined_at?: string | null;
};

/**
 * The person a member row opens (D-168).
 *
 * What the entry asked for is the bottom half of this: the row itself «carries
 * nothing at all — no username, no last seen, no join date». Two of those three
 * belong on the row, where they are scanned; the join date belongs here, where
 * it is read. `d424f96` established the same division for badges — one on the
 * row, the whole strip on the person's own card — after photographing a
 * three-line row at 390 points, and this follows it rather than re-litigating
 * it.
 *
 * No perimeter anywhere in here, per rule 11 of the material contract: the card
 * is a layer of the panel, not a box inside it, and the one thing that does
 * carry a line is `KubNotice`, which rule 11 lists as a line that means
 * something.
 */
export function MemberCard({
  member,
  isSelf,
  roleLabel,
  presenceLabel,
  joinedLabel,
  showOnlineDot,
  badges,
  groupRoles,
  groupVocabulary,
  onToggleGroupRole,
  assigning,
  opening,
  onOpenChat,
  mutualChats = null,
  onOpenMutualChat,
}: {
  member: MemberRow;
  isSelf: boolean;
  roleLabel: string;
  /** «в сети», «был(а) 12 мин назад» — empty when presence cannot be read. */
  presenceLabel: string;
  /**
   * «В группе с 3 сентября 2026», or empty.
   *
   * Passed in rather than computed here, for the same reason `roleLabel` is:
   * it is a fact about **a chat**, and this card is now drawn in one place
   * that has a chat and one that does not. `formatJoinedAt(null)` answers
   * «Дата входа неизвестна», which in a standalone profile would be a sentence
   * about a group the reader never asked about. An empty string draws nothing,
   * exactly as an empty `roleLabel` does.
   */
  joinedLabel: string;
  showOnlineDot: boolean;
  badges: BadgeStrip | null;
  /** What this group calls this person, highest first (D-215). */
  groupRoles: ChatRole[];
  /** Every role the group has, or null when this account may not hand them out. */
  groupVocabulary: ChatRole[] | null;
  onToggleGroupRole: (role: ChatRole, wear: boolean) => void;
  /** The role id being written, so one control shows it rather than all of them. */
  assigning: string | null;
  opening: boolean;
  onOpenChat: () => void;
  /**
   * The groups and channels this person and the reader are both in.
   *
   * The one list Discord's profile modal has that has an honest analogue here
   * — «Mutual Servers» — and the reason the full card is worth escalating to.
   * Tabs are for lists and the body is for facts (§15.1), and with one list
   * there is no tab bar to build: a section is a tab bar's honest form when
   * there is one tab.
   *
   * Optional, and absent inside `ChatInfoPanel`: there the card is already
   * inside one of the groups they share, and a list whose first entry is the
   * room you are standing in reads as a mistake.
   */
  mutualChats?: MutualChats | null;
  /** Opens one of them. Absent means the rows are not pressable. */
  onOpenMutualChat?: (chatId: string) => void;
}) {
  return (
    <div
      className="flex flex-col items-center px-5 py-6 text-center"
      data-profile-tier="full"
      data-member-card-id={member.id}
    >
      <UserAvatar user={member} size="xl" showOnline={showOnlineDot} />
      <div className="mt-4 max-w-full text-lg font-bold text-[color:var(--kub-text)] [overflow-wrap:anywhere]">
        {memberDisplayName(member)}
      </div>
      {/* The shared leaf, not a second spelling of the same line (D-283's
          two-tier follow-up). The copy control came with it from the search's
          «Мини-профиль», which this product no longer draws: folding that
          surface into these two would otherwise have dropped the one thing it
          could do that neither of them could. */}
      <ProfileUsernameLine username={member.username} className="mt-1" />
      {roleLabel && (
        <div className="mt-2 text-sm font-semibold text-[color:var(--kub-accent-text)]">
          {roleLabel}
        </div>
      )}
      {/* Said only when it can be. A person who turned presence off writes
          `online_at = null`, and «не в сети» would report that refusal as a
          fact about where they are. */}
      {presenceLabel && (
        <div className="mt-1 text-sm text-[color:var(--kub-muted)]" data-testid="member-card-presence">
          {presenceLabel}
        </div>
      )}
      {joinedLabel && (
        <div className="mt-1 text-xs text-[color:var(--kub-muted)]" data-testid="member-card-joined">
          {joinedLabel}
        </div>
      )}
      {/* This group's own words for this person, above LETSCUBE's (D-215).
          Above, and separated, because the two answer different questions —
          «кто он здесь» and «кто он вообще» — and the row above has already
          shown only the first. Discord's popout stacks them the same way: the
          server's roles first, the account's badges under them. */}
      {(groupRoles.length > 0 || (groupVocabulary?.length ?? 0) > 0) && (
        <div className="mt-4 w-full" data-testid="member-card-group-roles">
          <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
            {groupRoles.map((role) => (
              <ChatRoleChip
                key={role.id}
                role={role}
                onRemove={groupVocabulary ? () => onToggleGroupRole(role, false) : undefined}
              />
            ))}
            {groupRoles.length === 0 && (
              <span className="text-xs text-[color:var(--kub-muted)]">Ролей в группе нет</span>
            )}
          </div>
          {/* What is left to give. Only the roles this person does not wear, so
              the control is «дать» and never a toggle that looks like a filter. */}
          {groupVocabulary && groupVocabulary.length > 0 && (
            <div
              className="mt-2 flex max-w-full flex-wrap items-center justify-center gap-1.5"
              data-testid="member-card-role-picker"
            >
              {groupVocabulary.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => onToggleGroupRole(role, true)}
                  disabled={assigning !== null}
                  aria-label={`Выдать роль «${role.name}»`}
                  data-testid="member-card-role-give"
                  data-role-id={role.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-dashed border-[color:var(--kub-border-color)] px-2 py-0.5 text-[12px] text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                    // The sink, not a fade: this card is translucent, and
                    // lowering a control's opacity on it shows the wallpaper
                    // through the control rather than dimming it.
                    // `control-vocabulary` refuses the fade for that reason and
                    // it caught this one. (It scans source and cannot tell
                    // prose from code, so naming the forbidden class here would
                    // turn it red again — the second guard in one session to
                    // read a comment as a violation.)
                    DISABLED_SINK,
                  )}
                >
                  <KubIcon name="create" size={11} className="shrink-0" />
                  <span className="min-w-0 truncate">{role.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Everything this person wears on LETSCUBE, words included — the whole
          strip, because `PROFILE_CARD_BADGE_LIMITS` is uncapped. This is the
          surface D-213 moved it to: a card is about the person, so a word has
          room to be read, where the member row is about this group. */}
      {badges && (
        <div
          className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-1.5"
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
      {member.bio && (
        <p
          className="mt-4 max-w-sm text-sm leading-relaxed text-[color:var(--kub-muted)] [overflow-wrap:anywhere]"
          data-testid="member-card-bio"
        >
          {member.bio}
        </p>
      )}
      {mutualChats && mutualChats.total > 0 && (
        <div className="mt-5 w-full max-w-xs text-left" data-testid="member-card-mutual-chats">
          <div className="px-1 pb-1.5 text-[12px] font-bold uppercase tracking-[0.16em] text-[color:var(--kub-muted)]">
            Общие группы
          </div>
          <div className="flex flex-col gap-1">
            {mutualChats.shown.map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid="member-card-mutual-chat"
                disabled={!onOpenMutualChat}
                onClick={() => onOpenMutualChat?.(row.id)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
                  !onOpenMutualChat && DISABLED_SINK,
                )}
              >
                <ChatAvatar chat={row as never} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-[color:var(--kub-text)]">
                  {row.name?.trim() || (row.type === "channel" ? "Канал" : "Группа")}
                </span>
              </button>
            ))}
          </div>
          {mutualChats.hidden > 0 && (
            <div className="px-1 pt-1.5 text-xs text-[color:var(--kub-muted)]" data-testid="member-card-mutual-more">
              и ещё {mutualChats.hidden}
            </div>
          )}
        </div>
      )}
      <div className="mt-6 w-full max-w-xs">
        <KubButton
          variant="primary"
          fullWidth
          // Your own row opens your own card, because hiding it would make the
          // list inconsistent for exactly one reader. The action that makes no
          // sense there is the one that is refused, not the card.
          disabled={isSelf}
          loading={opening}
          leftIcon={<KubIcon name="chatBubble" size={14} />}
          onClick={onOpenChat}
          data-testid="member-card-open-chat"
        >
          Открыть чат
        </KubButton>
      </div>
    </div>
  );
}
