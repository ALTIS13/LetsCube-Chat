import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_VARIANT_POLL_INTERVAL_MS,
  MESSAGE_VARIANT_POLL_MAX_INTERVAL_MS,
  MESSAGE_VARIANT_POLL_UNCHANGED_LIMIT,
  collectSettledMessageVariantKinds,
  decideMessageVariantPoll,
  getExpectedMessageVariantKindsByMessage,
  getMessageVariantRowsSignature,
  hasNewMessageVariantWork,
  hasOutstandingMessageVariants,
  type MessageVariantRow,
  type MessageVariantSource,
} from "../../artifacts/kub/src/lib/messageVariantRefresh.ts";

function videoMessage(id: string): MessageVariantSource {
  return { id, chat_id: "chat-1", type: "video", media_url: "https://media.example/" + id + ".mp4", deleted_at: null };
}

function imageMessage(id: string): MessageVariantSource {
  return { id, chat_id: "chat-1", type: "image", media_url: "https://media.example/" + id + ".jpg", deleted_at: null };
}

function row(
  overrides: Partial<MessageVariantRow> & Pick<MessageVariantRow, "message_id" | "variant_kind">,
): MessageVariantRow {
  return {
    status: "ready",
    error_code: null,
    updated_at: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

/** One video whose poster and 720p are both ready — the shape a chat reaches within seconds. */
function settledVideoAnswer(messageId: string): MessageVariantRow[] {
  return [
    row({ message_id: messageId, variant_kind: "video_poster" }),
    row({ message_id: messageId, variant_kind: "video_720p" }),
  ];
}

test("a chat whose variants are all accounted for stops polling", () => {
  // The rule that matters. This is the state a conversation reaches shortly
  // after a video is sent, and the state it used to keep querying from once a
  // minute for the rest of the day (D-176).
  const expected = getExpectedMessageVariantKindsByMessage([videoMessage("m-1"), imageMessage("m-2")]);
  const settled = collectSettledMessageVariantKinds([
    ...settledVideoAnswer("m-1"),
    row({ message_id: "m-2", variant_kind: "image_thumb" }),
    row({ message_id: "m-2", variant_kind: "image_preview" }),
  ]);

  assert.equal(hasOutstandingMessageVariants(expected, settled), false);
  assert.deepEqual(decideMessageVariantPoll({ expected, settled, unchangedPolls: 0 }), {
    poll: false,
    intervalMs: 0,
    reason: "settled",
  });
});

test("a transcode that has not landed keeps the poll running", () => {
  const expected = getExpectedMessageVariantKindsByMessage([videoMessage("m-1")]);
  const settled = collectSettledMessageVariantKinds([row({ message_id: "m-1", variant_kind: "video_poster" })]);

  assert.equal(hasOutstandingMessageVariants(expected, settled), true);
  assert.deepEqual(decideMessageVariantPoll({ expected, settled, unchangedPolls: 0 }), {
    poll: true,
    intervalMs: MESSAGE_VARIANT_POLL_INTERVAL_MS,
    reason: "outstanding",
  });
});

test("a variant nothing will ever write counts as settled, a retryable failure does not", () => {
  const expected = getExpectedMessageVariantKindsByMessage([videoMessage("m-1")]);
  const terminal = collectSettledMessageVariantKinds([
    row({ message_id: "m-1", variant_kind: "video_poster" }),
    row({ message_id: "m-1", variant_kind: "video_720p", status: "failed", error_code: "source_unreadable" }),
  ]);
  // The worker attempts this one again, so the client is right to keep waiting.
  const retryable = collectSettledMessageVariantKinds([
    row({ message_id: "m-1", variant_kind: "video_poster" }),
    row({ message_id: "m-1", variant_kind: "video_720p", status: "failed", error_code: "etimedout" }),
  ]);
  // A row being remade is still owed.
  const stale = collectSettledMessageVariantKinds([
    row({ message_id: "m-1", variant_kind: "video_poster" }),
    row({ message_id: "m-1", variant_kind: "video_720p", status: "stale" }),
  ]);

  assert.equal(decideMessageVariantPoll({ expected, settled: terminal, unchangedPolls: 0 }).reason, "settled");
  assert.equal(decideMessageVariantPoll({ expected, settled: retryable, unchangedPolls: 0 }).reason, "outstanding");
  assert.equal(decideMessageVariantPoll({ expected, settled: stale, unchangedPolls: 0 }).reason, "outstanding");
});

test("polls that change nothing back off and then stop", () => {
  const expected = getExpectedMessageVariantKindsByMessage([videoMessage("m-1")]);
  const settled = collectSettledMessageVariantKinds([row({ message_id: "m-1", variant_kind: "video_poster" })]);
  const paces: number[] = [];
  for (let unchangedPolls = 0; unchangedPolls < MESSAGE_VARIANT_POLL_UNCHANGED_LIMIT; unchangedPolls += 1) {
    const decision = decideMessageVariantPoll({ expected, settled, unchangedPolls });
    assert.equal(decision.poll, true, "poll " + unchangedPolls + " must still run");
    paces.push(decision.intervalMs);
  }

  // A minute while the answer might still be quick, then doubling to a
  // five-minute ceiling: twenty-four minutes of patience in eight queries,
  // which clears the worker's ten-minute transcode timeout twice over.
  assert.deepEqual(paces, [60_000, 60_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  assert.equal(paces[paces.length - 1], MESSAGE_VARIANT_POLL_MAX_INTERVAL_MS);
  assert.equal(paces.reduce((total, pace) => total + pace, 0), 24 * 60_000);

  assert.deepEqual(
    decideMessageVariantPoll({ expected, settled, unchangedPolls: MESSAGE_VARIANT_POLL_UNCHANGED_LIMIT }),
    { poll: false, intervalMs: 0, reason: "unchanged" },
  );
});

test("a message that arrives after the poll gave up starts it again", () => {
  const before = getExpectedMessageVariantKindsByMessage([videoMessage("m-1")]);
  const after = getExpectedMessageVariantKindsByMessage([videoMessage("m-1"), videoMessage("m-2")]);
  const settled = collectSettledMessageVariantKinds(settledVideoAnswer("m-1"));

  // Where it had stopped: everything on screen was accounted for.
  assert.equal(decideMessageVariantPoll({ expected: before, settled, unchangedPolls: 0 }).reason, "settled");
  // The new video is outstanding, so the rule asks again on its own.
  assert.equal(decideMessageVariantPoll({ expected: after, settled, unchangedPolls: 0 }).reason, "outstanding");

  // Had it stopped on the bound instead, outstanding work alone is not enough:
  // the count of futile polls describes the old set and has to be handed back,
  // which is what the caller uses this second rule for.
  assert.equal(
    decideMessageVariantPoll({ expected: after, settled, unchangedPolls: MESSAGE_VARIANT_POLL_UNCHANGED_LIMIT }).reason,
    "unchanged",
  );
  assert.equal(hasNewMessageVariantWork(before, after), true);
  assert.equal(
    decideMessageVariantPoll({ expected: after, settled, unchangedPolls: 0 }).poll,
    true,
    "with the count handed back the poll runs again",
  );
});

test("a message leaving the window is not new work", () => {
  const before = getExpectedMessageVariantKindsByMessage([videoMessage("m-1"), videoMessage("m-2")]);
  const after = getExpectedMessageVariantKindsByMessage([videoMessage("m-2")]);

  // Fewer messages can only lower what is outstanding, so handing the patience
  // back for this would let a conversation being scrolled poll for ever.
  assert.equal(hasNewMessageVariantWork(before, after), false);
  assert.equal(hasNewMessageVariantWork(after, after), false);
  // Scrolling up is new work: older media has variants of its own to wait for.
  assert.equal(hasNewMessageVariantWork(after, before), true);
});

test("only the messages the worker makes variants for are waited for", () => {
  const expected = getExpectedMessageVariantKindsByMessage([
    videoMessage("m-1"),
    imageMessage("m-2"),
    { id: "m-3", chat_id: "chat-1", type: "text", media_url: null, deleted_at: null },
    { id: "tmp:m-4", chat_id: "chat-1", type: "video", media_url: "blob:local", deleted_at: null },
    {
      id: "m-5",
      chat_id: "chat-1",
      type: "image",
      media_url: "https://media.example/gone.jpg",
      deleted_at: "2026-09-12T10:00:00.000Z",
    },
    { id: "m-6", chat_id: "chat-1", type: "video", media_url: null, deleted_at: null },
  ]);

  assert.deepEqual(Array.from(expected.keys()), ["m-1", "m-2"]);
  assert.deepEqual(expected.get("m-1"), ["video_poster", "video_720p"]);
  assert.deepEqual(expected.get("m-2"), ["image_thumb", "image_preview"]);
});

test("an answer is told from the one before it by what the rows say, not by their order", () => {
  const first = settledVideoAnswer("m-1");
  const reordered = [first[1], first[0]];
  assert.equal(getMessageVariantRowsSignature(first), getMessageVariantRowsSignature(reordered));

  // A rewritten variant keeps its path, so only `updated_at` moves; without it
  // in the signature a poll that did deliver something would count as futile.
  const rewritten = [first[0], { ...first[1], updated_at: "2026-09-13T10:05:00.000Z" }];
  assert.notEqual(getMessageVariantRowsSignature(first), getMessageVariantRowsSignature(rewritten));

  const arrived = [...first, row({ message_id: "m-2", variant_kind: "image_thumb" })];
  assert.notEqual(getMessageVariantRowsSignature(first), getMessageVariantRowsSignature(arrived));
  assert.equal(getMessageVariantRowsSignature([]), "");
});
