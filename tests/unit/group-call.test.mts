// A group chat's call, as rules — tracker item 45, second phase.
//
// Discord's shape, read in its web bundle on 2026-09-30: a call rings people
// one by one (`ongoingRings`, keyed by person), leaves one message that is
// given its participants and its end, and a reader missed it when they are not
// among the participants. Everything the band, the header and the chip decide
// is decided here.

import assert from "node:assert/strict";
import test from "node:test";

import {
  GROUP_CALL_MOVE_WINDOW_MS,
  groupCallMoveTarget,
  groupCallOffer,
  groupCallRecordPreview,
  groupCallRecordView,
  groupCallRefusalText,
  groupRingNextExpiry,
  groupRingView,
  pickGroupRing,
  readGroupCallRecord,
  readGroupCallRows,
  type GroupCallRow,
} from "../../artifacts/kub/src/lib/groupCall.ts";
import { formatChatMessagePreview } from "../../artifacts/kub/src/lib/messagePreview.ts";

const T0 = Date.parse("2026-09-30T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";
const BORIS = "11111111-1111-4111-8111-000000000003";

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: "room-1",
    chat_id: "chat-1",
    archived: false,
    participant_count: 1,
    call_started_at: iso(T0),
    call_started_by: ANNA,
    call_message_id: "message-1",
    call_ringing: { [ME]: iso(T0) },
    call_moved_to: null,
    call_moved_at: null,
    ...overrides,
  };
}

function rows(...list: Record<string, unknown>[]): GroupCallRow[] {
  return readGroupCallRows(list);
}

test("a room is read with its call and each person's ring", () => {
  const [row] = rows(room());
  assert.equal(row.channelId, "room-1");
  assert.equal(row.messageId, "message-1");
  assert.equal(row.startedAt, T0);
  assert.equal(row.ringing.get(ME), T0);
});

test("a room with neither a call nor a move is not this store's, and neither is an archived one", () => {
  assert.equal(rows(room({ call_message_id: null, call_started_at: null })).length, 0);
  assert.equal(rows(room({ archived: true })).length, 0);
  assert.equal(readGroupCallRows(null).length, 0);
  assert.equal(readGroupCallRows([null, 3, "x"]).length, 0);
});

test("half a call is no call: a message without a start, or a start without a message", () => {
  const [a] = rows(room({ call_started_at: null, call_moved_to: "room-2", call_moved_at: iso(T0) }));
  assert.equal(a.messageId, null);
  const [b] = rows(room({ call_message_id: null, call_moved_to: "room-2", call_moved_at: iso(T0) }));
  assert.equal(b.startedAt, null);
});

test("a ring with a bad time is dropped, not guessed", () => {
  const [row] = rows(room({ call_ringing: { [ME]: "yesterday", [ANNA]: iso(T0) } }));
  assert.equal(row.ringing.has(ME), false);
  assert.equal(row.ringing.get(ANNA), T0);
});

test("the reader's own ring rings for 45 seconds, and the 45th is over, as a private ring's is", () => {
  const calls = rows(room());
  assert.ok(pickGroupRing({ calls, selfId: ME, now: T0 + 44_999, callChannelId: null }));
  assert.equal(pickGroupRing({ calls, selfId: ME, now: T0 + 45_000, callChannelId: null }), null);
});

test("nobody else's ring rings for this reader, and nothing rings before the reader is known", () => {
  const calls = rows(room({ call_ringing: { [BORIS]: iso(T0) } }));
  assert.equal(pickGroupRing({ calls, selfId: ME, now: T0, callChannelId: null }), null);
  assert.equal(pickGroupRing({ calls: rows(room()), selfId: null, now: T0, callChannelId: null }), null);
});

test("a ring for the room the reader is already in does not ring", () => {
  assert.equal(pickGroupRing({ calls: rows(room()), selfId: ME, now: T0, callChannelId: "room-1" }), null);
});

test("a declined ring stays quiet until the row stops carrying it", () => {
  const calls = rows(room());
  const declined = new Set([`room-1@${T0}`]);
  assert.equal(pickGroupRing({ calls, selfId: ME, now: T0, callChannelId: null, declined }), null);
  // Rung again later: a new ring, not the declined one.
  const again = rows(room({ call_ringing: { [ME]: iso(T0 + 10_000) } }));
  assert.ok(pickGroupRing({ calls: again, selfId: ME, now: T0 + 10_000, callChannelId: null, declined }));
});

