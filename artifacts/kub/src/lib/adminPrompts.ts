/**
 * What the administration asks before a far-reaching action, and what it says
 * when a section cannot be read (D-133 and D-132).
 *
 * Two defects, one module, because they are the same boundary problem. Both
 * are decisions made of words, both were written inline in a `.tsx` where no
 * `node --test` process can reach them, and both are exactly the kind of rule
 * that regresses silently: a confirmation can be deleted in one line, and a
 * plain sentence can drift back into naming a migration file the moment
 * somebody debugging wants the cause on screen.
 *
 * The module imports nothing but `plainMessages.ts`, which itself imports
 * nothing. `requestAppConfirm` pulls in the icon vocabulary, which pulls in
 * React; the tone here is therefore its own two values rather than
 * `AppDialogTone`, and it is structurally the same type, so a prompt can be
 * spread into `requestAppConfirm` at the call site. The icon stays at the call
 * site too, for the same reason.
 *
 * Shape of a question, taken from Telegram's alert and from the entry:
 *   - the title IS the question;
 *   - one line saying what will stop working, or who it reaches;
 *   - a confirm button that names the action, never «Подтвердить»;
 *   - «Отмена».
 *
 * Where an action reaches people who are not in the room — registration
 * opening to everyone, support intake closing, a role's whole permission set
 * being replaced — the line says so. Describing the row instead is how these
 * came to be one-tap in the first place: nothing on screen said the press left
 * the screen.
 */

import { INTERNALS_PATTERN, plainMessage } from "./plainMessages.ts";

export type AdminConfirmTone = "default" | "danger";

export interface AdminConfirmPrompt {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly tone: AdminConfirmTone;
}

/** Every question in this module offers the same way out. */
const CANCEL = "Отмена";

/**
 * A person, named if we know a name.
 *
 * The administration reads names from three places that are each allowed to be
 * empty — `full_name`, `username`, and nothing at all — and a question reading
 * «для  будет снята» is worse than one that does not try.
 */
export function adminPersonLabel(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed || "этого пользователя";
}

/** A thing with a name, named if we know a name. */
function labelled(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? `«${trimmed}»` : fallback;
}

// ---------------------------------------------------------------------------
// D-133 — roles and permissions
// ---------------------------------------------------------------------------

/**
 * Taking a global role off one person (A-45).
 *
 * A global role is not decoration: it is the access this person has in every
 * part of the product, so the line says «во всём приложении» rather than
 * repeating the row that was already on screen.
 */
export function globalRoleRemovalPrompt(
  personName: string | null | undefined,
  roleName: string | null | undefined,
): AdminConfirmPrompt {
  return {
    title: "Снять роль с пользователя?",
    description:
      `${adminPersonLabel(personName)} сразу потеряет доступ, который даёт роль ` +
      `${labelled(roleName, "этой роли")}, во всём приложении и на всех устройствах.`,
    confirmLabel: "Снять роль",
    cancelLabel: CANCEL,
    tone: "danger",
  };
}

/**
 * Replacing a role's whole permission set (A-44).
 *
 * «Сохранить права» does not add what was ticked, it sends the whole set:
 * `role_set_permissions` replaces. So the press can take access away from
 * everybody holding the role without anything on screen having said «убрать».
 * The count is the part that makes it real, and it is allowed to be unknown —
 * a location-scoped role's usage is read separately and that read can fail, in
 * which case claiming «никому не назначена» would be a guess.
 */
export function rolePermissionsSavePrompt(
  roleName: string | null | undefined,
  holders: number | null,
): AdminConfirmPrompt {
  const role = labelled(roleName, "этой роли");
  const reach =
    holders === null
      ? `Доступ изменится у всех, кому назначена роль ${role}.`
      : holders === 0
        ? `Сейчас роль ${role} никому не назначена, поэтому доступ ни у кого не изменится.`
        : `Доступ сразу изменится у всех, кому назначена роль ${role}. Таких назначений: ${holders}.`;
  return {
    title: "Заменить права роли?",
    description: `Отмеченный набор полностью заменит текущие права, а не дополнит их. ${reach}`,
    confirmLabel: "Заменить права",
    cancelLabel: CANCEL,
    tone: "danger",
  };
}

// ---------------------------------------------------------------------------
// D-133 — bans and mutes
// ---------------------------------------------------------------------------

export type AdminSanctionKind = "ban" | "mute";

/**
 * Lifting one row in «Блокировки и мьюты» (A-49).
 *
 * Separate from `sanctionLiftPrompt` in `sanctions.ts`, which asks about a
 * person: that one deletes every restriction in force for them and has to say
 * what survives. This deletes the row it is attached to, by id, so it says
 * what that one restriction stops doing. A mute names where it applied,
 * because a mute in one chat and a mute everywhere are different things and
 * the row is the only place that distinction is visible.
 */
