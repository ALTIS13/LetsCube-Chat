import assert from "node:assert/strict";
import test from "node:test";
import { postgres, read, stem, reservation, reserveSql, commitSql, object } from "./bot-inline-media-ingest.fixture.mjs";

const rollback = () => read(stem + ".rollback.sql");
const guard = "bot media ingest insert guard";
const predicate = "bucket_id <> 'chat-media' OR lower(split_part(name,'/',2)) <> 'bots'";

async function catalog(db) {
  return (await db.query(`select jsonb_build_object(
    'functions', (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname in (
        'bot_upload_authorize_internal','bot_send_message_internal','bot_message_command_internal',
        'bot_media_ingest_reserve_internal','bot_media_ingest_commit_internal')),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.polname) from pg_policy p
      where p.polrelid in ('storage.objects'::regclass,'private.bot_media_ingests'::regclass)),
    'tables', (select jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,
      'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl) order by c.oid)
      from pg_class c where c.oid in ('storage.objects'::regclass,'private.bot_media_ingests'::regclass)),
    'columns', (select jsonb_agg(jsonb_build_object('number',a.attnum,'acl',a.attacl) order by a.attnum)
      from pg_attribute a where a.attrelid='private.bot_media_ingests'::regclass),
    'receipts', (select count(*) from private.bot_media_ingests),
    'messages', (select count(*) from public.messages),
    'objects', (select count(*) from storage.objects)
  ) as value`))[0].value;
}

test("rollback refuses a changed WITH CHECK(false) policy and preserves the entire installed catalog", async (t) => {
  const db = await postgres(t);
  await db.exec(`alter policy "${guard}" on storage.objects with check(false);`);
  const before = await catalog(db);
  await assert.rejects(db.exec(rollback()), /bot_media_ingest_rollback_policy_drift/);
  assert.deepEqual(await catalog(db), before);
  assert.equal((await db.query(`select pg_get_expr(polwithcheck,polrelid) as expression from pg_policy
    where polrelid='storage.objects'::regclass and polname='${guard}'`))[0].expression, "false");
});

test("untouched rollback removes only its policies and retains the charged ledger and sent object", async (t) => {
  const db = await postgres(t), r = reservation();
  await db.service(reserveSql(r)); await object(db,r); await db.service(commitSql(r));
  const before = await catalog(db);
  await db.exec(rollback());
  const after = await catalog(db);
  assert.deepEqual(after.policies, before.policies.filter(p => !p.polname.startsWith("bot media ingest ")));
  assert.deepEqual(after.tables, before.tables); assert.deepEqual(after.columns, before.columns);
  assert.equal(after.receipts,1); assert.equal(after.messages,1); assert.equal(after.objects,1);
  assert.equal(after.functions.length,3);
});