test("of two rings the earlier wins, and a tie is broken by the room, so the band does not swap", () => {
  const calls = rows(
    room({ id: "room-b", chat_id: "chat-b", call_ringing: { [ME]: iso(T0) } }),
    room({ id: "room-a", chat_id: "chat-a", call_ringing: { [ME]: iso(T0) } }),
    room({ id: "room-c", chat_id: "chat-c", call_ringing: { [ME]: iso(T0 - 1000) } }),
  );
  assert.equal(pickGroupRing({ calls, selfId: ME, now: T0, callChannelId: null })?.call.channelId, "room-c");
  const tie = rows(
    room({ id: "room-b", chat_id: "chat-b" }),
    room({ id: "room-a", chat_id: "chat-a" }),
  );
  assert.equal(pickGroupRing({ calls: tie, selfId: ME, now: T0, callChannelId: null })?.call.channelId, "room-a");
});

test("the store's timer is set at the next ring's end", () => {
  const calls = rows(room());
  assert.equal(groupRingNextExpiry({ calls, selfId: ME, now: T0 + 1000 }), T0 + 45_000);
  assert.equal(groupRingNextExpiry({ calls, selfId: ME, now: T0 + 45_000 }), Number.POSITIVE_INFINITY);
  assert.equal(groupRingNextExpiry({ calls, selfId: null, now: T0 }), Number.POSITIVE_INFINITY);
});

test("a call in a room that moved goes to the group chat's room", () => {
  const privateRoom = room({ id: "private-room", chat_id: "private-chat", call_message_id: null, call_started_at: null, call_moved_to: "room-1", call_moved_at: iso(T0) });
  const calls = rows(privateRoom, room());
  assert.deepEqual(groupCallMoveTarget({ callChannelId: "private-room", calls, now: T0 + 1000 }), { channelId: "room-1", chatId: "chat-1" });
  // Not somebody else's move, not an old one, and not before the target is read.
  assert.equal(groupCallMoveTarget({ callChannelId: "elsewhere", calls, now: T0 }), null);
  assert.equal(groupCallMoveTarget({ callChannelId: "private-room", calls, now: T0 + GROUP_CALL_MOVE_WINDOW_MS }), null);
  assert.equal(groupCallMoveTarget({ callChannelId: "private-room", calls: rows(privateRoom), now: T0 }), null);
  assert.equal(groupCallMoveTarget({ callChannelId: null, calls, now: T0 }), null);
});

test("the header offers a start, a join, or nothing, and only in a group chat", () => {
  const [running] = rows(room());
  assert.deepEqual(groupCallOffer({ chatType: "private", call: null, callChannelId: null }), { offered: false, reason: "not_group_chat" });
  assert.deepEqual(groupCallOffer({ chatType: "group", call: null, callChannelId: null }), { offered: false, reason: "not_group_chat" });
  const start = groupCallOffer({ chatType: "dm_group", call: null, callChannelId: null });
  assert.equal(start.offered && start.mode, "start");
  assert.equal(start.offered && start.label, "Позвонить");
  const join = groupCallOffer({ chatType: "dm_group", call: running, callChannelId: null });
  assert.equal(join.offered && join.mode, "join");
  assert.equal(join.offered && join.label, "Присоединиться");
  assert.deepEqual(groupCallOffer({ chatType: "dm_group", call: running, callChannelId: "room-1" }), { offered: false, reason: "in_this_call" });
  assert.deepEqual(groupCallOffer({ chatType: "dm_group", call: running, callChannelId: "somewhere-else" }), { offered: false, reason: "in_a_call" });
});

const ENDED = {
  kind: "call",
  mode: "group",
  caller: ANNA,
  started_at: iso(T0),
  ended_at: iso(T0 + 192_000),
  duration_ms: 192_000,
  participants: [ANNA, ME],
};

test("a group call's message is read only when it says it is one", () => {
  assert.ok(readGroupCallRecord(ENDED));
  assert.equal(readGroupCallRecord({ ...ENDED, mode: undefined }), null, "a private call's record is not this");
  assert.equal(readGroupCallRecord({ ...ENDED, kind: "other" }), null);
  assert.equal(readGroupCallRecord({ ...ENDED, caller: "  " }), null);
  assert.equal(readGroupCallRecord(null), null);
  assert.equal(readGroupCallRecord([ENDED]), null);
});

