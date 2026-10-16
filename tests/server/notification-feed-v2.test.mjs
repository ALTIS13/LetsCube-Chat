import assert from 'node:assert/strict';
import test from 'node:test';
import {feedFixture,asUser,rpc,put,id,user,other,session,proposal,quote} from './notification-feed-v2.fixture.mjs';
import {setPreference,topic,chat,message,sender} from './topic-notification-overrides.fixture.mjs';
import {readFile} from 'node:fs/promises';
import {mergeNotificationRows} from '../../artifacts/kub/src/lib/notificationRows.ts';
import {sendFixtureMessage} from './topic-notification-delivery.fixture.mjs';
import vm from 'node:vm';
import ts from 'typescript';

const count=async(db,table)=>(await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;
const signals=async db=>(await db.query('select recipient_id,notification_id,event_kind from public.notification_feed_events_v2 order by created_at,event_id')).rows;
const clear=async db=>db.exec('delete from public.notification_feed_events_v2;');
async function setup(t,options) {const db=await feedFixture(options);t.after(()=>db.close());return db;}
const refused=(action,code='22023')=>assert.rejects(action,error=>error.code===code);

async function actualFeed(db,reads={}) {
  const text=await readFile(new URL('../../artifacts/kub/src/lib/notificationFeedV2.ts',import.meta.url),'utf8');
  const module={exports:{}};
  const compiled=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  vm.runInNewContext(compiled.outputText,{module,exports:module.exports,Date,Promise,Set,Map,Object,JSON});
  let receive,status;const work=[],frames=[],alerts=[],errors=[];
  const track=p=>{work.push(Promise.resolve(p).catch(()=>{}));return p;};
  const feed=module.exports.createNotificationFeedV2({userId:user,sessionId:session,accountEpoch:1},{
    isCurrent:()=>true,subscribe:(r,s)=>{receive=r;status=s;return()=>{};},
    open:args=>track(rpc(db,'open',`${args.p_limit},ARRAY[${args.p_held_ids.map(quote).join(',')}]::uuid[]`)),
    page:()=>track(reads.page?.()??rpc(db,'page')),
    lookup:args=>track(reads.lookup?.(args)??rpc(db,'lookup',`ARRAY[${args.p_ids.map(quote).join(',')}]::uuid[]`)),
    onRows:rows=>frames.push(rows),onCreated:(row,isCurrent)=>alerts.push({row,isCurrent}),onResync:reason=>errors.push(reason),
  });
  async function settle() {for(let i=0;i<16;i++){await Promise.all(work.splice(0));await Promise.resolve();}}
  async function deliver() {
    // Inspect insertion order inside this isolated append-only fixture, not a
    // commit cursor or a substitute for actual Realtime ordering acceptance.
    const events=await asUser(db,'select to_jsonb(e) as event from public.notification_feed_events_v2 e order by e.ctid');
    for(const {event} of events) receive(event);
    await settle();await clear(db);
  }
  status('SUBSCRIBED');await settle();await deliver();
  assert.deepEqual(errors,[],'actual SQL open must complete before producer assertions');
  assert.equal(frames.length,1,'the actual owned handshake must publish its snapshot');
  return {feed,frames,alerts,errors,settle,deliver};
}

async function ordinaryProducer(db) {
  const f=await actualFeed(db);
  try {
    const mid=await sendFixtureMessage(db,600);await f.deliver();
    const produced=(await db.query(`select id from public.notifications where user_id='${user}' and payload->>'message_id'='${mid}'`)).rows;
    assert.equal(produced.length,1,'actual message producer must create exactly one own notification');
    assert.deepEqual(f.errors,[]);
    assert.equal(f.alerts.length,1,'ordinary producer created admission must survive its source hooks');
    assert.equal(f.alerts[0].row.id,produced[0].id);assert.equal(f.alerts[0].isCurrent(),true);
  } finally {f.feed.dispose();}
}
test('ordinary producer -> actual sidecar -> actual helper admits the exact live message',async t=>ordinaryProducer(await setup(t)));

async function revisionRows(db) {
  await put(db,100,{payload:{value:'A'}});await put(db,101);
  const first=(await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0];
  assert.equal(first.feed_revision,1,'literal server-owned initial revision');
  await db.exec(`update public.notifications set payload=payload where id='${id(100)}'`);
  assert.equal((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0].feed_revision,1,'no-op keeps revision');
  await db.exec(`update public.notifications set payload='{"value":"B"}' where id='${id(100)}'`);
  const middle=(await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0];
  assert.equal(middle.feed_revision,2,'meaningful row change increments once');
  await db.exec(`update public.notifications set payload='{"value":"A"}' where id='${id(100)}'`);
  const last=(await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0];
  assert.equal(last.feed_revision,3,'ABA must not reuse old row identity');
  assert.deepEqual(last.payload,first.payload);
  assert.equal((await rpc(db,'lookup',`ARRAY['${id(101)}']::uuid[]`)).rows[0].feed_revision,1,'independent row is not a shared cursor');
  return {first,middle,last};
}
test('revision is per-notification, ignores no-op and distinguishes actual payload ABA',async t=>revisionRows(await setup(t)));

test('revision migration defaults old stored rows to 1 without rewriting their payload or read state',async t=>{
  let original;
  const sql=replaceOnce(await source(),'SET LOCAL ROLE postgres;',`SET LOCAL ROLE postgres;
    create function public.fixture_no_history_update() returns trigger language plpgsql as $$begin raise exception 'history_rewritten';end$$;
    create trigger fixture_no_history_update after update on public.notifications for each row execute function public.fixture_no_history_update();`);
  const db=await setup(t,{sql,prepare:async db=>{
    await put(db,100,{payload:{retained:'literal'}});
    await db.exec(`update public.notifications set read_at='2026-01-02' where id='${id(100)}'`);
    original=(await db.query(`select to_jsonb(n) as row from public.notifications n where id='${id(100)}'`)).rows[0].row;
  }});
  const stored=(await db.query(`select to_jsonb(n) as row from public.notifications n where id='${id(100)}'`)).rows[0].row;
  assert.equal(stored.feed_revision,1,'old stored rows receive literal default 1');
  delete stored.feed_revision;assert.deepEqual(stored,original,'no historical payload/read rewrite');
});

test('revision refuses direct insert/update forgery and rolls back before any sidecar effect',async t=>{
  const db=await setup(t);await put(db,100);
  assert.equal((await rpc(db,'page')).rows[0].feed_revision,1,'revision feature must actually be present');
  await clear(db);
  for(const value of ['null','0','2','9007199254740992']) {
    await refused(()=>db.exec(`insert into public.notifications(id,user_id,kind,feed_revision) values('${id(101)}','${user}','task_assigned',${value})`),'42501');
    await refused(()=>db.exec(`update public.notifications set payload='{"forged":true}',feed_revision=${value} where id='${id(100)}'`),'42501');
  }
  assert.deepEqual(await signals(db),[]);
  assert.deepEqual((await rpc(db,'page')).rows[0].payload,{});
});

async function revisionLimit(db) {
  await put(db,100);
  await db.exec(`alter table public.notifications disable trigger zz_notification_feed_revision_v2;
    update public.notifications set feed_revision=9007199254740990 where id='${id(100)}';
    alter table public.notifications enable trigger zz_notification_feed_revision_v2;
    update public.notifications set payload='{"last":true}' where id='${id(100)}'`);
  const last=(await rpc(db,'page')).rows[0];
  assert.equal(last.feed_revision,9007199254740991);assert.equal(Number.isSafeInteger(last.feed_revision),true);
  await clear(db);
  await refused(()=>db.exec(`update public.notifications set payload='{"overflow":true}' where id='${id(100)}'`),'22003');
  await db.exec(`update public.notifications set payload=payload where id='${id(100)}'`);
  assert.deepEqual(await signals(db),[]);
  assert.deepEqual((await rpc(db,'page')).rows[0],last,'exhaustion/no-op cannot change data or revision');
}
test('revision accepts the exact safe bigint maximum then refuses meaningful overflow atomically',async t=>revisionLimit(await setup(t)));

async function meaningfulFields(db) {
  await put(db,100);let target=id(100),expected=1;
  for(const assignment of ["payload='{}'::jsonb", "payload='{}'::jsonb||jsonb_build_object('value',1)",
    "alert_suppressed_at='2026-01-04'", "kind='chat_added'", "read_at='2026-01-02'", "created_at='2026-01-03'",
    `user_id='${other}'`, `id='${id(102)}'`]) {
    if(assignment.startsWith('id=')) await db.exec(`delete from public.notifications_push_outbox where notification_id='${target}';
      delete from public.notifications_native_push_outbox where notification_id='${target}'`);
    await db.exec(`update public.notifications set ${assignment} where id='${target}'`);
    if(assignment.startsWith('id=')) target=id(102);
    if(assignment!=="payload='{}'::jsonb") expected++;
    assert.equal((await db.query(`select feed_revision::text as revision from public.notifications where id='${target}'`)).rows[0].revision,
      String(expected),'each meaningful public field changes its own row revision exactly once');
  }
}
test('revision observes each of the seven public fields and keeps a literal JSON no-op unchanged',async t=>meaningfulFields(await setup(t)));

async function revisionFrames(db,newer,aba) {
  let frame;
  const f=await actualFeed(db,{page:()=>frame?.page,lookup:()=>frame?.lookup});
  try {
    const mid=await sendFixtureMessage(db,600);await f.deliver();
    assert.equal(f.alerts.length,1);const admission=f.alerts[0],nid=admission.row.id;
    const oldPage=await rpc(db,'page'),oldLookup=await rpc(db,'lookup',`ARRAY['${nid}']::uuid[]`);
    await db.exec(`update public.notifications set payload=jsonb_set(payload,'{fixture}','"changed"') where id='${nid}'`);
    if(aba) await db.exec(`update public.notifications set payload=payload-'fixture' where id='${nid}'`);
    const newPage=await rpc(db,'page'),newLookup=await rpc(db,'lookup',`ARRAY['${nid}']::uuid[]`);
    frame={page:newer==='page'?newPage:oldPage,lookup:newer==='lookup'?newLookup:oldLookup};
    assert.equal(admission.isCurrent(),true,'do not fake an exact stream event in this split-snapshot case');
    f.feed.refresh();await f.settle();
    assert.deepEqual(f.errors,[]);assert.equal(f.alerts.length,1,'fresh reads never replay created admission');
    assert.equal(admission.isCurrent(),false,'observed newer server revision must retire the old payload permit');
    assert.equal(f.feed.rows()[0].feed_revision,aba?3:2,'both read orders select actual newer row revision');
    assert.equal(f.feed.rows()[0].payload.message_id,mid);
  } finally {f.feed.dispose();}
}
for(const newer of ['page','lookup']) for(const aba of [false,true])
  test(`actual SQL ${aba?'ABA':'payload edit'} ${newer}=new/other=old frames retire the held exact permit`,async t=>revisionFrames(await setup(t),newer,aba));

async function legacyClosed(db) {
  await put(db,100);await asUser(db,setPreference('enabled'));
  assert.equal((await asUser(db,'select id from public.notifications')).length,0,'literal activated legacy refusal');
}

test('successful disabled CAS closes the real combined legacy SELECT without deleting feed rows',async t=>{
  const db=await feedFixture();t.after(()=>db.close());
  await put(db,100);await put(db,101,{who:other});
  assert.equal((await asUser(db,'select id from public.notifications')).length,1);
  await asUser(db,setPreference('disabled'));
  assert.equal((await asUser(db,'select id from public.notifications')).length,0,'activated account must lose the legacy route');
  assert.equal((await db.query('select count(*)::int as n from public.notifications')).rows[0].n,2);
});

test('actual SQL supplies bounded own-feed page rather than the legacy table route',async t=>{
  const db=await feedFixture();t.after(()=>db.close());
  assert.equal((await db.query("select to_regprocedure('public.notification_feed_page_v2(integer,timestamptz,uuid)') is not null as present")).rows[0].present,
    true,'versioned feed SQL is missing');
  await put(db,100);assert.equal((await rpc(db,'page')).rows[0].id,id(100));
});

test('versioned feed preserves actual owner AND source policy, payload and read identity after activation',async t=>{
  const db=await setup(t);
  await put(db,100,{payload:{literal:'fictional'},at:'2026-01-01T00:00:00Z'});
  await put(db,101,{kind:'message',payload:{message_id:message,chat_id:chat}});
  await put(db,102,{kind:'message',payload:{message_id:'invalid',chat_id:chat}});
  await put(db,103,{who:other});
  const before=await asUser(db,`select id,user_id,kind,payload,read_at,created_at::text from public.notifications order by created_at desc,id desc`);
  assert.deepEqual(before.map(n=>n.id),[id(101),id(100)],'real existing policy must reject malformed and foreign notes');
  await asUser(db,setPreference('disabled'));
  const page=await rpc(db,'page');
  assert.deepEqual(page.rows.map(n=>n.id),[id(101),id(100)]);
  assert.deepEqual(page.rows[1].payload,{literal:'fictional'});
  assert.deepEqual(Object.keys(page.rows[0]).sort(),['alert_suppressed_at','created_at','feed_revision','id','kind','payload','read_at','user_id']);
  await asUser(db,`select public.notifications_mark_read('${id(100)}')`);
  assert.notEqual((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0].read_at,null);
  await db.exec(`insert into public.message_hidden_for_users values('${message}','${user}')`);
  assert.deepEqual((await rpc(db,'page')).rows.map(n=>n.id),[id(100)],'source visibility remains authoritative after activation');
});

test('first inherit, conflicts and rejected CAS do not activate; inherit and runtime rollback cannot remove activation',async t=>{
  const db=await setup(t);await put(db,100);
  await asUser(db,setPreference('inherit'));
  assert.equal(await count(db,'private.notification_feed_fences_v2'),0);
  assert.equal((await asUser(db,setPreference('disabled',0)))[0].value.status,'conflict');
  assert.equal(await count(db,'private.notification_feed_fences_v2'),0);
  await refused(()=>asUser(db,setPreference('unknown',1)));
  assert.equal(await count(db,'private.notification_feed_fences_v2'),0);
  await asUser(db,setPreference('enabled',1));
  assert.equal(await count(db,'private.notification_feed_fences_v2'),1);
  await asUser(db,setPreference('inherit',2));
  await db.exec('update private.topic_notification_runtime set enabled=false;');
  assert.equal((await asUser(db,'select id from public.notifications')).length,0);
  assert.deepEqual((await rpc(db,'page')).rows.map(n=>n.id),[id(100)]);
  assert.equal((await asUser(db,'select id from public.notifications',other,id(31))).length,0);
  await put(db,101,{who:other});
  assert.equal((await asUser(db,'select id from public.notifications',other,id(31))).length,1,'inactive other account keeps old route');
  await db.exec('set role service_role;');
  assert.equal((await db.query('select count(*)::int as n from public.notifications')).rows[0].n,2);
  await db.exec('reset role;');
});

test('activation signal failure rolls CAS/fence back as one transaction',async t=>{
  const db=await setup(t);
  await db.exec(`create function public.fixture_refuse_signal() returns trigger language plpgsql as $$begin
    raise exception 'fixture_signal_refused';end$$;
    create trigger fixture_refuse_signal before insert on public.notification_feed_events_v2
    for each row execute function public.fixture_refuse_signal();`);
  await assert.rejects(()=>asUser(db,setPreference('disabled')),/fixture_signal_refused/);
  assert.equal(await count(db,'public.topic_notification_preferences'),0);
  assert.equal(await count(db,'private.notification_feed_fences_v2'),0);
  assert.equal(await count(db,'public.notification_feed_events_v2'),0);
  await db.exec('drop trigger fixture_refuse_signal on public.notification_feed_events_v2;');
  await asUser(db,setPreference('disabled'));
  assert.equal(await count(db,'private.notification_feed_fences_v2'),1);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:null,event_kind:'invalidate'}]);
});

