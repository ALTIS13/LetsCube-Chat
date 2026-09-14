/**
 * The staff queue over `public.content_reports`, as words and rules.
 *
 * The database half shipped on 2026-09-14
 * (`20260914120000_personal_blocks_and_reports.sql`). Four of its decisions are
 * measured facts this module is built to rather than guesses, and each of them
 * changes what the screen may say:
 *
 *   - **Only staff read the table.** The SELECT policy is
 *     `is_manager_or_admin(auth.uid())`; everybody else, the person who filed
 *     the report included, sees zero rows. So the reporter's name exists only
 *     on this screen, and this screen is inside the administration's own gate.
 *   - **Staff resolve by UPDATE, and the grant is column-level**: `status`,
 *     `handled_by`, `handled_at` and nothing else. An attempt to change `note`
 *     or `reason` is refused by the grant. `reportResolutionPatch` is therefore
 *     the only shape a write may take, and it is a function rather than an
 *     object literal at four call sites so that a fifth cannot quietly add a
 *     field the server will reject — or, worse, one it would accept.
 *   - **A report about a message always carries `message_id`**, and one about a
 *     person never does. That is a CHECK constraint, so `reportedMessageView`
 *     can treat "no message row came back" as something other than "this is a
 *     report about a person".
 *   - `content_reports_status_created_idx` is `(status, created_at desc)` —
 *     the queue's natural order, which the read below asks for and
 *     `sortReportQueue` only re-ranks across statuses.
 *
 * The fifth fact is the one that shapes the message quote, and it is not in
 * that migration. `public.messages` carries exactly one SELECT policy —
 * «Chat members can view messages», `is_chat_member(chat_id)`, from
 * `20260504_chats_membership_hardening.sql`. A moderator is not a member of
 * somebody else's private chat, so the join returns **nothing** for most
 * reports, and nothing is not evidence of deletion. Saying «Сообщение удалено»
 * there would be the D-140 mistake in its purest form: treating an empty answer
 * as an answer. The two states are separate below and read differently.
 *
 * Kept free of React and Supabase so `node --test` can load it; it imports one
 * module, `adminPrompts.ts`, which itself imports only `plainMessages.ts`.
 */

import { adminPersonLabel, type AdminConfirmPrompt } from "./adminPrompts.ts";

// ---------------------------------------------------------------------------
// The vocabulary of the table
// ---------------------------------------------------------------------------

export type ContentReportStatus = "new" | "reviewing" | "actioned" | "dismissed";
export type ContentReportReason =
  | "spam"
  | "abuse"
  | "violence"
  | "sexual"
  | "child_safety"
  | "other";
export type ContentReportKind = "message" | "user";

/** Every value `content_reports_status_check` allows, in queue order. */
export const CONTENT_REPORT_STATUSES: readonly ContentReportStatus[] = [
  "new",
  "reviewing",
  "actioned",
  "dismissed",
];

/**
 * The reasons, in Russian.
 *
 * `child_safety` is spelled out rather than shortened to «Дети»: it is the one
 * reason where a moderator skim-reading the wrong word costs the most, and the
 * Microsoft Store questionnaire that prompted this feature asks about it by
 * name.
 */
export const REPORT_REASON_LABEL: Record<ContentReportReason, string> = {
  spam: "Спам",
  abuse: "Оскорбления и травля",
  violence: "Насилие и угрозы",
  sexual: "Материалы сексуального характера",
  child_safety: "Угроза безопасности детей",
  other: "Другое",
};

/**
 * A reason as the screen shows it.
 *
 * The column is `text` with a CHECK rather than an enum, so a value added to
 * the constraint before this map learns it would render as an empty cell. It
 * renders as itself instead: unfamiliar, but not invisible.
 */
export function reportReasonLabel(reason: string | null | undefined): string {
  const value = (reason ?? "").trim();
  if (!value) return REPORT_REASON_LABEL.other;
  return REPORT_REASON_LABEL[value as ContentReportReason] ?? value;
}

export const REPORT_STATUS_LABEL: Record<ContentReportStatus, string> = {
  new: "Новая",
  reviewing: "В работе",
  actioned: "Меры приняты",
  dismissed: "Отклонена",
};

