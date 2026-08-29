import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const lifecycleKind = (inviteCode) => (inviteCode ? "invite" : "public");

export const normalizeLifecycleUserId = (user) =>
  user && typeof user.id === "string" && UUID.test(user.id) ? user.id : null;

export const lifecycleRpcBody = (userId, kind, inviteCode) => ({
  p_user_id: userId,
  p_signup_kind: kind,
  p_invite_code_hash: inviteCode
    ? createHash("sha256").update(inviteCode).digest("hex")
    : null,
});
