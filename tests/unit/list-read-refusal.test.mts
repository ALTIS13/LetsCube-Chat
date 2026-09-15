// A list that could not be read is not a list with nothing in it (F-6).
//
// Three hooks answered a refused read with an empty array, and three surfaces
// drew that array as a statement about the person: «Нет доступных задач» with a
// «Создать задачу» beside it, «Чаты не найдены», and a forum rendered as an
// ordinary conversation with no channels and no sentence anywhere. The
// restrictive «block banned» policies make one mechanism silent — the rows are
// filtered, not refused, so nothing even arrives as an error — and a missing
// grant makes the other loud. Both land on the same three lines.
//
// The four-state view this repairs them with is `lib/listReadState.ts`, which
// the administration's two tabs have used since D-140. What is new is the one
// fact a hook needs and a tab does not: what the rows on screen are an answer
// to. «These rows are older than the database» and «these rows belong to the
// conversation you just left» are different claims, and only the first is worth
// keeping on screen.
//
// The decisions live in that module rather than inside the hooks so that
// `node --test` can execute them: a decision made inside a hook that needs
// Supabase and Realtime cannot be measured. The wiring assertions below are
// source reads, which is unavoidable — a React hook has no harness here — and
// every one of them was checked by putting the defect back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mapPgError } from "../../artifacts/kub/src/lib/errors.ts";
import {
  heldListCleared,
  heldListPending,
  heldListRefused,
  heldListStarted,
  heldListSucceeded,
  listReadCleared,
  listReadEnded,
  listReadFailed,
  listReadRefused,
  listReadStarted,
  listReadSucceeded,
  listReadView,
  LIST_READ_PENDING,
  type HeldList,
} from "../../artifacts/kub/src/lib/listReadState.ts";
import {
  CHATS_UNAVAILABLE,
  INTERNALS_PATTERN,
  LIST_MAY_BE_STALE,
  LIST_UNAVAILABLE,
  MAPPER_GENERIC_FAILURE,
  TASKS_UNAVAILABLE,
  plainFailure,
} from "../../artifacts/kub/src/lib/plainMessages.ts";

const SRC = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, SRC), "utf8");

/**
 * The source with its whole-line comments taken out.
 *
 * The notes in these files quote the code they replaced, so a scan that could
 * not tell a note from a statement would report a fixed defect as still
 * present — or worse, be satisfied by a note that says the right thing about
 * code that does the wrong one.
 */
const code = (relative: string): string =>
  read(relative)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
    })
    .join("\n");

const at = (haystack: string, needle: string): number => {
  const index = haystack.indexOf(needle);
  assert.notEqual(index, -1, `not found: ${needle}`);
  return index;
};

/**
 * The source between two markers.
 *
 * Because a lazy `[\s\S]*?` between a gate and the sentence under it will
 * happily run past the end of that block and find the sentence in the next one:
 * emptying the notice on a refused read left every `match` here green, since
 * the stale banner below it says the same words. An assertion about a block has
 * to be made inside that block.
 */
const between = (src: string, from: string, to: string): string => {
  const start = at(src, from);
  const end = src.indexOf(to, start);
  assert.notEqual(end, -1, `not found after «${from}»: «${to}»`);
  return src.slice(start, end);
};

// ---------------------------------------------------------------------------
// What a refusal leaves behind
// ---------------------------------------------------------------------------

test("a refused first read is unavailable, and can never be read as an empty list", () => {
  const after = listReadRefused(LIST_READ_PENDING, {
    subject: "chat-1",
    message: CHATS_UNAVAILABLE,
  });
  assert.equal(listReadView(after), "unavailable");
  assert.notEqual(listReadView(after), "ready");
  assert.equal(after.loading, false);
  assert.equal(after.error, CHATS_UNAVAILABLE);
});

test("a refused later read keeps the rows and calls them old", () => {
  const held = heldListSucceeded([{ id: "t1" }], "filter-a");
  const after = heldListRefused(held, { subject: "filter-a", message: TASKS_UNAVAILABLE });

  assert.deepEqual(after.rows, [{ id: "t1" }], "rows that are true were taken off the screen");
  assert.equal(listReadView(after), "stale");
  assert.equal(after.loadedOnce, true);
});

