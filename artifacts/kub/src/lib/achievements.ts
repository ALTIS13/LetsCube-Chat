import { createClient } from "@/lib/supabase/client";
import {
  projectAchievement,
  projectAchievementShare,
  projectCosmetic,
  projectSyncResult,
  type AchievementShare,
  type AchievementDefinition,
  type AchievementState,
  type CosmeticDefinition,
} from "@/lib/achievementRules";

export * from "@/lib/achievementRules";

interface RpcClient {
  rpc<T>(name: string, args?: Record<string, unknown>): PromiseLike<{ data: T; error: unknown }>;
}

function rpcClient(): RpcClient {
  return createClient() as unknown as RpcClient;
}

/** A postgrest error carries `message`; anything else is stringified as-is. */
function describeReadError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function loadAchievementState(): Promise<AchievementState> {
  const supabase = createClient();
  const [definitions, catalogue, sync, stats] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("achievements" as any).select("key,title,description,icon,grant_kind,sort_order").order("sort_order", { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("cosmetics" as any).select("key,kind,title,required_achievement,sort_order").order("sort_order", { ascending: true }),
    rpcClient().rpc<unknown>("achievements_sync"),
    // Aggregate only, and it excludes the test accounts on both sides of the
    // fraction — see the view's own comment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("achievement_stats" as any).select("achievement_key,holders,eligible"),
  ]);

  // A failed read used to be indistinguishable from an empty catalogue: the
  // picker renders nothing when it has no items, so the decoration section
  // would simply not appear and say nothing about why. The caller already
  // shows "Не удалось загрузить достижения." when this throws.
  //
  // `stats` is deliberately not in this list — it only supplies the "N% of
  // users" line, and losing it should not take the screen down with it.
  for (const [what, result] of [
    ["achievements", definitions],
    ["cosmetics", catalogue],
    ["achievements_sync", sync],
  ] as const) {
    if (result.error) {
      throw new Error(`could not read ${what}: ${describeReadError(result.error)}`);
    }
  }

  const achievements = ((definitions.data ?? []) as unknown as Record<string, unknown>[])
    .map(projectAchievement)
    .filter((item): item is AchievementDefinition => item !== null);
  const cosmetics = ((catalogue.data ?? []) as unknown as Record<string, unknown>[])
    .map(projectCosmetic)
    .filter((item): item is CosmeticDefinition => item !== null);
  const { earned, progress } = projectSyncResult(sync.error ? null : sync.data);

  const shares: Record<string, AchievementShare> = {};
  for (const row of (stats.data ?? []) as unknown as Record<string, unknown>[]) {
    const projected = projectAchievementShare(row);
    if (projected) shares[projected.key] = projected.share;
  }

  return { achievements, cosmetics, earned, progress, shares };
}

/** Save the chosen decoration. The server refuses anything unearned. */
export async function saveCosmeticSelection(
  userId: string,
  selection: { frame?: string | null; background?: string | null },
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if ("frame" in selection) patch.profile_frame = selection.frame ?? null;
  if ("background" in selection) patch.profile_background = selection.background ?? null;
  if (Object.keys(patch).length === 0) return;

  const { error } = await createClient()
    .from("profiles")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("id", userId);
  if (error) throw new Error(error.message);
}
