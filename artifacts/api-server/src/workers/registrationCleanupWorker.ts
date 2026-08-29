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

let started = false;
let starting = false;

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
): Promise<CleanupBatchResult> {
  const result = emptyResult();
  const claimToken = randomUUID();
  const now = new Date().toISOString();
  let candidates;

  try {
    candidates = await repository.claim(config.batchSize, claimToken, now);
  } catch {
    return result;
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

export function startRegistrationCleanupWorker(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (started || starting) return;

  starting = true;
  void startEnabledRegistrationCleanupWorker(environment);
}

async function startEnabledRegistrationCleanupWorker(
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    const { readRegistrationCleanupConfig } =
      await import("./registrationCleanupRules");
    const config = readRegistrationCleanupConfig(environment);
    if (!config.enabled) return;

    const { createRegistrationCleanupRepository } =
      await import("./registrationCleanupRepository");
    const repository = createRegistrationCleanupRepository(environment);
    started = true;

    const scheduleNext = (): void => {
      const timer = setTimeout(() => {
        void runAndSchedule();
      }, config.intervalMs);
      timer.unref();
    };

    const runAndSchedule = async (): Promise<void> => {
      try {
        await runRegistrationCleanupBatch(config, repository);
      } finally {
        scheduleNext();
      }
    };

    void runAndSchedule();
  } catch {
    // Keep startup fail-closed without exposing credentials or backend details.
  } finally {
    starting = false;
  }
}
