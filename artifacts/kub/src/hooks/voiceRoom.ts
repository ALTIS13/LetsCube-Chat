"use client";

import type { VoiceParticipant } from "@/lib/voiceChannel";
import type { VoiceHealthSample } from "@/lib/voiceConnectionHealth";

/**
 * The SFU, reduced to what a call actually asks of it.
 *
 * Two reasons this interface exists rather than `Room` being used directly.
 *
 * **The dependency has to stay out of the initial bundle.** `livekit-client` is
 * 12.4 MB unpacked across 636 files with ten transitive dependencies, and
 * question 8 of the proposal made «does it lazy-split out of the main chunk» a
 * condition of adoption rather than an assumption. Everything that names a
 * LiveKit value is inside `createLiveKitRoom`, behind `await import(…)`; every
 * other module in this feature knows only this interface and `import type`,
 * which erases. `tests/unit/voice-chunking.test.mjs` reads the build's own
 * output and fails if the SDK ever lands in `index-*.js`.
 *
 * **And it is the seam.** Section 2.3 chose LiveKit partly because it can be
 * replaced: swapping to mediasoup or Janus rewrites one function in this file
 * and nothing else in the client. The same narrowness is what lets a Playwright
 * spec stand in for a server that does not exist yet — see `loadVoiceRoom`.
 */
export interface VoiceRoom {
  /**
   * Connect and publish the already-captured microphone track.
   *
   * `null` is a token the gateway said may not publish: the client joins,
   * subscribes and hears, and holds no capture at all.
   */
  join(url: string, token: string, microphone: MediaStreamTrack | null): Promise<void>;
  /** Self-mute, which the SFU propagates to everyone connected. */
  setMuted(muted: boolean): Promise<void>;
  /**
   * Stop hearing everybody, locally.
   *
   * Discord's «deafen», and the local half of it: nobody else learns about it,
   * because it is a decision about this person's own ears rather than about the
   * room. Self-mute is the opposite — the SFU tells everyone, because a muted
   * microphone is a fact about the conversation.
   *
   * `setVolume(0)` on every remote audio track rather than
   * `setEnabled(false)`, which would unsubscribe and save the bandwidth. The
   * trade is deliberate: unsubscribing makes undeafening take a round trip to
   * resubscribe, and a control that is instant one way and laggy the other is
   * the one people press twice. It has to hold for participants who join while
   * it is on, which is why the value is kept and re-applied on every event
   * rather than set once.
   */
  setDeafened(deafened: boolean): Promise<void>;
  /** Leave. Must be safe to call twice and after a failed join. */
  leave(): Promise<void>;
  /**
   * One reading of the connection, for the panel the owner asked for on
   * 2026-09-18.
   *
   * Returns the shape `lib/voiceConnectionHealth.ts` consumes, with `null` for
   * anything this reading could not measure — never a zero. A zero round trip
   * draws a line on the graph's floor, which reads as a perfect connection at
   * exactly the moment there is none.
   *
   * Pulled rather than pushed. The SDK has a `ConnectionQualityChanged` event,
   * but it carries a three-value verdict rather than milliseconds, and the
   * panel shows numbers. Sampling on a timer is also what lets the graph have
   * an even time axis, which an event stream does not.
   */
  sampleHealth(): Promise<VoiceHealthSample>;
  /**
   * Send the call's audio to a particular output device.
   *
   * This existed nowhere for calls until 2026-09-18: `applyAudioOutputDevice`
   * moved voice *messages*, media playback and the composer's preview, and a
   * call ignored the choice entirely. Picking a headset moved everything except
   * the thing people pick a headset for.
   *
   * `false` means the browser refused — Firefox has no `setSinkId`, and Safari
   * only gained it recently — and the caller must not report success.
   */
  setOutputDevice(deviceId: string): Promise<boolean>;
  /**
   * Which media server this call landed on, as «region-node», or null.
   *
   * Discord shows it («finland14135» in the owner's screenshot) and it is the
   * one fact that makes a support conversation about a bad call tractable: two
   * people on the same node with the same problem is a different report from
   * two people on different continents.
   */
  serverName(): string | null;
}

