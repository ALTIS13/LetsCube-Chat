import type { MaintenanceRepository, MaintenanceResult, MaintenanceState } from "./notificationFeedMaintenanceRepository";

type Counts = Omit<MaintenanceResult, "state"> & { pending_count: number };
export type NotificationFeedMaintenanceStatus = {
  enabled: boolean; running: boolean; lastRunAt: string | null; lastSuccessAt: string | null;
  lastFailureAt: string | null; error: "maintenance_unavailable" | null; lastResult: Counts | null;
};
type Options = {
  createRepository?: (environment: NodeJS.ProcessEnv) => Promise<MaintenanceRepository>;
  now?: () => Date;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export function createNotificationFeedMaintenanceRuntime(options: Options = {}) {
  let active = false, running = false, generation = 0, timer: unknown;
  let inFlight: Promise<void> | undefined;
  let repository: MaintenanceRepository | undefined;
  let progress: MaintenanceState = { after_fence: null, after_event: null, pending: [] };
  let current: NotificationFeedMaintenanceStatus = {
    enabled: false, running: false, lastRunAt: null, lastSuccessAt: null,
    lastFailureAt: null, error: null, lastResult: null,
  };
  const now = options.now ?? (() => new Date());
  const schedule = options.schedule ?? ((callback, delay) => { const handle = setTimeout(callback, delay); handle.unref(); return handle; });
  const cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const createRepository = options.createRepository ?? (async environment => {
    const module = await import("./notificationFeedMaintenanceRepository");
    return module.createNotificationFeedMaintenanceRepository(environment);
  });
  async function logTick(g: number): Promise<void> {
    try {
      const { logger } = await import("../lib/logger");
      if (!active || g !== generation) return;
      const counts = current.lastResult;
      const fields = {
        code: current.error ?? "ok",
        retention_removed: counts?.retention_removed ?? null, orphan_removed: counts?.orphan_removed ?? null,
        accounts_checked: counts?.accounts_checked ?? null, accounts_settled: counts?.accounts_settled ?? null,
        scanned_fences: counts?.scanned_fences ?? null, scanned_events: counts?.scanned_events ?? null,
        expired_remaining: counts?.expired_remaining ?? null, pending_count: counts?.pending_count ?? null,
      };
      if (current.error) logger.warn(fields, "notificationFeedMaintenance tick");
      else logger.info(fields, "notificationFeedMaintenance tick");
    } catch { /* Logging failure must not escape startup or stop maintenance. */ }
  }
  async function tick(environment: NodeJS.ProcessEnv, g: number): Promise<void> {
    if (!active || g !== generation || running) return;
    running = true; current.running = true; current.lastRunAt = now().toISOString();
    try {
      const backend = repository ?? await createRepository(environment);
      if (!active || g !== generation) return;
      repository = backend;
      const result = await backend.maintain({ ...progress, pending: [...progress.pending] });
      if (!active || g !== generation) return;
      progress = { ...result.state, pending: [...result.state.pending] };
      // Progress UUIDs remain private. Never spread the service response into
      // status/logging; an RPC failure must not leave an earlier PASS current.
      current.lastResult = {
        retention_removed: result.retention_removed, orphan_removed: result.orphan_removed,
        accounts_checked: result.accounts_checked, accounts_settled: result.accounts_settled,
        scanned_fences: result.scanned_fences, scanned_events: result.scanned_events,
        expired_remaining: result.expired_remaining, pending_count: progress.pending.length,
      };
      current.lastSuccessAt = now().toISOString(); current.lastFailureAt = null; current.error = null;
    } catch {
      if (!active || g !== generation) return;
      current.lastSuccessAt = null; current.lastResult = null;
      current.lastFailureAt = now().toISOString(); current.error = "maintenance_unavailable";
    } finally {
      if (active && g === generation) {
        running = false; current.running = false;
        await logTick(g);
        if (active && g === generation) timer = schedule(() => { timer = undefined; void run(environment, g); }, 60_000);
      }
    }
  }
  async function run(environment: NodeJS.ProcessEnv, g: number): Promise<void> {
    // stop fences results, but an already-issued RPC still owns its transaction.
    if (inFlight) await inFlight;
    if (!active || g !== generation) return;
    const attempt = tick(environment, g);
    inFlight = attempt;
    try { await attempt; } finally { if (inFlight === attempt) inFlight = undefined; }
  }
  return {
    async start(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
      if (active || environment["NOTIFICATION_FEED_MAINTENANCE_ENABLED"] !== "true") return;
      active = true; current.enabled = true;
      await run(environment, ++generation);
    },
    stop() {
      active = false; generation++; running = false; current.enabled = false; current.running = false;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
    status(): NotificationFeedMaintenanceStatus {
      return { ...current, lastResult: current.lastResult ? { ...current.lastResult } : null };
    },
  };
}

const runtime = createNotificationFeedMaintenanceRuntime();
export function startNotificationFeedMaintenanceWorker(environment: NodeJS.ProcessEnv = process.env): void {
  void runtime.start(environment);
}
export function getNotificationFeedMaintenanceStatus(): NotificationFeedMaintenanceStatus { return runtime.status(); }
