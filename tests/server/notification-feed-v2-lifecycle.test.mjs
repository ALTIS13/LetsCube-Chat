import assert from 'node:assert/strict';
import test from 'node:test';
import {lifecycleFixture,service,sweep,orphan,id,user,other,put,quote,lifecycleProposal} from './notification-feed-v2-lifecycle.fixture.mjs';
import {readFile} from 'node:fs/promises';
import {createNotificationFeedMaintenanceRepository} from '../../artifacts/api-server/src/workers/notificationFeedMaintenanceRepository.ts';
const scalar=async(db,sql)=>(await db.query(sql)).rows[0].value;
async function setup(t,options) {const db=await lifecycleFixture(options);t.after(()=>db.close());return db;}

test('actual lifecycle RPC removes an orphan fence and events without rewriting notification history',async t=>{
  const db=await setup(t);await put(db,100);
  const before=await scalar(db,'select jsonb_agg(to_jsonb(n)) as value from public.notifications n');
  const uid=await orphan(db,900);
  assert.equal(await scalar(db,"select to_regprocedure('public.notification_feed_maintenance_v2(uuid,uuid,uuid[])') is not null as value"),true,
    'actual lifecycle supplement is required, not an unwired helper');
  const result=await sweep(db);
  assert.equal(result.orphan_removed,2,'fence activation itself also leaves one event');
  assert.equal(await scalar(db,`select count(*)::int as value from private.notification_feed_fences_v2 where recipient_id='${uid}'`),0);
  assert.equal(await scalar(db,`select count(*)::int as value from public.notification_feed_events_v2 where recipient_id='${uid}'`),0);
  assert.deepEqual(await scalar(db,'select jsonb_agg(to_jsonb(n)) as value from public.notifications n'),before);
});

const events=(db,uid)=>scalar(db,`select count(*)::int as value from public.notification_feed_events_v2${uid?` where recipient_id='${uid}'`:''}`);
const fences=(db,uid)=>scalar(db,`select count(*)::int as value from private.notification_feed_fences_v2${uid?` where recipient_id='${uid}'`:''}`);
const refused=(fn,code)=>assert.rejects(fn,error=>error.code===code);
async function retention(db) {
  await db.exec(`insert into public.notification_feed_events_v2(recipient_id,event_kind,created_at)
    select '${user}','invalidate',clock_timestamp()-interval '25 hours' from generate_series(1,1001);
    insert into public.notification_feed_events_v2(recipient_id,event_kind,created_at)
    values('${user}','invalidate',clock_timestamp()-interval '23 hours 30 minutes');`);
  assert.equal(await service(db,'notification_feed_cleanup_v2','1000'),1000,'literal retention cap 1000');
  assert.equal(await events(db),2);
  assert.equal(await service(db,'notification_feed_cleanup_v2','1000'),1);
  assert.equal(await events(db),1,'literal younger-than-24h event survives');
}
test('fixed 24h cutoff and exact1000 retention cap preserve the fresh suffix',async t=>retention(await setup(t)));

test('both old cleanup ABIs retain strict input limits and maintenance bounds pending before dedupe',async t=>{
  const db=await setup(t);
  for(const limit of ['null','0','1001']) {
    await refused(()=>service(db,'notification_feed_cleanup_v2',limit),'22023');
    await refused(()=>service(db,'notification_feed_retire_account_v2',`'${id(900)}',${limit}`),'22023');
  }
  for(const array of ['null',`array_fill('${user}'::uuid,ARRAY[11])`,`ARRAY[null]::uuid[]`,`ARRAY[ARRAY['${user}']]::uuid[]`])
    await refused(()=>service(db,'notification_feed_maintenance_v2',`null,null,${array}`),'22023');
});

test('bounded pending continues a large orphan across ticks; its fence survives until the last event',async t=>{
  const db=await setup(t),uid=await orphan(db,900,{events:205});
  let result=await sweep(db);assert.equal(result.orphan_removed,100);assert.deepEqual(result.state.pending,[uid]);
  assert.equal(await fences(db,uid),1);assert.equal(await events(db,uid),106);
  result=await sweep(db,result.state);assert.equal(result.orphan_removed,100);assert.equal(await fences(db,uid),1);
  result=await sweep(db,result.state);assert.equal(result.orphan_removed,6);assert.equal(result.accounts_settled,1);
  assert.deepEqual(result.state.pending,[]);assert.equal(await fences(db,uid),0);
});