test('created_at/id descending display pages are bounded, tie-stable and not a commit cursor',async t=>{
  const db=await setup(t);
  await db.exec(`insert into public.notifications(id,user_id,kind,payload,created_at)
    select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${user}','task_assigned','{}','2026-01-01'
    from generate_series(100,131) n;`);
  const page=await rpc(db,'page');assert.equal(page.v,2);assert.equal(page.rows.length,30);
  assert.equal(page.rows[0].id,id(131));assert.equal(page.rows.at(-1).id,id(102));assert.equal(page.next.id,id(102));
  const rest=await rpc(db,'page',`30,${quote(page.next.created_at)},'${page.next.id}'`);
  assert.deepEqual(rest.rows.map(n=>n.id),[id(101),id(100)]);assert.equal(rest.next,null);
  await put(db,99,{at:'2025-12-31T00:00:00Z'});
  assert.ok((await rpc(db,'page',`30,${quote(page.next.created_at)},'${page.next.id}'`)).rows.some(n=>n.id===id(99)),
    'late insertion with an older display date is still queryable, never treated as a commit watermark');
});

test('page/lookup/open reject bounds, half cursors, null IDs and oversized duplicates before dedupe',async t=>{
  const db=await setup(t);
  for(const args of ['0','31','NULL',`1,NULL,'${id(100)}'`,`1,now(),NULL`,`1,'infinity','${id(100)}'`])
    await refused(()=>rpc(db,'page',args));
  for(const args of ['NULL',"'{}'::uuid[]",`ARRAY[NULL]::uuid[]`,`array_fill('${id(100)}'::uuid,ARRAY[101])`,
    `ARRAY[['${id(100)}'::uuid],['${id(101)}'::uuid]]`]) await refused(()=>rpc(db,'lookup',args));
  for(const args of ['0',`30,NULL`,`30,array_fill('${id(100)}'::uuid,ARRAY[101])`,`30,ARRAY[NULL]::uuid[]`])
    await refused(()=>rpc(db,'open',args));
  assert.equal(await count(db,'public.notification_feed_events_v2'),0,'invalid open must roll its marker back');
  const value=await rpc(db,'lookup',`array_fill('${id(100)}'::uuid,ARRAY[100])`);
  assert.deepEqual(value,{v:2,rows:[],unavailable_ids:[id(100)]});
});

