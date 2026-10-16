import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deliveryFixture,sendFixtureMessage,claimFixtureTarget} from './topic-notification-delivery.fixture.mjs';
import {authenticated,setPreference,id,user,other,chat,topic,general,quote,claims,session} from './topic-notification-overrides.fixture.mjs';

const supplement=new URL('../../docs/proposals/2026-10-16-topic-notification-delivery.sql',import.meta.url);
async function scoped(t,options={}) {
  const db=await deliveryFixture({candidate:true,native:Boolean(process.env.LETSCUBE_TOPIC_PG17_DRIVER),t,...options}); t.after(()=>db.close()); return db;
}
const choice=(db,mode,revision=0,tid=topic)=>authenticated(db,setPreference(mode,revision,tid));
async function authenticatedMutation(db,sql) {
  await db.exec('set role authenticated;');
  try {await db.exec(sql);} finally {await db.exec('reset role;');}
}
async function single(db,table='notifications_push_outbox') {
  return claimFixtureTarget(db,`public.${table}`,`user_id='${user}'`);
}
const recheck=(db,c,native=false)=>db.query(`select public.${native?'native_':''}push_outbox_delivery_recheck('${c.id}','${c.token}') as status`);
async function noSingleReplay(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,101);
  const web=await single(db),native=await single(db,'notifications_native_push_outbox');
  await choice(db,'disabled'); await choice(db,'enabled',1);
  assert.notEqual((await recheck(db,web)).rows[0].status,'deliver','disabled single must stay terminal after enable');
  assert.notEqual((await recheck(db,native,true)).rows[0].status,'deliver','disabled native must stay terminal after enable');
  const rows=(await db.query(`select read_at,alert_suppressed_at is not null as terminal from public.notifications where user_id='${user}'`)).rows;
  assert.deepEqual(rows,[{read_at:null,terminal:true}]);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications where user_id='${other}'`)).rows[0].n,1);
}
test('actual single producer disable then enable cannot revive either claimed target',t=>noSingleReplay(t));

async function noAlbumReplay(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,102,{albumIndex:0});
  const c=await claimFixtureTarget(db,'public.notifications_album_push_outbox',`subscription_id='${id(50)}'`);
  await choice(db,'disabled');
  assert.notEqual((await db.query(`select * from public.album_push_recheck('${c.id}','${c.token}')`)).rows[0].status,'deliver');
  await choice(db,'enabled',1);
  await db.exec(`insert into public.push_subscriptions values('${id(59)}','${user}',true);`);
  await sendFixtureMessage(db,103,{albumIndex:1});
  const active=(await db.query(`select count(*)::int as n from public.notifications_album_push_outbox o join public.album_push_groups g on g.id=o.group_id where g.user_id='${user}' and o.sent_at is null and o.suppressed_at is null`)).rows[0].n;
  assert.equal(active,0,'incomplete suppressed album cannot revive on later part or new target');
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}' and suppressed_at is null`)).rows[0].n,0,'album terminal denial cannot fall back to a single');
}
test('actual incomplete album remains terminal across enable late member and subscription',t=>noAlbumReplay(t));

