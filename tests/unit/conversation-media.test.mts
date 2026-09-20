import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationMediaIndex,
  conversationMediaRows,
  isConversationMediaRow,
  type ConversationMediaRow,
} from "../../artifacts/kub/src/lib/conversationMedia.ts";
import {
  mediaPositionLabel,
  mediaStepOffered,
  planMediaStep,
  type MediaSequenceState,
} from "../../artifacts/kub/src/lib/sharedMediaBrowsing.ts";

/**
 * D-288. The conversation's own pictures, as a sequence the viewer can walk.
 *
 * The tester could open one photograph from a chat and nothing else: «я не могу
 * влево-вправо свайп сделать и те же 2 отправленные фото сравнить».
 *
 * Every row here is invented. Nothing in this file names a real chat, a real
 * person or a real file.
 */

let nextId = 0;
function row(partial: Partial<ConversationMediaRow> = {}): ConversationMediaRow {
  nextId += 1;
  return { id: `m${nextId}`, type: "image", media_url: "https://example.invalid/p.webp", ...partial };
}

function sequence(partial: Partial<MediaSequenceState> = {}): MediaSequenceState {
  return { index: 0, loaded: 3, total: 3, totalExact: true, hasMore: false, ...partial };
}

// ---------------------------------------------------------------------------
// What counts as one of the conversation's pictures
// ---------------------------------------------------------------------------

test("a photograph and a video are in the sequence; nothing else is", () => {
  assert.equal(isConversationMediaRow(row({ type: "image" })), true);
  assert.equal(isConversationMediaRow(row({ type: "video" })), true);
  assert.equal(isConversationMediaRow(row({ type: "audio" })), false);
  assert.equal(isConversationMediaRow(row({ type: "file" })), false);
  assert.equal(isConversationMediaRow(row({ type: "text", media_url: null })), false);
  assert.equal(isConversationMediaRow(row({ type: "system" })), false);
});

test("a row with no address is not in the sequence, whatever its type says", () => {
  // A message still uploading has the type before it has the file. Counting it
  // would make «3 из 7» promise a picture the viewer cannot show.
  assert.equal(isConversationMediaRow(row({ type: "image", media_url: null })), false);
  assert.equal(isConversationMediaRow(row({ type: "video", media_url: "" })), false);
});

test("a deleted message is not in the sequence", () => {
  // A private chat filters these out before the list ever sees them; a group
  // keeps a placeholder bubble, and a placeholder has no picture to open.
  assert.equal(isConversationMediaRow(row({ deleted_at: "2026-09-20T10:00:00Z" })), false);
});

