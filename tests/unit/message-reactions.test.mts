import assert from "node:assert/strict";
import test from "node:test";

import {
  QUICK_REACTION,
  applyReactionPlan,
  groupReactions,
  leadingReactionEmoji,
  myReaction,
  parseReactionRows,
  planReactionToggle,
  reactionCountLabel,
  type ReactionRowLike,
} from "../../artifacts/kub/src/lib/messageReactions.ts";

test("the reactions set_message_reaction returns are taken as they are, and anything else is refused", () => {
  const rows = [
    { id: "r1", message_id: "m1", user_id: "anya", emoji: "👍", created_at: "2026-09-11T09:00:00.123456+00:00" },
    { id: "r2", message_id: "m1", user_id: "me", emoji: "❤️", created_at: "2026-09-11T09:01:00+00:00" },
  ];
  assert.deepEqual(parseReactionRows(rows), rows);
  assert.deepEqual(parseReactionRows([]), []);
  assert.equal(parseReactionRows(null), null);
  assert.equal(parseReactionRows({ id: "r1" }), null, "a single object is not the set of rows");
  assert.equal(parseReactionRows([{ ...rows[0], emoji: 5 }]), null);
});
import {
  DEFAULT_QUICK_REACTIONS,
  parseRecentReactions,
  quickReactionRow,
  rankRecentReactions,
  recordReactionUse,
} from "../../artifacts/kub/src/lib/recentReactions.ts";
import { PUBLIC_APP_ORIGIN, messageLink } from "../../artifacts/kub/src/lib/messageLink.ts";

/**
 * One reaction per person, as decided on 2026-09-11, and the two small rules
 * that travel with it: the quick row beside ❤️, and the link that opens one
 * message.
 */

const ME = "me";
const row = (id: string, user: string, emoji: string): ReactionRowLike => ({
  id,
  message_id: "m1",
  user_id: user,
  emoji,
  created_at: "2026-09-11T09:00:00.000Z",
});

test("choosing a reaction when you have none adds it", () => {
  assert.deepEqual(planReactionToggle([row("a", "anya", "👍")], ME, "❤️"), { remove: [], add: "❤️" });
});

test("choosing another reaction replaces yours", () => {
  const plan = planReactionToggle([row("a", ME, "👍"), row("b", "anya", "❤️")], ME, "❤️");
  assert.deepEqual(plan, { remove: ["a"], add: "❤️" });
  const next = applyReactionPlan([row("a", ME, "👍"), row("b", "anya", "❤️")], ME, plan, {
    messageId: "m1",
    createdAt: "2026-09-11T09:01:00.000Z",
  });
  assert.deepEqual(next.map((reaction) => [reaction.user_id, reaction.emoji]), [["anya", "❤️"], [ME, "❤️"]]);
});

test("choosing yours again removes it", () => {
  const plan = planReactionToggle([row("a", ME, "❤️")], ME, "❤️");
  assert.deepEqual(plan, { remove: ["a"], add: null });
  assert.deepEqual(applyReactionPlan([row("a", ME, "❤️")], ME, plan, { messageId: "m1", createdAt: "x" }), []);
});

test("a second row the database let through is cleared by the next choice, not kept beside it", () => {
  // The rule lives in the client until a constraint exists, so two racing
  // clients can leave two rows. Whatever is chosen next, only one survives.
  const plan = planReactionToggle([row("a", ME, "👍"), row("b", ME, "🔥")], ME, "😂");
  assert.deepEqual(plan, { remove: ["a", "b"], add: "😂" });
  const again = planReactionToggle([row("a", ME, "👍"), row("b", ME, "🔥")], ME, "🔥");
  assert.deepEqual(again, { remove: ["a", "b"], add: null });
});

test("nobody else's reaction is ever touched", () => {
  const plan = planReactionToggle([row("a", "anya", "❤️"), row("b", "boris", "👍")], ME, "❤️");
  assert.deepEqual(plan.remove, []);
});