async function fullClaims(db) {
  await db.exec(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:user,session_id:session,role:'authenticated',is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600}))},false);`);
}
async function notification(db,mid,recipient=user) {
  return (await db.query(`select id from public.notifications where user_id='${recipient}' and payload->>'message_id'='${mid}'`)).rows[0].id;
}
async function decisions(db,ids) {
  await fullClaims(db);
  return authenticated(db,`select * from public.message_notification_alert_decisions(ARRAY[${ids.map(quote).join(',')}]::uuid[])`);
}
test('unchanged real single and complete album positive controls remain deliverable',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,110);
  const w=await single(db),n=await single(db,'notifications_native_push_outbox');
  assert.equal((await recheck(db,w)).rows[0].status,'deliver');
  assert.equal((await recheck(db,n,true)).rows[0].status,'deliver');
  await sendFixtureMessage(db,111,{albumIndex:0}); await sendFixtureMessage(db,112,{albumIndex:1});
  const a=await claimFixtureTarget(db,'public.notifications_album_push_outbox',`subscription_id='${id(50)}'`);
  assert.equal((await db.query(`select * from public.album_push_recheck('${a.id}','${a.token}')`)).rows[0].status,'deliver');
});
test('decision frame is own-only and independent of external push and category switches',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,113);
  const own=await notification(db,id(113)),foreign=await notification(db,id(113),other);
  await db.exec(`update public.notification_preferences set push_enabled=false,message_push_enabled=false where user_id='${user}';`);
  assert.deepEqual(await decisions(db,[own,foreign,id(999)]),[{notification_id:own,allowed:true,scope_key:topic,revision:0}]);
  assert.equal((await db.query(`select alert_suppressed_at from public.notifications where id='${own}'`)).rows[0].alert_suppressed_at,null);
  const w=await single(db); assert.notEqual((await recheck(db,w)).rows[0].status,'deliver');
  assert.equal((await decisions(db,[own]))[0].allowed,true,'external delivery suppression is not a sound mute');
  await db.exec(`insert into public.privacy_preferences values('${user}','dnd',null);`);
  assert.equal((await decisions(db,[own]))[0].allowed,false,'DND is shared by presentation channels');
});
async function terminalDecision(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,114); const own=await notification(db,id(114));
  await choice(db,'disabled'); await choice(db,'enabled',1);
  assert.equal((await decisions(db,[own]))[0].allowed,false,'terminal marker must deny a later enabled client decision');
}
test('client decisions retain terminal scope admission across disable enable',t=>terminalDecision(t));
test('parent mutations terminalize inherited alerts but keep explicitly enabled child intact',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,115);
  await db.exec(`insert into public.chat_notification_preferences values('${chat}','${user}',false,null);`);
  await db.exec(`update public.chat_notification_preferences set push_enabled=true where user_id='${user}';`);
  assert.equal((await decisions(db,[await notification(db,id(115))]))[0].allowed,false);
  await choice(db,'enabled'); await sendFixtureMessage(db,116);
  await db.exec(`update public.chat_notification_preferences set push_enabled=false,muted_until=now()+interval '1 hour' where user_id='${user}';`);
  assert.equal((await decisions(db,[await notification(db,id(116))]))[0].allowed,true);
  await db.exec('update private.topic_notification_runtime set enabled=false;');
  assert.equal((await decisions(db,[await notification(db,id(116))]))[0].allowed,false,'rollback stops enabled bypass');
  assert.equal((await decisions(db,[await notification(db,id(115))]))[0].allowed,false,'rollback cannot revive retired alerts');
});
test('denied first album part cannot create singles WNS or a later revived group',async t=>{
  const db=await scoped(t);
  await db.exec(`update public.album_push_runtime set legacy_wns_enabled=true;
    insert into public.user_push_devices(id,user_id,platform,provider,enabled) values('${id(54)}','${user}','windows','wns',true);`);
  await choice(db,'disabled'); await sendFixtureMessage(db,117,{albumIndex:0});
  await choice(db,'enabled',1); await sendFixtureMessage(db,118,{albumIndex:1});
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}'`)).rows[0].n,0);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_native_push_outbox where user_id='${user}'`)).rows[0].n,0);
  assert.equal((await decisions(db,[await notification(db,id(118))]))[0].allowed,false);
});
test('mixed-scope album routes only through an eligible actual member',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,119,{albumIndex:0});
  await sendFixtureMessage(db,120,{albumIndex:1,topicId:null});
  await choice(db,'disabled',0,null);
  const c=await claimFixtureTarget(db,'public.notifications_album_push_outbox',`subscription_id='${id(50)}'`);
  const result=(await db.query(`select * from public.album_push_recheck('${c.id}','${c.token}')`)).rows[0];
  assert.equal(result.status,'deliver'); assert.equal(result.payload.messageId,id(119));
  await choice(db,'disabled');
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_album_push_outbox o join public.album_push_groups g on g.id=o.group_id where g.user_id='${user}' and o.suppressed_at is null`)).rows[0].n,0);
});
async function originChange(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,121); const own=await notification(db,id(121));
  await db.exec(`update public.messages set topic_id=null where id='${id(121)}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,false,'old admission must not transfer into a new scope');
  await db.exec(`update public.messages set topic_id='${topic}' where id='${id(121)}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,false);
}
test('message topic move and return never reuse the original admission',t=>originChange(t));
test('non-identity notification payload edits preserve scope admission',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,134); const own=await notification(db,id(134));
  await db.exec(`update public.notifications set payload=payload||'{"mentioned":true}'::jsonb where id='${own}';
    update public.messages set content='Fictional edit' where id='${id(134)}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,true);
});
test('canonical general aliases remain equivalent but archive reclassification and replacement are terminal',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,122,{topicId:null}); const own=await notification(db,id(122));
  await db.exec(`update public.messages set topic_id='${general}' where id='${id(122)}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,true);
  await db.exec(`update public.topics set is_general=false where id='${general}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,false);
  await db.exec(`update public.topics set is_general=true where id='${general}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,false);
  await sendFixtureMessage(db,123,{topicId:null}); const second=await notification(db,id(123));
  await db.exec(`update public.topics set archived=true where id='${general}';`);
  assert.equal((await decisions(db,[second]))[0].allowed,false);
});
async function previewTerminal(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,124); const own=await notification(db,id(124)); await fullClaims(db);
  const sql=`select * from public.native_message_notification_preview('${id(52)}','${own}')`;
  assert.equal((await authenticated(db,sql)).length,1,'actual unchanged session/device/consent preview positive');
  await choice(db,'disabled'); await choice(db,'enabled',1);
  assert.equal((await authenticated(db,sql)).length,0,'preview must reject a terminal notification after enable');
}
test('actual extracted native preview retains its gates and refuses terminal admission',t=>previewTerminal(t));
test('decisions require a current session bound and refuse unavailable malformed and read rows',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,125); const own=await notification(db,id(125));
  await db.exec(`update public.notifications set read_at=clock_timestamp() where id='${own}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,false);
  await db.exec(`insert into public.notifications(id,user_id,kind,payload) values('${id(126)}','${user}','message','{"message_id":"bad","chat_id":"bad"}');`);
  assert.deepEqual(await decisions(db,[id(126)]),[{notification_id:id(126),allowed:false,scope_key:null,revision:null}]);
  await fullClaims(db);
  for(const args of ['NULL','ARRAY[]::uuid[]',`array_fill('${own}'::uuid,ARRAY[101])`])
    await assert.rejects(authenticated(db,`select * from public.message_notification_alert_decisions(${args})`),/invalid_topic_alert_decisions/);
  await db.exec(`delete from auth.sessions where id='${session}';`);
  await assert.rejects(authenticated(db,`select * from public.message_notification_alert_decisions(ARRAY['${own}']::uuid[])`),/topic_alert_session_invalid/);
});
async function serverColumns(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,127); const own=await notification(db,id(127));
  await db.exec(`grant select,update on public.notifications to authenticated;
    create policy fixture_own_read on public.notifications for select to authenticated using(user_id=auth.uid());
    create policy fixture_own_update on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());`);
  await authenticatedMutation(db,`update public.notifications set read_at=clock_timestamp() where id='${own}'`);
  assert.notEqual((await db.query(`select read_at from public.notifications where id='${own}'`)).rows[0].read_at,null);
  await assert.rejects(authenticatedMutation(db,`update public.notifications set alert_suppressed_at=clock_timestamp() where id='${own}'`),/notification_alert_columns_are_server_owned/,'a broad existing UPDATE grant cannot write the marker');
  await assert.rejects(authenticatedMutation(db,`update public.notifications set alert_origin='{}' where id='${own}'`),/notification_alert_columns_are_server_owned/);
  // Keep the read row untouched; monotonic clearing needs a genuinely terminal
  // unread admission, not a no-op UPDATE of a still-NULL marker.
  await sendFixtureMessage(db,184); const pending=await notification(db,id(184));
  await choice(db,'disabled');
  assert.equal((await db.query(`select alert_suppressed_at is not null as terminal from public.notifications where id='${pending}'`)).rows[0].terminal,true);
  await assert.rejects(db.exec(`update public.notifications set alert_suppressed_at=null where id='${pending}'`),/notification_alert_columns_are_server_owned/);
}
test('server-only monotonic columns preserve existing broad read_at UPDATE permissions',t=>serverColumns(t));

const mutations=[
  ['child suppression',"IF TG_WHEN='AFTER' THEN PERFORM private.topic_alert_refresh_locked(r.u,r.c); END IF;","IF TG_WHEN='AFTER' AND TG_TABLE_NAME<>'topic_notification_preferences' THEN PERFORM private.topic_alert_refresh_locked(r.u,r.c); END IF;",noSingleReplay,'disabled single must stay terminal after enable'],
  ['album tombstone','UPDATE public.album_push_groups SET topic_alert_suppressed_at=v_now\n      WHERE id=p_group AND topic_alert_suppressed_at IS NULL;','PERFORM 1;',noAlbumReplay,'incomplete suppressed album cannot revive on later part or new target'],
  ['terminal decision','SELECT coalesce((SELECT n.kind=\'message\' AND n.alert_suppressed_at IS NULL','SELECT coalesce((SELECT n.kind=\'message\'',terminalDecision,'terminal marker must deny a later enabled client decision'],
  ['source origin','AND n.alert_origin IS NOT NULL AND n.alert_origin=private.message_alert_origin(m.id)','AND n.alert_origin IS NOT NULL',originChange,'old admission must not transfer into a new scope'],
  ['preview terminal','\\n    AND private.notification_topic_alert_allowed(n.id)','',previewTerminal,'preview must reject a terminal notification after enable'],
];
for(const [name,before,after,scenario,message] of mutations) test(`actual loaded SQL omission fails: ${name}`,async t=>{
  const source=await readFile(supplement,'utf8'); assert.equal(source.split(before).length,2,`${name}: exact mutation anchor`);
  await assert.rejects(()=>scenario(t,{candidateSql:source.replace(before,after)}),error=>{
    assert.equal(error.code,'ERR_ASSERTION','SQL setup errors cannot kill a behavioral mutant');
    assert.equal(error.message.split('\n')[0],message); return true;
  });
});

function fingerprint(s) {
  return 'v1:'+createHash('sha256').update(Buffer.concat([s.id,s.user_id,s.endpoint,s.p256dh,s.auth].flatMap(value=>{
    const bytes=Buffer.from(value); return [Buffer.from(bytes.length+':'),bytes];
  }))).digest('hex');
}
async function boundCall(db,c) {
  const sub=(await db.query(`select * from public.push_subscriptions where id='${id(50)}'`)).rows[0];
  return `select public.push_outbox_delivery_recheck_bound('${c.id}','${c.token}','${sub.id}','${fingerprint(sub)}');`;
}
test('bound descriptor RPC remains deliverable with the new barrier and becomes terminal after disable',async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,128); const c=await single(db),sql=await boundCall(db,c);
  assert.equal((await db.query(sql)).rows[0].push_outbox_delivery_recheck_bound,'deliver');
  await choice(db,'disabled'); await choice(db,'enabled',1);
  assert.notEqual((await db.query(sql)).rows[0].push_outbox_delivery_recheck_bound,'deliver');
});
async function waiting(db,pid) {
  for(let i=0;i<40;i++) {
    if((await db.query(`select wait_event='advisory' as waiting from pg_stat_activity where pid=${pid}`)).rows[0]?.waiting) return;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.fail('real bound/setter contender did not wait on the pre-outbox advisory boundary');
}
async function boundInterleaving(t,first,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,129); const c=await single(db),sql=await boundCall(db,c);
  const a=db.session(),b=db.session(),pid=Number(await b.send('select pg_backend_pid();'));
  if(first==='setter') {
    // Hold just the barrier, let bound contend, then run the real setter. A
    // bound wrapper that already owns the outbox now creates a genuine cycle.
    await a.send(`begin; select private.topic_notification_lock('${user}','${chat}'); ${claims()} set local role authenticated;`);
    const pending=b.send(sql); const outcome=pending.then(value=>({value}),error=>({error}));
    await waiting(db,pid);
    let setterError;
    try {await a.send(setPreference('disabled')+';');} catch(error) {setterError=error;}
    if(setterError) await a.send('rollback;').catch(()=>{}); else await a.send('commit;');
    const result=await outcome;
    if(setterError) throw setterError;
    if(result.error) throw result.error;
    assert.notEqual(result.value.trim().split('\n').at(-1),'deliver');
  } else {
    assert.equal((await a.send('begin; '+sql)).trim().split('\n').at(-1),'deliver');
    const pending=b.send(`${claims()} set role authenticated; ${setPreference('disabled')};`);
    const outcome=pending.then(value=>({value}),error=>({error}));
    await waiting(db,pid); await a.send('commit;'); const result=await outcome;
    assert.equal(result.error,undefined); assert.equal(JSON.parse(result.value.trim().split('\n').at(-1)).status,'applied');
  }
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}' and suppressed_at is null`)).rows[0].n,0);
}
for(const first of ['setter','bound']) test(`PG17 bound/setter ${first} wins without outbox/barrier inversion`,{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},t=>boundInterleaving(t,first));
test('PG17 omission of the bound pre-lock barrier exposes a fail-closed NOWAIT refusal', {skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const source=await readFile(supplement,'utf8');
  const before=",\n    ('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','notifications_push_outbox')";
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>boundInterleaving(t,'setter',{candidateSql:source.replace(before,'')}),error=>{assert.equal(error.code,'55P03');return true;});
});

