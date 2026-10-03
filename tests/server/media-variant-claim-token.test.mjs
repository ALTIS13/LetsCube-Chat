import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { postgres, read, quote } from "./bot-inline-media-ingest.fixture.mjs";
import { runMediaVariantClaimTokenCase, claimTokenCases } from "./media-variant-claim-token.contract.mjs";

// Real archived queue + deployable SQL in disposable owned PG only. Claim
// ownership is NOT a source epoch, Storage intent, publication or cleanup fence.
const stem = "20261003183925_media_variant_claim_token";
const migration = read(`supabase/migrations/${stem}.sql`);
const captured = read(".migration-backup/supabase/migrations/20260913120000_media_variant_job_queue.sql");
const capturedOnly = process.env.MEDIA_CLAIM_CAPTURED === "1";
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(sha(captured), "a04d22bb9898256e704ef153d7b0ed120534b45a6e1635caba4a06c5a2bf49cc");
const id = "e6100000-0000-4000-8000-000000000001";
const other = "e6100000-0000-4000-8000-000000000002";
const tokenA = "e6100000-0000-4000-8000-000000000011";
const tokenB = "e6100000-0000-4000-8000-000000000012";
const tokenC = "e6100000-0000-4000-8000-000000000013";
const sourceA = "https://claim-token.invalid/fictional-a.png";
const sourceB = "https://claim-token.invalid/fictional-b.png";
const signatures = ["public.media_variant_job_finish(text,uuid)",
  "public.media_variant_job_retry(text,uuid,text,timestamptz)",
  "public.media_variant_job_finish(text,uuid,uuid)",
  "public.media_variant_job_retry(text,uuid,text,timestamptz,uuid)"];
const prepare = `set role postgres;
  alter table public.messages add column media_url text;
  alter table public.chats add column avatar_url text;
  create table public.profiles(id uuid primary key,avatar_url text);
  create table public.media_variants(message_id uuid,profile_id uuid,chat_id uuid,status text);
  alter table public.profiles enable row level security;
  alter table public.media_variants enable row level security;
`;
let raw, directory;
const cleanupCallbacks = [], outstanding = new Set();

// The inherited initdb launcher has no cancellation API. Keep startup outside
// per-case timeouts so slow initialization cannot register cleanup too late.
before(async () => {
  assert.ok(process.env.BOT_INGEST_PG_BIN, "supply the configured owned local PostgreSQL binary directory");
  assert.ok(!process.env.BOT_INGEST_TEST_BASELINE, "execute the actual archived queue bootstrap");
  raw = await postgres({ after(cleanup) { cleanupCallbacks.push(cleanup); } }, prepare + captured + "\nreset role;");
  const [owned] = await raw.query("select current_user as owner,current_setting('data_directory') as path");
  directory = owned.path; assert.equal(owned.owner, "fixture_control");
  assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
  assert.match(basename(directory), /^letscube-bot-ingest-/);
});

after(async () => {
  const started = performance.now();
  try {
    await bounded(Promise.allSettled([...outstanding]), 8000, "all owned SQL settling");
    assert.equal(outstanding.size, 0, "all SQL settles before exact-owned teardown");
  } finally {
    await bounded((async () => { for (const cleanup of cleanupCallbacks) await cleanup(); })(), 12000, "exact-owned PG disposal");
  }
  if (directory) assert.equal(existsSync(directory), false, "exact owned PG directory absent");
  assert.ok(performance.now() - started < 20000, "literal 20s final cleanup bound");
  console.log(`SQL pending=0; exact owned PG directory absent; cleanup ${Math.ceil(performance.now() - started)}ms`);
});

