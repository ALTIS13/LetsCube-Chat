"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { KubIcon, KubModal, KubNotice, KubStableSkeleton } from "@/components/kub";
import { KUB_ICON_NAMES } from "@/components/kub/icons";
import { MemberCard, type MemberRow } from "@/components/chat/MemberCard";
import { badgeStrip, projectProfileBadges, type BadgeStrip } from "@/lib/profileBadges";
import { useProfileBadges } from "@/hooks/useProfileBadges";
import { getUserPresenceState } from "@/lib/presence";
import { usePresenceNow } from "@/hooks/usePresenceNow";
import { useCreateChat } from "@/hooks/useCreateChat";
import { showAppAlert } from "@/lib/appDialogs";
import { mapPgError } from "@/lib/errors";
import { CHAT_OPEN_FAILED, PROFILE_UNAVAILABLE, plainFailure } from "@/lib/plainMessages";
import type { Profile } from "@/types/database";

/**
 * A person, opened from anywhere, without entering a conversation with them.
 *
 * ## What this fixes
 *
 * D-283, in the owner's words: «У нас пропала возможность открыть профиль
 * пользователя не заходя в ЛС с ним.» The chat list's «Открыть профиль» ran
 * `onChatSelect(chat.id)` and then opened the information panel, so the label
 * promised a person and the action opened a conversation — and entering one
 * reports the other side's message read, which is a consequence the reader
 * never asked for. Measured before the repair at 1440 and 390: both viewports
 * sent `mark_chat_read_through`, the phone `mark_chat_delivered` besides.
 *
 * ## Why this is not a second profile implementation
 *
 * Because it draws `MemberCard` — the same component the information panel's
 * fourth layer draws, extracted to its own file and otherwise untouched. The
 * comment that consolidated the two old profile modals was right: two
 * implementations drift. What it did not notice is that the surviving one
 * lived inside a conversation, so the capability went with the duplicate. One
 * component, two containers, is the shape that keeps both promises.
 *
 * ## What it deliberately is not, yet
 *
 * Discord's answer to this problem is **two** surfaces — a compact popout with
 * «Полный профиль» at the bottom, and a full modal with tabs — and they do not
 * drift because the small one is a summary of the large one with an explicit
 * escalation. That split is the right target and it is **not** built here: it
 * is a design the owner has to approve, and it belongs to queue item 36's
 * second half. This is the card we have, reachable from where it was not.
 * `docs/operations/reference-clients.md` carries what Discord actually does.
 *
 * ## The chat-scoped facts it cannot say, and does not invent
 *
 * `roleLabel`, `joinedLabel`, the group's role chips and the vocabulary for
 * handing roles out are all facts about **a chat**. This overlay is open over
 * the shell and belongs to none, so it passes the empty answers the card
 * already draws nothing for. It does not guess a standing from the private
 * conversation the two people happen to share.
 */
export function UserProfileOverlay() {
  const userId = useAppStore((s) => s.profileOverlayUserId);
  const close = useAppStore((s) => s.closeUserProfile);
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = createClient();
  const presenceNow = usePresenceNow();
  const { openPrivateChat, loading: opening } = useCreateChat();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The card is drawn from a fresh read rather than from the chat row that
  // opened it. A row carries the profile it was last handed — `useChats`
  // projects `other_user` and the realtime patch keeps it warm — but a person
  // who changed their picture, name or никнейм while this list sat open would
  // be drawn stale on the one surface that is entirely about them.
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setFailure(null);
      return;
    }
    let cancelled = false;
    setProfile(null);
    setFailure(null);
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("Profile overlay read error:", error);
        setFailure(plainFailure(mapPgError(error), PROFILE_UNAVAILABLE));
        return;
      }
      // A refusal and an absence are different facts (D-140's rule). An id
      // nobody can read answers `null` with no error under row-level security,
      // and «нет такого человека» would report that refusal as a fact.
      if (!data) {
        setFailure(PROFILE_UNAVAILABLE);
        return;
      }
      setProfile(data as Profile);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  const badgeIds = useMemo(() => (userId ? [userId] : []), [userId]);
  const badges = useProfileBadges(badgeIds);
  const strip: BadgeStrip | null = useMemo(() => {
    if (!userId) return null;
    const rows = badges.rows.get(userId);
    if (!rows?.length) return null;
    const built = badgeStrip(projectProfileBadges(rows, userId, { knownIcons: KUB_ICON_NAMES }));
    return built.shown.length ? built : null;
  }, [badges.rows, userId]);

  const openChat = useCallback(async () => {
    if (!userId) return;
    const chatId = await openPrivateChat(userId);
    if (!chatId) {
      showAppAlert(CHAT_OPEN_FAILED, "Чат недоступен");
      return;
    }
    close();
  }, [close, openPrivateChat, userId]);

  const presence = profile ? getUserPresenceState(profile, presenceNow) : null;
  // The card's own type, with the two chat facts it will not be told. They are
  // the shape `MemberRow` requires and nothing here reads them back.
  const member: MemberRow | null = profile ? { ...profile, chat_role: "member", joined_at: null } : null;

  return (
    <KubModal
      open={Boolean(userId)}
      onClose={close}
      title="Профиль"
      icon={<KubIcon name="profile" size={18} />}
      size="sm"
      // A centred card at every width rather than a full-screen sheet. What is
      // being answered is «кто это» — one short question — and a sheet that
      // takes the whole phone for it reads as somewhere you have navigated to,
      // which is the very thing this control must not do.
      mobileSheet={false}
      contentClassName="px-0 py-0"
    >
      <div data-testid="user-profile-overlay">
        {failure && (
          <div className="px-4 py-5">
            <KubNotice tone="warn" title={failure}>
              Попробуйте ещё раз.
            </KubNotice>
          </div>
        )}
        {!failure && !member && (
          <div className="flex flex-col items-center gap-3 px-5 py-8" data-testid="user-profile-loading">
            <KubStableSkeleton width="96px" height="96px" rounded="full" />
            <KubStableSkeleton width="160px" height="18px" />
            <KubStableSkeleton width="110px" height="14px" />
          </div>
        )}
        {!failure && member && (
          <MemberCard
            member={member}
            isSelf={member.id === currentUserId}
            roleLabel=""
            presenceLabel={presence?.label ?? ""}
            joinedLabel=""
            showOnlineDot={presence?.isOnline ?? false}
            badges={strip}
            groupRoles={[]}
            groupVocabulary={null}
            onToggleGroupRole={() => {}}
            assigning={null}
            opening={opening}
            onOpenChat={() => void openChat()}
          />
        )}
      </div>
    </KubModal>
  );
}