test('PG17 joint omission of the bound barrier and downstream NOWAIT restores the real deadlock', {skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const source=await readFile(supplement,'utf8');
  const barrier=",\n    ('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)','notifications_push_outbox')";
  const row='FROM public.notifications_push_outbox WHERE notification_id=p_notification\n    AND sent_at IS NULL AND suppressed_at IS NULL ORDER BY id FOR UPDATE NOWAIT;';
  assert.equal(source.split(barrier).length,2); assert.equal(source.split(row).length,2);
  await assert.rejects(()=>boundInterleaving(t,'setter',{candidateSql:source.replace(barrier,'').replace(row,row.replace(' NOWAIT',''))}),error=>{
    assert.equal(error.code,'40P01');return true;
  });
});

async function boundTargetDelete(t,options={}) {
  const db=await scoped(t,options);
  await db.exec(`insert into public.push_subscriptions values('${id(59)}','${user}',true);
    update public.album_push_runtime set enabled=false;`);
  // A real single fallback followed by a real partial album shares the same
  // immutable album origin. Reconciliation can touch sibling/group targets.
  await sendFixtureMessage(db,197,{albumIndex:0});
  await db.exec('update public.album_push_runtime set enabled=true;');
  await sendFixtureMessage(db,198,{albumIndex:1});
  const note=await notification(db,id(197));
  const group=(await db.query(`select id,observed_count from public.album_push_groups where user_id='${user}'`)).rows[0];
  assert.equal(group.observed_count,1);
  const current=await claimFixtureTarget(db,'public.notifications_push_outbox',`notification_id='${note}' and subscription_id='${id(50)}'`);
  const sibling=await claimFixtureTarget(db,'public.notifications_push_outbox',`notification_id='${note}' and subscription_id='${id(59)}'`);
  const native=await single(db,'notifications_native_push_outbox');
  const album=await claimFixtureTarget(db,'public.notifications_album_push_outbox',`group_id='${group.id}' and subscription_id='${id(59)}'`);
  const call=await boundCall(db,current);
  assert.deepEqual((await db.query(`select c.conrelid::regclass::text as relation,c.confdeltype::text as on_delete
    from pg_constraint c where c.conrelid in ('public.notifications_push_outbox'::regclass,'public.notifications_album_push_outbox'::regclass)
      and c.confrelid='public.push_subscriptions'::regclass and c.contype='f' order by 1`)).rows,
  [{relation:'notifications_album_push_outbox',on_delete:'c'},{relation:'notifications_push_outbox',on_delete:'c'}]);
  await db.exec(`insert into public.user_blocks values('${user}','${id(3)}');`);
  const ddl=(await db.query(`select pg_get_functiondef('public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)'::regprocedure) as ddl`)).rows[0].ddl;
  const stage='  -- Descriptor writers cannot change these fields until this transaction ends.';
  assert.equal(ddl.split(stage).length,2);
  // Test-only pause after the actual preamble, before the actual target lock.
  // Its independent gate is released before the two-actor FK cycle can form.
  await db.exec(ddl.replace(stage,'  PERFORM pg_catalog.pg_advisory_xact_lock(771335001);\n'+stage));
  const deleter=db.session(),bound=db.session();
  const gatePid=(await db.query('select pg_backend_pid() as pid')).rows[0].pid;
  const deletePid=Number(await deleter.send('select pg_backend_pid();')),boundPid=Number(await bound.send('select pg_backend_pid();'));
  await deleter.send(`begin; set local deadlock_timeout='100ms'; set local statement_timeout='5s';
    select id from public.push_subscriptions where id='${id(50)}' for update;`);
  let gated=true;
  await db.exec('begin; select pg_advisory_xact_lock(771335001);');
  const attempt=bound.send(`set deadlock_timeout='100ms'; set statement_timeout='5s'; ${call}`).then(value=>({value}),error=>({error}));
  try {
    let staged=false;
    for(let i=0;i<40;i++) {
      await db.exec('select pg_stat_clear_snapshot();');
      const row=(await db.query(`select wait_event='advisory' as waiting,${gatePid}=any(pg_blocking_pids(pid)) as gated
        from pg_stat_activity where pid=${boundPid}`)).rows[0];
      if(row?.waiting&&row.gated) {staged=true;break;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(staged,true,'actual bound wrapper must reach the pre-target pause');
    let deleted=false,inversion=false;
    const deletion=deleter.send(`delete from public.push_subscriptions where id='${id(50)}';`).then(value=>{deleted=true;return {value};},error=>{deleted=true;return {error};});
    for(let i=0;i<40&&!deleted;i++) {
      await db.exec('select pg_stat_clear_snapshot();');
      const row=(await db.query(`select wait_event='transactionid' as waiting,${boundPid}=any(pg_blocking_pids(pid)) as bound_blocks
        from pg_stat_activity where pid=${deletePid}`)).rows[0];
      if(row?.waiting&&row.bound_blocks) {inversion=true;break;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(deleted||inversion,true,'DELETE must complete or prove a wait on the bound outbox owner');
    await db.exec('commit;'); gated=false;
    const result=await attempt,removed=await deletion;
    await deleter.send(removed.error?'rollback;':'commit;').catch(error=>{if(!removed.error)throw error;});
    if(removed.error) throw removed.error;
    if(result.error?.code!=='55P03') throw result.error||Error('target contention must refuse NOWAIT');
    assert.equal(inversion,false,'bound preamble must not own outboxes before the target lock');
    assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where subscription_id='${id(50)}'`)).rows[0].n,0);
    assert.equal((await db.query(`select count(*)::int as n from public.notifications_album_push_outbox where subscription_id='${id(50)}'`)).rows[0].n,0);
    assert.equal((await db.query(`select count(alert_suppressed_at)::int as n from public.notifications where user_id='${user}'`)).rows[0].n,0);
    assert.equal((await db.query(`select topic_alert_suppressed_at from public.album_push_groups where id='${group.id}'`)).rows[0].topic_alert_suppressed_at,null);
    for(const [table,target] of [['notifications_push_outbox',sibling],['notifications_native_push_outbox',native],['notifications_album_push_outbox',album]]) {
      const row=(await db.query(`select claim_token='${target.token}'::uuid as retained,sent_at from public.${table} where id='${target.id}'`)).rows[0];
      assert.deepEqual(row,{retained:true,sent_at:null});
    }
    // After target deletion, a fresh maintained unbound recheck still performs
    // the legitimate scope denial, including the real incomplete album.
    assert.notEqual((await recheck(db,sibling)).rows[0].status,'deliver');
    assert.deepEqual((await db.query(`select user_id,count(*)::int as n,count(alert_suppressed_at)::int as terminal,
      count(read_at)::int as read from public.notifications group by user_id order by user_id`)).rows,
    [{user_id:user,n:2,terminal:2,read:0},{user_id:other,n:2,terminal:0,read:0}]);
    assert.equal((await db.query(`select topic_alert_suppressed_at is not null as terminal from public.album_push_groups where id='${group.id}'`)).rows[0].terminal,true);
  } finally {if(gated) await db.exec('rollback;');}
}

test('PG17 bound target repair: denied claim and real subscription DELETE leave pre-target sibling outboxes untouched',
  {skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},t=>boundTargetDelete(t));

test('PG17 bound target omission: pre-target reconciliation recreates the real FK inversion despite NOWAIT',
  {skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
    const source=await readFile(supplement,'utf8'),before="PERFORM private.topic_alert_lock(n.user_id,(n.alert_origin->>''chat_id'')::uuid)";
    assert.equal(source.split(before).length,2);
    await assert.rejects(()=>boundTargetDelete(t,{candidateSql:source.replace(before,'PERFORM private.topic_alert_reconcile_notification(n.id)')}),error=>{
      assert.equal(error.code,'ERR_ASSERTION');
      assert.equal(error.message.split('\n')[0],'bound preamble must not own outboxes before the target lock');return true;
    });
});

test('PG17 bound target joint omission: old preamble and blocking target restore the real FK deadlock',
  {skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
    const source=await readFile(supplement,'utf8'),before="PERFORM private.topic_alert_lock(n.user_id,(n.alert_origin->>''chat_id'')::uuid)";
    const target="'FOR SHARE OF s;', 'FOR SHARE OF s NOWAIT;'";
    assert.equal(source.split(before).length,2); assert.equal(source.split(target).length,2);
    await assert.rejects(()=>boundTargetDelete(t,{candidateSql:source.replace(before,'PERFORM private.topic_alert_reconcile_notification(n.id)').replace(target,"'FOR SHARE OF s;', 'FOR SHARE OF s;'")}),error=>{
      assert.equal(error.code,'40P01');return true;
    });
});

async function fallbackTerminal(t,options={}) {
  const db=await scoped(t,options);
  await db.exec(`update public.album_push_runtime set legacy_wns_enabled=true;
    insert into public.user_push_devices(id,user_id,platform,provider,enabled) values('${id(55)}','${user}','windows','wns',true);
    create or replace function public.album_push_enqueue(p_notification_id uuid) returns boolean
    language plpgsql security definer set search_path='' as $fault$
    begin
      update public.notifications set alert_suppressed_at=clock_timestamp() where id=p_notification_id;
      return false;
    end $fault$;`);
  await sendFixtureMessage(db,130);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox`)).rows[0].n,0,'terminal album refusal must guard the single fallback');
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_native_push_outbox`)).rows[0].n,0,'terminal fallback guard must cover legacy WNS too');
}
test('an album false result after terminalization cannot fall back to web native or WNS',t=>fallbackTerminal(t));
test('allowed album exception retains the old single fallback but disabled admission never enters it',async t=>{
  const db=await scoped(t);
  await db.exec(`create or replace function public.album_push_enqueue(p_notification_id uuid) returns boolean
    language plpgsql security definer set search_path='' as $fault$ begin raise exception 'synthetic_album_fault'; end $fault$;`);
  await sendFixtureMessage(db,131);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}'`)).rows[0].n,1);
  await choice(db,'disabled'); await sendFixtureMessage(db,132);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where user_id='${user}'`)).rows[0].n,1);
});

for(const code of ['55P03','40001']) test(`downstream repair: album retry ${code} must propagate without a fallback or partial feed`,async t=>{
  const db=await scoped(t);
  await db.exec(`create or replace function public.album_push_enqueue(p_notification_id uuid) returns boolean
    language plpgsql security definer set search_path='' as $fault$
    begin raise exception 'topic_delivery_retry_control' using errcode='${code}'; end $fault$;`);
  await assert.rejects(sendFixtureMessage(db,194),error=>{assert.equal(error.code,code);return true;},'a retryable album error must abort the whole producer');
  assert.equal((await db.query(`select count(*)::int as n from public.messages where id='${id(194)}'`)).rows[0].n,0);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications`)).rows[0].n,0);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox`)).rows[0].n,0);
});
test('malformed denied album metadata does not break feed retention',async t=>{
  const db=await scoped(t); await choice(db,'disabled');
  for(const [i,metadata] of [{album_count:2,album_index:0},{album_id:'fixture-album-5555',album_count:'2',album_index:0}].entries()) {
    await db.exec(`insert into public.messages(id,chat_id,user_id,type,topic_id,media_url,media_metadata)
      values('${id(140+i)}','${chat}','${id(3)}','image','${topic}','fictional.invalid/image',${quote(JSON.stringify(metadata))}::jsonb);`);
  }
  assert.equal((await db.query(`select count(*)::int as n from public.notifications where user_id='${user}'`)).rows[0].n,2);
});
test('existing unprovable admissions retire once without deleting feed or changing read state',async t=>{
  const db=await scoped(t,{candidateSql:''}); await sendFixtureMessage(db,133); const own=await notification(db,id(133));
  await db.exec(await readFile(supplement,'utf8'));
  assert.deepEqual((await db.query(`select read_at,alert_origin,alert_suppressed_at is not null as terminal from public.notifications where id='${own}'`)).rows,
    [{read_at:null,alert_origin:null,terminal:true}]);
  assert.equal((await db.query(`select count(*)::int as n from public.notifications_push_outbox where suppressed_at is null`)).rows[0].n,0);
});
test('prestate refuses drift in every captured delivery body and does not add columns',async t=>{
  for(const signature of ['enqueue_message_notifications()','_enqueue_push_after_notification_insert()',
    'album_push_enqueue(uuid)','album_push_recheck(uuid,uuid)','push_outbox_delivery_recheck(uuid,uuid)',
    'native_push_outbox_delivery_recheck(uuid,uuid)']) await t.test(signature,async()=>{
    const db=await scoped(t,{candidateSql:''});
    const ddl=(await db.query(`select pg_get_functiondef('public.${signature}'::regprocedure) as ddl`)).rows[0].ddl;
    await db.exec(ddl.replace('begin\n','begin\n  -- changed captured input\n'));
    await assert.rejects(db.exec(await readFile(supplement,'utf8')),/topic_delivery_prestate_drift/);
    await db.exec('rollback;');
    assert.equal((await db.query("select count(*)::int as n from pg_attribute where attrelid='public.notifications'::regclass and attname='alert_suppressed_at' and not attisdropped")).rows[0].n,0);
  });
});
test('security self-checks refuse actual definer path ACL and enabled-trigger omissions',async t=>{
  const source=await readFile(supplement,'utf8');
  for(const [name,before,after] of [
    ['definer',"LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''","LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''"],
    ['fixed path',"LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''","LANGUAGE sql STABLE SECURITY DEFINER"],
    ['client ACL','GRANT EXECUTE ON FUNCTION public.message_notification_alert_decisions(uuid[]) TO authenticated;',''],
    ['trigger','CREATE TRIGGER topic_alert_columns_guard BEFORE UPDATE OF alert_origin,alert_suppressed_at ON public.notifications\n  FOR EACH ROW EXECUTE FUNCTION private.topic_alert_columns_guard();',''],
  ]) await t.test(name,async()=>{
    const db=await scoped(t,{candidateSql:''});
    assert.ok(source.includes(before));
    await assert.rejects(db.exec(source.replace(before,after)),/topic_delivery_security_failed/);
    await db.exec('rollback;');
  });
});
test('actual loaded SQL omission fails: the post-album fallback guard',async t=>{
  const source=await readFile(supplement,'utf8');
  const before="  IF new.kind=''message'' AND NOT private.notification_topic_alert_allowed(new.id) THEN RETURN NULL; END IF;\\n";
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>fallbackTerminal(t,{candidateSql:source.replace(before,'')}),error=>{
    assert.equal(error.code,'ERR_ASSERTION');
    assert.equal(error.message.split('\n')[0],'terminal album refusal must guard the single fallback'); return true;
  });
});

async function decisionLimit(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,135); const own=await notification(db,id(135)); await fullClaims(db);
  assert.equal((await authenticated(db,`select * from public.message_notification_alert_decisions(array_fill('${own}'::uuid,ARRAY[100]))`)).length,1);
  await assert.rejects(authenticated(db,`select * from public.message_notification_alert_decisions(array_fill('${own}'::uuid,ARRAY[101]))`),/invalid_topic_alert_decisions/,'101 IDs must refuse');
}
test('decision RPC accepts 100 IDs and refuses 101',t=>decisionLimit(t));
test('actual loaded SQL omission fails: the 100-ID bound',async t=>{
  const source=await readFile(supplement,'utf8'),before='cardinality(p_notification_ids) NOT BETWEEN 1 AND 100';
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>decisionLimit(t,{candidateSql:source.replace(before,'cardinality(p_notification_ids) NOT BETWEEN 1 AND 101')}),error=>{
    assert.equal(error.code,'ERR_ASSERTION'); assert.match(error.message,/Missing expected rejection.*101 IDs must refuse/); return true;
  });
});
test('actual loaded SQL omission fails: server-only marker writes under a broad grant',async t=>{
  const source=await readFile(supplement,'utf8');
  const before="(NEW.alert_suppressed_at IS DISTINCT FROM OLD.alert_suppressed_at AND current_user NOT IN ('postgres','supabase_admin'))";
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>serverColumns(t,{candidateSql:source.replace(before,'false')}),error=>{
    assert.equal(error.code,'ERR_ASSERTION'); assert.match(error.message,/Missing expected rejection.*broad existing UPDATE grant/); return true;
  });
});

async function publicationSnapshot(db) {
  return (await db.query(`select p.pubname,p.pubowner::regrole::text as owner,p.puballtables,
    coalesce(array_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname)
      filter(where c.oid is not null),ARRAY[]::text[]) as tables
    from pg_publication p left join pg_publication_rel pr on pr.prpubid=p.oid
    left join pg_class c on c.oid=pr.prrelid left join pg_namespace n on n.oid=c.relnamespace
    where p.pubname in ('supabase_realtime','supabase_realtime_messages_publication')
    group by p.oid order by p.pubname`)).rows;
}
async function publicationMembership(t,options={}) {
  const db=await scoped(t,options);
  const rows=await publicationSnapshot(db);
  assert.equal(rows[0].tables.includes('public.topic_notification_preferences'),true,'preference table must explicitly join the account-sync publication');
  assert.deepEqual(rows,[
    {pubname:'supabase_realtime',owner:'postgres',puballtables:false,
      tables:['public.notifications','public.topic_notification_preferences','public.topics']},
    {pubname:'supabase_realtime_messages_publication',owner:'supabase_admin',puballtables:false,tables:[]},
  ]);
  assert.equal((await db.query("select relrowsecurity as enabled from pg_class where oid='public.topic_notification_preferences'::regclass")).rows[0].enabled,true);
}
test('publication explicitly includes preferences without changing existing table controls',t=>publicationMembership(t));

test('publication change retains unrelated members and the second publication unchanged',async t=>{
  const db=await scoped(t,{candidateSql:''});
  await db.exec(`alter publication supabase_realtime add table public.profiles;
    alter publication supabase_realtime_messages_publication add table public.bots;`);
  const before=await publicationSnapshot(db);
  await db.exec(await readFile(supplement,'utf8'));
  const after=await publicationSnapshot(db);
  assert.deepEqual(after[1],before[1]);
  assert.deepEqual(after[0],{...before[0],tables:[...before[0].tables,'public.topic_notification_preferences'].sort()});
});

test('publication prestate refuses missing owner all-tables and membership drift',async t=>{
  for(const [name,change] of [
    ['missing','drop publication supabase_realtime;'],
    ['owner','alter publication supabase_realtime owner to supabase_admin;'],
    ['all tables','drop publication supabase_realtime; create publication supabase_realtime for all tables;'],
    ['topics','alter publication supabase_realtime drop table public.topics;'],
    ['notifications','alter publication supabase_realtime drop table public.notifications;'],
  ]) await t.test(name,async()=>{
    const db=await scoped(t,{candidateSql:''}); await db.exec(change);
    await assert.rejects(db.exec(await readFile(supplement,'utf8')),/topic_delivery_publication_prestate_drift/);
    await db.exec('rollback;');
    assert.equal((await db.query("select count(*)::int as n from pg_attribute where attrelid='public.notifications'::regclass and attname='alert_suppressed_at' and not attisdropped")).rows[0].n,0);
  });
});

test('publication selfcheck rejects an actual omitted ADD TABLE and rolls back',async t=>{
  const db=await scoped(t,{candidateSql:''}),source=await readFile(supplement,'utf8');
  const statement='ALTER PUBLICATION supabase_realtime ADD TABLE public.topic_notification_preferences;';
  assert.equal(source.split(statement).length,2,'one actual loaded publication mutation');
  await assert.rejects(db.exec(source.replace(statement,'')),/topic_delivery_publication_selfcheck_failed/);
  await db.exec('rollback;');
  const rows=await publicationSnapshot(db);
  assert.deepEqual(rows[0].tables,['public.notifications','public.topics']);
});

async function generalInsertTerminal(t,options={}) {
  const db=await scoped(t,options);
  await db.exec(`delete from public.topics where id='${general}';`);
  await sendFixtureMessage(db,160,{topicId:null}); const own=await notification(db,id(160));
  await db.exec(`insert into public.topics(id,chat_id,is_general,archived) values('${id(161)}','${chat}',true,true);
    delete from public.topics where id='${id(161)}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,false,'archived general INSERT then DELETE must never revive the old null admission');
  assert.deepEqual((await db.query(`select read_at,alert_suppressed_at is not null as terminal from public.notifications where id='${own}'`)).rows,[{read_at:null,terminal:true}]);
}
test('source repair: archived general INSERT DELETE is irreversible without an intervening recheck',t=>generalInsertTerminal(t));