test("the conversation's order is kept, never re-sorted", () => {
  const a = row({ id: "a" });
  const text = row({ id: "t", type: "text", media_url: null });
  const b = row({ id: "b", type: "video" });
  const c = row({ id: "c" });
  const rows = conversationMediaRows([a, text, b, c]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"]);
  // Literally the caller's order: `useMessages` hands its pages over
  // oldest-first, and re-sorting here would hide a paging fault rather than
  // show it.
  const reversed = conversationMediaRows([c, b, a]);
  assert.deepEqual(reversed.map((r) => r.id), ["c", "b", "a"]);
});

test("a conversation with no media yields an empty sequence rather than throwing", () => {
  assert.deepEqual(conversationMediaRows([]), []);
  assert.deepEqual(conversationMediaRows([row({ type: "text", media_url: null })]), []);
});

// ---------------------------------------------------------------------------
// Where the open picture stands, and why it is held by id
// ---------------------------------------------------------------------------

test("the position is found by id", () => {
  const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
  assert.equal(conversationMediaIndex(rows, "a"), 0);
  assert.equal(conversationMediaIndex(rows, "b"), 1);
  assert.equal(conversationMediaIndex(rows, "c"), 2);
});

test("an id that is not there, and no id at all, both answer null", () => {
  const rows = [row({ id: "a" })];
  assert.equal(conversationMediaIndex(rows, "gone"), null);
  assert.equal(conversationMediaIndex(rows, null), null);
  assert.equal(conversationMediaIndex(rows, undefined), null);
  assert.equal(conversationMediaIndex(rows, ""), null);
  // Zero is a real position, so `null` and `0` must stay distinguishable: a
  // falsy check here would close the viewer on the oldest picture.
  assert.notEqual(conversationMediaIndex(rows, "a"), null);
});

test("a page of older history shifts every index, and the id does not", () => {
  // The defect an index would have: history lands at the FRONT of a
  // conversation, so the number that meant «the second picture» before the
  // prepend means «a different picture» after it.
  const before = [row({ id: "a" }), row({ id: "b" })];
  assert.equal(conversationMediaIndex(before, "b"), 1);
  const after = [row({ id: "old1" }), row({ id: "old2" }), ...before];
  assert.equal(conversationMediaIndex(after, "b"), 3);
  assert.notEqual(after[1].id, "b");
});

// ---------------------------------------------------------------------------
// Stepping when the unloaded ones are at the OLD end
// ---------------------------------------------------------------------------

test("without `moreAt` the grid's answers are exactly what they were", () => {
  // The default is `"end"`, so the shared-media sub-view, which never heard of
  // this field, cannot have changed behaviour.
  const end = sequence({ index: 2, loaded: 3, hasMore: true, totalExact: false });
  assert.deepEqual(planMediaStep(end, 1), { kind: "load" });
  assert.equal(mediaStepOffered(end, 1), true);
  const start = sequence({ index: 0, loaded: 3, hasMore: true, totalExact: false });
  assert.deepEqual(planMediaStep(start, -1), { kind: "none" });
  assert.equal(mediaStepOffered(start, -1), false);
});

test("in a conversation, a step back off the oldest loaded picture loads history", () => {
  const oldest = sequence({ index: 0, loaded: 3, hasMore: true, totalExact: false, moreAt: "start" });
  assert.deepEqual(planMediaStep(oldest, -1), { kind: "load" });
  assert.equal(mediaStepOffered(oldest, -1), true);
});

test("in a conversation, the newest picture is the end and says so", () => {
  // The forward end is the bottom of the conversation. There is nothing beyond
  // it to fetch, however much history is unread behind the reader.
  const newest = sequence({ index: 2, loaded: 3, hasMore: true, totalExact: false, moreAt: "start" });
  assert.deepEqual(planMediaStep(newest, 1), { kind: "none" });
  assert.equal(mediaStepOffered(newest, 1), false);
});

test("a step back is refused while a page is already in flight, but the control stays", () => {
  const waiting = sequence({
    index: 0, loaded: 3, hasMore: true, totalExact: false, moreAt: "start", loading: true,
  });
  assert.deepEqual(planMediaStep(waiting, -1), { kind: "none" });
  // Offered, not planned: a control that vanishes for the second a request
  // takes is a control that moves under the finger reaching for it.
  assert.equal(mediaStepOffered(waiting, -1), true);
});

test("with the whole history loaded, the oldest picture is a wall", () => {
  const oldest = sequence({ index: 0, loaded: 3, hasMore: false, moreAt: "start" });
  assert.deepEqual(planMediaStep(oldest, -1), { kind: "none" });
  assert.equal(mediaStepOffered(oldest, -1), false);
});

test("moving between loaded pictures is unaffected by which end holds the rest", () => {
  for (const moreAt of ["start", "end"] as const) {
    const middle = sequence({ index: 1, loaded: 3, hasMore: true, totalExact: false, moreAt });
    assert.deepEqual(planMediaStep(middle, -1), { kind: "move", index: 0 });
    assert.deepEqual(planMediaStep(middle, 1), { kind: "move", index: 2 });
  }
});

// ---------------------------------------------------------------------------
// What the label is allowed to claim
// ---------------------------------------------------------------------------

test("the label hedges while history is unread, and stops hedging when it is not", () => {
  // This surface counts what it has loaded, not what the chat holds. «7» would
  // be a claim it has not read; «7+» is the hedge the counted rows already use.
  assert.equal(
    mediaPositionLabel(sequence({ index: 2, loaded: 7, total: 7, totalExact: false, hasMore: true, moreAt: "start" })),
    "3 из 7+",
  );
  assert.equal(
    mediaPositionLabel(sequence({ index: 2, loaded: 7, total: 7, totalExact: true, hasMore: false, moreAt: "start" })),
    "3 из 7",
  );
});

test("the wording is «N из M», which is what Telegram draws", () => {
  // Measured on the device, 2026-09-20: opening a picture from a feed there
  // reads «237 из 244». Same words, same order, same separator.
  const label = mediaPositionLabel(sequence({ index: 236, loaded: 244, total: 244, totalExact: true }));
  assert.equal(label, "237 из 244");
});
