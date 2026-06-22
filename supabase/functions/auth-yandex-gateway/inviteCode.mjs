const MIN_INVITE_CODE_LENGTH = 6;
const MAX_INVITE_CODE_LENGTH = 64;
const INVITE_CODE_RE = /^[A-Z0-9_-]+$/;

export function normalizeInviteCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().replace(/\s+/g, "").toUpperCase();
  if (code.length < MIN_INVITE_CODE_LENGTH || code.length > MAX_INVITE_CODE_LENGTH || !INVITE_CODE_RE.test(code)) return null;
  return code;
}

export function shouldSendInviteCode(action, inviteCode) {
  return action === "signup" && typeof inviteCode === "string" && inviteCode.length > 0;
}

export function shouldValidateInviteGate(action) {
  return action === "signup";
}
