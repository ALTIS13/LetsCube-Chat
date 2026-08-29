import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRegistrationCleanupRepository } from "../../artifacts/api-server/src/workers/registrationCleanupRepository.ts";
import { runRegistrationCleanupBatch } from "../../artifacts/api-server/src/workers/registrationCleanupWorker.ts";

const root = new URL("../../", import.meta.url);

async function source(file) {
  return readFile(new URL(file, root), "utf8").catch(() => "");
}

function config(overrides = {}) {
  return {
    enabled: true,
    reportOnly: false,
    batchSize: 50,
    intervalMs: 3_600_000,
    ...overrides,
  };
}

function createRepository({
  candidates,
  recheck = () => true,
  deleteAuthUser = () => undefined,
}) {
  const calls = {
    claim: [],
    recheck: [],
    report: [],
    deleteAuthUser: [],
    finish: [],
  };

  return {
    calls,
    repository: {
      async claim(limit, claimToken, now) {
        calls.claim.push({ limit, claimToken, now });
        return candidates;
      },
      async recheck(userId, claimToken, now) {
        calls.recheck.push({ userId, claimToken, now });
        return recheck(userId);
      },
      async report(userId, claimToken, reason) {
        calls.report.push({ userId, claimToken, reason });
      },
      async deleteAuthUser(userId) {
        calls.deleteAuthUser.push(userId);
        return deleteAuthUser(userId);
      },
      async finish(userId, claimToken, action, reason) {
        calls.finish.push({ userId, claimToken, action, reason });
      },
    },
  };
}

test("report-only cleanup never deletes an eligible candidate", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "public" }],
  });

  const result = await runRegistrationCleanupBatch(
    config({ reportOnly: true }),
    fake.repository,
  );

  assert.equal(result.reported, 1);
  assert.equal(fake.calls.deleteAuthUser.length, 0);
  assert.deepEqual(
    fake.calls.report.map(({ reason }) => reason),
    ["report_only"],
  );
});

test("active cleanup rechecks immediately before deleting", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "invite" }],
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result.deleted, 1);
  assert.deepEqual(fake.calls.deleteAuthUser, ["candidate-a"]);
  assert.deepEqual(fake.calls.finish, [
    {
      userId: "candidate-a",
      claimToken: fake.calls.claim[0].claimToken,
      action: "deleted",
      reason: "expired_unconfirmed",
    },
  ]);
  assert.equal(
    fake.calls.recheck[0].claimToken,
    fake.calls.claim[0].claimToken,
  );
});

test("a failed final recheck records a skipped candidate", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "public" }],
    recheck: () => false,
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result.skipped, 1);
  assert.equal(fake.calls.deleteAuthUser.length, 0);
  assert.deepEqual(
    fake.calls.finish.map(({ action, reason }) => ({ action, reason })),
    [{ action: "skipped", reason: "eligibility_changed" }],
  );
});

test("a deletion failure records a bounded failed reason", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "public" }],
    deleteAuthUser: () => {
      throw new Error("unavailable");
    },
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result.failed, 1);
  assert.deepEqual(
    fake.calls.finish.map(({ action, reason }) => ({ action, reason })),
    [{ action: "failed", reason: "delete_failed" }],
  );
});

test("a candidate failure does not stop later candidates", async () => {
  const fake = createRepository({
    candidates: [
      { user_id: "candidate-a", signup_kind: "public" },
      { user_id: "candidate-b", signup_kind: "invite" },
    ],
    recheck: (userId) => {
      if (userId === "candidate-a") throw new Error("unavailable");
      return true;
    },
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result.failed, 1);
  assert.equal(result.deleted, 1);
  assert.deepEqual(fake.calls.deleteAuthUser, ["candidate-b"]);
  assert.deepEqual(
    fake.calls.finish.map(({ userId, action, reason }) => ({
      userId,
      action,
      reason,
    })),
    [
      {
        userId: "candidate-a",
        action: "failed",
        reason: "candidate_processing_failed",
      },
      {
        userId: "candidate-b",
        action: "deleted",
        reason: "expired_unconfirmed",
      },
    ],
  );
});

test("each batch uses a fresh claim token", async () => {
  const fake = createRepository({ candidates: [] });

  await runRegistrationCleanupBatch(config(), fake.repository);
  await runRegistrationCleanupBatch(config(), fake.repository);

  assert.notEqual(
    fake.calls.claim[0].claimToken,
    fake.calls.claim[1].claimToken,
  );
});

test("report and finish accept successful void RPC responses", async () => {
  const calls = [];
  const repository = createRegistrationCleanupRepository(
    {},
    {
      async rpc(name, params) {
        calls.push({ name, params });
        return { data: null, error: null };
      },
      auth: {
        admin: {
          async deleteUser() {
            return { error: null };
          },
        },
      },
    },
  );

  await repository.report("candidate-a", "claim-a", "report_only");
  await repository.finish(
    "candidate-a",
    "claim-a",
    "skipped",
    "eligibility_changed",
  );

  assert.deepEqual(
    calls.map(({ params }) => params.p_action),
    ["reported", "skipped"],
  );
});

test("cleanup startup is bundled and remains disabled by default", async () => {
  const [index, build, rules, worker, repository] = await Promise.all([
    source("artifacts/api-server/src/index.ts"),
    source("artifacts/api-server/build.mjs"),
    source("artifacts/api-server/src/workers/registrationCleanupRules.ts"),
    source("artifacts/api-server/src/workers/registrationCleanupWorker.ts"),
    source("artifacts/api-server/src/workers/registrationCleanupRepository.ts"),
  ]);

  assert.match(index, /startRegistrationCleanupWorker/);
  assert.match(build, /src\/index\.ts/);
  assert.match(rules, /REGISTRATION_CLEANUP_ENABLED.*===\s*"true"/s);
  assert.match(rules, /REGISTRATION_CLEANUP_REPORT_ONLY.*!==\s*"false"/s);
  assert.match(worker, /setTimeout/);
  assert.match(worker, /\.unref\(\)/);
  assert.match(repository, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(repository, /VITE_SUPABASE|SELFHOST_SERVICE_ROLE_KEY/);
});
