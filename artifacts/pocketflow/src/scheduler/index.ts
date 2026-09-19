import type { Logger } from "#pf/lib/logger";

/**
 * The background loop. It knows about jobs and nothing else.
 *
 * Reminders are one registered job and the watcher will be another, which is
 * why there is a registry here rather than a `setInterval` inside the reminders
 * feature. Two features each running their own timer is two shutdown paths, two
 * overlap bugs and two places that swallow an exception differently.
 *
 * **The scheduler holds no durable state, deliberately** (§19: a job must
 * survive a restart). The only thing it remembers is when each job last ran,
 * and that memory is disposable: a fresh process has no `lastRunAt`, so every
 * job is due on the first tick, and the job itself then asks Postgres what is
 * outstanding. Nothing is scheduled *in* the scheduler — there is no timer per
 * reminder and no in-memory queue — because anything held there would be lost
 * on a deploy, and a reminder lost on a deploy is the exact failure a person
 * cannot detect.
 *
 * Three more properties, each of which is a defect if missing:
 *
 *   - **No overlap.** A job whose previous run has not finished is skipped
 *     rather than started again. A scheduler that starts a second pass over the
 *     same due rows is a scheduler that fires everything twice the first time
 *     the database is slow.
 *   - **One job's failure is one job's failure.** `run` is awaited inside a
 *     `try`, and a throw is counted and logged; it never reaches the timer and
 *     never stops a sibling job.
 *   - **Shutdown drains.** `stop()` aborts the signal the jobs were given and
 *     then waits for the in-flight ones, bounded. A process that exits mid-send
 *     leaves a claimed reminder that nobody will retry until the claim expires.
 */

export type JobRunContext = {
  /** Aborted when the scheduler is stopping. A long job should check it. */
  signal: AbortSignal;
  now: Date;
};

export type SchedulerJob = {
  /** Unique. Two jobs under one name is a programming error, not a config. */
  name: string;
  intervalMs: number;
  run: (context: JobRunContext) => Promise<void>;
};

export type JobStatus = {
  name: string;
  intervalMs: number;
  running: boolean;
  runs: number;
  failures: number;
  lastRunAt: Date | null;
  lastError: string | null;
};

export type Scheduler = {
  registerJob(job: SchedulerJob): void;
  start(): void;
  /** Resolves true if every in-flight job finished within the timeout. */
  stop(options?: { timeoutMs?: number }): Promise<boolean>;
  /** One pass over every due job. What `start()` calls on a timer. */
  tick(): Promise<void>;
  status(): JobStatus[];
};

export type Timer = { cancel(): void };

export type SchedulerOptions = {
  log: Logger;
  now?: () => Date;
  /**
   * Injected so a test can drive the loop without waiting.
   *
   * Tests here call `tick()` directly instead, which is why this is rarely
   * used: a test that fakes a timer proves the fake works, while a test that
   * calls the same function the timer calls proves the pass does.
   */
  schedule?: (fn: () => void, delayMs: number) => Timer;
  /** Floor and ceiling for the loop's own period. */
  minTickMs?: number;
  maxTickMs?: number;
};

const DEFAULT_MIN_TICK_MS = 250;
const DEFAULT_MAX_TICK_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

function defaultSchedule(fn: () => void, delayMs: number): Timer {
  const handle = setTimeout(fn, delayMs);
  return { cancel: () => clearTimeout(handle) };
}

type Entry = {
  job: SchedulerJob;
  running: boolean;
  runs: number;
  failures: number;
  lastRunAt: Date | null;
  lastError: string | null;
  inFlight: Promise<void> | null;
};