async function membershipTerminal(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,162); const own=await notification(db,id(162));
  const joined=(await db.query(`select joined_at::text as value from public.chat_members where chat_id='${chat}' and user_id='${user}'`)).rows[0].value;
  await db.exec(`delete from public.chat_members where chat_id='${chat}' and user_id='${user}';
    insert into public.chat_members(chat_id,user_id,joined_at) values('${chat}','${user}',${quote(joined)});`);
  assert.equal((await decisions(db,[own]))[0].allowed,false,'membership loss must remain terminal even when the same joined_at is restored');
  await sendFixtureMessage(db,163);
  assert.equal((await decisions(db,[await notification(db,id(163))]))[0].allowed,true,'fresh admission after rejoin remains usable');
}
test('source repair: member DELETE rejoin cannot revive the old pending admission',t=>membershipTerminal(t));

async function historyUntouched(t,options={}) {
  const db=await scoped(t,options);
  for(let i=0;i<4;i++) await db.exec(`insert into public.album_push_groups(id,user_id,chat_id,sender_kind,sender_id,album_id,
    expected_count,observed_count,first_at,last_at,ready_at,topic_alert_suppressed_at)
    values('${id(170+i)}','${user}','${chat}','user','${id(3)}','history-album-${170+i}',2,2,
      now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',${i<2?'clock_timestamp()':'null'});`);
  await sendFixtureMessage(db,174,{albumIndex:0}); await sendFixtureMessage(db,175,{albumIndex:1});
  const live=(await db.query(`select id from public.album_push_groups where user_id='${user}' and album_id='fixture-album-1234'`)).rows[0].id;
  await db.exec(`create table public.fixture_group_writes(group_id uuid);
    grant insert on public.fixture_group_writes to postgres;
    create function public.fixture_group_write() returns trigger language plpgsql security definer as $probe$
    begin insert into public.fixture_group_writes values(new.id); return new; end $probe$;
    create trigger fixture_group_write after update on public.album_push_groups for each row execute function public.fixture_group_write();`);
  await sendFixtureMessage(db,176); const c=await single(db); await recheck(db,c);
  await decisions(db,[await notification(db,id(176))]);
  const a=await claimFixtureTarget(db,'public.notifications_album_push_outbox',`subscription_id='${id(50)}'`);
  assert.equal((await db.query(`select * from public.album_push_recheck('${a.id}','${a.token}')`)).rows[0].status,'deliver');
  assert.equal((await db.query(`select count(*)::int as n from public.fixture_group_writes where group_id in ('${id(170)}','${id(171)}','${id(172)}','${id(173)}')`)).rows[0].n,0,'hot paths must not touch unrelated historical groups');
  await choice(db,'disabled'); await choice(db,'enabled',1);
  assert.equal((await db.query(`select count(*)::int as n from public.fixture_group_writes where group_id='${live}'`)).rows[0].n,1,'the real live group must terminalize exactly once');
  assert.equal((await db.query(`select count(*)::int as n from public.fixture_group_writes where group_id<>'${live}'`)).rows[0].n,0,'rare scope changes must not rewrite historical groups either');
}
test('source repair: hot paths leave historical groups untouched but reconcile the real target',t=>historyUntouched(t));