async function lookupHidden(db) {
  await put(db,100);await put(db,101,{who:other});
  await put(db,102,{kind:'message',payload:{message_id:'invalid'}});
  const result=await rpc(db,'lookup',`ARRAY['${id(100)}','${id(101)}','${id(102)}','${id(103)}','${id(100)}']::uuid[]`);
  assert.deepEqual(result.rows.map(n=>n.id),[id(100)],'literal owner/source lookup result');
  assert.deepEqual(result.unavailable_ids,[id(101),id(102),id(103)],'foreign/missing/invisible must be indistinguishable');
}
test('lookup resolves held IDs outside page and makes unavailable identities indistinguishable',async t=>lookupHidden(await setup(t)));

test('open atomically creates an own random invalidate marker and never activates legacy fencing',async t=>{
  const db=await setup(t);await put(db,100);await clear(db);
  const open=await rpc(db,'open',`30,ARRAY['${id(100)}','${id(101)}']::uuid[]`);
  assert.equal(open.v,2);assert.match(open.barrier_event_id,/^[0-9a-f-]{36}$/);
  assert.deepEqual(open.page.rows.map(n=>n.id),[id(100)]);
  assert.deepEqual(open.lookup.unavailable_ids,[id(101)]);
  const events=(await db.query('select event_id,recipient_id,notification_id,event_kind from public.notification_feed_events_v2')).rows;
  assert.deepEqual(events,[{event_id:open.barrier_event_id,recipient_id:user,notification_id:null,event_kind:'invalidate'}]);
  assert.notEqual((await rpc(db,'open')).barrier_event_id,open.barrier_event_id);
  assert.equal(await count(db,'private.notification_feed_fences_v2'),0);
});

