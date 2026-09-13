const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 64;
const INVITE_CODE_RE = /^[A-Z0-9_-]+$/;

/**
 * D-132 (A-34). These two sentences used to name the SQL proposals to apply —
 * `20260622_registration_invite_codes.sql` and
 * `20260622_registration_invite_mode_settings.sql`.
 *
 * The second of them is not an administration screen at all: it is what
 * `mapRegistrationInviteError` answers for `invite_not_configured`, which the
 * public registration form shows to somebody trying to create an account.
 * A stranger was being handed the name of a migration file in this project.
 *
 * The names are kept here, in a comment, because that is where they help: the
 * condition is still a missing object, and whoever reads this file is the
 * person who can do something about it. The screen gets one plain sentence and
 * the cause goes to the log.
 */
export const REGISTRATION_INVITES_REQUIRED_MESSAGE =
  "Приглашения временно недоступны. Попробуйте позже.";
export const REGISTRATION_INVITE_MODE_REQUIRED_MESSAGE =
  "Режим регистрации временно недоступен. Попробуйте позже.";
export const REGISTRATION_INVITE_ONLY_BANNER_TITLE =
  "Регистрация сейчас доступна только по приглашению.";
export const REGISTRATION_INVITE_ONLY_BANNER_BODY =
  "Код выдаёт администратор LETSCUBE — введите его ниже.";
export const REGISTRATION_INVITE_ONLY_CODE_REQUIRED_MESSAGE =
  "Введите код приглашения, чтобы создать аккаунт.";

export function normalizeRegistrationInviteCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().replace(/\s+/g, "").toUpperCase();
  if (code.length < MIN_INVITE_CODE_LENGTH || code.length > MAX_INVITE_CODE_LENGTH || !INVITE_CODE_RE.test(code)) return null;
  return code;
}

export function readRegistrationInviteFromSearch(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  return normalizeRegistrationInviteCode(params.get("invite") ?? params.get("code")) ?? "";
}

export function buildRegistrationInviteLink(origin: string, code: string): string {
  const inviteCode = normalizeRegistrationInviteCode(code);
  const base = origin.replace(/\/+$/g, "") || window.location.origin;
  const url = new URL("/register", base);
  if (inviteCode) url.searchParams.set("invite", inviteCode);
  return url.toString();
}

export function mapRegistrationInviteError(error: string | undefined): string | null {
  if (error === "invite_required") return REGISTRATION_INVITE_ONLY_CODE_REQUIRED_MESSAGE;
  if (error === "invite_invalid") return "Код приглашения не найден или уже недоступен.";
  if (error === "invite_expired") return "Срок действия приглашения истёк.";
  if (error === "invite_used") return "Лимит использований приглашения исчерпан.";
  if (error === "invite_not_configured") return REGISTRATION_INVITE_MODE_REQUIRED_MESSAGE;
  return null;
}
