import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Pure contract: no environment, file reads, startup, host selection or install.
// exec/query are trusted fixture-only SQL; rpc returns actual decoded SQL/HTTP
// results and MUST throw transport/SQL errors rather than manufacture false.
export const claimTokenFixtureIds = Object.freeze({
  target: "e6100000-0000-4000-8000-000000000001",
  unrelated: "e6100000-0000-4000-8000-000000000002",
  A: "e6100000-0000-4000-8000-000000000011",
  B: "e6100000-0000-4000-8000-000000000012",
  C: "e6100000-0000-4000-8000-000000000013",
});
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const digest = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const now = "2000-01-01T00:00:00+00:00";
const claimNow = "2000-01-01T00:00:01+00:00";
const latestClaim = "2000-01-01T00:01:01+00:00";
export const claimTokenCases = Object.freeze(["profile", "chat", "message"].flatMap(scope =>
  ["finish", "retry"].map(method => Object.freeze({ scope, method }))));

function sameRows(actual, expected, message) {
  assert.equal(actual.length, expected.length, message + ": count");
  assert.equal(digest(actual), digest(expected), message + ": whole-row digest");
}

export async function runMediaVariantClaimTokenCase({ query, exec, rpc }, { scope, method, legacyCalls = false }) {
  assert.ok(["profile", "chat", "message"].includes(scope));
  assert.ok(["finish", "retry"].includes(method));
  for (const adapter of [query, exec, rpc]) assert.equal(typeof adapter, "function");
  const { target, unrelated, A, B, C } = claimTokenFixtureIds;
  const otherScope = scope === "profile" ? "chat" : "profile";
  const rows = () => query("select * from private.media_variant_jobs order by scope,target_id");
  const owned = row => (row.scope === scope && [target, unrelated].includes(row.target_id)) ||
    (row.scope === otherScope && row.target_id === target);
  const baseline = await rows();
  assert.equal(baseline.filter(row => [target, unrelated].includes(row.target_id)).length, 0,
    "fictional IDs must be absent before taking ownership");
  const [eligible] = await query(`select count(*)::int as count from private.media_variant_jobs
    where available_at<=${quote(latestClaim)}::timestamptz
      and (claimed_at is null or claimed_at<${quote(latestClaim)}::timestamptz-interval '15 minutes')`);
  assert.equal(eligible.count, 0, "do not claim any baseline/copied row at the independent fictional clock");
  const action = async (name, { token = B, legacy = legacyCalls, error = "fictional_failed", at = claimNow,
    callScope = scope, callTarget = target } = {}) => {
    const args = { p_scope: callScope, p_target_id: callTarget,
      ...(name === "retry" ? { p_error: error, p_now: at } : {}),
      ...(legacy ? {} : { p_claim_token: token }) };
    const value = await rpc(`media_variant_job_${name}`, args);
    assert.equal(typeof value, "boolean", "actual RPC must return a boolean, never a fabricated error refusal");
    return value;
  };
  const claim = (token, at) => rpc("media_variant_jobs_claim", { p_limit: 1, p_claim_token: token, p_now: at });
  let primary, result;
  try {
    await exec(`insert into private.media_variant_jobs(scope,target_id,enqueued_at,available_at,attempts,claim_token,claimed_at,last_error)
      values (${quote(scope)},${quote(target)},'1999-12-31T00:00:00Z',${quote(now)},0,null,null,null),
      (${quote(otherScope)},${quote(target)},'1999-12-31T00:00:00Z','2001-01-01T00:00:00Z',3,${quote(C)},${quote(now)},'fictional_unrelated'),
      (${quote(scope)},${quote(unrelated)},'1999-12-31T00:00:00Z','2001-01-01T00:00:00Z',2,${quote(C)},${quote(now)},'fictional_unrelated');`);
    assert.deepEqual(await claim(A, now), [{ scope, target_id: target, attempts: 0 }]);
    const first = (await rows()).find(row => row.scope === scope && row.target_id === target);
    assert.equal(first.claim_token, A);
    await exec(`update private.media_variant_jobs set claimed_at=${quote(now)}::timestamptz-interval '16 minutes'
      where scope=${quote(scope)} and target_id=${quote(target)} and claim_token=${quote(A)};`);
    assert.deepEqual(await claim(B, claimNow), [{ scope, target_id: target, attempts: 0 }]);
    const before = await rows(), current = before.find(row => row.scope === scope && row.target_id === target);
    assert.equal(current.claim_token, B); assert.equal(current.enqueued_at, first.enqueued_at);
    assert.notEqual(current.claimed_at, first.claimed_at);
    sameRows(before.filter(row => !owned(row)), baseline, "claimed only fictional rows");
    const refuse = async (name, options) => {
      assert.equal(await action(name, options), false, "literal exact-claim refusal: stale work must not mutate B");
      sameRows(await rows(), before, "B and all unrelated whole rows unchanged");
    };
    await refuse(method, { token: A });
    await refuse(method, { token: null });
    await refuse(method, { callScope: null });
    await refuse(method, { callTarget: null });
    await refuse(method, { callScope: "unknown" });
    await refuse(method, { callScope: otherScope });
    await refuse(method, { callTarget: unrelated });
    if (method === "retry") await refuse(method, { at: null });
    for (const name of ["finish", "retry"]) await refuse(name, { legacy: true });
    const retained = before.filter(row => row.scope !== scope || row.target_id !== target);
    if (method === "finish") {
      assert.equal(await action("finish"), true);
      sameRows(await rows(), retained, "current finish affects exactly its owned row");
      assert.equal(await action("finish"), false, "finished token cannot be reused");
      sameRows(await rows(), retained, "duplicate finish has no side effects");
    } else {
      assert.equal(await action("retry", { error: "NOT SAFE" }), true);
      const after = await rows(), retried = after.find(row => row.scope === scope && row.target_id === target);
      assert.deepEqual(retried, { ...current, attempts: 1, claim_token: null, claimed_at: null,
        last_error: "variant_generation_failed", available_at: retried.available_at });
      const [delay] = await query(`select extract(epoch from available_at-${quote(claimNow)}::timestamptz)::int as seconds
        from private.media_variant_jobs where scope=${quote(scope)} and target_id=${quote(target)}`);
      assert.equal(delay.seconds, 60);
      sameRows(after.filter(row => row.scope !== scope || row.target_id !== target), retained, "retry preserves unrelated whole rows");
      for (const name of ["finish", "retry"]) {
        assert.equal(await action(name), false, "released B token cannot act");
        sameRows(await rows(), after, "released token does not change accounting/backoff or unrelated rows");
      }
      assert.deepEqual(await claim(C, claimNow), []);
      assert.deepEqual(await claim(C, retried.available_at), [{ scope, target_id: target, attempts: 1 }]);
      assert.equal(await action("finish"), false);
      assert.equal(await action("finish", { token: C }), true);
      sameRows(await rows(), retained, "new current token can finish exactly once");
    }
    result = { scope, method, stale: false, nullToken: false, current: true,
      ...(method === "retry" ? { backoffSeconds: 60, released: false, reclaimed: true } : {}), baselinePreserved: true };
  } catch (error) { primary = error; }
  try {
    await exec(`delete from private.media_variant_jobs where
      (scope=${quote(scope)} and target_id in (${quote(target)},${quote(unrelated)})) or
      (scope=${quote(otherScope)} and target_id=${quote(target)});`);
    sameRows(await rows(), baseline, "exact-owned cleanup restores all baseline whole rows");
  } catch (cleanupError) {
    if (primary) throw new AggregateError([primary, cleanupError], "contract failure and exact-owned cleanup failure");
    throw cleanupError;
  }
  if (primary) throw primary;
  return result;
}
