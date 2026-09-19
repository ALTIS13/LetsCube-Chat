import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_ELSEWHERE_DETAIL,
  VOICE_ELSEWHERE_MOVE,
  VOICE_ELSEWHERE_PROMISE,
  VOICE_ELSEWHERE_STATE,
  voiceElsewhere,
  voiceElsewhereBarState,
  voiceJoinIsAMove,
  type VoiceElsewhereRoom,
  type VoiceParticipantRow,
} from "../../artifacts/kub/src/lib/voiceElsewhere.ts";
import { voiceCapsuleState } from "../../artifacts/kub/src/lib/voiceChannel.ts";

/**
 * «Вы в этом разговоре на другом устройстве», and the press that moves it here.
 *
 * The owner asked for Discord's behaviour on 2026-09-18 and
 * `docs/proposals/2026-09-18-one-to-one-calls.md` §4b measured that two thirds
 * of it were already true: nothing binds a room to whoever opened it, and
 * `voice_participants`'s primary key is `(channel_id, user_id)`, so one person
 * cannot be represented twice in one room whatever any client does. What was
 * missing is that the second device does not *know*.
 *
 * So the case that matters most, and the one this file opens with: a device
 * already in the room elsewhere is offered **the move and not a join**, and a
 * device in the room **here** sees the ordinary bar.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";
/** Deliberately ordered, because «which room» is answered by the lowest id. */
const ROOM_A = "33333333-3333-4333-8333-00000000000a";
const ROOM_B = "33333333-3333-4333-8333-00000000000b";
const CHAT = "22222222-2222-4222-8222-000000000001";

function room(over: Partial<VoiceElsewhereRoom> = {}): VoiceElsewhereRoom {
  return {
    channelId: ROOM_A,
    chatId: CHAT,
    name: "Общий голос",
    archived: false,
    ringing: false,
    ...over,
  };
}

function rows(...entries: [string, string][]): VoiceParticipantRow[] {
  return entries.map(([channelId, userId]) => ({ channelId, userId }));
}

/**
 * The band's inputs, with the conversation on screen speaking for nothing.
 *
 * That is the ordinary state — the reader is somewhere else in the application,
 * which is the whole point of a band that follows them — and the one case where
 * it is not has its own test below.
 */
function band(over: Partial<Parameters<typeof voiceElsewhereBarState>[0]> = {}) {
  return voiceElsewhereBarState({
    elsewhere: room(),
    chatName: "Команда проекта",
    localPhase: "idle",
    spokenForHere: false,
    ...over,
  });
}

// ── the fact ───────────────────────────────────────────────────────────────

test("the room I am in elsewhere, and the same room when I am in it here", () => {
  const rooms = [room()];

  // Nothing here, my own row in room A: that is the whole of «на другом
  // устройстве», and it needed no new table to say.
  assert.deepEqual(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "idle",
      localChannelId: null,
      rooms,
    }),
    room(),
  );

  // Connected here, to that very room. The row is **this device's own**, and
  // reading it as a second device is how a bar would announce a call to the
  // person already in it.
  assert.equal(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "connected",
      localChannelId: ROOM_A,
      rooms,
    }),
    null,
  );
});

test("somebody else in the room is not me in it", () => {
  assert.equal(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ANNA]),
      localPhase: "idle",
      localChannelId: null,
      rooms: [room()],
    }),
    null,
  );
  // And the row that decides it is compared by id rather than trusted from the
  // query's own `user_id=eq.…`: the filter is the server's promise, the column
  // is the evidence.
  assert.equal(
    voiceElsewhere({
      myUserId: null,
      participants: rows([ROOM_A, ME]),
      localPhase: "idle",
      localChannelId: null,
      rooms: [room()],
    }),
    null,
  );
});

test("a join in flight already counts as «here», so the band goes at the press", () => {
  // `joining` is the state between pressing «Перейти сюда» and the transport
  // answering. Counting it is what makes the band disappear immediately rather
  // than a webhook later — and it is also what keeps the interface correct if
  // the SFU never evicts the other device, because what this client draws is
  // driven by this client's own state.
  assert.equal(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "joining",
      localChannelId: ROOM_A,
      rooms: [room()],
    }),
    null,
  );
  assert.equal(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "reconnecting",
      localChannelId: ROOM_A,
      rooms: [room()],
    }),
    null,
  );
  // `failed` is not «here». `VoiceCallState` keeps `channelId` on a join that
  // failed, and a room this device never reached is not a room it is in — so a
  // failed attempt here must not hide a connection that is up over there.
  assert.deepEqual(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "failed",
      localChannelId: ROOM_A,
      rooms: [room()],
    }),
    room(),
  );
});

