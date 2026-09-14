import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCKED_SEND_REFUSAL,
  BLOCKS_EMPTY,
  PERSONAL_MODERATION_MESSAGES,
  REPORT_DUPLICATE_MESSAGE,
  REPORT_DUPLICATE_PERSON,
  REPORT_FAILED,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORT_REFUSED,
  REPORT_STAFF_NOTICE,
  blockPrompt,
  blockRefusalText,
  blockedCountSummary,
  blockedSendRefusal,
  canBlockInChat,
  canReportMessage,
  classifyPersonalWriteError,
  isReportReason,
  normalizeReportNote,
  reportDialogTitle,
  reportNoteRemaining,
  reportReasonLabel,
  reportRefusalText,
  unblockPrompt,
} from "../../artifacts/kub/src/lib/personalModeration.ts";
import { INTERNALS_PATTERN } from "../../artifacts/kub/src/lib/plainMessages.ts";
import { createPersonalBlocksStore } from "../../artifacts/kub/src/lib/personalBlocksStore.ts";

/**
 * Blocking somebody, and reporting somebody.
 *
 * The database half shipped on 2026-09-14 and enforces every rule; what is
 * tested here is the half that faces a person — the vocabulary the insert has
 * to agree with, the questions, and the three sentences a refusal is allowed to
 * be. Each of the three is a contract that fails silently if it drifts: a
 * reason the CHECK does not know is a refused insert, a duplicate reported as a
 * generic failure is a person filing the same complaint again, and a blocked
 * sender told «Недостаточно прав» is a person reading the machine's answer
 * rather than what happened.
 */

// ---------------------------------------------------------------------------
// The vocabulary the insert has to agree with
// ---------------------------------------------------------------------------

/** Exactly `content_reports_reason_check`, read off the shipped migration. */
const REASONS_IN_THE_CHECK = ["spam", "abuse", "violence", "sexual", "child_safety", "other"];

test("the six reasons are exactly the six the CHECK constraint allows", () => {
  assert.deepEqual(REPORT_REASONS.map((reason) => reason.id), REASONS_IN_THE_CHECK);
  for (const reason of REPORT_REASONS) {
    assert.ok(reason.label.trim().length > 0, `${reason.id} has no label`);
    assert.equal(reportReasonLabel(reason.id), reason.label);
  }
  // «Другое» is last on purpose: a list whose escape hatch is at the top is a
  // list nobody reads past.
  assert.equal(REPORT_REASONS[REPORT_REASONS.length - 1].id, "other");
});

test("a reason the constraint does not know is not a reason", () => {
  assert.equal(isReportReason("spam"), true);
  assert.equal(isReportReason("child_safety"), true);
  // Near misses, each of which would be a refused insert rather than an error
  // anybody could read.
  assert.equal(isReportReason("Spam"), false);
  assert.equal(isReportReason("child-safety"), false);
  assert.equal(isReportReason("childsafety"), false);
  assert.equal(isReportReason("harassment"), false);
  assert.equal(isReportReason(""), false);
  assert.equal(isReportReason(null), false);
  assert.equal(isReportReason(undefined), false);
  assert.equal(reportReasonLabel("harassment"), "");
});

test("the dialog names what is being reported", () => {
  assert.match(reportDialogTitle("message"), /сообщени/iu);
  assert.match(reportDialogTitle("user"), /пользовател/iu);
  assert.notEqual(reportDialogTitle("message"), reportDialogTitle("user"));
});

// ---------------------------------------------------------------------------
// The note, cut the way Postgres counts
// ---------------------------------------------------------------------------

test("the note is cut by code point, which is what char_length counts", () => {
  assert.equal(REPORT_NOTE_MAX, 1000);
  assert.equal(normalizeReportNote(""), null);
  assert.equal(normalizeReportNote("   "), null);
  assert.equal(normalizeReportNote(null), null);
  assert.equal(normalizeReportNote("  рассылает одно и то же  "), "рассылает одно и то же");

  const long = "я".repeat(REPORT_NOTE_MAX + 40);
  assert.equal(Array.from(normalizeReportNote(long) ?? "").length, REPORT_NOTE_MAX);

  // The half that a `.slice()` gets wrong. An emoji is one character to
  // `char_length` and two code units to `String.length`, so 1000 emoji are a
  // 2000-unit string the constraint accepts — and slicing at 1000 units would
  // throw away half of what the person wrote for no reason.
  const emoji = "\u{1F600}".repeat(REPORT_NOTE_MAX);
  const kept = normalizeReportNote(emoji) ?? "";
  assert.equal(Array.from(kept).length, REPORT_NOTE_MAX);
  assert.equal(kept.length, REPORT_NOTE_MAX * 2);
  // And a slice must never split a surrogate pair into an unpaired half.
  const overflowing = "\u{1F600}".repeat(REPORT_NOTE_MAX + 5);
  const cut = normalizeReportNote(overflowing) ?? "";
  assert.equal(Array.from(cut).length, REPORT_NOTE_MAX);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(cut), false, "a surrogate pair was split");
});

