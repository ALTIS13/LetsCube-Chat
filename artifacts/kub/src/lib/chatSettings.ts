/**
 * What a group's settings screen holds, as pure data (D-164).
 *
 * Before this, a group had no settings screen at all: the pencil in the
 * information card set `editing = true`, which swapped the title and subtitle
 * for a one-line name input and a two-row description box, with no way out but
 * to save. Every other setting a group has sat on the «Сведения» tab, in front
 * of people who cannot change any of it.
 *
 * The reference the owner sent on 2026-09-13 puts them on their own screen, one
 * row each, **with the current value on the right** — which is the part that
 * makes such a screen readable at a glance rather than a list of doors. That
 * arrangement is what this module describes.
 *
 * **Only rows that exist.** A row is here when the product can really change or
 * really show the thing it names. A row for a feature nobody has built is worse
 * than no row: it teaches a person that this screen is decorative. So there is
 * no «Статистика», no «Недавние действия», no «Приветствие» — and when one of
 * those is built, it arrives here with its value beside it like the rest.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

import type { InvitePolicy } from "./groupInvites.ts";

export type ChatSettingsRowId =
  | "invites"
  | "topics"
  | "administrators"
  | "members"
  | "media"
  | "delete";

export type ChatSettingsRowKind = "choice" | "toggle" | "navigate" | "danger";

export interface ChatSettingsRow {
  id: ChatSettingsRowId;
  /** What the row is called. */
  label: string;
  /** What it currently says, on the right. Null for a row whose value is its own action. */
  value: string | null;
  kind: ChatSettingsRowKind;
  /** Whether this person may change it. A row they may only read still shows its value. */
  editable: boolean;
}

export interface ChatSettingsInput {
  /** «group» or «channel»; a private conversation has no settings screen. */
  type: string | null | undefined;
  /** Whether topics are on. Groups only. */
  isForum: boolean;
  /**
   * What the chat says about who may invite, or null when nothing could be read
   * — either the column is not there yet or it holds a value this build does not
   * know. Those are the same thing from here: we do not know.
   */
  invitePolicy: InvitePolicy | null;
  administrators: number;
  members: number;
  /** How many shared media items the panel counted, or null when it has not counted yet. */
  media: number | null;
  isOwner: boolean;
  isOwnerOrAdmin: boolean;
}

/**
 * «Все участники», «Только администраторы», «Неизвестно».
 *
 * The third one is D-165: the card used to print the default whenever it had
 * read nothing, which states a policy rather than admitting to not having one.
 * The same words are used for the value and for the control that sets it — they
 * disagreed before, «Только администраторы» against «Администраторы», which
 * reads as two different settings.
 */
export function invitePolicyLabel(policy: InvitePolicy | null): string {
  if (policy === "members_can_invite") return "Все участники";
  if (policy === "owner_admin_only") return "Только администраторы";
  return "Неизвестно";
}

/** «12 участников», in the forms Russian actually takes. */
export function memberCountValue(count: number): string {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  if (remainder10 === 1 && remainder100 !== 11) return `${count} участник`;
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) return `${count} участника`;
  return `${count} участников`;
}

/** «3 администратора», the same forms. */
export function adminCountValue(count: number): string {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  if (remainder10 === 1 && remainder100 !== 11) return `${count} администратор`;
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) return `${count} администратора`;
  return `${count} администраторов`;
}

/**
 * The rows, in the order the reference puts them: what the group is, then who
 * it holds, then what is in it, then the one destructive thing at the foot.
 *
 * Topics are a group's setting and not a channel's, and only its owner may turn
 * them on — the same rule the panel already applied where the switch used to
 * live. Deleting is the owner's alone.
 */
export function chatSettingsRows(input: ChatSettingsInput): ChatSettingsRow[] {
  const rows: ChatSettingsRow[] = [];
  const isGroup = input.type === "group";

  rows.push({
    id: "invites",
    label: "Кто может приглашать",
    value: invitePolicyLabel(input.invitePolicy),
    kind: "choice",
    editable: input.isOwnerOrAdmin,
  });

  if (isGroup) {
    rows.push({
      id: "topics",
      label: "Топики",
      value: input.isForum ? "Включены" : "Выключены",
      kind: "toggle",
      editable: input.isOwner,
    });
  }

  rows.push({
    id: "administrators",
    label: "Администраторы",
    value: adminCountValue(input.administrators),
    kind: "navigate",
    editable: input.isOwnerOrAdmin,
  });

  rows.push({
    id: "members",
    label: "Участники",
    value: memberCountValue(input.members),
    kind: "navigate",
    editable: true,
  });

  if (input.media !== null) {
    rows.push({
      id: "media",
      label: "Общие медиа",
      value: String(input.media),
      kind: "navigate",
      editable: true,
    });
  }

  if (input.isOwner) {
    rows.push({
      id: "delete",
      label: input.type === "channel" ? "Удалить канал" : "Удалить группу",
      value: null,
      kind: "danger",
      editable: true,
    });
  }

  return rows;
}

/**
 * Whether the name or the description has been typed into and not saved.
 *
 * The screen is left by a back arrow rather than by committing, which is what
 * the pencil never offered, so somebody can now leave with changes in hand. D-136
 * records the same defect one surface over — settings throwing away a typed name
 * without asking — and the answer there is the answer here: ask.
 */
export function chatProfileDirty(
  saved: { name: string; description: string },
  edited: { name: string; description: string },
): boolean {
  return saved.name.trim() !== edited.name.trim() || saved.description.trim() !== edited.description.trim();
}
