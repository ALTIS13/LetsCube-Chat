// The staff queue over `public.content_reports`.
//
// Two halves, the same split `admin-prompts.test.mts` uses. The first is the
// rules and the words, which are pure and tested directly. The second reads the
// tab and the layout and asserts the wiring — unavoidable, because a
// confirmation lives inside a React handler with no harness in this repository,
// and because two of the three things this screen must not do are things a
// handler does, not things a function returns.
//
// Every row below is invented. Nothing here was read off production.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

import { INTERNALS_PATTERN } from "../../artifacts/kub/src/lib/plainMessages.ts";
import type { AdminConfirmPrompt } from "../../artifacts/kub/src/lib/adminPrompts.ts";
import {
  ADMIN_REPORTS_UNAVAILABLE,
  CONTENT_REPORT_STATUSES,
  DEFAULT_REPORT_STATUS_FILTER,
  EVERY_REPORT_PROMPT,
  OPEN_REPORT_STATUSES,
  REPORTED_MESSAGE_DELETED,
  REPORTED_MESSAGE_GONE,
  REPORTED_MESSAGE_UNREADABLE,
  REPORT_QUEUE_MESSAGES,
  REPORT_REASON_LABEL,
  REPORT_RESOLUTIONS,
  REPORT_RESOLUTION_COLUMNS,
  REPORT_STATUS_FILTERS,
  REPORT_STATUS_FILTER_LABEL,
  reportActions,
  reportMatchesFilter,
  reportReasonLabel,
  reportResolutionPatch,
  reportResolutionPrompt,
  reportStatusFilterValues,
  reportStatusLabel,
  reportStatusTone,
  reportedMessagePreview,
  reportedMessageNotice,
  reportedMessageView,
  reportsEmptyHint,
  reportsEmptyTitle,
  sortReportQueue,
  type ReportResolution,
  type ReportStatusFilter,
} from "../../artifacts/kub/src/lib/contentReportQueue.ts";

const NOW = new Date("2026-09-14T12:00:00.000Z");
/** An invented message id. Nothing here was read off production. */
const M = "6f1d2b7a-0000-4000-8000-00000000ab01";
/** An invented moderator. Nothing in this file is a real id. */
const STAFF_ID = "00000000-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------
// The vocabulary of the table
// ---------------------------------------------------------------------

test("every reason the CHECK constraint allows has a Russian name", () => {
  // `content_reports_reason_check` — copied from the migration, not derived
  // from the map under test, so dropping one from the map turns this red.
  for (const reason of ["spam", "abuse", "violence", "sexual", "child_safety", "other"]) {
    const label = reportReasonLabel(reason);
    assert.ok(label.length >= 4, `${reason}: «${label}» is not a name`);
    assert.notEqual(label, reason, `${reason}: rendered as its own key`);
    assert.doesNotMatch(label, /[a-z]/u, `${reason}: «${label}» is not Russian`);
  }
  // The one a moderator most needs to read correctly at a glance says what it
  // is rather than abbreviating to a word that could be about anything.
  assert.match(REPORT_REASON_LABEL.child_safety, /дет/iu);
});

test("a reason or a status nobody added to the map is still visible", () => {
  // The columns are `text` with a CHECK, not enums. A seventh reason added to
  // the constraint before this map learns it must render as itself rather than
  // as an empty cell — an invisible row in a moderation queue is worse than an
  // unfamiliar word.
  assert.equal(reportReasonLabel("harassment_of_staff"), "harassment_of_staff");
  assert.equal(reportStatusLabel("escalated"), "escalated");
  // Nothing at all falls back to the column's own default.
  assert.equal(reportReasonLabel(null), REPORT_REASON_LABEL.other);
  assert.equal(reportStatusLabel(""), "Новая");
});

test("the four statuses are told apart by more than a colour", () => {
  const tones = CONTENT_REPORT_STATUSES.map((status) => reportStatusTone(status));
  const labels = CONTENT_REPORT_STATUSES.map((status) => reportStatusLabel(status));
  assert.equal(new Set(labels).size, 4, "two statuses share a word");
  assert.equal(reportStatusTone("new"), "danger", "what is waiting must be the loud one");
  assert.notEqual(tones[0], tones[1], "«новая» and «в работе» look the same");
});

