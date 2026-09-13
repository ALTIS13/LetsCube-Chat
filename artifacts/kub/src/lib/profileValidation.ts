import { hasUnsavedEdits } from "./unsavedEdits.ts";

export const PROFILE_LIMITS = {
  usernameMax: 32,
  fullNameMax: 64,
  bioMax: 70,
} as const;

const USERNAME_RE = /^[A-Za-z0-9_.]+$/;

export const RESERVED_USERNAME_KEYS = [
  "admin",
  "administrator",
  "root",
  "owner",
  "techadmin",
  "sysadmin",
  "superadmin",
  "system",
  "support",
  "moderator",
  "mod",
  "staff",
  "official",
  "security",
  "letscube",
  "kub",
  "help",
  "notify",
  "noreply",
] as const;

const RESERVED_USERNAME_KEY_SET = new Set<string>(RESERVED_USERNAME_KEYS);

export function reservedUsernameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isReservedUsername(value: string): boolean {
  const key = reservedUsernameKey(value);
  return Boolean(key) && RESERVED_USERNAME_KEY_SET.has(key);
}

export function normalizeFullName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, PROFILE_LIMITS.fullNameMax);
}

export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@+/, "").replace(/[^A-Za-z0-9_.]/g, "").slice(0, PROFILE_LIMITS.usernameMax);
}

/**
 * What «О себе» becomes on its way to the database.
 *
 * The settings screen wrote this inline for as long as it has existed, which
 * meant the question «has the bio been edited» could not be asked without
 * repeating the expression. It is the save's own rule, so it lives beside the
 * other two.
 */
export function normalizeBio(value: string): string {
  return value.trim().slice(0, PROFILE_LIMITS.bioMax);
}

/** The three fields the settings screen holds back for its «Сохранить» button. */
export interface ProfileDraft {
  fullName: string;
  username: string;
  bio: string;
}

/**
 * Whether «Имя», «Никнейм» or «О себе» has been typed into and not saved
 * (D-136).
 *
 * These three are the only things on that screen a person can lose. Every other
 * control there — тема, «в сети», the push categories, the microphone — writes
 * as it is flipped, and that asymmetry is the other half of the defect:
 * somebody who flipped a switch and then typed a bio can reasonably believe
 * both were kept, because one of them was.
 *
 * Each side is normalised the way the save normalises it, so the only changes
 * that raise a question are the ones that would really reach the database. A
 * name retyped with a double space is not one of them.
 */
export function profileDraftDirty(saved: ProfileDraft, edited: ProfileDraft): boolean {
  return hasUnsavedEdits([
    { saved: saved.fullName, edited: edited.fullName, normalize: normalizeFullName },
    { saved: saved.username, edited: edited.username, normalize: normalizeUsername },
    { saved: saved.bio, edited: edited.bio, normalize: normalizeBio },
  ]);
}

export function validateFullName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Имя обязательно";
  if (trimmed.length > PROFILE_LIMITS.fullNameMax) {
    return `Имя не должно быть длиннее ${PROFILE_LIMITS.fullNameMax} символов`;
  }
  return null;
}

export function validateUsername(value: string, options: { allowReserved?: boolean } = {}): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PROFILE_LIMITS.usernameMax) {
    return `Никнейм не должен быть длиннее ${PROFILE_LIMITS.usernameMax} символов`;
  }
  if (!USERNAME_RE.test(trimmed)) {
    return "Никнейм может содержать только латинские буквы, цифры, точку и подчёркивание";
  }
  if (!options.allowReserved && isReservedUsername(trimmed)) {
    return "Этот никнейм зарезервирован для администраторов.";
  }
  return null;
}
