"use client";

import { KubGlassLayer, KubIcon } from "@/components/kub";
import { useAppStore } from "@/store/app.store";
import { joinVoiceChannel, useVoiceCall } from "@/hooks/useVoiceCall";
import { useVoiceElsewhere } from "@/hooks/useVoiceElsewhere";
import { CAPSULE_CONTROL_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING_INSET } from "@/lib/controlSurface";
import { voiceElsewhereBarState } from "@/lib/voiceElsewhere";
import { cn } from "@/lib/utils";

/**
 * The conversation that is happening on your other device, and the way to take
 * it.
 *
 * The rule — when it is drawn and what it says — is `lib/voiceElsewhere.ts`,
 * pure and tested without a browser. What is here is the drawing, and four
 * decisions about it.
 *
 * **It borrows `VoiceCallBar`'s two placements and nothing else.** Column foot
 * on a computer, top band on a phone, in the flow rather than over the panes,
 * for the reasons that file records. Exactly one of the two bars may ever be on
 * screen, and that is a rule rather than a coincidence: `voiceElsewhereBarState`
 * stands the banner down whenever a call is running here, so a person is never
 * told about a call they are not in beside a bar about one they are.
 *
 * **And it must not be mistakable for that bar**, because the two say opposite
 * things about the same person. Three things separate them, none of them
 * subtle: the badge is a telephone in amber rather than a headset in cyan; this
 * one carries a single control where that one carries three or four; and this
 * one has a second line across its whole width that the in-call bar has no
 * equivalent of.
 *
 * **The whole band is the control.** There is exactly one thing to do here, so
 * making the row itself the button gives a phone a generous target and, on a
 * chat list column dragged down to a strip of avatars, keeps the action
 * reachable after the words have closed — the in-call bar has to keep «Выйти»
 * drawn at that width precisely because its own body press goes somewhere else.
 *
 * **It says what the press costs before the press.** Discord moves you and says
 * so afterwards. Moving is not free — it takes the conversation off a device
 * that may be the one in front of the person being talked to — and the line
 * under the names is that sentence. It is a forecast, never a report: this
 * client cannot watch the other device disconnect, and the interface is correct
 * either way, because what disappears when the move is pressed is driven by
 * *this* device's own call state.
 */
export function VoiceElsewhereBar({ placement }: { placement: "column" | "top" }) {
  const elsewhere = useVoiceElsewhere();
  const call = useVoiceCall();
  // A scalar selector, so a change anywhere else in the chat list does not
  // re-render this band — the same rule `VoiceCallBar` reads its own names by.
  const chatName = useAppStore(
    (state) => state.chats.find((chat) => chat.id === elsewhere?.chatId)?.name ?? null,
  );
  // Whether the conversation on screen speaks for this room itself. A group
  // does — the capsule where one room makes it name one, the rail's own row
  // where several do — and a private conversation has neither, which is the
  // same scalar reading `VoiceCallBar` makes for `capsuleHere` rather than a
  // second answer to one question.
  const spokenForHere = useAppStore((state) => {
    const chatId = elsewhere?.chatId ?? null;
    if (chatId === null || state.selectedChatId !== chatId) return false;
    return state.chats.find((chat) => chat.id === chatId)?.type === "group";
  });

  const view = voiceElsewhereBarState({
    elsewhere,
    chatName,
    localPhase: call.phase,
    spokenForHere,
  });
  if (!view.visible) return null;

  const column = placement === "column";

  return (
    <div
      className={cn(
        "kub-voice-elsewhere-bar relative shrink-0",
        // `--kub-rule` rather than `--kub-border-color`: this line is inside one
        // sheet, between two blocks of it, and the sheet's own edge is the
        // heavier of the two tones. The call bar carries the same note and the
        // same mistake was made there first.
        column
          ? "border-t border-[color:var(--kub-rule)]"
          : "border-b border-[color:var(--kub-rule)]",
      )}
      data-testid="voice-elsewhere-bar"
      data-placement={placement}
    >
      <KubGlassLayer />
      <button
        type="button"
        onClick={() => {
          if (!view.channelId || !view.chatId) return;
          // The existing join, which already leaves whatever this client is in
          // before it joins. The move is that same rule seen from the other
          // device, and there is deliberately no second mechanism for it: a
          // server-side eviction is an Edge Function change and a separate
          // decision.
          void joinVoiceChannel({
            channelId: view.channelId,
            chatId: view.chatId,
            channelName: view.channelName ?? view.room,
          });
        }}
        className={cn(
          "kub-raise-hover relative block w-full px-3 py-2 text-left",
          FOCUS_RING_INSET,
        )}
        title={`${view.actionLabel} · ${view.promise}`}
        data-testid="voice-elsewhere-move"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--kub-warn)_16%,transparent)]"
          >
            {/* A telephone, not the headset the running call wears. The two
                bands are one glance apart on the same edge of the same column,
                and one object in two tints is not two states. */}
            <KubIcon name="phone" size={15} tone="warn" />
          </span>

          <span className="kub-voice-elsewhere-bar__names min-w-0 flex-1">
            <span
              className="block truncate text-xs font-semibold text-[color:var(--kub-text)]"
              data-testid="voice-elsewhere-room"
            >
              {view.room}
            </span>
            {/* Two boxes rather than one string, exactly as the call bar has
                them: the group's name truncates and the state does not, because
                the state is the fact somebody reads to know what this band is
                about. */}
            <span
              className="flex min-w-0 items-baseline gap-1 text-[11px] text-[color:var(--kub-muted)]"
              data-testid="voice-elsewhere-detail"
            >
              {view.where && (
                <>
                  <span className="min-w-0 truncate" data-testid="voice-elsewhere-where">
                    {view.where}
                  </span>
                  <span aria-hidden="true" className="shrink-0">
                    ·
                  </span>
                </>
              )}
              <span className="shrink-0" data-testid="voice-elsewhere-state">
                {view.detail}
              </span>
            </span>
          </span>

          {/* A span rather than a button: the whole band is already the one
              control, and a button inside a button is not markup a browser
              will accept. It carries the material the capsule's controls carry
              so it reads as the thing to press. */}
          <span className="kub-voice-elsewhere-bar__action group/capsule relative flex h-8 shrink-0 items-center rounded-full px-3">
            <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />
            <span
              className="relative text-xs font-semibold whitespace-nowrap text-[color:var(--kub-accent-text)]"
              data-testid="voice-elsewhere-action"
            >
              {view.actionLabel}
            </span>
          </span>
        </span>

        {/* The consequence, across the whole width rather than in the names
            column, which is where it fits on one line at both the chat list's
            360 default and a phone's 390. Under the row rather than in the
            title attribute: a tooltip is not read on a phone, and this is the
            sentence the press has to have been read before. */}
        <span
          className="kub-voice-elsewhere-bar__names mt-1 block text-[11px] text-[color:var(--kub-muted)]"
          data-testid="voice-elsewhere-promise"
        >
          {view.promise}
        </span>
      </button>
    </div>
  );
}
