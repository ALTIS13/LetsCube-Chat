import { PROFILE_SAVE_FAILED, USERNAME_TAKEN, plainFailure } from "./plainMessages.ts";
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

// ---------------------------------------------------------------------------
// What the save says when it fails (D-132, settings-profile B5 and C4)
// ---------------------------------------------------------------------------

/** The three fields «Сохранить» can put a sentence under. */
export type ProfileField = "fullName" | "username" | "bio";

export interface ProfileSaveFailure {
  /** Which field the sentence belongs under, or null for the screen's banner. */
  readonly field: ProfileField | null;
  readonly message: string;
}

/** SQLSTATE 23505: unique_violation. */
const DUPLICATE_KEY = "23505";

/** `Key (username)=(…) already exists.` — the column Postgres names in DETAIL. */
const DETAIL_COLUMN = /key\s*\(\s*([a-z_][a-z0-9_]*)/iu;

/** `duplicate key value violates unique constraint "profiles_username_key"`. */
const CONSTRAINT_NAME = /unique constraint "([^"]+)"/iu;

function errorFields(error: unknown): { code: string; text: string } {
  if (!error || typeof error !== "object") return { code: "", text: typeof error === "string" ? error : "" };
  const err = error as Record<string, unknown>;
  const code = typeof err.code === "string" ? err.code : "";
  const text = [err.message, err.details, err.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return { code, text };
}

/**
 * Whether a duplicate-key failure on the profile save is the никнейм.
 *
 * The update writes `full_name`, `username`, `bio` and `updated_at`, and the
 * only one of those under a unique constraint is the никнейм — so 23505 here is
 * that. The claim is narrowed twice rather than assumed: the save must actually
 * have sent a никнейм (an empty field writes null, and null collides with
 * nothing), and where Postgres named the column or the constraint, that name
 * must be the никнейм. A future unique column on `profiles` therefore falls out
 * of this branch instead of being mislabelled.
 */
function duplicateIsUsername(text: string, sentUsername: boolean): boolean {
  if (!sentUsername) return false;
  const named = DETAIL_COLUMN.exec(text)?.[1] ?? CONSTRAINT_NAME.exec(text)?.[1] ?? null;
  return named === null || /username/iu.test(named);
}

/**
 * What «Сохранить» says, and where it says it (settings-profile B5 and C4).
 *
 * Two defects in one answer. `mapPgError` replies «Такая запись уже
 * существует.» to a duplicate никнейм — true of a row, and silent about the
 * field somebody typed into — and the screen printed that in a banner under its
 * header, far from the input that caused it. This returns the sentence and the
 * field it belongs to, so the surface can put it in the right place.
 *
 * `mapped` is the caller's `mapPgError(error)`. It is passed in rather than
 * imported so this module keeps importing nothing that a `node --test` process
 * cannot load, and so the recognised failures — a dead network, an expired
 * session, missing rights — reach the screen unchanged.
 */
export function profileSaveFailure(
  error: unknown,
  mapped: string,
  sentUsername: boolean,
): ProfileSaveFailure {
  const { code, text } = errorFields(error);
  if (code === DUPLICATE_KEY && duplicateIsUsername(text, sentUsername)) {
    return { field: "username", message: USERNAME_TAKEN };
  }
  return { field: null, message: plainFailure(mapped, PROFILE_SAVE_FAILED) };
}

/*
 * What «Сохранить» says when the никнейм turns out to be taken.
 *
 * This used to be the only way to find out, and the note here used to explain
 * why — on a misreading of the database. It said `profiles` carries «block
 * banned reads (self only on profiles)» and therefore hides a banned account's
 * name from everybody else. Read again on production on 2026-09-14, that policy
 * is `(NOT is_banned(uid())) OR (id = uid())`: it restricts what a **banned
 * caller** may read, not the visibility of a banned account's row. An ordinary
 * caller reads every profile, so a lookup answers correctly — and
 * `usernameAvailability` below now asks.
 *
 * The save's own message still matters: the lookup can be out of date by the
 * time «Сохранить» is pressed, and two people can take the same name in the
 * same second. It says «Это имя пользователя уже занято» under the никнейм,
 * where «Такая запись уже существует.» used to appear in a banner under the
 * header.
 */

/**
 * Whether a никнейм is free, as far as the field can tell while it is typed
 * (D-132, settings-profile C4).
 *
 * A pure reading of four facts, so the field's state is a rule with a test
 * rather than four booleans spread through a component.
 *
 * `"mine"` is the case that would otherwise read as a defect: the name a person
 * already holds is of course taken, and telling them so about their own
 * никнейм is how a working field looks broken.
 */
export type UsernameAvailability = "idle" | "invalid" | "checking" | "mine" | "taken" | "free";

export function usernameAvailability(input: {
  /** What is in the field, already normalized. */
  value: string;
  /** What `validateUsername` says about it, or null. */
  ruleError: string | null;
  /** The никнейм this person already has, if any. */
  current: string | null | undefined;
  /** Whether a lookup for exactly this value is in flight. */
  checking: boolean;
  /** What the last completed lookup said about exactly this value. */
  taken: boolean | null;
}): UsernameAvailability {
  const value = normalizeUsername(input.value);
  if (!value) return "idle";
  if (input.ruleError) return "invalid";
  if (normalizeUsername(input.current ?? "") === value) return "mine";
  if (input.checking) return "checking";
  if (input.taken === true) return "taken";
  if (input.taken === false) return "free";
  return "idle";
}

/** The line under the field, and whether it is a refusal or a reassurance. */
export function usernameAvailabilityNote(
  state: UsernameAvailability,
): { text: string; tone: "muted" | "danger" } | null {
  switch (state) {
    case "checking":
      return { text: "Проверяем…", tone: "muted" };
    case "taken":
      return { text: USERNAME_TAKEN, tone: "danger" };
    case "free":
      return { text: "Свободно", tone: "muted" };
    default:
      return null;
  }
}