test("groups keep arrival order and know which one is yours", () => {
  const groups = groupReactions(
    [row("a", "anya", "👍"), row("b", ME, "❤️"), row("c", "boris", "👍")],
    ME,
  );
  assert.deepEqual(groups, [
    { emoji: "👍", count: 2, mine: false, userIds: ["anya", "boris"] },
    { emoji: "❤️", count: 1, mine: true, userIds: [ME] },
  ]);
  assert.equal(myReaction([row("a", "anya", "👍"), row("b", ME, "❤️")], ME), "❤️");
  assert.equal(myReaction([row("a", "anya", "👍")], ME), null);
  assert.equal(myReaction([row("a", ME, "👍")], null), null);
});

test("the header names the most used emoji first, ties in arrival order", () => {
  const groups = groupReactions(
    [row("a", "anya", "😂"), row("b", "boris", "❤️"), row("c", "vera", "❤️"), row("d", "gleb", "🔥")],
    ME,
  );
  assert.deepEqual(leadingReactionEmoji(groups), ["❤️", "😂", "🔥"]);
  assert.deepEqual(leadingReactionEmoji(groups, 1), ["❤️"]);
});

test("the count agrees with its number, teens included", () => {
  assert.equal(reactionCountLabel(1), "1 реакция");
  assert.equal(reactionCountLabel(3), "3 реакции");
  assert.equal(reactionCountLabel(5), "5 реакций");
  assert.equal(reactionCountLabel(11), "11 реакций");
  assert.equal(reactionCountLabel(21), "21 реакция");
  assert.equal(reactionCountLabel(22), "22 реакции");
});

test("the quick row is the person's favourites, topped up from the defaults, never ❤️", () => {
  assert.deepEqual(quickReactionRow([]), DEFAULT_QUICK_REACTIONS.slice(0, 6));
  const used = [
    { emoji: "🔥", count: 5, lastUsedAt: 10 },
    { emoji: QUICK_REACTION, count: 50, lastUsedAt: 99 },
    { emoji: "🤔", count: 5, lastUsedAt: 20 },
    { emoji: "👍", count: 1, lastUsedAt: 30 },
  ];
  assert.deepEqual(rankRecentReactions(used), ["🤔", "🔥", "👍"]);
  const quick = quickReactionRow(used);
  assert.equal(quick.length, 6);
  assert.deepEqual(quick.slice(0, 3), ["🤔", "🔥", "👍"]);
  assert.ok(!quick.includes(QUICK_REACTION), "❤️ stands first on its own and is not ranked");
  assert.equal(new Set(quick).size, quick.length, "an emoji appears once");
});

test("recording a use counts it and keeps storage bounded", () => {
  let entries = recordReactionUse([], "👍", 1);
  entries = recordReactionUse(entries, "👍", 2);
  entries = recordReactionUse(entries, "🔥", 3);
  assert.deepEqual(entries[0], { emoji: "👍", count: 2, lastUsedAt: 2 });
  for (let index = 0; index < 60; index += 1) entries = recordReactionUse(entries, `e${index}`, 10 + index);
  assert.ok(entries.length <= 24, `storage grew to ${entries.length} entries`);
});

test("what storage holds is parsed, and anything else is dropped", () => {
  assert.deepEqual(parseRecentReactions(null), []);
  assert.deepEqual(parseRecentReactions("not json"), []);
  assert.deepEqual(parseRecentReactions('{"emoji":"👍"}'), []);
  assert.deepEqual(
    parseRecentReactions('[{"emoji":"👍","count":2,"lastUsedAt":5},{"emoji":"","count":1,"lastUsedAt":1},{"emoji":"🔥"}]'),
    [{ emoji: "👍", count: 2, lastUsedAt: 5 }],
  );
});

test("a message link is the shape the application already opens", () => {
  const link = new URL(messageLink("chat-1", "message-2", "https://app.letscube.ru"));
  assert.equal(link.origin, "https://app.letscube.ru");
  assert.equal(link.pathname, "/");
  assert.equal(link.searchParams.get("chat"), "chat-1");
  assert.equal(link.searchParams.get("message"), "message-2");
  assert.equal(messageLink("c", "m", "http://127.0.0.1:5173"), "http://127.0.0.1:5173/?chat=c&message=m");
});

test("a shell without a web origin copies a link to the public application", () => {
  for (const origin of ["tauri://localhost", "capacitor://localhost", "", null, undefined, "https://app.letscube.ru/path"]) {
    assert.equal(new URL(messageLink("c", "m", origin)).origin, PUBLIC_APP_ORIGIN, `origin ${String(origin)}`);
  }
});
