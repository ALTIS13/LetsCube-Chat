"use client";

import { UserAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon } from "@/components/kub";
import { cn } from "@/lib/utils";
import {
  orderVoiceParticipants,
  voiceOccupancy,
  voiceOccupancyLabel,
  type VoiceChannelControl,
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
 * refusals decide it and each is a rule worth a test. The same goes for
 * `control`: who may start a voice chat and who may end it is
 * `voiceChannelControl`, and this component only draws the verdict.
 *
 * A group with no channel still reaches this section, with `channel` null: an
 * administrator is offered the one row that starts a voice chat, which is where
 * Telegram puts it and is the only thing in the product that creates the row.
 */

export interface VoiceChannelRowProps {
  /** The channel, or null in a group that has none yet. */
  channel: VoiceChannelSummary | null;
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
  /** What this reader may do to the channel itself. `null` draws neither control. */
  control: VoiceChannelControl;
  /** True while a start or an end is in flight, so a second press cannot start a second one. */
  controlBusy: boolean;
  /** A sentence when the last start or end was refused, already in Russian. */
  controlRefusal: string | null;
  rowClassName: string;
  dangerRowClassName: string;
  onJoin: () => void;
  onLeave: () => void;
  onStart: () => void;
  onEnd: () => void;
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
  control,
  controlBusy,
  controlRefusal,
  rowClassName,
  dangerRowClassName,
  onJoin,
  onLeave,
  onStart,
  onEnd,
}: VoiceChannelRowProps) {
  const ordered = orderVoiceParticipants(participants, selfId);

  return (
    <div
      className="px-4 py-3 mt-2 border-t border-[color:var(--kub-rule)]"
      data-testid="chat-info-voice"
    >
      <div className="mb-1 text-[12px] uppercase tracking-wider text-[color:var(--kub-accent-text)]">
        Голосовой чат
      </div>

      {/* `px-2` so the headset lands in the same column as the bell above it and
          the faces below it: the panel's rows are `px-4` containers holding
          `px-2` rows, and without it this glyph sat 8px to their left. */}
      {channel && (
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
      )}

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

      {/* The administrator's two controls, in the section the channel already
          owns rather than in a second one below it: starting and ending a voice
          chat are the same subject as joining it, and a «Голосовой чат» band
          followed by a lone «Завершить» band would read as two features.

          Both are ordinary panel rows — `actionRowClass` and its danger twin,
          the same shapes the bell and «Покинуть группу» use — so neither adds a
          fill, a blur or a shadow to a card that already carries the material
          (rule 6 of docs/operations/interface-material.md). */}
      {control === "start" && !channel && (
        <button
          type="button"
          onClick={onStart}
          disabled={controlBusy}
          className={cn(rowClassName, "text-[color:var(--kub-text)]")}
          data-testid="chat-info-voice-start"
        >
          <KubIcon name="headset" size={17} tone="muted" className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {controlBusy ? "Начинаем…" : "Начать голосовой чат"}
          </span>
        </button>
      )}

      {control === "end" && channel && (
        <button
          type="button"
          onClick={onEnd}
          disabled={controlBusy}
          className={cn(dangerRowClassName, "mt-1")}
          data-testid="chat-info-voice-end"
        >
          <KubIcon name="phoneOff" size={17} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {controlBusy ? "Завершаем…" : "Завершить голосовой чат"}
          </span>
        </button>
      )}

      {controlRefusal && (
        <div
          className="mt-1 text-xs text-[color:var(--kub-danger-text)]"
          role="status"
          data-testid="chat-info-voice-control-refusal"
        >
          {controlRefusal}
        </div>
      )}
    </div>
  );
}
