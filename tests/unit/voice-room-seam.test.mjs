// What happens below the transport seam, read as source — because nothing else
// can see it.
//
// `hooks/voiceRoom.ts` is the one file in the client that names a LiveKit
// value, and `tests/e2e/voice-call.spec.ts` replaces it wholesale with a
// stand-in. That is deliberate and it is what lets the whole call be tested
// without an SFU. It also means **every rule that lives inside
// `createLiveKitRoom` is invisible to that suite**, and one of them was found
// by mutation on 2026-09-18: taking the deafen re-application off
// `TrackSubscribed` left all three deafen tests green.
//
// So this file reads the source. It is a weaker instrument than a behavioural
// test and the weakness is stated rather than hidden: it proves a call site
// exists, not that the SDK does what the call site asks. What it does catch is
// the class of change that actually happens — somebody simplifying an event
// handler and quietly dropping a re-application nothing else notices.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Comments stripped. Three guards fired on prose rather than code today. */
const strip = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const source = readFileSync("artifacts/kub/src/hooks/voiceRoom.ts", "utf8");
const code = strip(source);

/**
 * Two files above the seam, read the same way and for a narrower reason.
 *
 * They are not invisible to `tests/e2e/voice-call.spec.ts` the way the room is
 * — the stand-in replaces the transport, not the store or the capsule — but
 * that spec's stand-in never calls `onSpeechAllowed`, so the rules that decide
 * whether a revocation happened, and the sentence that tells the person, have
 * no behavioural cover today. Source reading is the weaker instrument and this
 * is where it earns its place: a behavioural test for these belongs in the
 * spec, and until the stand-in grows the call these two guards are what stop
 * the rules being simplified away.
 */
const callCode = strip(readFileSync("artifacts/kub/src/hooks/useVoiceCall.ts", "utf8"));
const capsuleCode = strip(
  readFileSync("artifacts/kub/src/components/chat/VoiceCallCapsule.tsx", "utf8"),
);

test("the seam is the only file that names LiveKit, and it loads it lazily", () => {
  // The control for everything below: if this file stopped being the seam,
  // the source reads here would be measuring the wrong thing entirely.
  assert.match(
    code,
    /await import\("livekit-client"\)/,
    "the SDK is no longer behind a dynamic import, which puts it in the entry bundle",
  );
  assert.match(code, /RoomEvent/, "this file no longer handles room events");
});

