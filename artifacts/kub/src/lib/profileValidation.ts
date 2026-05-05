export const PROFILE_LIMITS = {
  usernameMax: 32,
  fullNameMax: 64,
  bioMax: 70,
} as const;

const USERNAME_RE = /^[A-Za-z0-9_.]+$/;

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

export function validateUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PROFILE_LIMITS.usernameMax) {
    return `Username не должен быть длиннее ${PROFILE_LIMITS.usernameMax} символов`;
  }
  if (!USERNAME_RE.test(trimmed)) {
    return "Username может содержать только латинские буквы, цифры, точку и подчёркивание";
  }
  return null;
}