async function readAllCapture(db) {
  assert.deepEqual((await db.query(`select p.proowner::regrole::text as owner,p.prosecdef as definer,l.lanname as language,
    p.proconfig as settings,p.provolatile::text as volatility,octet_length(pg_get_functiondef(p.oid)) as bytes,
    encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') as sha256
    from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='public.notifications_mark_all_read()'::regprocedure`)).rows,
  [{owner:'postgres',definer:true,language:'plpgsql',settings:['search_path=public'],volatility:'v',bytes:423,
    sha256:'cbf5a03bd43fd7f886412d877b0763a4ca21cd911a0b266311cdd60fc2620977'}]);
  assert.deepEqual((await db.query(`select coalesce(r.rolname,'PUBLIC') as role,a.privilege_type as privilege,a.is_grantable as grantable
    from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee
    where p.oid='public.notifications_mark_all_read()'::regprocedure order by 1,2`)).rows,
  ['authenticated','postgres','service_role'].map(role=>({role,privilege:'EXECUTE',grantable:false})));
}

test('PG17 read-all repair: captured DDL ACL and actual own-only unauthenticated/read behavior',{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const db=await scoped(t); await readAllCapture(db); await sendFixtureMessage(db,200);
  const w=await single(db),n=await single(db,'notifications_native_push_outbox');
  await db.exec(`select set_config('request.jwt.claims','{}',false);`);
  await assert.rejects(authenticated(db,'select public.notifications_mark_all_read()'),error=>{assert.equal(error.code,'28000');return true;});
  await fullClaims(db); await authenticated(db,'select public.notifications_mark_all_read()');
  assert.deepEqual((await db.query(`select user_id,read_at is not null as read,alert_suppressed_at is not null as terminal
    from public.notifications order by user_id`)).rows,
  [{user_id:user,read:true,terminal:false},{user_id:other,read:false,terminal:false}]);
  assert.equal((await recheck(db,w)).rows[0].status,'read');
  assert.equal((await recheck(db,n,true)).rows[0].status,'read');
});

