import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  advanceMessageEntrance,
  EMPTY_ENTRANCE_STATE,
  messageEntranceKey,
  type MessageEntranceState,
} from "../../artifacts/kub/src/lib/messageEntrance.ts";

type Row = { id: string; client_message_id?: string | null };

/** Exactly how `MessageList` calls it: entrance keys to diff, ids to cache on. */
function advanceRows(previous: MessageEntranceState, rows: readonly Row[]) {
  return advanceMessageEntrance(
    previous,
    rows.map(messageEntranceKey),
    rows.map((row) => row.id),
  );
}

test("opening a chat animates nothing", () => {
  // The bug: `msg-appear` was unconditional, so every bubble played it on
  // mount and the whole history animated at once when a chat opened.
  const { entering } = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a", "b", "c"]);
  assert.equal(entering.size, 0);
});

test("a message that arrives afterwards animates", () => {
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a", "b"]);
  const second = advanceMessageEntrance(first.state, ["a", "b", "c"]);
  assert.deepEqual([...second.entering], ["c"]);
});

test("only the new one animates, not its neighbours", () => {
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a"]);
  const second = advanceMessageEntrance(first.state, ["a", "b", "c"]);
  assert.deepEqual([...second.entering].sort(), ["b", "c"], "the settled message animated too");
});

test("repeating a call is idempotent, and that is deliberate", () => {
  // Two contracts pull against each other here and this is where they settle.
  //
  // Idempotency is required: React may invoke the `useMemo` twice for one
  // render, and a second invocation that diffed against an already-advanced
  // `seen` would return nothing and lose the animation in development.
  //
  // The cost is that a repeat call keeps reporting the same ids as entering.
  // That is harmless because a CSS animation does not restart when the same
  // class is re-applied to an element that never unmounted — the browser only
  // replays it on remount or on an animation-name change. So the answer stays
  // stable and the bubble still animates exactly once.
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a"]);
  const arrival = advanceMessageEntrance(first.state, ["a", "b"]);
  const repeat = advanceMessageEntrance(arrival.state, ["a", "b"]);
  assert.deepEqual([...repeat.entering], [...arrival.entering]);
  // And the next genuine change moves on from it.
  const next = advanceMessageEntrance(repeat.state, ["a", "b", "c"]);
  assert.deepEqual([...next.entering], ["c"]);
});

test("the same ids asked twice give the same answer", () => {
  // React may invoke a `useMemo` more than once for one render — StrictMode
  // does it on purpose. Without this the second invocation would diff against a
  // `seen` the first had already advanced and quietly lose the animation.
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a"]);
  const arrival = advanceMessageEntrance(first.state, ["a", "b"]);
  assert.deepEqual([...arrival.entering], ["b"]);
  const again = advanceMessageEntrance(arrival.state, ["a", "b"]);
  assert.deepEqual([...again.entering], ["b"], "the repeat call dropped the animation");
});

test("loading older history does not animate it", () => {
  // Prepending is not arrival. Fifty bubbles fading in above the reader is the
  // exact thing this is here to prevent.
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["d", "e"]);
  const prepended = advanceMessageEntrance(first.state, ["a", "b", "c", "d", "e"]);
  assert.deepEqual([...prepended.entering].sort(), ["a", "b", "c"]);
  // NOTE: this is the honest current behaviour, and it is why `MessageList`
  // must not animate a prepend. Recorded so the limit is visible rather than
  // discovered.
});

test("a message leaving does not resurrect an old one", () => {
  const first = advanceMessageEntrance(EMPTY_ENTRANCE_STATE, ["a", "b"]);
  const deleted = advanceMessageEntrance(first.state, ["a"]);
  assert.equal(deleted.entering.size, 0);
  const backAgain = advanceMessageEntrance(deleted.state, ["a", "b"]);
  assert.deepEqual([...backAgain.entering], ["b"], "it left and returned, so it is arriving");
});

