import assert from "node:assert/strict";
import test from "node:test";
import {
  VOICE_RESUME_HEARTBEAT_MS,
  VOICE_RESUME_KEY,
  VOICE_RESUME_WINDOW_MS,
  decideVoiceResume,
  parseVoiceResumeRecord,
  serializeVoiceResumeRecord,
  type VoiceResumeRecord,
} from "../../artifacts/kub/src/lib/voiceResume.ts";

/**
 * Coming back to the voice channel you were in (queue item 35, 2B).
 *
 * **The split is derived from the owner's sentence, not traded against it.** He
 * named a connection drop and an update applied to him — both interruptions the
 * product caused — and said nothing about pressing F5 himself. So the product
 * returns by itself for what it caused, and offers for what it did not. A rule
 * that merely happens to match a request has to be re-argued; one derived from
 * it answers by quoting.
 *
 * **Every uncertainty resolves towards not switching on a microphone.** That is
 * the opposite direction from `shouldShowUpdateNotice`, where silence is the
 * failure, and it is why a record stamped in the future is unusable here rather
 * than very recent.
 *
 * **The window is ours.** LiveKit retains no participant at all
 * (`docs/operations/voice.md`), so nothing could make five minutes a lie — and
 * nothing hands us a number either. It has to equal the reconciler's reaper,
 * which decides how long everybody else still sees the person in the channel.
 */

const MINUTE = 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const CHANNEL = "33333333-3333-4333-8333-000000000001";
const CHAT = "22222222-2222-4222-8222-000000000001";
const USER = "11111111-1111-4111-8111-000000000001";
const OTHER_USER = "11111111-1111-4111-8111-000000000002";

function record(overrides: Partial<VoiceResumeRecord> = {}): VoiceResumeRecord {
  return {
    userId: USER,
    channelId: CHANNEL,
    chatId: CHAT,
    channelName: "Общий",
    micMuted: false,
    at: NOW - MINUTE,
    cause: "interrupted",
    ...overrides,
  };
}

test("the window is five minutes, and the heartbeat bounds how stale it can be", () => {
  assert.equal(VOICE_RESUME_WINDOW_MS, 5 * MINUTE);
  assert.equal(VOICE_RESUME_HEARTBEAT_MS, MINUTE);
  assert.equal(VOICE_RESUME_KEY, "letscube:voice:resume");
  // The reconciler's `DEFAULT_STALE_MS` is the same span and has to stay so:
  // longer here returns somebody to a channel whose row was already reaped,
  // shorter leaves the row standing after they have given up. The constants are
  // in two deployables and cannot be one, so each names the other and this
  // states the number both must carry.
  assert.equal(VOICE_RESUME_WINDOW_MS, 5 * 60 * 1000);
  // A heartbeat that did not divide the window would make the effective window
  // a different number from the one in the copy.
  assert.ok(VOICE_RESUME_WINDOW_MS % VOICE_RESUME_HEARTBEAT_MS === 0);
  assert.ok(VOICE_RESUME_HEARTBEAT_MS < VOICE_RESUME_WINDOW_MS);
});

test("nothing to come back to is not a decision", () => {
  assert.deepEqual(decideVoiceResume({ record: null, now: NOW, userId: USER }), { kind: "none" });
});

test("what the product took away, the product puts back", () => {
  const taken = record({ cause: "interrupted" });
  assert.deepEqual(decideVoiceResume({ record: taken, now: NOW, userId: USER }), { kind: "return", record: taken });
});

test("what the product did not take away is offered, never taken", () => {
  // A manual reload, or a crashed tab. He never asked for this case, and acting
  // on it would switch on a microphone nobody asked to have switched on.
  const own = record({ cause: "unplanned" });
  assert.deepEqual(decideVoiceResume({ record: own, now: NOW, userId: USER }), { kind: "offer", record: own });
});

test("a saved call belongs only to the authenticated account that created it", () => {
  const saved = record();
  assert.deepEqual(decideVoiceResume({ record: saved, now: NOW, userId: OTHER_USER }), { kind: "none" });
  assert.deepEqual(decideVoiceResume({ record: saved, now: NOW, userId: null }), { kind: "none" });
});

