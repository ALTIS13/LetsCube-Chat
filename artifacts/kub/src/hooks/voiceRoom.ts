"use client";

import type { VoiceParticipant } from "@/lib/voiceChannel";
import type { VoiceHealthSample } from "@/lib/voiceConnectionHealth";
import { createVoiceAudioSink } from "@/lib/voiceAudioSink";
import {
  DEFAULT_VOICE_VOLUME,
  normalizeVoiceVolume,
  readStoredVoiceVolumes,
  VOICE_VOLUME_STORAGE_KEY,
  type VoiceAudioSource,
} from "@/lib/voiceVolume";

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
   * Whether the capture is on the air **right now**, which is not the same
   * question as `setMuted`.
   *
   * This is the gate: voice activity opening on a syllable, or a held push-to-
   * talk key. It happens several times a minute in a call and nobody else is
   * told about it, because «not talking at this instant» is not a fact about
   * the conversation — a self-mute is, which is why `setMuted` propagates and
   * this does not. The rules that decide it are in `lib/micGate.ts`, where a
   * `node --test` process can reach them; what is here is only the reaching of
   * the track.
   *
   * It disables the underlying `MediaStreamTrack` rather than muting the
   * publication, and the difference is what the other participants see: a mute
   * draws a crossed microphone beside everybody's name, so a gate built on it
   * would blink that glyph on and off through every sentence. Disabling sends
   * silence instead — measured on 2026-09-18 against a loopback
   * `RTCPeerConnection`: 4902 bytes in two seconds with the track enabled and
   * 482 with it disabled, with `media-source.audioLevel` at 0 — and the
   * publication, the permission and the participant list are all untouched.
   *
   * Accepts being called **before** the join and remembers it, like
   * `setDeafened` and `setParticipantVolume`: a call in push-to-talk mode must
   * not be audible for the moment between publishing and the first press, and
   * the only way to guarantee that is for the state to exist before there is a
   * track to apply it to.
   *
   * A self-mute wins over it. See `applyMicrophoneOpen`.
   */
  setMicrophoneOpen(open: boolean): Promise<void>;
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
  /**
   * How loud one other person is, for this listener alone.
   *
   * Discord's per-user volume, and the local half again: nobody else is told,
   * because it is a decision about this person's ears rather than about the
   * room. Unlike `setDeafened` it is **not** for moderators — every participant
   * may do it to every other participant, so the rule that gates it is in
   * `lib/voiceVolume.ts` and has nothing to do with `lib/voiceModeration.ts`.
   *
   * `volume` is 0..1. Above 1 is not «louder» here but an `IndexSizeError`
   * thrown by `HTMLMediaElement.volume`, because the room carries no
   * `AudioContext` — the header of `lib/voiceVolume.ts` measures this and
   * `normalizeVoiceVolume` is what callers pass through.
   *
   * Accepts somebody who is **not in the room yet** and remembers it, for the
   * same reason `setDeafened` is kept rather than applied once: the value has
   * to hold for a person who arrives later, and the SDK has no «this is how
   * loud that person should be whenever they turn up».
   *
   * Answers nothing, deliberately. Whether a chosen loudness can reach a
   * participant at all is `VoiceParticipant.audioSource`, reported with the
   * rest of the room and re-reported whenever a publication changes — so the
   * interface knows before it draws the slider rather than after a press.
   */
  setParticipantVolume(userId: string, volume: number): Promise<void>;
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
   * Ask the browser to let this call's audio through, after it refused.
   *
   * A browser sounds nothing until the document has been touched, and a join
   * press is such a touch — so the join asks once on its own and this is
   * almost never needed. The case it exists for is a call this person did not
   * press for: a ring answered on another device, or a tab restored into a
   * call. Then the elements exist, the packets arrive and nothing is audible,
   * which is the failure this whole file was silent about.
   *
   * Must be called from a gesture. Resolves either way; whether it worked is
   * announced through `onAudioBlocked`, because the browser can refuse again.
   */
  resumeAudio(): Promise<void>;
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
  /**
   * Whether the browser is refusing to sound this call's audio.
   *
   * `true` is autoplay policy, not a network fault: the elements are attached,
   * the packets are arriving, and the browser will not start playback because
   * the document has not been touched. It is reported rather than logged
   * because the symptom it produces — hearing nothing while every number says
   * the connection is fine — is indistinguishable by ear from a broken call,
   * and this product has already paid for that once.
   *
   * Sent on every change, with `false` the moment playback starts.
   */
  onAudioBlocked(blocked: boolean): void;
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