test("a room the client cannot name is not an answer, and neither is a removed one", () => {
  // Joining needs a chat id. A participant row left behind by a room that has
  // since been removed would otherwise draw a band offering to move into
  // nothing.
  assert.equal(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_B, ME]),
      localPhase: "idle",
      localChannelId: null,
      rooms: [room()],
    }),
    null,
  );
  assert.equal(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "idle",
      localChannelId: null,
      rooms: [room({ archived: true })],
    }),
    null,
  );
});

test("an outgoing call nobody has answered is not a conversation to move into", () => {
  // The caller joins the room the moment they press, so a ring in flight on the
  // other device is a participant row in a room where nothing is happening.
  // Saying «вы в разговоре» about a telephone that is still ringing is the
  // sentence `readVoicePresenceRows` refuses to put on a chat row.
  assert.equal(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "idle",
      localChannelId: null,
      rooms: [room({ ringing: true })],
    }),
    null,
  );
  // Answered is a conversation, and this is the shape that separates the two.
  assert.deepEqual(
    voiceElsewhere({
      myUserId: ME,
      participants: rows([ROOM_A, ME]),
      localPhase: "idle",
      localChannelId: null,
      rooms: [room({ ringing: false })],
    }),
    room(),
  );
});

test("two rooms is a real state, and the answer does not flicker between them", () => {
  // The primary key forbids one person twice in **one** room; it says nothing
  // about two. A client that died mid-move leaves exactly this, and an answer
  // that changed between two reads saying the same thing is a band that flips
  // between two rooms — the tie-break `chatVoicePresence` makes, by id.
  const rooms = [room({ channelId: ROOM_B, name: "Планёрка" }), room({ channelId: ROOM_A })];
  const forward = voiceElsewhere({
    myUserId: ME,
    participants: rows([ROOM_B, ME], [ROOM_A, ME]),
    localPhase: "idle",
    localChannelId: null,
    rooms,
  });
  const backward = voiceElsewhere({
    myUserId: ME,
    participants: rows([ROOM_A, ME], [ROOM_B, ME]),
    localPhase: "idle",
    localChannelId: null,
    rooms,
  });
  assert.equal(forward?.channelId, ROOM_A);
  assert.equal(backward?.channelId, ROOM_A);
});

// ── the move replacing the join ────────────────────────────────────────────

test("the press is a move for that room and a plain join for every other", () => {
  const elsewhere = room();
  assert.equal(voiceJoinIsAMove(ROOM_A, elsewhere), true);
  assert.equal(voiceJoinIsAMove(ROOM_B, elsewhere), false);
  assert.equal(voiceJoinIsAMove(ROOM_A, null), false);
  // A surface with no room to speak for — a group whose several rooms make the
  // capsule name none — must not inherit somebody else's answer.
  assert.equal(voiceJoinIsAMove(null, elsewhere), false);
});

test("the capsule offers the move and never the plain join", () => {
  const base = {
    channel: { id: ROOM_A, name: "Общий голос", participantCount: 1, maxParticipants: 10 },
    phase: "idle" as const,
    callChannelId: null,
    participants: [],
    selfId: ME,
    micMuted: false,
    canPublish: true,
    refusal: null,
    outputDeviceRefused: false,
    deafened: false,
  };

  const ordinary = voiceCapsuleState({ ...base, elsewhere: false });
  assert.equal(ordinary.action, "join");
  assert.equal(ordinary.actionLabel, "Присоединиться");

  const moved = voiceCapsuleState({ ...base, elsewhere: true });
  assert.equal(moved.action, "move");
  assert.equal(moved.actionLabel, VOICE_ELSEWHERE_MOVE);
  // One control, and it is not a second join standing beside the first.
  assert.notEqual(moved.actionLabel, ordinary.actionLabel);
  // And the sentence carries the consequence, not only the state.
  assert.ok(moved.detail.includes(VOICE_ELSEWHERE_STATE));
  assert.ok(moved.detail.includes(VOICE_ELSEWHERE_PROMISE));
});

test("a full room I am already sitting in does not refuse me a seat", () => {
  // «Мест больше нет» over a room this person is in on their computer is the
  // interface arguing with the table: the seat is taken by them.
  const full = voiceCapsuleState({
    channel: { id: ROOM_A, name: "Общий голос", participantCount: 10, maxParticipants: 10 },
    phase: "idle",
    callChannelId: null,
    participants: [],
    selfId: ME,
    micMuted: false,
    canPublish: true,
    refusal: null,
    outputDeviceRefused: false,
    deafened: false,
    elsewhere: true,
  });
  assert.equal(full.action, "move");
  assert.notEqual(full.detail, "Мест больше нет");
});