/** What the room tells the interface. Everything else the SDK emits is slice 3 or 4. */
export interface VoiceRoomEvents {
  /** The whole list, every time — never a diff. The SDK holds the truth, not us. */
  onParticipants(participants: VoiceParticipant[]): void;
  /** The transport dropped and the SDK is putting it back, or has. */
  onReconnecting(): void;
  onReconnected(): void;
  /** The call ended for a reason other than this client asking it to. */
  onClosed(reason: string | null): void;
  /**
   * Who is speaking right now, by user id. The whole set, never a diff.
   *
   * The SDK decides this from its own audio levels, which is the only place it
   * can be decided correctly: a client cannot hear a remote track's level
   * without the SFU forwarding it, and the SFU is what publishes the speaker
   * list. Computing it here from a local analyser would answer for one person.
   */
  onSpeakers(userIds: string[]): void;
}

/**
 * A DEV-only stand-in for the SFU, and why it is allowed to exist.
 *
 * The gateway and the reconciler are being written by other agents at the same
 * time as this, so there is no endpoint to mint a token and no room to join. A
 * spec can still prove every rule that belongs to the interface — the capsule
 * appearing, the participant line, mute reaching the published track, «Выйти»
 * stopping the microphone, the call outliving a change of conversation — if the
 * transport can be replaced for the length of a test.
 *
 * It is gated on `import.meta.env.DEV`, like the public-preview capture route,
 * so a production bundle has no path to it: the condition folds to `false` at
 * build time and the branch is dropped.
 */
declare global {
  interface Window {
    __letscubeVoiceRoom?: (events: VoiceRoomEvents) => VoiceRoom;
  }
}

/** The runtime, fetched once per join. The browser caches the chunk after the first. */
export async function loadVoiceRoom(events: VoiceRoomEvents): Promise<VoiceRoom> {
  if (import.meta.env.DEV && typeof window !== "undefined" && window.__letscubeVoiceRoom) {
    return window.__letscubeVoiceRoom(events);
  }
  return createLiveKitRoom(events);
}

/**
 * The real thing. Every LiveKit name in the client is inside this function.
 *
 * The participant list is rebuilt from the room's own maps on every event
 * rather than patched, because the SDK's view is the only correct one and a
 * patched copy is a second truth — the mistake section 3.1 of the proposal
 * exists to prevent, in the small.
 */
