export type AuthSessionIdentity = { userId: string; sessionId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Invalidation identity only. The authenticated client remains authoritative. */
export function readAuthSessionIdentity(value: unknown): AuthSessionIdentity | null {
  if (!record(value) || !record(value.user) || typeof value.user.id !== "string" || !value.user.id) return null;
  let sessionId: string | null = null;
  if (typeof value.access_token === "string") {
    try {
      const part = value.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
      if (record(claims) && claims.sub === value.user.id && typeof claims.session_id === "string" && UUID.test(claims.session_id)) {
        sessionId = claims.session_id;
      }
    } catch { /* Missing/legacy claims keep a stable user-scoped fallback. */ }
  }
  return { userId: value.user.id, sessionId };
}

export function sameAuthSessionIdentity(a: AuthSessionIdentity | null, b: AuthSessionIdentity | null): boolean {
  if (!a || !b) return a === b;
  return a.userId === b.userId && (!a.sessionId || !b.sessionId || a.sessionId === b.sessionId);
}