// ---------------------------------------------------------------------
// The filter by status
// ---------------------------------------------------------------------

test("the queue opens on what is open, not on everything", () => {
  assert.equal(DEFAULT_REPORT_STATUS_FILTER, "open");
  assert.deepEqual([...OPEN_REPORT_STATUSES], ["new", "reviewing"]);
  assert.deepEqual([...(reportStatusFilterValues("open") ?? [])], ["new", "reviewing"]);
  // Every filter the select offers has a name, and «open» is offered first.
  assert.equal(REPORT_STATUS_FILTERS[0], "open");
  for (const filter of REPORT_STATUS_FILTERS) {
    const label = REPORT_STATUS_FILTER_LABEL[filter];
    assert.ok(label && label.length >= 3, `${filter}: no name`);
  }
});

test("«Все» asks for no condition at all, rather than listing the four", () => {
  // A filter that enumerates every allowed value stops matching the day a
  // fifth is added to the CHECK constraint, and a queue that silently hides
  // rows it does not recognise is the worst failure this screen has.
  assert.equal(reportStatusFilterValues("all"), null);
  assert.equal(reportMatchesFilter("escalated", "all"), true);
  assert.equal(reportMatchesFilter("escalated", "open"), false);
});

test("one status filter asks for exactly that status", () => {
  for (const status of CONTENT_REPORT_STATUSES) {
    assert.deepEqual([...(reportStatusFilterValues(status) ?? [])], [status]);
    assert.equal(reportMatchesFilter(status, status), true);
    assert.equal(reportMatchesFilter(status, "all"), true);
  }
  assert.equal(reportMatchesFilter("dismissed", "open"), false, "a closed report stays out of the queue");
  assert.equal(reportMatchesFilter("reviewing", "open"), true);
});

// ---------------------------------------------------------------------
// What is waiting: new first, newest first
// ---------------------------------------------------------------------

const QUEUE = [
  { id: "a", status: "dismissed", created_at: "2026-09-14T11:00:00.000Z" },
  { id: "b", status: "new", created_at: "2026-09-13T09:00:00.000Z" },
  { id: "c", status: "actioned", created_at: "2026-09-14T11:30:00.000Z" },
  { id: "d", status: "new", created_at: "2026-09-14T10:00:00.000Z" },
  { id: "e", status: "reviewing", created_at: "2026-09-14T11:45:00.000Z" },
];

test("new reports come first, and the newest of them first of all", () => {
  const sorted = sortReportQueue(QUEUE).map((row) => row.id);
  assert.deepEqual(sorted, ["d", "b", "e", "c", "a"]);
  // Not merely "the newest row is first": the newest row here is «e», which is
  // already in somebody's hands, and «d» is the one nobody has looked at.
  assert.equal(sorted[0], "d");
});

test("sorting the queue does not rearrange the caller's array", () => {
  const before = QUEUE.map((row) => row.id);
  sortReportQueue(QUEUE);
  assert.deepEqual(QUEUE.map((row) => row.id), before, "the rows are React state");
});

test("a status or a date the queue cannot read does not jump it", () => {
  const odd = sortReportQueue([
    { id: "x", status: "escalated", created_at: "2026-09-14T11:00:00.000Z" },
    { id: "y", status: "new", created_at: "2026-09-10T11:00:00.000Z" },
  ]).map((row) => row.id);
  assert.deepEqual(odd, ["y", "x"], "an unrecognised status sorted above real work");
  // An unreadable date keeps the order the server gave it rather than being
  // treated as the oldest or the newest thing in the list.
  const undated = sortReportQueue([
    { id: "p", status: "new", created_at: "не дата" },
    { id: "q", status: "new", created_at: "2026-09-14T10:00:00.000Z" },
  ]).map((row) => row.id);
  assert.deepEqual(undated, ["p", "q"]);
});

// ---------------------------------------------------------------------
// What was reported
// ---------------------------------------------------------------------

