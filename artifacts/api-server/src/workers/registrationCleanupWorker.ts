import { randomUUID } from "node:crypto";
import type { RegistrationCleanupRepository } from "./registrationCleanupRepository";
import type { RegistrationCleanupConfig } from "./registrationCleanupRules";

export type CleanupBatchResult = {
  claimed: number;
  reported: number;
  deleted: number;
  skipped: number;
  failed: number;
};

export type RegistrationCleanupWorkerStatus = {
  configured: boolean;
  enabled: boolean;
  reportOnly: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastResult: CleanupBatchResult | null;
};

type RuntimeOptions = {
  readConfig?: (environment: NodeJS.ProcessEnv) => RegistrationCleanupConfig;
  createRepository?: (
    environment: NodeJS.ProcessEnv,
  ) => Promise<RegistrationCleanupRepository>;
  runBatch?: (
    config: RegistrationCleanupConfig,
    repository: RegistrationCleanupRepository,
  ) => Promise<CleanupBatchResult | null>;
  now?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => void;
};

function emptyStatus(): RegistrationCleanupWorkerStatus {
  return {
    configured: false,
    enabled: false,
    reportOnly: true,
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastResult: null,
  };
}

function emptyResult(): CleanupBatchResult {
  return { claimed: 0, reported: 0, deleted: 0, skipped: 0, failed: 0 };
}

async function finishAfterCandidateFailure(
  repository: RegistrationCleanupRepository,
  userId: string,
  claimToken: string,
  reason: string,
): Promise<void> {
  try {
    await repository.finish(userId, claimToken, "failed", reason);
  } catch {
    // The per-candidate failure is already isolated; never expose backend details.
  }
}

export async function runRegistrationCleanupBatch(
  config: RegistrationCleanupConfig,
  repository: RegistrationCleanupRepository,
): Promise<CleanupBatchResult | null> {
  const result = emptyResult();
  const claimToken = randomUUID();
  const now = new Date().toISOString();
  let candidates;

  try {
    candidates = await repository.claim(config.batchSize, claimToken, now);
  } catch {
    return null;
  }

  result.claimed = candidates.length;
  for (const candidate of candidates) {
    try {
      const eligible = await repository.recheck(
        candidate.user_id,
        claimToken,
        now,
      );
      if (!eligible) {
        await repository.finish(
          candidate.user_id,
          claimToken,
          "skipped",
          "eligibility_changed",
        );
        result.skipped += 1;
        continue;
      }

      if (config.reportOnly) {
        await repository.report(candidate.user_id, claimToken, "report_only");
        result.reported += 1;
        continue;
      }

      try {
        await repository.deleteAuthUser(candidate.user_id);
      } catch {
        await finishAfterCandidateFailure(
          repository,
          candidate.user_id,
          claimToken,
          "delete_failed",
        );
        result.failed += 1;
        continue;
      }

      await repository.finish(
        candidate.user_id,
        claimToken,
        "deleted",
        "expired_unconfirmed",
      );
      result.deleted += 1;
    } catch {
      await finishAfterCandidateFailure(
        repository,
        candidate.user_id,
        claimToken,
        "candidate_processing_failed",
      );
      result.failed += 1;
    }
  }

  return result;
}

async function loadRegistrationCleanupRepository(
  environment: NodeJS.ProcessEnv,
): Promise<RegistrationCleanupRepository> {
  const { createRegistrationCleanupRepository } =
    await import("./registrationCleanupRepository");
  return createRegistrationCleanupRepository(environment);
}

export function createRegistrationCleanupWorkerRuntime(
  options: RuntimeOptions = {},
): {
  start(environment?: NodeJS.ProcessEnv): Promise<void>;
  status(): RegistrationCleanupWorkerStatus;
} {
  let started = false;
  let starting = false;
  let current = emptyStatus();
  const now = options.now ?? (() => new Date());
  const schedule =
    options.schedule ??
    ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
    });

  const status = (): RegistrationCleanupWorkerStatus => ({
    ...current,
    lastResult: current.lastResult ? { ...current.lastResult } : null,
  });

  const markFailure = (result: CleanupBatchResult | null = null): void => {
    current.lastSuccessAt = null;
    current.lastFailureAt = now().toISOString();
    current.lastResult = result ? { ...result } : null;
  };

  const markSuccess = (result: CleanupBatchResult): void => {
    current.lastFailureAt = null;
    current.lastSuccessAt = now().toISOString();
    current.lastResult = { ...result };
  };

  const scheduleRun = (
    config: RegistrationCleanupConfig,
    repository: RegistrationCleanupRepository,
  ): void => {
    schedule(() => {
      void runAndSchedule(config, repository);
    }, config.intervalMs);
  };

  const runAndSchedule = async (
    config: RegistrationCleanupConfig,
    repository: RegistrationCleanupRepository,
  ): Promise<void> => {
    current.lastRunAt = now().toISOString();
    try {
      const result = await (options.runBatch ?? runRegistrationCleanupBatch)(
        config,
        repository,
      );
      if (!result) {
        markFailure();
        return;
      }

      if (result.failed > 0) {
        markFailure(result);
        return;
      }

      markSuccess(result);
    } catch {
      markFailure();
    } finally {
      scheduleRun(config, repository);
    }
  };

  return {
    async start(environment = process.env): Promise<void> {
      if (started || starting) return;
      starting = true;
      try {
        const readConfig = options.readConfig ?? (
          await import("./registrationCleanupRules")
        ).readRegistrationCleanupConfig;
        const config = readConfig(environment);
        current = {
          ...current,
          configured: true,
          enabled: config.enabled,
          reportOnly: config.reportOnly,
        };
        if (!config.enabled) return;

        const repository = await (options.createRepository ??
          loadRegistrationCleanupRepository)(environment);
        started = true;
        await runAndSchedule(config, repository);
      } catch {
        markFailure();
      } finally {
        starting = false;
      }
    },
    status,
  };
}

const registrationCleanupWorkerRuntime = createRegistrationCleanupWorkerRuntime();

export function startRegistrationCleanupWorker(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  void registrationCleanupWorkerRuntime.start(environment);
}

export function getRegistrationCleanupWorkerStatus(): RegistrationCleanupWorkerStatus {
  return registrationCleanupWorkerRuntime.status();
}

export function registrationCleanupHealthPayload(
  status: RegistrationCleanupWorkerStatus & Record<string, unknown>,
): RegistrationCleanupWorkerStatus {
  return {
    configured: status.configured,
    enabled: status.enabled,
    reportOnly: status.reportOnly,
    lastRunAt: status.lastRunAt,
    lastSuccessAt: status.lastSuccessAt,
    lastFailureAt: status.lastFailureAt,
    lastResult: status.lastResult
      ? {
          claimed: status.lastResult.claimed,
          reported: status.lastResult.reported,
          deleted: status.lastResult.deleted,
          skipped: status.lastResult.skipped,
          failed: status.lastResult.failed,
        }
      : null,
  };
}