async function createLiveKitRoom(events: VoiceRoomEvents): Promise<VoiceRoom> {
  const { LocalAudioTrack, Room, RoomEvent } = await import("livekit-client");

  const room = new Room();
  let published: InstanceType<typeof LocalAudioTrack> | null = null;
  let left = false;
  // Kept rather than applied once: somebody who joins while this is on has to
  // arrive silent, and the SDK has no «default volume for this room».
  let deafened = false;

  const applyDeafened = () => {
    for (const remote of room.remoteParticipants.values()) {
      remote.setVolume(deafened ? 0 : 1);
    }
  };

  const report = () => {
    const list: VoiceParticipant[] = [];
    const local = room.localParticipant;
    if (local?.identity) {
      list.push({ userId: local.identity, name: local.name || "", muted: !local.isMicrophoneEnabled });
    }
    for (const remote of room.remoteParticipants.values()) {
      list.push({ userId: remote.identity, name: remote.name || "", muted: !remote.isMicrophoneEnabled });
    }
    events.onParticipants(list);
  };

  const reportAndApply = () => {
    applyDeafened();
    report();
  };

  room
    .on(RoomEvent.ParticipantConnected, reportAndApply)
    .on(RoomEvent.ParticipantDisconnected, report)
    .on(RoomEvent.TrackSubscribed, reportAndApply)
    .on(RoomEvent.TrackMuted, report)
    .on(RoomEvent.TrackUnmuted, report)
    .on(RoomEvent.LocalTrackPublished, report)
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      // Identities, not participant objects: everything above this seam knows
      // people by the id `chat_members` uses, and the SDK's participant is a
      // LiveKit value that must not escape this function.
      events.onSpeakers(speakers.map((who) => who.identity).filter(Boolean));
    })
    .on(RoomEvent.Reconnecting, () => events.onReconnecting())
    .on(RoomEvent.Reconnected, () => {
      events.onReconnected();
      report();
    })
    .on(RoomEvent.Disconnected, (reason) => {
      // A disconnect this client asked for is not news; one it did not is.
      if (left) return;
      events.onClosed(reason === undefined ? null : String(reason));
    });

  return {
    async join(url, token, microphone) {
      await room.connect(url, token);
      if (!microphone) {
        report();
        return;
      }
      // `userProvidedTrack` is true: this track came from our own capture, and
      // the SDK must not stop it behind our back — the hook owns its lifetime
      // and ends it on leave, which is what turns the microphone light off.
      published = new LocalAudioTrack(microphone, undefined, true);
      await room.localParticipant.publishTrack(published);
      report();
    },
    async setDeafened(next) {
      deafened = next;
      applyDeafened();
    },
    async setMuted(muted) {
      if (!published) return;
      // The SDK's own mute is what the other participants learn about. It also
      // sets `enabled = false` on the underlying track, so there is one
      // mechanism rather than ours beside its.
      await (muted ? published.mute() : published.unmute());
      report();
    },
    async sampleHealth() {
      const at = Date.now();
      const blank: VoiceHealthSample = {
        at,
        rttMs: null,
        jitterMs: null,
        packetsSent: null,
        packetsLost: null,
      };
      // The published track when there is one; otherwise any subscribed track,
      // because somebody the gateway refused publication to still has a
      // connection worth measuring and would otherwise see an empty panel.
      const source =
        published ??
        [...room.remoteParticipants.values()]
          .flatMap((who) => [...who.audioTrackPublications.values()])
          .map((publication) => publication.track)
          .find((track) => Boolean(track)) ??
        null;
      if (!source) return blank;

      let report: RTCStatsReport | undefined;
      try {
        report = await source.getRTCStatsReport();
      } catch {
        // A reading that failed is «unknown», which is what `blank` says. It is
        // not a zero and it is not an error the call should notice.
        return blank;
      }
      if (!report) return blank;

      let rttMs: number | null = null;
      let jitterMs: number | null = null;
      let packetsSent: number | null = null;
      let packetsLost: number | null = null;

      report.forEach((entry: Record<string, unknown>) => {
        const kind = entry.type;
        if (kind === "outbound-rtp" && typeof entry.packetsSent === "number") {
          packetsSent = entry.packetsSent;
        } else if (kind === "inbound-rtp" && packetsSent === null && typeof entry.packetsReceived === "number") {
          // A listener has no outbound counter. What it can report is what it
          // received and what went missing on the way, which is the same
          // question asked from the other end.
          packetsSent = entry.packetsReceived + (typeof entry.packetsLost === "number" ? entry.packetsLost : 0);
          if (typeof entry.packetsLost === "number") packetsLost = entry.packetsLost;
          if (typeof entry.jitter === "number") jitterMs = entry.jitter * 1000;
        }
        if (kind === "remote-inbound-rtp") {
          if (typeof entry.roundTripTime === "number") rttMs = entry.roundTripTime * 1000;
          if (typeof entry.jitter === "number") jitterMs = entry.jitter * 1000;
          if (typeof entry.packetsLost === "number") packetsLost = entry.packetsLost;
        }
        // The transport's own round trip, used when the media report carries
        // none — which is every reading before the first RTCP arrives, roughly
        // the first second of every call.
        if (
          kind === "candidate-pair" &&
          rttMs === null &&
          entry.state === "succeeded" &&
          typeof entry.currentRoundTripTime === "number"
        ) {
          rttMs = entry.currentRoundTripTime * 1000;
        }
      });

      return {
        at,
        rttMs: rttMs === null ? null : Math.round(rttMs),
        jitterMs: jitterMs === null ? null : Math.round(jitterMs * 10) / 10,
        packetsSent,
        packetsLost,
      };
    },
    async setOutputDevice(deviceId) {
      try {
        return await room.switchActiveDevice("audiooutput", deviceId);
      } catch {
        // `setSinkId` is missing in Firefox and throws on a device the browser
        // will not hand over. Refused is an answer; a thrown error here would
        // end a call over a headset choice.
        return false;
      }
    },
    serverName() {
      const info = room.serverInfo;
      if (!info) return null;
      const region = typeof info.region === "string" ? info.region.trim() : "";
      const node = typeof info.nodeId === "string" ? info.nodeId.trim() : "";
      if (!region && !node) return null;
      // Discord's own shape: the region and the node run together, «finland14135».
      return region && node ? `${region}${node}` : region || node;
    },
    async leave() {
      left = true;
      // `stopTracks: false` for the same reason as above: the hook stops the
      // capture, so the track is not stopped twice and a failed leave cannot
      // leave the microphone open.
      await room.disconnect(false);
      published = null;
    },
  };
}