async function readAllInterleaving(t,denied,options={}) {
  const db=await scoped(t,options); await readAllCapture(db);
  await sendFixtureMessage(db,190,{albumIndex:0}); await sendFixtureMessage(db,191,{albumIndex:1});
  const group=(await db.query(`select id from public.album_push_groups where user_id='${user}'`)).rows[0].id;
  const notes=(await db.query(`select id from public.notifications where user_id='${user}' order by id`)).rows.map(r=>r.id);
  assert.equal(notes.length,2); const [low,high]=notes;
  const target=await claimFixtureTarget(db,'public.notifications_album_push_outbox',`group_id='${group}' and subscription_id='${id(50)}'`);
  // The captured RPC has an unordered UPDATE. Force its heap scan in reverse
  // UUID order instead of making the production RPC obey our group ordering.
  await db.exec(`create index fixture_read_all_reverse on public.notifications(id desc);
    cluster public.notifications using fixture_read_all_reverse;`);
  assert.deepEqual((await db.query(`select id from public.notifications where user_id='${user}' order by ctid`)).rows.map(r=>r.id),[high,low]);
  if(denied) await db.exec(`insert into public.user_blocks values('${user}','${id(3)}');`);
  const reader=db.session(),reconciler=db.session();
  const readerPid=Number(await reader.send('select pg_backend_pid();')),pid=Number(await reconciler.send('select pg_backend_pid();'));
  await reader.send(`begin; set local deadlock_timeout='100ms'; set local statement_timeout='5s';
    set local enable_seqscan=on; set local enable_indexscan=off; set local enable_bitmapscan=off;
    select id from public.notifications where id='${high}' for update;`);
  await assert.rejects(db.query(`select id from public.notifications where id='${high}' for update nowait`),/55P03/);
  let finished=false,waited=false;
  const reconciliation=reconciler.send(`begin; set local deadlock_timeout='100ms'; set local statement_timeout='5s';
    select private.topic_alert_reconcile_group('${group}');`).then(value=>{finished=true;return {value};},error=>{finished=true;return {error};});
  for(let i=0;i<40&&!finished;i++) {
    const row=(await db.query(`select wait_event='transactionid' as waiting,${readerPid}=any(pg_blocking_pids(pid)) as reader_blocks
      from pg_stat_activity where pid=${pid}`)).rows[0];
    if(row?.waiting) {assert.equal(row.reader_blocks,true);waited=true;break;}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(!finished) {
    assert.equal(waited,true,'the blocking mutant must actually wait on the reader');
    await assert.rejects(db.query(`select id from public.notifications where id='${low}' for update nowait`),/55P03/,
      'the reconciler must own the reverse-order row before the real read-all call');
  }
  const reading=reader.send(`${claims()} set local role authenticated;
    select public.notifications_mark_all_read(); commit;`).then(value=>({value}),error=>({error}));
  const update=await reconciliation;
  if(update.error) await reconciler.send('rollback;').catch(()=>{});
  else await reconciler.send(denied?'rollback;':'commit;');
  const read=await reading;
  if(read.error) throw read.error;
  if(denied) {
    if(update.error?.code!=='55P03') throw update.error||Error('denied reconciliation must refuse on the locked notification');
  } else if(update.error) throw update.error;
  assert.deepEqual((await db.query(`select user_id,count(*)::int as n,count(read_at)::int as read,
    count(alert_suppressed_at)::int as terminal from public.notifications group by user_id order by user_id`)).rows,
  [{user_id:user,n:2,read:2,terminal:0},{user_id:other,n:2,read:0,terminal:0}]);
  assert.equal((await db.query(`select topic_alert_suppressed_at from public.album_push_groups where id='${group}'`)).rows[0].topic_alert_suppressed_at,null);
  assert.equal((await db.query(`select claim_token='${target.token}'::uuid as retained from public.notifications_album_push_outbox where id='${target.id}'`)).rows[0].retained,true);
  if(denied) await db.exec(`delete from public.user_blocks where blocker_id='${user}' and blocked_id='${id(3)}';`);
  assert.equal((await db.query(`select * from public.album_push_recheck('${target.id}','${target.token}')`)).rows[0].status,'read');
}

for(const denied of [false,true]) test(`PG17 read-all repair: actual reverse-order RPC and ${denied?'denied':'allowed'} album preserve read and atomic effects`,
  {skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},t=>readAllInterleaving(t,denied));

test('PG17 read-all omission: blocking notification write restores the real reverse-order deadlock',{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const source=await readFile(supplement,'utf8'),before='PERFORM 1 FROM public.notifications WHERE id=p_notification FOR UPDATE NOWAIT;';
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>readAllInterleaving(t,true,{candidateSql:source.replace(before,before.replace(' NOWAIT',''))}),error=>{
    assert.equal(error.code,'40P01');return true;
  });
});