test("rows read for another question are not this one's old answer", () => {
  // The forum half of the entry, in miniature: opening another conversation and
  // having its read refused must not draw the previous chat's channels. There
  // is no answer for this chat, which is «unavailable» and not «stale».
  const held = heldListSucceeded([{ id: "topic-of-chat-1" }], "chat-1");
  const after = heldListRefused(held, { subject: "chat-2", message: CHATS_UNAVAILABLE });

  assert.deepEqual(after.rows, []);
  assert.equal(listReadView(after), "unavailable");
  assert.equal(after.subject, "chat-2");
});

test("a refusal that arrives with no words is still a refusal", () => {
  // An empty `error` would make `listReadView` answer «ready», and the surface
  // would draw the empty list this whole module exists to prevent.
  for (const message of ["", "   "]) {
    const after = listReadRefused(LIST_READ_PENDING, { subject: "u1", message });
    assert.equal(listReadView(after), "unavailable");
    assert.equal(after.error, LIST_UNAVAILABLE);
  }
});

test("a read that came back is ready, and says what it answered", () => {
  const after = listReadSucceeded("u1");
  assert.equal(listReadView(after), "ready");
  assert.equal(after.loadedOnce, true);
  assert.equal(after.error, null);
  assert.equal(after.subject, "u1");
});

test("«there is nothing here to read» is an answer, and a refusal is not", () => {
  // A chat that is not a forum; a person the task list is not offered to. Both
  // are genuinely empty, and both must stay distinguishable from a read nobody
  // was allowed to make.
  const cleared = listReadCleared();
  assert.equal(listReadView(cleared), "ready");
  assert.equal(cleared.error, null);
  assert.equal(cleared.loadedOnce, false);
  assert.deepEqual(heldListCleared<{ id: string }>().rows, []);
});

test("a notification may not replace the list with a spinner", () => {
  const held = heldListSucceeded([{ id: "t1" }], "filter-a");
  assert.equal(heldListStarted(held, { background: true }).loading, false, "realtime blanked the list");
  assert.equal(
    heldListStarted(held, { background: false }).loading,
    true,
    "a deliberate retry has to show that something is happening",
  );
  // Nothing on screen yet: there is nothing to protect.
  assert.equal(listReadStarted(LIST_READ_PENDING, { background: true }).loading, true);
  assert.deepEqual(heldListStarted(held, { background: true }).rows, held.rows);
});

test("a read ends even down a path nobody thought of, and costs no render otherwise", () => {
  assert.equal(listReadEnded(LIST_READ_PENDING).loading, false);
  const settled = listReadSucceeded("u1");
  assert.equal(listReadEnded(settled), settled, "an ended read was replaced by an equal copy");
});

test("the four views split exactly into «the last read failed» and «it did not»", () => {
  assert.equal(listReadFailed("unavailable"), true);
  assert.equal(listReadFailed("stale"), true);
  assert.equal(listReadFailed("ready"), false);
  assert.equal(listReadFailed("loading"), false);
});

test("nothing read yet means a read is on its way", () => {
  assert.equal(listReadView(LIST_READ_PENDING), "loading");
  const pending: HeldList<string> = heldListPending<string>();
  assert.deepEqual(pending.rows, []);
  assert.equal(pending.subject, null);
});

// ---------------------------------------------------------------------------
// What the person is told
// ---------------------------------------------------------------------------

test("each sentence names what could not be read, and none of them names a table", () => {
  for (const sentence of [CHATS_UNAVAILABLE, TASKS_UNAVAILABLE, LIST_UNAVAILABLE, LIST_MAY_BE_STALE]) {
    assert.doesNotMatch(sentence, INTERNALS_PATTERN, `internals reached the screen: ${sentence}`);
    // And none of them claims the list is empty, which is the whole defect.
    assert.doesNotMatch(sentence, /пуст|не найден|пока нет/iu);
  }
  assert.match(CHATS_UNAVAILABLE, /чат/iu);
  assert.match(TASKS_UNAVAILABLE, /задач/iu);
});