test("a report about a person has no message, and does not pretend to", () => {
  assert.deepEqual(reportedMessageView({ kind: "user", message_id: null }), { kind: "none" });
  assert.deepEqual(
    // Even handed a message row, a report about a person is about a person:
    // `content_reports_message_present` makes that combination impossible, and
    // rendering a quote for it would invent a claim the row does not make.
    reportedMessageView({ kind: "user", message_id: null, message: { content: "текст", deleted_at: null } }),
    { kind: "none" },
  );
});

test("«удалено» is a claim, and «не смог прочитать» is not the same claim", () => {
  // The only SELECT policy on `public.messages` is `is_chat_member(chat_id)`,
  // so a moderator outside the chat gets no row — the same emptiness a deleted
  // message would leave. Calling that «удалено» is D-140's mistake exactly:
  // treating an empty answer as an answer.
  assert.deepEqual(reportedMessageView({ kind: "message", message_id: M, message: null }), { kind: "unreadable" });
  assert.deepEqual(reportedMessageView({ kind: "message", message_id: M }), { kind: "unreadable" });
  // And a report whose message id is gone is a third fact, not a spelling of
  // that one. `content_reports.message_id` is ON DELETE SET NULL and
  // `messages_chat_id_fkey` is ON DELETE CASCADE, so deleting a group takes
  // the reported message with it and leaves the complaint pointing at
  // nothing. Calling that «его видят только участники чата» blames the
  // reader for an absence that is not theirs.
  assert.deepEqual(reportedMessageView({ kind: "message", message_id: null }), { kind: "gone" });
  assert.deepEqual(
    reportedMessageView({ kind: "message", message_id: null, message: { content: "стало быть", deleted_at: null } }),
    { kind: "gone" },
    "a row with no message id quoted a message anyway",
  );
  assert.deepEqual(
    reportedMessageView({
      kind: "message",
      message_id: M,
      message: { content: "текст", deleted_at: "2026-09-14T11:00:00.000Z" },
    }),
    { kind: "deleted" },
  );
  // And the two sentences are not interchangeable on screen either.
  assert.notEqual(REPORTED_MESSAGE_DELETED, REPORTED_MESSAGE_UNREADABLE);
  assert.match(REPORTED_MESSAGE_UNREADABLE, /участник/u, "does not say why the text is missing");
});

test("a message that came back is quoted, bounded, and a wordless one is named", () => {
  assert.deepEqual(
    reportedMessageView({ kind: "message", message_id: M, message: { content: "  оскорбление  ", deleted_at: null } }),
    { kind: "text", text: "оскорбление" },
  );
  // A message with media and no words is not an empty row.
  assert.deepEqual(
    reportedMessageView({ kind: "message", message_id: M, message: { content: "   ", deleted_at: null } }),
    { kind: "attachment" },
  );
  assert.deepEqual(
    reportedMessageView({ kind: "message", message_id: M, message: { content: null, deleted_at: null } }),
    { kind: "attachment" },
  );

  const long = "я".repeat(900);
  const preview = reportedMessagePreview(long, 400);
  assert.equal(preview.length, 401, "the cut is not bounded");
  assert.ok(preview.endsWith("…"), "a cut quote does not say it was cut");
  assert.equal(reportedMessagePreview("коротко", 400), "коротко", "a short quote grew an ellipsis");
});

// ---------------------------------------------------------------------
// What to do about it
// ---------------------------------------------------------------------

test("each of the five answers has its own sentence, and no two share one", () => {
  // The tab renders this and nothing else, so a state added to the union
  // without a sentence would silently take its neighbour's — which is how
  // «его видят только участники чата» ends up under a message nobody can read
  // because it no longer exists.
  const views = [
    { kind: "none" },
    { kind: "text", text: "оскорбление" },
    { kind: "attachment" },
    { kind: "deleted" },
    { kind: "gone" },
    { kind: "unreadable" },
  ] as const;
  const said = views.map((view) => reportedMessageNotice(view));
  assert.deepEqual(said.slice(0, 2), ["", ""], "a quotable view was given a sentence instead of the quote");
  const sentences = said.slice(2);
  assert.equal(new Set(sentences).size, sentences.length, "two states say the same thing");
  for (const sentence of sentences) assert.ok(sentence.length > 0, "a state with nothing to quote says nothing");
  // And the one that is about the reader still says so, while the one that is
  // about the message does not blame the reader.
  assert.match(REPORTED_MESSAGE_UNREADABLE, /участник/u);
  assert.doesNotMatch(REPORTED_MESSAGE_GONE, /участник/u);
  assert.notEqual(REPORTED_MESSAGE_GONE, REPORTED_MESSAGE_DELETED);
});

