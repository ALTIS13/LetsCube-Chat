"use client";

import { useState } from "react";
import { TinyUserAvatar } from "./MessageReactions";
import { VoiceSpeakingAvatar } from "./VoiceSpeakingAvatar";
import { VoiceConnectionPanel } from "./VoiceConnectionPanel";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { useVoiceSpeechRevoked } from "@/hooks/useVoiceCall";
import { CAPSULE_GLASS, CAPSULE_CONTROL_GLASS } from "@/lib/chatChrome";
import { FOCUS_RING } from "@/lib/controlSurface";
import { cn } from "@/lib/utils";
import { orderVoiceParticipants, type VoiceCapsuleView, type VoiceChannelSummary, type VoiceParticipant } from "@/lib/voiceChannel";

/**
 * The voice channel, under the chat header.
 *
 * Built exactly as `TopicStrip` is — a `KubGlassLayer` carrying `CAPSULE_GLASS`
 * on a leaf, with the row over it as a positioned sibling — because rule 3 of
 * docs/operations/interface-material.md says a surface with anything `fixed`
 * inside it cannot wear the material itself, and rule 1 says no component
 * writes `backdrop-filter`, `rgba()` or a shadow by hand. The two controls are
 * `CAPSULE_CONTROL_GLASS`, which steps the glass rather than the button's own
 * background: rule 5's veil painted under a glass layer is invisible in the
 * light theme, which is what that constant exists for.
 *
 * It sits above the topic strip inside `kub-chat-chrome-stack`, so the
 * conversation's top inset grows by its height on its own — the stack is
 * measured with a border-box `ResizeObserver` and the list compensates. There
 * is no `z-index` and no `order` anywhere in it: paint order is tree order
 * (rule 12), and the whole stack is already rendered after the message list.
 *
 * It does draw who is speaking, as of 2026-09-18: `RoomEvent.ActiveSpeakersChanged`
 * reaches the store through `VoiceRoomEvents.onSpeakers`, and each face is
 * wrapped in `VoiceSpeakingAvatar`, which subscribes to a boolean of its own so
 * that a syllable renders one face rather than the capsule. Until then this
 * note said the capsule deliberately did not, and named it slice 4.
 *
 * And it tells the person a moderator has silenced them (D-221). That fact
 * exists only in the SFU — the gateway revokes `canPublish` and writes no
 * column — so it does not arrive with `view`, which is built by a pure function
 * from things a `node --test` process can hold; it is read from the call store
 * by `useVoiceSpeechRevoked`, scoped to this channel, the way
 * `VoiceSpeakingAvatar` reads its own boolean.
 */

export interface VoiceCallCapsuleProps {
  /** This chat's channel, or null when it has none — then nothing is drawn. */
  channel: VoiceChannelSummary | null;
  /** The people, from the SDK while connected and from the table otherwise. */
  participants: readonly VoiceParticipant[];
  /** Avatars by user id, from the chat's own member list. Absent is a monogram. */
  faces?: ReadonlyMap<string, string | null>;
  selfId: string | null;
  view: VoiceCapsuleView;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
}

/** How many faces fit beside two names at 360 CSS pixels, measured by counting. */
const FACES = 3;

/**
 * The capsule's control when it is present but not offered.
 *
 * `DISABLED_SINK` cannot be used here for the same reason `CAPSULE_CONTROL_GLASS`
 * exists at all: these controls carry their material on a glass layer that is
 * their first child, and a veil laid on the button's own background sits
 * underneath it, where the light theme's .80 fill hides it. So the step goes on
 * the glass, as `CAPSULE_CONTROL_GLASS` does for hover and press — one
 * `--kub-sink-veil` as a background **image**, which composites over the fill
 * already there and therefore cannot go flush with its own ground (rule 5 of
 * docs/operations/interface-material.md). Not `opacity`: that rule measured a
 * faded control on a translucent panel at 2.23:1 against a threshold of 4.5,
 * because the wallpaper shows straight through it.
 *
 * Here rather than beside its sibling in `lib/chatChrome.ts` only because that
 * file belongs to another change in flight; it is the same shape and belongs
 * next to it.
 */
const CAPSULE_CONTROL_UNAVAILABLE_GLASS =
  "rounded-full border border-[color:var(--glass-line)] bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]";