export function sanctionRowLiftPrompt(
  kind: AdminSanctionKind,
  personName: string | null | undefined,
  chatName?: string | null,
): AdminConfirmPrompt {
  const person = adminPersonLabel(personName);
  if (kind === "ban") {
    return {
      title: "Снять эту блокировку?",
      description:
        `${person} сразу сможет снова пользоваться приложением. ` +
        "Запись о блокировке останется в журнале санкций.",
      confirmLabel: "Снять блокировку",
      cancelLabel: CANCEL,
      tone: "danger",
    };
  }
  const where = (chatName ?? "").trim();
  return {
    title: "Снять этот мьют?",
    description:
      `${person} сразу сможет снова писать ${where ? `в «${where}»` : "во всех чатах"}. ` +
      "Запись о мьюте останется в журнале санкций.",
    confirmLabel: "Снять мьют",
    cancelLabel: CANCEL,
    tone: "danger",
  };
}

/**
 * Whether «Снять» belongs on this row at all (A-49).
 *
 * A restriction that has already run out is over. Offering to end it is
 * offering an action with no effect, and the row already says «истёк» right
 * beside the button that claimed there was something left to do.
 */
export function canLiftSanctionRow(row: { expires_at?: string | null }, now: Date): boolean {
  const expires = row.expires_at;
  if (expires === null || expires === undefined) return true;
  const at = Date.parse(expires);
  return Number.isFinite(at) ? at > now.getTime() : true;
}

// ---------------------------------------------------------------------------
// D-133 — the bulk bar over the user list
// ---------------------------------------------------------------------------

/**
 * One selection, described.
 *
 * Russian declension after a numeral is a trap in a sentence assembled at
 * runtime, so the count never carries a noun that has to agree with it: one
 * person is named, and several are a number after a colon. «Снять роль» in the
 * same bar already asks, and this is deliberately the same shape.
 */
function selectionClause(people: readonly (string | null | undefined)[]): {
  single: string | null;
  count: number;
} {
  return {
    single: people.length === 1 ? adminPersonLabel(people[0]) : null,
    count: people.length,
  };
}

/** Bulk «Назначить роль» (A-16). */
export function bulkGlobalRoleAssignPrompt(
  roleName: string | null | undefined,
  people: readonly (string | null | undefined)[],
): AdminConfirmPrompt {
  const role = labelled(roleName, "выбранной роли");
  const { single, count } = selectionClause(people);
  return {
    title: "Назначить роль выбранным пользователям?",
    description: single
      ? `${single} сразу получит все права роли ${role} во всём приложении.`
      : `Все права роли ${role} во всём приложении сразу получат выбранные пользователи: ${count}.`,
    confirmLabel: "Назначить роль",
    cancelLabel: CANCEL,
    tone: "default",
  };
}

/** Bulk «Назначить локацию» (A-16). */
export function bulkLocationAssignPrompt(
  locationName: string | null | undefined,
  roleName: string | null | undefined,
  people: readonly (string | null | undefined)[],
): AdminConfirmPrompt {
  const location = labelled(locationName, "выбранную локацию");
  const role = (roleName ?? "").trim();
  const withRole = role ? ` с ролью «${role}»` : "";
  const { single, count } = selectionClause(people);
  return {
    title: "Назначить локацию выбранным пользователям?",
    description: single
      ? `${single} войдёт в локацию ${location}${withRole}. Задачи и вопросы этой локации начнут приходить сразу.`
      : `В локацию ${location}${withRole} войдут выбранные пользователи: ${count}. ` +
        "Задачи и вопросы этой локации начнут приходить им сразу.",
    confirmLabel: "Назначить локацию",
    cancelLabel: CANCEL,
    tone: "default",
  };
}

// ---------------------------------------------------------------------------
// D-133 — locations
// ---------------------------------------------------------------------------

/**
 * Archiving a location (A-28).
 *
 * `location_archive` calls `location_update` with `is_active = false` and
 * touches nothing else, so members are kept and the honest line is that the
 * location leaves every picker — not that anything is deleted.
 */
export function locationArchivePrompt(
  locationName: string | null | undefined,
  memberCount: number | null,
): AdminConfirmPrompt {
  const location = labelled(locationName, "эту локацию");
  const members =
    memberCount === null || memberCount <= 0
      ? ""
      : ` Её участники (${memberCount}) останутся в списке, но перестанут получать задачи этой локации.`;
  return {
    title: "Архивировать локацию?",
    description:
      `Локация ${location} станет неактивной и пропадёт из выбора в новых задачах и назначениях.${members}`,
    confirmLabel: "Архивировать",
    cancelLabel: CANCEL,
    tone: "danger",
  };
}

