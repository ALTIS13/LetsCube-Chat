/**
 * What the support workspace's controls require, and how it says so (D-144).
 *
 * Five separate complaints in the register, one shape: a control that knows its
 * rule and keeps it. «Подтвердить» sat disabled until three characters were
 * typed with nothing to say so; «Сохранить» in «Настройки поддержки» the same;
 * the composer told a closed ticket to be accepted first; the permission it
 * named does not exist under that name; and the history and the queue reported
 * events and assignments without saying who.
 *
 * Every bound below was read off production on 2026-09-15 rather than copied
 * from the component, and **that is how the sixth defect turned up.** The
 * editor's textarea carries `maxLength={4_000}` for all five actions, but only
 * two of the five functions accept that much:
 *
 *     support_ticket_transfer        length(v_comment) not between 3 and 1000
 *     support_ticket_return_to_pool  length(v_reason)  not between 3 and 1000
 *     support_ticket_escalate        length(v_reason)  not between 3 and 1000
 *     support_ticket_resolve         length(v_summary) not between 3 and 4000
 *     support_ticket_close           length(v_summary) not between 3 and 4000
 *
 * So a 1500-character reason for a transfer could be typed in full and was then
 * refused by the server as `invalid_support_transfer`. Not in the register; it
 * exists because the field's ceiling was one number written once for a screen
 * that calls five different functions.
 *
 * The module is a plain one — no React, no client — so `node --test` can reach
 * every decision. That is the same boundary lesson as `lib/listReadState.ts`:
 * a rule that can only be exercised by mounting a page is not tested, and
 * moving it is cheaper than building a harness around it.
 */

/** The workflow actions that open the inline editor. */
export type SupportEditorAction = "transfer" | "return" | "escalate" | "resolve" | "close";

export interface SupportTextBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * The server's own bounds, per action.
 *
 * Keyed by the client's action name; the comment names the function each one
 * reaches, because the two vocabularies differ and a reader checking this
 * against the database needs the database's word.
 */
export const SUPPORT_ACTION_TEXT_BOUNDS: Record<SupportEditorAction, SupportTextBounds> = {
  /** `support_ticket_transfer(p_comment)` */
  transfer: { min: 3, max: 1000 },
  /** `support_ticket_return_to_pool(p_reason)` */
  return: { min: 3, max: 1000 },
  /** `support_ticket_escalate(p_reason)` */
  escalate: { min: 3, max: 1000 },
  /** `support_ticket_resolve(p_summary)` */
  resolve: { min: 3, max: 4000 },
  /** `support_ticket_close(p_summary)` */
  close: { min: 3, max: 4000 },
};

/** What the field is called on screen, which is also what the requirement is about. */
export function supportActionFieldLabel(action: SupportEditorAction): string {
  return action === "resolve" || action === "close" ? "Итог" : "Причина";
}

/**
 * The same word inside «Опишите …», which is a different case in Russian.
 *
 * Written out rather than derived. The first version lower-cased the label and
 * produced «Опишите причина», which the test caught: `toLocaleLowerCase` is not
 * a declension, and a sentence built by folding case is only ever right by
 * accident.
 */
const ACTION_FIELD_ACCUSATIVE: Record<SupportEditorAction, string> = {
  transfer: "причину",
  return: "причину",
  escalate: "причину",
  resolve: "итог",
  close: "итог",
};

/**
 * The requirement, beside the field, before anything is typed.
 *
 * Shown always rather than on failure: the point of the complaint is that the
 * button was already unavailable and the screen was silent about why.
 */
export function supportActionFieldHint(action: SupportEditorAction): string {
  const bounds = SUPPORT_ACTION_TEXT_BOUNDS[action];
  return `От ${bounds.min} до ${bounds.max} символов. Текст попадёт в историю обращения.`;
}

export interface SupportActionDraft {
  readonly action: SupportEditorAction;
  readonly comment: string;
  /** Only `transfer` uses it; empty means «nobody chosen yet». */
  readonly operatorId?: string | null;
}