for(const state of ['retired','expired-session','future-session','banned','expired-jwt','anonymous','wrong-role','wrong-owner','missing-session']) {
  test(`page/lookup/open/event SELECT refuse ${state} using actual session/ban authority`,async t=>{
    const db=await setup(t);await put(db,100);
    let sid=session,patch={};
    if(state==='retired') await db.exec(`delete from auth.sessions where id='${session}'`);
    if(state==='expired-session') await db.exec(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${session}'`);
    if(state==='future-session') await db.exec(`update auth.sessions set created_at=clock_timestamp()+interval '1 hour' where id='${session}'`);
    if(state==='banned') await db.exec(`insert into public.bans values('${user}',null)`);
    if(state==='expired-jwt') patch.exp=1;
    if(state==='anonymous') patch.is_anonymous=true;
    if(state==='wrong-role') patch.role='service_role';
    if(state==='wrong-owner') sid=id(31);
    if(state==='missing-session') patch.session_id=null;
    for(const [name,args] of [['page',''],['lookup',`ARRAY['${id(100)}']::uuid[]`],['open','']])
      await refused(()=>rpc(db,name,args,user,sid,patch),'42501');
    await refused(()=>asUser(db,'select * from public.notification_feed_events_v2',user,sid,patch),'42501');
  });
}

test('statement emitters distinguish created/changed/removed, coalesce real mark-all and ignore no-op',async t=>{
  const db=await setup(t);await put(db,100);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:id(100),event_kind:'created'}]);
  await clear(db);await db.exec(`update public.notifications set payload='{"scrubbed":true}' where id='${id(100)}'`);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:id(100),event_kind:'changed'}]);
  await clear(db);await db.exec(`update public.notifications set payload=payload`);assert.deepEqual(await signals(db),[]);
  await put(db,101);await put(db,102);await clear(db);
  await asUser(db,'select public.notifications_mark_all_read()');
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:null,event_kind:'invalidate'}]);
  await clear(db);await asUser(db,'select public.notifications_mark_all_read()');assert.deepEqual(await signals(db),[]);
  await db.exec(`delete from public.notifications where id in ('${id(100)}','${id(101)}')`);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:null,event_kind:'invalidate'}]);
  await clear(db);await db.exec(`delete from public.notifications where id='${id(102)}'`);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:id(102),event_kind:'removed'}]);
});

test('identity reassignment removes old ownership and invalidates new owner, never creates admission',async t=>{
  const db=await setup(t);await put(db,100);await clear(db);
  await db.exec(`update public.notifications set user_id='${other}' where id='${id(100)}'`);
  const result=await signals(db);
  assert.deepEqual(result.find(n=>n.recipient_id===user),{recipient_id:user,notification_id:id(100),event_kind:'removed'});
  assert.deepEqual(result.find(n=>n.recipient_id===other),{recipient_id:other,notification_id:null,event_kind:'invalidate'});
  assert.equal(result.length,2);assert.equal(result.some(n=>n.event_kind==='created'),false);
  assert.equal((await asUser(db,'select * from public.notification_feed_events_v2')).length,1);
});

test('sidecar has independent random-only PK/default identity, no FK and exact publication; clients cannot mutate',async t=>{
  const db=await setup(t);await put(db,100);
  const schema=(await db.query(`select c.relreplident,(select count(*)::int from pg_constraint where conrelid=c.oid and contype='f') as fks,
    (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns
    from pg_class c where c.oid='public.notification_feed_events_v2'::regclass`)).rows[0];
  assert.deepEqual(schema,{relreplident:'d',fks:0,columns:['event_id','recipient_id','notification_id','event_kind','created_at']});
  assert.equal((await db.query(`select count(*)::int as n from pg_publication_rel r join pg_publication p on p.oid=r.prpubid
    where p.pubname='supabase_realtime' and r.prrelid='public.notification_feed_events_v2'::regclass and r.prqual is null and r.prattrs is null`)).rows[0].n,1);
  for(const sql of [`insert into public.notification_feed_events_v2(recipient_id,event_kind) values('${user}','invalidate')`,
    'update public.notification_feed_events_v2 set event_kind=event_kind','delete from public.notification_feed_events_v2',
    'truncate public.notification_feed_events_v2','select * from private.notification_feed_fences_v2',
    'select public.notification_feed_cleanup_v2()']) await refused(()=>asUser(db,sql),'42501');
  await asUser(db,setPreference('enabled'));
  await refused(()=>db.exec('delete from private.notification_feed_fences_v2'),'42501');
  await refused(()=>db.exec('update public.notification_feed_events_v2 set created_at=clock_timestamp()'),'42501');
});

test('cleanup is service-only, older-than-24h, at most 1000 and never removes original feed',async t=>{
  const db=await setup(t);await put(db,100);await clear(db);
  await db.exec(`insert into public.notification_feed_events_v2(recipient_id,event_kind,created_at)
    select '${user}','invalidate',clock_timestamp()-interval '25 hours' from generate_series(1,1100);
    insert into public.notification_feed_events_v2(recipient_id,event_kind,created_at)
    values('${other}','invalidate',clock_timestamp()-interval '23 hours 30 minutes'); set role service_role;`);
  await refused(()=>db.query('select public.notification_feed_cleanup_v2(1001)'));
  assert.equal((await db.query('select public.notification_feed_cleanup_v2() as n')).rows[0].n,1000);
  await db.exec('reset role;');
  assert.equal(await count(db,'public.notification_feed_events_v2'),101);assert.equal(await count(db,'public.notifications'),1);
});

