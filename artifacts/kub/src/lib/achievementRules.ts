/**
 * The rules and shapes behind achievements, with no data access.
 *
 * Split out from `achievements.ts` so the parts that decide something — how a
 * row is read, whether a decoration is unlocked, what the server's answer means
 * — can be exercised without a Supabase client or a browser. The server remains
 * the authority on every one of these facts; this file only reads its answer.
 */

export interface AchievementDefinition {
  key: string;
  title: string;
  description: string;
  icon: string;
  grantKind: "auto" | "manual";
  sortOrder: number;
}

export interface CosmeticDefinition {
  key: string;
  kind: "frame" | "background";
  title: string;
  requiredAchievement: string | null;
  sortOrder: number;
}

/** How far off an unearned achievement is, when the criterion is countable. */
export interface AchievementProgress {
  current: number;
  target: number;
}

export interface AchievementState {
  achievements: AchievementDefinition[];
  cosmetics: CosmeticDefinition[];
  earned: Set<string>;
  progress: Record<string, AchievementProgress>;
}

export const EMPTY_ACHIEVEMENT_STATE: AchievementState = {
  achievements: [],
  cosmetics: [],
  earned: new Set(),
  progress: {},
};

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function projectAchievement(row: Record<string, unknown>): AchievementDefinition | null {
  const key = readString(row, "key");
  if (!key) return null;
  return {
    key,
    title: readString(row, "title"),
    description: readString(row, "description"),
    icon: readString(row, "icon") || "crown",
    grantKind: readString(row, "grant_kind") === "manual" ? "manual" : "auto",
    sortOrder: readNumber(row.sort_order, 100),
  };
}

export function projectCosmetic(row: Record<string, unknown>): CosmeticDefinition | null {
  const key = readString(row, "key");
  const kind = readString(row, "kind");
  if (!key || (kind !== "frame" && kind !== "background")) return null;
  const required = row.required_achievement;
  return {
    key,
    kind,
    title: readString(row, "title"),
    requiredAchievement: typeof required === "string" ? required : null,
    sortOrder: readNumber(row.sort_order, 100),
  };
}

/** `achievements_sync` returns `{earned: [...], progress: {key: {current, target}}}`. */
export function projectSyncResult(payload: unknown): {
  earned: Set<string>;
  progress: Record<string, AchievementProgress>;
} {
  const earned = new Set<string>();
  const progress: Record<string, AchievementProgress> = {};
  if (!payload || typeof payload !== "object") return { earned, progress };

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.earned)) {
    for (const key of record.earned) {
      if (typeof key === "string") earned.add(key);
    }
  }
  if (record.progress && typeof record.progress === "object") {
    for (const [key, value] of Object.entries(record.progress as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const target = readNumber(entry.target, 0);
      // A target of zero would render as a full bar for something not earned.
      if (target <= 0) continue;
      progress[key] = { current: Math.max(0, readNumber(entry.current, 0)), target };
    }
  }
  return { earned, progress };
}

/** Whether a decoration may be worn, given what the person has earned. */
export function isCosmeticUnlocked(
  cosmetic: CosmeticDefinition,
  earned: ReadonlySet<string>,
): boolean {
  return cosmetic.requiredAchievement === null || earned.has(cosmetic.requiredAchievement);
}
