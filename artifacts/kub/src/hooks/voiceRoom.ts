"use client";

import type { VoiceParticipant } from "@/lib/voiceChannel";

/**
 * The SFU, reduced to the five things a call actually asks of it.
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
  /** Leave. Must be safe to call twice and after a failed join. */
  leave(): Promise<void>;
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

  room
    .on(RoomEvent.ParticipantConnected, report)
    .on(RoomEvent.ParticipantDisconnected, report)
    .on(RoomEvent.TrackMuted, report)
    .on(RoomEvent.TrackUnmuted, report)
    .on(RoomEvent.LocalTrackPublished, report)
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
    async setMuted(muted) {
      if (!published) return;
      // The SDK's own mute is what the other participants learn about. It also
      // sets `enabled = false` on the underlying track, so there is one
      // mechanism rather than ours beside its.
      await (muted ? published.mute() : published.unmute());
      report();
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