test('terminal marker is explicit NULL/timestamp on page, lookup and open and cannot be cleared',async t=>{
  const db=await setup(t);await put(db,100);
  const stale=(await rpc(db,'page')).rows;
  assert.equal(stale[0].alert_suppressed_at,null,'literal NULL marker must be present');
  assert.equal((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0].alert_suppressed_at,null,'literal lookup NULL marker');
  await db.exec(`update public.notifications set alert_suppressed_at='2026-01-02T00:00:00Z' where id='${id(100)}';`);
  const check=row=>{assert.equal(typeof row.alert_suppressed_at,'string');
    assert.equal(new Date(row.alert_suppressed_at).toISOString(),'2026-01-02T00:00:00.000Z');};
  check((await rpc(db,'page')).rows[0]);
  check((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0]);
  const opened=await rpc(db,'open',`30,ARRAY['${id(100)}']::uuid[]`);
  check(opened.page.rows[0]);check(opened.lookup.rows[0]);
  const merged=mergeNotificationRows(opened.lookup.rows,stale,30);
  check(merged[0]);assert.equal(merged[0].read_at,null,'accepted client merge preserves terminal marker without fabricating a read');
  await refused(()=>db.exec('update public.notifications set alert_suppressed_at=NULL'),'42501');
  check((await rpc(db,'page')).rows[0]);
});

test('account privacy cleanup is explicit, service-only and bounded; a live account never loses its fence',async t=>{
  const db=await setup(t);await asUser(db,setPreference('enabled'));await clear(db);
  await db.exec(`insert into public.notification_feed_events_v2(recipient_id,event_kind)
    select '${user}','invalidate' from generate_series(1,1001);
    insert into public.notification_feed_events_v2(recipient_id,event_kind) values('${other}','invalidate');`);
  const call=`select public.notification_feed_retire_account_v2('${user}') as value`;
  await refused(()=>asUser(db,call),'42501');
  await db.exec('set role service_role;');await refused(()=>db.query(call),'55000');await db.exec('reset role;');
  await db.exec(`delete from auth.users where id='${user}';set role service_role;`);
  await refused(()=>db.query(call),'55000');await db.exec('reset role;');
  await db.exec(`insert into auth.users values('${user}');delete from public.profiles where id='${user}';set role service_role;`);
  await refused(()=>db.query(call),'55000');await db.exec('reset role;');
  // Actual ordinary account deletion is outside this source fixture. Only its
  // authoritative absence is supplied here; no FK/cascade is claimed.
  await db.exec(`delete from auth.users where id='${user}';set role service_role;`);
  assert.deepEqual((await db.query(call)).rows[0].value,{removed:1000,remaining:true});await db.exec('reset role;');
  assert.equal(await count(db,'private.notification_feed_fences_v2'),1);
  await db.exec('set role service_role;');
  assert.deepEqual((await db.query(call)).rows[0].value,{removed:2,remaining:false});await db.exec('reset role;');
  assert.equal(await count(db,'private.notification_feed_fences_v2'),0);
  assert.deepEqual(await signals(db),[{recipient_id:other,notification_id:null,event_kind:'invalidate'}]);
});

test('own changed invalidation remains readable after the underlying source becomes invisible',async t=>{
  const db=await setup(t);await put(db,100,{kind:'message',payload:{message_id:message,chat_id:chat}});await clear(db);
  await db.exec(`update public.notifications set payload='{"message_id":"invalid","preview":"scrubbed"}' where id='${id(100)}'`);
  assert.deepEqual((await asUser(db,'select recipient_id,notification_id,event_kind from public.notification_feed_events_v2')),
    [{recipient_id:user,notification_id:id(100),event_kind:'changed'}]);
  assert.deepEqual((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)),{v:2,rows:[],unavailable_ids:[id(100)]});
});

test('failed runtime admission never activates and existing read RPC definitions are unchanged',async t=>{
  const db=await setup(t);await db.exec('update private.topic_notification_runtime set enabled=false');
  await refused(()=>asUser(db,setPreference('enabled')),'55000');
  assert.equal(await count(db,'private.notification_feed_fences_v2'),0);
  assert.equal(await count(db,'public.notification_feed_events_v2'),0);
  for(const [signature,expected] of [['public.notifications_mark_all_read()','cbf5a03bd43fd7f886412d877b0763a4ca21cd911a0b266311cdd60fc2620977'],
    ['public.notifications_mark_read(uuid)','64a82b868036e6dc1515a4f0a8b4d76a581c98dda02669a50ce1fddb50c71cd9']]) {
    assert.equal((await db.query(`select encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex') as hash`)).rows[0].hash,expected);
  }
});

for(const [name,prepare,error] of [
  ['column',db=>db.exec('alter table public.notifications add column unexpected text'),'prestate'],
  ['policy',db=>db.exec('drop policy "message notification source remains readable" on public.notifications'),'prestate'],
  ['RLS',db=>db.exec('alter table public.notifications disable row level security'),'prestate'],
  ['ACL',db=>db.exec('grant truncate on public.notifications to authenticated'),'acl'],
  ['setter source',db=>db.exec("alter function public.topic_notification_preference_set(uuid,uuid,text,bigint) set statement_timeout='1s'"),'function'],
]) test(`prestate ${name} drift refuses the whole draft before new objects`,async()=>{
  await assert.rejects(()=>feedFixture({prepare}),new RegExp(`notification_feed_v2_${error}_drift`));
});