test("the mapper's answer is refused rather than the mapper rewritten", () => {
  // Pinned by calling the mapper, not by repeating its wording here, so a
  // change in `errors.ts` — a module this work does not own — turns this red
  // rather than quietly disabling the branch.
  const unrecognised = mapPgError(new Error("nothing anybody mapped"));
  assert.equal(unrecognised, MAPPER_GENERIC_FAILURE);
  assert.equal(
    plainFailure(unrecognised, TASKS_UNAVAILABLE),
    TASKS_UNAVAILABLE,
    "«операцию» was shown where the surface knew it was the task list",
  );

  // Anything a person can act on is worth more than either sentence and
  // survives untouched: losing the one failure they could have fixed is the
  // worse trade.
  const actionable = mapPgError({ code: "42501", message: "permission denied for table tasks" });
  assert.doesNotMatch(actionable, INTERNALS_PATTERN);
  assert.equal(plainFailure(actionable, TASKS_UNAVAILABLE), actionable);

  // And the filter really is in the path: a sentence naming an internal is
  // replaced by the surface's own, whatever mapper produced it.
  assert.equal(plainFailure("Требуется обновление базы данных.", CHATS_UNAVAILABLE), CHATS_UNAVAILABLE);
});

test("the product has one spelling of «these rows may be old»", () => {
  // The administration's two tabs print these words already. Two spellings of
  // one situation is the drift the shared module exists to prevent.
  assert.ok(read("pages/admin/BansMutesTab.tsx").includes(LIST_MAY_BE_STALE));
  assert.ok(read("pages/admin/ReportsTab.tsx").includes(LIST_MAY_BE_STALE));
});

// ---------------------------------------------------------------------------
// The three hooks
// ---------------------------------------------------------------------------

