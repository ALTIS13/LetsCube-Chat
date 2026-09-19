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

  // Read as the handler rather than as the line it used to fit on:
  // `TrackSubscribed` grew a body on 2026-09-19 when it started attaching the
  // element that makes a room audible at all. What is asserted is unchanged —
  // that this event reaches the **applier** and not merely the reporter.
  for (const event of ["ParticipantConnected", "TrackSubscribed"]) {
    const at = code.indexOf(`RoomEvent.${event}`);
    assert.ok(at > 0, `nothing handles RoomEvent.${event}`);
    const next = code.indexOf(".on(RoomEvent.", at);
    const handler = code.slice(at, next > at ? next : at + 400);
    assert.match(
      handler,
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

/* ── The gate: voice activity and push to talk ────────────────────────────────
 *
 * The rules are `lib/micGate.ts` and `tests/unit/mic-gate.test.mts` holds every
 * one of them without a browser. What cannot be reached from there is the
 * moment the answer meets the track — the SDK owns the same `enabled` flag the
 * gate writes, and it writes it back on every unmute — so the three guards
 * below read the source, on the same terms as everything above.
 */

test("the gate is a seam method, named for the meaning rather than for LiveKit", () => {
  assert.ok(
    code.includes("setMicrophoneOpen(open: boolean): Promise<void>;"),
    "the transport seam no longer offers the gate, so nothing above it can hold a " +
      "microphone open without naming LiveKit itself",
  );
  // And the decisions stay out of here, exactly as they do for the volume: the
  // seam applies an answer, it does not work one out.
  for (const decision of ["nextMicGate", "micGateOpenAt", "MIC_GATE_HOLD_MS", "threshold"]) {
    assert.ok(
      !code.includes(decision),
      `the seam decides «${decision}», which is a rule in a module no test can load`,
    );
  }
});

test("the gate disables the capture rather than muting the publication", () => {
  // The difference is what everybody else sees. A mute is propagated by the
  // SFU and draws a crossed microphone beside this person's name, so a gate
  // built on it would blink that glyph through every sentence — and it would
  // fight `setMuted` over the same state. Disabling sends silence and leaves
  // the publication, the permission and the participant list alone.
  const start = code.indexOf("const applyMicrophoneOpen = () => {");
  assert.ok(start > 0, "the gate's applier is gone from the seam");
  const end = code.indexOf("const audioSourceOf = (", start);
  assert.ok(end > start, "audioSourceOf no longer follows the gate's applier — check this slice");
  const body = code.slice(start, end);
  assert.match(
    body,
    /published\.mediaStreamTrack\.enabled = microphoneOpen && !published\.isMuted;/,
    "the gate no longer writes the track's own enabled flag, or it has stopped " +
      "deferring to a self-mute — a syllable would then re-enable a track the SDK " +
      "still believes is muted, audible to the room with the interface saying «выключен»",
  );
  assert.ok(
    !body.includes(".mute()") && !body.includes(".unmute()"),
    "the gate reaches for the SDK's mute, which tells the whole room what this " +
      "client is doing between two words",
  );
});

test("an unmute puts the gate back, because the SDK undoes it", () => {
  // `LocalTrack.setTrackMuted` writes `enabled = !muted` with no regard for who
  // else owns that flag (livekit-client 2.22.3), so every unmute re-enables the
  // track. Without the re-application, a person in «Рация» who turned their
  // microphone back on would be transmitting with nothing held.
  const start = code.indexOf("async setMuted(");
  assert.ok(start > 0, "setMuted is gone from the seam");
  const end = code.indexOf("async sampleHealth()", start);
  assert.ok(end > start, "sampleHealth no longer follows setMuted — check this slice");
  const body = code.slice(start, end);
  const unmute = body.indexOf("await published.unmute();");
  assert.ok(unmute >= 0, "setMuted no longer unmutes the track");
  const reapply = body.indexOf("applyMicrophoneOpen();", unmute);
  assert.ok(
    reapply > unmute,
    "the gate is not re-applied after the unmute, so turning a microphone back on " +
      "opens it whatever the mode says",
  );

  // And the join applies it at all, before anything is reported: a call joined
  // in «Рация» must not be audible for the length of one event loop.
  const join = code.indexOf("async join(url, token, microphone)");
  const published = code.indexOf("publishTrack(published, { source: Track.Source.Microphone })", join);
  const applied = code.indexOf("applyMicrophoneOpen();", published);
  const announced = code.indexOf("reportAndAnnounce();", published);
  assert.ok(applied > published, "the join publishes the capture without applying the gate to it");
  assert.ok(applied < announced, "the gate is applied after the call has already been reported as up");
});

/* ── And the wiring above the seam, for the same reason the two guards at the
 * top of this file read `useVoiceCall.ts`: `tests/e2e/voice-call.spec.ts`
 * replaces the transport, so what the store does with a held key is provable
 * there — but the releases that are *not* a keyup have no browser event a spec
 * can raise (a window really losing focus to Alt+Tab is not one of them), and
 * they are the difference between a feature and a microphone left open.
 */

test("a held talk key is released by every event that can swallow the keyup", () => {
  const start = callCode.indexOf("function watchTalkKey()");
  assert.ok(start > 0, "the talk key is no longer watched");
  const end = callCode.indexOf("function readGateSettings()", start);
  assert.ok(end > start, "readGateSettings no longer follows watchTalkKey — check this slice");
  const body = callCode.slice(start, end);
  // The **binding**, not the name. Asking for the string alone was a guard that
  // passed on a mutation that deleted the `addEventListener` and left the
  // matching `removeEventListener` behind — measured on 2026-09-18, and it is
  // the shape every «green mutation» in this repository has had: the assertion
  // was about the presence of a word rather than about the thing the word is
  // part of.
  for (const [target, event] of [
    ["window", "blur"],
    ["window", "pointerup"],
    ["window", "pointercancel"],
    ["document", "visibilitychange"],
  ]) {
    assert.ok(
      body.includes(`${target}.addEventListener("${event}"`),
      `${event} no longer releases a held key — this is the class of event that ` +
        "leaves a microphone open after somebody alt-tabs",
    );
    assert.ok(
      body.includes(`${target}.removeEventListener("${event}"`),
      `${event} is bound for the length of the application rather than the call`,
    );
  }
  // The keyup asks for the code and nothing else. Guarding it the way the
  // keydown is guarded is how a release goes missing: hold the key, press Ctrl
  // or tab into the composer, let go.
  const up = body.indexOf("const onKeyUp = ");
  const release = body.indexOf("const release = ", up);
  assert.ok(up > 0 && release > up, "the keyup handler is gone");
  const upBody = body.slice(up, release);
  assert.ok(upBody.includes("micTalkKeyReleases(event.code, settings.talkKey)"), "the release no longer asks the rule");
  for (const guard of ["editable", "ctrlKey", "repeat"]) {
    assert.ok(
      !upBody.includes(guard),
      `the keyup is guarded by ${guard}, which is a release the microphone will not get`,
    );
  }
});

test("the meter stops with the call, and only runs for the mode that needs it", () => {
  assert.ok(
    callCode.includes("micGateNeedsLevel(settings.activation)"),
    "a call now runs an AudioContext whatever the mode is, which is a battery cost " +
      "with nothing reading it",
  );
  const start = callCode.indexOf("function forgetMicrophoneGate()");
  assert.ok(start > 0, "nothing tears the gate down");
  const end = callCode.indexOf("export function holdVoiceTalk(", start);
  assert.ok(end > start, "holdVoiceTalk no longer follows forgetMicrophoneGate — check this slice");
  const body = callCode.slice(start, end);
  assert.ok(body.includes("levelSource?.close()"), "the level source outlives the call it belongs to");
  assert.ok(body.includes("publishTalkHeld(false)"), "a call can end with the talk key still held");
  // Every path that ends a call has to reach it, and there are four.
  for (const path of ["function fail(", "export async function leaveVoiceCall(", "onClosed: () => {"]) {
    const at = callCode.indexOf(path);
    assert.ok(at > 0, `${path} is gone`);
    const slice = callCode.slice(at, at + 600);
    assert.ok(
      slice.includes("forgetMicrophoneGate()"),
      `${path} ends a call without stopping the meter or releasing the key`,
    );
  }
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


/* ── The room is heard, which it was not until 2026-09-19 ─────────────────── */

/**
 * The rules about the elements are `lib/voiceAudioSink.ts` and are driven with
 * fakes in `tests/unit/voice-audio-sink.test.mjs`. What cannot be driven from
 * `node --test` is the wiring: whether this file ever calls the sink, and on
 * which of the SDK's events. So these are source reads, with the weakness that
 * implies — they prove a call site exists, not that LiveKit does what it asks.
 *
 * Read the whole file's header for why the weaker instrument is used at all:
 * `tests/e2e/voice-call.spec.ts` replaces this function with a stand-in, so an
 * e2e green proves nothing below the seam. Six days of voice channels nobody
 * could hear is what that costs when nothing reads the source either.
 */

test("a subscribed audio track is handed to the sink, and before the volumes", () => {
  // The ordering is not cosmetic. `reportAndApply` ends in `applyVolumes`, and
  // a volume applied before an element exists is a no-op — which is what every
  // volume and every deafen in this product was until today.
  const at = code.indexOf("RoomEvent.TrackSubscribed");
  assert.ok(at > 0, "TrackSubscribed is no longer handled");
  const handler = code.slice(at, at + 400);
  const hears = handler.indexOf("sink.hear(");
  const reports = handler.indexOf("reportAndApply()");
  assert.ok(hears > 0, "a subscribed track is never attached, so nobody hears anybody");
  assert.ok(reports > 0, "TrackSubscribed no longer re-applies the volumes");
  assert.ok(hears < reports, "the volumes are applied before the element exists, which does nothing");
});

test("an unsubscribed track gives its element back, or the reconnect cycle leaks", () => {
  // `TrackUnsubscribed` was bound to nothing at all before there was anything
  // to release. It is the path a full reconnect takes — `Room.handleRestarting`
  // disconnects every remote participant — and production is taking it roughly
  // every fifteen seconds.
  const at = code.indexOf("RoomEvent.TrackUnsubscribed");
  assert.ok(at > 0, "TrackUnsubscribed is not bound, so every reconnect strands an element");
  assert.match(
    code.slice(at, at + 200),
    /sink\.forget\(/,
    "TrackUnsubscribed is bound but releases nothing",
  );
});

test("both ways a call can end release every element", () => {
  for (const [path, why] of [
    ["async leave() {", "a leave that keeps its elements leaks one per track, every call"],
    ["RoomEvent.Disconnected", "a call that ended without being asked to keeps its elements"],
  ]) {
    const at = code.indexOf(path);
    assert.ok(at > 0, `${path} is gone`);
    assert.match(code.slice(at, at + 400), /sink\.forgetAll\(\)/, why);
  }
});

test("the disconnect releases before the early return, not after it", () => {
  // `if (left) return` sits in that handler for a call this client asked to
  // end. Releasing after it would mean the ordinary leave path — the common
  // one — kept its elements.
  const at = code.indexOf("RoomEvent.Disconnected");
  const body = code.slice(at, at + 400);
  const releases = body.indexOf("sink.forgetAll()");
  const returns = body.indexOf("if (left) return");
  assert.ok(releases > 0 && returns > 0);
  assert.ok(releases < returns, "the release is behind the early return and never runs on a leave");
});

test("the join asks the browser to sound the call, on the gesture it already has", () => {
  // A browser sounds nothing until the document has been touched, and the join
  // press is such a touch — so this is where it costs nothing and works. The
  // pattern is `useCallSoundPriming`'s, not a second one.
  const at = code.indexOf("async join(url, token, microphone)");
  assert.ok(at > 0, "join is gone");
  const body = code.slice(at, at + 500);
  assert.match(body, /primeAudio\(\)/, "nothing ever asks the browser to start playback");
  const connects = body.indexOf("room.connect(");
  const primes = body.indexOf("primeAudio()");
  assert.ok(connects < primes, "playback is asked for before there is a connection to play");
});

test("a browser that refuses playback is reported, never swallowed", () => {
  // The whole defect was silence that said nothing. Replacing it with a
  // quieter silence — a caught error and no announcement — would be the same
  // failure one layer up.
  assert.match(
    code,
    /RoomEvent\.AudioPlaybackStatusChanged/,
    "nothing watches whether the browser is letting the call be heard",
  );
  const at = code.indexOf("RoomEvent.AudioPlaybackStatusChanged");
  assert.match(
    code.slice(at, at + 220),
    /events\.onAudioBlocked\(!room\.canPlaybackAudio\)/,
    "the playback status is observed and then not told to anybody",
  );
  // And the answer is read off the room rather than inferred from the throw:
  // `startAudio` rejects, and `canPlaybackAudio` is the fact.
  const prime = code.indexOf("const primeAudio");
  assert.ok(prime > 0, "primeAudio is gone");
  assert.match(
    code.slice(prime, prime + 400),
    /events\.onAudioBlocked\(!room\.canPlaybackAudio\)/,
    "priming reports nothing, so a refusal at join time is invisible",
  );
});

test("the press that asks again actually asks again", () => {
  const at = code.indexOf("async resumeAudio()");
  assert.ok(at > 0, "resumeAudio is gone from the seam");
  assert.match(
    code.slice(at, at + 160),
    /primeAudio\(\)/,
    "the control offered to somebody who hears nothing does nothing",
  );
});


/* ── The sampler reads both directions, which it did not until 2026-09-19 ── */

/**
 * The arithmetic is `lib/voiceConnectionHealth.ts` and is driven with real
 * numbers in `tests/unit/voice-connection-health.test.mts`. What only source
 * can see is which stats the sampler actually collects — and the defect was
 * exactly there: it chose **one** source, `published ?? any remote track`, so
 * for anybody who was speaking it measured the outgoing half and nothing else.
 */

function sampleHealthBody() {
  const at = code.indexOf("async sampleHealth()");
  assert.ok(at > 0, "sampleHealth is gone");
  const end = code.indexOf("async setOutputDevice", at);
  assert.ok(end > at, "could not find the end of sampleHealth");
  return code.slice(at, end);
}

test("the sampler reads the outgoing half and the incoming half, not one of them", () => {
  const body = sampleHealthBody();

  // The old shape, which must not come back: one source chosen with `??`.
  assert.ok(
    !body.includes("const source ="),
    "the sampler is choosing one source again, so a publisher measures nothing that arrives",
  );

  const needles = [
    ["outbound-rtp", "nothing reads what this client sends"],
    ["remote-inbound-rtp", "nothing reads the server's report on our own stream"],
    ["inbound-rtp", "nothing reads what arrives"],
    ["totalSamplesReceived", "nothing can tell «arriving» from «being heard»"],
    ["totalAudioEnergy", "nothing reads whether any voice is carrying sound"],
  ];
  for (const [needle, why] of needles) {
    assert.ok(body.includes(needle), why);
  }
});

test("the incoming half is summed over every subscribed voice, not read off one", () => {
  // «Is anything reaching me at all» is a question about the room. Reading one
  // participant would answer it with whether that person happens to be talking.
  assert.match(
    sampleHealthBody(),
    /for \(const track of subscribed\)/,
    "the sampler reads a single remote track again",
  );
});

test("how many people are publishing is counted from publications, not from tracks", () => {
  // A participant this client never subscribed to has a publication and no
  // track. Counting tracks would report «nobody is publishing» for a room that
  // is talking — which reads as `idle`, the one inbound answer that is not a
  // fault, so the fault would be hidden by the field meant to reveal it.
  const body = sampleHealthBody();
  // Counted, not merely found. `sampleHealth` writes this field twice — once
  // into the blank reading and once into the real one — and an `includes`
  // matched the survivor when a mutation changed only the second, so the guard
  // was green for a sampler that reported the wrong number. Both, and the
  // wrong spelling nowhere.
  const stated = body.split("remoteAudioTracks: publications.length").length - 1;
  assert.equal(
    stated,
    2,
    "the publishing count is not stated as a publication count in both readings",
  );
  assert.ok(
    !body.includes("remoteAudioTracks: subscribed.length"),
    "the publishing count is taken from subscribed tracks, which hides a missing subscription",
  );
  assert.ok(
    body.includes("publications.length > 0 && subscribed.length === 0"),
    "a room publishing while this client subscribed to nobody is not reported as zero packets",
  );
});

/* ── The four sounds a channel makes, read where nothing else can see them ────
 *
 * `lib/voiceRoomSound.ts` decides when a sound may fire and
 * `lib/voiceRoomSoundDriver.ts` is the caller that remembers, notices and comes
 * back on a clock; both are pure and both are driven behaviourally in
 * `tests/unit/voice-room-sound.test.mjs` and
 * `tests/unit/voice-room-sound-driver.test.mjs`. What neither of those files
 * can reach is the feeding: whether `hooks/useVoiceCall.ts` takes a reading at
 * every publish, whether the reading carries the setting that already exists
 * rather than a second one, and whether `hooks/voiceRoom.ts` raises the phase
 * in the order the re-baseline depends on. Those are read here, as source, with
 * the weakness this whole file states at its head.
 */

test("the phase the rule is given is raised before the roster that follows it", () => {
  // The re-baseline is armed by the phase and consumed by the first roster
  // after it. Reversing these two lines would let the fresh roster arrive while
  // the phase still said `reconnecting` — the rule drops it and arms again —
  // and the next roster, which may carry a real arrival, would be swallowed
  // instead. Read by position rather than by eye: a grep sees both lines
  // whichever way round they are.
  const at = code.indexOf("RoomEvent.Reconnected");
  assert.ok(at > 0, "nothing handles RoomEvent.Reconnected");
  const body = code.slice(at, at + 400);
  const raises = body.indexOf("events.onReconnected()");
  const reports = body.indexOf("reportAndAnnounce()");
  assert.ok(raises > 0, "the reconnect no longer tells the call it is connected again");
  assert.ok(reports > 0, "the reconnect no longer re-reports who is in the room");
  assert.ok(
    raises < reports,
    "the roster is re-reported before the phase moves, so the re-baseline swallows the wrong reading",
  );
});

test("a transport being re-established is announced as such, not as a call that ended", () => {
  // The mutation this exists for is a simplification that treats a dropped
  // transport as a disconnect. `voiceRoomPhaseOf` maps `reconnecting` to a
  // phase of its own precisely so the storm is silent; a seam that never raised
  // it would leave that mapping correct and unreachable.
  const at = code.indexOf("RoomEvent.Reconnecting");
  assert.ok(at > 0, "nothing handles RoomEvent.Reconnecting");
  assert.match(
    code.slice(at, at + 200),
    /events\.onReconnecting\(\)/,
    "a transport being re-established no longer reaches the call at all",
  );
});

test("the call takes a sound reading wherever its state is published", () => {
  // One call site, in the one function every path goes through: `patch` calls
  // `publish`, and every way a call ends publishes. A version that hung the
  // reading on the join and on the leave would miss the six other endings.
  const at = callCode.indexOf("function publish(next: VoiceCallState)");
  assert.ok(at > 0, "the publish function is gone");
  assert.match(
    callCode.slice(at, at + 400),
    /observeCallSound\(\)/,
    "the call no longer takes a sound reading when its state moves",
  );
  // And nowhere else, because a second caller would double every sound.
  assert.equal(
    callCode.split("observeCallSound()").length - 1,
    2,
    "the sound reading is taken from somewhere other than the one publish",
  );
});

test("the reading carries the setting that already exists, and no second one", () => {
  const at = callCode.indexOf("function observeCallSound()");
  assert.ok(at > 0, "the sound reading is gone");
  const body = callCode.slice(at, at + 600);
  assert.match(
    body,
    /enabled: getAudioSettings\(\)\.callSoundEnabled/,
    "the channel sounds no longer obey «Звуки → Звонок»",
  );
  for (const invented of ["roomSoundEnabled", "channelSoundEnabled", "voiceSoundEnabled"]) {
    assert.ok(
      !callCode.includes(invented),
      `a second sound switch (${invented}) was invented beside AudioSettings.callSoundEnabled`,
    );
  }
});

test("who the roster calls us is read from the session, not guessed from the list", () => {
  // A wrong answer here is **silent**: the rule reads every roster that does
  // not list us as a room this client is not in, so nothing would ever sound
  // and nothing would ever fail. `participants[0]` happens to be the local
  // participant today because `report()` pushes it first — a property of that
  // function rather than of the seam's contract.
  assert.match(
    callCode,
    /const userId = data\.session\?\.user\?\.id \?\? null;/,
    "the identity is no longer taken from the session the token is minted against",
  );
  assert.match(callCode, /selfUserId = identity;/, "the join no longer records who we are");
  for (const guess of ["participants[0]", "participants.at(0)", "currentUser?.id"]) {
    assert.ok(
      !callCode.includes(guess),
      `the identity is guessed from ${guess}, which is silent when it is wrong`,
    );
  }
});

test("a channel sound is a one-shot, and the priming stays the one that exists", () => {
  // `playCallSoundOnce` refuses a looping name outright, which is why it is the
  // door: a `ring` started through `setVoiceRingSound` from here would sound
  // until the ring's own state machine stopped it, and the ring's state machine
  // knows nothing about a channel.
  assert.match(
    callCode,
    /playCallSoundOnce\(sound\)/,
    "the channel sounds no longer go through the player's one-shot door",
  );
  assert.ok(
    !callCode.includes("setVoiceRingSound"),
    "the call module reaches the looping ring, which nothing here may start or stop",
  );
  // A browser sounds nothing until the page has been touched and the join press
  // is such a touch — but the listener that spends it is `useCallSoundPriming`,
  // installed once by `VoiceCallRing` for the whole session. A second one here
  // would be a second thing to keep in step for no behaviour at all.
  assert.ok(
    !callCode.includes("primeCallSoundsOnGesture"),
    "a second gesture-priming mechanism was installed beside useCallSoundPriming",
  );
});

test("the roster is rebuilt on every event, which is what tells one reading from the next", () => {
  // `lib/voiceRoomSoundDriver.ts` tells a roster the transport delivered from a
  // publish about a mute or a refused output device by comparing the array's
  // **identity**. That is only sound because this function builds a new list
  // every time and never patches one — the same property the header of this
  // file claims for a different reason. A version that cached and mutated a
  // list would leave every other test green and would freeze the sound rule on
  // the first room it ever saw.
  const at = code.indexOf("const report = () => {");
  assert.ok(at > 0, "the reporter is gone");
  const body = code.slice(at, code.indexOf("events.onParticipants(list);", at) + 40);
  assert.match(
    body,
    /const list: VoiceParticipant\[\] = \[\];/,
    "the participant list is no longer built fresh for each report",
  );
  assert.match(body, /events\.onParticipants\(list\);/, "the fresh list is not what is sent");
});