export function reportStatusLabel(status: string | null | undefined): string {
  const value = (status ?? "").trim();
  // The column defaults to 'new', so an absent one is a new report rather than
  // a blank chip; an unfamiliar one renders as itself, like a reason does.
  if (!value) return REPORT_STATUS_LABEL.new;
  return REPORT_STATUS_LABEL[value as ContentReportStatus] ?? value;
}

/**
 * The chip's tone. `KubBadge` carries a dot, a border and a word, so this is
 * never the only carrier of meaning — which is why `actioned` and `dismissed`
 * may share the muted tone without becoming indistinguishable.
 */
export function reportStatusTone(
  status: string | null | undefined,
): "danger" | "warn" | "muted" | "online" {
  switch ((status ?? "").trim()) {
    case "new":
      return "danger";
    case "reviewing":
      return "warn";
    case "actioned":
      return "online";
    default:
      return "muted";
  }
}

/** What a report about a message is, against what a report about a person is. */
export function reportKindLabel(kind: string | null | undefined): string {
  return (kind ?? "").trim() === "message" ? "о сообщении" : "о пользователе";
}

// ---------------------------------------------------------------------------
// The filter by status
// ---------------------------------------------------------------------------

export type ReportStatusFilter = "open" | "all" | ContentReportStatus;

/** What is waiting: nobody has looked, or somebody has and has not finished. */
export const OPEN_REPORT_STATUSES: readonly ContentReportStatus[] = ["new", "reviewing"];

/**
 * The tab opens on what is open.
 *
 * A queue that opens on everything buries three new reports under six months of
 * closed ones, and the person on duty is here for the three.
 */
export const DEFAULT_REPORT_STATUS_FILTER: ReportStatusFilter = "open";

export const REPORT_STATUS_FILTER_LABEL: Record<ReportStatusFilter, string> = {
  open: "Новые и в работе",
  all: "Все",
  new: "Только новые",
  reviewing: "Только в работе",
  actioned: "Закрытые с мерами",
  dismissed: "Отклонённые",
};

/** The order the select offers them in. */
export const REPORT_STATUS_FILTERS: readonly ReportStatusFilter[] = [
  "open",
  "new",
  "reviewing",
  "actioned",
  "dismissed",
  "all",
];

/**
 * The statuses a filter asks the server for, or `null` for «no condition».
 *
 * `null` rather than «all four listed» so the read can drop the `.in(...)`
 * entirely: a filter that enumerates every allowed value would silently stop
 * matching the day a fifth is added to the CHECK constraint, and a queue that
 * hides rows it does not recognise is the worst failure this screen has.
 */
export function reportStatusFilterValues(
  filter: ReportStatusFilter,
): readonly ContentReportStatus[] | null {
  if (filter === "all") return null;
  if (filter === "open") return OPEN_REPORT_STATUSES;
  return [filter];
}

/** Whether this filter is narrowing anything, i.e. whether a chip is owed. */
export function reportFilterIsNarrowing(filter: ReportStatusFilter): boolean {
  return filter !== "all";
}

/**
 * Whether a row still belongs to the list it is sitting in.
 *
 * Resolving a report under «Новые и в работе» moves it out of that list, and
 * the row has to go with it — a dismissed report left visible under a filter
 * that excludes dismissed ones is the list disagreeing with its own heading,
 * and the next read would remove it anyway, seconds later, for no reason the
 * reader can see.
 */
export function reportMatchesFilter(
  status: string | null | undefined,
  filter: ReportStatusFilter,
): boolean {
  const values = reportStatusFilterValues(filter);
  if (values === null) return true;
  return values.includes((status ?? "").trim() as ContentReportStatus);
}

// ---------------------------------------------------------------------------
// The order somebody on duty needs
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<ContentReportStatus, number> = {
  new: 0,
  reviewing: 1,
  actioned: 2,
  dismissed: 3,
};