/**
 * The stored per-person volumes, as one string, or null.
 *
 * Guarded because `localStorage` is not merely absent in some places — it
 * **throws** on access in a private window with site data blocked, which
 * `getAudioSettings` learned first. A listener whose choices cannot be read
 * hears everybody at the default, which is the right failure.
 */
function readStoredVolumeRecord(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(VOICE_VOLUME_STORAGE_KEY);
  } catch {
    return null;
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
  /**
   * Whether the gate is letting the capture through.
   *
   * Kept for two reasons, and the second is the one that was measured rather
   * than assumed. A call in push-to-talk mode sets it before there is a
   * publication to apply it to; and `LocalTrack.setTrackMuted` writes
   * `enabled = !muted` unconditionally, so every unmute puts the track back on
   * the air whatever the gate had decided — read in livekit-client 2.22.3,
   * where `unmute()` reaches `setTrackMuted(false)` and that line is
   * `this._mediaStreamTrack.enabled = !muted`. Without the value held there is
   * nothing to re-apply afterwards, and a person in «Рация» who muted and
   * unmuted would be transmitting with nothing held.
   */
  let microphoneOpen = true;

  /**
   * How loud each person has been set to, by user id. Absent is the default.
   *
   * Seeded from storage here rather than pushed in after the join, and the
   * reason is that there is no component guaranteed to be mounted while a call
   * runs — the capsule lives in one conversation and the call outlives it. A
   * replay driven from a screen would restore a listener's choices only once
   * something happened to draw that screen, so somebody they had turned down
   * would be loud again for as long as they were looking elsewhere.
   *
   * The parsing is not done here. `readStoredVoiceVolumes` takes the raw string
   * and owns every decision about it, so the rule is testable and this file
   * makes one guarded browser call.
   */
  const chosen = readStoredVoiceVolumes(readStoredVolumeRecord());

  /**
   * What one participant's volume should be right now.
   *
   * The two controls meet here and nowhere else, which is the whole point of
   * one function: deafening wins while it is on, and lifting it restores each
   * person's **chosen** loudness rather than 1 — the version that restored 1
   * would quietly undo every per-person choice in the room on the second press
   * of a control that is supposed to be about this listener's own ears.
   */
  const volumeFor = (userId: string): number =>
    deafened ? 0 : chosen.get(userId) ?? DEFAULT_VOICE_VOLUME;

  const applyVolumes = () => {
    for (const remote of room.remoteParticipants.values()) {
      remote.setVolume(volumeFor(remote.identity));
    }
  };

  /**
   * Where the room becomes audible. Every rule about the elements is
   * `lib/voiceAudioSink.ts`, where `node --test` reaches it; what is here is
   * the three LiveKit facts it needs.
   *
   * `onMounted: applyVolumes` is the ordering that matters, and it is not
   * belt-and-braces. `RemoteAudioTrack.attach` re-applies a chosen loudness to
   * a new element behind `if (this.elementVolume)`, and **zero is falsy**
   * (livekit-client 2.22.3) — so the single value that would not survive is
   * silence, and somebody who deafened before a track arrived would hear that
   * person at full volume. Re-applying after the mount is what makes the rule
   * three tests above this one true of a room that is actually audible.
   */
  const sink = createVoiceAudioSink({
    audioKind: Track.Kind.Audio,
    mount: (element) => {
      // The one cast in this file. The sink is written against a narrowed
      // element so a test can build one; this is where the real
      // `HTMLMediaElement` goes back into the document it came from.
      document.body.append(element as unknown as Node);
    },
    onMounted: applyVolumes,
  });

  /**
   * Ask the browser to sound the call, and say whether it agreed.
   *
   * `startAudio` throws when the autoplay policy refuses, and the SDK has
   * already emitted `AudioPlaybackStatusChanged` by then — so the throw is
   * swallowed and the answer is read off the room rather than inferred from
   * whether this resolved.
   */
  const primeAudio = async () => {
    try {
      await room.startAudio();
    } catch {
      // Refused. The line below is what tells anybody.
    }
    events.onAudioBlocked(!room.canPlaybackAudio);
  };

  /**
   * The gate, reaching the track — and never reaching past a mute.
   *
   * `&& !published.isMuted` is the whole of the interaction between the two
   * mechanisms, and it is not defensive tidiness. Both write the same flag:
   * the SDK's `setTrackMuted` sets `enabled = !muted` and this sets
   * `enabled = open`. Without the second half, a syllable arriving while
   * somebody is muted would re-enable a track the SDK still believes is muted
   * — audible to the room, with this client's own interface, the participant
   * list and the SFU all saying «выключен». `lib/micGate.ts` refuses to open
   * the gate while muted for the same reason one layer up; this is the layer
   * that owns the flag, so it says so here too.
   */
  const applyMicrophoneOpen = () => {
    if (!published) return;
    published.mediaStreamTrack.enabled = microphoneOpen && !published.isMuted;
  };

  /**
   * How the room carries one participant's voice.
   *
   * The same lookup `RemoteParticipant.setVolume` makes — by source, not by
   * kind — so this answers the question a listener actually has: will a chosen
   * loudness reach them. A publication under any other source means it never
   * will, however many times the call is made, which is the state every build
   * before 2026-09-18 publishes in.
   *
   * Structurally typed rather than taking the SDK's `Participant`, like
   * `permissionToSpeak` above, so what it reads is visible at the signature.
   * Subscription is deliberately not part of it: the SDK keeps its own
   * `volumeMap` and applies the value when the track arrives, so a publication
   * that exists is enough for a choice to land.
   */
  const audioSourceOf = (who: {
    getTrackPublication(source: typeof Track.Source.Microphone): unknown;
    audioTrackPublications: { size: number };
  }): VoiceAudioSource => {
    if (who.getTrackPublication(Track.Source.Microphone)) return "microphone";
    return who.audioTrackPublications.size > 0 ? "unnamed" : "none";
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
        // Read for this client too, though nobody may set their own volume.
        // The reading is about how the room carries a voice, which is a
        // question with an answer for every participant; who may act on it is
        // `voiceVolumeOffer`'s decision, and keeping the two apart is what
        // stops this field needing a fourth value meaning «not applicable».
        audioSource: audioSourceOf(local),
      });
    }
    for (const remote of room.remoteParticipants.values()) {
      list.push({
        userId: remote.identity,
        name: remote.name || "",
        muted: !remote.isMicrophoneEnabled,
        canSpeak: permissionToSpeak(remote),
        audioSource: audioSourceOf(remote),
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
    applyVolumes();
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
    // Attach **then** report, and in that order for a reason: `reportAndApply`
    // ends in `applyVolumes`, and a volume applied before an element exists is
    // the no-op this whole product has been shipping.
    .on(RoomEvent.TrackSubscribed, (track, publication) => {
      sink.hear(track, publication.trackSid);
      reportAndApply();
    })
    // Not bound at all until 2026-09-19, which was harmless while nothing was
    // attached and is a leak now. A full reconnect — one every fifteen seconds
    // on production today — unsubscribes every track through
    // `Room.handleRestarting`, so this is the path that actually runs.
    .on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
      sink.forget(publication.trackSid);
    })
    // Whether the browser is letting the call be heard. `canPlaybackAudio`
    // starts true and goes false the first time a `play()` is refused.
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      events.onAudioBlocked(!room.canPlaybackAudio);
    })
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
      // Before the early return, because a call that ended without being asked
      // to must not leave its elements in the document either.
      sink.forgetAll();
      // A disconnect this client asked for is not news; one it did not is.
      if (left) return;
      events.onClosed(reason === undefined ? null : String(reason));
    });

  return {
    async join(url, token, microphone) {
      await room.connect(url, token);
      // On the gesture the join press already is, which is the pattern
      // `useCallSoundPriming` established for the ring. Not awaited: a browser
      // that refuses must not hold up a call that is otherwise connected, and
      // the refusal is announced rather than thrown.
      void primeAudio();
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
      // Before anything is reported, because a call joined in «Рация» must not
      // be audible for the length of one event loop. The value was set by the
      // caller before this join and is applied here for the first time.
      applyMicrophoneOpen();
      reportAndAnnounce();
    },
    async setMicrophoneOpen(open) {
      microphoneOpen = open;
      applyMicrophoneOpen();
    },
    async setDeafened(next) {
      deafened = next;
      applyVolumes();
    },
    async setParticipantVolume(userId, volume) {
      // Held first and applied second, in that order and unconditionally: the
      // person may not be in the room yet, and a version that only walked the
      // current participants would be correct exactly once — the mistake
      // `deafened` above is kept in a closure to avoid.
      const next = normalizeVoiceVolume(volume);
      if (next === DEFAULT_VOICE_VOLUME) chosen.delete(userId);
      else chosen.set(userId, next);
      const remote = room.remoteParticipants.get(userId);
      // `volumeFor` rather than `next`, so choosing a loudness while deafened
      // does not make one person audible: what was chosen is remembered and
      // takes effect when the room is being listened to again.
      if (remote) remote.setVolume(volumeFor(userId));
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
      // The gate, put back after the unmute undid it. `setTrackMuted(false)`
      // writes `enabled = true` with no regard for who else owns that flag
      // (livekit-client 2.22.3), so an unmute in «Рация» would otherwise leave
      // the microphone open with nothing held — the person pressed «включить
      // микрофон» and got a live room.
      applyMicrophoneOpen();
      report();
    },
    async sampleHealth() {
      const at = Date.now();

      /**
       * What the room says is being published by other people, and what of it
       * this client has actually subscribed to.
       *
       * Counted as **publications** rather than as tracks, and the difference
       * is a fault this would otherwise hide: a participant whose audio we
       * never subscribed to has a publication and no track, and counting
       * tracks would report «nobody is publishing» for a room that is talking.
       */
      const publications = [...room.remoteParticipants.values()].flatMap((who) => [
        ...who.audioTrackPublications.values(),
      ]);
      const subscribed = publications
        .map((publication) => publication.track)
        .filter((track): track is NonNullable<typeof track> => Boolean(track));

      const blank: VoiceHealthSample = {
        at,
        rttMs: null,
        jitterMs: null,
        packetsSent: null,
        packetsLost: null,
        packetsReceived: null,
        inboundLost: null,
        inboundJitterMs: null,
        samplesPlayed: null,
        audioEnergy: null,
        remoteAudioTracks: publications.length,
      };

      const reportOf = async (source: { getRTCStatsReport(): Promise<RTCStatsReport | undefined> }) => {
        try {
          return await source.getRTCStatsReport();
        } catch {
          // A reading that failed is «unknown». It is not a zero, and it is not
          // an error the call should notice.
          return undefined;
        }
      };

      let rttMs: number | null = null;
      let jitterMs: number | null = null;
      let packetsSent: number | null = null;
      let packetsLost: number | null = null;
      let packetsReceived: number | null = null;
      let inboundLost: number | null = null;
      let inboundJitterMs: number | null = null;
      let samplesPlayed: number | null = null;
      let audioEnergy: number | null = null;

      const add = (held: number | null, value: unknown): number | null =>
        typeof value === "number" && Number.isFinite(value) ? (held ?? 0) + value : held;

      /**
       * The transport's own round trip, used when a media report carries none
       * — which is every reading before the first RTCP arrives, roughly the
       * first second of every call.
       */
      const readCandidatePair = (entry: Record<string, unknown>) => {
        if (
          entry.type === "candidate-pair" &&
          rttMs === null &&
          entry.state === "succeeded" &&
          typeof entry.currentRoundTripTime === "number"
        ) {
          rttMs = entry.currentRoundTripTime * 1000;
        }
      };

      // ── What we send. Only the published track knows, and a listen-only
      // token has no answer to give — which is `null`, not zero.
      if (published) {
        const report = await reportOf(published);
        report?.forEach((entry: Record<string, unknown>) => {
          if (entry.type === "outbound-rtp" && typeof entry.packetsSent === "number") {
            packetsSent = entry.packetsSent;
          }
          if (entry.type === "remote-inbound-rtp") {
            // The server's report on **our** stream: the only place a sender
            // learns what happened to what it sent.
            if (typeof entry.roundTripTime === "number") rttMs = entry.roundTripTime * 1000;
            if (typeof entry.jitter === "number") jitterMs = entry.jitter * 1000;
            if (typeof entry.packetsLost === "number") packetsLost = entry.packetsLost;
          }
          readCandidatePair(entry);
        });
      }

      // ── What arrives. Summed over every subscribed voice, because the
      // question the panel is opened for is «is anything reaching me at all»,
      // and one person's silence is not the room's. Bounded by the channel's
      // participant cap, and only while the panel is open.
      for (const track of subscribed) {
        const report = await reportOf(track);
        report?.forEach((entry: Record<string, unknown>) => {
          if (entry.type === "inbound-rtp" && entry.kind === "audio") {
            packetsReceived = add(packetsReceived, entry.packetsReceived);
            inboundLost = add(inboundLost, entry.packetsLost);
            samplesPlayed = add(samplesPlayed, entry.totalSamplesReceived);
            audioEnergy = add(audioEnergy, entry.totalAudioEnergy);
            if (typeof entry.jitter === "number") {
              // The worst of them rather than the last: a reader notices the
              // voice that is breaking up, not the average of the room.
              const ms = entry.jitter * 1000;
              inboundJitterMs = inboundJitterMs === null ? ms : Math.max(inboundJitterMs, ms);
            }
          }
          readCandidatePair(entry);
        });
      }

      // Somebody is publishing and this client has subscribed to none of them.
      // Zero packets really are arriving, so it is reported as a measurement
      // rather than as an absence — `starved` is the correct reading and
      // `unknown` would hide it.
      if (publications.length > 0 && subscribed.length === 0) {
        packetsReceived = 0;
        inboundLost = 0;
        samplesPlayed = 0;
      }

      if (
        rttMs === null &&
        packetsSent === null &&
        packetsReceived === null
      ) {
        return blank;
      }

      return {
        at,
        rttMs: rttMs === null ? null : Math.round(rttMs),
        jitterMs: jitterMs === null ? null : Math.round(jitterMs * 10) / 10,
        packetsSent,
        packetsLost,
        packetsReceived,
        inboundLost,
        inboundJitterMs: inboundJitterMs === null ? null : Math.round(inboundJitterMs * 10) / 10,
        samplesPlayed,
        audioEnergy,
        remoteAudioTracks: publications.length,
      };
    },
    async resumeAudio() {
      await primeAudio();
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
      // Before the disconnect rather than after it. `disconnect` tears the
      // tracks down, and `detach` on a track whose media has already gone is
      // the throw `forget` has to catch — doing it here means the ordinary
      // path never takes that branch, and the count is zero either way.
      sink.forgetAll();
      // `stopTracks: false` for the same reason as above: the hook stops the
      // capture, so the track is not stopped twice and a failed leave cannot
      // leave the microphone open.
      await room.disconnect(false);
      published = null;
    },
  };
}