async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " exceeded its bound")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t, { install = !capturedOnly, injectAssertion = false } = {}) {
  const pending = new Set(), failures = [];
  const injected = new assert.AssertionError({ message: "fictional claim SQL adapter assertion" });
  const exec = sql => {
    const result = (async () => {
      try {
        if (injectAssertion && sql.includes("'fictional-claim-adapter-assertion'")) throw injected;
        return await raw.exec("set statement_timeout='4s'; set lock_timeout='3s';\n" + sql);
      } catch (error) {
        if (!/^[0-9A-Z]{5}$/.test(error.code ?? "")) failures.push(error);
        throw error;
      }
    })();
    pending.add(result); outstanding.add(result);
    const settled = () => { pending.delete(result); outstanding.delete(result); };
    result.then(settled, settled);
    return bounded(result, 8000, "owned SQL transport");
  };
  const query = async sql => JSON.parse(await exec(`select coalesce(jsonb_agg(q),'[]'::jsonb) from (${sql}) q;`));
  const service = async sql => {
    const rows = JSON.parse(await exec(`set role service_role; select coalesce(jsonb_agg(q),'[]'::jsonb) from (${sql}) q;`));
    assert.equal(rows.length, 1); return rows[0].value;
  };
  const rpc = async (name, args) => {
    const value = argument => argument === null ? "null" : typeof argument === "number" ? String(argument) : quote(argument);
    const sqlArgs = Object.entries(args).map(([key, argument]) => `${key} => ${value(argument)}`).join(",");
    if (name === "media_variant_jobs_claim") {
      return JSON.parse(await exec(`set role service_role; select coalesce(jsonb_agg(q),'[]'::jsonb) from public.${name}(${sqlArgs}) q;`));
    }
    assert.ok(["media_variant_job_finish", "media_variant_job_retry"].includes(name));
    return service(`select public.${name}(${sqlArgs}) as value`);
  };
  const rows = () => query("select * from private.media_variant_jobs order by scope,target_id");
  const apply = sql => exec("set role postgres;\n" + sql + "\nreset role;");
  const before = await catalog(query);
  assert.equal(before.functions.length, 6, "each case begins with exact prior queue catalog");
  t.after(async () => {
    await bounded(Promise.allSettled([...pending]), 8000, "case SQL settling");
    assert.equal(pending.size, 0);
    try {
      const [{ installed }] = await query("select to_regprocedure('public.media_variant_job_finish(text,uuid,uuid)') is not null as installed");
      if (installed) await apply(read(`supabase/migrations/${stem}.rollback.sql`));
      await exec(`delete from private.media_variant_jobs where target_id in (${quote(id)},${quote(other)},
          'e6100000-0000-4000-8000-000000000901','e6100000-0000-4000-8000-000000000902');
        delete from public.profiles where id=${quote(id)};
        delete from public.chats where id=${quote(id)};`);
      assert.deepEqual(await catalog(query), before, "case restores exact captured catalog before next case");
    } finally { assert.deepEqual(failures, injectAssertion ? [injected] : [], "unexpected adapter failures survive"); }
    t.diagnostic("case SQL settled; exact fictional rows removed; prior catalog restored");
  });
  if (install) await apply(migration);
  t.diagnostic(`owned PostgreSQL ${raw.version}; ${install ? "actual token migration" : "captured prior functions"}; no provider`);
  return { exec, query, service, rpc, rows, apply, before, failures, injected };
}

async function catalog(query) {
  const functions = await query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as ddl,p.prosrc,pg_get_userbyid(p.proowner) as owner,p.proacl::text as acl,
    p.proconfig,p.prosecdef,p.provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname in ('media_variant_jobs_claim','media_variant_job_finish','media_variant_job_retry',
      'enqueue_media_variant_job_for_message','enqueue_media_variant_job_for_profile','enqueue_media_variant_job_for_chat')
    and n.nspname in ('public','private') order by n.nspname,p.proname,args`);
  const tables = await query(`select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text as acl,
    pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r' order by n.nspname,c.relname`);
  const policies = await query("select * from pg_policies where schemaname in ('public','private') order by schemaname,tablename,policyname");
  const triggers = await query(`select tgname,pg_get_triggerdef(oid) as ddl,tgenabled from pg_trigger
    where not tgisinternal order by tgname`);
  return { functions, tables, policies, triggers, digest: sha(JSON.stringify({ functions, tables, policies, triggers })) };
}