function statusRank(status: string | null | undefined): number {
  const value = (status ?? "").trim();
  // An unrecognised status sorts after everything known rather than first: it
  // is not «new», and pretending it is would put it above real work.
  return STATUS_RANK[value as ContentReportStatus] ?? 9;
}

/**
 * New first, newest first.
 *
 * The read already asks the server for `created_at desc`, which the index
 * serves; this only re-ranks across statuses, which no single-column index can
 * express and which alphabetical order gets exactly backwards — `actioned`
 * sorts before `new`.
 *
 * A copy rather than a sort in place: the rows are React state.
 */
export function sortReportQueue<T extends { status?: string | null; created_at?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.slice().sort((left, right) => {
    const byStatus = statusRank(left.status) - statusRank(right.status);
    if (byStatus !== 0) return byStatus;
    const leftAt = Date.parse(left.created_at ?? "");
    const rightAt = Date.parse(right.created_at ?? "");
    // An unreadable date must not jump the queue in either direction; it keeps
    // the order the server gave it.
    if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) return 0;
    return rightAt - leftAt;
  });
}

// ---------------------------------------------------------------------------
// What was reported
// ---------------------------------------------------------------------------

export type ReportedMessageView =
  /** A report about a person: there is no message and never was one. */
  | { readonly kind: "none" }
  /** The message's own text, which is what a decision is usually made on. */
  | { readonly kind: "text"; readonly text: string }
  /** A message with no text — media, a sticker, a circle. */
  | { readonly kind: "attachment" }
  /** The row came back and says it was deleted after the report was filed. */
  | { readonly kind: "deleted" }
  /**
   * The report names a message that no longer exists at all.
   *
   * `content_reports.message_id` is ON DELETE SET NULL, and
   * `messages_chat_id_fkey` is ON DELETE CASCADE, so this is what a report
   * looks like after somebody deleted the chat its message lived in. It is
   * a third fact, not a spelling of the other two: «deleted» is a row that
   * came back and said so itself, «unreadable» is this reader not being in
   * the chat, and this is nothing left to read for anybody.
   */
  | { readonly kind: "gone" }
  /** No row came back. Not the same thing, and it is the common case. */
  | { readonly kind: "unreadable" };

/**
 * «Сообщение удалено» is a claim, not a fallback.
 *
 * The only SELECT policy on `public.messages` is `is_chat_member(chat_id)`, so
 * a moderator who is not in the chat gets no row — the same empty answer a
 * deleted message would give if the row were gone. The two are told apart by
 * where the emptiness is: `deleted_at` on a row that came back is the product
 * saying so; no row at all is this reader not being allowed to look.
 */
export function reportedMessageView(report: {
  kind?: string | null;
  /**
   * Required rather than optional on purpose. A caller that does not select
   * this column cannot tell a deleted message from one it may not read, and
   * would quietly answer «unreadable» — which blames the reader for an
   * absence that is not theirs. Making it part of the type turns forgetting
   * it into a compiler error instead.
   */
  message_id: string | null;
  message?: { content?: string | null; deleted_at?: string | null } | null;
}): ReportedMessageView {
  if ((report.kind ?? "").trim() !== "message") return { kind: "none" };
  if (!report.message_id) return { kind: "gone" };
  const message = report.message;
  if (!message) return { kind: "unreadable" };
  if (message.deleted_at) return { kind: "deleted" };
  const text = (message.content ?? "").trim();
  return text ? { kind: "text", text } : { kind: "attachment" };
}

export const REPORTED_MESSAGE_DELETED = "Сообщение удалено после жалобы.";
export const REPORTED_MESSAGE_GONE = "Сообщение удалено безвозвратно: от него ничего не осталось.";
export const REPORTED_MESSAGE_ATTACHMENT = "В сообщении нет текста — вложение или медиа.";
/**
 * Deliberately says why, because the reason is actionable: a moderator who is
 * in the chat sees the text, and one who is not needs to know that the blank is
 * about them rather than about the message.
 */
export const REPORTED_MESSAGE_UNREADABLE =
  "Текст сообщения недоступен: его видят только участники чата.";

/** How much of a reported message the row quotes before it is folded. */
export const REPORTED_MESSAGE_PREVIEW_LIMIT = 400;