/**
 * Why «Подтвердить» cannot be pressed, or null when it can.
 *
 * The order is the order a person fills the editor in: the colleague first,
 * because the select is above the text, then the text.
 */
export function supportActionBlocker(draft: SupportActionDraft): string | null {
  const bounds = SUPPORT_ACTION_TEXT_BOUNDS[draft.action];
  if (draft.action === "transfer" && !(draft.operatorId ?? "").trim()) {
    return "Выберите коллегу, которому передаёте обращение.";
  }
  const text = draft.comment.trim();
  if (text.length < bounds.min) {
    return `Опишите ${ACTION_FIELD_ACCUSATIVE[draft.action]}: не меньше ${bounds.min} символов.`;
  }
  if (text.length > bounds.max) {
    return `Слишком длинно: не больше ${bounds.max} символов.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// «Настройки поддержки» (A-69)
// ---------------------------------------------------------------------------

export interface SupportSettingsDraft {
  readonly closedMessage: string;
  readonly ticketLimit15m: number;
  readonly ticketLimitDay: number;
  readonly messageLimit5m: number;
  readonly messageLimitDay: number;
}

/**
 * `support_settings_update_v2`, read off production on 2026-09-15:
 *
 *     if length(v_closed_message) not between 3 and 500
 *        or p_ticket_limit_15m  not between 1 and 50
 *        or p_ticket_limit_day  not between 1 and 500
 *        or p_ticket_limit_day  < p_ticket_limit_15m
 *        or p_message_limit_5m  not between 1 and 200
 *        or p_message_limit_day not between 1 and 5000
 *        or p_message_limit_day < p_message_limit_5m then
 *       raise exception 'invalid_support_settings';
 *
 * The screen's own predicate already matched this, which is worth recording:
 * the defect here is silence, not a wrong gate. The gate was checked against
 * the database before being copied — the older `support_settings_update`, still
 * present, takes no message limits at all and would have produced a mirror that
 * refused two fields the product really does save. The client calls the `_v2`.
 */
export function supportSettingsBlocker(draft: SupportSettingsDraft): string | null {
  const message = draft.closedMessage.trim();
  if (message.length < 3) return "Сообщение при закрытом приёме — не меньше 3 символов.";
  if (message.length > 500) return "Сообщение при закрытом приёме — не больше 500 символов.";
  if (!inRange(draft.ticketLimit15m, 1, 50)) return "Новых обращений за 15 минут — от 1 до 50.";
  if (!inRange(draft.ticketLimitDay, 1, 500)) return "Новых обращений за сутки — от 1 до 500.";
  if (draft.ticketLimitDay < draft.ticketLimit15m) {
    return "Суточный лимит обращений не может быть меньше лимита за 15 минут.";
  }
  if (!inRange(draft.messageLimit5m, 1, 200)) return "Сообщений за 5 минут — от 1 до 200.";
  if (!inRange(draft.messageLimitDay, 1, 5000)) return "Сообщений за сутки — от 1 до 5000.";
  if (draft.messageLimitDay < draft.messageLimit5m) {
    return "Суточный лимит сообщений не может быть меньше лимита за 5 минут.";
  }
  return null;
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}

// ---------------------------------------------------------------------------
// The composer's notice (A-63)
// ---------------------------------------------------------------------------

export type SupportTicketState =
  | "new"
  | "in_progress"
  | "waiting_user"
  | "waiting_support"
  | "escalated"
  | "resolved"
  | "closed"
  | "spam";

export interface SupportReplyNoticeInput {
  /** `support.reply`. */
  readonly canReply: boolean;
  /** Assigned to this operator, or holding `support.manage`. */
  readonly canControl: boolean;
  readonly status: SupportTicketState;
  /**
   * `PERMISSION_LABEL["support.reply"]`, passed in.
   *
   * The old text read «Для ответа требуется право «Ответы поддержки».» and no
   * such right exists under that name: the catalogue calls it «Отвечать в
   * обращениях», and that is what an administrator looking for it in «Роли и
   * права» will be reading. Passing it keeps one spelling without dragging the
   * whole permission catalogue into a module a test has to import.
   */
  readonly replyPermissionLabel: string;
}

export interface SupportReplyNotice {
  readonly tone: "muted" | "warn";
  readonly text: string;
}

/**
 * What stands in place of the composer, or null when the composer is shown.
 *
 * The old code had two branches for four situations, so a **closed** ticket —
 * one an operator has closed themselves, holding every permission — was told
 * «Сначала примите обращение или откройте назначенное вам обращение». Closing
 * is the one thing that certainly happened; being unassigned is the one thing
 * that certainly did not.
 */
export function supportReplyNotice(input: SupportReplyNoticeInput): SupportReplyNotice | null {
  if (!input.canReply) {
    return {
      tone: "muted",
      text: `Чтобы отвечать в обращениях, нужно право «${input.replyPermissionLabel}».`,
    };
  }
  if (input.status === "closed") {
    return {
      tone: "warn",
      text: "Обращение закрыто. Откройте его заново, чтобы ответить.",
    };
  }
  if (input.status === "spam") {
    return { tone: "warn", text: "Обращение помечено как спам. Отвечать в нём нельзя." };
  }
  if (!input.canControl) {
    return {
      tone: "warn",
      text: "Сначала примите обращение или откройте назначенное вам обращение.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Who acted, and who holds the ticket (A-60, A-67)
// ---------------------------------------------------------------------------

export interface SupportPerson {
  readonly id: string;
  readonly fullName: string;
  readonly username?: string | null;
}

export interface SupportActorInput {
  readonly actorUserId: string | null | undefined;
  readonly currentUserId: string | null | undefined;
  /** The operator directory, when this account may read it. */
  readonly operators: readonly SupportPerson[];
  /** Who opened the ticket, so an event of theirs is not read as a colleague's. */
  readonly requesterUserId?: string | null;
}

/**
 * The name to put on a history row, or null when there is honestly nobody.
 *
 * Four answers, and the fourth matters: `support_operator_directory` refuses
 * anybody without `support.transfer` or `support.manage` (measured on
 * production, 2026-09-15), and `SupportTab` swallows that refusal into an empty
 * list. So a plain operator holding only `support.view` and `support.reply`
 * cannot resolve a colleague's name at all, and «Оператор» is the true answer
 * for them — not a name invented from an id, and not a blank row that reads as
 * an event nobody caused.
 */
export function supportActorLabel(input: SupportActorInput): string | null {
  const actor = (input.actorUserId ?? "").trim();
  if (!actor) return null;
  if (input.currentUserId && actor === input.currentUserId) return "Вы";
  if (input.requesterUserId && actor === input.requesterUserId) return "Клиент";
  const known = input.operators.find((person) => person.id === actor);
  if (known) return personLabel(known);
  return "Оператор";
}

export interface SupportAssigneeInput {
  readonly assignedOperatorId: string | null | undefined;
  readonly currentUserId: string | null | undefined;
  readonly operators: readonly SupportPerson[];
}

/** What a queue row says about who holds the ticket. */
export function supportAssigneeLabel(input: SupportAssigneeInput): string {
  const assigned = (input.assignedOperatorId ?? "").trim();
  if (!assigned) return "Общий пул";
  if (input.currentUserId && assigned === input.currentUserId) return "Назначено вам";
  const known = input.operators.find((person) => person.id === assigned);
  if (known) return `Назначено: ${personLabel(known)}`;
  return "Назначено оператору";
}

function personLabel(person: SupportPerson): string {
  const name = person.fullName?.trim();
  if (name) return name;
  const handle = person.username?.trim();
  return handle ? `@${handle}` : "Оператор";
}
