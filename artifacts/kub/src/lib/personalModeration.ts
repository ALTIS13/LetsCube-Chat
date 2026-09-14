/**
 * What a person can do about another person: refuse them, or report them.
 *
 * The database half shipped on 2026-09-14
 * (`20260914120000_personal_blocks_and_reports.sql`) and every rule below is
 * already enforced there. This module holds the words and the decisions that go
 * with those rules, so a `node --test` process can read them without a browser:
 * the reason vocabulary, the two questions, the sentences a refusal is allowed
 * to say, and the classifier that turns a Postgres error into one of them.
 *
 * Its only import is `plainMessages.ts`, which imports nothing either — the
 * same arrangement `settingsRows.ts` has, and for the same reason. A decision
 * made of words has no business pulling React into a test process.
 *
 * Three facts about the shipped schema are load-bearing here, each measured on
 * production rather than assumed:
 *
 *   1. **A report is inserted with no `.select()` chained.** Reading the row
 *      back needs the SELECT policy, which is staff-only, so
 *      `insert … returning` is refused — and the error Postgres gives is «new
 *      row violates row-level security policy», which reads like a failing
 *      WITH CHECK and is not one. Nothing in a module of words can enforce
 *      that, so it is measured on the wire instead: the e2e spec asserts the
 *      insert carries no `Prefer: return=representation`.
 *   2. `content_reports_one_per_message_idx` makes a second report about the
 *      same message from the same person raise **23505**. That is not a
 *      failure worth a generic sentence: it means the complaint is already
 *      filed. A second index allows only one *open* report per person about
 *      the same person, and raises the same code.
 *   3. A blocked sender's insert into `public.messages` fails with **42501**.
 *      The refusal is one sentence and never a Postgres message.
 */

import { plainFailure, plainMessage } from "./plainMessages.ts";

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** Exactly the six values `content_reports_reason_check` allows. */
export type ReportReasonId = "spam" | "abuse" | "violence" | "sexual" | "child_safety" | "other";

/** Exactly the two values `content_reports_kind_check` allows. */
export type ReportKind = "message" | "user";

export interface ReportReasonOption {
  readonly id: ReportReasonId;
  readonly label: string;
}

/**
 * The reasons, in the order the picker offers them.
 *
 * The order is not decoration: it runs from the complaint people actually make
 * most often to the one that must never be buried, with «Другое» last because
 * a list whose escape hatch is at the top is a list nobody reads. The ids are
 * the database's; the labels are the product's, and the two are pinned together
 * by the unit test so a renamed label cannot quietly become an unwritable id.
 */
export const REPORT_REASONS: readonly ReportReasonOption[] = [
  { id: "spam", label: "Спам" },
  { id: "abuse", label: "Оскорбления" },
  { id: "violence", label: "Насилие" },
  { id: "sexual", label: "Порнография" },
  { id: "child_safety", label: "Угроза ребёнку" },
  { id: "other", label: "Другое" },
];

/** Whether a value is one of the six the CHECK constraint will accept. */
export function isReportReason(value: unknown): value is ReportReasonId {
  return typeof value === "string" && REPORT_REASONS.some((reason) => reason.id === value);
}

/** The label for one reason, or the empty string for anything else. */
export function reportReasonLabel(id: unknown): string {
  return REPORT_REASONS.find((reason) => reason.id === id)?.label ?? "";
}

/**
 * `content_reports_note_length` counts **characters**, not UTF-16 code units.
 *
 * `char_length(note) <= 1000` in Postgres is code points; `String.length` in
 * JavaScript is code units, and an emoji costs two of those. A note cut to
 * 1000 by `.slice()` can still be 1000 characters — or fewer than the person
 * typed — so the cut below counts the same units the constraint does.
 */
export const REPORT_NOTE_MAX = 1000;

/**
 * The note as the insert may carry it: trimmed, cut by code point, or absent.
 *
 * `null` rather than `""` for an empty one, because the column is nullable and
 * a blank string is a note nobody wrote.
 */
