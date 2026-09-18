"use client";

import { useEffect, useState } from "react";
import { ChatAvatar } from "@/components/ui/ChatAvatar";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { useAppStore } from "@/store/app.store";
import { showActionFeedback } from "@/lib/actionFeedback";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { FOCUS_RING } from "@/lib/controlSurface";
import { voiceRingView } from "@/lib/voiceRing";
import {
  answerVoiceRing,
  cancelVoiceRing,
  declineVoiceRing,
  useVoiceRingPick,
  type VoiceRingOutcome,
} from "@/hooks/useVoiceRing";
import { cn } from "@/lib/utils";

/**
 * Somebody is calling, or somebody is being called.
 *
 * The rule — which ring, which way round, and what it says — is
 * `lib/voiceRing.ts`, pure and tested without a browser. What is here is the
 * drawing, and four decisions about it.
 *
 * **One surface for both directions, not two.** An incoming call and an
 * outgoing one are the same fact seen from its two ends: one row, one name, one
 * line under it, and either two buttons or one. Two components would be two
 * places for the words to drift apart, which is the rule `lib/voiceCallBar.ts`
 * was written under — the bar and the capsule are two windows onto one call and
 * neither invents a word of its own.
 *
 * **One shape, in the flow, on every shell** — and it took two captures to get
 * there, one at each width, each of which killed a different version.
 *
 * At 390 it was first a card fixed to the top of the window. It landed squarely
 * over the chat header, which on a phone carries the only way back to the chat
 * list (D-047): a call that hides the back button for forty-five seconds traps
 * somebody in a conversation.
 *
 * So the phone's became a band in the flow and the computer's stayed a fixed
 * card — `DesktopUpdatePill`'s arithmetic, the one other thing here that hangs
 * off the window's top edge. Photographed at 1440, that card sat across the
 * conversation's date separator and its «НОВЫЕ СООБЩЕНИЯ» mark, both of them
 * clipped behind it. Which is the same defect as the phone's, one element down:
 * **a fixed thing over a scroller covers whatever is under it, and there is no
 * arithmetic that makes that false** — the rule this project already wrote down
 * as «reserve room inside the scroller, not by shrinking the container».
 *
 * A reservation would be the other answer and it is the more expensive one: a
 * token, a scroller that reads it, and a second thing to keep in step with the
 * call bar's. In the flow there is nothing to keep in step — the shell moves
 * down by the band's height and nothing anywhere is covered, at any width.
 *
 * The one property the fixed card had that this has to keep is being answerable
 * over a dialog or the media viewer, and it keeps it: `z-[96]` on a positioned
 * element beats `KubModal`'s 95 and the viewer's 90 in the same stacking
 * context, whether it is in the flow or out of it.
 *
 * At 1440 the band is Discord's shape rather than a card: the name at the left
 * edge, the two controls at the right, the whole width between them. A card
 * centred in a 1440 window is centred on nothing — the conversation pane starts
 * 432px in — which is how it came to sit on the date chip in the first place.
 *
 * **Above the media viewer and above a dialog.** `z-[96]` sits over
 * `KubModal`'s 95 and the viewer's 90 and under `BannedScreen`'s 100. A call
 * that arrived while somebody was looking at a photograph has to be answerable
 * without finding the close button first; a banned account has nothing to
 * answer.
 *
 * **It draws nothing once the call is answered.** From that moment the pair are
 * in a room and `VoiceCallBar` carries it, with the same mute, deafen and leave
 * every other call has. That hand-over is `pickVoiceRing`'s: it answers only
 * for a ring that is still `ringing`.
 */
