"use client";

import { KubGlassLayer, KubIcon } from "@/components/kub";
import { useAppStore } from "@/store/app.store";
import {
  leaveVoiceCall,
  setVoiceDeafened,
  setVoiceMuted,
  useVoiceCall,
  useVoiceSpeechRevoked,
} from "@/hooks/useVoiceCall";
import { CAPSULE_CONTROL_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING_INSET } from "@/lib/controlSurface";
import { voiceCallBarState } from "@/lib/voiceCallBar";
import { cn } from "@/lib/utils";

/**
 * The call, reachable from anywhere in the application.
 *
 * The rule — when it is drawn and what it says — is `lib/voiceCallBar.ts`, pure
 * and tested without a browser. What is here is the drawing, and four decisions
 * about it.
 *
 * **Two placements, because the two shells have different shapes.** On a
 * computer both panes are on screen, so the bar docks at the foot of the chat
 * list column: Discord's position, and it costs the conversation nothing. On a
 * phone there is one pane and the column is not on screen while a chat is open,
 * so the bar is a band across the top: Telegram's position. Both are the same
 * component; only the edge it carries and how it narrows differ.
 *
 * **It is in the flow, not over it.** A bar floating above the list would cover
 * the last rows, and reserving room for it by padding the pane leaves a band of
 * the application's own ground in the bar's shape once it goes — the failure
 * the owner saw on 2026-09-12 and which `MainLayout` carries a comment about. A
 * docked bar shortens the list instead, which is what Discord's does.
 *
 * **In the column it narrows by a ratio rather than switching mode.** The chat
 * list is dragged down to a 66-point strip of avatars, and everything in it
 * fades continuously through `--kub-chat-list-narrow` — Telegram's
 * `setNarrowRatio`. The bar follows the same rule in `index.css`: the names and
 * two of the three controls close, and «Выйти» stays, because leaving a call is
 * the one thing that must not require widening a column first.
 *
 * **No faces.** The capsule draws a stack of them and this deliberately does
 * not: the names the SDK carries are baked into each token at mint time, and
 * outside the conversation that owns the call there is no member list to
 * correct them against. A row of half-stale names is worse than none, and the
 * two facts worth having — which room, in which group — are here in full.
 *
 * **And therefore no roster here, and no per-person volume on it.** That
 * question came up the same day the per-person control shipped (D-227): the
 * rail's occupant rows carry a volume band, and this bar is the other place a
 * call is reachable from. The answer is the paragraph above. A volume band
 * needs to name whose voice it is turning down, and out here the only name
 * available is the token's snapshot — so the control would be correct and the
 * label beside it could be somebody's old name. The rail lists occupants
 * against a live member list, which is why it is the one place that offers it,
 * and pressing this bar is one gesture away from there.
 */
