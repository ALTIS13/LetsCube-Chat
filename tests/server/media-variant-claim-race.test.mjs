import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { postgres, read, quote } from "./bot-inline-media-ingest.fixture.mjs";

// Captured queue SQL with fictional schema/rows, not a worker or Storage test.
// A claim token is retry ownership, NOT durable external-I/O intent, physical
// generation or cleanup authority. Source URL ABA needs an independent source
// epoch before a production contract. No Storage/worker publication is exercised.
const sourcePath = ".migration-backup/supabase/migrations/20260913120000_media_variant_job_queue.sql";
const source = read(sourcePath);
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(sha(source), "a04d22bb9898256e704ef153d7b0ed120534b45a6e1635caba4a06c5a2bf49cc");
const id = "e6090000-0000-4000-8000-000000000001";
const otherId = "e6090000-0000-4000-8000-000000000002";
const tokenA = "e6090000-0000-4000-8000-000000000011";
const tokenB = "e6090000-0000-4000-8000-000000000012";
const tokenOther = "e6090000-0000-4000-8000-000000000013";
const sourceA = "media/avatars/fictional-source-a.png";
const sourceB = "media/avatars/fictional-source-b.png";
const finishSignature = "public.media_variant_job_finish(text,uuid)";
const retrySignature = "public.media_variant_job_retry(text,uuid,text,timestamptz)";
const guardedFinishSignature = "public.media_variant_job_finish(text,uuid,uuid)";
const guardedRetrySignature = "public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)";
const tokenGuard = `  if p_claim_token is null then return false; end if;
  perform 1 from private.media_variant_jobs
    where scope = p_scope and target_id = p_target_id
      and claim_token = p_claim_token
    for update;
  if not found then return false; end if;
`;
const bodyHashes = {
  enqueue_media_variant_job_for_message: "ec6d34af25acc6c8fed51283c39ca732564de992643637a289fdab37325be2e4",
  enqueue_media_variant_job_for_profile: "b1278128118f9b14f53f812d6ea847c7628a0cf3886ecf1de3205992894e2b22",
  enqueue_media_variant_job_for_chat: "0d013029bdc7813e6aa027ce82894a6cbee1af0a43dc9d4ce164da14b683effc",
  media_variant_jobs_claim: "9dab4c9e92628797808da641a66bfb8dc1983178f4045c5375356c9bdbb54859",
  media_variant_job_finish: "ff90a67c91b08374bf4420405c4af02e82c0f8ba726c932589324e3edb1c3d1d",
  media_variant_job_retry: "ac603cd7e571d97905a05c25558532d38b441dc4801d328bb96c61f45b010094",
};
const prepare = `set role postgres;
  alter table public.messages add column media_url text;
  alter table public.chats add column avatar_url text;
  create table public.profiles(id uuid primary key,avatar_url text);
  create table public.media_variants(message_id uuid,profile_id uuid,chat_id uuid,status text);
  alter table public.profiles enable row level security;
  alter table public.media_variants enable row level security;
`;

async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " exceeded its bound")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function track(pending, promise) {
  pending.add(promise);
  promise.then(() => pending.delete(promise), () => pending.delete(promise));
  return promise;
}

