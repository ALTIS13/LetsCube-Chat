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
  /**
   * Self-mute, which the SFU propagates to everyone connected.
   *
   * Does nothing to the track when the room has taken this client's publish
   * permission away — there is nothing published to mute, and muting the
   * capture on its own would tell nobody. It re-announces the permission
   * instead, so the state above says who silenced whom rather than drawing a
   * mute this person never pressed.
   */
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
  /**
   * Whether the room currently lets **this client** be heard, as the media
   * server itself answers it. `null` means it has not said.
   *
   * Sent on every change and on the join, never on a timer. It exists because a
   * permission can be taken away in the middle of a call by somebody else —
   * a moderator silencing a person through the gateway — and the only place
   * that fact arrives is the SFU. Nothing above this interface can compute it:
   * the join-time grant says what the token asked for, not what the room
   * allows now.
   *
   * `null` is unknown and must not be read as a refusal. The same rule
   * `lossBetween` follows in `lib/voiceConnectionHealth.ts`, where a counter
   * that is missing answers `null` rather than a confident zero.
   */
  onSpeechAllowed(allowed: boolean | null): void;
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
  const { LocalAudioTrack, Room, RoomEvent, Track } = await import("livekit-client");

  // `stopLocalTrackOnUnpublish: false` for exactly the reason
  // `userProvidedTrack` is true below — the hook owns the capture's lifetime —
  // except that the path this governs is not one we ask for. When the SFU takes
  // this client's publish permission away it unpublishes the track on our
  // behalf, and the SDK's own `unpublishTrack` then reads
  // `stopOnUnpublish ?? roomOptions.stopLocalTrackOnUnpublish ?? true` and
  // calls `track.stop()`, with no regard for `isUserProvided` (measured in
  // livekit-client 2.22.3). That ends the `MediaStreamTrack` the hook is
  // holding: the browser's microphone light goes out in the middle of a call
  // the person is still in, and there is nothing left to publish when a
  // moderator gives the permission back — only a second `getUserMedia`, prompt
  // and all. `false` makes it `stopMonitor()` instead, and `leave()` stays the
  // one thing that ends the capture.
  const room = new Room({ stopLocalTrackOnUnpublish: false });
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

  /**
   * Whether the room lets one participant publish, or `null` when it has not
   * said.
   *
   * Read from the permissions the server hands out, never inferred from whether
   * a track is on the air: `!isMicrophoneEnabled` is true for somebody who
   * pressed their own microphone button **and** for somebody the SFU silenced,
   * and those are the two facts the moderation menu has to tell apart.
   *
   * Absent is unknown. A participant carries no `permissions` until a
   * `ParticipantInfo` with a `permission` arrives for them, and reading that
   * gap as `false` would draw everybody as silenced for the first moments of
   * every call — and offer to un-silence people nobody had touched.
   *
   * Structurally typed rather than taking the SDK's `Participant`, so the
   * narrowness of what this reads is visible at the signature.
   */
  const permissionToSpeak = (who: { permissions?: { canPublish: boolean } }): boolean | null =>
    who.permissions ? who.permissions.canPublish : null;

  /**
   * The same question about this client. `null` while the room has not said.
   *
   * Guarded on the participant existing for the same reason `report` writes
   * `local?.identity`: the type says it is always there, and the code here has
   * to run before a connection and after a failed one.
   */
  const speechAllowed = (): boolean | null => {
    const local = room.localParticipant;
    return local ? permissionToSpeak(local) : null;
  };

  const report = () => {
    const list: VoiceParticipant[] = [];
    const local = room.localParticipant;
    if (local?.identity) {
      list.push({
        userId: local.identity,
        name: local.name || "",
        muted: !local.isMicrophoneEnabled,
        canSpeak: permissionToSpeak(local),
      });
    }
    for (const remote of room.remoteParticipants.values()) {
      list.push({
        userId: remote.identity,
        name: remote.name || "",
        muted: !remote.isMicrophoneEnabled,
        canSpeak: permissionToSpeak(remote),
      });
    }
    events.onParticipants(list);
  };

  /**
   * What was last said upwards about this client's own permission.
   *
   * `undefined` is «nothing said yet», which is a third state beside the
   * `boolean | null` the interface carries: it is what makes the first
   * announcement of a call happen even when the answer is the ordinary one.
   * Held so that a permission change belonging to somebody else — every
   * `ParticipantPermissionsChanged` in the room reaches the same handler —
   * costs the state above nothing.
   */
  let announcedSpeech: boolean | null | undefined;

  const announceSpeech = () => {
    const allowed = speechAllowed();
    if (allowed === announcedSpeech) return;
    announcedSpeech = allowed;
    events.onSpeechAllowed(allowed);
  };

  const reportAndApply = () => {
    applyDeafened();
    report();
  };

  /** Both halves of the same event: who is in the room, and what it allows us. */
  const reportAndAnnounce = () => {
    report();
    announceSpeech();
  };

  room
    .on(RoomEvent.ParticipantConnected, reportAndApply)
    .on(RoomEvent.ParticipantDisconnected, report)
    .on(RoomEvent.TrackSubscribed, reportAndApply)
    .on(RoomEvent.TrackMuted, report)
    .on(RoomEvent.TrackUnmuted, report)
    .on(RoomEvent.LocalTrackPublished, report)
    // The three events a revoked publish permission actually raises, and the
    // reason the rail used to show an unmuted microphone for somebody who
    // could no longer speak: none of them was bound.
    //
    // `TrackUnpublished` is a **remote** participant's track going away —
    // the SDK's own typing is `(publication: RemoteTrackPublication,
    // participant: RemoteParticipant)`, and it never fires for us.
    // `LocalTrackUnpublished` is the same event for this client, and it is the
    // one that arrives when the SFU drops our microphone: the server sends a
    // `trackUnpublished` signal, `LocalParticipant.handleLocalTrackUnpublished`
    // unpublishes, and `isMicrophoneEnabled` goes false with nobody told.
    // `ParticipantPermissionsChanged` is the fact underneath both, and the Room
    // re-emits it for remote participants as well as for the local one
    // (`setupParticipant` in livekit-client 2.22.3 forwards the participant
    // event through `emitWhenConnected`), which is why it is the source of
    // truth rather than the unpublish: a permission can be taken away without
    // any track having been published to lose.
    .on(RoomEvent.TrackUnpublished, report)
    .on(RoomEvent.LocalTrackUnpublished, reportAndAnnounce)
    .on(RoomEvent.ParticipantPermissionsChanged, reportAndAnnounce)
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      // Identities, not participant objects: everything above this seam knows
      // people by the id `chat_members` uses, and the SDK's participant is a
      // LiveKit value that must not escape this function.
      events.onSpeakers(speakers.map((who) => who.identity).filter(Boolean));
    })
    .on(RoomEvent.Reconnecting, () => events.onReconnecting())
    .on(RoomEvent.Reconnected, () => {
      events.onReconnected();
      // Announced as well as reported: a permission can be taken away while the
      // transport is down, and the change event for it was raised at a moment
      // this client had nowhere to receive it.
      reportAndAnnounce();
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
        reportAndAnnounce();
        return;
      }
      // `userProvidedTrack` is true: this track came from our own capture, and
      // the SDK must not stop it behind our back — the hook owns its lifetime
      // and ends it on leave, which is what turns the microphone light off.
      published = new LocalAudioTrack(microphone, undefined, true);
      // `source` named explicitly, and it is not cosmetic. A `LocalAudioTrack`
      // built by hand carries `Track.Source.Unknown`; `publishTrack` overwrites
      // that only from `opts.source`, and the value is then what both the SDK
      // and the SFU key on. `isMicrophoneEnabled` reads
      // `getTrackPublication(Track.Source.Microphone)` and answers **false**
      // for an Unknown publication, for the local participant and for every
      // remote one, so without this line every person in the call reports as
      // muted for its whole length. `RemoteParticipant.setVolume` defaults to
      // the same source, finds no publication and returns having done nothing,
      // so without this line deafening is a no-op as well. All three measured
      // in livekit-client 2.22.3: `publishOrRepublishTrack`
      // (`if (opts.source) track.source = opts.source`),
      // `Participant.getTrackPublication`, `RemoteParticipant.setVolume`.
      await room.localParticipant.publishTrack(published, { source: Track.Source.Microphone });
      reportAndAnnounce();
    },
    async setDeafened(next) {
      deafened = next;
      applyDeafened();
    },
    async setMuted(muted) {
      // The room's answer comes first, and `!published` cannot stand in for it.
      // When the SFU revokes this client's publish permission it removes the
      // **publication**; `published` is still the `LocalAudioTrack` this
      // function made, still non-null and still perfectly willing to be muted.
      // So the early return below never fires on that path, `published.mute()`
      // succeeds, the SDK has already detached its own mute listener in
      // `unpublishTrack`, nothing reaches the SFU, and the button reports a
      // mute this person did not press over audio nobody was carrying anyway.
      //
      // It does not throw, either: a press has to be answered, and the answer
      // here is the permission itself — the state above turns that into a
      // sentence naming who silenced them.
      if (speechAllowed() === false) {
        reportAndAnnounce();
        return;
      }
      if (!published) return;
      if (muted) {
        // The SDK's own mute is what the other participants learn about. It
        // also sets `enabled = false` on the underlying track, so there is one
        // mechanism rather than ours beside its.
        await published.mute();
        report();
        return;
      }
      // Unmuting when the publication is gone: the SFU removed it while the
      // permission was revoked, and the permission has since come back. Only
      // unmuting the track would leave a control that reads as pressed and
      // carries no audio — the same defect one step further along. The capture
      // is still live because `stopLocalTrackOnUnpublish` is off above, so the
      // same track goes back on the air rather than a new microphone prompt.
      if (!room.localParticipant.getTrackPublication(Track.Source.Microphone)) {
        await room.localParticipant.publishTrack(published, { source: Track.Source.Microphone });
      }
      await published.unmute();
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