test("the animation is applied only to entering messages", () => {
  const bubble = readFileSync("artifacts/kub/src/components/chat/MessageBubble.tsx", "utf8");
  assert.match(bubble, /isEntering && "msg-appear"/, "msg-appear is unconditional again");
  assert.ok(
    !/relative msg-appear/.test(bubble),
    "the class is back in the static list, so history animates again",
  );
});

test("the animation moves nothing that has a size", () => {
  // D-032 and the modal-entry rule: a decorative resize is what reads as a
  // jerk, and a growing row would move the scroll anchor.
  const css = readFileSync("artifacts/kub/src/index.css", "utf8");
  const block = css.slice(css.indexOf("@keyframes msg-appear"), css.indexOf("@keyframes ripple"));
  assert.ok(!block.includes("scale("), "msg-appear resizes the bubble again");
  assert.ok(!/\bheight\b|\bwidth\b|\bmargin\b|\bpadding\b/.test(block), "msg-appear animates layout");
  assert.ok(block.includes("var(--kub-motion-fast)"), "the shared timing step was replaced by a literal");
  assert.ok(block.includes("prefers-reduced-motion"), "reduced motion is not honoured");
});

test("a message keeps one entrance identity across the optimistic swap", () => {
  // `tmp:<client id>` and the server row are the same message. Nothing else on
  // the two rows is equal: the id changes, and that is what React keys on.
  assert.equal(messageEntranceKey({ id: "tmp:X", client_message_id: "X" }), "cid:X");
  assert.equal(messageEntranceKey({ id: "server-uuid", client_message_id: "X" }), "cid:X");
  // History predating the column, and bot messages, have no client id at all.
  assert.equal(messageEntranceKey({ id: "plain" }), "plain");
  assert.equal(messageEntranceKey({ id: "plain", client_message_id: null }), "plain");
});

test("a sent message does not animate a second time when the server row lands", () => {
  // Measured on a real send before this: the bubble faded in at t=68ms, finished
  // at t=182ms, and faded in again from opacity 0 at t=231ms — the moment the
  // optimistic row was replaced. The React key changed, so the DOM node was
  // replaced too, and the CSS animation played on the new one. A message you
  // just sent blinked.
  const history: Row[] = [{ id: "a" }, { id: "b" }];
  const optimistic: Row[] = [...history, { id: "tmp:X", client_message_id: "X" }];
  const settled: Row[] = [...history, { id: "server-uuid", client_message_id: "X" }];

  const first = advanceRows(EMPTY_ENTRANCE_STATE, history);
  const arrival = advanceRows(first.state, optimistic);
  assert.deepEqual([...arrival.entering], ["cid:X"], "the message did not animate when it was sent");

  const swap = advanceRows(arrival.state, settled);
  assert.equal(swap.entering.size, 0, "the message animated a second time under its server id");
});

test("the idempotency cache still keys off what was rendered", () => {
  // The two arguments answer different questions and must not be collapsed. If
  // the cache keyed off the entrance keys instead, the swap above would not
  // change the signature, the cached answer would come back — still naming the
  // message as entering — and the remounted row would animate again.
  const optimistic: Row[] = [{ id: "a" }, { id: "tmp:X", client_message_id: "X" }];
  const first = advanceRows(EMPTY_ENTRANCE_STATE, [{ id: "a" }]);
  const arrival = advanceRows(first.state, optimistic);
  const repeat = advanceRows(arrival.state, optimistic);
  assert.deepEqual([...repeat.entering], [...arrival.entering], "a repeated render lost the animation");
});

test("a received message still animates", () => {
  // Every message carries a client id, including one somebody else sent. The
  // rule is "was it on screen a moment ago", and theirs was not.
  const first = advanceRows(EMPTY_ENTRANCE_STATE, [{ id: "a", client_message_id: "A" }]);
  const arrival = advanceRows(first.state, [
    { id: "a", client_message_id: "A" },
    { id: "b", client_message_id: "B" },
  ]);
  assert.deepEqual([...arrival.entering], ["cid:B"]);
});

