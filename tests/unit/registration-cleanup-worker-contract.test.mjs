import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createRegistrationCleanupRepository,
  resolveRegistrationCleanupCredentials,
} from "../../artifacts/api-server/src/workers/registrationCleanupRepository.ts";
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
  deleteCandidate = () => true,
  purgeAudit = () => 0,
}) {
  const calls = {
    order: [],
    purgeAudit: [],
    claim: [],
    recheck: [],
    deleteCandidate: [],
    report: [],
    finish: [],
  };

  return {
    calls,
    repository: {
      async purgeAudit(now) {
        calls.order.push("purge");
        calls.purgeAudit.push(now);
        return purgeAudit(now);
      },
      async claim(limit, claimToken, now) {
        calls.order.push("claim");
        calls.claim.push({ limit, claimToken, now });
        return candidates;
      },
      async recheck(userId, claimToken, now) {
        calls.order.push("recheck");
        calls.recheck.push({ userId, claimToken, now });
        return recheck(userId);
      },
      async deleteCandidate(userId, claimToken, now) {
        calls.order.push("delete");
        calls.deleteCandidate.push({ userId, claimToken, now });
        return deleteCandidate(userId, claimToken, now);
      },
      async report(userId, claimToken, reason) {
        calls.order.push("report");
        calls.report.push({ userId, claimToken, reason });
      },
      async finish(userId, claimToken, action, reason) {
        calls.order.push(`finish:${action}`);
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
  assert.equal(fake.calls.deleteCandidate.length, 0);
  assert.deepEqual(fake.calls.order.slice(0, 2), ["purge", "claim"]);
  assert.deepEqual(
    fake.calls.report.map(({ reason }) => reason),
    ["report_only"],
  );
});

test("active cleanup purges, rechecks, then uses the atomic delete RPC", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "invite" }],
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result.deleted, 1);
  assert.equal(fake.calls.deleteCandidate.length, 1);
  assert.deepEqual(fake.calls.finish, []);
  assert.deepEqual(fake.calls.order, [
    "purge",
    "claim",
    "recheck",
    "delete",
  ]);
  assert.equal(
    fake.calls.recheck[0].claimToken,
    fake.calls.claim[0].claimToken,
  );
  assert.equal(fake.calls.deleteCandidate[0].claimToken, fake.calls.claim[0].claimToken);
});

test("atomic delete rejection records a skipped candidate and clears the claim", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "invite" }],
    deleteCandidate: () => false,
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result.skipped, 1);
  assert.deepEqual(
    fake.calls.finish.map(({ action, reason }) => ({ action, reason })),
    [{ action: "skipped", reason: "delete_not_completed" }],
  );
});

test("a failed final recheck records a skipped candidate", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "public" }],
    recheck: () => false,
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result.skipped, 1);
  assert.equal(fake.calls.deleteCandidate.length, 0);
  assert.deepEqual(
    fake.calls.finish.map(({ action, reason }) => ({ action, reason })),
    [{ action: "skipped", reason: "eligibility_changed" }],
  );
});

test("a deletion failure records a bounded failed reason", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "public" }],
    deleteCandidate: () => {
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
  assert.deepEqual(
    fake.calls.deleteCandidate.map(({ userId }) => userId),
    ["candidate-b"],
  );
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
    ],
  );
  assert.equal(fake.calls.finish.length, 1);
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

test("repository calls the atomic delete RPC and projects purge count", async () => {
  const calls = [];
  const repository = createRegistrationCleanupRepository(
    {},
    {
      async rpc(name, params) {
        calls.push({ name, params });
        if (name === "registration_cleanup_delete") {
          return { data: true, error: null };
        }
        if (name === "registration_cleanup_purge_audit") {
          return { data: 17, error: null };
        }
        return { data: null, error: null };
      },
      auth: {
        admin: {
          async deleteUser(userId) {
            calls.push({ name: "admin.deleteUser", params: { userId } });
            return { error: null };
          },
        },
      },
    },
  );

  assert.equal(await repository.purgeAudit("2026-08-30T10:00:00.000Z"), 17);
  assert.equal(
    await repository.deleteCandidate(
      "candidate-a",
      "claim-a",
      "2026-08-30T10:00:00.000Z",
    ),
    true,
  );

  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      "registration_cleanup_purge_audit",
      "registration_cleanup_delete",
    ],
  );
});

test("repository accepts the established self-host worker credential aliases", () => {
  const repository = createRegistrationCleanupRepository({
    VITE_SUPABASE_URL: "https://core.example.test",
    SELFHOST_SERVICE_ROLE_KEY: "self-host-service-role",
  });

  assert.equal(typeof repository.claim, "function");
  assert.equal(typeof repository.purgeAudit, "function");
});

test("repository credential resolution is ordered and fails closed", () => {
  assert.deepEqual(
    resolveRegistrationCleanupCredentials({
      SUPABASE_URL: "https://primary.example.test",
      VITE_SUPABASE_URL: "https://fallback.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "primary-service-role",
      SELFHOST_SERVICE_ROLE_KEY: "fallback-service-role",
    }),
    {
      url: "https://primary.example.test",
      serviceRoleKey: "primary-service-role",
    },
  );
  assert.deepEqual(
    resolveRegistrationCleanupCredentials({
      SUPABASE_URL: "   ",
      VITE_SUPABASE_URL: "https://fallback.example.test",
      SUPABASE_SERVICE_ROLE_KEY: " ",
      SELFHOST_SERVICE_ROLE_KEY: "fallback-service-role",
    }),
    {
      url: "https://fallback.example.test",
      serviceRoleKey: "fallback-service-role",
    },
  );
  assert.throws(
    () => resolveRegistrationCleanupCredentials({}),
    /registration_cleanup_credentials_missing/,
  );
});

test("audit purge failure fails the batch before candidates are claimed", async () => {
  const fake = createRepository({
    candidates: [{ user_id: "candidate-a", signup_kind: "public" }],
    purgeAudit: () => {
      throw new Error("unavailable");
    },
  });

  const result = await runRegistrationCleanupBatch(config(), fake.repository);

  assert.equal(result, null);
  assert.deepEqual(fake.calls.order, ["purge"]);
  assert.equal(fake.calls.claim.length, 0);
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
  assert.match(repository, /VITE_SUPABASE_URL/);
  assert.match(repository, /SELFHOST_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(repository, /VITE_[A-Z0-9_]*SERVICE_ROLE/);
});