async function takeover(f, scope) {
  const otherScope = scope === "profile" ? "chat" : "profile";
  if (scope === "profile" || scope === "chat") {
    await f.exec(`insert into public.${scope === "profile" ? "profiles" : "chats"}(id,avatar_url${scope === "chat" ? ",type" : ""})
      values (${quote(id)},${quote(sourceA)}${scope === "chat" ? ",'group'" : ""});`);
  } else {
    await f.exec(`insert into private.media_variant_jobs(scope,target_id) values ('message',${quote(id)});`);
  }
  await f.exec(`insert into private.media_variant_jobs(scope,target_id,available_at,attempts,claim_token,claimed_at,last_error)
    values (${quote(otherScope)},${quote(id)},clock_timestamp()+interval '1 day',3,${quote(tokenC)},clock_timestamp(),'fictional_unrelated'),
      (${quote(scope)},${quote(other)},clock_timestamp()+interval '1 day',2,${quote(tokenC)},clock_timestamp(),'fictional_unrelated');`);
  const claim = async (token, now = "clock_timestamp()") => {
    const output = await f.exec(`set role service_role; select coalesce(jsonb_agg(q),'[]'::jsonb)
      from public.media_variant_jobs_claim(1,${quote(token)},${now}) q;`);
    return JSON.parse(output);
  };
  assert.deepEqual(await claim(tokenA), [{ scope, target_id: id, attempts: 0 }]);
  const first = (await f.rows()).find(r => r.scope === scope && r.target_id === id);
  assert.equal(first.claim_token, tokenA);
  if (scope === "message") {
    await f.exec(`update private.media_variant_jobs set claimed_at=clock_timestamp()-interval '16 minutes'
      where scope='message' and target_id=${quote(id)} and claim_token=${quote(tokenA)};`);
  } else {
    await f.exec(`update public.${scope === "profile" ? "profiles" : "chats"} set avatar_url=${quote(sourceB)} where id=${quote(id)};`);
    const revoked = (await f.rows()).find(r => r.scope === scope && r.target_id === id);
    assert.deepEqual(revoked, { ...first, attempts: 0, claimed_at: null, claim_token: null, last_error: null,
      available_at: revoked.available_at });
  }
  assert.deepEqual(await claim(tokenB), [{ scope, target_id: id, attempts: 0 }]);
  const before = await f.rows(), current = before.find(r => r.scope === scope && r.target_id === id);
  assert.equal(current.claim_token, tokenB); assert.equal(current.enqueued_at, first.enqueued_at);
  const unrelated = before.filter(r => r.scope !== scope || r.target_id !== id);
  assert.equal(unrelated.length, 2);
  return { scope, before, current, unrelated, claim };
}

async function action(f, s, method, { token = tokenB, legacy = capturedOnly, error = "fictional_failed",
  now = "clock_timestamp()", scope = s.scope, target = id } = {}) {
  const sqlToken = token === null ? "null::uuid" : `${quote(token)}::uuid`;
  const sqlScope = scope === null ? "null::text" : quote(scope);
  const sqlTarget = target === null ? "null::uuid" : `${quote(target)}::uuid`;
  const args = `${sqlScope},${sqlTarget}` + (method === "retry" ? `,${error === null ? "null::text" : quote(error)},${now}` : "") +
    (legacy ? "" : `,${sqlToken}`);
  const value = await f.service(`select public.media_variant_job_${method}(${args}) as value`);
  assert.equal(typeof value, "boolean"); return value;
}

function refusal(value) {
  assert.equal(value, false, "literal exact-claim refusal: stale work must not mutate B");
}

async function refused(f, s, method, options) {
  refusal(await action(f, s, method, options));
  assert.deepEqual(await f.rows(), s.before, "B and every unrelated whole row stay byte-for-byte equivalent");
}

for (const { scope, method } of claimTokenCases) {
    test(`${scope}/${method}: exact-claim stale/null refusal, current B success and whole-row isolation`, { timeout: 90000 }, async t => {
      const f = await fixture(t);
      await f.exec(`insert into private.media_variant_jobs(scope,target_id,available_at,attempts,last_error)
        values ('message','e6100000-0000-4000-8000-000000000901','2025-01-01T00:00:00Z',4,'fictional_baseline'),
          ('chat','e6100000-0000-4000-8000-000000000902','2025-02-01T00:00:00Z',2,'fictional_baseline');`);
      await runMediaVariantClaimTokenCase(f, { scope, method, legacyCalls: capturedOnly });
    });
}

test("retry keeps literal 60/120/180/240 seconds and drops only its exact job on fifth failure", { timeout: 90000 }, async t => {
  const f = await fixture(t), s = await takeover(f, "profile");
  for (const [attempt, delay] of [[1, 60], [2, 120], [3, 180], [4, 240], [5, 300]]) {
    const [{ now }] = await f.query("select clock_timestamp() as now");
    assert.equal(await action(f, s, "retry", { error: attempt === 1 ? null : "fictional_failed", now: `${quote(now)}::timestamptz` }), attempt !== 5);
    const after = await f.rows();
    assert.deepEqual(after.filter(r => r.scope !== s.scope || r.target_id !== id), s.unrelated);
    if (attempt === 5) { assert.deepEqual(after, s.unrelated); break; }
    const current = after.find(r => r.scope === s.scope && r.target_id === id);
    assert.deepEqual(current, { ...s.current, attempts: attempt, claim_token: null, claimed_at: null,
      last_error: attempt === 1 ? "variant_generation_failed" : "fictional_failed", available_at: current.available_at });
    const [actual] = await f.query(`select extract(epoch from available_at-${quote(now)}::timestamptz)::int as seconds
      from private.media_variant_jobs where scope='profile' and target_id=${quote(id)}`);
    assert.equal(actual.seconds, delay);
    assert.deepEqual(await s.claim(tokenB, `${quote(current.available_at)}::timestamptz`), [{ scope: "profile", target_id: id, attempts: attempt }]);
  }
  refusal(await action(f, s, "retry")); refusal(await action(f, s, "finish"));
});