test("whoever took part sees the call and its length", () => {
  const view = groupCallRecordView(ENDED, ME, { running: false, inThisCall: false });
  assert.equal(view?.headline, "Звонок");
  assert.equal(view?.duration, "3 мин 12 с");
  assert.equal(view?.missed, false);
  assert.equal(view?.icon, "phoneIncoming");
});

test("whoever did not take part missed it, in red, whoever rang", () => {
  const view = groupCallRecordView(ENDED, BORIS, { running: false, inThisCall: false });
  assert.equal(view?.headline, "Пропущенный звонок");
  assert.equal(view?.missed, true);
  assert.equal(view?.duration, null);
});

test("the one who rang and was alone there cancelled it, as a private chat says", () => {
  const alone = { ...ENDED, participants: [ANNA], duration_ms: 8000 };
  assert.equal(groupCallRecordView(alone, ANNA, { running: false, inThisCall: false })?.headline, "Отменённый звонок");
  assert.equal(groupCallRecordView(alone, ME, { running: false, inThisCall: false })?.headline, "Пропущенный звонок");
});

test("a running call offers a join to whoever is not in it, and only when the room says it runs", () => {
  const open = { ...ENDED, ended_at: null, duration_ms: null, participants: [ANNA] };
  const out = groupCallRecordView(open, ME, { running: true, inThisCall: false });
  assert.equal(out?.headline, "Идёт звонок");
  assert.equal(out?.joinable, true);
  assert.equal(groupCallRecordView(open, ME, { running: true, inThisCall: true })?.joinable, false);
  const unconfirmed = groupCallRecordView(open, ME, { running: false, inThisCall: false });
  assert.equal(unconfirmed?.headline, "Звонок");
  assert.equal(unconfirmed?.joinable, false, "no join into a call the room does not show");
});

test("a reader who cannot be named falls back to the neutral line", () => {
  assert.equal(groupCallRecordView(ENDED, null, { running: false, inThisCall: false }), null);
  assert.equal(groupCallRecordPreview(ENDED, "", { running: false, inThisCall: false }), null);
});

test("the chat list says what the chip says", () => {
  const message = { type: "system", content: "Звонок, 3 мин 12 с", media_url: null, deleted_at: null, system_payload: ENDED } as never;
  assert.equal(formatChatMessagePreview(message, BORIS), "Пропущенный звонок");
  assert.equal(formatChatMessagePreview(message, ME), "Звонок");
  const running = { ...(message as object), system_payload: { ...ENDED, ended_at: null, duration_ms: null } } as never;
  assert.equal(formatChatMessagePreview(running, ME), "Идёт звонок");
  assert.equal(formatChatMessagePreview(message), "Звонок, 3 мин 12 с", "no reader: the database's own line");
});

test("the band for a group ring answers and declines, and names the group", () => {
  const [call] = rows(room());
  const view = groupRingView({ pick: { call, rungAt: T0 }, who: "Анна, Борис", busy: false });
  assert.equal(view.visible, true);
  assert.equal(view.direction, "incoming");
  assert.equal(view.who, "Анна, Борис");
  assert.equal(view.detail, "Входящий групповой звонок");
  assert.equal(view.answer && view.decline && !view.cancel, true);
  assert.equal(groupRingView({ pick: { call, rungAt: T0 }, who: " ", busy: true }).who, "Групповой чат");
  assert.equal(groupRingView({ pick: { call, rungAt: T0 }, who: null, busy: true }).detail, "Соединяем…");
  assert.equal(groupRingView({ pick: null, who: "x", busy: false }).visible, false);
});

test("a refusal is said in words, never as the function's name", () => {
  assert.equal(groupCallRefusalText({ message: "not_a_member" }), "Вы больше не участник этого чата.");
  assert.equal(groupCallRefusalText({ message: "TypeError: Failed to fetch" }), "Нет связи с сервером, проверьте подключение.");
  assert.equal(groupCallRefusalText(null), "Не удалось позвонить.");
  for (const text of [groupCallRefusalText({ message: "no_such_chat" }), groupCallRefusalText({ message: "not_a_group_chat" })]) {
    assert.doesNotMatch(text, /_/);
  }
});