test("the task list stops answering a refusal with «you are all caught up»", () => {
  const hook = code("hooks/useTasks.ts");
  assert.doesNotMatch(hook, /setTasks\(/u, "the refusal still empties the list");
  assert.match(hook, /heldListRefused\(previous, \{/u);
  assert.match(hook, /message: plainFailure\(mapPgError\(error\), TASKS_UNAVAILABLE\)/u);
  // The one empty answer that is true keeps saying so.
  assert.match(hook, /heldListCleared<TaskWithPeople>\(\)/u);
  assert.match(hook, /view: listReadView\(read\)/u);
});

test("the sidebar's two reads both report their refusal", () => {
  const hook = code("hooks/useChats.ts");
  // The memberships read already kept the rows; it told nobody.
  assert.match(hook, /if \(membershipsError\) \{[\s\S]*?listReadRefused/u);
  // The chats read did not even destructure `error`.
  assert.match(hook, /data: chatsData, error: chatsError/u);
  assert.match(hook, /if \(chatsError \|\| !chatsData\) \{[\s\S]*?listReadRefused/u);
  // An answer of «no memberships» is still an answer.
  assert.match(hook, /listReadSucceeded\(userId\)/u);
  assert.match(hook, /view: listReadView\(read\)/u);
});

test("the forum's channel read stops being thrown away", () => {
  const hook = code("hooks/useTopics.ts");
  // The select, and not merely some destructure somewhere in the file:
  // `createTopic` below it writes `const { data, error }` too, so the short
  // pattern stayed green while the read went back to throwing its error away.
  assert.match(
    hook,
    /const \{ data, error \} = await supabase\s*\n\s*\.from\("topics"\)\s*\n\s*\.select\("\*"\)/u,
    "`error` is discarded again",
  );
  assert.match(hook, /heldListRefused\(previous, \{/u);
  assert.match(hook, /message: plainFailure\(mapPgError\(error\), CHANNEL_RAIL_UNREADABLE\)/u);
  // A chat that is not a forum has no channels, which is not a failure.
  assert.match(hook, /heldListCleared<Topic>\(\)/u);
});

// ---------------------------------------------------------------------------
// The three surfaces
// ---------------------------------------------------------------------------

test("the task page draws the refusal where it used to invite a new task", () => {
  const page = code("pages/tasks/TasksPage.tsx");
  // Each block is pinned from its gate through to the sentence it prints, not
  // by its testid alone: a notice left in the file behind a condition that is
  // never true draws nothing, and a testid on an empty notice draws nothing
  // legible.
  const unavailable = between(page, 'tasksView === "unavailable" ? (', "visibleTasks.length === 0");
  assert.match(unavailable, /data-testid="tasks-unavailable"/u);
  assert.match(unavailable, /\{tasksError\}/u, "the refusal is drawn with no sentence in it");
  assert.match(unavailable, /void refetch\(\)/u, "and with no way to ask again");

  const stale = between(page, '{tasksView === "stale" && (', "{loading ? (");
  assert.match(stale, /data-testid="tasks-stale"/u);
  assert.match(stale, /\{LIST_MAY_BE_STALE\}/u);
  assert.match(stale, /\{tasksError\}/u);
  assert.match(stale, /void refetch\(\)/u);
  // Position, not presence: the empty state is reachable only once the refusal
  // has been ruled out.
  assert.ok(
    at(page, 'tasksView === "unavailable"') < at(page, "visibleTasks.length === 0"),
    "the empty state is drawn before the refusal is ruled out",
  );
  assert.ok(at(page, "{LIST_MAY_BE_STALE}") < at(page, "visibleTasks.length === 0"));
});

test("the chat list says a refused read rather than «Чаты не найдены»", () => {
  const sidebar = code("components/sidebar/Sidebar.tsx");
  const unavailable = between(sidebar, 'chatsView === "unavailable" ? (', ") : (");
  assert.match(unavailable, /data-testid="chat-list-unavailable"/u);
  assert.match(unavailable, /\{chatsError\}/u, "the refusal is drawn with no sentence in it");
  assert.match(unavailable, /void refetch\(\)/u, "and with no way to ask again");

  const stale = between(sidebar, '{chatsView === "stale" && (', "<ChatList");
  assert.match(stale, /data-testid="chat-list-stale"/u);
  assert.match(stale, /\{LIST_MAY_BE_STALE\}/u);
  assert.match(stale, /\{chatsError\}/u);
  assert.match(stale, /void refetch\(\)/u);
  assert.ok(
    at(sidebar, 'chatsView === "unavailable"') < at(sidebar, "<ChatList"),
    "the list is drawn before the refusal is ruled out",
  );
  // The sentence it stands in for is still where it belongs: a list that really
  // is empty keeps saying so.
  assert.ok(read("components/sidebar/ChatList.tsx").includes("Чаты не найдены"));
});

test("a refused channel read keeps the rail standing and says so", () => {
  const window = code("components/chat/ChatWindow.tsx");
  // The rooms have had this since 2026-09-14; the text channels are joined to
  // it rather than given a second mechanism of their own.
  assert.match(window, /const channelsUnreadable = serverChannels\.failed \|\| listReadFailed\(topicsView\)/u);
  assert.match(
    window,
    /railIsOffered\(serverChannels\.channels, serverChannels\.categories, channelsUnreadable\)/u,
  );
  assert.match(window, /failed: channelsUnreadable/u);
  // Both reads are asked again together, or a retry repairs half the screen.
  assert.match(window, /refreshServerChannels\(\);[\s\S]{0,40}refetchTopics\(\)/u);

  // And where the rail is not offered, the strip carries the same sentence.
  // Reachability, not presence: a notice sitting in the file behind a gate that
  // is never true draws nothing, and the first version of this test was
  // satisfied by exactly that.
  const strip = code("components/chat/TopicStrip.tsx");
  const notice = between(strip, "{unreadable && (", "{canManage && (");
  assert.match(notice, /data-testid="topic-strip-unreadable"/u);
  assert.match(notice, /\{CHANNEL_RAIL_UNREADABLE\}/u);
  assert.match(notice, /\{CHANNEL_RAIL_RETRY\}/u);
  assert.match(strip, /TopicStrip\(\{ topics, canManage, onCreate, unreadable, onRetry \}/u);
});