test('actual SQL envelopes pass the actual repository parser across pending and cursor progress',async t=>{
  const db=await setup(t),uid=await orphan(db,900,{events:205});
  await db.exec(`insert into auth.users(id) select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1000,1104)n;
    insert into private.notification_feed_fences_v2(recipient_id) select id from auth.users where id>='${id(1000)}'`);
  let calls=0;
  const repository=createNotificationFeedMaintenanceRepository({}, {rpc:(name,args)=>({abortSignal(signal){
    assert.ok(signal instanceof AbortSignal);return this;
  },async then(resolve,reject){try {
    assert.equal(name,'notification_feed_maintenance_v2');calls++;
    const data=await service(db,name,`${args.p_after_fence?quote(args.p_after_fence):'null'},${args.p_after_event?quote(args.p_after_event):'null'},ARRAY[${args.p_pending.map(quote).join(',')}]::uuid[]`);
    return resolve({data,error:null});
  } catch(error) {return reject(error);}}})});
  let result=await repository.maintain({after_fence:null,after_event:null,pending:[]});
  assert.equal(result.orphan_removed,100);assert.deepEqual(result.state.pending,[uid]);
  assert.equal(result.scanned_fences,100);assert.notEqual(result.state.after_fence,null);
  result=await repository.maintain(result.state);assert.equal(result.orphan_removed,100);
  result=await repository.maintain(result.state);assert.equal(result.orphan_removed,6);
  assert.equal(result.accounts_settled,1);assert.deepEqual(result.state.pending,[]);assert.equal(calls,3);
});

async function accountBudget(db) {
  for(let n=900;n<915;n++) await orphan(db,n,{events:101});
  const first=await sweep(db);
  assert.equal(first.accounts_checked,10,'literal ten account batches');
  assert.equal(first.orphan_removed,1000,'literal global orphan deletion cap');assert.equal(first.state.pending.length,10);
  const second=await sweep(db,first.state);
  assert.equal(second.accounts_checked,10);assert.equal(second.accounts_settled,5);
  assert.equal(await events(db,id(914)),2,'discovery capacity remains available while older pending accounts remain');
}
test('global orphan budget and reserved discovery capacity bound the pending backlog',async t=>accountBudget(await setup(t)));

test('fence-only and event-only orphans are independently discoverable',async t=>{
  const db=await setup(t),uid=await orphan(db,900,{events:0}),otherUid=await orphan(db,901,{fence:false,events:1});
  await db.exec(`delete from public.notification_feed_events_v2 where recipient_id='${uid}'`);
  const result=await sweep(db);assert.equal(result.accounts_settled,2);
  assert.equal(await fences(db,uid),0);assert.equal(await events(db,otherUid),0);
});

async function liveAccount(db,kind) {
  const uid=await orphan(db,900,{fence:false});
  await db.exec(`insert into ${kind==='auth'?'auth.users':'public.profiles'}(id) values('${uid}')`);
  await refused(()=>service(db,'notification_feed_retire_account_v2',`'${uid}',100`),'55000');
  assert.equal(await events(db,uid),1,'a surviving identity keeps even a fence-less recent event');
}
for(const kind of ['auth','profile']) test(`independent ${kind} presence refuses account retirement`,async t=>liveAccount(await setup(t),kind));

test('same-UUID account restore drops a pending hint without removing its remaining events/fence',async t=>{
  const db=await setup(t),uid=await orphan(db,900,{events:205});const first=await sweep(db);
  await db.exec(`insert into auth.users(id) values('${uid}')`);
  const next=await sweep(db,first.state);
  assert.deepEqual(next.state.pending,[]);assert.equal(next.orphan_removed,0);
  assert.equal(await fences(db,uid),1);assert.equal(await events(db,uid),106);
});

test('unknown fence failure rolls the whole RPC back and is not mistaken for a restored account',async t=>{
  const db=await setup(t),uid=await orphan(db,900);
  await db.exec(`create function public.fixture_refuse_fence_delete() returns trigger language plpgsql as $$begin
    raise exception 'fixture_fence_failure' using errcode='55000';end$$;
    create trigger zzz_fixture_refuse_fence_delete before delete on private.notification_feed_fences_v2
    for each row execute function public.fixture_refuse_fence_delete();`);
  await assert.rejects(()=>sweep(db),/fixture_fence_failure/);
  assert.equal(await events(db,uid),2);assert.equal(await fences(db,uid),1);
});