/** Removing somebody from a location (A-30). */
export function locationMemberRemovePrompt(
  personName: string | null | undefined,
  locationName: string | null | undefined,
): AdminConfirmPrompt {
  return {
    title: "Убрать пользователя из локации?",
    description:
      `${adminPersonLabel(personName)} сразу перестанет получать задачи и вопросы локации ` +
      `${labelled(locationName, "этой локации")}.`,
    confirmLabel: "Убрать",
    cancelLabel: CANCEL,
    tone: "danger",
  };
}

// ---------------------------------------------------------------------------
// D-133 — invitations and the registration mode
// ---------------------------------------------------------------------------

/**
 * The registration-mode switch (A-33).
 *
 * The far-reaching half is turning invite-only OFF: one tap and anybody who
 * can reach the address can create an account. The other direction withdraws
 * something instead — nobody without a code gets in any more — which is why it
 * is the one carrying the danger tone, while the opening reads as what it is:
 * a door being opened, stated plainly enough that nobody opens it by accident.
 */
export function registrationModePrompt(nextInviteOnly: boolean): AdminConfirmPrompt {
  return nextInviteOnly
    ? {
      title: "Разрешить регистрацию только по приглашению?",
      description:
        "Создать аккаунт сможет только тот, у кого есть код или ссылка-приглашение. " +
        "Все остальные получат отказ на форме регистрации.",
      confirmLabel: "Включить приглашения",
      cancelLabel: CANCEL,
      tone: "danger",
    }
    : {
      title: "Открыть регистрацию для всех?",
      description:
        "Аккаунт сможет создать любой человек, открывший адрес LETSCUBE, без кода приглашения.",
      confirmLabel: "Открыть регистрацию",
      cancelLabel: CANCEL,
      tone: "default",
    };
}

/** Withdrawing an invitation (A-38). */
export function inviteRevokePrompt(
  code: string | null | undefined,
  label: string | null | undefined,
): AdminConfirmPrompt {
  const name = (label ?? "").trim();
  const value = (code ?? "").trim();
  const which = name && value ? `«${name}» (${value})` : name ? `«${name}»` : value ? `${value}` : "Это приглашение";
  return {
    title: "Отозвать приглашение?",
    description:
      `${which} перестанет работать сразу: ни код, ни ссылка больше не создадут аккаунт. ` +
      "Те, кто уже зарегистрировался по нему, остаются.",
    confirmLabel: "Отозвать",
    cancelLabel: CANCEL,
    tone: "danger",
  };
}

/**
 * Whether «Отозвать» belongs on this row (A-38).
 *
 * An invitation that has been withdrawn, or whose date has passed, already
 * creates no accounts; withdrawing it again is an action with no effect. A
 * fully used invitation is deliberately left revocable: that is a state the
 * entry does not name, and its row still reads «Использован» rather than
 * «Истёк», so shutting it off here would be a change nobody asked for.
 */
export function canRevokeInvite(
  invite: { revoked_at?: string | null; expires_at?: string | null },
  now: Date,
): boolean {
  if (invite.revoked_at) return false;
  const expires = invite.expires_at;
  if (expires === null || expires === undefined) return true;
  const at = Date.parse(expires);
  return Number.isFinite(at) ? at > now.getTime() : true;
}

// ---------------------------------------------------------------------------
// D-133 — support intake
// ---------------------------------------------------------------------------

export interface SupportIntakeState {
  readonly intakeEnabled: boolean;
  readonly guestIntakeEnabled: boolean;
}

/**
 * Closing support intake, or its public half (A-69).
 *
 * The switch itself only edits a draft; the press that reaches people is
 * «Сохранить». So this compares what is saved with what is about to be saved
 * and returns null when nothing was withdrawn — settings that only raise a
 * rate limit or fix a typo must not grow a dialog, or the dialog stops being
 * read.
 */
