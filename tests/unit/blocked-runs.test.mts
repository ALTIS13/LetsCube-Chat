// A blocked person's messages, folded in a group conversation — Discord's
// collapsed blocked group, read in its bundle on 2026-09-30.

import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedRunHoldsTarget,
  blockedRunLabel,
  chatFoldsBlockedMessages,
  foldBlockedRuns,
  isBlockedAuthorMessage,
  type FoldableMessage,
} from "../../artifacts/kub/src/lib/blockedRuns.ts";

const BAD = "u-bad";
const WORSE = "u-worse";
const OK = "u-ok";
const blocked = new Set([BAD, WORSE]);

type G = { id: string; messages: FoldableMessage[]; day?: boolean };
const g = (id: string, user: string, extra: Partial<FoldableMessage> = {}, day = false): G => ({
  id,
  messages: [{ id, user_id: user, ...extra }],
  day,
});
const fold = (groups: G[], set: ReadonlySet<string> = blocked) =>
  foldBlockedRuns<G>({ groups, messagesOf: (group) => group.messages, blocked: set, startsDay: (group) => Boolean(group.day) });

test("only a conversation of several people folds", () => {
  assert.equal(chatFoldsBlockedMessages("group"), true);
  assert.equal(chatFoldsBlockedMessages("dm_group"), true);
  assert.equal(chatFoldsBlockedMessages("channel"), true);
  assert.equal(chatFoldsBlockedMessages("private"), false, "a private chat's history is the conversation itself");
  assert.equal(chatFoldsBlockedMessages("group", true), false, "«Избранное» folds nothing");
  assert.equal(chatFoldsBlockedMessages(undefined), false);
});

test("a system line and a bot are never folded, whoever is named", () => {
  assert.equal(isBlockedAuthorMessage({ id: "1", user_id: BAD }, blocked), true);
  assert.equal(isBlockedAuthorMessage({ id: "2", user_id: BAD, type: "system" }, blocked), false);
  assert.equal(isBlockedAuthorMessage({ id: "3", user_id: null, bot_id: "b1" }, blocked), false);
  assert.equal(isBlockedAuthorMessage({ id: "4", user_id: OK }, blocked), false);
});

test("consecutive blocked messages become one run, and the others stay as they are", () => {
  const items = fold([g("a", OK), g("b", BAD), g("c", BAD), g("d", OK)]);
  assert.deepEqual(items.map((item) => item.kind), ["open", "blocked", "open"]);
  const run = items[1];
  assert.equal(run.kind === "blocked" && run.messageIds.join(","), "b,c");
  assert.equal(run.kind === "blocked" && run.key, "b");
});

test("two blocked people in a row are one run", () => {
  const [run] = fold([g("a", BAD), g("b", WORSE)]);
  assert.equal(run.kind, "blocked");
  assert.equal(run.kind === "blocked" && run.messageIds.join(","), "a,b");
});

test("a run does not cross a day, so the date stays visible", () => {
  const items = fold([g("a", BAD), g("b", BAD, {}, true), g("c", BAD)]);
  assert.deepEqual(items.map((item) => item.kind === "blocked" ? item.messageIds.join(",") : "open"), ["a", "b,c"]);
});

test("an album is folded whole, and only when every piece of it is a blocked person's", () => {
  const album: G = { id: "al", messages: [{ id: "al1", user_id: BAD }, { id: "al2", user_id: BAD }] };
  const [run] = fold([album]);
  assert.equal(run.kind === "blocked" && run.messageIds.length, 2);
  const mixed: G = { id: "mx", messages: [{ id: "m1", user_id: BAD }, { id: "m2", user_id: OK }] };
  assert.deepEqual(fold([mixed]).map((item) => item.kind), ["open"]);
});

test("with nobody blocked nothing folds, and the groups come back untouched", () => {
  const groups = [g("a", BAD), g("b", OK)];
  const items = fold(groups, new Set());
  assert.deepEqual(items.map((item) => item.kind), ["open", "open"]);
  assert.equal(items[0].kind === "open" && items[0].group, groups[0]);
});

test("the line counts in Russian, adjective and noun both", () => {
  assert.equal(blockedRunLabel(1), "1 заблокированное сообщение");
  assert.equal(blockedRunLabel(3), "3 заблокированных сообщения");
  assert.equal(blockedRunLabel(5), "5 заблокированных сообщений");
  assert.equal(blockedRunLabel(11), "11 заблокированных сообщений");
  assert.equal(blockedRunLabel(21), "21 заблокированное сообщение");
});

test("a run holding a jump's target opens by itself", () => {
  assert.equal(blockedRunHoldsTarget(["a", "b"], "b"), true);
  assert.equal(blockedRunHoldsTarget(["a", "b"], "c"), false);
  assert.equal(blockedRunHoldsTarget(["a"], null), false);
});