test("the tab does not spell the sentences out itself", () => {
  // It used to pick between three of them with nested ternaries. A fifth state
  // added to that chain gets the fourth one's words.
  assert.ok(
    TAB.includes("{reportedMessageNotice(reported)}"),
    "the tab stopped asking the module what to say",
  );
  assert.ok(
    !TAB.includes("REPORTED_MESSAGE_UNREADABLE"),
    "the tab went back to choosing the sentence itself",
  );
});

test("an action with no effect is not offered", () => {
  // The same rule `canLiftSanctionRow` follows one tab over: a button for
  // something that has already happened is a button that does nothing while
  // looking like it worked.
  assert.deepEqual([...reportActions("new")], ["reviewing", "actioned", "dismissed"]);
  assert.deepEqual([...reportActions("reviewing")], ["actioned", "dismissed"]);
  assert.ok(!reportActions("actioned").includes("actioned"));
  assert.ok(!reportActions("dismissed").includes("dismissed"));
  for (const status of CONTENT_REPORT_STATUSES) {
    assert.ok(
      !reportActions(status).includes(status as ReportResolution),
      `${status}: offered as an action on a row that is already ${status}`,
    );
  }
});

test("a mistaken decision is recoverable from the row it happened on", () => {
  // Nothing else in the product can reopen a report, so a queue that only ever
  // closed them would make «Отклонить» a trapdoor — which is also why
  // «Отклонить» is not the one marked danger.
  assert.ok(reportActions("dismissed").includes("reviewing"));
  assert.ok(reportActions("actioned").includes("reviewing"));
});

test("a resolution writes the three columns the grant allows, and no others", () => {
  // `grant update (status, handled_by, handled_at) on public.content_reports`.
  // A fourth field would be refused by the grant — but the reason it is shaped
  // that way matters more: `note` and `reason` are somebody's testimony, and a
  // queue that can rewrite the complaint it is deciding cannot be read back as
  // evidence of anything.
  for (const resolution of REPORT_RESOLUTIONS) {
    const patch = reportResolutionPatch(resolution, STAFF_ID, NOW);
    assert.deepEqual(
      Object.keys(patch).sort(),
      [...REPORT_RESOLUTION_COLUMNS],
      `${resolution}: the write does not match the grant`,
    );
    assert.equal(patch.status, resolution);
    assert.equal(patch.handled_by, STAFF_ID, `${resolution}: nobody signed the decision`);
    assert.equal(patch.handled_at, NOW.toISOString());
  }
  assert.deepEqual([...REPORT_RESOLUTION_COLUMNS], ["handled_at", "handled_by", "status"]);
  // Taking a report into work is signed too: the useful question a second
  // moderator has is «is somebody already on this», not «was it closed».
  assert.equal(reportResolutionPatch("reviewing", STAFF_ID, NOW).handled_by, STAFF_ID);
});

// ---------------------------------------------------------------------
// The words, in the administration's own shape
// ---------------------------------------------------------------------

const EVERY_PROMPT: readonly [string, AdminConfirmPrompt][] = REPORT_RESOLUTIONS.map(
  (resolution) => [resolution, reportResolutionPrompt(resolution, "Фиктивный Участник")],
);

