"use client";

import { useCallback, useMemo } from "react";
import { useAppStore } from "@/store/app.store";
import { KubIcon, KubModal, KubNotice, KubStableSkeleton } from "@/components/kub";
import { KUB_ICON_NAMES } from "@/components/kub/icons";
import { MemberCard, type MemberRow } from "@/components/chat/MemberCard";
import { UserProfileCompact } from "@/components/profile/UserProfileCompact";
import { UserProfilePopout } from "@/components/profile/UserProfilePopout";
import { badgeStrip, projectProfileBadges, type BadgeStrip } from "@/lib/profileBadges";
import {
  PROFILE_COMPACT_BADGE_LIMITS,
  profileFillsPhone,
  resolveProfileTier,
} from "@/lib/profileTier";
import { profileChatContext } from "@/lib/profileChatContext";
import { profileMutualChats } from "@/lib/profileMutualChats";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { chatRoleLabel } from "@/lib/chatMemberRules";
import { formatJoinedAt } from "@/lib/chatMemberList";
import { useProfileBadges } from "@/hooks/useProfileBadges";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import { getUserPresenceState } from "@/lib/presence";
import { usePresenceNow } from "@/hooks/usePresenceNow";
import { useCreateChat } from "@/hooks/useCreateChat";
import { showAppAlert } from "@/lib/appDialogs";
import { CHAT_OPEN_FAILED } from "@/lib/plainMessages";

/**
 * A person, opened from anywhere, without entering a conversation with them —
 * on two surfaces now, and one store under both.
 *
 * ## What this fixed first (D-283)
 *
 * In the owner's words: «У нас пропала возможность открыть профиль пользователя
 * не заходя в ЛС с ним.» The chat list's «Открыть профиль» ran
 * `onChatSelect(chat.id)` and then opened the information panel, so the label
 * promised a person and the action opened a conversation — and entering one
 * reports the other side's message read, a consequence the reader never asked
 * for. Measured before the repair at 1440 and 390: both viewports sent
 * `mark_chat_read_through`, the phone `mark_chat_delivered` besides.
 *
 * ## The two tiers, and why the store came before either of them
 *
 * `docs/operations/reference-clients.md` §15.1, read out of Discord stable
 * 615980: the popout and the full modal are **different components** (851588
 * and 808261) that share leaves and not a root, and the reason they never
 * disagree is that both read one `UserProfileStore` through one fetch with an
 * in-flight gate and a 60-second window. Ours is `lib/profileCache.ts` plus
 * `hooks/useUserProfile.ts`, and it was written before `UserProfileCompact`
 * existed for exactly that reason: a small surface beside the card without a
 * shared read would be two components over two queries, which is the drift the
 * original consolidation was defending against.
 *
 * So this container owns **where** a person is drawn and nothing about how. The
 * tier is `resolveProfileTier`, pure and tested; the bodies are the two cards;
 * the data is the store.
 *
 * ## The phone has one tier, measured rather than assumed
 *
 * `lib/profileTier.ts` carries the measurement: on `P212C6000159` a message
 * avatar in Discord 345.9 opens the person as a full-screen, full-bleed page
 * with no popout on the way. So below `PROFILE_COMPACT_MIN_WIDTH` every opener
 * lands on the full card, and `profileFillsPhone` makes that card the sheet a
 * phone draws rather than a small centred dialog.
 *
 * ## The place, and the facts that belong to it
 *
 * Discord's profile is keyed on `(userId, guildId)`, not on a person, and that
 * second half is what lets its card say «this person's roles» without being a
 * second implementation of a person. Ours now carries the same pair:
 * `profileOverlayChatId` says where the card is being read **from**, and
 * `lib/profileChatContext.ts` decides what may be said there — a standing and
 * a join date in a group or a channel, nothing at all in a private
 * conversation, whose «Владелец» is an artefact of who opened it first.
 *
 * That was not cosmetic. Measured at 1440 on 2026-09-21, before the pair
 * existed: the compact card rendered **450 px** tall and the full card **446**,
 * so the summary was taller than the thing it summarised and escalating showed
 * the reader nothing. The same measurement is now an assertion in
 * `profile-two-tier.spec.ts`.
 *
 * Still not passed, and deliberately: the group's role **chips** and the
 * vocabulary for handing them out. Those need `useChatRoles`, they are a
 * management affordance, and one door per action puts them in the member list
 * — which is the same full card, drawn by `ChatInfoPanel`, where that door
 * already is.
 */
