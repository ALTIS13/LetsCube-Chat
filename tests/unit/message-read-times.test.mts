import assert from "node:assert/strict";
import test from "node:test";

import { getGroupReadReceiptInfo } from "../../artifacts/kub/src/lib/groupReadReceipts.ts";
import {
  createReadTimesLoader,
  groupReadInfoWithTimes,
  parseMessageReadTimes,
  privateReadDisplay,
  readMarksSignature,
  type ReadTimesState,
} from "../../artifacts/kub/src/lib/messageReadTimes.ts";
import { createRpcAvailability, isMissingRpcError } from "../../artifacts/kub/src/lib/rpcAvailability.ts";

/**
 * «Прочитано» and «Кто прочитал» show when each person read this message, not
 * when they last read the chat. The chat-wide pointer is still what says a
 * message was read — the check marks — and is what the details fall back to
 * where the server cannot answer.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const ANYA = "22222222-2222-4222-8222-222222222222";
const BORIS = "33333333-3333-4333-8333-333333333333";
const VERA = "44444444-4444-4444-8444-444444444444";
const SENT = "2026-09-11T10:00:00.000000+00:00";
const EXACT = "2026-09-11T10:02:00.000000+00:00";
const POINTER = "2026-09-11T10:25:00.000000+00:00";

const ready = (times: { readerId: string; hasRead: boolean; readAt: string | null }[]): ReadTimesState => ({ status: "ready", times });

test("the server's rows are read as they are, and any other shape is refused", () => {
  assert.deepEqual(
    parseMessageReadTimes([
      { reader_id: ANYA, has_read: true, read_at: EXACT },
      { reader_id: BORIS, has_read: true, read_at: null },
      { reader_id: VERA, has_read: false, read_at: null },
    ]),
    [
      { readerId: ANYA, hasRead: true, readAt: EXACT },
      { readerId: BORIS, hasRead: true, readAt: null },
      { readerId: VERA, hasRead: false, readAt: null },
    ],
  );
  assert.deepEqual(parseMessageReadTimes([]), []);
  assert.equal(parseMessageReadTimes(null), null);
  assert.equal(parseMessageReadTimes([{ reader_id: ANYA, has_read: "yes", read_at: EXACT }]), null);
  assert.equal(parseMessageReadTimes([{ user_id: ANYA, has_read: true, read_at: EXACT }]), null);
});

test("a private chat shows when the message was read, not when the chat was last read", () => {
  assert.deepEqual(
    privateReadDisplay(POINTER, ANYA, ready([{ readerId: ANYA, hasRead: true, readAt: EXACT }])),
    { read: true, readAt: EXACT, pending: false },
  );
});

test("read with no time to show is read, without a time", () => {
  assert.deepEqual(
    privateReadDisplay(POINTER, ANYA, ready([{ readerId: ANYA, hasRead: true, readAt: null }])),
    { read: true, readAt: null, pending: false },
  );
});

test("unread stays unread, and a time is never shown for it", () => {
  assert.deepEqual(
    privateReadDisplay(null, ANYA, ready([{ readerId: ANYA, hasRead: false, readAt: EXACT }])),
    { read: false, readAt: null, pending: false },
  );
});

test("where the server cannot answer, the pointer, as before", () => {
  assert.deepEqual(privateReadDisplay(POINTER, ANYA, { status: "unavailable" }), { read: true, readAt: POINTER, pending: false });
  assert.deepEqual(privateReadDisplay(null, ANYA, { status: "unavailable" }), { read: false, readAt: null, pending: false });
});

test("while asking, read with its time on the way — and a previous answer stays on screen", () => {
  assert.deepEqual(privateReadDisplay(POINTER, ANYA, { status: "loading", previous: null }), { read: true, readAt: null, pending: true });
  assert.deepEqual(
    privateReadDisplay(POINTER, ANYA, { status: "loading", previous: [{ readerId: ANYA, hasRead: true, readAt: EXACT }] }),
    { read: true, readAt: EXACT, pending: false },
  );
});

function member(userId: string, readAt: string | null, name: string) {
  return {
    chat_id: "chat",
    user_id: userId,
    role: "member",
    joined_at: "2026-09-01T00:00:00.000Z",
    last_read_at: readAt,
    last_delivered_at: readAt,
    profile: { id: userId, full_name: name, username: null, avatar_url: null },
  } as never;
}

const message = { user_id: ME, created_at: SENT, deleted_at: null, pending: false, checking: false, failed: false };

test("a group lists the readers the server names, each with the time they read the message", () => {
  const members = [member(ME, SENT, "Я"), member(ANYA, POINTER, "Аня"), member(BORIS, POINTER, "Борис"), member(VERA, null, "Вера")];
  const info = getGroupReadReceiptInfo(message, { currentUserId: ME, chatType: "group", members, isSavedChat: false });
  const profiles = new Map((members as { user_id: string; profile: never }[]).map((row) => [row.user_id, row.profile]));
  const withTimes = groupReadInfoWithTimes(info, ready([
    { readerId: ANYA, hasRead: true, readAt: EXACT },
    { readerId: BORIS, hasRead: true, readAt: null },
    { readerId: VERA, hasRead: false, readAt: null },
  ]), profiles);
  assert.deepEqual(withTimes?.readers.map((reader) => [reader.userId, reader.readAt]), [[ANYA, EXACT], [BORIS, null]]);
  assert.equal(withTimes?.readCount, 2);
  assert.equal(withTimes?.totalRecipients, 3);
  assert.equal(withTimes?.allRead, false);
  assert.equal(withTimes?.readers[0].profile?.full_name, "Аня");
});

test("the server's answer wins over members this client holds a receipt behind", () => {
  const members = [member(ME, SENT, "Я"), member(ANYA, null, "Аня")];
  const info = getGroupReadReceiptInfo(message, { currentUserId: ME, chatType: "group", members, isSavedChat: false });
  assert.equal(info?.readCount, 0, "the premise: the held members say nobody has read it");
  const profiles = new Map((members as { user_id: string; profile: never }[]).map((row) => [row.user_id, row.profile]));
  const withTimes = groupReadInfoWithTimes(info, ready([{ readerId: ANYA, hasRead: true, readAt: EXACT }]), profiles);
  assert.equal(withTimes?.readCount, 1);
  assert.equal(withTimes?.allRead, true);
});

test("asking shows the names without the pointer's times, and no loader leaves the receipt as it was", () => {
  const members = [member(ME, SENT, "Я"), member(ANYA, POINTER, "Аня")];
  const info = getGroupReadReceiptInfo(message, { currentUserId: ME, chatType: "group", members, isSavedChat: false });
  const profiles = new Map();
  assert.deepEqual(groupReadInfoWithTimes(info, { status: "loading", previous: null }, profiles)?.readers.map((reader) => reader.readAt), [null]);
  assert.equal(groupReadInfoWithTimes(info, { status: "unavailable" }, profiles), info);
  assert.equal(groupReadInfoWithTimes(null, ready([]), profiles), null);
});

test("the loader: the rows when there are some, null — and remembered — when the function is missing, null when refused", async () => {
  const availability = createRpcAvailability({ now: () => 0 });
  const calls: string[] = [];
  let answer: { data: unknown; error: unknown } = { data: [{ reader_id: ANYA, has_read: true, read_at: EXACT }], error: null };
  const load = createReadTimesLoader({
    rpc: (fn, args) => {
      calls.push(`${fn}:${String(args.p_message_id)}`);
      return Promise.resolve(answer);
    },
    availability,
    isMissingRpc: isMissingRpcError,
  });
  assert.deepEqual(await load("m1"), [{ readerId: ANYA, hasRead: true, readAt: EXACT }]);

  answer = { data: null, error: { code: "P0002", message: "message_not_found" } };
  assert.equal(await load("m2"), null);
  assert.equal(availability.shouldTry("message_read_times"), true, "a refusal was taken for a missing function");

  answer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  assert.equal(await load("m3"), null);
  assert.equal(await load("m4"), null);
  assert.deepEqual(calls, ["message_read_times:m1", "message_read_times:m2", "message_read_times:m3"], "a missing function was asked again");
});

test("the signature moves when another member's pointer moves, and not for the sender's own", () => {
  const before = readMarksSignature([
    { user_id: ME, last_read_at: SENT },
    { user_id: ANYA, last_read_at: null },
  ], ME);
  assert.notEqual(before, readMarksSignature([{ user_id: ME, last_read_at: SENT }, { user_id: ANYA, last_read_at: EXACT }], ME));
  assert.equal(before, readMarksSignature([{ user_id: ANYA, last_read_at: null }, { user_id: ME, last_read_at: POINTER }], ME));
});
