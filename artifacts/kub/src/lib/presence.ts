import { presentKind, presentLabel, type PresenceKind } from "./presenceStatus.ts";

export const USER_ONLINE_THRESHOLD_MS = 90_000;

type PresenceProfile = {
  online_at?: string | null;
  /** Tracker item 37: «idle» or «dnd» beside presence, or nothing. */
  presence_status?: string | null;
} | null | undefined;

export type PresenceState = {
  isOnline: boolean;
  label: string;
  /** How the person appears: the dot's colour, and the word. */
  kind: PresenceKind;
};

export function getUserPresenceState(profile: PresenceProfile, nowMs = Date.now()): PresenceState {
  const seenAt = parsePresenceTimestamp(profile?.online_at);
  if (seenAt === null) return { isOnline: false, label: "", kind: "offline" };

  const diff = Math.max(0, nowMs - seenAt);
  if (diff < USER_ONLINE_THRESHOLD_MS) {
    return { isOnline: true, label: presentLabel(profile?.presence_status), kind: presentKind(profile?.presence_status) };
  }

  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return { isOnline: false, label: `был(а) ${mins} мин назад`, kind: "offline" };

  const hours = Math.floor(mins / 60);
  if (hours < 24) return { isOnline: false, label: `был(а) ${hours} ч назад`, kind: "offline" };

  return { isOnline: false, label: "был(а) недавно", kind: "offline" };
}

export function isUserOnline(profile: PresenceProfile, nowMs = Date.now()): boolean {
  return getUserPresenceState(profile, nowMs).isOnline;
}

function parsePresenceTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