export function createScheduler(options: SchedulerOptions): Scheduler {
  const log = options.log.with({ component: "scheduler" });
  const now = options.now ?? (() => new Date());
  const schedule = options.schedule ?? defaultSchedule;
  const minTickMs = options.minTickMs ?? DEFAULT_MIN_TICK_MS;
  const maxTickMs = options.maxTickMs ?? DEFAULT_MAX_TICK_MS;

  const entries = new Map<string, Entry>();
  let controller = new AbortController();
  let timer: Timer | null = null;
  let started = false;
  let stopping = false;

  function tickIntervalMs(): number {
    let shortest = maxTickMs;
    for (const entry of entries.values()) {
      shortest = Math.min(shortest, entry.job.intervalMs);
    }
    return Math.max(minTickMs, Math.min(maxTickMs, shortest));
  }

  function due(entry: Entry, at: Date): boolean {
    if (entry.running) return false;
    // Never run: due now. This is what makes a restart pick the work back up
    // without anything being persisted about the schedule itself.
    if (entry.lastRunAt === null) return true;
    return at.getTime() - entry.lastRunAt.getTime() >= entry.job.intervalMs;
  }

  async function runOne(entry: Entry, at: Date): Promise<void> {
    entry.running = true;
    entry.lastRunAt = at;
    entry.runs += 1;
    const jobLog = log.with({ job: entry.job.name });
    const started_ = Date.now();
    try {
      await entry.job.run({ signal: controller.signal, now: at });
      entry.lastError = null;
      jobLog.debug("job.ok", { duration_ms: Date.now() - started_ });
    } catch (error) {
      entry.failures += 1;
      entry.lastError = error instanceof Error ? error.message : "unknown";
      // Logged and swallowed. A throw that reached the timer would stop every
      // other job, and the one thing worse than a watcher that fails is a
      // watcher that fails and takes the reminders with it.
      jobLog.error("job.failed", {
        error: entry.lastError,
        duration_ms: Date.now() - started_,
      });
    } finally {
      entry.running = false;
      entry.inFlight = null;
    }
  }

  async function tick(): Promise<void> {
    const at = now();
    const pending: Promise<void>[] = [];
    for (const entry of entries.values()) {
      if (stopping) break;
      if (!due(entry, at)) continue;
      const promise = runOne(entry, at);
      entry.inFlight = promise;
      pending.push(promise);
    }
    // Jobs of one tick run concurrently — they touch different tables and a
    // slow watcher must not delay a due reminder — but the tick itself is
    // awaited, so the timer cannot start a second pass over the same jobs.
    await Promise.all(pending);
  }

  function loop(): void {
    if (stopping || !started) return;
    timer = schedule(() => {
      void tick()
        .catch((error: unknown) => {
          // `tick` already swallows per-job failures; reaching here means the
          // loop itself broke, which must still not stop the loop.
          log.error("scheduler.tick_failed", {
            error: error instanceof Error ? error.message : "unknown",
          });
        })
        .finally(() => loop());
    }, tickIntervalMs());
  }

  return {
    registerJob(job) {
      if (entries.has(job.name)) {
        throw new Error(`scheduler job ${job.name} is registered twice`);
      }
      if (!Number.isFinite(job.intervalMs) || job.intervalMs <= 0) {
        throw new Error(`scheduler job ${job.name} needs a positive intervalMs`);
      }
      entries.set(job.name, {
        job,
        running: false,
        runs: 0,
        failures: 0,
        lastRunAt: null,
        lastError: null,
        inFlight: null,
      });
      log.info("scheduler.job_registered", { job: job.name, interval_ms: job.intervalMs });
    },

    start() {
      if (started) return;
      started = true;
      stopping = false;
      // A fresh controller per start, so a scheduler that is stopped and
      // started again does not hand its jobs a signal that is already aborted.
      if (controller.signal.aborted) controller = new AbortController();
      log.info("scheduler.started", { jobs: entries.size, tick_ms: tickIntervalMs() });
      loop();
    },

    async stop(stopOptions) {
      if (!started && !stopping) return true;
      stopping = true;
      started = false;
      timer?.cancel();
      timer = null;
      controller.abort();

      const inFlight = [...entries.values()]
        .map((entry) => entry.inFlight)
        .filter((promise): promise is Promise<void> => promise !== null);
      if (inFlight.length === 0) {
        log.info("scheduler.stopped", { drained: true });
        return true;
      }

      // Bounded: a job that ignores its abort signal must not hold the process
      // open for ever. The answer says which happened, so a caller can log a
      // clean shutdown differently from a forced one.
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<false>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), stopOptions?.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
      });
      const drained = await Promise.race([Promise.all(inFlight).then(() => true), timeout]);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      log.info("scheduler.stopped", { drained });
      return drained;
    },

    tick,

    status() {
      return [...entries.values()].map((entry) => ({
        name: entry.job.name,
        intervalMs: entry.job.intervalMs,
        running: entry.running,
        runs: entry.runs,
        failures: entry.failures,
        lastRunAt: entry.lastRunAt,
        lastError: entry.lastError,
      }));
    },
  };
}
