import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelAllOutgoing,
  cancelOutgoing,
  forgetOutgoing,
  holdOutgoingAbort,
  isOutgoingCancelled,
  outgoingEntry,
  outgoingTempId,
  releaseOutgoingAbort,
  rememberOutgoing,
  type OutgoingMediaEntry,
} from "../../artifacts/kub/src/lib/outgoingMedia.ts";
import type { StagedAttachment } from "../../artifacts/kub/src/lib/stagedAttachments.ts";

// D-314's Telegram half: an attachment on its way belongs to the application,
// so a view that did not start the send can still stop it or send it again.

function entry(id: string): OutgoingMediaEntry {
  const attachment = { id: `att-${id}`, clientMessageId: `client-${id}` } as unknown as StagedAttachment;
  return {
    tempId: outgoingTempId(attachment.clientMessageId),
    chatId: "chat-1",
    topicId: null,
    replyToId: null,
    caption: null,
    attachment,
    clientSentAt: "2026-09-28T10:00:00.000Z",
  };
}

test("a placeholder's id is the one its row is matched by", () => {
  assert.equal(outgoingTempId("abc"), "tmp:abc");
});

test("an entry is held until the row is in, and then forgotten", () => {
  const one = entry("a");
  rememberOutgoing(one);
  assert.equal(outgoingEntry(one.tempId), one);
  assert.equal(forgetOutgoing(one.tempId), one);
  assert.equal(outgoingEntry(one.tempId), null);
  assert.equal(forgetOutgoing(one.tempId), null, "forgetting twice is not an error");
});

test("cancelling stops the upload once, marks it, and lets it be sent again later", () => {
  const one = entry("b");
  rememberOutgoing(one);
  let stopped = 0;
  holdOutgoingAbort(one.attachment.id, () => {
    stopped += 1;
  });
  assert.equal(cancelOutgoing(one.tempId), one);
  assert.equal(stopped, 1);
  assert.equal(isOutgoingCancelled(one.attachment.id), true, "a late upload must not insert a row");
  assert.equal(cancelOutgoing(one.tempId), null, "nothing left to cancel");
  assert.equal(stopped, 1);

  rememberOutgoing(one);
  assert.equal(isOutgoingCancelled(one.attachment.id), false, "sending it again clears the mark");
  forgetOutgoing(one.tempId);
});

test("a stop that throws still leaves the upload cancelled", () => {
  const one = entry("c");
  rememberOutgoing(one);
  holdOutgoingAbort(one.attachment.id, () => {
    throw new Error("transport");
  });
  assert.equal(cancelOutgoing(one.tempId), one);
  assert.equal(isOutgoingCancelled(one.attachment.id), true);
});

test("only the upload that registered a stop can release it", () => {
  const one = entry("d");
  rememberOutgoing(one);
  let first = 0;
  let second = 0;
  const firstAbort = () => {
    first += 1;
  };
  const secondAbort = () => {
    second += 1;
  };
  holdOutgoingAbort(one.attachment.id, firstAbort);
  holdOutgoingAbort(one.attachment.id, secondAbort);
  releaseOutgoingAbort(one.attachment.id, firstAbort);
  cancelOutgoing(one.tempId);
  assert.deepEqual([first, second], [0, 1], "a retry's upload is the one stopped, not the finished one");
});

test("an account change cancels every send of the account that left", () => {
  const one = entry("e");
  const two = entry("f");
  rememberOutgoing(one);
  rememberOutgoing(two);
  const cancelledNow = cancelAllOutgoing();
  assert.deepEqual(cancelledNow.map((item) => item.tempId).sort(), [one.tempId, two.tempId].sort());
  assert.equal(outgoingEntry(one.tempId), null);
  assert.equal(isOutgoingCancelled(two.attachment.id), true);
});