export function VoiceCallCapsule({
  channel,
  participants,
  faces,
  selfId,
  view,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleDeafen,
}: VoiceCallCapsuleProps) {
  // Every hook above the early return, without exception. This block read
  // `if (!view.visible || !channel) return null;` and then `useState`, which is
  // a conditional hook: going from hidden to visible while mounted renders more
  // hooks than the previous render and React throws. The suite did not catch it
  // because every path that hides this capsule in a test also remounts
  // `ChatWindow` — `switchChat` is a remount — while in production a group
  // whose channel list arrives after mount goes hidden to visible in place,
  // which is the ordinary case rather than an edge one.
  const [healthOpen, setHealthOpen] = useState(false);
  // Above the early return with it, and scoped to this chat's channel so a
  // capsule drawing some other room cannot say this person was silenced in it.
  const speechRevoked = useVoiceSpeechRevoked(channel?.id ?? null);

  if (!view.visible || !channel) return null;

  const ordered = orderVoiceParticipants(participants, selfId);
  const shown = ordered.slice(0, FACES);
  const rest = ordered.length - shown.length;

  return (
    <div
      className="relative mx-2 mt-1 flex-shrink-0 rounded-full md:mx-4"
      data-testid="voice-capsule"
      data-voice-phase={view.tone}
    >
      <KubGlassLayer className={CAPSULE_GLASS} />
      <div className="relative flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5">
        {/* The headset opens the connection panel (D-217). It is a control
            rather than decoration because it is the one place a person looks
            when a call sounds wrong, which is exactly where Discord puts the
            same numbers. Sampling runs only while the panel is open — see
            `useVoiceHealth` — so a closed capsule costs nothing. */}
        <button
          type="button"
          onClick={() => setHealthOpen((open) => !open)}
          aria-label={healthOpen ? "Скрыть состояние связи" : "Состояние связи"}
          aria-expanded={healthOpen}
          data-testid="voice-capsule-health"
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors kub-raise-hover",
            FOCUS_RING,
          )}
        >
          <KubIcon
            name="headset"
            size={16}
            tone={view.tone === "danger" ? "danger" : view.tone === "live" ? "accent" : "muted"}
          />
        </button>
        {/* The one place this interface declines to claim a success it did not
            have. The chosen output device reaches a running call through
            `useVoiceCall`, and `setOutputDevice` answers `false` where the
            browser would not do it -- Firefox ships no `setSinkId` at all, and
            every browser refuses a device that has been unplugged since it was
            chosen. Without this mark, settings would show a headset selected
            while the call was still coming out of the laptop, and nothing
            anywhere would say so. `warn` rather than `danger`: the call is
            fine, its routing is not, and `--kub-warn` is the tone tuned for a
            mark rather than for a word. */}
        {view.outputRefused && (
          <span
            className="shrink-0"
            title="Звук звонка остался на системном устройстве"
            data-testid="voice-capsule-output-refused"
          >
            <KubIcon
              name="warning"
              size={14}
              tone="warn"
              label="Звук звонка остался на системном устройстве"
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[color:var(--kub-text)]" data-testid="voice-capsule-title">
            {view.title}
          </div>
          <div
            className={cn(
              "truncate text-[11px]",
              view.tone === "danger" ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-muted)]",
            )}
            data-testid="voice-capsule-detail"
          >
            {view.detail}
          </div>
          {/* The person who was silenced, told. Without this line their track
              is simply gone: the microphone button stops doing anything and
              nothing anywhere says why, which reads as a broken microphone or a
              broken application rather than as somebody's decision. So the
              sentence names the moderator — that is the whole content of it.

              Not `truncate`, unlike the two lines above: those are a name and a
              list, where an ellipsis loses nothing that matters, and this is the
              one thing in the capsule that has to be read to the end. It wraps
              instead, and the chrome stack is measured with a border-box
              `ResizeObserver`, so the conversation's top inset follows on its
              own. `--kub-danger-text`, the token tuned for words rather than for
              marks; there is no `--kub-warn-text` in this product. */}
          {speechRevoked && (
            <div
              className="text-[11px] leading-snug text-[color:var(--kub-danger-text)]"
              data-testid="voice-capsule-forced-mute"
            >
              Модератор выключил ваш микрофон.
            </div>
          )}
        </div>

        {shown.length > 0 && (
          /* `TinyUserAvatar`, not a 24px class on `UserAvatar`: the monogram
             keeps its own 32px box, so shrinking the box alone clips the
             letters -- a two-initial monogram rendered as a lone letter in the
             first capture of this capsule. `MessageActionLayer` stacks faces
             the same way, rings and spacing included, and `TinyUserAvatar`
             exists because of exactly this. */
          <div className="hidden shrink-0 items-center -space-x-1 sm:flex" data-testid="voice-capsule-faces">
            {shown.map((participant) => (
              <VoiceSpeakingAvatar
                key={participant.userId}
                userId={participant.userId}
                channelId={channel.id}
              >
                <TinyUserAvatar
                  ringed
                  user={{
                    id: participant.userId,
                    full_name: participant.name,
                    username: null,
                    avatar_url: faces?.get(participant.userId) ?? null,
                  }}
                />
              </VoiceSpeakingAvatar>
            ))}
            {rest > 0 && (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--kub-surface)] bg-[var(--kub-inset)] text-[10px] font-semibold text-[color:var(--kub-muted)]">
                +{rest}
              </span>
            )}
          </div>
        )}

        {/* Deafen, beside the microphone and before it, because that is the
            order every product with both controls uses and because they are
            read as a pair. Drawn even for somebody whose token may not publish:
            not hearing the room needs no permission to speak, which is why
            `view.deafen` is not gated on `canPublish` the way `view.mute` is. */}
        {view.deafen && (
          <button
            type="button"
            onClick={onToggleDeafen}
            className="group/capsule relative h-8 w-8 shrink-0 rounded-full"
            aria-pressed={view.deafened}
            aria-label={view.deafened ? "Включить звук" : "Заглушить звук"}
            title={view.deafened ? "Включить звук" : "Заглушить звук"}
            data-testid="voice-capsule-deafen"
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
        )}

        {view.mute && (
          /* Still drawn while somebody is silenced, and inert rather than
             absent: a control that disappears is read as a feature that went
             away, where a control that is visibly not offered is read as a
             state — and the sentence beside it says whose state. `disabled`
             rather than `aria-disabled`, because there is nothing useful a press
             could do and the browser refusing it is better than a handler that
             silently declines. */
          <button
            type="button"
            onClick={onToggleMute}
            disabled={speechRevoked}
            className={cn(
              "group/capsule relative h-8 w-8 shrink-0 rounded-full",
              speechRevoked && "cursor-not-allowed",
            )}
            aria-pressed={view.muted}
            aria-label={
              speechRevoked
                ? "Модератор выключил ваш микрофон"
                : view.muted
                  ? "Включить микрофон"
                  : "Выключить микрофон"
            }
            title={
              speechRevoked
                ? "Модератор выключил ваш микрофон"
                : view.muted
                  ? "Включить микрофон"
                  : "Выключить микрофон"
            }
            data-testid="voice-capsule-mute"
            data-muted={view.muted ? "true" : "false"}
            data-unavailable={speechRevoked ? "true" : "false"}
          >
            <KubGlassLayer
              className={speechRevoked ? CAPSULE_CONTROL_UNAVAILABLE_GLASS : CAPSULE_CONTROL_GLASS}
            />
            <span className="relative flex h-full w-full items-center justify-center">
              <KubIcon
                name={view.muted ? "microphoneSlash" : "microphone"}
                size={15}
                tone={view.muted ? "danger" : "default"}
              />
            </span>
          </button>
        )}

        {view.action && view.actionLabel && (
          <button
            type="button"
            onClick={view.action === "join" ? onJoin : onLeave}
            disabled={view.busy && view.action !== "cancel"}
            className="group/capsule relative h-8 shrink-0 rounded-full px-3"
            data-testid="voice-capsule-action"
            data-voice-action={view.action}
          >
            <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />
            <span
              className={cn(
                "relative text-xs font-semibold whitespace-nowrap",
                view.action === "join"
                  ? "text-[color:var(--kub-accent-text)]"
                  : "text-[color:var(--kub-danger-text)]",
              )}
            >
              {view.actionLabel}
            </span>
          </button>
        )}
      </div>

      {/* Below the capsule rather than in a portal: it is part of the same
          chrome stack, it is never near a window edge, and a popover would need
          its own dismissal while this closes with the same button that opened
          it. `z-30` puts it over the conversation and under the composer's
          hints at 50, which is the layer `ChannelRailSheet` had to measure. */}
      {healthOpen && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl p-3" data-testid="voice-capsule-health-panel">
          <KubGlassLayer className={CAPSULE_GLASS} />
          <div className="relative">
            <VoiceConnectionPanel open />
          </div>
        </div>
      )}
    </div>
  );
}
