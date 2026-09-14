"use client";

import { useMemo } from "react";
import { voiceChannelForCall } from "@/lib/channelRail";
import type { VoiceChannelSummary } from "@/lib/voiceChannel";
import type { ServerChannelsView } from "@/hooks/useServerChannels";

/**
 * One of this chat's voice rooms, for the surfaces that only ever knew about
 * one: the capsule under the header and the group information panel.
 *
 * **This hook no longer reads anything.** It used to do the reading itself, and
 * it did it as `.limit(1)` — which is how a product whose database has allowed
 * many rooms per group since the voice work came to look like it had exactly
 * one. `useServerChannels` reads them all now, and this is the derivation that
 * keeps the two single-channel surfaces working unchanged while the rail draws
 * the rest.
 *
 * Which room it names is the load-bearing part, and it is
 * `voiceChannelForCall`: **the room the call is in wins.** `VoiceCallCapsule`
 * needs that to draw the call you are in rather than the first room in the
 * list, and `voiceCallLostItsChannel` needs it more sharply — it reads «this
 * chat's channel is not the one I am in» as «an administrator ended the voice
 * chat» and hangs up. With one room that could not misfire. With several,
 * naming the first would end a live call the moment anybody joined the second.
 */

export interface VoiceChannelView {
  /** Whether this deployment has the voice tables at all. */
  supported: boolean;
  /** Whether the first read has come back, so an empty list is not drawn as «никого». */
  ready: boolean;
  /**
   * The chat this answer was actually read for, and null when it was not read
   * at all — before the first read, and after one that failed.
   *
   * Opening another conversation changes the chat without clearing what is
   * held, so for a moment this view is the **previous** chat's answer. That is
   * harmless where it only names a capsule, and dangerous where a decision is
   * made from it: «this group has no channel» read off another group's answer
   * would end a call that nobody ended. Both are decided against this field.
   */
  chatId: string | null;
  /** True when the last read errored, so «no room here» is not an answer. */
  failed: boolean;
  channel: VoiceChannelSummary | null;
  /** Ids only. Names come from the chat's member list, through `resolveVoiceParticipants`. */
  participantIds: string[];
  refresh: () => void;
}

/**
 * @param channels every channel this chat has, from `useServerChannels`.
 * @param callChannelId the room this client's call is in, or null.
 */
export function useVoiceChannel(
  channels: ServerChannelsView,
  callChannelId: string | null,
): VoiceChannelView {
  return useMemo(() => {
    const room = voiceChannelForCall(channels.channels, callChannelId);
    return {
      supported: channels.supported,
      ready: channels.ready,
      failed: channels.failed,
      chatId: channels.chatId,
      channel: room
        ? {
            id: room.id,
            name: room.name,
            participantCount: Math.max(0, room.participantCount ?? 0),
            // The same floor the single-channel read carried: a row without a
            // limit is drawn as the column's own default rather than as a room
            // that cannot hold anybody.
            maxParticipants: Math.max(1, room.maxParticipants ?? 10),
          }
        : null,
      participantIds: room ? [...(channels.participants.get(room.id) ?? [])] : [],
      refresh: channels.refresh,
    };
  }, [callChannelId, channels]);
}
