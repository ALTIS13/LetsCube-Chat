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