test("the counter counts the same units the constraint does", () => {
  assert.equal(reportNoteRemaining(""), REPORT_NOTE_MAX);
  assert.equal(reportNoteRemaining("  спам  "), REPORT_NOTE_MAX - 4);
  assert.equal(reportNoteRemaining("\u{1F600}\u{1F600}"), REPORT_NOTE_MAX - 2);
});

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

test("the block question says what happens, and promises nothing the row does not do", () => {
  const prompt = blockPrompt("Анна Смирнова");
  assert.match(prompt.description, /Анна Смирнова/u);
  // The three facts of the migration: they cannot write to you, nothing tells
  // them, and the history stays.
  assert.match(prompt.description, /не сможет писать/iu);
  assert.match(prompt.description, /не узнает/iu);
  assert.match(prompt.description, /останутся/iu);
  // And the one thing it is NOT: the block does not reach a group.
  assert.match(prompt.description, /групп/iu);
  // Nothing about hiding a profile or deleting messages, which the row cannot do.
  assert.equal(/скро|спрята|удал/iu.test(prompt.description), false);
  assert.equal(prompt.confirmLabel, "Заблокировать");
  assert.equal(prompt.cancelLabel, "Отмена");
  // The confirming button names the action; «Отменить» is never the confirm.
  assert.notEqual(prompt.confirmLabel, prompt.cancelLabel);
});

test("a person with no name still gets a question that reads", () => {
  for (const nothing of ["", "   ", null, undefined]) {
    assert.match(blockPrompt(nothing).description, /этого пользователя/u);
    assert.match(unblockPrompt(nothing).description, /этого пользователя/u);
  }
});

test("unblocking only gives back, so its question says only that", () => {
  const prompt = unblockPrompt("Борис");
  assert.match(prompt.description, /Борис/u);
  assert.match(prompt.description, /снова сможет писать/iu);
  assert.equal(prompt.confirmLabel, "Разблокировать");
});

test("a person who reports is told where it goes and what it does not do", () => {
  assert.match(REPORT_STAFF_NOTICE, /администраци/iu);
  assert.match(REPORT_STAFF_NOTICE, /уведомлени/iu);
});

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

test("the two SQLSTATEs are told apart from each other and from everything else", () => {
  assert.equal(classifyPersonalWriteError({ code: "23505" }), "duplicate");
  assert.equal(classifyPersonalWriteError({ code: "42501" }), "refused");
  assert.equal(classifyPersonalWriteError({ code: "23503" }), "failed");
  assert.equal(classifyPersonalWriteError({ code: "PGRST301" }), "failed");
  assert.equal(classifyPersonalWriteError(null), "failed");
  assert.equal(classifyPersonalWriteError(undefined), "failed");
  assert.equal(classifyPersonalWriteError({}), "failed");
});

test("the classifier falls back to the exact texts Postgres produces", () => {
  assert.equal(
    classifyPersonalWriteError({
      message: 'duplicate key value violates unique constraint "content_reports_one_per_message_idx"',
    }),
    "duplicate",
  );
  assert.equal(
    classifyPersonalWriteError({ message: 'new row violates row-level security policy for table "messages"' }),
    "refused",
  );
  assert.equal(classifyPersonalWriteError("new row violates row-level security policy"), "refused");
  assert.equal(classifyPersonalWriteError({ message: "Failed to fetch" }), "failed");
  // The code wins over the message where both are present.
  assert.equal(
    classifyPersonalWriteError({ code: "23505", message: "new row violates row-level security policy" }),
    "duplicate",
  );
});

// ---------------------------------------------------------------------------
// What a refusal is allowed to say
// ---------------------------------------------------------------------------

test("a second report about the same message says so, rather than failing generically", () => {
  assert.equal(reportRefusalText("message", "duplicate"), REPORT_DUPLICATE_MESSAGE);
  assert.equal(REPORT_DUPLICATE_MESSAGE, "Вы уже пожаловались на это сообщение.");
  // The other unique index: one OPEN report per person about the same person.
  assert.equal(reportRefusalText("user", "duplicate"), REPORT_DUPLICATE_PERSON);
  assert.notEqual(REPORT_DUPLICATE_MESSAGE, REPORT_DUPLICATE_PERSON);
  assert.equal(reportRefusalText("message", "refused"), REPORT_REFUSED);
  assert.equal(reportRefusalText("user", "failed"), REPORT_FAILED);
});

