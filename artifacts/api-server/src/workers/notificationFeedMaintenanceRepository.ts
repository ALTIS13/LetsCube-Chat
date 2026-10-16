import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type MaintenanceState = { after_fence: string | null; after_event: string | null; pending: string[] };
export type MaintenanceCounts = {
  retention_removed: number; orphan_removed: number; accounts_checked: number; accounts_settled: number;
  scanned_fences: number; scanned_events: number; expired_remaining: boolean;
};
export type MaintenanceResult = MaintenanceCounts & { state: MaintenanceState };
export interface MaintenanceRepository { maintain(state: MaintenanceState): Promise<MaintenanceResult> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function demand(value: unknown): asserts value { if (!value) throw new Error("notification_feed_maintenance_invalid_data"); }
function object(value: unknown, fields: string[]): Record<string, unknown> {
  demand(value && typeof value === "object" && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  demand(Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field)));
  return row;
}
function integer(value: unknown, max: number): number {
  demand(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max);
  return value;
}
function cursor(value: unknown): string | null {
  demand(value === null || (typeof value === "string" && UUID.test(value)));
  return value as string | null;
}
function state(value: unknown): MaintenanceState {
  const row = object(value, ["after_fence", "after_event", "pending"]);
  demand(Array.isArray(row.pending) && row.pending.length <= 10);
  const pending = row.pending.map(value => { demand(typeof value === "string" && UUID.test(value)); return value; });
  demand(new Set(pending).size === pending.length);
  return { after_fence: cursor(row.after_fence), after_event: cursor(row.after_event), pending };
}
function result(value: unknown): MaintenanceResult {
  const row = object(value, ["v", "retention_removed", "orphan_removed", "accounts_checked", "accounts_settled",
    "scanned_fences", "scanned_events", "expired_remaining", "state"]);
  demand(row.v === 1 && typeof row.expired_remaining === "boolean");
  const next = state(row.state), checked = integer(row.accounts_checked, 10), settled = integer(row.accounts_settled, checked);
  const fences = integer(row.scanned_fences, 100), events = integer(row.scanned_events, 100);
  demand(next.pending.length + settled <= checked);
  demand((next.after_fence !== null) === (fences === 100) && (next.after_event !== null) === (events === 100));
  return { retention_removed: integer(row.retention_removed, 1000), orphan_removed: integer(row.orphan_removed, checked * 100),
    accounts_checked: checked, accounts_settled: settled, scanned_fences: fences, scanned_events: events,
    expired_remaining: row.expired_remaining, state: next };
}
function serviceClient(environment: NodeJS.ProcessEnv): SupabaseClient {
  const url = environment["SUPABASE_URL"]?.trim() || environment["VITE_SUPABASE_URL"]?.trim();
  const key = environment["SUPABASE_SERVICE_ROLE_KEY"]?.trim() || environment["SELFHOST_SERVICE_ROLE_KEY"]?.trim();
  if (!url || !key) throw new Error("notification_feed_maintenance_credentials_missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export function createNotificationFeedMaintenanceRepository(
  environment: NodeJS.ProcessEnv = process.env, client: Pick<SupabaseClient, "rpc"> = serviceClient(environment),
): MaintenanceRepository {
  return {
    async maintain(input) {
      const previous = state(input);
      let response;
      try {
        // Bounds transport waiting, not a recall of an accepted DB transaction.
        response = await client.rpc("notification_feed_maintenance_v2", {
          p_after_fence: previous.after_fence, p_after_event: previous.after_event, p_pending: previous.pending,
        }).abortSignal(AbortSignal.timeout(30_000));
      } catch { throw new Error("notification_feed_maintenance_rpc_failed"); }
      if (!response || response.error !== null) throw new Error("notification_feed_maintenance_rpc_failed");
      return result(response.data);
    },
  };
}