export function UserProfileOverlay() {
  const userId = useAppStore((s) => s.profileOverlayUserId);
  const opener = useAppStore((s) => s.profileOverlayOpener);
  const contextChatId = useAppStore((s) => s.profileOverlayChatId);
  const anchor = useAppStore((s) => s.profileOverlayAnchor);
  const chats = useAppStore((s) => s.chats);
  const escalated = useAppStore((s) => s.profileOverlayEscalated);
  const escalate = useAppStore((s) => s.escalateUserProfile);
  const close = useAppStore((s) => s.closeUserProfile);
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const presenceNow = usePresenceNow();
  const viewportWidth = useViewportWidth();
  const { openPrivateChat, loading: opening } = useCreateChat();

  const { profile, settled, failure } = useUserProfile(userId);
  const tier = resolveProfileTier({
    opener,
    escalated,
    viewportWidth,
    // A glance with nothing to point at opens the full surface instead of a
    // centred summary. See `profileTier.ts` for why that is the honest
    // fallback rather than a missing feature.
    anchored: anchor !== null,
  });

  const badgeIds = useMemo(() => (userId ? [userId] : []), [userId]);
  const badges = useProfileBadges(badgeIds);
  const strip: BadgeStrip | null = useMemo(() => {
    if (!userId) return null;
    const rows = badges.rows.get(userId);
    if (!rows?.length) return null;
    // One of the three things that make a summary a summary: the compact card
    // caps the strip, the full card does not. The other two are the clamped
    // bio and the smaller face.
    const built = badgeStrip(
      projectProfileBadges(rows, userId, { knownIcons: KUB_ICON_NAMES }),
      tier === "compact" ? { ...PROFILE_COMPACT_BADGE_LIMITS } : undefined,
    );
    return built.shown.length ? built : null;
  }, [badges.rows, tier, userId]);

  const openChat = useCallback(async () => {
    if (!userId) return;
    const chatId = await openPrivateChat(userId);
    if (!chatId) {
      showAppAlert(CHAT_OPEN_FAILED, "Чат недоступен");
      return;
    }
    close();
  }, [close, openPrivateChat, userId]);

  /**
   * What this person is **here**, where «here» is the place the card was opened
   * from. Discord keys its profile on `(userId, guildId)` for exactly this, and
   * `lib/profileChatContext.ts` holds the rule — a group and a channel have
   * real standings, a private conversation does not.
   *
   * It is read off the chat the store already holds, not fetched:
   * `useChats` selects `members:chat_members(user_id, role, joined_at, …)`, so
   * this costs nothing and cannot put a second query behind a second surface.
   */
  const context = useMemo(() => {
    if (!contextChatId || !userId) return profileChatContext(null, null);
    return profileChatContext(chats.find((row) => row.id === contextChatId) ?? null, userId);
  }, [chats, contextChatId, userId]);

  /**
   * The groups and channels both people are in — the one list Discord's modal
   * has that has an honest analogue here (§15.1 refused the other four by
   * name), and the reason the full card is worth escalating to on a phone,
   * where it is the whole screen.
   *
   * Filtered out of the chats the store already holds, so it asks the server
   * for nothing and can show no group the reader is not in.
   */
  const mutual = useMemo(
    () => profileMutualChats(chats, userId, currentUserId),
    [chats, currentUserId, userId],
  );

  const openMutualChat = useCallback(
    async (chatId: string) => {
      const opened = await safeOpenChat(chatId, {
        unavailableMessage: "Чат недоступен или был удалён.",
        unavailableTitle: "Чат недоступен",
      });
      if (opened) close();
    },
    [close],
  );

  const presence = profile ? getUserPresenceState(profile, presenceNow) : null;
  // The full card's own type. `chat_role` and `joined_at` are the shape it
  // requires; what is actually drawn from them are the two labels below, which
  // the context decides and which this card draws nothing for when empty.
  const member: MemberRow | null = profile
    ? { ...profile, chat_role: context.standing ?? "member", joined_at: context.joinedAt }
    : null;
  const isSelf = profile?.id === currentUserId;

  const surface = (
    <div data-testid="user-profile-overlay" data-profile-surface={tier}>
      {failure && (
        <div className="px-4 py-5">
          <KubNotice tone="warn" title={failure}>
            Попробуйте ещё раз.
          </KubNotice>
        </div>
      )}
      {!failure && !settled && (
        <div className="flex flex-col items-center gap-3 px-5 py-8" data-testid="user-profile-loading">
          <KubStableSkeleton width="96px" height="96px" rounded="full" />
          <KubStableSkeleton width="160px" height="18px" />
          <KubStableSkeleton width="110px" height="14px" />
        </div>
      )}
      {!failure && profile && tier === "compact" && (
        <UserProfileCompact
          profile={profile}
          isSelf={isSelf}
          presenceLabel={presence?.label ?? ""}
          showOnlineDot={presence?.isOnline ?? false}
          badges={strip}
          opening={opening}
          onOpenChat={() => void openChat()}
          onEscalate={escalate}
        />
      )}
      {!failure && member && tier === "full" && (
        <MemberCard
          member={member}
          isSelf={isSelf}
          // Said only where it is true. `chatRoleLabel` answers "" for an
          // ordinary member, which the card already draws nothing for, so
          // the line appears for an owner and an administrator and for
          // nobody else.
          roleLabel={context.standing ? chatRoleLabel(context.standing, context.channel ? "канала" : "группы") : ""}
          presenceLabel={presence?.label ?? ""}
          joinedLabel={context.joinedAt ? formatJoinedAt(context.joinedAt) : ""}
          showOnlineDot={presence?.isOnline ?? false}
          badges={strip}
          groupRoles={[]}
          groupVocabulary={null}
          onToggleGroupRole={() => {}}
          assigning={null}
          mutualChats={mutual}
          onOpenMutualChat={(chatId) => void openMutualChat(chatId)}
          opening={opening}
          onOpenChat={() => void openChat()}
        />
      )}
    </div>
  );

  // Two containers, chosen by tier, and the choice is the whole of what this
  // correction is about.
  //
  // **Compact → a popout beside the face.** Discord's is anchored to what you
  // pressed: the conversation stays lit, stays where it was, and the reader's
  // eye does not leave the message. The first build of this drew it centred in
  // a modal, which is smaller than the full card and no quicker to read — the
  // worst of both — and that was an oversight rather than a decision.
  //
  // **Full → the modal.** It is a place you deliberately went to, so a scrim, a
  // title and a ✕ are right, and on a phone it takes the whole screen, which is
  // what Discord's own phone client does (measured, §17.7).
  if (userId && tier === "compact" && anchor) {
    return (
      <UserProfilePopout anchor={anchor} onClose={close}>
        {surface}
      </UserProfilePopout>
    );
  }

  return (
    <KubModal
      open={Boolean(userId)}
      onClose={close}
      title="Профиль"
      icon={<KubIcon name="profile" size={18} />}
      size="sm"
      // Only ever answers for the full tier now: the compact one has its own
      // container above. «The whole phone» is what Discord's phone client does
      // for a profile and what a surface you navigated to should be.
      mobileSheet={profileFillsPhone(tier)}
      contentClassName="px-0 py-0"
      testId="user-profile-modal"
      closeTestId="user-profile-close"
    >
      {surface}
    </KubModal>
  );
}