test("a mapper that names an internal cannot put it on the report dialog", () => {
  // The shape `mapPgError` really answers where a table is missing.
  const internal = "Не удалось прочитать таблицу content_reports.";
  assert.equal(INTERNALS_PATTERN.test(internal), true, "the fixture is not an internal at all");
  assert.equal(reportRefusalText("message", "failed", internal), REPORT_FAILED);
  // And something a person can act on survives untouched.
  assert.equal(
    reportRefusalText("message", "failed", "Сетевой сбой. Проверьте подключение и попробуйте ещё раз."),
    "Сетевой сбой. Проверьте подключение и попробуйте ещё раз.",
  );
});

test("a blocked send says one sentence, and only in the chat the policy covers", () => {
  const rls = { code: "42501", message: 'new row violates row-level security policy for table "messages"' };
  assert.equal(blockedSendRefusal({ chatType: "private", error: rls }), BLOCKED_SEND_REFUSAL);
  assert.equal(BLOCKED_SEND_REFUSAL, "Пользователь ограничил переписку.");

  // The restrictive policy is scoped to `type = 'private'`, so nothing else can
  // be this refusal — a group's 42501 is somebody's mute or a missing role, and
  // relabelling it would be the product guessing.
  assert.equal(blockedSendRefusal({ chatType: "group", error: rls }), null);
  assert.equal(blockedSendRefusal({ chatType: "channel", error: rls }), null);
  assert.equal(blockedSendRefusal({ chatType: null, error: rls }), null);

  // And within a private chat, only a refusal is this refusal.
  assert.equal(blockedSendRefusal({ chatType: "private", error: { code: "23505" } }), null);
  assert.equal(blockedSendRefusal({ chatType: "private", error: { message: "Failed to fetch" } }), null);
  assert.equal(blockedSendRefusal({ chatType: "private", error: null }), null);
});

test("no sentence this module shows explains the machine", () => {
  for (const message of PERSONAL_MODERATION_MESSAGES) {
    assert.ok(message.trim().length > 0, "an empty sentence");
    assert.equal(
      INTERNALS_PATTERN.test(message),
      false,
      `«${message}» names something only a developer can act on`,
    );
  }
  assert.equal(BLOCKS_EMPTY, "Вы никого не заблокировали.");
});

test("a block failure keeps what a person can act on and replaces what they cannot", () => {
  assert.match(blockRefusalText(null), /Не удалось заблокировать/u);
  assert.equal(blockRefusalText("Сессия не найдена. Войдите снова."), "Сессия не найдена. Войдите снова.");
  // `plainFailure` swallows the mapper's own generic sentence in favour of the
  // surface's, which names what failed.
  assert.match(blockRefusalText("Не удалось выполнить операцию. Попробуйте позже."), /заблокировать/u);
});

// ---------------------------------------------------------------------------
// What the surfaces may offer
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";

test("blocking is offered in a private chat with somebody else, and nowhere else", () => {
  const base = { chatType: "private", isSaved: false, otherUserId: ANNA, currentUserId: ME };
  assert.equal(canBlockInChat(base), true);
  assert.equal(canBlockInChat({ ...base, chatType: "group" }), false);
  assert.equal(canBlockInChat({ ...base, chatType: "channel" }), false);
  // Saved Messages is a private chat with yourself.
  assert.equal(canBlockInChat({ ...base, isSaved: true }), false);
  assert.equal(canBlockInChat({ ...base, otherUserId: ME }), false);
  assert.equal(canBlockInChat({ ...base, otherUserId: null }), false);
  assert.equal(canBlockInChat({ ...base, otherUserId: undefined }), false);
});

test("a message is reportable only when there is a person and a row to name", () => {
  const base = { own: false, localSend: false, deleted: false, authorId: ANNA, currentUserId: ME };
  assert.equal(canReportMessage(base), true);
  assert.equal(canReportMessage({ ...base, own: true }), false);
  // Not yet on the server: there is no `message_id` the queue could open.
  assert.equal(canReportMessage({ ...base, localSend: true }), false);
  assert.equal(canReportMessage({ ...base, deleted: true }), false);
  // A bot's message carries no `user_id`, and `target_user_id` is NOT NULL.
  assert.equal(canReportMessage({ ...base, authorId: null }), false);
  assert.equal(canReportMessage({ ...base, authorId: ME }), false);
});

test("the settings row counts people in Russian", () => {
  assert.equal(blockedCountSummary(0), "Никого");
  assert.equal(blockedCountSummary(-1), "Никого");
  assert.equal(blockedCountSummary(1), "1 человек");
  assert.equal(blockedCountSummary(2), "2 человека");
  assert.equal(blockedCountSummary(4), "4 человека");
  assert.equal(blockedCountSummary(5), "5 человек");
  assert.equal(blockedCountSummary(11), "11 человек");
  assert.equal(blockedCountSummary(12), "12 человек");
  assert.equal(blockedCountSummary(21), "21 человек");
  assert.equal(blockedCountSummary(22), "22 человека");
  assert.equal(blockedCountSummary(25), "25 человек");
});