async function fixture(t, { injectAssertion = false } = {}) {
  assert.ok(process.env.BOT_INGEST_PG_BIN, "supply the approved owned-local PostgreSQL binary directory");
  assert.ok(!process.env.BOT_INGEST_TEST_BASELINE, "the exact captured queue SQL must execute");
  const pending = new Set(), failures = []; let directory;
  const injected = new assert.AssertionError({ message: "deliberate queue SQL adapter assertion" });
  const raw = await postgres({ after(cleanup) {
    t.after(async () => {
      const start = performance.now();
      try {
        await bounded(Promise.allSettled([...pending]), 8_000, "SQL settling before owned cleanup");
        assert.equal(pending.size, 0, "no SQL remains outstanding before DB teardown");
      } finally { await bounded(cleanup(), 12_000, "exact-owned PG cleanup"); }
      assert.ok(performance.now() - start < 20_000, "literal 20s cleanup bound");
      assert.equal(existsSync(directory), false, "the exact owned temporary PG directory is absent");
      t.diagnostic("owned PG stopped; exact temporary directory absent; SQL settled; cleanup <20s");
    });
  } }, prepare + source + "\nreset role;");
  const exec = sql => bounded(track(pending, (async () => {
    try {
      if (injectAssertion && sql === "set role service_role; select 'fictional-queue-adapter-assertion';") throw injected;
      return await raw.exec("set statement_timeout='3s'; set lock_timeout='2s';\n" + sql);
    } catch (error) {
      // Expected PostgreSQL denials remain real SQL errors. Assertions/transport
      // faults are never synthesized into refusal results or swallowed by helpers.
      if (!/^[0-9A-Z]{5}$/.test(error.code ?? "")) failures.push(error);
      throw error;
    }
  })()), 8_000, "owned SQL transport");
  const query = async sql => JSON.parse(await exec("select coalesce(jsonb_agg(q),'[]'::jsonb) from (" + sql + ") q;"));
  const service = async sql => JSON.parse(await exec("set role service_role; select coalesce(jsonb_agg(q),'[]'::jsonb) from (" + sql + ") q;"));
  const [owner] = await query("select current_user as owner,current_setting('data_directory') as directory");
  directory = owner.directory; assert.equal(owner.owner, "fixture_control");
  assert.equal(resolve(dirname(directory)), resolve(tmpdir())); assert.match(basename(directory), /^letscube-bot-ingest-/);
  t.diagnostic("local PostgreSQL " + raw.version + "; exact archived queue functions, fictional subset only");
  const functions = await query(`select proname,prosrc from pg_proc where proname in (${Object.keys(bodyHashes).map(quote).join(",")})`);
  assert.equal(functions.length, 6);
  for (const fn of functions) assert.equal(sha(fn.prosrc), bodyHashes[fn.proname], "exact compiled archived body");
  const rows = () => query("select * from private.media_variant_jobs order by scope,target_id");
  return { exec, query, service, rows, failures, injected };
}

async function takeover(f, scope) {
  assert.ok(["profile", "chat"].includes(scope));
  await f.exec(`insert into public.profiles(id,avatar_url) values ('${id}',${scope === "profile" ? quote(sourceA) : "null"}),
    ('${otherId}',${quote(sourceA)});
    insert into public.chats(id,type,avatar_url) values ('${id}','group',${scope === "chat" ? quote(sourceA) : "null"});
    insert into private.media_variant_jobs(scope,target_id,available_at,claim_token,claimed_at)
      values (${quote(scope === "profile" ? "chat" : "profile")},'${id}',clock_timestamp()+interval '1 day','${tokenOther}',clock_timestamp());
    update private.media_variant_jobs set available_at=clock_timestamp()+interval '1 day'
      where scope='profile' and target_id='${otherId}';`);
  const claim = token => f.service(`select * from public.media_variant_jobs_claim(1,'${token}',clock_timestamp())`);
  assert.deepEqual(await claim(tokenA), [{ scope, target_id: id, attempts: 0 }]);
  const first = (await f.rows()).find(row => row.scope === scope && row.target_id === id);
  assert.equal(first.claim_token, tokenA); assert.ok(first.claimed_at);
  const table = scope === "profile" ? "profiles" : "chats";
  await f.exec(`update public.${table} set avatar_url=${quote(sourceB)} where id='${id}';`);
  const enqueued = (await f.rows()).find(row => row.scope === scope && row.target_id === id);
  assert.deepEqual(enqueued, { ...first, attempts: 0, claim_token: null, claimed_at: null, last_error: null,
    available_at: enqueued.available_at }, "new avatar really re-enqueues and revokes A's claim without expiry");
  assert.deepEqual(await claim(tokenB), [{ scope, target_id: id, attempts: 0 }]);
  const before = await f.rows(), current = before.find(row => row.scope === scope && row.target_id === id);
  assert.equal(current.claim_token, tokenB); assert.notEqual(current.claimed_at, first.claimed_at);
  assert.equal(current.enqueued_at, first.enqueued_at);
  const unrelated = before.filter(row => row.scope !== scope || row.target_id !== id); assert.equal(unrelated.length, 2);
  assert.deepEqual(await f.query(`select avatar_url from public.${table} where id='${id}'`), [{ avatar_url: sourceB }]);
  return { scope, before, current, unrelated, claim };
}

async function action(f, schedule, method, { token, error = "fictional_a_failed", now = "clock_timestamp()" } = {}) {
  const parameter = token === undefined ? "" : "," + (token === null ? "null::uuid" : quote(token) + "::uuid");
  const sql = method === "finish"
    ? `select public.media_variant_job_finish(${quote(schedule.scope)},'${id}'${parameter}) as value`
    : `select public.media_variant_job_retry(${quote(schedule.scope)},'${id}',${quote(error)},${now}${parameter}) as value`;
  const rows = await f.service(sql); assert.equal(rows.length, 1); assert.equal(typeof rows[0].value, "boolean");
  return rows[0].value;
}