test("a call running here keeps the capsule saying so, and offers nothing", () => {
  // The existing branch, unmoved: this device is in another room, so this
  // chat's capsule says where the call is and offers no control. It must win
  // over the move, because the move is about a room this device is *not* in.
  const view = voiceCapsuleState({
    channel: { id: ROOM_A, name: "Общий голос", participantCount: 1, maxParticipants: 10 },
    phase: "connected",
    callChannelId: ROOM_B,
    participants: [],
    selfId: ME,
    micMuted: false,
    canPublish: true,
    refusal: null,
    outputDeviceRefused: false,
    deafened: false,
    elsewhere: true,
  });
  assert.equal(view.detail, "Вы в другом голосовом чате");
  assert.equal(view.action, null);
});

// ── the band ───────────────────────────────────────────────────────────────

test("the band names the room, the group and the state, and carries the press", () => {
  const view = band();
  assert.equal(view.visible, true);
  assert.equal(view.room, "Общий голос");
  assert.equal(view.where, "Команда проекта");
  assert.equal(view.detail, VOICE_ELSEWHERE_STATE);
  assert.equal(view.promise, VOICE_ELSEWHERE_PROMISE);
  assert.equal(view.actionLabel, VOICE_ELSEWHERE_MOVE);
  // Everything `joinVoiceChannel` needs, so the press has no lookup of its own.
  assert.equal(view.channelId, ROOM_A);
  assert.equal(view.chatId, CHAT);
  assert.equal(view.channelName, "Общий голос");
});

test("the band stands down wherever the call bar stands, and nowhere else", () => {
  // The two say opposite things about one person — one is about a call this
  // device is in, the other about one it is not — and they are mounted in the
  // same two places. At most one may ever be drawn.
  for (const phase of ["joining", "connected", "reconnecting"] as const) {
    assert.equal(
      band({ localPhase: phase }).visible,
      false,
      `a call is running here in phase ${phase}; the in-call bar speaks`,
    );
  }
  for (const phase of ["idle", "failed"] as const) {
    assert.equal(
      band({ localPhase: phase }).visible,
      true,
      `no call is running here in phase ${phase}`,
    );
  }
  assert.equal(band({ elsewhere: null, chatName: null }).visible, false);
});

test("and it stands down where the conversation already offers the same move", () => {
  // The capsule and the rail's own row say «Перейти сюда» for a room in the
  // group on screen. A band saying it again, three lines under the same words,
  // is the relabelled duplicate this product refuses — the rule the call bar
  // follows for the capsule, one state sideways.
  assert.equal(band({ spokenForHere: true }).visible, false);
  assert.equal(band({ spokenForHere: false }).visible, true);
});

test("it never prints one fact twice, and never leaves the room unnamed", () => {
  // A one-to-one call's room carries the other person's name and `useChats`
  // gives the private chat that same name, so without the rule the band would
  // print «Анна Смирнова» over «Анна Смирнова · На другом устройстве».
  assert.equal(
    band({ elsewhere: room({ name: "Анна Смирнова" }), chatName: "Анна Смирнова" }).where,
    null,
  );
  assert.equal(band({ chatName: null }).where, null);
  // A room with no name at all still gets a line somebody can read.
  assert.equal(band({ elsewhere: room({ name: "   " }), chatName: null }).room, "Голосовой канал");
});

// ── the words ──────────────────────────────────────────────────────────────

test("the sentence says the call moves away, and never that it already did", () => {
  // §4b: LiveKit's duplicate-identity rule is documented and **not verified on
  // this deployment**, so the design must not depend on it. What is promised is
  // therefore a forecast about this press — and nothing anywhere reports the
  // other device as having been disconnected, which is an event this client
  // cannot see.
  assert.ok(VOICE_ELSEWHERE_PROMISE.includes("перейдёт сюда"));
  assert.ok(VOICE_ELSEWHERE_PROMISE.includes("прервётся"));
  for (const word of ["отключено", "отключён", "прерван", "завершён", "вышли"]) {
    assert.ok(
      !VOICE_ELSEWHERE_PROMISE.includes(word),
      `«${word}» reports a past event this client never observed`,
    );
  }
  // One sentence, said the same way by three surfaces: the band draws state and
  // promise as two lines, the capsule and the information panel have one.
  assert.equal(VOICE_ELSEWHERE_DETAIL, `${VOICE_ELSEWHERE_STATE} · ${VOICE_ELSEWHERE_PROMISE}`);
});
