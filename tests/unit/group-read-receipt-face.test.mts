import assert from "node:assert/strict";
import test from "node:test";

import {
  getGroupReadReceiptInfo,
  sameGroupReadReceiptFace,
} from "../../artifacts/kub/src/lib/groupReadReceipts.ts";

/**
 * D-088: a message you sent renders for a receipt only when what it shows moved.
 *
 * `MessageList` rebuilds every receipt whenever a member's read mark changes and
 * keeps the previous object wherever this comparison says the face is the same.
 * The bubble draws how many of the others have read it; the list of names and
 * times is built fresh when it is opened. So a reader's heartbeat, or a read
 * mark that moves on past a message already read, must not count — and a new
 * reader, or a change in who is counted, must.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const ANYA = "22222222-2222-4222-8222-222222222222";
const BORIS = "33333333-3333-4333-8333-333333333333";
const SENT = "2026-09-11T10:00:00.000Z";
const LATER = "2026-09-11T10:05:00.000Z";

const profile = (id: string, onlineAt: string) => ({ id, full_name: id === ANYA ? "Аня" : "Борис", online_at: onlineAt });

function member(userId: string, readAt: string | null, onlineAt = SENT) {
  return {
    chat_id: "chat",
    user_id: userId,
    role: "member",
    joined_at: "2026-09-01T00:00:00.000Z",
    last_read_at: readAt,
    last_delivered_at: readAt,
    profile: profile(userId, onlineAt),
  } as never;
}

const message = { user_id: ME, created_at: SENT, deleted_at: null, pending: false, checking: false, failed: false };

function receipt(members: never[]) {
  return getGroupReadReceiptInfo(message, { currentUserId: ME, chatType: "group", members, isSavedChat: false });
}

test("a reader's heartbeat is not a different receipt", () => {
  const before = receipt([member(ME, SENT), member(ANYA, LATER), member(BORIS, null)]);
  const after = receipt([member(ME, SENT), member(ANYA, LATER, LATER), member(BORIS, null, LATER)]);
  assert.notDeepEqual(before, after, "the premise: the profiles really did change");
  assert.equal(sameGroupReadReceiptFace(before, after), true);
});

test("a read mark that moves on past a message already read is not a different receipt", () => {
  // The mark is the member's, not the message's: one read moves it for every
  // message that reader had read, and none of those bubbles draws anything new.
  const before = receipt([member(ME, SENT), member(ANYA, LATER), member(BORIS, null)]);
  const after = receipt([member(ME, SENT), member(ANYA, "2026-09-11T10:06:00.000Z"), member(BORIS, null)]);
  assert.notDeepEqual(before, after, "the premise: the mark really did move");
  assert.equal(sameGroupReadReceiptFace(before, after), true);
});

test("a new reader is a different receipt", () => {
  const before = receipt([member(ME, SENT), member(ANYA, LATER), member(BORIS, null)]);
  const after = receipt([member(ME, SENT), member(ANYA, LATER), member(BORIS, LATER)]);
  assert.equal(sameGroupReadReceiptFace(before, after), false);
});

test("the same count of different people is a different receipt", () => {
  const before = receipt([member(ME, SENT), member(ANYA, LATER), member(BORIS, null)]);
  const after = receipt([member(ME, SENT), member(ANYA, null), member(BORIS, LATER)]);
  assert.equal(before?.readCount, after?.readCount, "the premise: one reader each");
  assert.equal(sameGroupReadReceiptFace(before, after), false);
});

test("a change in who is counted is a different receipt", () => {
  const before = receipt([member(ME, SENT), member(ANYA, LATER)]);
  const after = receipt([member(ME, SENT), member(ANYA, LATER), member(BORIS, null)]);
  assert.equal(before?.allRead, true);
  assert.equal(after?.allRead, false);
  assert.equal(sameGroupReadReceiptFace(before, after), false);
});

test("no receipt is the same as no receipt, and not the same as one", () => {
  const some = receipt([member(ME, SENT), member(ANYA, LATER)]);
  assert.equal(sameGroupReadReceiptFace(null, undefined), true);
  assert.equal(sameGroupReadReceiptFace(null, some), false);
  assert.equal(sameGroupReadReceiptFace(some, null), false);
});