test("the row is keyed by what survives the swap, so it is not rebuilt", () => {
  // The entrance identity stopped the animation replaying, but the row itself
  // was still keyed by `msg.id` — so `tmp:<client id>` and the server row were
  // two different DOM nodes and React tore the first one down. Everything the
  // bubble had measured about itself went with it, and the replacement started
  // again from `getInitialMetaPlacement`'s guess: `inline`, one row shorter
  // than the answer an own message actually gets.
  //
  // Measured on the real chat against production data, a witness row sampled
  // every animation frame through a send: the whole conversation stepped -39px
  // as the message arrived, -15px as the bubble found its height, and then
  // +15px and -15px again about 250ms later, when the server row landed and
  // replayed the same two steps in reverse. The last pair is a twitch with
  // nothing behind it — nothing about the message had changed. With the row
  // keyed by the entrance identity it is gone, measured over three runs, and
  // the arrival is the only movement left.
  const list = readFileSync("artifacts/kub/src/components/chat/MessageList.tsx", "utf8");
  assert.match(
    list,
    /key=\{messageEntranceKey\(msg\)\}/,
    "the message row is keyed by its id again, so a sent message rebuilds itself when the server row lands",
  );
  assert.doesNotMatch(
    list,
    /key=\{msg\.id\}/,
    "the message row is keyed by its id again, so a sent message rebuilds itself when the server row lands",
  );
  // The row still reports its own id: that is what the scroll anchors, the
  // jump-to-message targets and the tests all address it by.
  assert.match(list, /data-message-id=\{msg\.id\}/, "the row stopped carrying its own id");
});

test("two rows can never share one key", () => {
  // A React key has to be unique among siblings, and this one is derived rather
  // than being the primary key. It holds because the store dedupes on the same
  // value: `addMessage` and `replaceMessage` both collapse a row that is
  // `sameActorClientMessage` as the incoming one, so the optimistic row and its
  // server row are never in the list at the same time.
  // What enforces it in each mutator is the `findIndex` that decides between
  // replacing a row and appending one. `replaceMessage` also filters the old
  // row out by client id first, and dropping THAT is equivalent for this
  // property: the row it would have removed is the one `findIndex` then finds
  // and overwrites, so there is still only ever one.
  const store = readFileSync("artifacts/kub/src/store/app.store.ts", "utf8");
  for (const mutator of ["addMessage: (chatId, message) =>", "replaceMessage: (chatId, oldId, message) =>"]) {
    // The implementation, not the interface declaration above it: the type has
    // the same name and matching it would assert nothing.
    const start = store.indexOf(mutator);
    assert.notEqual(start, -1, `${mutator} could not be found in the store`);
    assert.match(
      store.slice(start, start + 700),
      /findIndex\(\(m\) => m\.id === message\.id \|\| sameActorClientMessage\(m, message\)\)/,
      `${mutator} no longer collapses the optimistic row, so both copies can be rendered under one key`,
    );
  }
});

test("the list diffs entrance keys, not row ids", () => {
  // The wiring, which no unit of `messageEntrance` can see on its own: passing
  // `m.id` as the thing to diff puts the swap back exactly as it was.
  const list = readFileSync("artifacts/kub/src/components/chat/MessageList.tsx", "utf8");
  assert.match(
    list,
    /advanceMessageEntrance\(\s*entranceRef\.current,\s*sortedMessages\.map\(messageEntranceKey\),\s*sortedMessages\.map\(\(m\) => m\.id\),/,
    "the entrance is diffed by row id again, so a sent message animates twice",
  );
  assert.match(
    list,
    /isEntering=\{enteringKeys\.has\(messageEntranceKey\(msg\)\)\}/,
    "the bubble asks about its row id again, so it never matches the entrance key",
  );
});