export function supportIntakeClosurePrompt(
  current: SupportIntakeState,
  next: SupportIntakeState,
): AdminConfirmPrompt | null {
  if (current.intakeEnabled && !next.intakeEnabled) {
    return {
      title: "Отключить приём обращений?",
      description:
        "Новые обращения перестанут приходить — и от вошедших пользователей, и с публичной формы. " +
        "Вместо формы люди увидят сообщение о закрытом приёме.",
      confirmLabel: "Отключить приём",
      cancelLabel: CANCEL,
      tone: "danger",
    };
  }
  if (current.guestIntakeEnabled && !next.guestIntakeEnabled) {
    return {
      title: "Отключить гостевую форму?",
      description:
        "Написать в поддержку можно будет только после входа в аккаунт. " +
        "Люди без аккаунта останутся без способа обратиться.",
      confirmLabel: "Отключить форму",
      cancelLabel: CANCEL,
      tone: "danger",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// D-132 — what a section says when it cannot be read
// ---------------------------------------------------------------------------

/**
 * A missing database object is not a screen, it is a log line.
 *
 * These replaced sentences naming migration files, SQL proposals, the function
 * `admin_ops_security_report`, and the legacy role keys the product falls back
 * to. Nobody who can read an administration tab can apply a migration from it,
 * and several of these tabs are reachable by roles that are not the owner. The
 * cause still exists — it goes to `console.error` beside the failing call,
 * which is what the rest of this codebase does.
 *
 * Each is one sentence about availability plus, at most, one about what still
 * works. Neither may name a table, a function, a file or a migration; the unit
 * test asserts that with a pattern rather than by equality, so a future edit
 * cannot smuggle one back in while keeping the constant's name.
 */
export const ADMIN_LOCATIONS_UNAVAILABLE = "Локации сейчас недоступны. Попробуйте позже.";
export const ADMIN_LOCATIONS_UNAVAILABLE_DETAIL =
  "Задачи, пользователи и остальные разделы продолжают работать.";

export const ADMIN_ROLES_UNAVAILABLE = "Роли и права сейчас недоступны. Попробуйте позже.";
export const ADMIN_ROLES_UNAVAILABLE_DETAIL =
  "Пока раздел недоступен, доступ определяют базовые роли, а локации и задачи работают как обычно.";

export const ADMIN_INVITES_UNAVAILABLE = "Приглашения временно недоступны. Попробуйте позже.";
export const ADMIN_REGISTRATION_MODE_UNAVAILABLE =
  "Режим регистрации временно недоступен. Попробуйте позже.";

export const ADMIN_OPS_METRICS_UNAVAILABLE = "Живые метрики сейчас недоступны.";
export const ADMIN_OPS_METRICS_UNAVAILABLE_DETAIL =
  "Остальные проверки на этой вкладке показывают текущую сборку и продолжают работать.";
export const ADMIN_OPS_INVITE_METRICS_UNAVAILABLE =
  "Живые метрики приглашений сейчас недоступны.";
export const ADMIN_OPS_INVITE_MODE_UNKNOWN =
  "Статус режима приглашений сейчас недоступен.";

export const ADMIN_USER_PROFILE_UNAVAILABLE =
  "Редактирование профиля сейчас недоступно. Попробуйте позже.";
export const ADMIN_ROLE_UNUSED_NOTE =
  "Эта роль нигде не назначена, поэтому её можно удалить полностью.";

/** Every sentence the administration shows when a section cannot be read. */
export const ADMIN_UNAVAILABLE_MESSAGES: readonly string[] = [
  ADMIN_LOCATIONS_UNAVAILABLE,
  ADMIN_LOCATIONS_UNAVAILABLE_DETAIL,
  ADMIN_ROLES_UNAVAILABLE,
  ADMIN_ROLES_UNAVAILABLE_DETAIL,
  ADMIN_INVITES_UNAVAILABLE,
  ADMIN_REGISTRATION_MODE_UNAVAILABLE,
  ADMIN_OPS_METRICS_UNAVAILABLE,
  ADMIN_OPS_METRICS_UNAVAILABLE_DETAIL,
  ADMIN_OPS_INVITE_METRICS_UNAVAILABLE,
  ADMIN_OPS_INVITE_MODE_UNKNOWN,
  ADMIN_USER_PROFILE_UNAVAILABLE,
  ADMIN_ROLE_UNUSED_NOTE,
];

/**
 * The words that must never reach one of these screens, and the filter that
 * refuses them.
 *
 * Both were declared here when the administration was the only surface that
 * needed them. The rest of D-132 — starting a chat, saving a никнейм, the
 * phone, push, search and the task form — needs the same rule, and a pattern
 * kept in two places drifts: one copy learns about a new internal and the
 * other keeps letting it through. So they moved to `plainMessages.ts`, which
 * imports nothing for the same reason this module does, and these two names
 * are aliases of them.
 *
 * Nothing about the administration's behaviour changed: the expression there
 * is byte-for-byte the one this module declared, and `plainAdminMessage` is
 * `plainMessage`. The two names are kept because they are what the five tabs
 * and `tests/unit/admin-prompts.test.mts` call, and renaming a call site
 * proves nothing.
 */
export const ADMIN_INTERNALS_PATTERN = INTERNALS_PATTERN;
export const plainAdminMessage = plainMessage;