function assertStaleRefused(value) {
  assert.equal(value, false, "literal stale A refusal: old work must not acknowledge B's claim");
}

function assertBPreserved(after, schedule) {
  assert.deepEqual(after, schedule.before, "independent safety oracle: B and all unrelated queue rows remain unchanged");
}

function isLiteralRefusalRed(error) {
  return error instanceof assert.AssertionError && error.code === "ERR_ASSERTION" &&
    error.actual === true && error.expected === false && error.message.includes("literal stale A refusal:");
}

function isPreservationRed(error) {
  return error instanceof assert.AssertionError && error.code === "ERR_ASSERTION" &&
    error.message.includes("independent safety oracle:");
}

function assertUnrelated(after, schedule) {
  assert.deepEqual(after.filter(row => row.scope !== schedule.scope || row.target_id !== id), schedule.unrelated,
    "scope AND target ownership must preserve unrelated rows, including the same UUID in another scope");
}

async function assertCounterexample(f, schedule, method, options) {
  const [now] = await f.query("select clock_timestamp() as value");
  const actual = await action(f, schedule, method, { ...options, now: quote(now.value) + "::timestamptz" });
  assert.equal(actual, true, "captured stale call actually reports success, not an auth/setup error");
  const after = await f.rows();
  assert.throws(() => assertStaleRefused(actual), isLiteralRefusalRed);
  assert.throws(() => assertBPreserved(after, schedule), isPreservationRed);
  // This second oracle still goes RED if a caller ignores or fabricates a false
  // return value. Its expectation is the committed B snapshot, not the result.
  assertStaleRefused(false);
  assert.throws(() => assertBPreserved(after, schedule), isPreservationRed);
  assertUnrelated(after, schedule);
  const current = after.find(row => row.scope === schedule.scope && row.target_id === id);
  if (method === "finish") {
    assert.equal(current, undefined, "stale finish deleted the newer B claim"); assert.equal(after.length, 2);
  } else {
    assert.equal(after.length, 3);
    assert.deepEqual(current, { ...schedule.current, attempts: 1, claim_token: null, claimed_at: null,
      last_error: "fictional_a_failed", available_at: current.available_at }, "stale retry rewrote B's ownership/backoff");
    const [delay] = await f.query(`select extract(epoch from available_at-${quote(now.value)}::timestamptz)::int as seconds
      from private.media_variant_jobs where scope=${quote(schedule.scope)} and target_id='${id}'`);
    assert.equal(delay.seconds, 60, "stale A scheduled B with the literal first-retry 60s delay");
  }
  assert.deepEqual(f.failures, []); return { actual, after };
}