test("the window closes at five minutes, from both sides", () => {
  const cases: Array<[number, "return" | "none"]> = [
    [0, "return"],
    [MINUTE, "return"],
    [5 * MINUTE - 1, "return"],
    [5 * MINUTE, "none"],
    [5 * MINUTE + 1, "none"],
    [60 * MINUTE, "none"],
  ];
  for (const [elapsed, expected] of cases) {
    assert.equal(
      decideVoiceResume({ record: record({ at: NOW - elapsed }), now: NOW, userId: USER }).kind,
      expected,
      `${elapsed}ms after the call was last up`,
    );
  }
});

test("the window closes on an offer exactly as it closes on a return", () => {
  assert.equal(
    decideVoiceResume({ record: record({ cause: "unplanned", at: NOW - 5 * MINUTE }), now: NOW, userId: USER }).kind,
    "none",
  );
  assert.equal(
    decideVoiceResume({ record: record({ cause: "unplanned", at: NOW - 5 * MINUTE + 1 }), now: NOW, userId: USER }).kind,
    "offer",
  );
});

test("a clock that has gone backwards returns nobody", () => {
  // The opposite direction from the update notice, and deliberately: there a
  // stored time in the future must not silence the product, here it must not
  // be read as «the call was up a moment ago» and open a microphone.
  assert.deepEqual(
    decideVoiceResume({ record: record({ at: NOW + MINUTE }), now: NOW, userId: USER }),
    { kind: "none" },
  );
  assert.deepEqual(
    decideVoiceResume({ record: record({ cause: "unplanned", at: NOW + 60 * MINUTE }), now: NOW, userId: USER }),
    { kind: "none" },
  );
});

test("the microphone travels with the record, both ways", () => {
  const muted = decideVoiceResume({ record: record({ micMuted: true }), now: NOW, userId: USER });
  assert.equal(muted.kind, "return");
  assert.equal(muted.kind === "return" && muted.record.micMuted, true);
  const live = decideVoiceResume({ record: record({ micMuted: false }), now: NOW, userId: USER });
  assert.equal(live.kind === "return" && live.record.micMuted, false);
});

test("a record survives the round trip it is written for", () => {
  const original = record({ micMuted: true, cause: "unplanned" });
  assert.deepEqual(parseVoiceResumeRecord(serializeVoiceResumeRecord(original)), original);
});

test("only a complete record counts as one", () => {
  const complete = record();
  assert.equal(parseVoiceResumeRecord(null), null);
  assert.equal(parseVoiceResumeRecord(""), null);
  assert.equal(parseVoiceResumeRecord("not json"), null);
  assert.equal(parseVoiceResumeRecord("null"), null);
  assert.equal(parseVoiceResumeRecord('"a string"'), null);
  assert.equal(parseVoiceResumeRecord("[]"), null);
  // Each field missing in turn. A record half-read is a call half-rejoined, and
  // the fields are exactly what `joinVoiceChannel` is handed.
  for (const field of ["userId", "channelId", "chatId", "channelName", "micMuted", "at", "cause"] as const) {
    const { [field]: _dropped, ...rest } = complete;
    assert.equal(parseVoiceResumeRecord(JSON.stringify(rest)), null, `missing ${field}`);
  }
  // And each field present but of the wrong shape.
  const wrong: Array<[string, unknown]> = [
    ["userId", null],
    ["userId", ""],
    ["channelId", 1],
    ["channelId", ""],
    ["chatId", null],
    ["chatId", ""],
    ["channelName", 7],
    ["micMuted", "true"],
    ["at", "1758369600000"],
    ["at", 0],
    ["at", -1],
    ["at", 1.5],
    ["cause", "whatever"],
    ["cause", ""],
  ];
  for (const [field, value] of wrong) {
    assert.equal(
      parseVoiceResumeRecord(JSON.stringify({ ...complete, [field]: value })),
      null,
      `${field} = ${JSON.stringify(value)}`,
    );
  }
});

test("an unknown extra field does not spoil a usable record", () => {
  // A record written by a newer build and read by an older one. Refusing it
  // would strand somebody on the older tab for no reason.
  const parsed = parseVoiceResumeRecord(JSON.stringify({ ...record(), somethingNew: 1 }));
  assert.deepEqual(parsed, record());
});