test("rollback rejects policy roles, mode, command, expressions, absence and table ownership/RLS/ACL drift", async (t) => {
  const db = await postgres(t);
  // Every DDL/RLS mutation is confined to this throwaway fictional PostgreSQL fixture.
  const cases = [
    [`alter policy "${guard}" on storage.objects to authenticated;`,
      `alter policy "${guard}" on storage.objects to public;`, "policy"],
    [`drop policy "${guard}" on storage.objects;
      create policy "${guard}" on storage.objects as permissive for insert to public with check(${predicate});`,
      `drop policy "${guard}" on storage.objects;
      create policy "${guard}" on storage.objects as restrictive for insert to public with check(${predicate});`, "policy"],
    [`drop policy "${guard}" on storage.objects;
      create policy "${guard}" on storage.objects as restrictive for update to public using(${predicate}) with check(${predicate});`,
      `drop policy "${guard}" on storage.objects;
      create policy "${guard}" on storage.objects as restrictive for insert to public with check(${predicate});`, "policy"],
    ['alter policy "bot media ingest update guard" on storage.objects using(false);',
      `alter policy "bot media ingest update guard" on storage.objects using(${predicate});`, "policy"],
    ['alter policy "bot media ingest update guard" on storage.objects with check(false);',
      `alter policy "bot media ingest update guard" on storage.objects with check(${predicate});`, "policy"],
    ['alter policy "bot media ingest delete guard" on storage.objects using(false);',
      `alter policy "bot media ingest delete guard" on storage.objects using(${predicate});`, "policy"],
    [`drop policy "${guard}" on storage.objects;`,
      `create policy "${guard}" on storage.objects as restrictive for insert to public with check(${predicate});`, "policy"],
    ["alter table storage.objects owner to postgres;", "alter table storage.objects owner to supabase_storage_admin;", "table"],
    ["alter table storage.objects disable row level security;", "alter table storage.objects enable row level security;", "table"],
    ["alter table private.bot_media_ingests owner to supabase_admin;", "alter table private.bot_media_ingests owner to postgres;", "table"],
    ["alter table private.bot_media_ingests disable row level security;", "alter table private.bot_media_ingests enable row level security;", "table"],
    ["grant select on private.bot_media_ingests to service_role;", "revoke select on private.bot_media_ingests from service_role;", "table"],
    ["grant select(bot_id) on private.bot_media_ingests to service_role;", "revoke select(bot_id) on private.bot_media_ingests from service_role;", "table"],
  ];
  for (const [mutation, restore, kind] of cases) {
    await db.exec(mutation);
    const before = await catalog(db);
    await assert.rejects(db.exec(rollback()), new RegExp(`bot_media_ingest_rollback_${kind}_drift`), mutation);
    assert.deepEqual(await catalog(db),before,mutation);
    await db.exec(restore);
  }
  await db.exec(rollback());
});

test("the policy drift regression goes red if a mutant removes the rollback prestate guard", async (t) => {
  const db = await postgres(t);
  await db.exec(`alter policy "${guard}" on storage.objects with check(false);`);
  const mutant = rollback().replace(/DO \$table_policy_prestate\$[\s\S]*?\$table_policy_prestate\$;/, "");
  assert.notEqual(mutant,rollback());
  await assert.rejects(() => assert.rejects(db.exec(mutant),/bot_media_ingest_rollback_policy_drift/), /Missing expected rejection/);
  assert.equal((await db.query(`select count(*)::int as n from pg_policy
    where polrelid='storage.objects'::regclass and polname='${guard}'`))[0].n,0);
});

async function waitForLock(db,pid,event) {
  for (let attempt=0;attempt<75;attempt++) {
    const [row] = await db.query(`select wait_event_type='Lock' and wait_event='${event}' as waiting
      from pg_stat_activity where pid=${pid}`);
    if (row?.waiting) return;
    await new Promise(resolve => setTimeout(resolve,40));
  }
  throw new Error(`fixture connection did not reach ${event} lock`);
}

test("rollback table locks prevent policy DDL between the exact prestate check and removal", async (t) => {
  const db = await postgres(t), gate=db.session(), worker=db.session(), changer=db.session();
  const workerPid=Number(await worker.send("select pg_backend_pid();"));
  const changerPid=Number(await changer.send("select pg_backend_pid();"));
  await gate.send("begin; select pg_advisory_xact_lock(829102002); ");
  const script=rollback().replace("$table_policy_prestate$;",
    "$table_policy_prestate$;\nSELECT pg_advisory_xact_lock(829102002);");
  const applying=worker.send(script);
  await waitForLock(db,workerPid,"advisory");
  const denied=assert.rejects(changer.send(`alter policy "${guard}" on storage.objects with check(false);`),
    error=>error.code==="42704" && /does not exist/.test(error.message));
  await waitForLock(db,changerPid,"relation");
  await gate.send("commit;"); await applying; await denied;
  assert.equal((await db.query(`select count(*)::int as n from pg_policy
    where polrelid='storage.objects'::regclass and polname='${guard}'`))[0].n,0);
});
