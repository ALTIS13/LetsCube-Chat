import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { compileAvatarWorker, changeOnce, workerSource } from "./media-variant-avatar-races.fixture.mjs";

process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";
const worker = await compileAvatarWorker();
const target = "78000000-0000-4000-8000-000000000001";
const forgedToken = "78000000-0000-4000-8000-000000000002";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Only transport replies are fictional; the actual SDK and compiled worker run.
function backend({ scope = "message", retry = false, finishMissing = false } = {}) {
  const calls = [], failures = [];
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json" },
  });
  const supabase = createClient("https://claim-token.invalid", "fictional-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init = {}) => {
      try {
        const url = new URL(typeof input === "string" ? input : input.url);
        const method = init.method ?? "GET";
        if (url.pathname.startsWith("/rest/v1/rpc/")) {
          assert.equal(method, "POST");
          const name = url.pathname.split("/").at(-1), args = JSON.parse(init.body);
          calls.push({ name, args });
          if (name === "media_variant_jobs_claim") return json([
            { scope, target_id: target, attempts: 0, claim_token: forgedToken },
          ]);
          assert.ok(["media_variant_job_finish", "media_variant_job_retry"].includes(name));
          return finishMissing ? json({ code: "PGRST202", message: "fixture missing overload" }, 404) : json(false);
        }
        assert.equal(method, "GET");
        assert.equal(url.pathname, `/rest/v1/${scope === "message" ? "messages" : scope === "profile" ? "profiles" : "chats"}`);
        assert.equal(url.searchParams.get("id"), `eq.${target}`);
        return retry ? json({ code: "55P03", message: "fixture busy" }, 503) : json([]);
      } catch (error) { failures.push(error); throw error; }
    } },
  });
  return { supabase, calls, assertTransport: () => assert.deepEqual(failures, []) };
}

function assertBound(calls, method) {
  assert.equal(calls.length, 2, "one claim and one settlement; no unguarded fallback");
  assert.equal(calls[0].name, "media_variant_jobs_claim");
  assert.match(calls[0].args.p_claim_token, uuid);
  assert.equal(calls[1].name, method);
  assert.equal(calls[1].args.p_target_id, target);
  assert.equal(calls[1].args.p_claim_token, calls[0].args.p_claim_token);
  assert.notEqual(calls[1].args.p_claim_token, forgedToken, "claim ownership comes from our accepted request, not row metadata");
}

for (const scope of ["message", "profile", "chat"]) {
  for (const retry of [false, true]) {
    test(`${scope} ${retry ? "retry" : "finish"} uses its exact claim token`, async () => {
      const fixture = backend({ scope, retry });
      await worker.runMediaVariantsTick(fixture.supabase, { scan: false });
      fixture.assertTransport();
      assertBound(fixture.calls, retry ? "media_variant_job_retry" : "media_variant_job_finish");
      assert.equal(fixture.calls[1].args.p_scope, scope);
      if (retry) assert.match(fixture.calls[1].args.p_error, /^[a-z][a-z0-9_]{0,63}$/);
    });
  }
}

test("a missing token overload never falls back to an unguarded call", async () => {
  const fixture = backend({ finishMissing: true });
  await worker.runMediaVariantsTick(fixture.supabase, { scan: false });
  fixture.assertTransport();
  assertBound(fixture.calls, "media_variant_job_finish");
});

test("successive claim batches have separate ownership tokens", async () => {
  const fixture = backend();
  await worker.runMediaVariantsTick(fixture.supabase, { scan: false });
  await worker.runMediaVariantsTick(fixture.supabase, { scan: false });
  fixture.assertTransport();
  assertBound(fixture.calls.slice(0, 2), "media_variant_job_finish");
  assertBound(fixture.calls.slice(2), "media_variant_job_finish");
  assert.notEqual(fixture.calls[0].args.p_claim_token, fixture.calls[2].args.p_claim_token);
});

test("actual compiled settlement-token omissions fail the unchanged oracle", async () => {
  for (const retry of [false, true]) {
    const anchor = retry ? "p_error: sanitizeVariantErrorCode(errorCode)," : "p_scope: job.scope,";
    const site = retry
      ? "    p_claim_token: job.claim_token,\n    p_error: sanitizeVariantErrorCode(errorCode),"
      : "    p_claim_token: job.claim_token,\n    p_scope: job.scope,";
    const mutant = await compileAvatarWorker(changeOnce(workerSource, site, `    ${anchor}`));
    const fixture = backend({ retry });
    await mutant.runMediaVariantsTick(fixture.supabase, { scan: false });
    fixture.assertTransport();
    assert.throws(() => assertBound(fixture.calls, retry ? "media_variant_job_retry" : "media_variant_job_finish"), assert.AssertionError);
  }
});