test("every question is a question, answered by a button that names the action", () => {
  // The same assertions `admin-prompts.test.mts` makes of the other eleven, so
  // a prompt added here cannot drift into a different shape from the rest of
  // the administration.
  assert.equal(EVERY_PROMPT.length, 3);
  assert.equal(EVERY_REPORT_PROMPT.length, 3);
  for (const [name, prompt] of EVERY_PROMPT) {
    assert.match(prompt.title, /\?$/u, `${name}: the title is not a question`);
    assert.equal(prompt.cancelLabel, "Отмена", `${name}: the way out is not «Отмена»`);
    assert.notEqual(prompt.confirmLabel, "Подтвердить", `${name}: the confirm label says nothing`);
    assert.notEqual(prompt.confirmLabel, "Да", `${name}: the confirm label says nothing`);
    assert.ok(prompt.confirmLabel.length >= 5, `${name}: «${prompt.confirmLabel}» is not an action`);
    assert.doesNotMatch(prompt.description, /\n/u, `${name}: the line is more than a line`);
    assert.ok(prompt.description.length >= 40, `${name}: the line says nothing`);
    assert.match(prompt.description, /[.!]$/u, `${name}: the line does not end`);
    assert.notEqual(prompt.description, prompt.title, `${name}: the line repeats the title`);
  }
  // Confirming the wrong one of three is the failure the dialog exists to
  // prevent, so no two of them may read alike.
  assert.equal(new Set(EVERY_PROMPT.map(([, p]) => p.title)).size, 3);
  assert.equal(new Set(EVERY_PROMPT.map(([, p]) => p.confirmLabel)).size, 3);
});

test("«Меры приняты» says it is a note in the queue and not a ban", () => {
  const actioned = reportResolutionPrompt("actioned", "Фиктивный Участник");
  // The third thing this screen must not do. Banning lives in its own tab,
  // with its own reason, expiry and audit row; a sanction issued from two
  // places is how two truths about one person appear.
  assert.match(actioned.description, /Блокировки/u, "nothing sends the reader to the ban tab");
  assert.match(actioned.description, /отметка/iu, "it does not say what it actually does");
  assert.equal(actioned.tone, "danger", "the one claim in the record is not marked");
  assert.equal(actioned.confirmLabel, "Меры приняты");
});

test("the red is spent on the claim, not on all three", () => {
  const tones = new Map(EVERY_PROMPT.map(([name, prompt]) => [name, prompt.tone]));
  assert.equal(tones.get("actioned"), "danger");
  // Both of the others are one press from being reversed on the row they
  // happened on, and tinting everything red leaves nothing marking the one
  // that asserts something about a person.
  assert.equal(tones.get("reviewing"), "default");
  assert.equal(tones.get("dismissed"), "default");
});

test("a question names the reported person, or says «этого пользователя»", () => {
  for (const resolution of REPORT_RESOLUTIONS) {
    assert.match(
      reportResolutionPrompt(resolution, "Фиктивный Участник").description,
      /Фиктивный Участник/u,
      `${resolution}: the question is about nobody in particular`,
    );
    for (const empty of [null, undefined, "", "   "]) {
      const prompt = reportResolutionPrompt(resolution, empty);
      assert.match(prompt.description, /этого пользователя/u, `${resolution}: an unnamed person`);
      assert.doesNotMatch(prompt.description, /«»/u, "an empty pair of quotes reached the screen");
    }
  }
});

test("«Отклонить» says nobody is told, because nobody is", () => {
  const dismissed = reportResolutionPrompt("dismissed", "Фиктивный Участник");
  assert.match(dismissed.description, /не получит уведомл/u);
  assert.match(dismissed.description, /вернуть/u, "it does not say the decision is reversible");
});

// ---------------------------------------------------------------------
// What the screen says when there is nothing, or when it could not look
// ---------------------------------------------------------------------

test("no sentence this screen shows explains the machine", () => {
  for (const message of REPORT_QUEUE_MESSAGES) {
    assert.doesNotMatch(message, INTERNALS_PATTERN, `internals reached the screen: ${message}`);
    assert.ok(message.length >= 20, `«${message}» is not a sentence`);
  }
  for (const filter of REPORT_STATUS_FILTERS) {
    assert.doesNotMatch(reportsEmptyTitle(filter), INTERNALS_PATTERN);
  }
});

