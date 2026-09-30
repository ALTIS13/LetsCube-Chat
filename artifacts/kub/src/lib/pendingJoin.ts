/**
 * A link into a group opened before signing in (D-170).
 *
 * `/join/<token>` needs an account — the preview answers nobody anonymous — so
 * a guest is sent to `/login`, and sign-in used to land on `/` with the link
 * forgotten. The token is kept for this tab until the join page has it.
 *
 * Session storage, not local: a link opened in one tab is that tab's errand.
 */

import { isInviteToken, joinTokenFromPath } from "./chatInviteLinks.ts";

const KEY = "kub:pending-join:v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sessionStore(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps the token of a `/join/<token>` address; anything else is ignored. */
export function rememberPendingJoin(location: string, store: StorageLike | null = sessionStore()): void {
  const token = joinTokenFromPath(location);
  if (!token || !store) return;
  try {
    store.setItem(KEY, token);
  } catch {
    // Unwritable storage costs the link its return after sign-in, nothing else.
  }
}

/** Where sign-in should lead: the kept join page, or null. */
export function pendingJoinPath(store: StorageLike | null = sessionStore()): string | null {
  try {
    const token = store?.getItem(KEY) ?? null;
    return isInviteToken(token) ? `/join/${token}` : null;
  } catch {
    return null;
  }
}

export function clearPendingJoin(store: StorageLike | null = sessionStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // Nothing to clear from storage that cannot be read.
  }
}