test("somebody who joins while you are deafened arrives silent", () => {
  // The mutation this exists for: `TrackSubscribed` handled by the reporter
  // rather than by the applier. Deafening then holds for everybody who was in
  // the room when it was pressed and for nobody who arrives after — which is
  // the case a person notices and no test could see.
  assert.match(
    code,
    /const applyVolumes = \(\) => \{/,
    "the volume state is no longer re-applied, so it is set once and forgotten",
  );

  for (const event of ["ParticipantConnected", "TrackSubscribed"]) {
    const line = code
      .split("\n")
      .find((entry) => entry.includes(`RoomEvent.${event}`));
    assert.ok(line, `nothing handles RoomEvent.${event}`);
    assert.match(
      line,
      /reportAndApply/,
      `RoomEvent.${event} does not re-apply the deafen state, so somebody who ` +
        `arrives after it was pressed is audible`,
    );
  }
});

test("the deafen value is kept, because the SDK has no default volume for a room", () => {
  // `setVolume` is per participant and there is nowhere to say «everybody who
  // joins from now on». So the flag has to live in the closure; a version that
  // only walked the current participants would be correct exactly once.
  assert.match(code, /let deafened = false;/, "the deafen state is no longer held");
  assert.match(
    code,
    /remote\.setVolume\(volumeFor\(remote\.identity\)\)/,
    "the applier no longer asks for one participant's own volume",
  );
});

/* ── Per-person volume, and the knob deafen already owns ──────────────────────
 *
 * Discord's per-user volume is `RemoteParticipant.setVolume`, which is the
 * exact call `setDeafened` makes on everybody. So the two are one knob with two
 * owners, and the guards below are about them not fighting over it. None of
 * this is visible to `tests/e2e/server-channel-rail.spec.ts`: that spec
 * replaces the transport, so what it proves is that the interface asks — what
 * the room then applies is here, read as source.
 */

test("the two controls meet in one function, so undeafening restores what was chosen", () => {
  // The mutation this exists for is the one a simplification reaches for first:
  // `deafened ? 0 : 1`, which is what this file said until the per-person
  // volume existed. It looks harmless and it silently undoes every per-person
  // choice in the room on the second press of a control that is supposed to be
  // about nothing but this listener's own ears.
  assert.match(
    code,
    /deafened \? 0 : chosen\.get\(userId\) \?\? DEFAULT_VOICE_VOLUME;/,
    "the deafen state and the chosen volume are no longer decided together, so one " +
      "of them is overwriting the other",
  );
  assert.ok(
    !code.includes("setVolume(deafened ? 0 : 1)"),
    "deafening sets everybody back to 1 on the way out, which throws away every " +
      "per-person volume in the room",
  );
});

test("a volume chosen for somebody who is not here yet is kept", () => {
  // The same rule `deafened` is held in the closure for: the SDK has no
  // «whenever that person turns up, this is how loud they should be». A version
  // that only pushed to a participant who is present would be correct exactly
  // once, and would lose a choice made a second before somebody reconnected.
  const start = code.indexOf("async setParticipantVolume(");
  assert.ok(start > 0, "the seam no longer carries the per-person volume");
  const end = code.indexOf("async sampleHealth()", start);
  assert.ok(end > start, "sampleHealth no longer follows setParticipantVolume — check this slice");
  const body = code.slice(start, end);
  const held = body.indexOf("chosen.set(userId, next)");
  const pushed = body.indexOf("remote.setVolume(");
  assert.ok(held >= 0, "the chosen volume is no longer held, so it is lost on the next event");
  assert.ok(pushed > held, "the volume is pushed before it is held, or not pushed at all");
  assert.ok(
    body.includes("room.remoteParticipants.get(userId)"),
    "the participant is no longer found by identity, which is what that map is keyed by",
  );
  assert.ok(
    body.includes("remote.setVolume(volumeFor(userId))"),
    "a volume chosen while deafened is applied straight away, which makes one " +
      "person audible in a room this listener has stopped hearing",
  );
  assert.ok(
    body.includes("normalizeVoiceVolume(volume)"),
    "the value reaches the element unclamped, and above 1 `HTMLMediaElement.volume` " +
      "throws rather than getting louder",
  );
});

test("the chosen volumes are seeded where the room is built, not pushed in by a screen", () => {
  // There is no component guaranteed to be mounted while a call runs — the
  // capsule lives in one conversation and the call outlives it. A replay driven
  // from a screen would restore a listener's choices only once something
  // happened to draw that screen, so somebody they had turned down would be
  // loud again for as long as they were looking elsewhere.
  assert.match(
    code,
    /const chosen = readStoredVoiceVolumes\(readStoredVolumeRecord\(\)\);/,
    "a new room no longer starts from the stored volumes, so every choice is " +
      "forgotten when the room is rejoined",
  );
  // And the read is guarded, because access itself throws in a private window
  // with site data blocked — the failure `getAudioSettings` met first.
  const start = code.indexOf("function readStoredVolumeRecord()");
  assert.ok(start > 0, "the guarded storage read is gone");
  const body = code.slice(start, code.indexOf("export async function loadVoiceRoom", start));
  assert.match(body, /catch \{/, "an unreadable storage now takes the call down with it");
});

test("whether a volume can reach a participant is read from the room, never claimed", () => {
  // The trap this whole feature sits on. `setVolume` finds its publication by
  // source, and every build before 2026-09-18 published its capture as
  // `Unknown` — so for those participants the call changes nothing and reports
  // no error. The reading has to be the same lookup, or the interface is
  // guessing on the reader's behalf.
  const start = code.indexOf("const audioSourceOf = (");
  assert.ok(start > 0, "the seam no longer reads how a voice is carried");
  const body = code.slice(start, code.indexOf("const report = () => {", start));
  assert.ok(
    body.includes("getTrackPublication(Track.Source.Microphone)"),
    "the reading is no longer the lookup `setVolume` itself makes, so it can answer " +
      "yes for a participant whose volume cannot be moved",
  );
  assert.ok(
    body.includes('audioTrackPublications.size > 0 ? "unnamed" : "none"'),
    "publishing nothing and publishing under another name have collapsed into one " +
      "answer — and only one of the two is an older build",
  );
  assert.ok(
    code.includes("audioSource: audioSourceOf(local)") &&
      code.includes("audioSource: audioSourceOf(remote)"),
    "report no longer reads this fact for both halves of the room",
  );
  // No invented value, the same rule `canSpeak` follows one field above it.
  for (const invented of [
    'audioSource: "microphone"',
    'audioSource: "unnamed"',
    'audioSource: "none"',
    "audioSource: null",
  ]) {
    assert.ok(
      !code.includes(invented),
      `report states «${invented}» outright, which is a claim rather than a reading`,
    );
  }
});

test("the seam's own interface carries the volume, named for the meaning", () => {
  assert.ok(
    code.includes("setParticipantVolume(userId: string, volume: number): Promise<void>;"),
    "the transport seam no longer offers a per-person volume, so nothing above it " +
      "can ask for one without naming LiveKit itself",
  );
  assert.ok(
    code.includes("type VoiceAudioSource,") && code.includes("): VoiceAudioSource => {"),
    "the seam no longer names the union it reports, so the reading has no type",
  );
  // And the decisions about it stay out of here. The seam reads the room and
  // reports; what the interface may draw from that reading is
  // `lib/voiceVolume.ts`, where `node --test` reaches it.
  for (const decision of ["voiceVolumeOffer", "voiceVolumeNotice", "not_offered"]) {
    assert.ok(
      !code.includes(decision),
      `the seam decides «${decision}», which is a rule in a module no test can load`,
    );
  }
});

test("a reading that failed is a reading, not a thrown call", () => {
  // `sampleHealth` is called on a timer while the connection panel is open. A
  // version that let `getStats()` reject would take the panel's own interval
  // down with it, and the panel would stop updating at the moment it matters.
  // The slice's end matters and the first version got it wrong: it cut at
  // `async setDeafened`, which comes BEFORE `sampleHealth` in the returned
  // object, so `indexOf` answered -1, `slice(0, -1)` kept almost the whole
  // file, and the assertion found `setOutputDevice`'s `try` instead. Both
  // try/catch mutations came back green. Bounded by the method that really
  // follows it now, and asserted to exist so a reorder fails loudly.
  const start = code.indexOf("async sampleHealth()");
  assert.ok(start > 0, "sampleHealth is gone from the seam");
  const end = code.indexOf("async setOutputDevice(", start);
  assert.ok(end > start, "setOutputDevice no longer follows sampleHealth — check this slice");
  const body = code.slice(start, end);
  assert.match(body, /try \{/, "sampleHealth no longer guards the stats read");
  assert.match(
    body,
    /return blank;/,
    "sampleHealth no longer answers «unknown» for a reading it could not take",
  );
});

test("a browser that refuses an output device is answered, not thrown at", () => {
  const start = code.indexOf("async setOutputDevice(");
  assert.ok(start > 0, "setOutputDevice is gone from the seam");
  const end = code.indexOf("serverName()", start);
  assert.ok(end > start, "serverName no longer follows setOutputDevice — check this slice");
  const body = code.slice(start, end);
  assert.match(body, /catch \{/, "setOutputDevice no longer catches the refusal");
  assert.match(
    body,
    /return false;/,
    "a refused device switch no longer answers false, so a call could end over a headset choice",
  );
});

/* ── A revoked publish permission (D-221) ─────────────────────────────────────
 *
 * The gateway silences somebody by calling the SFU's `UpdateParticipant` with
 * `canPublish: false`. There is no database column for it — `voice_participants`
 * has none — so the SFU is the only place the fact exists, and the seam is the
 * only place in the client that can read it. Everything below is about that
 * reading arriving at all: the bindings that raise it, the permission the
 * answer comes from, and the press the interface must not pretend to honour.
 */

/** One `.on(RoomEvent.X, …)` line, or a failure naming the event that is gone. */
function binding(event) {
  const line = code.split("\n").find((entry) => entry.includes(`RoomEvent.${event}`));
  assert.ok(line, `nothing handles RoomEvent.${event}`);
  return line;
}

test("the events a revoked publish permission raises are all bound", () => {
  // The defect this closes: none of these three was bound, so the SFU took a
  // person's microphone away and the rail went on drawing them unmuted. The
  // two unpublish events are **not** interchangeable — the SDK's own typing
  // makes `trackUnpublished` a `RemoteParticipant` event and
  // `localTrackUnpublished` a `LocalParticipant` one — so binding either alone
  // leaves one side of the room blind.
  assert.match(
    binding("TrackUnpublished"),
    /report/,
    "a remote participant losing a track no longer refreshes the list",
  );
  assert.match(
    binding("LocalTrackUnpublished"),
    /reportAndAnnounce/,
    "this client losing its own track no longer reaches the state above, so the " +
      "person who was silenced is told nothing",
  );
  assert.match(
    binding("ParticipantPermissionsChanged"),
    /reportAndAnnounce/,
    "the permission change itself is no longer handled — and it is the only one " +
      "of the three that fires when there was no track to lose",
  );
  assert.ok(
    code.indexOf("RoomEvent.TrackUnpublished") !== code.indexOf("RoomEvent.LocalTrackUnpublished"),
    "the remote and the local unpublish have collapsed into one binding",
  );
});

test("the permission is read from the room, never inferred from a track", () => {
  // `!isMicrophoneEnabled` is true for a person who pressed their own button
  // and for a person the SFU silenced. Telling those apart is the whole reason
  // `canSpeak` exists beside `muted`, so the reader must not be built from the
  // track state it is there to distinguish itself from.
  const start = code.indexOf("const permissionToSpeak = (");
  assert.ok(start > 0, "the permission reader is gone from the seam");
  const end = code.indexOf("const report = () => {", start);
  assert.ok(end > start, "report no longer follows the permission reader — check this slice");
  const body = code.slice(start, end);
  assert.ok(
    body.includes("who.permissions ? who.permissions.canPublish : null"),
    "the permission reader no longer answers from the participant's own permissions",
  );
  assert.ok(
    !body.includes("isMicrophoneEnabled"),
    "the permission is being inferred from the microphone state, which cannot " +
      "tell a self-mute from a moderator's mute",
  );
});

test("a participant the room has said nothing about is unknown, not silenced", () => {
  // Absent is the state every participant is in for the first moments of a
  // call, and for the whole call if the server sends no permission at all.
  // Collapsing it into `false` would draw everybody as silenced and offer to
  // un-silence people nobody had touched — the control-that-does-nothing this
  // whole change exists to remove.
  assert.ok(
    code.includes("permissionToSpeak(local)") && code.includes("permissionToSpeak(remote)"),
    "report no longer asks about both halves of the room, so one of them carries " +
      "a made-up permission",
  );
  for (const invented of ["canSpeak: true", "canSpeak: false"]) {
    assert.ok(
      !code.includes(invented),
      `report states «${invented}» outright, which is a claim rather than a reading`,
    );
  }
});

test("this client's own permission reaches the interface, and only when it changes", () => {
  assert.ok(
    code.includes("onSpeechAllowed(allowed: boolean | null): void;"),
    "the seam's event interface no longer carries this client's own permission, " +
      "so nothing above it can learn that a moderator silenced them",
  );
  assert.ok(
    code.includes("events.onSpeechAllowed(allowed)"),
    "the seam never announces the permission it reads",
  );
  // Every permission change in the room reaches the same handler, most of them
  // about other people. Without the guard the call state is republished for
  // each one, and `ChatWindow` re-renders its whole subtree for a fact about
  // somebody else — the cost that moved `speakers` out of the state object.
  assert.ok(
    code.includes("if (allowed === announcedSpeech) return;"),
    "the announcement is no longer guarded, so somebody else's permission change " +
      "republishes this call's state",
  );
});

test("a press the room would refuse is answered before the track is looked at", () => {
  // `published` is this function's own `LocalAudioTrack` and the SDK never
  // clears it: a server-side unpublish removes the *publication*. So
  // `if (!published) return;` cannot stand in for the permission check, and a
  // version that asks it first mutes a track nobody is carrying and reports a
  // mute this person did not press.
  const start = code.indexOf("async setMuted(");
  assert.ok(start > 0, "setMuted is gone from the seam");
  const end = code.indexOf("async sampleHealth()", start);
  assert.ok(end > start, "sampleHealth no longer follows setMuted — check this slice");
  const body = code.slice(start, end);
  const permission = body.indexOf("speechAllowed() === false");
  assert.ok(permission >= 0, "setMuted no longer asks whether the room would carry this at all");
  const track = body.indexOf("if (!published) return;");
  assert.ok(track >= 0, "setMuted no longer guards the absent track");
  assert.ok(
    permission < track,
    "the track guard comes first, so a revoked permission falls through to muting " +
      "a publication the SFU has already removed",
  );
  assert.ok(
    !body.includes("throw"),
    "setMuted throws at a press it cannot honour; a refusal is an answer, not an error",
  );
  // The other half: a permission that came back leaves the publication gone,
  // so unmuting the track alone would be a pressed control carrying no audio.
  assert.ok(
    body.includes("getTrackPublication(Track.Source.Microphone)") &&
      body.includes("publishTrack(published"),
    "unmuting after a restored permission no longer puts the track back on the air",
  );
});

test("the microphone is published as a microphone", () => {
  // Not cosmetic and not the SDK's default. A hand-built `LocalAudioTrack`
  // carries `Track.Source.Unknown`, and `publishTrack` overwrites that only
  // from `opts.source`. `Participant.isMicrophoneEnabled` reads
  // `getTrackPublication(Track.Source.Microphone)` and answers false for an
  // Unknown publication — for the local participant and for every remote one —
  // and `RemoteParticipant.setVolume` defaults to the same source and silently
  // finds nothing. Without this line every person in the call reports as muted
  // for its whole length and deafening does nothing at all.
  const start = code.indexOf("async join(url, token, microphone)");
  assert.ok(start > 0, "join is gone from the seam");
  const end = code.indexOf("async setDeafened(", start);
  assert.ok(end > start, "setDeafened no longer follows join — check this slice");
  const body = code.slice(start, end);
  assert.ok(
    body.includes("publishTrack(published, { source: Track.Source.Microphone })"),
    "the capture is published without naming its source, so `isMicrophoneEnabled` " +
      "reads false for everybody and `setVolume` moves nothing",
  );
  assert.match(
    code,
    /const \{ LocalAudioTrack, Room, RoomEvent, Track \} = await import\("livekit-client"\)/,
    "the source enum is no longer imported, so the publication cannot name itself",
  );
});

test("a permission the room never granted is nobody's doing", () => {
  // Two ways to turn this rule into an accusation. `null` means the SFU has not
  // said, and reading it as a refusal would tell somebody a moderator silenced
  // them at the start of every call. A token minted without publish rights is
  // the listen-only grant the capsule already states as «Только слушаете», and
  // reading *that* as a revocation would do the same to every listener.
  const start = callCode.indexOf("onSpeechAllowed: (allowed) => {");
  assert.ok(start > 0, "the call no longer listens for its own permission");
  const end = callCode.indexOf("onReconnecting: () => {", start);
  assert.ok(end > start, "onReconnecting no longer follows onSpeechAllowed — check this slice");
  const body = callCode.slice(start, end);
  assert.ok(
    body.includes("if (allowed === null) return;"),
    "an unstated permission is being read as a refusal, so a call with no answer " +
      "from the SFU accuses a moderator",
  );
  assert.ok(
    body.includes("const revoked = !allowed && outcome.grant.canPublish;"),
    "a listen-only token is being read as a revocation, so somebody who was never " +
      "granted the microphone is told a moderator took it",
  );
  assert.ok(
    callCode.includes("speechRevoked: false,"),
    "the revocation is no longer cleared with the call, so one call's force-mute " +
      "appears in the next",
  );
});

test("the person who was silenced is told, and the control is sunk rather than faded", () => {
  assert.ok(
    capsuleCode.includes("Модератор выключил ваш микрофон."),
    "the capsule no longer says who silenced this person, so a taken microphone " +
      "reads as a broken one",
  );
  assert.ok(
    capsuleCode.includes("disabled={speechRevoked}"),
    "the microphone control is still offered while the room refuses to carry it",
  );
  assert.ok(
    capsuleCode.includes("CAPSULE_CONTROL_UNAVAILABLE_GLASS") &&
      capsuleCode.includes("linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))"),
    "the unavailable control no longer steps the material, so on a translucent " +
      "capsule it is not visibly unavailable at all (rule 5)",
  );
  assert.ok(
    !capsuleCode.includes("--kub-warn-text"),
    "the capsule names a token this project does not define, so the sentence has no colour",
  );
  assert.ok(
    !capsuleCode.includes("opacity"),
    "the unavailable state is being drawn with opacity, which rule 5 measured at " +
      "2.23:1 on a translucent surface against a floor of 4.5",
  );
});

test("the SDK does not stop this client's capture when the room unpublishes it", () => {
  // The room option, not `userProvidedTrack`. `LocalParticipant.unpublishTrack`
  // reads `stopOnUnpublish ?? roomOptions.stopLocalTrackOnUnpublish ?? true`
  // and then calls `track.stop()` with no regard for who provided the track —
  // so on the one path nobody here asks for, a force-mute, the default ends the
  // `MediaStreamTrack` the hook is holding. The microphone light goes out
  // mid-call and there is nothing left to put back when the permission returns.
  assert.ok(
    code.includes("new Room({ stopLocalTrackOnUnpublish: false })"),
    "the room takes the SDK's default again, so a force-mute stops the capture " +
      "the hook owns and a restored permission has no track to republish",
  );
});
