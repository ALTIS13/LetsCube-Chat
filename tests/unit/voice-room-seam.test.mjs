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

const source = readFileSync("artifacts/kub/src/hooks/voiceRoom.ts", "utf8");
/** Comments stripped. Three guards fired on prose rather than code today. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

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
    /const applyDeafened = \(\) => \{/,
    "the deafen state is no longer re-applied, so it is set once and forgotten",
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
    /remote\.setVolume\(deafened \? 0 : 1\)/,
    "the applier no longer reads the held value",
  );
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