// ---------------------------------------------------------------------------
// The shared list
// ---------------------------------------------------------------------------

function personRow(id: string, name: string, at: string) {
  return { id, fullName: name, username: null, avatarUrl: null, createdAt: at };
}

function recordingGateway(overrides: Partial<Parameters<typeof createPersonalBlocksStore>[0]> = {}) {
  const calls: string[] = [];
  return {
    calls,
    gateway: {
      async read(userId: string) {
        calls.push(`read:${userId}`);
        return [personRow(ANNA, "Анна", "2026-09-14T10:00:00.000Z")];
      },
      async block(userId: string, blockedId: string) {
        calls.push(`block:${userId}:${blockedId}`);
      },
      async unblock(userId: string, blockedId: string) {
        calls.push(`unblock:${userId}:${blockedId}`);
      },
      ...overrides,
    } as Parameters<typeof createPersonalBlocksStore>[0],
  };
}

test("the list is read once per person and shared by every surface", async () => {
  const { calls, gateway } = recordingGateway();
  const store = createPersonalBlocksStore(gateway);
  // Three surfaces mounting at once is one read, which is the reason the store
  // exists at all.
  await Promise.all([store.sync(ME), store.sync(ME), store.sync(ME)]);
  assert.deepEqual(calls, [`read:${ME}`]);
  assert.equal(store.getSnapshot().people.length, 1);
  assert.equal(store.getSnapshot().ids.has(ANNA), true);
  assert.equal(store.getSnapshot().loading, false);

  await store.sync(ME);
  assert.deepEqual(calls, [`read:${ME}`], "a fourth surface asked again");

  // Signing out empties it rather than leaving the previous person's blocks up.
  await store.sync(null);
  assert.deepEqual(store.getSnapshot().people, []);
  assert.equal(store.getSnapshot().ids.size, 0);
});

test("a block shows at once and is taken back out when the write is refused", async () => {
  const { gateway } = recordingGateway({
    async read() {
      return [];
    },
    async block() {
      throw new Error("Недостаточно прав для этого действия.");
    },
  });
  const store = createPersonalBlocksStore(gateway);
  await store.sync(ME);

  const seen: number[] = [];
  const stop = store.subscribe(() => seen.push(store.getSnapshot().people.length));
  const result = await store.block(ME, personRow(ANNA, "Анна", "2026-09-14T10:00:00.000Z"));
  stop();

  assert.equal(result.ok, false);
  // Optimistic first, then back: the screen never keeps a block the database
  // does not have, and it never waits to show one it does.
  assert.deepEqual(seen, [1, 0]);
  assert.equal(store.getSnapshot().ids.has(ANNA), false);
  assert.equal(store.getSnapshot().error, "Недостаточно прав для этого действия.");
});

test("an unblock that fails puts the person back in the list", async () => {
  const { gateway } = recordingGateway({
    async unblock() {
      throw new Error("Сетевой сбой. Проверьте подключение и попробуйте ещё раз.");
    },
  });
  const store = createPersonalBlocksStore(gateway);
  await store.sync(ME);
  assert.equal(store.getSnapshot().ids.has(ANNA), true);

  const result = await store.unblock(ME, ANNA);
  assert.equal(result.ok, false);
  assert.equal(store.getSnapshot().ids.has(ANNA), true, "the block was lost from the screen but not from the database");
  store.clearError();
  assert.equal(store.getSnapshot().error, null);
});

test("an answer for the previous person never becomes this person's list", async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = createPersonalBlocksStore({
    async read(userId) {
      if (userId === ME) {
        await gate;
        return [personRow(ANNA, "Анна", "2026-09-14T10:00:00.000Z")];
      }
      return [];
    },
    async block() {},
    async unblock() {},
  });

  const first = store.sync(ME);
  // The session changes while the first read is still out.
  const second = store.sync("22222222-2222-4222-8222-000000000002");
  release?.();
  await Promise.all([first, second]);

  assert.deepEqual(store.getSnapshot().people, [], "the previous person's blocks landed on the new one");
});

test("the list is newest first", async () => {
  const store = createPersonalBlocksStore({
    async read() {
      return [
        personRow(ANNA, "Анна", "2026-09-10T10:00:00.000Z"),
        personRow("33333333-3333-4333-8333-000000000003", "Борис", "2026-09-14T10:00:00.000Z"),
      ];
    },
    async block() {},
    async unblock() {},
  });
  await store.sync(ME);
  assert.deepEqual(store.getSnapshot().people.map((person) => person.fullName), ["Борис", "Анна"]);
});
