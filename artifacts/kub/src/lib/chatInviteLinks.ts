/**
 * A link into a group — D-170's last half (2026-09-30).
 *
 * The database is `20260930120000_chat_invite_links.sql`: a link is made and
 * withdrawn only through its functions, read by whoever may invite into the
 * chat, previewed and used by anybody signed in who holds it.
 *
 * The choices are Telegram's, read in its Android link editor
 * (`LinkEditActivity`, 2026-09-30): a time limit of 1 hour, 1 day, 1 week or
 * none, and a use limit of 1, 10, 100 or none, both defaulting to none, and an
 * optional name. What the holder of a link sees before joining is the owner's
 * answer, ± Telegram: the group's name, its picture and how many are in it.
 *
 * Pure, so `node --test` decides every case.
 */

import { selectRussianPluralForm } from "./messageMediaSections.ts";

export type InviteLinkExpiryId = "hour" | "day" | "week" | "none";
export type InviteLinkUsesId = "1" | "10" | "100" | "none";

export const INVITE_LINK_EXPIRY_CHOICES: readonly { id: InviteLinkExpiryId; label: string; seconds: number | null }[] = [
  { id: "hour", label: "1 час", seconds: 3600 },
  { id: "day", label: "1 день", seconds: 86_400 },
  { id: "week", label: "1 неделя", seconds: 604_800 },
  { id: "none", label: "Без срока", seconds: null },
];

export const INVITE_LINK_USES_CHOICES: readonly { id: InviteLinkUsesId; label: string; uses: number | null }[] = [
  { id: "1", label: "1", uses: 1 },
  { id: "10", label: "10", uses: 10 },
  { id: "100", label: "100", uses: 100 },
  { id: "none", label: "Без ограничений", uses: null },
];

/** Telegram's defaults: neither limit. */
export const DEFAULT_INVITE_LINK_EXPIRY: InviteLinkExpiryId = "none";
export const DEFAULT_INVITE_LINK_USES: InviteLinkUsesId = "none";

/** The name Telegram lets a link carry; the database holds it to the same 32. */
export const INVITE_LINK_TITLE_MAX = 32;

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export function isInviteToken(value: string | null | undefined): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

/** The address a link is shared as. */
export function inviteLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/join/${token}`;
}

/** The token a `/join/<token>` address carries, or null for anything else. */
export function joinTokenFromPath(location: string): string | null {
  const path = location.split(/[?#]/, 1)[0] ?? "";
  const match = /^\/join\/([^/]+)\/?$/.exec(path);
  return match && isInviteToken(match[1]) ? match[1] : null;
}

export interface InviteLinkRow {
  id: string;
  token: string;
  title: string | null;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
}

export type InviteLinkState = "active" | "expired" | "used_up" | "revoked";

export function inviteLinkState(link: InviteLinkRow, now: number): InviteLinkState {
  if (link.revoked_at) return "revoked";
  if (link.expires_at && Date.parse(link.expires_at) <= now) return "expired";
  if (link.max_uses !== null && link.uses >= link.max_uses) return "used_up";
  return "active";
}

const USE_FORMS = ["вход", "входа", "входов"] as const;
/** After «из N» the noun is genitive: «1 из 1 входа», «3 из 10 входов». */
const USE_OF_FORMS = ["входа", "входов", "входов"] as const;
const HOUR_FORMS = ["час", "часа", "часов"] as const;
const DAY_FORMS = ["день", "дня", "дней"] as const;
const MINUTE_FORMS = ["минуту", "минуты", "минут"] as const;

function countOf(count: number, forms: readonly [string, string, string]): string {
  return `${count} ${selectRussianPluralForm(count, forms)}`;
}

/** How long is left, in the largest whole unit: «через 3 дня», «через 5 часов». */
export function timeLeftLabel(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return "истекла";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `истекает через ${countOf(minutes, MINUTE_FORMS)}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `истекает через ${countOf(hours, HOUR_FORMS)}`;
  return `истекает через ${countOf(Math.floor(hours / 24), DAY_FORMS)}`;
}

/** One line under a link: how often it was used, and what limits it. */
export function inviteLinkSummary(link: InviteLinkRow, now: number): string {
  const state = inviteLinkState(link, now);
  if (state === "revoked") return "Отозвана";
  if (state === "expired") return "Срок истёк";
  const used = link.max_uses !== null
    ? `${link.uses} из ${countOf(link.max_uses, USE_OF_FORMS)}`
    : link.uses > 0 ? countOf(link.uses, USE_FORMS) : "Ещё не использована";
  if (state === "used_up") return `${used} · больше не действует`;
  const time = link.expires_at ? timeLeftLabel(link.expires_at, now) : "без срока";
  return `${used} · ${time}`;
}

export type InvitePreviewState = "ok" | "member" | "invalid" | "revoked" | "expired" | "used_up" | "unavailable";

/** Why a link cannot be used, in the words the join page says it. */
export function invitePreviewStateText(state: InvitePreviewState): string | null {
  switch (state) {
    case "invalid":
      return "Ссылка недействительна. Возможно, в ней ошибка.";
    case "revoked":
      return "Эту ссылку отозвали. Попросите новую у того, кто её прислал.";
    case "expired":
      return "Срок действия ссылки истёк. Попросите новую у того, кто её прислал.";
    case "used_up":
      return "По этой ссылке уже вошло столько людей, сколько было можно.";
    case "unavailable":
      return "С этого аккаунта вступить нельзя.";
    default:
      return null;
  }
}

const MEMBER_FORMS = ["участник", "участника", "участников"] as const;

export function memberCountLabel(count: number): string {
  return countOf(count, MEMBER_FORMS);
}

/** A refusal from one of the link functions, as a sentence; never Postgres's words. */
export function inviteLinkErrorText(error: unknown, fallback: string): string {
  const message = typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  if (message.includes("invite_link_forbidden")) return "Недостаточно прав, чтобы приглашать на этот сервер.";
  if (message.includes("invite_link_too_many")) return "У сервера слишком много действующих ссылок. Отзовите ненужные.";
  if (message.includes("invite_link_expired")) return invitePreviewStateText("expired") as string;
  if (message.includes("invite_link_revoked")) return invitePreviewStateText("revoked") as string;
  if (message.includes("invite_link_used_up")) return invitePreviewStateText("used_up") as string;
  if (message.includes("invite_link_invalid")) return invitePreviewStateText("invalid") as string;
  if (message.includes("banned")) return invitePreviewStateText("unavailable") as string;
  if (message.includes("invite_link_bad_title")) return `Название ссылки — не длиннее ${INVITE_LINK_TITLE_MAX} символов.`;
  return fallback;
}
