"use client";

import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import {
  orderVoiceParticipants,
  voiceOccupancy,
  voiceOccupancyLabel,
  type VoiceChannelSummary,
  type VoiceParticipant,
} from "@/lib/voiceChannel";

/**
 * The voice channel in the group information panel: the channel, who is in it,
 * and the way in.
 *
 * Section 4.1 puts it here because this is where the members and the invitations
 * already live, and because the participant list has to be readable **before**
 * joining — one tap joins, with no ring and no accept (section 4.2), so the
 * decision has to be informed by something on the screen rather than by what
 * happens after the tap.
 *
 * No glass on this component (rule 6): it sits inside a panel that already
 * carries the material, in a column that scrolls, and the participant rows
 * repeat. The panel's own edge is what separates it, `--kub-rule` divides it
 * from the band above, and nothing here writes a fill, a blur or a shadow.
 *
 * Whether the row appears at all is `voiceChannelRowOffer` in
 * `lib/voiceChannel.ts`, not a condition written here — three different
 * refusals decide it and each is a rule worth a test.
 */

export interface VoiceChannelRowProps {
  channel: VoiceChannelSummary;
  participants: readonly VoiceParticipant[];
  /** Avatars by user id, from the member list this panel already loaded. */
  faces?: ReadonlyMap<string, string | null>;
  selfId: string | null;
  /** True when the channel has no room left. The row still shows; the control does not. */
  full: boolean;
  /** True when this client is in this channel. */
  inCall: boolean;
  /** True while a join is in flight, so a second press cannot start a second one. */
  busy: boolean;
  /** A sentence when the last attempt was refused, already in Russian. */
  refusal: string | null;
  rowClassName: string;
  onJoin: () => void;
  onLeave: () => void;
}

export function VoiceChannelRow({
  channel,
  participants,
  faces,
  selfId,
  full,
  inCall,
  busy,
  refusal,
  rowClassName,
  onJoin,
  onLeave,
}: VoiceChannelRowProps) {
  const ordered = orderVoiceParticipants(participants, selfId);

  return (
    <div
      className="px-4 py-3 mt-2 border-t border-[color:var(--kub-rule)]"
      data-testid="chat-info-voice"
    >
      <div className="mb-1 text-[12px] uppercase tracking-wider text-[color:var(--kub-accent-text)]">
        Голосовой канал
      </div>

      {/* `px-2` so the headset lands in the same column as the bell above it and
          the faces below it: the panel's rows are `px-4` containers holding
          `px-2` rows, and without it this glyph sat 8px to their left. */}
      <div className="flex items-center gap-3 px-2 py-1">
        <KubIcon name="headset" size={17} tone={inCall ? "accent" : "muted"} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[color:var(--kub-text)]" data-testid="chat-info-voice-name">
            {channel.name}
          </div>
          <div className="truncate text-xs text-[color:var(--kub-muted)]" data-testid="chat-info-voice-occupancy">
            {voiceOccupancyLabel(
              voiceOccupancy({ inCall, rowCount: channel.participantCount, listed: ordered.length }),
              channel.maxParticipants,
            )}
          </div>
        </div>
        {inCall ? (
          <button
            type="button"
            onClick={onLeave}
            className={cn(rowClassName, "w-auto shrink-0 px-3 text-xs font-semibold text-[color:var(--kub-danger-text)]")}
            data-testid="chat-info-voice-leave"
          >
            Выйти
          </button>
        ) : full ? (
          // A full channel keeps its row and its people: hiding it would tell
          // somebody who wants to wait for a seat nothing at all.
          <span
            className="shrink-0 text-xs font-semibold text-[color:var(--kub-muted)]"
            data-testid="chat-info-voice-full"
          >
            Заполнен
          </span>
        ) : (
          <button
            type="button"
            onClick={onJoin}
            disabled={busy}
            className={cn(rowClassName, "w-auto shrink-0 px-3 text-xs font-semibold text-[color:var(--kub-accent-text)]")}
            data-testid="chat-info-voice-join"
          >
            {busy ? "Подключаемся…" : "Присоединиться"}
          </button>
        )}
      </div>

      {refusal && (
        <div
          className="mt-1 text-xs text-[color:var(--kub-danger-text)]"
          role="status"
          data-testid="chat-info-voice-refusal"
        >
          {refusal}
        </div>
      )}

      {ordered.length > 0 && (
        <div className="mt-2 space-y-1" data-testid="chat-info-voice-participants">
          {ordered.map((participant) => (
            <div
              key={participant.userId}
              className="flex items-center gap-3 rounded-xl px-2 py-1.5"
              data-testid="chat-info-voice-participant"
            >
              <UserAvatar
                size="sm"
                user={{
                  id: participant.userId,
                  full_name: participant.name,
                  username: null,
                  avatar_url: faces?.get(participant.userId) ?? null,
                }}
              />
              <span
                className="min-w-0 flex-1 truncate text-sm text-[color:var(--kub-text)]"
                data-testid="chat-info-voice-participant-name"
              >
                {participant.userId === selfId ? `${participant.name} (вы)` : participant.name}
              </span>
              {participant.muted && (
                <KubIcon name="microphoneSlash" size={15} tone="muted" label="Микрофон выключен" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