test("«ничего нет» names the filter rather than the whole table", () => {
  // A filtered list that says «жалоб нет» is the same lie as a failed read that
  // says it, one step removed.
  assert.match(reportsEmptyTitle("open"), /Открытых/u);
  assert.match(reportsEmptyTitle("dismissed"), /Отклонённых/u);
  assert.equal(new Set(REPORT_STATUS_FILTERS.map(reportsEmptyTitle)).size, REPORT_STATUS_FILTERS.length);
});

test("the promise that new reports arrive by themselves is only made where they would", () => {
  for (const filter of ["open", "all", "new"] as ReportStatusFilter[]) {
    assert.ok(reportsEmptyHint(filter), `${filter}: a list that shows new reports promises nothing`);
  }
  for (const filter of ["reviewing", "actioned", "dismissed"] as ReportStatusFilter[]) {
    assert.equal(reportsEmptyHint(filter), null, `${filter}: promises about a different screen`);
  }
});

test("the read's own failure sentence is the administration's shape", () => {
  assert.match(ADMIN_REPORTS_UNAVAILABLE, /недоступ/iu);
  assert.doesNotMatch(ADMIN_REPORTS_UNAVAILABLE, INTERNALS_PATTERN);
});

// ---------------------------------------------------------------------
// The wiring: the tab actually does these things
// ---------------------------------------------------------------------

const ADMIN = "artifacts/kub/src/pages/admin";
const TAB = readFileSync(`${ADMIN}/ReportsTab.tsx`, "utf8");
const LAYOUT = readFileSync(`${ADMIN}/AdminLayout.tsx`, "utf8");

