// Where `useMessages` is asked something and is refused (F-6, F-7).
//
// Both decisions live in modules `node --test` can load — `messageReactions.ts`
// for the toggle, `listReadState.ts` for the pinned read — and both are
// measured there, by their own tests. What no unit test can reach is the hook
// that calls them: it needs Supabase, Realtime and a React tree to exist.
//
// So this file reads the two call sites. It is a source guard and claims only
// what a source guard can: that the hook still calls the module and still does
// not do the thing the survey found. Each assertion was proved by putting the
// defect back and watching it go red; none of them can tell you the screen is
// right, only that these two lines have not returned.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const HOOK = "artifacts/kub/src/hooks/useMessages.ts";
const source = readFileSync(HOOK, "utf8");

/** The text between two landmarks, so an assertion cannot wander into another function. */
function between(from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `${HOOK} no longer contains ${JSON.stringify(from)}`);
  const end = source.indexOf(to, start);
  assert.notEqual(end, -1, `${HOOK} no longer contains ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return source.slice(start, end);
}

// ── F-7: the toggle takes its guess back and says why ──────────────────────

const toggle = between("const toggleReaction = useCallback", "const clearChatForMe = useCallback");

test("a refused reaction puts the reactions back as they were", () => {
  // The defect: the guess was painted first and nothing ever undid it, so the
  // person watched their reaction change and found the old one after a reload.
  assert.match(toggle, /showReactions\(painted\)/);
});

test("a refused reaction is said in a person's words, not only to the console", () => {
  // `errors.ts` has carried «На это сообщение больше реакций поставить нельзя.»
  // since the message-action migrations, and no path could raise it.
  assert.match(toggle, /setActionRefusal\(mapPgError\(error\)\)/);
  assert.match(toggle, /reactionRpcOutcome\(/, "the RPC's answer is sorted rather than tested inline");
  assert.match(toggle, /return refuse\(/, "a refusal ends the toggle instead of falling through");
});

test("a write that was refused stops the writes after it", () => {
  // The DELETE and the INSERT are separate statements. The delete's refusal did
  // not stop the insert, which then met the database's limit: two console lines
  // for one visibly wrong screen.
  const returns = toggle.match(/if \(error\) return error;/g) ?? [];
  assert.equal(
    returns.length,
    2,
    "the delete and the insert of the three-request toggle must each answer with their refusal",
  );
  assert.match(toggle, /if \(lookupError\) return lookupError;/);
});

test("the toggle plans by the database's limit, not by a constant", () => {
  assert.match(toggle, /reactionLimit\.claimRead\(user\.id\)/, "asked for the account that is reacting");
  assert.match(toggle, /supabase\.rpc\(REACTION_LIMIT_RPC\)/);
  const planned = toggle.match(/planReactionToggle\([^;]*?, limit\)/g) ?? [];
  assert.equal(planned.length, 2, "the painted guess and the older three-request toggle both take the limit");
  assert.match(toggle, /reactionDeleteScope\(plan, limit\)/);
});

// ── F-6: a refused pinned read is not an empty one ─────────────────────────

const pinnedFailure = between('console.error("Pinned messages fetch error:', "const pinnedRows");

test("a refused pinned read keeps the rows it has", () => {
  // The defect was `setPinnedMessages([]); setPinnedReady(true)` — it asserted
  // the empty answer was final, and since the banner is drawn only while there
  // are rows, the failure removed the one thing that could have shown it.
  assert.doesNotMatch(
    pinnedFailure,
    /setPinnedMessages/,
    "blanking the list on a failed read replaces something true with something false",
  );
  assert.match(pinnedFailure, /listReadRefused\(current, \{ subject: fetchKey, message: mapPgError\(error\) \}\)/);
});

test("the pinned banner uses the vocabulary this defect class already has", () => {
  // D-140's four states and, for a list a hook re-reads, `ListReadProgress` —
  // written once in `listReadState.ts`, used by the sanctions and reports tabs
  // and by the three hooks of F-6. A second set of names for the same idea is
  // the thing to avoid, not the thing to write.
  assert.match(source, /from "@\/lib\/listReadState";/);
  assert.match(source, /useState<ListReadProgress>\(LIST_READ_PENDING\)/);
  assert.match(source, /listReadView\(/);
  assert.match(source, /^\s*pinnedView,$/m, "the view is returned, so a surface can render it");
  assert.match(source, /^\s*pinnedError: visiblePinnedError,$/m);
  // The rows are not this module's to hold: realtime edits, hides and pins
  // apply to them one at a time, which is why `useChats` keeps its own too.
  assert.match(source, /useState<MessageWithSender\[\]>\(\[\]\)/);
});

test("a read that succeeded is what clears the refusal", () => {
  const pinnedSuccess = between("const pinnedRows", "}, [chatId, topicId, generalTopicIds");
  assert.match(pinnedSuccess, /setPinnedRead\(listReadSucceeded\(fetchKey\)\)/);
  // And a chat with nothing to read is the one place an empty list is an answer.
  assert.match(source, /setPinnedRead\(listReadCleared\(\)\)/);
});
