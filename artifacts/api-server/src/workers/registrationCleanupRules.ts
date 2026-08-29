export type RegistrationCleanupConfig = {
  enabled: boolean;
  reportOnly: boolean;
  batchSize: number;
  intervalMs: number;
};

export function readRegistrationCleanupConfig(
  env: NodeJS.ProcessEnv,
): RegistrationCleanupConfig {
  const batch = Number(env.REGISTRATION_CLEANUP_BATCH_SIZE ?? 50);
  const seconds = Number(env.REGISTRATION_CLEANUP_INTERVAL_SECONDS ?? 3600);

  return {
    enabled: env.REGISTRATION_CLEANUP_ENABLED === "true",
    reportOnly: env.REGISTRATION_CLEANUP_REPORT_ONLY !== "false",
    batchSize: Math.min(
      100,
      Math.max(1, Number.isFinite(batch) ? Math.floor(batch) : 50),
    ),
    intervalMs: Math.min(
      86_400_000,
      Math.max(
        60_000,
        Number.isFinite(seconds) ? Math.floor(seconds * 1000) : 3_600_000,
      ),
    ),
  };
}