const source=()=>readFile(proposal,'utf8');
function replaceOnce(sql,from,to) {assert.equal(sql.split(from).length-1,1,'one actual loaded SQL anchor');return sql.replace(from,()=>to);}
for(const [name,from,to,oracle] of [
  ['activation',"IF p_mode IN ('enabled','disabled') THEN",'IF false THEN',legacyClosed],
  ['first-inherit',"IF p_mode IN ('enabled','disabled') THEN",'IF true THEN',async db=>{
    await asUser(db,setPreference('inherit'));assert.equal(await count(db,'private.notification_feed_fences_v2'),0,'literal first-inherit must not activate');}],
  ['owner',"SELECT n.user_id=u AND (n.kind<>'message' OR CASE","SELECT true AND (n.kind<>'message' OR CASE",lookupHidden],
  ['source visibility',"SELECT n.user_id=u AND (n.kind<>'message' OR CASE","SELECT n.user_id=u AND (true OR CASE",lookupHidden],
  ['unknown UPDATE admission',"UNION ALL SELECT new_user,new_id,'changed' FROM changed","UNION ALL SELECT new_user,new_id,'created' FROM changed",async db=>{
    await put(db,100);await clear(db);await db.exec(`update public.notifications set payload='{"changed":true}'`);
    assert.equal((await signals(db))[0].event_kind,'changed','literal UPDATE must not become created');}],
  ['no-op'," WHERE to_jsonb(o) IS DISTINCT FROM to_jsonb(n)",'',async db=>{
    await put(db,100);await clear(db);await db.exec('update public.notifications set payload=payload');
    assert.equal((await signals(db)).length,0,'literal no-op must emit nothing');}],
  ['open marker',"INSERT INTO public.notification_feed_events_v2(recipient_id,event_kind) VALUES(u,'invalidate') RETURNING event_id INTO marker;",'marker:=gen_random_uuid();',async db=>{
    const result=await rpc(db,'open');assert.equal((await db.query(`select count(*)::int as n from public.notification_feed_events_v2 where event_id='${result.barrier_event_id}'`)).rows[0].n,1,'literal open marker must be persisted');}],
  ['lookup input bound','cardinality(p_ids) NOT BETWEEN 1 AND 100','cardinality(p_ids) NOT BETWEEN 1 AND 101',async db=>{
    await refused(()=>rpc(db,'lookup',`array_fill('${id(100)}'::uuid,ARRAY[101])`));}],
  ['retention','clock_timestamp()-interval \'24 hours\'','clock_timestamp()-interval \'23 hours\'',async db=>{
    await db.exec(`insert into public.notification_feed_events_v2(recipient_id,event_kind,created_at) values('${user}','invalidate',clock_timestamp()-interval '23 hours 30 minutes');set role service_role;`);
    const result=(await db.query('select public.notification_feed_cleanup_v2() as n')).rows[0].n;await db.exec('reset role;');
    assert.equal(result,0,'literal 24-hour retention');}],
]) test(`loaded SQL omission breaks literal ${name} behavior`,async t=>{
  const db=await setup(t,{sql:replaceOnce(await source(),from,to)});
  await assert.rejects(()=>oracle(db),error=>error.code==='ERR_ASSERTION');
});

for(const [name,from,to] of [
  ['restrictive legacy policy','ON public.notifications AS RESTRICTIVE','ON public.notifications AS PERMISSIVE'],
  ['event PUBLIC revoke','REVOKE ALL ON public.notification_feed_events_v2 FROM PUBLIC,anon,authenticated,service_role;',
    'REVOKE ALL ON public.notification_feed_events_v2 FROM PUBLIC,anon,service_role;'],
  ['event replica identity','DO $security$','ALTER TABLE public.notification_feed_events_v2 REPLICA IDENTITY FULL;\nDO $security$'],
  ['event random ID','event_id uuid PRIMARY KEY DEFAULT gen_random_uuid()',"event_id uuid PRIMARY KEY DEFAULT '70000000-0000-4000-8000-000000000099'::uuid"],
  ['emitter trigger enabled','DO $security$','ALTER TABLE public.notifications DISABLE TRIGGER notification_feed_update_v2;\nDO $security$'],
  ['function PUBLIC revoke','REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',
    'REVOKE ALL ON FUNCTION %s FROM anon,authenticated,service_role'],
]) test(`raising selfcheck catches actual ${name} omission`,async()=>{
  const sql=replaceOnce(await source(),from,to);
  await assert.rejects(()=>feedFixture({sql}),/notification_feed_v2_security_failed/);
});

test('loaded page identity omission cannot authorize a retired session',async t=>{
  let sql=await source();
  const start=sql.indexOf('CREATE FUNCTION public.notification_feed_page_v2('),end=sql.indexOf('END $fn$;',start);
  const block=sql.slice(start,end);assert.equal(block.split('private.topic_alert_client_identity()').length-1,2);
  sql=sql.slice(0,start)+block.replaceAll('private.topic_alert_client_identity()','auth.uid()')+sql.slice(end);
  const db=await setup(t,{sql});await put(db,100);await db.exec(`delete from auth.sessions where id='${session}'`);
  await assert.rejects(()=>refused(()=>rpc(db,'page'),'42501'),error=>error.code==='ERR_ASSERTION');
});

for(const name of ['page','lookup']) test(`loaded ${name} eight-field marker omission fails explicit NULL contract`,async t=>{
  let sql=await source();
  const start=sql.indexOf(`CREATE FUNCTION public.notification_feed_${name}_v2(`);
  const end=sql.indexOf('END $fn$;',start);
  assert.ok(start>0&&end>start);
  const block=replaceOnce(sql.slice(start,end),',n.alert_suppressed_at,n.feed_revision FROM public.notifications n',',n.feed_revision FROM public.notifications n');
  sql=sql.slice(0,start)+block+sql.slice(end);
  const db=await setup(t,{sql});await put(db,100);
  const result=await rpc(db,name,name==='lookup'?`ARRAY['${id(100)}']::uuid[]`:'');
  assert.throws(()=>assert.equal(result.rows[0].alert_suppressed_at,null,'literal NULL marker required'),{code:'ERR_ASSERTION'});
});

