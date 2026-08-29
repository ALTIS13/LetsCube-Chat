import assert from "node:assert/strict";
import test from "node:test";
import { readRegistrationCleanupConfig } from "../../artifacts/api-server/src/workers/registrationCleanupRules.ts";

test("cleanup is disabled and report-only by default", () => {
  const config = readRegistrationCleanupConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.reportOnly, true);
  assert.equal(config.batchSize, 50);
  assert.equal(config.intervalMs, 3_600_000);
});

test("batch and interval stay bounded", () => {
  const config = readRegistrationCleanupConfig({
    REGISTRATION_CLEANUP_ENABLED: "true",
    REGISTRATION_CLEANUP_REPORT_ONLY: "false",
    REGISTRATION_CLEANUP_BATCH_SIZE: "5000",
    REGISTRATION_CLEANUP_INTERVAL_SECONDS: "1",
  });

  assert.equal(config.batchSize, 100);
  assert.equal(config.intervalMs, 60_000);
});