async function catalog(f) {
  const rows = await f.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_functiondef(p.oid) as definition,p.prosrc,pg_get_userbyid(p.proowner) as owner,
    p.proacl::text as acl,p.proconfig,p.prosecdef,p.provolatile
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in (${Object.keys(bodyHashes).map(quote).join(",")})
    order by n.nspname,p.proname,arguments`);
  return { rows, digest: sha(JSON.stringify(rows)) };
}

function replaceOnce(source, marker, replacement) {
  assert.equal(source.split(marker).length, 2, "one exact compiled candidate/mutation marker");
  return source.replace(marker, replacement);
}

// TEST-ONLY overloads, not a runtime repair: the existing worker still calls the
// unsafe old signatures. A row lock makes check-and-action atomic within SQL,
// preserving legacy retry/exhaustion semantics after clearing claim_token.
async function withCandidate(f, body) {
  const before = await catalog(f);
  const [finish] = await f.query(`select pg_get_functiondef(${quote(finishSignature)}::regprocedure) as definition`);
  const [retry] = await f.query(`select pg_get_functiondef(${quote(retrySignature)}::regprocedure) as definition`);
  const finishCandidate = replaceOnce(replaceOnce(finish.definition, "p_target_id uuid)",
    "p_target_id uuid, p_claim_token uuid)"), "  delete from private.media_variant_jobs\n",
  tokenGuard + "  delete from private.media_variant_jobs\n");
  const retryCandidate = replaceOnce(replaceOnce(retry.definition, "p_now timestamp with time zone)",
    "p_now timestamp with time zone, p_claim_token uuid)"), "  update private.media_variant_jobs\n",
  tokenGuard + "  update private.media_variant_jobs\n");
  try {
    await f.exec(`set role postgres; ${finishCandidate}; ${retryCandidate};
      revoke all on function ${guardedFinishSignature},${guardedRetrySignature} from public,anon,authenticated,service_role;
      grant execute on function ${guardedFinishSignature},${guardedRetrySignature} to service_role; reset role;`);
    assert.equal((await catalog(f)).rows.length, 8);
    await body();
  } finally {
    try {
      await f.exec(`set role postgres; drop function if exists ${guardedFinishSignature};
        drop function if exists ${guardedRetrySignature}; reset role;`);
    } finally {
      await f.exec(`set role postgres; ${finish.definition}; ${retry.definition}; reset role;`);
      assert.deepEqual(await catalog(f), before, "exact original bodies/definitions/owner/ACL/config/digest restored in finally");
    }
  }
}

async function assertGuardedRefusal(f, schedule, method, token) {
  assertStaleRefused(await action(f, schedule, method, { token }));
  assertBPreserved(await f.rows(), schedule);
}

async function positiveFinish(f, schedule, guarded) {
  const options = guarded ? { token: tokenB } : {};
  assert.equal(await action(f, schedule, "finish", options), true, "current B successfully finishes its own job");
  const after = await f.rows(); assert.deepEqual(after, schedule.unrelated);
  assert.equal(await action(f, schedule, "finish", options), false, "already-finished exact job does not exist");
  assert.deepEqual(await f.rows(), schedule.unrelated); assert.deepEqual(f.failures, []);
}

async function positiveRetry(f, schedule, guarded) {
  const [now] = await f.query("select clock_timestamp() as value");
  const options = { ...(guarded ? { token: tokenB } : {}), error: "NOT A SAFE ERROR", now: quote(now.value) + "::timestamptz" };
  assert.equal(await action(f, schedule, "retry", options), true, "current B successfully retries its own job");
  const after = await f.rows(), current = after.find(row => row.scope === schedule.scope && row.target_id === id);
  assertUnrelated(after, schedule);
  assert.deepEqual(current, { ...schedule.current, attempts: 1, claim_token: null, claimed_at: null,
    last_error: "variant_generation_failed", available_at: current.available_at });
  const [delay] = await f.query(`select extract(epoch from available_at-${quote(now.value)}::timestamptz)::int as seconds
    from private.media_variant_jobs where scope=${quote(schedule.scope)} and target_id='${id}'`);
  assert.equal(delay.seconds, 60, "literal first-retry delay; no wall-clock sleep");
  assert.deepEqual(await schedule.claim(tokenA), [], "released B work is not immediately due");
  if (guarded) {
    assert.equal(await action(f, schedule, "retry", { token: tokenB }), false, "released token no longer owns retry");
    assert.equal(await action(f, schedule, "finish", { token: tokenB }), false, "released token cannot finish");
    assert.deepEqual(await f.rows(), after);
  }
  const claimed = await f.service(`select * from public.media_variant_jobs_claim(1,'${tokenOther}',${quote(current.available_at)}::timestamptz)`);
  assert.deepEqual(claimed, [{ scope: schedule.scope, target_id: id, attempts: 1 }]);
  assert.equal(await action(f, schedule, "finish", guarded ? { token: tokenOther } : {}), true);
  assert.deepEqual(await f.rows(), schedule.unrelated); assert.deepEqual(f.failures, []);
}

for (const scope of ["profile", "chat"]) {
  for (const method of ["finish", "retry"]) {
    test(`captured ${scope} stale A ${method} mutates B: literal refusal and independent safety oracles RED`,
      { timeout: 90_000 }, async t => {
        const f = await fixture(t), schedule = await takeover(f, scope);
        await assertCounterexample(f, schedule, method);
        t.diagnostic("captured " + method + " returned true, expected false; B preservation separately RED; no runtime repair");
      });
  }
}

for (const scope of ["profile", "chat"]) {
  for (const method of ["finish", "retry"]) {
    test(`TEST-ONLY token prototype ${scope}/${method}: stale/null refusal, B succeeds, unrelated rows preserved`,
      { timeout: 90_000 }, async t => {
        const f = await fixture(t), schedule = await takeover(f, scope);
        await withCandidate(f, async () => {
          await assertGuardedRefusal(f, schedule, method, tokenA);
          await assertGuardedRefusal(f, schedule, method, null);
          if (method === "finish") await positiveFinish(f, schedule, true);
          else await positiveRetry(f, schedule, true);
        });
        assert.deepEqual(f.failures, []);
        t.diagnostic("token prototype protects retry owner only; no I/O intent, physical generation or URL-ABA/source-epoch proof");
      });
  }
}

for (const method of ["finish", "retry"]) {
  test(`compiled TEST-ONLY ${method} token-predicate omission restores stale mutation; exact catalog restored`,
    { timeout: 90_000 }, async t => {
      const f = await fixture(t), schedule = await takeover(f, "profile");
      await withCandidate(f, async () => {
        const before = await catalog(f), signature = method === "finish" ? guardedFinishSignature : guardedRetrySignature;
        const [original] = await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as definition`);
        const mutant = replaceOnce(original.definition, "      and claim_token = p_claim_token\n", "");
        try {
          await f.exec("set role postgres;" + mutant + ";reset role;");
          assert.notEqual((await catalog(f)).digest, before.digest);
          await assertCounterexample(f, schedule, method, { token: tokenA });
        } finally {
          await f.exec("set role postgres;" + original.definition + ";reset role;");
          assert.deepEqual(await catalog(f), before, "compiled guarded candidate exactly restored after omission oracle RED");
        }
      });
      t.diagnostic("real compiled token-predicate omission returned true; literal false and B-preservation oracles RED; exact digest restored");
    });
}