/**
 * The sentence a view with nothing to quote puts in place of the quote.
 *
 * Here rather than in the tab because it is a decision made of words, and
 * because a chain of four ternaries in JSX is where a fifth state gets the
 * fourth one's sentence. Every case is listed, so adding a state to the union
 * without deciding what it says stops compiling.
 */
export function reportedMessageNotice(view: ReportedMessageView): string {
  switch (view.kind) {
    case "text":
    case "none":
      return "";
    case "deleted":
      return REPORTED_MESSAGE_DELETED;
    case "gone":
      return REPORTED_MESSAGE_GONE;
    case "attachment":
      return REPORTED_MESSAGE_ATTACHMENT;
    case "unreadable":
      return REPORTED_MESSAGE_UNREADABLE;
  }
}

/** The quote, bounded, with an honest ellipsis when it was cut. */
export function reportedMessagePreview(text: string, limit = REPORTED_MESSAGE_PREVIEW_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// What to do about it
// ---------------------------------------------------------------------------

/** The three decisions, which are also the three statuses staff can write. */
export type ReportResolution = "reviewing" | "actioned" | "dismissed";

export const REPORT_RESOLUTIONS: readonly ReportResolution[] = [
  "reviewing",
  "actioned",
  "dismissed",
];

export const REPORT_RESOLUTION_LABEL: Record<ReportResolution, string> = {
  reviewing: "Взять в работу",
  actioned: "Меры приняты",
  dismissed: "Отклонить",
};

/**
 * Which of the three this row is allowed to be given.
 *
 * The rule is one line and it is the same one `canLiftSanctionRow` follows: an
 * action with no effect is not offered. A report already «В работе» cannot be
 * taken into work, and that is the whole condition — everything else stays,
 * which is what makes a mistaken «Отклонить» recoverable from the row it
 * happened on rather than from the database.
 */
export function reportActions(status: string | null | undefined): readonly ReportResolution[] {
  const current = (status ?? "").trim();
  return REPORT_RESOLUTIONS.filter((resolution) => resolution !== current);
}

/**
 * The whole write, and the only shape of it.
 *
 * Three columns because three is what `grant update (status, handled_by,
 * handled_at)` allows; a fourth would be refused by the grant rather than by
 * politeness. But the reason it is refused matters more than the fact: `note`
 * and `reason` are somebody's testimony about what happened to them, and a
 * moderation queue that can edit the complaint it is deciding cannot be
 * audited afterwards. So this function exists to make the shape provable from
 * a test, and the tab writes nothing that did not come out of it.
 *
 * `handled_by` is stamped by all three, «Взять в работу» included: the useful
 * question a second moderator has is not «was this closed» but «is somebody
 * already on it».
 */
export function reportResolutionPatch(
  resolution: ReportResolution,
  staffId: string,
  now: Date,
): { status: ReportResolution; handled_by: string; handled_at: string } {
  return {
    status: resolution,
    handled_by: staffId,
    handled_at: now.toISOString(),
  };
}

/** Every column name a resolution may write, for the test that pins the grant. */
export const REPORT_RESOLUTION_COLUMNS: readonly string[] = ["handled_at", "handled_by", "status"];

const CANCEL = "Отмена";

/**
 * What to ask before each of the three.
 *
 * Far-reaching or not, each is a decision recorded against a person under the
 * name of the person who made it, and this product asks before those; the shape
 * is `AdminConfirmPrompt`, so the administration's own test pins the question
 * mark, the named confirm button and «Отмена» for these too.
 *
 * Only «Меры приняты» is marked danger, and the reason is not that it is the
 * loudest. It is the only one of the three that cannot be undone by meaning:
 * it asserts, in the record, that something was done about a person. The other
 * two are one press from being reversed on the row they happened on — the
 * screen offers «Взять в работу» on a dismissed report precisely so that
 * dismissing is not a trapdoor — and spending the red on all three would leave
 * nothing marking the one that makes a claim.
 */
export function reportResolutionPrompt(
  resolution: ReportResolution,
  reportedName: string | null | undefined,
): AdminConfirmPrompt {
  const person = adminPersonLabel(reportedName);
  if (resolution === "reviewing") {
    return {
      title: "Взять жалобу в работу?",
      description:
        `Жалоба на ${person} перейдёт в «В работе» и будет отмечена вашим именем, ` +
        "чтобы её не разбирал второй сотрудник. Для самого пользователя ничего не изменится.",
      confirmLabel: "Взять в работу",
      cancelLabel: CANCEL,
      tone: "default",
    };
  }
  if (resolution === "actioned") {
    return {
      title: "Отметить, что меры приняты?",
      description:
        `Жалоба на ${person} закроется как разобранная, с вашим именем и временем. ` +
        "Это только отметка в очереди: блокировку или мьют выдают во вкладке «Блокировки».",
      confirmLabel: "Меры приняты",
      cancelLabel: CANCEL,
      tone: "danger",
    };
  }
  return {
    title: "Отклонить жалобу?",
    description:
      `Жалоба на ${person} закроется без мер и уйдёт из списка открытых. ` +
      "Тот, кто её отправил, не получит уведомления, а вернуть её в работу можно здесь же.",
    confirmLabel: "Отклонить жалобу",
    cancelLabel: CANCEL,
    tone: "default",
  };
}

/** Every question this module can produce, for the shared-shape test. */
export const EVERY_REPORT_PROMPT: readonly AdminConfirmPrompt[] = REPORT_RESOLUTIONS.map(
  (resolution) => reportResolutionPrompt(resolution, "Фиктивный Участник"),
);

// ---------------------------------------------------------------------------
// What the screen says when there is nothing, or when it could not look
// ---------------------------------------------------------------------------

/**
 * The read was refused. One sentence about availability, naming nothing
 * internal — the rule `plainMessages.ts` holds for the whole product.
 */
export const ADMIN_REPORTS_UNAVAILABLE = "Жалобы сейчас недоступны. Попробуйте позже.";

/** A write that the server accepted for zero rows, which is a refusal. */
export const REPORT_RESOLVE_FORBIDDEN =
  "Не удалось изменить статус жалобы: недостаточно прав.";
export const REPORT_RESOLVE_FAILED = "Не удалось изменить статус жалобы";

/**
 * Who can see this queue at all, said on the screen rather than only in a
 * comment.
 *
 * It is the one fact about this table a moderator cannot discover by using it:
 * the person who reported cannot read their own report, so nobody outside this
 * tab knows it exists, or that it was opened, or how it was closed.
 */
export const REPORTS_PRIVACY_NOTE =
  "Жалобы видны только сотрудникам. Тот, кто пожаловался, не видит ни свою жалобу, ни её статус, и не получает уведомлений.";

/** «Ничего нет» has to name the filter, or it claims more than it knows. */
export function reportsEmptyTitle(filter: ReportStatusFilter): string {
  switch (filter) {
    case "open":
      return "Открытых жалоб нет";
    case "all":
      return "Жалоб пока нет";
    case "new":
      return "Новых жалоб нет";
    case "reviewing":
      return "В работе ничего нет";
    case "actioned":
      return "Закрытых с мерами нет";
    default:
      return "Отклонённых жалоб нет";
  }
}

/**
 * Only where a new report would land in the list being looked at. Under
 * «Отклонённые» it would be a promise about a different screen.
 */
export function reportsEmptyHint(filter: ReportStatusFilter): string | null {
  const values = reportStatusFilterValues(filter);
  const showsNew = values === null || values.includes("new");
  return showsNew ? "Новые жалобы появляются здесь сами, без обновления страницы." : null;
}

/** Every sentence this module puts on screen, for the internals test. */
export const REPORT_QUEUE_MESSAGES: readonly string[] = [
  ADMIN_REPORTS_UNAVAILABLE,
  REPORT_RESOLVE_FORBIDDEN,
  REPORTS_PRIVACY_NOTE,
  REPORTED_MESSAGE_DELETED,
  REPORTED_MESSAGE_ATTACHMENT,
  REPORTED_MESSAGE_UNREADABLE,
];