export function VoiceCallBar({ placement }: { placement: "column" | "top" }) {
  const call = useVoiceCall();
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  // A scalar selector, so a change anywhere else in the chat list does not
  // re-render this bar. The name is read from the list the reader already has
  // rather than fetched: a bar is not worth a request, and a group whose row
  // has not arrived yet simply shows the room without it.
  const chatName = useAppStore(
    (state) => state.chats.find((chat) => chat.id === call.chatId)?.name ?? null,
  );
  const speechRevoked = useVoiceSpeechRevoked(call.channelId);

  const view = voiceCallBarState({
    phase: call.phase,
    channelId: call.channelId,
    chatId: call.chatId,
    channelName: call.channelName,
    chatName,
    selectedChatId,
    micMuted: call.micMuted,
    deafened: call.deafened,
    speechRevoked,
  });

  if (!view.visible) return null;

  const column = placement === "column";

  return (
    <div
      className={cn(
        "kub-voice-call-bar relative shrink-0",
        // `--kub-rule`, not `--kub-border-color`, and this was wrong in the
        // first version for a reason worth keeping: I reached for rule 11's
        // perimeter case, which is chrome pinned against a scroll area — the
        // rail's right edge, where two *panes* meet. This line is inside one
        // sheet, between two blocks of it, and the sheet's own edge is the
        // heavier of the two tones: a divider drawn at that weight reads as a
        // second edge. `edge-vocabulary.test.mjs` caught it by name.
        column ? "border-t border-[color:var(--kub-rule)]" : "border-b border-[color:var(--kub-rule)]",
      )}
      data-testid="voice-call-bar"
      data-placement={placement}
      data-voice-tone={view.tone}
    >
      <KubGlassLayer />
      <div className="relative flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            if (view.openChatId) setSelectedChatId(view.openChatId);
          }}
          disabled={!view.openChatId}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left",
            view.openChatId && "kub-raise-hover",
            FOCUS_RING_INSET,
          )}
          title="Вернуться к разговору"
          data-testid="voice-call-bar-open"
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              view.tone === "danger"
                ? "bg-[color-mix(in_srgb,var(--kub-danger)_16%,transparent)]"
                : "bg-[color-mix(in_srgb,var(--kub-cyan)_16%,transparent)]",
            )}
          >
            <KubIcon
              name="headset"
              size={15}
              tone={view.tone === "danger" ? "danger" : "accent"}
            />
          </span>
          {/* Closes to nothing as the column narrows; see index.css. */}
          <span className="kub-voice-call-bar__names min-w-0 flex-1">
            <span
              className="block truncate text-xs font-semibold text-[color:var(--kub-text)]"
              data-testid="voice-call-bar-room"
            >
              {view.room}
            </span>
            {/* Two facts on one line, as two boxes rather than one string, and
                that is the whole of the fix the pixels asked for.

                The first capture concatenated them — «Команда проекта · Вы в
                разг…» — and at the column's default 360 points the line ran out
                inside the state. The state is the thing somebody reads to know
                the call is still up; the group's name is read once, on the way
                back to it. So the group truncates and the state does not: the
                fact that survives being cut short is the one that gets cut. */}
            <span
              className={cn(
                "flex min-w-0 items-baseline gap-1 text-[11px]",
                view.tone === "danger"
                  ? "text-[color:var(--kub-danger-text)]"
                  : "text-[color:var(--kub-muted)]",
              )}
              data-testid="voice-call-bar-detail"
            >
              {view.where && (
                <>
                  <span className="min-w-0 truncate" data-testid="voice-call-bar-where">
                    {view.where}
                  </span>
                  <span aria-hidden="true" className="shrink-0">
                    ·
                  </span>
                </>
              )}
              <span className="shrink-0" data-testid="voice-call-bar-state">
                {view.detail}
              </span>
            </span>
          </span>
        </button>

        {view.controls && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void setVoiceDeafened(!view.deafened)}
              className="kub-voice-call-bar__extra group/capsule relative h-8 w-8 shrink-0 rounded-full"
              aria-pressed={view.deafened}
              aria-label={view.deafened ? "Включить звук" : "Заглушить звук"}
              title={view.deafened ? "Включить звук" : "Заглушить звук"}
              data-testid="voice-call-bar-deafen"
              data-deafened={view.deafened ? "true" : "false"}
            >
              <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />
              <span className="relative flex h-full w-full items-center justify-center">
                <KubIcon
                  name={view.deafened ? "muted" : "volume"}
                  size={15}
                  tone={view.deafened ? "danger" : "default"}
                />
              </span>
            </button>

            <button
              type="button"
              onClick={() => void setVoiceMuted(!view.muted)}
              // Inert rather than absent while a moderator holds the
              // microphone, for the reason the capsule states: a control that
              // disappears reads as a feature that went away, where one that is
              // visibly not offered reads as a state — and the line beside it
              // says whose.
              disabled={view.speechRevoked}
              className={cn(
                "kub-voice-call-bar__extra group/capsule relative h-8 w-8 shrink-0 rounded-full",
                view.speechRevoked && "cursor-not-allowed",
              )}
              aria-pressed={view.muted}
              aria-label={
                view.speechRevoked
                  ? "Модератор выключил ваш микрофон"
                  : view.muted
                    ? "Включить микрофон"
                    : "Выключить микрофон"
              }
              title={
                view.speechRevoked
                  ? "Модератор выключил ваш микрофон"
                  : view.muted
                    ? "Включить микрофон"
                    : "Выключить микрофон"
              }
              data-testid="voice-call-bar-mute"
              data-muted={view.muted ? "true" : "false"}
              data-unavailable={view.speechRevoked ? "true" : "false"}
            >
              <KubGlassLayer
                className={cn(
                  CAPSULE_CONTROL_GLASS,
                  // The step of material rather than a fade: on a translucent
                  // surface opacity shows the wallpaper through the glyph
                  // (rule 5), and the veil has to go on the glass layer rather
                  // than on the button's own background, which the light
                  // theme's fill would hide.
                  view.speechRevoked &&
                    "bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                )}
              />
              <span className="relative flex h-full w-full items-center justify-center">
                <KubIcon
                  name={view.muted ? "microphoneSlash" : "microphone"}
                  size={15}
                  tone={view.muted ? "danger" : "default"}
                />
              </span>
            </button>

            <button
              type="button"
              onClick={() => void leaveVoiceCall()}
              className="group/capsule relative h-8 shrink-0 rounded-full px-3"
              title="Выйти из разговора"
              data-testid="voice-call-bar-leave"
            >
              <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />
              <span className="relative text-xs font-semibold whitespace-nowrap text-[color:var(--kub-danger-text)]">
                Выйти
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
