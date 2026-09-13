"use client";

import { TinyUserAvatar } from "./MessageReactions";
import { KubGlassLayer, KubIcon } from "@/components/kub";
import { CAPSULE_GLASS, CAPSULE_CONTROL_GLASS } from "@/lib/chatChrome";
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
 * What this slice does **not** draw, named so it is not mistaken for an
 * oversight: who is speaking. That is `RoomEvent.ActiveSpeakersChanged` and
 * slice 4.
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
}

/** How many faces fit beside two names at 360 CSS pixels, measured by counting. */
const FACES = 3;

export function VoiceCallCapsule({
  channel,
  participants,
  faces,
  selfId,
  view,
  onJoin,
  onLeave,
  onToggleMute,
}: VoiceCallCapsuleProps) {
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
        <KubIcon
          name="headset"
          size={16}
          tone={view.tone === "danger" ? "danger" : view.tone === "live" ? "accent" : "muted"}
          className="shrink-0"
        />
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
              <TinyUserAvatar
                key={participant.userId}
                ringed
                user={{
                  id: participant.userId,
                  full_name: participant.name,
                  username: null,
                  avatar_url: faces?.get(participant.userId) ?? null,
                }}
              />
            ))}
            {rest > 0 && (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--kub-surface)] bg-[var(--kub-inset)] text-[10px] font-semibold text-[color:var(--kub-muted)]">
                +{rest}
              </span>
            )}
          </div>
        )}

        {view.mute && (
          <button
            type="button"
            onClick={onToggleMute}
            className="group/capsule relative h-8 w-8 shrink-0 rounded-full"
            aria-pressed={view.muted}
            aria-label={view.muted ? "Включить микрофон" : "Выключить микрофон"}
            title={view.muted ? "Включить микрофон" : "Выключить микрофон"}
            data-testid="voice-capsule-mute"
            data-muted={view.muted ? "true" : "false"}
          >
            <KubGlassLayer className={CAPSULE_CONTROL_GLASS} />
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
    </div>
  );
}
