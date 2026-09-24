export type PushNudgeStatus =
  | "unsupported" | "native_unavailable" | "denied" | "missing_vapid"
  | "migration_missing" | "inactive" | "active";

export interface PushNudgeInput {
  installed: boolean;
  ios: boolean;
  userId: string | null;
  ready: boolean;
  status: PushNudgeStatus;
  snoozedUntil: number;
  now: number;
}

/** One soft invitation per thirty days; an OS denial is guidance, not another prompt. */
export function pushNudgeVariant(input: PushNudgeInput): "enable" | "settings" | null {
  if (!input.installed || !input.ios || !input.userId || !input.ready || input.snoozedUntil > input.now) return null;
  if (input.status === "inactive") return "enable";
  if (input.status === "denied") return "settings";
  return null;
}

export function pushNudgeSnoozeUntil(now: number): number {
  return now + 30 * 24 * 60 * 60 * 1000;
}