test('PG17 read-all omission: removing the allowed-note fast path creates a needless row conflict',{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const source=await readFile(supplement,'utf8');
  const before="  IF NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=p_notification\n    AND n.kind='message' AND n.alert_suppressed_at IS NULL\n    AND NOT private.notification_topic_alert_allowed(n.id)) THEN RETURN; END IF;\n";
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>readAllInterleaving(t,false,{candidateSql:source.replace(before,'')}),error=>{
    assert.equal(error.code,'55P03');return true;
  });
});

for(const channel of ['web','native','album','bound descriptor','bound outbox']) test(`PG17 downstream repair: ${channel} contention refuses NOWAIT without effects`,{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const db=await scoped(t),album=channel==='album';
  await sendFixtureMessage(db,192,album?{albumIndex:0}:{});
  if(album) await sendFixtureMessage(db,193,{albumIndex:1});
  const table=album?'notifications_album_push_outbox':channel==='native'?'notifications_native_push_outbox':'notifications_push_outbox';
  const c=album?await claimFixtureTarget(db,`public.${table}`,`subscription_id='${id(50)}'`):await single(db,table);
  const call=channel.startsWith('bound')?await boundCall(db,c):
    album?`select * from public.album_push_recheck('${c.id}','${c.token}');`:
      `select public.${channel==='native'?'native_':''}push_outbox_delivery_recheck('${c.id}','${c.token}');`;
  const holder=db.session(),contender=db.session();
  await holder.send(`begin; select id from public.${channel==='bound descriptor'?'push_subscriptions':table}
    where id='${channel==='bound descriptor'?id(50):c.id}' for update;`);
  try {
    await assert.rejects(contender.send(`set statement_timeout='1s'; ${call}`),error=>{
      assert.equal(error.code,'55P03','a post-barrier target row conflict must refuse immediately, not wait'); return true;
    });
    assert.equal((await db.query(`select claim_token='${c.token}'::uuid as retained from public.${table} where id='${c.id}'`)).rows[0].retained,true);
  } finally {await holder.send('commit;');}
});

async function topicParentInterleaving(t,options={},parentOperation=null) {
  const db=await scoped(t,options); await sendFixtureMessage(db,177);
  const table=parentOperation?'chat_notification_preferences':'topics';
  const predicate=parentOperation?`chat_id='${chat}' and user_id='${user}'`:`id='${topic}'`;
  if(parentOperation) await db.exec(`insert into public.chat_notification_preferences values('${chat}','${user}',true,null);`);
  assert.equal((await db.query(`select confdeltype='c' as cascade from pg_constraint where conrelid='public.${table}'::regclass and confrelid='public.chats'::regclass and contype='f'`)).rows[0].cascade,true);
  const a=db.session(),b=db.session(),pid=Number(await b.send('select pg_backend_pid();'));
  await b.send(`begin; set local deadlock_timeout='100ms'; set local statement_timeout='5s'; select 1 from public.${table} where ${predicate} for update;`);
  await a.send(`begin; set local deadlock_timeout='100ms'; set local statement_timeout='5s'; select id from public.chats where id='${chat}' for update;`);
  let updated=false,updateError;
  const mutation=parentOperation==='DELETE'?`delete from public.${table} where ${predicate};`:
    parentOperation?`update public.${table} set push_enabled=false where ${predicate};`:`update public.topics set archived=true where id='${topic}';`;
  const update=b.send(mutation).then(value=>{updated=true;return {value};},error=>{updated=true;updateError=error;return {error};});
  for(let i=0;i<40&&!updated;i++) {
    const rows=(await db.query(`select wait_event='transactionid' as waiting from pg_stat_activity where pid=${pid}`)).rows;
    if(rows[0]?.waiting) break;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(updateError) {await a.send('rollback;'); throw updateError;}
  await assert.rejects(db.query(`select 1 from public.${table} where ${predicate} for update nowait`),/55P03/,'the updater must actually own the FK child before parent deletion');
  const deletion=a.send(`delete from public.chats where id='${chat}';`).then(value=>({value}),error=>({error}));
  const first=await Promise.race([update.then(result=>({side:'update',...result})),deletion.then(result=>({side:'delete',...result}))]);
  if(first.error) {
    if(first.side==='update') {await b.send('rollback;').catch(()=>{}); await deletion; await a.send('rollback;').catch(()=>{});}
    else {await a.send('rollback;').catch(()=>{}); await update; await b.send('rollback;').catch(()=>{});}
    throw first.error;
  }
  if(first.side==='delete') {
    await a.send('commit;'); const result=await update;
    await b.send(result.error?'rollback;':'commit;').catch(error=>{if(!result.error) throw error;});
    if(result.error) throw result.error;
    assert.fail('source UPDATE must finish without waiting for the locked parent');
  }
  await b.send('commit;'); const removed=await deletion;
  if(removed.error) {await a.send('rollback;'); throw removed.error;}
  await a.send('commit;');
  assert.equal((await db.query(`select count(*)::int as n from public.${table} where chat_id='${chat}'`)).rows[0].n,0);
}
test('PG17 source repair: real topic FK cascade and source UPDATE do not deadlock',{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},t=>topicParentInterleaving(t));

for(const operation of ['UPDATE','DELETE']) test(`PG17 downstream repair: direct parent preference ${operation} and real chat FK cascade do not deadlock`,{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},t=>topicParentInterleaving(t,{},operation));

for(const operation of ['UPDATE','DELETE']) test(`PG17 downstream repair omission: blocking parent hook ${operation} restores the FK deadlock`,{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const source=await readFile(supplement,'utf8'),before="PERFORM private.topic_alert_source_lock(r.u,r.c);\n    IF TG_WHEN='AFTER'";
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>topicParentInterleaving(t,{candidateSql:source.replace(before,"PERFORM private.topic_alert_lock(r.u,r.c);\n    IF TG_WHEN='AFTER'")},operation),error=>{
    assert.equal(error.code,'40P01'); return true;
  });
});