async function fenceWindow(db) {
  await db.exec(`insert into auth.users(id) select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1000,1104)n;
    insert into private.notification_feed_fences_v2(recipient_id) select id from auth.users where id>='${id(1000)}';
    delete from public.notification_feed_events_v2;`);
  const uid=await orphan(db,2000,{events:0});await db.exec(`delete from public.notification_feed_events_v2 where recipient_id='${uid}'`);
  const first=await sweep(db);
  assert.equal(first.scanned_fences,100,'raw fence window is capped BEFORE absence filtering');
  assert.equal(first.accounts_checked,0);assert.equal(first.state.after_fence,id(1099));assert.equal(await fences(db,uid),1);
  const second=await sweep(db,first.state);assert.equal(second.accounts_settled,1);assert.equal(second.state.after_fence,null);
  assert.equal(await fences(db,uid),0);
}
test('fence keyset advances through a live prefix and wraps without scanning past the raw window',async t=>fenceWindow(await setup(t)));

async function eventWindow(db) {
  await db.exec(`insert into public.notification_feed_events_v2(event_id,recipient_id,event_kind)
    select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${user}','invalidate' from generate_series(1000,1104)n;
    insert into public.notification_feed_events_v2(event_id,recipient_id,event_kind) values('${id(2000)}','${id(900)}','invalidate');`);
  const first=await sweep(db);assert.equal(first.scanned_events,100,'raw events, not DISTINCT recipients, consume the window');
  assert.equal(first.accounts_checked,0);assert.equal(first.state.after_event,id(1099));
  const second=await sweep(db,first.state);assert.equal(second.accounts_settled,1);assert.equal(second.state.after_event,null);
  await db.exec(`insert into public.notification_feed_events_v2(event_id,recipient_id,event_kind) values('${id(100)}','${id(901)}','invalidate')`);
  const third=await sweep(db,second.state);assert.equal(third.accounts_settled,1,'wrap discovers an insertion behind the prior cursor');
}
test('event keyset limits before dedupe/absence and catches an event-only orphan behind a wrapped cursor',async t=>eventWindow(await setup(t)));

test('new RPC is service-only and no Auth/profile trigger or table grants change',async t=>{
  let before;
  const catalog=db=>scalar(db,`select jsonb_build_object('triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t where tgrelid in ('auth.users'::regclass,'public.profiles'::regclass)),
    'acl',(select jsonb_agg(jsonb_build_array(oid,relacl) order by oid) from pg_class where oid in ('public.notifications'::regclass,'public.notification_feed_events_v2'::regclass,'private.notification_feed_fences_v2'::regclass))) as value`);
  const db=await setup(t,{prepare:async db=>{before=await catalog(db);}});
  assert.deepEqual(await catalog(db),before);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {await refused(()=>db.query('select public.notification_feed_maintenance_v2()'),'42501');} finally {await db.exec('reset role');}
  }
  assert.equal((await sweep(db)).v,1);
  assert.equal(await scalar(db,"select indisvalid as value from pg_index where indexrelid='public.notification_feed_events_v2_recipient_order'::regclass"),true);
});

const source=()=>readFile(lifecycleProposal,'utf8');
const replaceOnce=(text,from,to)=>{assert.equal(text.split(from).length-1,1,'one loaded lifecycle anchor');return text.replace(from,()=>to);};
function editFunction(sql,name,edit) {
  let start=sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if(start<0) start=sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const end=sql.indexOf('END $fn$;',start);assert.ok(start>0&&end>start);
  return sql.slice(0,start)+edit(sql.slice(start,end))+sql.slice(end);
}
async function mutant(t,edit,oracle) {
  const db=await setup(t,{sql:edit(await source())});
  await assert.rejects(()=>oracle(db),error=>error.code==='ERR_ASSERTION');
}
test('loaded 23h retention mutant removes a literal fresh event',async t=>mutant(t,
  sql=>editFunction(sql,'notification_feed_cleanup_v2',block=>replaceOnce(block,"cutoff timestamptz:=clock_timestamp()-interval '24 hours';","cutoff timestamptz:=clock_timestamp()-interval '23 hours';")),retention));