async function denied(f, role, expression) {
  await assert.rejects(f.exec(`set role ${role}; select ${expression};`), error => {
    if (error instanceof assert.AssertionError || !/^[0-9A-Z]{5}$/.test(error.code ?? "")) throw error;
    assert.equal(error.code, "42501"); assert.match(error.message, /permission denied/); return true;
  });
}

test("service-only grants, unchanged RLS/triggers/table scopes and exact rollback/reapply roundtrip", { timeout: 90000 }, async t => {
  const f = await fixture(t), s = await takeover(f, "profile"), installed = await catalog(f.query);
  assert.equal(f.before.functions.length, 6); assert.equal(installed.functions.length, 8);
  for (const field of ["tables", "policies", "triggers"]) assert.deepEqual(installed[field], f.before[field]);
  const unchanged = rows => rows.filter(row => !["media_variant_job_finish", "media_variant_job_retry"].includes(row.proname));
  assert.deepEqual(unchanged(installed.functions), unchanged(f.before.functions), "claim and enqueue definitions/grants unchanged");
  for (const signature of signatures) {
    const [acl] = await f.query(`select pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      has_function_privilege('service_role',p.oid,'execute') as service_role from pg_proc p where p.oid=${quote(signature)}::regprocedure`);
    assert.deepEqual(acl, { owner: "postgres", prosecdef: true, proconfig: ["search_path=pg_catalog, public, private"],
      anon: false, authenticated: false, service_role: true });
  }
  for (const role of ["anon", "authenticated"]) {
    for (const method of ["finish", "retry"]) {
      for (const legacy of [true, false]) {
        const args = `'profile',${quote(id)}` + (method === "retry" ? ",'fictional_failed',clock_timestamp()" : "") +
          (legacy ? "" : `,${quote(tokenB)}::uuid`);
        await denied(f, role, `public.media_variant_job_${method}(${args})`);
      }
    }
    await denied(f, role, `public.media_variant_jobs_claim(1,${quote(tokenA)},clock_timestamp())`);
  }
  for (const role of ["anon", "authenticated", "service_role"]) await denied(f, role, "count(*) from private.media_variant_jobs");
  for (const method of ["finish", "retry"]) await refused(f, s, method, { legacy: true });
  const rollback = read(`supabase/migrations/${stem}.rollback.sql`);
  assert.deepEqual(readFileSync(new URL(`../../supabase/migrations/${stem}.sql`, import.meta.url)),
    readFileSync(new URL(`../../.migration-backup/supabase/migrations/${stem}.sql`, import.meta.url)), "byte-identical archive");
  assert.deepEqual(readFileSync(new URL(`../../supabase/migrations/${stem}.rollback.sql`, import.meta.url)),
    readFileSync(new URL(`../../.migration-backup/supabase/migrations/${stem}.rollback.sql`, import.meta.url)), "byte-identical rollback archive");
  await f.apply(rollback);
  assert.deepEqual(await catalog(f.query), f.before, "exact prior definitions/owner/ACL/config/catalog digest");
  assert.deepEqual(await f.rows(), s.before, "rollback never fabricates or changes queue rows");
  await f.apply(migration);
  assert.deepEqual(await catalog(f.query), installed);
  await refused(f, s, "finish", { token: tokenA });
  assert.equal(await action(f, s, "finish"), true);
  assert.deepEqual(await f.rows(), s.unrelated);
});