async function expectPermissionDenied(f, role, expression, name) {
  await assert.rejects(f.exec(`set role ${role}; select ${expression};`), error => {
    if (error instanceof assert.AssertionError || !/^[0-9A-Z]{5}$/.test(error.code ?? "")) throw error;
    assert.equal(error.code, "42501"); assert.ok(error.message.includes("permission denied"));
    assert.ok(error.message.includes(name)); return true;
  });
}

test("captured grants and TEST-ONLY overloads preserve service-only RPC and private/table scopes", { timeout: 90_000 }, async t => {
  const f = await fixture(t), schedule = await takeover(f, "profile");
  const assertRoles = async guarded => {
    const signatures = ["public.media_variant_jobs_claim(integer,uuid,timestamptz)", finishSignature, retrySignature,
      ...(guarded ? [guardedFinishSignature, guardedRetrySignature] : [])];
    for (const signature of signatures) {
      const [acl] = await f.query(`select pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
        has_function_privilege('anon',p.oid,'execute') as anon,
        has_function_privilege('authenticated',p.oid,'execute') as authenticated,
        has_function_privilege('service_role',p.oid,'execute') as service_role from pg_proc p where p.oid=${quote(signature)}::regprocedure`);
      assert.deepEqual(acl, { owner: "postgres", prosecdef: true,
        proconfig: ["search_path=pg_catalog, public, private"], anon: false, authenticated: false, service_role: true });
    }
    for (const role of ["anon", "authenticated"]) {
      await expectPermissionDenied(f, role, `public.media_variant_jobs_claim(1,'${tokenA}',clock_timestamp())`, "media_variant_jobs_claim");
      await expectPermissionDenied(f, role, `public.media_variant_job_finish('profile','${id}')`, "media_variant_job_finish");
      await expectPermissionDenied(f, role, `public.media_variant_job_retry('profile','${id}','fictional_failed',clock_timestamp())`, "media_variant_job_retry");
      if (guarded) {
        await expectPermissionDenied(f, role, `public.media_variant_job_finish('profile','${id}','${tokenB}'::uuid)`, "media_variant_job_finish");
        await expectPermissionDenied(f, role, `public.media_variant_job_retry('profile','${id}','fictional_failed',clock_timestamp(),'${tokenB}'::uuid)`, "media_variant_job_retry");
      }
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      await expectPermissionDenied(f, role, "count(*) from private.media_variant_jobs", "schema private");
      await expectPermissionDenied(f, role, "private.enqueue_media_variant_job_for_profile()", "schema private");
    }
    assertBPreserved(await f.rows(), schedule); assert.deepEqual(f.failures, []);
  };
  await assertRoles(false);
  await withCandidate(f, () => assertRoles(true));
  await positiveRetry(f, schedule, false);
});

test("queue adapter assertion survives refusal helper and finally restores prototype before owned cleanup", { timeout: 90_000 }, async t => {
  const f = await fixture(t, { injectAssertion: true }), schedule = await takeover(f, "profile"), before = await catalog(f);
  await assert.rejects(withCandidate(f, async () => {
    await expectPermissionDenied(f, "service_role", "'fictional-queue-adapter-assertion'", "unused-fictional-permission");
  }), error => error === f.injected);
  assert.deepEqual(await catalog(f), before); assertBPreserved(await f.rows(), schedule);
  assert.deepEqual(f.failures, [f.injected], "the exact adapter assertion is not a fabricated auth denial");
});