test('PG17 source repair omission: parent locking after the FK child exposes a real deadlock',{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const source=await readFile(supplement,'utf8'),before='PERFORM private.topic_alert_source_lock(r.u,r.c);\n  END LOOP;';
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>topicParentInterleaving(t,{candidateSql:source.replace(before,'PERFORM private.topic_alert_lock(r.u,r.c);\n  END LOOP;')}),error=>{
    assert.equal(error.code,'40P01'); return true;
  });
});

for(const held of ['barrier','outbox']) test(`PG17 source repair: busy ${held} rolls back the whole source mutation then retry terminalizes`,{skip:!process.env.LETSCUBE_TOPIC_PG17_DRIVER},async t=>{
  const db=await scoped(t); await sendFixtureMessage(db,180); const own=await notification(db,id(180));
  const w=await single(db),n=await single(db,'notifications_native_push_outbox'),actor=db.session();
  assert.equal((await recheck(db,w)).rows[0].status,'deliver');
  await actor.send(`begin; ${held==='barrier'?`select private.topic_notification_lock('${user}','${chat}');`:
    `select id from public.notifications_push_outbox where id='${w.id}' for update;`}`);
  await assert.rejects(db.exec(`update public.topics set archived=true where id='${topic}';`),error=>{
    assert.equal(error.code,held==='barrier'?'40001':'55P03'); return true;
  });
  assert.deepEqual((await db.query(`select t.archived,n.alert_suppressed_at from public.topics t,public.notifications n
    where t.id='${topic}' and n.id='${own}'`)).rows,[{archived:false,alert_suppressed_at:null}]);
  await actor.send('commit;');
  await db.exec(`update public.topics set archived=true where id='${topic}'; update public.topics set archived=false where id='${topic}';`);
  assert.equal((await decisions(db,[own]))[0].allowed,false);
  assert.notEqual((await recheck(db,w)).rows[0].status,'deliver');
  assert.notEqual((await recheck(db,n,true)).rows[0].status,'deliver');
});

async function reclassifiedTerminal(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,181); const own=await notification(db,id(181));
  const w=await single(db),n=await single(db,'notifications_native_push_outbox');
  await db.exec(`set role postgres; update public.notifications set kind='task_assigned' where id='${own}'; reset role;`);
  assert.equal((await db.query(`select alert_suppressed_at is not null as terminal from public.notifications where id='${own}'`)).rows[0].terminal,true);
  assert.notEqual((await recheck(db,w)).rows[0].status,'deliver','reclassified terminal message must not escape through the Web nonmessage branch');
  assert.notEqual((await recheck(db,n,true)).rows[0].status,'deliver','reclassified terminal message must not escape through the native nonmessage branch');
  await db.exec(`insert into public.notifications(id,user_id,kind,payload) values('${id(182)}','${user}','task_assigned','{"task_id":"fictional"}');`);
  assert.equal((await db.query(`select alert_suppressed_at from public.notifications where id='${id(182)}'`)).rows[0].alert_suppressed_at,null);
  const fresh=await claimFixtureTarget(db,'public.notifications_push_outbox',`notification_id='${id(182)}'`);
  assert.equal((await recheck(db,fresh)).rows[0].status,'deliver','new nonmessage notification retains its existing behavior');
}
test('source repair: terminal identity cannot escape through notification kind reclassification',t=>reclassifiedTerminal(t));

for(const channel of ['Web','native']) test(`source repair actual loaded SQL omission fails: ${channel} kind-independent terminal marker`,async t=>{
  const source=await readFile(supplement,'utf8'),table=channel==='Web'?'notifications_push_outbox':'notifications_native_push_outbox';
  const before=`FROM public.${table} o JOIN public.notifications n ON n.id=o.notification_id WHERE o.id=p_outbox_id AND n.alert_suppressed_at IS NULL AND (v_kind<>''message''`;
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>reclassifiedTerminal(t,{candidateSql:source.replace(before,before.replace('n.alert_suppressed_at IS NULL AND ',''))}),error=>{
    assert.equal(error.code,'ERR_ASSERTION'); assert.equal(error.message.split('\n')[0],`reclassified terminal message must not escape through the ${channel} nonmessage branch`); return true;
  });
});

async function readReopenTerminal(t,options={}) {
  const db=await scoped(t,options); await sendFixtureMessage(db,183); const own=await notification(db,id(183));
  await db.exec(`update public.notifications set read_at=clock_timestamp() where id='${own}';`);
  await choice(db,'disabled'); await choice(db,'enabled',1);
  await db.exec(`update public.notifications set read_at=null where id='${own}';`);
  assert.deepEqual((await db.query(`select read_at,alert_suppressed_at is not null as terminal from public.notifications where id='${own}'`)).rows,[{read_at:null,terminal:true}],'read reopening must terminalize an old admission');
  assert.equal((await decisions(db,[own]))[0].allowed,false);
}
test('source repair: read history cannot reopen an old alert after a missed scope transition',t=>readReopenTerminal(t));
test('source repair actual loaded SQL omission fails: read reopening',async t=>{
  const source=await readFile(supplement,'utf8'),before='(OLD.read_at IS NOT NULL AND NEW.read_at IS NULL)';
  assert.equal(source.split(before).length,2);
  await assert.rejects(()=>readReopenTerminal(t,{candidateSql:source.replace(before,'false')}),error=>{
    assert.equal(error.code,'ERR_ASSERTION'); assert.equal(error.message.split('\n')[0],'read reopening must terminalize an old admission'); return true;
  });
});

for(const [name,before,after,scenario,message] of [
  ['INSERT hook',"IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;","IF TG_OP='INSERT' THEN RETURN NEW; END IF;\n  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;",generalInsertTerminal,'archived general INSERT then DELETE must never revive the old null admission'],
  ['member loss',"IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;","IF TG_TABLE_NAME='chat_members' THEN RETURN OLD; END IF;\n  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;",membershipTerminal,'membership loss must remain terminal even when the same joined_at is restored'],
  ['historical group writes','PERFORM private.topic_alert_mark_locked(p_notification);\n  FOR g',"PERFORM private.topic_alert_mark_locked(p_notification);\n  UPDATE public.album_push_groups SET topic_alert_suppressed_at=topic_alert_suppressed_at WHERE topic_alert_suppressed_at IS NOT NULL;\n  FOR g",historyUntouched,'hot paths must not touch unrelated historical groups'],
]) test(`source repair actual loaded SQL omission fails: ${name}`,async t=>{
  const source=await readFile(supplement,'utf8'); assert.equal(source.split(before).length,2);
  await assert.rejects(()=>scenario(t,{candidateSql:source.replace(before,after)}),error=>{
    assert.equal(error.code,'ERR_ASSERTION'); assert.equal(error.message.split('\n')[0],message); return true;
  });
});