for (const method of ["finish", "retry"]) {
  test(`${method}: compiled token-predicate omission gives literal RED; exact definition restored in finally`, { timeout: 90000 }, async t => {
    const f = await fixture(t), s = await takeover(f, "profile"), before = await catalog(f.query);
    const signature = signatures[method === "finish" ? 2 : 3];
    const [{ ddl }] = await f.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`);
    const marker = "      and job.claim_token = p_claim_token";
    assert.equal(ddl.split(marker).length, 3, "mutate both lock and DML token predicates");
    try {
      await f.apply(ddl.replaceAll(marker, ""));
      const actual = await action(f, s, method, { token: tokenA });
      assert.equal(actual, true);
      assert.throws(() => refusal(actual), { code: "ERR_ASSERTION", actual: true, expected: false });
      assert.notDeepEqual(await f.rows(), s.before, "independent whole-row preservation oracle also detects mutation");
      assert.deepEqual((await f.rows()).filter(r => r.scope !== s.scope || r.target_id !== id), s.unrelated);
    } finally {
      await f.apply(ddl); assert.deepEqual(await catalog(f.query), before);
    }
  });
}

test("migration selfchecks raise and roll back SECURITY DEFINER omission and public EXECUTE leak", { timeout: 90000 }, async t => {
  const f = await fixture(t, { install: false }), before = await catalog(f.query);
  for (const [marker, replacement] of [["security definer\nset search_path = pg_catalog, public, private", "set search_path = pg_catalog, public, private"],
    ["to service_role;", "to public;"]]) {
    assert.ok(migration.includes(marker));
    await assert.rejects(f.apply(migration.replace(marker, replacement)), error => {
      if (error instanceof assert.AssertionError) throw error;
      assert.equal(error.code, "P0001"); assert.match(error.message, /media_variant_claim_token_catalog_invalid/); return true;
    });
    assert.deepEqual(await catalog(f.query), before, "failed migration is one transaction, not half installed");
  }
  await f.apply(migration);
  assert.equal((await catalog(f.query)).functions.length, 8);
});

test("adapter assertion cannot become a role denial or literal false refusal", { timeout: 90000 }, async t => {
  const f = await fixture(t, { injectAssertion: true }), s = await takeover(f, "profile");
  await assert.rejects(denied(f, "service_role", "'fictional-claim-adapter-assertion'"), error => error === f.injected);
  assert.deepEqual(await f.rows(), s.before);
  assert.deepEqual(f.failures, [f.injected]);
  await refused(f, s, "finish", { token: tokenA });
});

test("shared contract rejects copied-row eligibility and ID collision before any fixture mutation or RPC", { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const baselineId = "e6100000-0000-4000-8000-000000000901";
  let calls = 0;
  const deps = { ...f, exec: async () => { calls++; assert.fail("unsafe fixture mutation"); },
    rpc: async () => { calls++; assert.fail("unsafe RPC"); } };
  await f.exec(`insert into private.media_variant_jobs(scope,target_id,available_at)
    values ('message',${quote(baselineId)},'2000-01-01T00:00:30Z');`);
  const original = await f.rows();
  await assert.rejects(runMediaVariantClaimTokenCase(deps, { scope: "profile", method: "finish" }),
    { code: "ERR_ASSERTION", actual: 1, expected: 0 });
  assert.equal(calls, 0); assert.deepEqual(await f.rows(), original);
  await f.exec(`delete from private.media_variant_jobs where scope='message' and target_id=${quote(baselineId)};
    insert into private.media_variant_jobs(scope,target_id,available_at) values ('message',${quote(id)},'2025-01-01T00:00:00Z');`);
  const collision = await f.rows();
  await assert.rejects(runMediaVariantClaimTokenCase(deps, { scope: "profile", method: "finish" }),
    { code: "ERR_ASSERTION", actual: 1, expected: 0 });
  assert.equal(calls, 0); assert.deepEqual(await f.rows(), collision);
});

test("exact token row lock: stale A is refused without waiting, current B waits and succeeds after release", { timeout: 90000 }, async t => {
  const f = await fixture(t), s = await takeover(f, "profile");
  const blocker = raw.session();
  const send = sql => {
    const job = blocker.send(sql); outstanding.add(job);
    const settled = () => outstanding.delete(job); job.then(settled, settled);
    return bounded(job, 8000, "owned blocker SQL");
  };
  try {
    await send(`begin; set local statement_timeout='4s'; set local lock_timeout='3s';
      select 1 from private.media_variant_jobs where scope='profile' and target_id=${quote(id)}
        and claim_token=${quote(tokenB)} for update;`);
    await refused(f, s, "finish", { token: tokenA });
    await assert.rejects(action(f, s, "finish"), error => {
      if (error instanceof assert.AssertionError) throw error;
      assert.equal(error.code, "55P03"); assert.match(error.message, /lock timeout/); return true;
    });
    assert.deepEqual(await f.rows(), s.before, "failed lock acquisition has no mutation");
  } finally {
    try { await send("rollback;"); }
    finally { await bounded(blocker.close(), 5000, "exact blocker session closure"); }
  }
  assert.equal(await action(f, s, "finish"), true);
  assert.deepEqual(await f.rows(), s.unrelated);
});