export function normalizeReportNote(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const points = Array.from(trimmed);
  return points.length <= REPORT_NOTE_MAX ? trimmed : points.slice(0, REPORT_NOTE_MAX).join("");
}

/** How many characters are left, counted the way the constraint counts them. */
export function reportNoteRemaining(value: string | null | undefined): number {
  return REPORT_NOTE_MAX - Array.from((value ?? "").trim()).length;
}

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

export interface ConfirmPrompt {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

/**
 * The name a question uses when the person has none the reader would recognise.
 * The same fallback `sanctionLiftPrompt` uses, so the two read alike.
 */
const SOMEBODY = "этого пользователя";

function named(personName: string | null | undefined): string {
  return (personName ?? "").trim() || SOMEBODY;
}

/**
 * What «Заблокировать» asks before it writes the row.
 *
 * Ending somebody's ability to write to you is far-reaching, so it is asked
 * rather than done — and the question has to describe what the database
 * actually does, which is narrower than what «заблокировать» suggests
 * elsewhere. It stops one thing: writing to you in a private chat. It does not
 * hide the person's profile, their name or the messages they have already sent;
 * it does not reach a group or a channel, because a group is somebody else's
 * room and silencing a member of one is the administrator's decision; and
 * nothing tells them it happened.
 *
 * Every clause is a fact of the shipped migration. Promising more here would be
 * the product lying about its own rules.
 */
export function blockPrompt(personName: string | null | undefined): ConfirmPrompt {
  const name = named(personName);
  return {
    title: "Заблокировать пользователя?",
    description:
      `${name} больше не сможет писать вам в личной переписке и не узнает об этом. ` +
      "Ваша переписка, профиль и все прежние сообщения останутся на месте, " +
      "а в группах и каналах ничего не изменится.",
    confirmLabel: "Заблокировать",
    cancelLabel: "Отмена",
  };
}

/** And what «Разблокировать» asks. One sentence, because it only gives back. */
export function unblockPrompt(personName: string | null | undefined): ConfirmPrompt {
  const name = named(personName);
  return {
    title: "Разблокировать пользователя?",
    description: `${name} снова сможет писать вам в личной переписке.`,
    confirmLabel: "Разблокировать",
    cancelLabel: "Отмена",
  };
}

/** The two labels the control itself carries, so no surface invents a third. */
export const BLOCK_LABEL = "Заблокировать";
export const UNBLOCK_LABEL = "Разблокировать";
export const REPORT_LABEL = "Пожаловаться";

/**
 * The heading of the reason picker, by what is being reported.
 *
 * Not «Пожаловаться на сообщение», which is what the control says: photographed
 * at 390 it came out «Пожаловаться на сообщен…», and a truncated heading is a
 * heading that has stopped saying which of the two dialogs this is. The control
 * keeps the verb; the heading is the noun.
 */
export function reportDialogTitle(kind: ReportKind): string {
  return kind === "message" ? "Жалоба на сообщение" : "Жалоба на пользователя";
}

/**
 * Where a report goes, said out loud.
 *
 * A person who reports something should know it reaches a human and not a
 * counter. The second sentence is the other half of the same honesty: the
 * database notifies nobody, so the person reported is not told.
 */
export const REPORT_STAFF_NOTICE =
  "Жалобу прочитает администрация LETSCUBE. Тот, на кого вы жалуетесь, уведомления не получит.";

/** The optional note's caption and placeholder. */
export const REPORT_NOTE_LABEL = "Комментарий (необязательно)";
export const REPORT_NOTE_PLACEHOLDER = "Что именно не так";

// ---------------------------------------------------------------------------
// What a refusal is allowed to say
// ---------------------------------------------------------------------------

/**
 * The one sentence a blocked sender sees.
 *
 * Not «Недостаточно прав для отправки сообщения», which is what the ack mapper
 * answers for a 42501 and which describes the machine's answer rather than the
 * situation; and never the Postgres text behind it.
 */
export const BLOCKED_SEND_REFUSAL = "Пользователь ограничил переписку.";

/** The confirmation, through the product's own feedback queue. */
export const REPORT_SENT_TITLE = "Жалоба отправлена";
export const REPORT_SENT_DETAIL = "Её прочитает администрация LETSCUBE.";

/** 23505 on `content_reports_one_per_message_idx`. */
export const REPORT_DUPLICATE_MESSAGE = "Вы уже пожаловались на это сообщение.";

/** 23505 on `content_reports_one_open_per_person_idx`, which allows one **open** report. */
export const REPORT_DUPLICATE_PERSON = "Вы уже пожаловались на этого пользователя.";

/** A refused insert into the queue: the person writing is banned. */
export const REPORT_REFUSED = "Сейчас отправить жалобу нельзя.";

/** Anything else, once the mapper's answer has been through the plain filter. */
export const REPORT_FAILED = "Не удалось отправить жалобу. Попробуйте ещё раз.";

export const BLOCK_FAILED = "Не удалось заблокировать пользователя";
export const UNBLOCK_FAILED = "Не удалось разблокировать пользователя";
export const BLOCKS_READ_FAILED = "Не удалось загрузить список заблокированных";

/** What the settings list says when there is nobody in it. */
export const BLOCKS_EMPTY = "Вы никого не заблокировали.";

/** And the one line under its heading, which is the whole rule in a sentence. */
export const BLOCKS_HINT = "Эти люди не могут писать вам в личной переписке.";

export const BLOCKS_ROW_LABEL = "Заблокированные";

/** The settings row's value: how many, or that there are none. */
export function blockedCountSummary(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "Никого";
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return `${count} человек`;
  if (last === 1) return `${count} человек`;
  if (last >= 2 && last <= 4) return `${count} человека`;
  return `${count} человек`;
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/**
 * What a write against `user_blocks`, `content_reports` or `messages` did.
 *
 *   - `duplicate` — a unique index said the row is already there (23505);
 *   - `refused` — a policy said no (42501, or the row-level-security text);
 *   - `failed` — anything else, including a dead network.
 */
export type PersonalWriteOutcome = "duplicate" | "refused" | "failed";

export const DUPLICATE_SQLSTATE = "23505";
export const REFUSED_SQLSTATE = "42501";

function errorField(error: unknown, key: string): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * Which of the three a caught error is.
 *
 * The code is read first because it is the fact; the message is read only as a
 * fallback, since PostgREST has been known to pass a constraint violation
 * through with the code on a nested field. The two message probes are the exact
 * texts Postgres produces — «duplicate key value violates unique constraint»
 * and «new row violates row-level security policy» — lower-cased before
 * comparison, and nothing else is guessed at.
 */
export function classifyPersonalWriteError(error: unknown): PersonalWriteOutcome {
  if (typeof error === "string") return classifyPersonalWriteError({ message: error });
  const code = errorField(error, "code").toUpperCase();
  if (code === DUPLICATE_SQLSTATE) return "duplicate";
  if (code === REFUSED_SQLSTATE) return "refused";
  const message = errorField(error, "message").toLocaleLowerCase("en-US");
  if (!message) return "failed";
  if (message.includes("duplicate key value")) return "duplicate";
  if (message.includes("row-level security") || message.includes("row level security")) return "refused";
  return "failed";
}

/**
 * What the reason picker says when the insert did not go through.
 *
 * `mapped` is whatever the product's error mapper made of it, and it is passed
 * through `plainMessage` rather than printed: a mapper that learns a new
 * internal must not be able to put a table name on this dialog.
 */
export function reportRefusalText(
  kind: ReportKind,
  outcome: PersonalWriteOutcome,
  mapped?: string | null,
): string {
  if (outcome === "duplicate") {
    return kind === "message" ? REPORT_DUPLICATE_MESSAGE : REPORT_DUPLICATE_PERSON;
  }
  if (outcome === "refused") return REPORT_REFUSED;
  return plainMessage(mapped, REPORT_FAILED);
}

/** The same for a block and an unblock, where the mapper's answer is worth keeping. */
export function blockRefusalText(mapped?: string | null): string {
  return plainFailure(mapped, `${BLOCK_FAILED}. Попробуйте ещё раз.`);
}

export function unblockRefusalText(mapped?: string | null): string {
  return plainFailure(mapped, `${UNBLOCK_FAILED}. Попробуйте ещё раз.`);
}

export function blocksReadFailureText(mapped?: string | null): string {
  return plainFailure(mapped, `${BLOCKS_READ_FAILED}. Попробуйте позже.`);
}

/**
 * Whether a failed send was the block, and the sentence if it was.
 *
 * Scoped to a **private** chat on purpose: the restrictive policy only exists
 * there, so a 42501 anywhere else cannot be this. Within a private chat the
 * other two restrictive policies on `public.messages` are the ban and the mute,
 * and neither can reach this code path — a banned account never gets past
 * `App.tsx`, and a muted one is shown the mute notice **instead of** the
 * composer (`MessageInput` returns it before the field is drawn). So inside a
 * private chat a refused insert is this refusal.
 *
 * Returns `null` rather than a sentence when it is not, so the caller keeps
 * whatever it said before; this must never become a catch-all that relabels
 * every send failure.
 */
export function blockedSendRefusal(input: {
  chatType: string | null | undefined;
  error: unknown;
}): string | null {
  if (input.chatType !== "private") return null;
  return classifyPersonalWriteError(input.error) === "refused" ? BLOCKED_SEND_REFUSAL : null;
}

// ---------------------------------------------------------------------------
// What the surfaces may offer
// ---------------------------------------------------------------------------

/**
 * Whether the block control belongs on this chat at all.
 *
 * A private chat with somebody else, and only that. Saved Messages is yourself;
 * a group is somebody else's room; and a chat whose other member is not known
 * yet has nobody to block.
 */
export function canBlockInChat(input: {
  chatType: string | null | undefined;
  isSaved: boolean;
  otherUserId: string | null | undefined;
  currentUserId: string | null | undefined;
}): boolean {
  if (input.chatType !== "private" || input.isSaved) return false;
  const other = input.otherUserId ?? null;
  if (!other) return false;
  return other !== (input.currentUserId ?? null);
}

/**
 * Whether «Пожаловаться» belongs in this message's menu.
 *
 * Not on your own message — there is nobody to report, and
 * `content_reports_not_self` would refuse the row anyway. Not on a message that
 * has not reached the server, because a report names a `message_id` the queue
 * has to be able to open. Not on one that is already gone.
 *
 * And not on a bot's message, which is what the `authorId` guard really does:
 * `content_reports.target_user_id` references `profiles(id)` and is NOT NULL,
 * while a bot's message carries `user_id = null` (`resolveMessageActor`). There
 * is no row a report about a bot could be written as, so the item is not
 * offered rather than offered and refused. A bot is reported to its owner
 * through the bot platform, which is a different queue.
 */
export function canReportMessage(input: {
  own: boolean;
  localSend: boolean;
  deleted: boolean;
  authorId: string | null | undefined;
  currentUserId: string | null | undefined;
}): boolean {
  if (input.own || input.localSend || input.deleted) return false;
  const author = input.authorId ?? null;
  if (!author) return false;
  return author !== (input.currentUserId ?? null);
}

/**
 * Every sentence this module can put on screen, for the test that asserts none
 * of them explains the machine. The same shape `plainMessages.ts` uses.
 */
export const PERSONAL_MODERATION_MESSAGES: readonly string[] = [
  BLOCKED_SEND_REFUSAL,
  REPORT_SENT_TITLE,
  REPORT_SENT_DETAIL,
  REPORT_DUPLICATE_MESSAGE,
  REPORT_DUPLICATE_PERSON,
  REPORT_REFUSED,
  REPORT_FAILED,
  REPORT_STAFF_NOTICE,
  BLOCKS_EMPTY,
  BLOCKS_HINT,
  blockRefusalText(null),
  unblockRefusalText(null),
  blocksReadFailureText(null),
];