test('loaded eleven-account mutant exceeds the global orphan cap',async t=>mutant(t,
  sql=>replaceOnce(sql,'FROM ranked ORDER BY priority,position,carried DESC,recipient_id LIMIT 10','FROM ranked ORDER BY priority,position,carried DESC,recipient_id LIMIT 11'),accountBudget));
test('loaded per-account101 mutant exceeds the literal orphan budget',async t=>mutant(t,
  sql=>replaceOnce(sql,'notification_feed_retire_account_v2(recipient,100)','notification_feed_retire_account_v2(recipient,101)'),accountBudget));
for(const kind of ['auth','profile']) test(`loaded ${kind} absence omission deletes a live account's fence-less events`,async t=>mutant(t,sql=>{
  const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.notification_feed_retire_account_v2('),end=sql.indexOf('END $fn$;',start);
  const table=kind==='auth'?'auth.users':'public.profiles';
  return sql.slice(0,start)+replaceOnce(sql.slice(start,end),`EXISTS(SELECT 1 FROM ${table} WHERE id=p_recipient_id)`,'false')+sql.slice(end);
},db=>liveAccount(db,kind)));
test('loaded fence filter-before-limit mutant bypasses a bounded live prefix',async t=>mutant(t,
  sql=>replaceOnce(sql,'WHERE p_after_fence IS NULL OR recipient_id>p_after_fence ORDER BY recipient_id LIMIT 100',
    'WHERE (p_after_fence IS NULL OR recipient_id>p_after_fence) AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=recipient_id) ORDER BY recipient_id LIMIT 100'),fenceWindow));
test('loaded event filter-before-limit mutant skips an unbounded live history prefix',async t=>mutant(t,
  sql=>replaceOnce(sql,'WHERE p_after_event IS NULL OR event_id>p_after_event ORDER BY event_id LIMIT 100',
    'WHERE (p_after_event IS NULL OR event_id>p_after_event) AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=recipient_id) ORDER BY event_id LIMIT 100'),eventWindow));

for(const drift of ['function','acl']) test(`prestate ${drift} drift refuses the whole supplement`,async t=>{
  const db=await setup(t,{candidate:false});
  if(drift==='acl') await db.exec('grant execute on function public.notification_feed_cleanup_v2(integer) to anon');
  else await db.exec("create or replace function public.notification_feed_cleanup_v2(p_limit integer default 1000) returns integer language sql security definer set search_path='' as $$select 0$$");
  const sql=await source();await assert.rejects(()=>db.exec(sql),/notification_feed_lifecycle_prestate_drift/);
  await db.exec('rollback');
  assert.equal(await scalar(db,"select to_regprocedure('public.notification_feed_maintenance_v2(uuid,uuid,uuid[])') is null as value"),true);
});

for(const [name,edit] of [
  ['PUBLIC EXECUTE revoke',sql=>replaceOnce(sql,'FROM PUBLIC,anon,authenticated,service_role','FROM anon,authenticated,service_role')],
  ['service EXECUTE grant',sql=>replaceOnce(sql,"EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);",'NULL;')],
  ['definer',sql=>editFunction(sql,'notification_feed_maintenance_v2',block=>replaceOnce(block,'SECURITY DEFINER','SECURITY INVOKER'))],
  ['searchpath',sql=>editFunction(sql,'notification_feed_maintenance_v2',block=>replaceOnce(block,"SET search_path=''","SET search_path='public'"))],
  ['index order',sql=>replaceOnce(sql,'ON public.notification_feed_events_v2(recipient_id,created_at,event_id)','ON public.notification_feed_events_v2(created_at,recipient_id,event_id)')],
  ['final absence guard',sql=>replaceOnce(sql,'DO $security$','ALTER TABLE private.notification_feed_fences_v2 DISABLE TRIGGER notification_feed_fence_immutable;\nDO $security$')],
]) test(`raising poststate catches ${name} omission and rolls back the supplement`,async t=>{
  const db=await setup(t,{candidate:false}),sql=edit(await source());
  await assert.rejects(()=>db.exec(sql),/notification_feed_lifecycle_security_failed/);await db.exec('rollback');
  assert.equal(await scalar(db,"select to_regprocedure('public.notification_feed_maintenance_v2(uuid,uuid,uuid[])') is null as value"),true);
  assert.equal(await scalar(db,"select to_regclass('public.notification_feed_events_v2_recipient_order') is null as value"),true);
});
