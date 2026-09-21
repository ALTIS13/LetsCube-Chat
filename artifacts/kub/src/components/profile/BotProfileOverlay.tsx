"use client";

import { useCallback, useMemo } from "react";

import { KubIcon, KubModal, KubNotice, KubStableSkeleton } from "@/components/kub";
import { BotProfileCard } from "@/components/profile/BotProfileCard";
import { UserProfilePopout } from "@/components/profile/UserProfilePopout";
import { useBotProfile } from "@/hooks/useBotProfile";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import type { BotCommand } from "@/lib/botChatSurfaces";
import {
  BOT_PROFILE_TITLE,
  BOT_PROFILE_UNAVAILABLE,
  botProfileCardModel,
  botProfileCommandDraft,
} from "@/lib/botProfile";
import { profileFillsPhone, resolveProfileTier } from "@/lib/profileTier";
import { useAppStore } from "@/store/app.store";

/**
 * A bot, opened from its own face, and placed by the same rule a person is
 * (D-263).
 *
 * ## Why the tier is shared and the card is not
 *
 * `resolveProfileTier` is not about people. It is about **whether the surface
 * has a beside**: a glance at something incidental to what you were reading
 * opens next to it where there is room, and takes the phone's whole screen
 * where there is not — measured on `P212C6000159`, where mobile Discord draws
 * one full-screen profile and no popout at all (§17.7). A bot pressed in the
 * middle of a conversation is exactly that kind of glance, so it gets exactly
 * that placement, and a second copy of the rule would be a second thing to
 * keep in step.
 *
 * What is **not** shared is escalation. A person has two tiers and the small
 * one carries «Полный профиль»; a bot has one card in two containers, so there
 * is nothing to escalate to and no such control is drawn — §8's rule again,
 * that a control opening the surface you are already looking at is inert.
 * `resolveProfileTier` is therefore asked with `escalated: false` always, and
 * that is a statement rather than a default.
 *
 * ## The seed
 *
 * The opener hands over the `bots` row it already had — a bot's message
 * carries one — so the card paints a name immediately and fills in the
 * commands when `useBotProfile` answers. The read still happens: the seed may
 * be an hour of scrollback old, and it never carries the commands.
 */
export function BotProfileOverlay() {
  const botId = useAppStore((s) => s.botProfileId);
  const seed = useAppStore((s) => s.botProfileSeed);
  const chatId = useAppStore((s) => s.botProfileChatId);
  const opener = useAppStore((s) => s.botProfileOpener);
  const anchor = useAppStore((s) => s.botProfileAnchor);
  // The row the card must not cover, as the person's card reads it.
  const anchorRow = useAppStore((s) => s.botProfileRow);
  const chats = useAppStore((s) => s.chats);
  const close = useAppStore((s) => s.closeBotProfile);
  const requestComposerDraft = useAppStore((s) => s.requestComposerDraft);
  const viewportWidth = useViewportWidth();

  const { row, commands, settled, failed } = useBotProfile(botId);

  const tier = resolveProfileTier({
    opener,
    // A bot's card has one tier; see the header.
    escalated: false,
    viewportWidth,
    anchored: anchor !== null,
  });

  const model = useMemo(
    () => botProfileCardModel({ seed, row, commands, commandsSettled: settled }),
    [commands, row, seed, settled],
  );

  /**
   * The chat the card was opened from, which is what decides whether a chosen
   * command has to name the bot (D-244).
   *
   * Read off the chats the store already holds rather than fetched, the same
   * way the person's card reads its context. An unknown chat answers
   * `undefined`, which `botCommandAddress` treats as «address it» — a few
   * characters in a private chat, against a message nobody receives in a group.
   */
  const chatType = useMemo(
    () => (chatId ? chats.find((entry) => entry.id === chatId)?.type ?? null : null),
    [chatId, chats],
  );

  const chooseCommand = useCallback(
    (command: BotCommand) => {
      if (!model || !chatId) return;
      requestComposerDraft(chatId, botProfileCommandDraft(model, command, chatType));
      close();
    },
    [chatId, chatType, close, model, requestComposerDraft],
  );

  const surface = (
    <div data-testid="bot-profile-overlay" data-profile-surface={tier}>
      {/* A refusal and an absence have the same shape under row-level
          security, so neither is claimed: this appears only when there was
          also no seed to fall back on. */}
      {settled && !model && (
        <div className="px-4 py-5">
          <KubNotice tone={failed ? "warn" : "info"} title={BOT_PROFILE_UNAVAILABLE}>
            Попробуйте ещё раз.
          </KubNotice>
        </div>
      )}
      {!settled && !model && (
        <div className="flex flex-col items-center gap-3 px-5 py-8" data-testid="bot-profile-loading">
          <KubStableSkeleton width="96px" height="96px" rounded="full" />
          <KubStableSkeleton width="160px" height="18px" />
          <KubStableSkeleton width="110px" height="14px" />
        </div>
      )}
      {model && <BotProfileCard model={model} onChooseCommand={chooseCommand} />}
    </div>
  );

  if (botId && tier === "compact" && anchor) {
    return (
      <UserProfilePopout anchor={anchor} row={anchorRow} onClose={close}>
        {surface}
      </UserProfilePopout>
    );
  }

  return (
    <KubModal
      open={Boolean(botId)}
      onClose={close}
      title={BOT_PROFILE_TITLE}
      icon={<KubIcon name="bot" size={18} />}
      size="sm"
      mobileSheet={profileFillsPhone(tier)}
      contentClassName="px-0 py-0"
      testId="bot-profile-modal"
      closeTestId="bot-profile-close"
    >
      {surface}
    </KubModal>
  );
}