const accessLosses=[
  ['member delete',`delete from public.chat_members where user_id='${user}' and chat_id='${chat}'`],
  ['member hidden',`update public.chat_members set hidden_at=clock_timestamp() where user_id='${user}' and chat_id='${chat}'`],
  ['member cleared',`update public.chat_members set cleared_at=clock_timestamp()+interval '1 hour' where user_id='${user}' and chat_id='${chat}'`],
  ['member joined',`update public.chat_members set joined_at=clock_timestamp()+interval '1 hour' where user_id='${user}' and chat_id='${chat}'`],
  ['explicit hidden',`insert into public.message_hidden_for_users values('${message}','${user}')`],
  ['recipient block',`insert into public.user_blocks values('${user}','${sender}')`],
];
async function lostAccess(db,mutation,state='read',expectedSignals=1) {
  await put(db,100,{kind:'message',payload:{message_id:message,chat_id:chat}});
  await db.exec(`update public.notifications set ${state==='read'?"read_at=clock_timestamp()":"alert_suppressed_at=clock_timestamp()"} where id='${id(100)}'`);
  assert.deepEqual((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows.map(n=>n.id),[id(100)]);
  const original=(await db.query(`select to_jsonb(n) as row from public.notifications n where id='${id(100)}'`)).rows[0].row;
  await clear(db);await db.exec(mutation);
  assert.deepEqual(await asUser(db,'select recipient_id,notification_id,event_kind from public.notification_feed_events_v2'),
    Array.from({length:expectedSignals},()=>({recipient_id:user,notification_id:null,event_kind:'invalidate'})),
    'literal read/terminal access loss requires live invalidate');
  assert.deepEqual(await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`),{v:2,rows:[],unavailable_ids:[id(100)]});
  assert.deepEqual((await db.query(`select to_jsonb(n) as row from public.notifications n where id='${id(100)}'`)).rows[0].row,original,
    'access invalidation must not rewrite retained notification history');
}
for(const state of ['read','terminal']) for(const [name,mutation] of accessLosses)
  test(`${state} source access loss ${name} invalidates a retained held row`,async t=>lostAccess(await setup(t),mutation,state));

const sourceLosses=[
  ['message type',`update public.messages set type='system',user_id=null,bot_id=null where id='${message}'`],
  ['message sender',`update public.messages set user_id='${user}' where id='${message}'`],
  ['message sender removed',`update public.messages set user_id=null,bot_id=null where id='${message}'`],
  ['message created_at',`update public.messages set created_at='2000-01-01' where id='${message}'`],
  ['message chat',`update public.messages set chat_id='${id(11)}' where id='${message}'`],
  ['message topic mismatch',`update public.messages set topic_id='${id(23)}' where id='${message}'`],
  ['message soft delete',`update public.messages set deleted_at=clock_timestamp() where id='${message}'`],
  ['message physical delete',`delete from public.messages where id='${message}'`],
  ['topic chat',`update public.topics set chat_id='${id(11)}' where id='${topic}'`],
  ['topic FK cascade',`delete from public.topics where id='${topic}'`,2],
  ['chat FK cascade',`delete from public.chats where id='${chat}'`],
];
for(const [name,mutation,n=1] of sourceLosses)
  test(`read source dependency ${name} invalidates without rewriting notification history`,async t=>lostAccess(await setup(t),mutation,'read',n));

test('visibility source INSERT/DELETE gains invalidate, recipient block is one-way and updates are not admission',async t=>{
  const db=await setup(t);await put(db,100,{kind:'message',payload:{message_id:message,chat_id:chat}});
  await db.exec(`update public.notifications set read_at=clock_timestamp() where id='${id(100)}'`);await clear(db);
  await db.exec(`insert into public.user_blocks values('${sender}','${user}')`);
  assert.deepEqual(await signals(db),[{recipient_id:sender,notification_id:null,event_kind:'invalidate'}]);
  assert.equal((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows.length,1);
  await db.exec(`insert into public.message_hidden_for_users values('${message}','${user}')`);await clear(db);
  await db.exec(`delete from public.message_hidden_for_users where user_id='${user}'`);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:null,event_kind:'invalidate'}]);
  const row=(await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows[0];assert.notEqual(row.read_at,null);
});

async function banExpiry(db) {
  await put(db,100);await db.exec(`insert into public.bans values('${user}',null)`);
  await refused(()=>rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`),'42501');await clear(db);
  await db.exec(`update public.bans set expires_at=clock_timestamp()-interval '1 hour' where user_id='${user}'`);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:null,event_kind:'invalidate'}],'literal ban expiry mutation invalidates');
  assert.equal((await rpc(db,'lookup',`ARRAY['${id(100)}']::uuid[]`)).rows.length,1);
}
test('actual bans user/expiry predicate rejects while banned and signals explicit expiry changes',async t=>banExpiry(await setup(t)));

test('source no-op/irrelevant updates emit nothing and bulk membership changes coalesce per recipient',async t=>{
  const db=await setup(t);
  await db.exec(`alter table public.chat_members add column last_read_at timestamptz;
    insert into public.chat_members(chat_id,user_id) values('${id(11)}','${user}');
    insert into public.message_hidden_for_users values('${message}','${other}');
    insert into public.user_blocks values('${other}','${sender}');
    insert into public.bans values('${other}',clock_timestamp()-interval '1 hour');`);await clear(db);
  await db.exec(`update public.chat_members set hidden_at=hidden_at;
    update public.chat_members set last_read_at=clock_timestamp();
    update public.message_hidden_for_users set user_id=user_id;
    update public.user_blocks set blocked_id=blocked_id;
    update public.bans set expires_at=expires_at;
    update public.messages set content='changed display text';
    update public.topics set archived=true where id='${topic}';`);
  assert.deepEqual(await signals(db),[],'only actual visibility dependencies invalidate');
  await db.exec(`update public.chat_members set hidden_at=clock_timestamp() where user_id='${user}'`);
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:null,event_kind:'invalidate'}]);
});

async function historyUntouched(db) {
  await db.exec(`insert into public.notifications(id,user_id,kind,payload,read_at)
    select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${user}','message',
      jsonb_build_object('message_id','${message}','chat_id','${chat}'),clock_timestamp()
      from generate_series(200,499) n;
    create table public.fixture_feed_history_writes(n integer);insert into public.fixture_feed_history_writes values(0);
    create function public.fixture_count_history_write() returns trigger language plpgsql as $$begin
      update public.fixture_feed_history_writes set n=n+1;return null;end$$;
    create trigger fixture_count_history_write after update on public.notifications
      for each row execute function public.fixture_count_history_write();`);await clear(db);
  await db.exec(`update public.chat_members set hidden_at=clock_timestamp() where user_id='${user}'`);
  assert.equal((await db.query('select n from public.fixture_feed_history_writes')).rows[0].n,0,'literal retained history must not be touched');
  assert.deepEqual(await signals(db),[{recipient_id:user,notification_id:null,event_kind:'invalidate'}]);
}
test('300 read history rows are not rewritten or individually reconciled by access invalidation',async t=>historyUntouched(await setup(t)));

async function accessMutant(t,edit,oracle) {
  let sql=await source();
  const start=sql.indexOf('CREATE FUNCTION private.notification_feed_access_signal_v2('),end=sql.indexOf('END $fn$;',start);
  assert.ok(start>0&&end>start);const original=sql.slice(start,end),mutant=edit(original);
  assert.notEqual(mutant,original,'actual source signal function must change');
  sql=sql.slice(0,start)+mutant+sql.slice(end);
  const db=await setup(t,{sql});await assert.rejects(()=>oracle(db),error=>error.code==='ERR_ASSERTION');
}
test('loaded source emitter omission reproduces the retained read membership-loss bug',async t=>accessMutant(t,
  block=>replaceOnce(block,"EXECUTE 'WITH changed AS (","RETURN NULL;\n  EXECUTE 'WITH changed AS ("),
  db=>lostAccess(db,accessLosses[0][1])));