/** The body of a named handler, by brace balance from its declaration. */
function block(source: string, name: string): string {
  const start = source.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `${name} is gone`);
  let depth = 0;
  let started = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      started = true;
    } else if (char === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces after ${name}`);
}

test("the tab asks before it writes, and asks with the words from the module", () => {
  const body = block(TAB, "resolveReport");
  assert.match(body, /requestAppConfirm\(/u, "resolveReport does not ask");
  assert.match(body, /reportResolutionPrompt\(/u, "resolveReport invents its own words");
  assert.match(body, /if \(!confirmed\) return;/u, "resolveReport ignores the answer");
  const asked = body.indexOf("requestAppConfirm");
  const answered = body.indexOf("if (!confirmed) return;");
  const wrote = body.indexOf(".update(");
  assert.ok(asked < answered, "the answer is read before the question is asked");
  assert.ok(answered < wrote, "the dialog is raised over a write that already happened");
});

test("the only write is the patch, and nothing on this screen takes text", () => {
  // The first thing this screen must not do. A report is somebody's testimony;
  // the grant refuses an edit, and so does the absence of any field to type in.
  const updates = TAB.match(/\.update\(/gu) ?? [];
  assert.equal(updates.length, 1, "a second write appeared");
  assert.match(TAB, /\.update\(patch\)/u, "the write is not the patch this module builds");
  assert.match(block(TAB, "resolveReport"), /reportResolutionPatch\(/u);
  for (const field of ["<textarea", "<input", "contentEditable"]) {
    assert.ok(!TAB.includes(field), `${field} gives staff a way to edit a report`);
  }
  for (const column of ['note:', 'reason:', '"note"', '"reason"']) {
    assert.ok(!TAB.includes(`.update({ ${column}`), `${column} is written`);
  }
});

test("a write that matched no row is read as a refusal, not as success", () => {
  // PostgREST answers an UPDATE that matched nothing with success and an empty
  // body, so without `.select` a moderator whose account is not
  // `is_manager_or_admin` at the database's definition would watch the row
  // change and change back on the next read.
  const body = block(TAB, "resolveReport");
  assert.match(body, /\.select\("id"\)/u, "the write cannot tell a refusal from a success");
  assert.match(body, /if \(!data\)/u);
  assert.match(body, /REPORT_RESOLVE_FORBIDDEN/u);
});

test("nothing on this screen bans anybody", () => {
  // The third thing it must not do, as code rather than as copy: «Меры
  // приняты» writes a status, and sanctions are issued one tab over.
  for (const forbidden of ['from("bans"', 'from("mutes"', "BanModal", "MuteModal"]) {
    assert.ok(!TAB.includes(forbidden), `${forbidden} issues a sanction from the reports queue`);
  }
});

test("a failed read and a background refresh are the four-state kind", () => {
  // D-140. Both halves, and both were the defect: a refused read that renders
  // as «жалоб нет», and a realtime notification that blanks the tab.
  assert.match(TAB, /listReadView\(\{ loading, error, loadedOnce: loadedOnceRef\.current \}\)/u);
  assert.match(TAB, /readReplacesScreen\(\{/u);
  assert.match(TAB, /background: options\.background === true/u);
  assert.match(TAB, /view === "unavailable"/u, "a failed first read has no screen of its own");
  assert.match(TAB, /view === "stale"/u, "a stale list does not say so");
  // The realtime handler re-reads in the background; an empty-state render must
  // not be reachable from a read that failed.
  assert.match(TAB, /void loadRef\.current\(\{ background: true \}\)/u);
});

test("the queue is ordered by the module, not by whatever the server returned", () => {
  assert.match(TAB, /sortReportQueue\(/u);
  assert.match(TAB, /\.order\("created_at", \{ ascending: false \}\)/u);
  assert.match(TAB, /reportStatusFilterValues\(filter\)/u);
});

// ---------------------------------------------------------------------
// The reporter's name reaches one screen, and that screen is gated
// ---------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

test("the queue is mounted in exactly one place, behind the staff gate", () => {
  // The second thing this screen must not do. `is_manager_or_admin` is the RLS
  // policy; this is the other half of it, because a support-only operator can
  // reach the administration shell for their own tab and must not be routed to
  // a queue whose every row names somebody who asked not to be named.
  const mounts = walk("artifacts/kub/src").filter(
    (file) => !file.endsWith("ReportsTab.tsx") && readFileSync(file, "utf8").includes("ReportsTab"),
  );
  assert.deepEqual(mounts, ["artifacts/kub/src/pages/admin/AdminLayout.tsx"]);
  // **And the gate is the database's, not the client's.** `isStaff` is wider
  // than `is_manager_or_admin` — it also admits anybody holding `chats.moderate`
  // or `users.view`, which a location role carries without any global role — so
  // gating on it would hand somebody a queue that reads zero rows for ever, and
  // an empty queue and a queue you may not read look exactly alike. The rule is
  // `lib/moderationAccess.ts`, pinned by `moderation-access.test.mts`.
  assert.ok(
    LAYOUT.includes('import { useCanReadModerationQueue,'),
    "the layout stopped asking the narrow rule who may read the queue",
  );
  assert.ok(
    LAYOUT.includes("const canReadReports = moderationQueue.allowed;"),
    "the gate no longer comes from useCanReadModerationQueue",
  );
  assert.ok(
    LAYOUT.includes("moderationQueue.checking"),
    "the shell stopped waiting for the role check, so the tab would flicker in",
  );
  const route = LAYOUT.indexOf('<Route path="/admin/reports">');
  const gate = LAYOUT.indexOf('{canReadReports ? <ReportsTab /> : <Redirect to="/admin" />}');
  assert.ok(route > 0 && gate > route && gate - route < 400, "the reports route lost its gate");
  assert.ok(
    !LAYOUT.includes("isStaff ? <ReportsTab"),
    "the queue was re-gated on isStaff, which is wider than the policy that reads it",
  );
  // And the tab is listed beside «Блокировки», which is the same job for the
  // same people — behind the same narrow rule, not merely behind `isStaff`.
  assert.match(LAYOUT, /id: "reports".*path: "\/admin\/reports".*moderationQueue: true/u);
  assert.ok(
    LAYOUT.includes("if (tab.moderationQueue) return canReadReports;"),
    "the tab strip stopped honouring the moderationQueue flag",
  );
  assert.ok(
    LAYOUT.indexOf('id: "bans"') < LAYOUT.indexOf('id: "reports"'),
    "the tab strip separated the two moderation tabs",
  );
});
