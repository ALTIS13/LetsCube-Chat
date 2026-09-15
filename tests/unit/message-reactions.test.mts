import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REACTION_LIMIT,
  QUICK_REACTION,
  applyReactionPlan,
  createReactionLimit,
  groupReactions,
  leadingReactionEmoji,
  myReaction,
  parseReactionLimit,
  parseReactionRows,
  planReactionToggle,
  reactionCountLabel,
  reactionDeleteScope,
  reactionRpcOutcome,
  type ReactionRowLike,
} from "../../artifacts/kub/src/lib/messageReactions.ts";
import { mapPgError } from "../../artifacts/kub/src/lib/errors.ts";

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
/** The same row with a moment of its own, for the rules that keep the newest. */
const rowAt = (id: string, user: string, emoji: string, createdAt: string): ReactionRowLike => ({
  ...row(id, user, emoji),
  created_at: createdAt,
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
  // Two rows can exist: the trigger of 20260911142000 stops new ones, and the
  // migration deliberately left the pairs that predate it alone. Adding clears
  // them, exactly as `set_message_reaction` does — it keeps the newest
  // `limit - 1` of yours, which at a limit of one is none.
  const plan = planReactionToggle([row("a", ME, "👍"), row("b", ME, "🔥")], ME, "😂");
  assert.deepEqual(plan, { remove: ["a", "b"], add: "😂" });
  // Taking one back takes that one and no more, which is also what the RPC
  // does: it deletes where `emoji = p_emoji`. A plan that swept both would
  // paint away a row the server keeps, and the next answer would put it back.
  const again = planReactionToggle([row("a", ME, "👍"), row("b", ME, "🔥")], ME, "🔥");
  assert.deepEqual(again, { remove: ["b"], add: null });
});

test("nobody else's reaction is ever touched", () => {
  const plan = planReactionToggle([row("a", "anya", "❤️"), row("b", "boris", "👍")], ME, "❤️");
  assert.deepEqual(plan.remove, []);
});

// ── The limit is the database's, not a constant here (F-7) ─────────────────
//
// `private.reaction_limit_per_message(user)` returns 1 today and is already
// parameterised for the subscription; `public.reaction_limit_per_message()` is
// published for the client to ask. A hardcoded 1 agrees with it until the day
// it does not, and then it removes a subscriber's first reaction to make room
// for a second they were entitled to keep.

test("one reaction each is still the rule until the database says otherwise", () => {
  assert.equal(DEFAULT_REACTION_LIMIT, 1, "the value private.reaction_limit_per_message returns today");
  const mine = [rowAt("a", ME, "👍", "2026-09-11T09:00:00.000Z")];
  assert.deepEqual(planReactionToggle(mine, ME, "❤️", 1), { remove: ["a"], add: "❤️" });
  assert.deepEqual(planReactionToggle(mine, ME, "❤️"), { remove: ["a"], add: "❤️" }, "and it is the default");
});

test("at a limit of two a second reaction is added, not swapped in", () => {
  const mine = [rowAt("a", ME, "👍", "2026-09-11T09:00:00.000Z")];
  assert.deepEqual(planReactionToggle(mine, ME, "❤️", 2), { remove: [], add: "❤️" });
});

test("at a limit of two a third reaction pushes out the oldest, as the RPC does", () => {
  // `set_message_reaction` keeps the newest `limit - 1` by (created_at, id)
  // descending and deletes the rest.
  const mine = [
    rowAt("old", ME, "👍", "2026-09-11T09:00:00.000Z"),
    rowAt("new", ME, "🔥", "2026-09-11T09:05:00.000Z"),
  ];
  assert.deepEqual(planReactionToggle(mine, ME, "😂", 2), { remove: ["old"], add: "😂" });
  // Reversed in the array, the same row still goes: the moment decides, not the
  // order the join happened to return.
  assert.deepEqual(planReactionToggle([mine[1], mine[0]], ME, "😂", 2), { remove: ["old"], add: "😂" });
});

test("a nonsense limit falls back to the rule the product ships with", () => {
  const mine = [rowAt("a", ME, "👍", "2026-09-11T09:00:00.000Z")];
  for (const limit of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      planReactionToggle(mine, ME, "❤️", limit),
      { remove: ["a"], add: "❤️" },
      `limit ${String(limit)} must not widen the rule`,
    );
  }
});

test("the older three-request toggle deletes what the plan names, once a limit can exceed one", () => {
  const mine = [
    rowAt("old", ME, "👍", "2026-09-11T09:00:00.000Z"),
    rowAt("new", ME, "🔥", "2026-09-11T09:05:00.000Z"),
  ];
  // At one each, every row of this person's goes — a stray the client never saw
  // included, which is what the blanket delete is for and what the RPC's
  // «keep the newest none» amounts to.
  assert.deepEqual(reactionDeleteScope(planReactionToggle(mine, ME, "😂", 1), 1), { kind: "mine" });
  // At two, sweeping them all is the defect: the first reaction would go to
  // make room for a second the person was entitled to keep.
  assert.deepEqual(reactionDeleteScope(planReactionToggle(mine, ME, "😂", 2), 2), { kind: "ids", ids: ["old"] });
  // Taking yours back names its row whatever the limit is.
  assert.deepEqual(reactionDeleteScope(planReactionToggle(mine, ME, "🔥", 1), 1), { kind: "ids", ids: ["new"] });
  // Nothing of yours on the message: there is nothing to delete.
  assert.deepEqual(reactionDeleteScope(planReactionToggle([], ME, "🔥", 1), 1), { kind: "none" });
});