for(const [name,field,mutation] of [['joined','joined_at',accessLosses[3][1]],['hidden','hidden_at',accessLosses[1][1]],['cleared','cleared_at',accessLosses[2][1]]])
  test(`loaded membership ${name} projection omission loses the invalidate`,async t=>accessMutant(t,
    block=>replaceOnce(block,'user_id,chat_id,joined_at,hidden_at,cleared_at',
      ['user_id','chat_id','joined_at','hidden_at','cleared_at'].filter(key=>key!==field).join(',')),db=>lostAccess(db,mutation)));
test('loaded recipient blocker direction omission targets the wrong account',async t=>accessMutant(t,
  block=>replaceOnce(block,"recipient:='blocker_id'","recipient:='blocked_id'"),db=>lostAccess(db,accessLosses[5][1])));
test('loaded message created_at omission loses a real visibility invalidation',async t=>accessMutant(t,
  block=>replaceOnce(block,'id,chat_id,user_id,bot_id,type,created_at,topic_id,deleted_at','id,chat_id,user_id,bot_id,type,topic_id,deleted_at'),
  db=>lostAccess(db,sourceLosses[3][1])));
test('loaded ban expiry omission hides an explicit access change',async t=>accessMutant(t,
  block=>replaceOnce(block,"fields:='user_id,expires_at'","fields:='user_id'"),banExpiry));
test('loaded history rewrite mutant is caught by real row-write instrumentation',async t=>accessMutant(t,
  block=>replaceOnce(block,"'), recipients AS ('||recipients||')\n    INSERT INTO",
    "'), recipients AS ('||recipients||'), history AS (UPDATE public.notifications SET read_at=read_at WHERE user_id IN (SELECT recipient_id FROM recipients) RETURNING 1)\n    INSERT INTO"),historyUntouched));

test('loaded unconditional source INSERT reintroduction kills real producer/helper admission',async t=>{
  const sql=replaceOnce(await source(),"IF relation NOT IN ('messages','topics') THEN",'IF true THEN');
  const db=await setup(t,{sql});await assert.rejects(()=>ordinaryProducer(db),error=>error.code==='ERR_ASSERTION');
});

async function revisionMutant(t,edit,oracle) {
  let sql=await source();
  const start=sql.indexOf('CREATE FUNCTION private.notification_feed_revision_v2('),end=sql.indexOf('END $fn$;',start);
  assert.ok(start>0&&end>start);const original=sql.slice(start,end),mutant=edit(original);
  assert.notEqual(mutant,original);
  sql=sql.slice(0,start)+mutant+sql.slice(end);
  const db=await setup(t,{sql});await assert.rejects(()=>oracle(db),error=>error.code==='ERR_ASSERTION');
}
test('loaded revision increment omission loses a real ABA version',async t=>revisionMutant(t,
  block=>replaceOnce(block,'NEW.feed_revision:=OLD.feed_revision+1;','NULL;'),revisionRows));
test('loaded revision increment omission preserves an obsolete actual helper permit after SQL ABA',async t=>revisionMutant(t,
  block=>replaceOnce(block,'NEW.feed_revision:=OLD.feed_revision+1;','NULL;'),db=>revisionFrames(db,'page',true)));
for(const field of ['read_at','alert_suppressed_at'])
  test(`loaded revision ${field} projection omission misses a meaningful public field`,async t=>revisionMutant(t,
    block=>replaceOnce(replaceOnce(block,`,NEW.${field}` ,''),`,OLD.${field}`,''),meaningfulFields));
test('loaded revision exhaustion guard omission cannot masquerade as an atomic exhausted refusal',async t=>revisionMutant(t,
  block=>replaceOnce(block,'IF OLD.feed_revision>=9007199254740991 THEN','IF false THEN'),revisionLimit));
test('loaded revision update ownership omission admits a forged server revision',async t=>revisionMutant(t,
  block=>replaceOnce(block,'IF NEW.feed_revision IS DISTINCT FROM OLD.feed_revision THEN','IF false THEN'),async db=>{
    await put(db,100);await refused(()=>db.exec(`update public.notifications set feed_revision=2 where id='${id(100)}'`),'42501');
  }));
test('loaded revision insert ownership omission admits a forged initial revision',async t=>revisionMutant(t,
  block=>replaceOnce(block,'IF NEW.feed_revision IS DISTINCT FROM 1::bigint THEN','IF false THEN'),async db=>{
    await refused(()=>db.exec(`insert into public.notifications(id,user_id,kind,feed_revision) values('${id(100)}','${user}','task_assigned',2)`),'42501');
  }));
for(const name of ['page','lookup']) test(`loaded ${name} revision omission breaks the literal eight-field envelope`,async t=>{
  let sql=await source();const start=sql.indexOf(`CREATE FUNCTION public.notification_feed_${name}_v2(`),end=sql.indexOf('END $fn$;',start);
  sql=sql.slice(0,start)+replaceOnce(sql.slice(start,end),',n.feed_revision FROM public.notifications n',' FROM public.notifications n')+sql.slice(end);
  const db=await setup(t,{sql});await put(db,100);
  const value=await rpc(db,name,name==='lookup'?`ARRAY['${id(100)}']::uuid[]`:'');
  assert.throws(()=>assert.equal(value.rows[0].feed_revision,1,'literal eighth field required'),{code:'ERR_ASSERTION'});
});
test('raising selfcheck rejects a disabled server revision trigger',async()=>{
  const sql=replaceOnce(await source(),'DO $security$','ALTER TABLE public.notifications DISABLE TRIGGER zz_notification_feed_revision_v2;\nDO $security$');
  await assert.rejects(()=>feedFixture({sql}),/notification_feed_v2_security_failed/);
});

test('actual eight-field helper remains semantically typed against current database definitions',()=>{
  const path=new URL('../../artifacts/kub/src/lib/notificationFeedV2.ts',import.meta.url);
  const filename=decodeURIComponent(path.pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  const baseUrl=decodeURIComponent(new URL('../../artifacts/kub/src/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  const program=ts.createProgram([filename],{strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,baseUrl,paths:{'@/*':['*']}});
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});