export function VoiceCallRing() {
  const selfId = useAppStore((state) => state.currentUser?.id ?? null);
  const pick = useVoiceRingPick(selfId);
  const chatId = pick?.ring.chatId ?? null;
  // Scalar selectors, so a change anywhere else in the chat list does not
  // re-render this card, and read from the list the reader already has rather
  // than fetched: a ring is not worth a request, and `VoiceCallBar` names the
  // group the same way for the same reason.
  const who = useAppStore((state) => {
    const chat = chatId ? state.chats.find((entry) => entry.id === chatId) : undefined;
    return chat ? getChatDisplayInfo(chat, state.currentUser?.id ?? null).title : null;
  });
  const face = useAppStore(
    (state) =>
      (chatId ? state.chats.find((entry) => entry.id === chatId)?.other_user?.avatar_url : null) ?? null,
  );
  const otherId = useAppStore(
    (state) => (chatId ? state.chats.find((entry) => entry.id === chatId)?.other_user?.id : null) ?? null,
  );
  const [busy, setBusy] = useState(false);

  const channelId = pick?.ring.channelId ?? null;
  const startedAt = pick?.ring.startedAt ?? null;
  // A press belongs to one ring. Without this, a cancel that was still in
  // flight when the next call arrived would leave its buttons refusing.
  useEffect(() => {
    setBusy(false);
  }, [channelId, startedAt]);

  const view = voiceRingView({ pick, who, busy });

  const run = async (action: () => Promise<VoiceRingOutcome>) => {
    if (busy) return;
    setBusy(true);
    const outcome = await action();
    setBusy(false);
    if (!outcome.ok) {
      // The sentence is `voiceRingRefusalText`'s. It reaches the person the way
      // every other refused action in this product does rather than through a
      // state of its own, because the card it would have to appear in is
      // usually gone by then: `not_ringing` means somebody's other device
      // answered, and the row has already cleared.
      showActionFeedback({ kind: "error", title: outcome.refusal, key: "voice-ring" });
    }
  };

  if (!view.visible || !pick) return null;

  return (
    <div
      className={cn(
        // A band at the top of the shell, in the flow, at every width. The top
        // padding carries the hardware's inset and the Windows caption out of
        // the way because nothing is above this element on any shell.
        "relative z-[96] w-full shrink-0 border-b border-[color:var(--kub-rule)]",
        "pt-[calc(var(--kub-safe-top)+var(--kub-window-caption))]",
      )}
      // `region`, deliberately not `dialog`. `MainLayout`'s Escape handler
      // treats any `role="dialog"` on the page as something that owns the key
      // (D-194), and a ring is not something Escape closes — it is answered or
      // declined. `assertive` because an incoming call is the one notice in
      // this product that cannot wait for a pause in the reading.
      role="region"
      aria-live={view.direction === "incoming" ? "assertive" : "polite"}
      aria-label={view.direction === "incoming" ? "Входящий звонок" : "Исходящий звонок"}
      data-testid="voice-ring"
      data-direction={view.direction}
      data-busy={view.busy ? "true" : "false"}
    >
      {/* `strong`, which is what that prop is for: «a surface that covers
          content it is not part of». Measured at 390 with the panel material
          instead — the card lands over the chat list's search field and the
          placeholder inside it read straight through the glass, so the caller's
          name sat on top of somebody else's words. */}
      <KubGlassLayer strong />
      <div className="relative flex items-center gap-3 p-3 md:px-4">
        <span className="shrink-0">
          <ChatAvatar
            chat={{ id: chatId ?? "", name: view.who, avatar_url: face, type: "private" }}
            size="md"
            profileId={otherId}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-semibold text-[color:var(--kub-text)]"
            data-testid="voice-ring-who"
          >
            {view.who}
          </span>
          <span
            className={cn(
              "block truncate text-xs",
              view.tone === "live"
                ? "text-[color:var(--kub-accent-text)]"
                : "text-[color:var(--kub-muted)]",
            )}
            data-testid="voice-ring-detail"
          >
            {view.detail}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {/* Decline before answer, left to right, which is where every
              telephone in the world puts them: the destructive one is the one a
              thumb reaches by accident, so it goes furthest from the thumb's
              resting edge and the accepting one sits under it. */}
          {view.decline && (
            <button
              type="button"
              onClick={() => void run(() => declineVoiceRing(pick.ring))}
              disabled={view.busy}
              className={cn(
                "group/capsule relative flex h-11 w-11 items-center justify-center rounded-full",
                "bg-[color-mix(in_srgb,var(--kub-danger)_18%,transparent)]",
                view.busy && "cursor-not-allowed",
                FOCUS_RING,
              )}
              aria-label={view.declineLabel}
              title={view.declineLabel}
              data-testid="voice-ring-decline"
            >
              <KubIcon name="phoneOff" size={18} tone="danger" />
            </button>
          )}
          {view.answer && (
            <button
              type="button"
              onClick={() => void run(() => answerVoiceRing(pick.ring, view.who))}
              disabled={view.busy}
              className={cn(
                "group/capsule relative flex h-11 w-11 items-center justify-center rounded-full",
                "bg-[color-mix(in_srgb,var(--kub-cyan)_22%,transparent)]",
                view.busy && "cursor-not-allowed",
                FOCUS_RING,
              )}
              aria-label={view.answerLabel}
              title={view.answerLabel}
              data-testid="voice-ring-answer"
            >
              <KubIcon name="phone" size={18} tone="accent" />
            </button>
          )}
          {view.cancel && (
            /* One control, and it carries its word. The outgoing card has room
               for it where the incoming card has two buttons and none, and
               «Отменить» beside a telephone is the difference between hanging
               up and hanging up on somebody. */
            <button
              type="button"
              onClick={() => void run(() => cancelVoiceRing(pick.ring))}
              disabled={view.busy}
              className={cn(
                "group/capsule relative flex h-11 items-center gap-1.5 rounded-full px-4",
                "bg-[color-mix(in_srgb,var(--kub-danger)_18%,transparent)]",
                view.busy && "cursor-not-allowed",
                FOCUS_RING,
              )}
              aria-label={view.cancelLabel}
              title={view.cancelLabel}
              data-testid="voice-ring-cancel"
            >
              <KubIcon name="phoneOff" size={18} tone="danger" />
              <span className="text-xs font-semibold text-[color:var(--kub-danger-text)]">
                {view.cancelLabel}
              </span>
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