test("the limit is a whole number of reactions, and anything else is not an answer", () => {
  assert.equal(parseReactionLimit(1), 1);
  assert.equal(parseReactionLimit(3), 3);
  assert.equal(parseReactionLimit("2"), 2, "PostgREST may hand back a scalar as text");
  assert.equal(parseReactionLimit(2.9), 2, "a fraction of a reaction is the whole one below it");
  assert.equal(parseReactionLimit(0), null);
  assert.equal(parseReactionLimit(-1), null);
  assert.equal(parseReactionLimit(101), null, "«up to three» is the plan; a hundred is a wrong answer");
  for (const nonsense of [null, undefined, "", "  ", "many", {}, [], Number.NaN]) {
    assert.equal(parseReactionLimit(nonsense), null, `parsed ${JSON.stringify(nonsense)}`);
  }
});

test("the limit is asked for once an account and remembered", () => {
  const source = createReactionLimit();
  assert.equal(source.value(), DEFAULT_REACTION_LIMIT);
  assert.equal(source.claimRead(ME), true);
  assert.equal(source.claimRead(ME), false, "a second toggle does not ask while the first is asking");
  assert.equal(source.accept({ data: 3 }), 3);
  assert.equal(source.value(), 3);
  assert.equal(source.claimRead(ME), false, "an answer settles it");
});

test("the entitlement belongs to the account, so another one does not inherit it", () => {
  // Signing in as somebody else without a reload: their reactions must not be
  // planned by the previous person's subscription.
  const source = createReactionLimit();
  source.claimRead(ME);
  assert.equal(source.accept({ data: 3 }), 3);
  assert.equal(source.claimRead("anya"), true, "a new account is asked about");
  assert.equal(source.value(), DEFAULT_REACTION_LIMIT, "and plans by the shipped rule until it answers");
});

test("a server without the function is not asked again, and a refusing one is not asked forever", () => {
  const missing = createReactionLimit();
  missing.claimRead(ME);
  assert.equal(missing.accept({ error: { code: "PGRST202", message: "Could not find the function" } }), 1);
  assert.equal(missing.claimRead(ME), false, "that deployment has neither this function nor the toggle RPC");

  const refusing = createReactionLimit({ attempts: 2 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(refusing.claimRead(ME), true, `attempt ${attempt}`);
    assert.equal(refusing.accept({ error: { code: "42501", message: "permission denied" } }), 1);
  }
  assert.equal(refusing.claimRead(ME), false, "two requests a tap, forever, is not a fallback");
  assert.equal(refusing.value(), DEFAULT_REACTION_LIMIT);
});

test("an unreadable answer leaves the rule alone", () => {
  const source = createReactionLimit();
  source.claimRead(ME);
  assert.equal(source.accept({ data: "лимит" }), DEFAULT_REACTION_LIMIT);
  assert.equal(source.accept(null), DEFAULT_REACTION_LIMIT, "no answer at all is not an answer");
  assert.equal(source.claimRead(ME), true, "a refusal leaves the next toggle free to ask again");
});

// ── A refused toggle is taken back and said out loud (F-7) ─────────────────

test("the four things a call to set_message_reaction can come back as", () => {
  const rows = [row("a", ME, "❤️")];
  assert.deepEqual(reactionRpcOutcome({ data: rows }), { kind: "rows", rows });
  assert.deepEqual(reactionRpcOutcome({ data: [] }), { kind: "rows", rows: [] });
  assert.deepEqual(reactionRpcOutcome({ data: { id: "a" } }), { kind: "unreadable" });
  assert.deepEqual(
    reactionRpcOutcome({ error: { code: "PGRST202", message: "Could not find the function" } }),
    { kind: "missing" },
  );
  const refusal = { code: "P0001", message: "reaction_limit_reached" };
  assert.deepEqual(reactionRpcOutcome({ error: refusal }), { kind: "refused", error: refusal });
});

test("a refusal is never read as an answer, however empty it looks", () => {
  // The defect: the refusal went to the console and the guess stayed on the
  // screen. `refused` is what makes the toggle put the reactions back and say
  // why, so it must not be reachable as anything else — an error with no rows
  // is still an error.
  const outcome = reactionRpcOutcome({ data: null, error: { code: "42501", message: "permission denied" } });
  assert.equal(outcome.kind, "refused");
  assert.notEqual(outcome.kind, "rows");
  assert.notEqual(outcome.kind, "unreadable");
});

test("the refusal reactions produce has had its sentence all along", () => {
  // `errors.ts` carried this line and nothing could raise it, because both
  // writes discarded their error. These are the refusals `set_message_reaction`
  // and the reaction-limit trigger can actually raise.
  assert.equal(
    mapPgError({ code: "P0001", message: "reaction_limit_reached" }),
    "На это сообщение больше реакций поставить нельзя.",
  );
  assert.equal(
    mapPgError({ code: "22023", message: "message_not_reactable" }),
    "На это сообщение нельзя поставить реакцию.",
  );
  assert.equal(mapPgError({ code: "22023", message: "invalid_emoji" }), "Такую реакцию поставить нельзя.");
  assert.equal(
    mapPgError({ code: "P0002", message: "message_not_found" }),
    "Сообщение не найдено или уже удалено.",
  );
  // And nothing raw ever reaches the screen.
  assert.equal(
    mapPgError({ code: "42501", message: 'new row violates row-level security policy for table "reactions"' }),
    "Недостаточно прав для этого действия.",
  );
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
