import assert from "node:assert/strict";
import test from "node:test";

import { voiceGatewayRefusalText } from "../../artifacts/kub/src/lib/voiceGateway.ts";
import {
  VOICE_RING_TTL_SECONDS,
  classifyVoiceRingError,
  pickVoiceRing,
  readVoiceRingRows,
  voiceCallOffer,
  voiceRingEndedTheCall,
  voiceRingIsWaiting,
  voiceRingJoinRefusalText,
  voiceRingRefusalText,
  voiceRingState,
  voiceRingView,
  type VoiceRingRow,
} from "../../artifacts/kub/src/lib/voiceRing.ts";

/**
 * The ring, and the fact that the client and the database have to agree on it.
 *
 * Slice A of `docs/proposals/2026-09-18-one-to-one-calls.md`. The database half
 * is applied and verified on production; the assertions below exist to keep the
 * client's copy of `voice_ring_state` from drifting away from it, because the
 * two disagreeing by one second is not a rounding error — it is the interface
 * offering «Ответить» on a ring `voice_call_answer` has already started
 * refusing with `not_ringing`.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";
const PETR = "11111111-1111-4111-8111-000000000003";
const CHAT = "22222222-2222-4222-8222-000000000001";
const OTHER_CHAT = "22222222-2222-4222-8222-000000000002";
const ROOM = "33333333-3333-4333-8333-000000000001";
const OTHER_ROOM = "33333333-3333-4333-8333-000000000002";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");

function ring(over: Partial<VoiceRingRow> = {}): VoiceRingRow {
  return {
    channelId: ROOM,
    chatId: CHAT,
    name: "Звонок",
    caller: ANNA,
    startedAt: NOW - 3_000,
    answeredAt: null,
    participantCount: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

test("the four states are the four the database answers", () => {
  assert.equal(voiceRingState({ startedAt: null, answeredAt: null, now: NOW }), "idle");
  assert.equal(voiceRingState({ startedAt: NOW, answeredAt: null, now: NOW }), "ringing");
  assert.equal(voiceRingState({ startedAt: NOW, answeredAt: NOW, now: NOW }), "answered");
  assert.equal(
    voiceRingState({ startedAt: NOW - 46_000, answeredAt: null, now: NOW }),
    "expired",
  );
});

test("the boundary is the database's, and it is 45 seconds inclusive", () => {
  // The migration's own self-check stands on both sides of this edge, and the
  // behaviour was read off production: 44s is still `ringing`, 45s is
  // `expired`. The SQL reads `p_now >= p_started_at + make_interval(...)`, so
  // `>` here instead of `>=` is a whole second in which this client would offer
  // «Ответить» on a ring `voice_call_answer` refuses.
  assert.equal(VOICE_RING_TTL_SECONDS, 45);
  assert.equal(
    voiceRingState({ startedAt: NOW - 44_000, answeredAt: null, now: NOW }),
    "ringing",
  );
  assert.equal(
    voiceRingState({ startedAt: NOW - 44_999, answeredAt: null, now: NOW }),
    "ringing",
  );
  assert.equal(
    voiceRingState({ startedAt: NOW - 45_000, answeredAt: null, now: NOW }),
    "expired",
    "45 seconds exactly must be expired: the database's comparison is >=, not >",
  );
});

test("an answered call is a call, whatever the clock says", () => {
  // The branch order is the function's, not a tidier one. A conversation that
  // began at the 44th second is still running an hour later, and the TTL bounds
  // the ring rather than the call after it. Swapping the two branches would
  // hang up every one-to-one call in the product 45 seconds in.
  assert.equal(
    voiceRingState({ startedAt: NOW - 3_600_000, answeredAt: NOW - 3_599_000, now: NOW }),
    "answered",
  );
});

test("the TTL is an argument and a negative one means «now», not «in the past»", () => {
  assert.equal(
    voiceRingState({ startedAt: NOW - 10_000, answeredAt: null, now: NOW, ttlSeconds: 30 }),
    "ringing",
  );
  assert.equal(
    voiceRingState({ startedAt: NOW - 10_000, answeredAt: null, now: NOW, ttlSeconds: 5 }),
    "expired",
  );
  // `greatest(p_ttl_seconds, 0)` in the SQL, mirrored. Without the clamp a
  // negative TTL would make a ring whose start is in the future — which two
  // devices with skewed clocks really do produce — read as still ringing.
  assert.equal(
    voiceRingState({ startedAt: NOW + 1_000, answeredAt: null, now: NOW, ttlSeconds: -10 }),
    "ringing",
  );
  assert.equal(
    voiceRingState({ startedAt: NOW, answeredAt: null, now: NOW, ttlSeconds: -10 }),
    "expired",
  );
});

// ---------------------------------------------------------------------------
// Reading the rows
// ---------------------------------------------------------------------------

test("a row is a ring only when both halves of it arrived", () => {
  const rows = [
    { id: ROOM, chat_id: CHAT, name: "Звонок", ring_started_at: "2026-09-18T11:59:57.000Z", ring_caller: ANNA, ring_answered_at: null, participant_count: 1, archived: false },
    // The shapes the database's own CHECK makes impossible, which is exactly
    // why they mean «this read is not the read you think it is» — a projection
    // missing a column, or a deployment whose migration has not landed.
    { id: OTHER_ROOM, chat_id: CHAT, ring_started_at: "2026-09-18T11:59:57.000Z", ring_caller: null, participant_count: 0 },
    { id: OTHER_ROOM, chat_id: CHAT, ring_started_at: null, ring_caller: ANNA, participant_count: 0 },
    // A room with nobody in it and no ring: the ordinary voice channel.
    { id: OTHER_ROOM, chat_id: OTHER_CHAT, name: "Общий голос", participant_count: 0, archived: false },
    { id: OTHER_ROOM, chat_id: CHAT, ring_started_at: "not a date", ring_caller: ANNA },
  ];
  const read = readVoiceRingRows(rows);
  assert.equal(read.length, 1);
  assert.equal(read[0].channelId, ROOM);
  assert.equal(read[0].caller, ANNA);
  assert.equal(read[0].startedAt, Date.parse("2026-09-18T11:59:57.000Z"));
  assert.equal(read[0].answeredAt, null);
});

test("an archived room's ring is not a call, and a nameless room is «Звонок»", () => {
  assert.deepEqual(
    readVoiceRingRows([
      { id: ROOM, chat_id: CHAT, ring_started_at: "2026-09-18T11:59:57.000Z", ring_caller: ANNA, archived: true },
    ]),
    [],
  );
  const [row] = readVoiceRingRows([
    { id: ROOM, chat_id: CHAT, name: "   ", ring_started_at: "2026-09-18T11:59:57.000Z", ring_caller: ANNA, participant_count: -4 },
  ]);
  assert.equal(row.name, "Звонок");
  // The counter is denormalised and can be negative for a moment while a
  // webhook and a reconciliation disagree. `voiceOccupancyLabel` clamps it for
  // the same reason.
  assert.equal(row.participantCount, 0);
});

test("anything that is not a list of rows is no rings at all", () => {
  for (const value of [null, undefined, {}, "rows", 7]) {
    assert.deepEqual(readVoiceRingRows(value), []);
  }
  assert.deepEqual(readVoiceRingRows([null, "x", 3]), []);
});

// ---------------------------------------------------------------------------
// Which ring, and which way round
// ---------------------------------------------------------------------------

test("only a ringing ring is picked: answered is a call and expired is over", () => {
  assert.equal(pickVoiceRing({ rings: [ring()], selfId: ME, now: NOW })?.direction, "incoming");
  // Answered: both are in the room and `VoiceCallBar` carries it from here.
  assert.equal(pickVoiceRing({ rings: [ring({ answeredAt: NOW - 1_000 })], selfId: ME, now: NOW }), null);
  // Expired: §4a's second trap — a laptop woken ten minutes late receives the
  // row on resubscribe and must not ring at a call that is long over.
  assert.equal(pickVoiceRing({ rings: [ring({ startedAt: NOW - 600_000 })], selfId: ME, now: NOW }), null);
});

test("the direction is who is calling, and nobody reading is nobody at all", () => {
  assert.equal(pickVoiceRing({ rings: [ring({ caller: ME })], selfId: ME, now: NOW })?.direction, "outgoing");
  assert.equal(pickVoiceRing({ rings: [ring({ caller: ANNA })], selfId: ME, now: NOW })?.direction, "incoming");
  // Before the account is known there is nobody for a call to be incoming to.
  assert.equal(pickVoiceRing({ rings: [ring()], selfId: null, now: NOW }), null);
});

test("two rings at once are ordered, and the order cannot change between two reads", () => {
  const first = ring({ channelId: OTHER_ROOM, chatId: OTHER_CHAT, caller: PETR, startedAt: NOW - 5_000 });
  const second = ring({ channelId: ROOM, caller: ANNA, startedAt: NOW - 2_000 });
  assert.equal(pickVoiceRing({ rings: [second, first], selfId: ME, now: NOW })?.ring.channelId, OTHER_ROOM);
  assert.equal(pickVoiceRing({ rings: [first, second], selfId: ME, now: NOW })?.ring.channelId, OTHER_ROOM);
  // The same instant: broken on the room's id, so the button under the thumb
  // does not swap between two evaluations of the same facts.
  const tieA = ring({ channelId: ROOM, startedAt: NOW - 1_000 });
  const tieB = ring({ channelId: OTHER_ROOM, chatId: OTHER_CHAT, startedAt: NOW - 1_000 });
  assert.equal(pickVoiceRing({ rings: [tieA, tieB], selfId: ME, now: NOW })?.ring.channelId, ROOM);
  assert.equal(pickVoiceRing({ rings: [tieB, tieA], selfId: ME, now: NOW })?.ring.channelId, ROOM);
});

test("one room's ring is a question the bar and the header can ask by name", () => {
  const rings = [ring(), ring({ channelId: OTHER_ROOM, chatId: OTHER_CHAT, answeredAt: NOW - 1_000 })];
  assert.equal(voiceRingIsWaiting({ rings, channelId: ROOM, now: NOW }), true);
  // Answered is not waiting: that call is running, and the bar has to draw it.
  assert.equal(voiceRingIsWaiting({ rings, channelId: OTHER_ROOM, now: NOW }), false);
  assert.equal(voiceRingIsWaiting({ rings, channelId: "33333333-3333-4333-8333-000000000009", now: NOW }), false);
  assert.equal(voiceRingIsWaiting({ rings, channelId: null, now: NOW }), false);
  // And it runs out on the same boundary everything else does.
  assert.equal(voiceRingIsWaiting({ rings: [ring({ startedAt: NOW - 45_000 })], channelId: ROOM, now: NOW }), false);
});

// ---------------------------------------------------------------------------
// What the surface says
// ---------------------------------------------------------------------------

test("an incoming call is a name, a line and two buttons", () => {
  const view = voiceRingView({
    pick: pickVoiceRing({ rings: [ring()], selfId: ME, now: NOW }),
    who: "Анна Смирнова",
    busy: false,
  });
  assert.equal(view.visible, true);
  assert.equal(view.direction, "incoming");
  assert.equal(view.who, "Анна Смирнова");
  assert.equal(view.detail, "Входящий звонок");
  assert.equal(view.answer, true);
  assert.equal(view.decline, true);
  assert.equal(view.cancel, false);
  assert.equal(view.channelId, ROOM);
  assert.equal(view.chatId, CHAT);
});

test("an outgoing call is the same name and one button", () => {
  const view = voiceRingView({
    pick: pickVoiceRing({ rings: [ring({ caller: ME })], selfId: ME, now: NOW }),
    who: "Анна Смирнова",
    busy: false,
  });
  assert.equal(view.direction, "outgoing");
  assert.equal(view.detail, "Звоним…");
  assert.equal(view.answer, false, "the caller must never be offered their own ring to answer");
  assert.equal(view.decline, false);
  assert.equal(view.cancel, true);
});

test("a press in flight keeps the controls drawn and says what is happening", () => {
  const incoming = pickVoiceRing({ rings: [ring()], selfId: ME, now: NOW });
  const outgoing = pickVoiceRing({ rings: [ring({ caller: ME })], selfId: ME, now: NOW });
  const answering = voiceRingView({ pick: incoming, who: "Анна", busy: true });
  assert.equal(answering.detail, "Соединяем…");
  // Drawn, not removed: a control that disappears reads as a feature that went
  // away, which is the rule the capsule states about a silenced microphone.
  assert.equal(answering.answer, true);
  assert.equal(answering.busy, true);
  assert.equal(voiceRingView({ pick: outgoing, who: "Анна", busy: true }).detail, "Отменяем…");
  // Four states, four sentences: none of them says what another says.
  const lines = [
    voiceRingView({ pick: incoming, who: "Анна", busy: false }).detail,
    answering.detail,
    voiceRingView({ pick: outgoing, who: "Анна", busy: false }).detail,
    voiceRingView({ pick: outgoing, who: "Анна", busy: true }).detail,
  ];
  assert.equal(new Set(lines).size, 4, `two states share a sentence: ${lines.join(" | ")}`);
});

test("no ring is a card that draws nothing, and a nameless caller still has a name", () => {
  const nothing = voiceRingView({ pick: null, who: "Анна", busy: false });
  assert.equal(nothing.visible, false);
  assert.equal(nothing.direction, null);
  assert.equal(nothing.channelId, null);
  for (const who of [null, "", "   "]) {
    const view = voiceRingView({
      pick: pickVoiceRing({ rings: [ring()], selfId: ME, now: NOW }),
      who,
      busy: false,
    });
    assert.equal(view.who, "Собеседник", "a blank name left an empty line where the caller goes");
  }
});

// ---------------------------------------------------------------------------
// One row, every device
// ---------------------------------------------------------------------------

test("a call whose ring is gone is over, and that is how a decline reaches the caller", () => {
  assert.equal(
    voiceRingEndedTheCall({ callChannelId: ROOM, oneToOneChannelId: ROOM, rings: [ring({ caller: ME })] }),
    false,
  );
  assert.equal(
    voiceRingEndedTheCall({ callChannelId: ROOM, oneToOneChannelId: ROOM, rings: [] }),
    true,
  );
  // An answer is the one thing that does **not** clear the row, which is what
  // keeps «they answered» and «they declined» apart for the caller.
  assert.equal(
    voiceRingEndedTheCall({
      callChannelId: ROOM,
      oneToOneChannelId: ROOM,
      rings: [ring({ caller: ME, answeredAt: NOW - 500 })],
    }),
    false,
  );
});

test("a group call has no ring and must survive having none", () => {
  // The mutation this exists for is dropping `oneToOneChannelId` from the rule.
  // A group's room never has a ring row, so «no ring for the room I am in» is
  // the ordinary state of every voice channel in the product — and without this
  // guard the first read after joining one would hang it up.
  assert.equal(
    voiceRingEndedTheCall({ callChannelId: ROOM, oneToOneChannelId: null, rings: [] }),
    false,
  );
  // A one-to-one call that ended, followed by a group call in another room: the
  // stale id must not end the new call either.
  assert.equal(
    voiceRingEndedTheCall({ callChannelId: OTHER_ROOM, oneToOneChannelId: ROOM, rings: [] }),
    false,
  );
  // And no call at all is nothing to end.
  assert.equal(
    voiceRingEndedTheCall({ callChannelId: null, oneToOneChannelId: ROOM, rings: [] }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Whether a call is offered here at all
// ---------------------------------------------------------------------------

function offer(over: Record<string, unknown> = {}) {
  return voiceCallOffer({
    chatType: "private",
    isSaved: false,
    otherUserId: ANNA,
    selfId: ME,
    iBlockedThem: false,
    callChannelId: null,
    ringingHere: false,
    ...over,
  } as Parameters<typeof voiceCallOffer>[0]);
}

test("a private chat offers a call to both of the two people in it", () => {
  // The whole point of the slice: `voice_channels` INSERT is `is_chat_admin`,
  // so in a private chat one participant holds `owner` and the other `member`
  // and exactly one of them could ever create the room. Nothing here asks about
  // a role, which is the assertion — a role input would put the asymmetry back
  // in the interface after the database had just closed it.
  const verdict = offer();
  assert.equal(verdict.offered, true);
  assert.equal(verdict.offered && verdict.label, "Позвонить");
});

test("every refusal is its own fact, not a shade of one", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ chatType: "group" }, "not_private"],
    [{ chatType: "channel" }, "not_private"],
    [{ chatType: undefined }, "not_private"],
    [{ isSaved: true }, "saved"],
    // A bot chat: the bot is in `chat_bot_members`, never in `chat_members`,
    // so the chat has no `other_user` and a telephone would ring nobody.
    [{ otherUserId: undefined }, "no_person"],
    [{ otherUserId: ME }, "no_person"],
    [{ selfId: null }, "no_person"],
    [{ iBlockedThem: true }, "blocked"],
    [{ callChannelId: OTHER_ROOM }, "in_a_call"],
    [{ ringingHere: true }, "ringing"],
  ];
  for (const [over, reason] of cases) {
    const verdict = offer(over);
    assert.equal(verdict.offered, false, `${JSON.stringify(over)} was offered a call`);
    assert.equal(verdict.offered === false && verdict.reason, reason);
  }
});

// ---------------------------------------------------------------------------
// Refusals, and the sentence each one becomes
// ---------------------------------------------------------------------------

test("the name is in the message, because the SQLSTATE cannot tell two of them apart", () => {
  // `raise exception 'blocked' using errcode = '42501'` reaches the client as
  // `{code: "42501", message: "blocked"}`, and three of the four functions
  // raise more than one thing under one SQLSTATE: `already_ringing` and
  // `already_in_call` are both 55006, `not_a_member` and `blocked` are both
  // 42501. Reading the code alone would tell somebody they are not in the chat
  // when in fact the other person has blocked them.
  assert.equal(classifyVoiceRingError({ code: "42501", message: "blocked" }), "blocked");
  assert.equal(classifyVoiceRingError({ code: "42501", message: "not_a_member" }), "not_a_member");
  assert.equal(classifyVoiceRingError({ code: "55006", message: "already_ringing" }), "already_ringing");
  assert.equal(classifyVoiceRingError({ code: "55006", message: "already_in_call" }), "already_in_call");
  assert.equal(classifyVoiceRingError({ code: "55006", message: "not_ringing" }), "not_ringing");
  assert.equal(classifyVoiceRingError({ code: "42501", message: "caller_cannot_answer" }), "caller_cannot_answer");
  assert.equal(classifyVoiceRingError({ code: "22023", message: "not_a_private_chat" }), "not_a_private_chat");
  assert.equal(classifyVoiceRingError({ code: "22023", message: "bad_reason" }), "bad_reason");
  assert.equal(classifyVoiceRingError({ code: "P0002", message: "no_such_chat" }), "no_such_chat");
  assert.equal(classifyVoiceRingError({ code: "P0002", message: "no_such_room" }), "no_such_room");
  // The real body PostgREST sends, rather than a tidied one.
  assert.equal(
    classifyVoiceRingError({
      code: "55006",
      details: null,
      hint: null,
      message: 'unexpected raise: already_ringing',
    }),
    "already_ringing",
  );
});

test("a deployment without the functions, and a request that reached nothing", () => {
  assert.equal(classifyVoiceRingError({ code: "PGRST202", message: "Could not find the function public.voice_call_ring" }), "unsupported");
  assert.equal(classifyVoiceRingError({ code: "42P01", message: "relation does not exist" }), "unsupported");
  // supabase-js reports a fetch that reached nothing as an error with no code.
  assert.equal(classifyVoiceRingError({ message: "TypeError: Failed to fetch" }), "network");
  assert.equal(classifyVoiceRingError({ message: "Load failed" }), "network");
  assert.equal(classifyVoiceRingError(null), "unknown");
  assert.equal(classifyVoiceRingError({ code: "PGRST301", message: "" }), "not_a_member");
});

test("every refusal has a sentence of its own, and none of them is a code", () => {
  const codes = [
    "already_ringing", "already_in_call", "not_a_private_chat", "not_a_member",
    "blocked", "no_such_chat", "no_such_room", "not_ringing", "caller_cannot_answer",
    "bad_reason", "not_authenticated", "unsupported", "network", "unknown",
  ] as const;
  const seen = new Set<string>();
  for (const code of codes) {
    const text = voiceRingRefusalText(code);
    assert.ok(text.length > 0, `${code} has no sentence`);
    assert.ok(!/[0-9]{4,}|PGRST|row-level|policy/i.test(text), `${code} leaks an implementation: ${text}`);
    seen.add(text);
  }
  // `no_such_chat` and `no_such_room` deliberately share one — the room is gone
  // and so is the chat, and both mean the call is over to the person reading.
  assert.equal(seen.size, codes.length - 1);
  // The one worth naming: two devices ring, one answers, the other's press
  // arrives late. That is §4a working, not an error, and the sentence says so.
  assert.equal(voiceRingRefusalText("not_ringing"), "Уже ответили на другом устройстве.");
});

test("channel_full keeps group wording but becomes a private-call fact in the ring", () => {
  const groupText = voiceGatewayRefusalText("channel_full");
  const privateText = voiceRingJoinRefusalText({ refusalCode: "channel_full", refusal: groupText });

  assert.equal(groupText, "В голосовом чате уже максимум участников.");
  assert.equal(privateText, "Разговор уже идёт.");
  assert.doesNotMatch(privateText, /участник|мест/iu);
  assert.equal(
    voiceRingJoinRefusalText({
      refusalCode: "network",
      refusal: "Нет связи с сервером, проверьте подключение.",
    }),
    "Нет связи с сервером, проверьте подключение.",
    "only channel_full receives private-call wording",
  );
});
