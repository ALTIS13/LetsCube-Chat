import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import Supabase from '../../node_modules/.pnpm/@supabase+supabase-js@2.105.1/node_modules/@supabase/supabase-js/dist/index.cjs';
import * as executor from './topic-notification-realtime-client.hook.mjs';

const test=(name,fn)=>nodeTest(name,{timeout:5000},fn);
const UID='10000000-0000-4000-8000-000000000001',SID='20000000-0000-4000-8000-000000000001';
const NOTE='30000000-0000-4000-8000-00000000000a',FOREIGN='30000000-0000-4000-8000-000000000002';
const MESSAGE='40000000-0000-4000-8000-000000000001',OTHER_MESSAGE='40000000-0000-4000-8000-000000000002';
const CHAT='50000000-0000-4000-8000-000000000001',SENDER='60000000-0000-4000-8000-000000000001';
const AT='2026-10-18T00:00:01.123456Z',READ='2026-10-18T00:00:02.123456Z',TERMINAL='2026-10-18T00:00:03.123456Z';
const sources=await executor.loadRealtimeClientSources();
const plain=v=>JSON.parse(JSON.stringify(v));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const row=(patch={})=>({id:NOTE,user_id:UID,kind:'message',payload:{message_id:MESSAGE,chat_id:CHAT,
  sender_id:SENDER,sender_kind:'user',bot_id:null,chat_type:'private',sender_name:'Fictional QA',preview:'Fictional'},
  read_at:null,alert_suppressed_at:null,feed_revision:1,created_at:AT,...patch});

// Real Supabase/PostgREST SDK serialization, with controlled fetch and channel/
// socket lifecycle ports. No network, database policy emulator or wire acceptance.
async function fixture(t,{api=executor,initial=[row()],generation='current'}={}) {
  const rows=new Map(initial.map(r=>[r.id,plain(r)])),calls=[],channels=[],opens=[],gates=new Map();
  let connected=true,sequence=0,connects=0,disconnects=0,disconnectGate;
  const page=()=>({v:2,rows:plain([...rows.values()]),next:null});
  const lookup=ids=>({v:2,rows:plain([...rows.values()].filter(r=>ids.includes(r.id))),unavailable_ids:ids.filter(id=>!rows.has(id))});
  const fetch=async(address,init)=>{
    const req=new Request(address,init),url=new URL(req.url);
    assert.equal(url.origin,'http://qa.invalid','no external transport');
    const name=url.pathname.replace('/rest/v1/rpc/','');
    const args=req.method==='POST'?JSON.parse(await req.text()):{};
    calls.push({name,args:plain(args),method:req.method});
    let value;
    if(url.pathname==='/rest/v1/notifications'&&req.method==='GET')value=plain([...rows.values()]);
    else if(name==='notification_feed_page_v2')value=page();
    else if(name==='notification_feed_lookup_v2')value=lookup(args.p_ids);
    else if(name==='notification_feed_open_v2'){
      const marker='70000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');
      value={v:2,barrier_event_id:marker,page:page(),lookup:lookup(args.p_held_ids)};
      opens.push({marker,channel:channels.at(-1)});
    }else if(name==='notifications_mark_read')value=null;
    else if(name==='message_notification_alert_decisions')value=args.p_notification_ids.map(id=>({notification_id:id,allowed:false,scope_key:'general',revision:0}));
    else throw Error('UNEXPECTED_CONTROLLED_REQUEST');
    await gates.get(name)?.shift()?.promise;
    return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  };
  const client=Supabase.createClient('http://qa.invalid','fictional-qa-key',{
    accessToken:async()=> 'fictional-qa-access-token',global:{fetch},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  client.channel=name=>{
    const ch={name,state:'joining',handlers:[],active:true,
      on(kind,filter,callback){ch.handlers.push({kind,filter,callback});return ch;},
      subscribe(callback){ch.status=callback;return ch;}};
    channels.push(ch);return ch;
  };
  client.removeChannel=async ch=>{ch.active=false;ch.state='closed';ch.status?.('CLOSED');return 'ok';};
  client.realtime={isConnected:()=>connected,async setAuth(){},
    async disconnect(){disconnects++;connected=false;for(const ch of channels.filter(c=>c.active)){ch.state='closed';ch.status('CLOSED');}await disconnectGate?.promise;},
    connect(){connects++;connected=true;}};
  const doc=await api.mountRealtimeClientHook({generation,desktop:false,sources,client,actor:{uid:UID,sid:SID}});
  t.after(()=>doc.close());
  return {doc,rows,calls,channels,opens,
    hold(name){const d=deferred();gates.set(name,[...(gates.get(name)??[]),d]);return d;},
    holdDisconnect(){return disconnectGate=deferred();},
    get connects(){return connects;},get disconnects(){return disconnects;},
    join(ch=channels.at(-1)){ch.state='joined';ch.status('SUBSCRIBED');},
    status(status,ch=channels.at(-1)){ch.state=status==='SUBSCRIBED'?'joined':'closed';ch.status(status);},
    deliver(event,ch=channels.at(-1)){for(const h of ch.handlers)if(h.filter.table==='notification_feed_events_v2')h.callback({new:event});},
    marker(open=opens.at(-1)){this.deliver({event_id:open.marker,recipient_id:UID,notification_id:null,event_kind:'invalidate',created_at:AT},open.channel);},
  };
}
async function flush(doc){for(let i=0;i<8;i++){await doc.drain();await new Promise(resolve=>setImmediate(resolve));}}
async function ready(f){f.join();await flush(f.doc);if(f.opens.length)f.marker();await flush(f.doc);assert.equal(f.doc.snapshot().ready,true);}
function controls(doc){for(const name of ['messageRows','markRead','reconnect','setVisibility','connectionRevived'])assert.equal(typeof doc[name],'function','missing '+name);}
const exact=(read_at=null,alert_suppressed_at=null,feed_revision=1)=>[{id:NOTE,user_id:UID,message_id:MESSAGE,read_at,alert_suppressed_at,feed_revision}];

async function observation(t,api=executor){
  const f=await fixture(t,{api});await ready(f);controls(f.doc);
  assert.deepEqual(f.doc.messageRows(MESSAGE),exact());
  f.rows.set(NOTE,row({read_at:READ,alert_suppressed_at:TERMINAL,feed_revision:7}));
  await f.doc.setVisibility('hidden');await flush(f.doc);
  assert.deepEqual(f.doc.messageRows(MESSAGE),exact(),'hidden is not refresh authority');
  await f.doc.setVisibility('visible');await flush(f.doc);
  const observed=f.doc.messageRows(MESSAGE);assert.deepEqual(observed,exact(READ,TERMINAL,7));
  assert.equal(Object.isFrozen(observed),true);assert.equal(Object.isFrozen(observed[0]),true);
  assert.equal('payload' in observed[0],false);assert.deepEqual(f.doc.messageRows(OTHER_MESSAGE),[]);
}
test('exact message observation follows actual hook read/terminal/revision and real visibility refresh',observation);

async function marking(t,api=executor){
  const f=await fixture(t,{api});await ready(f);controls(f.doc);
  f.rows.set(NOTE,row({read_at:READ,feed_revision:2}));const held=f.hold('notification_feed_page_v2');
  let done=false;const write=f.doc.markRead({notificationId:NOTE,messageId:MESSAGE}).then(()=>{done=true;});
  await flush(f.doc);
  try{
    assert.deepEqual(f.calls.filter(c=>c.name==='notifications_mark_read').map(c=>c.args),[{p_id:NOTE}]);
    assert.equal(done,false);assert.deepEqual(f.doc.messageRows(MESSAGE),exact(),'ACK is not a row');
  }finally{held.resolve();await write;}
  await flush(f.doc);assert.deepEqual(f.doc.messageRows(MESSAGE),exact(READ,null,2));
}
test('markRead calls actual hook/SDK exact-ID RPC and waits for authoritative read reconciliation',marking);

async function readGuards(t,api=executor){
  const f=await fixture(t,{api});await ready(f);controls(f.doc);
  for(const target of [{notificationId:FOREIGN,messageId:MESSAGE},{notificationId:NOTE,messageId:OTHER_MESSAGE},
    {notificationId:NOTE.toUpperCase(),messageId:MESSAGE},{notificationId:NOTE,messageId:MESSAGE,all:true}]){
    await assert.rejects(()=>f.doc.markRead(target),/RT_CLIENT_HOOK_CONTROL_REFUSED/);
  }
  await assert.rejects(()=>f.doc.markRead({notificationId:'invalid',messageId:MESSAGE}),/RT_CLIENT_HOOK_CONTROL_REFUSED/);
  assert.equal(f.calls.some(c=>c.name==='notifications_mark_read'),false);
  f.doc.close();await assert.rejects(()=>f.doc.markRead({notificationId:NOTE,messageId:MESSAGE}),/RT_CLIENT_HOOK_CONTROL_REFUSED/);
  assert.deepEqual(f.doc.messageRows(MESSAGE),[]);
}
test('read control refuses unknown/foreign/mismatched IDs, extra scope and closed document before RPC',readGuards);

async function recovery(t,api=executor){
  const f=await fixture(t,{api});await ready(f);controls(f.doc);const old=f.channels[0],first=f.opens[0];
  f.status('CLOSED',old);await flush(f.doc);
  assert.equal(f.doc.snapshot().failed,true,'legacy default remains strict');
  assert.equal(f.doc.snapshot().unexpectedChannelFailures,1);
  await f.doc.reconnect();assert.equal(f.connects,1);assert.equal(f.disconnects,1);
  assert.equal(f.doc.snapshot().ready,false);
  f.join();await flush(f.doc);f.status('SUBSCRIBED',old);f.marker(first);await flush(f.doc);
  assert.equal(f.doc.snapshot().ready,false,'retired channel/marker cannot complete successor');
  f.marker();await flush(f.doc);
  const snap=f.doc.snapshot();assert.equal(snap.ready,true);assert.equal(snap.failed,false);
  assert.equal(snap.activeChannels,1);assert.equal(snap.unexpectedChannelFailures,1);
  assert.ok(snap.channelFailures.CLOSED>=1);assert.equal(snap.sounds,0);assert.equal(snap.cards,0);
}
test('same-document explicit reconnect recovers only after fresh marker and retains failure counters',recovery);

test('channel errors and timeouts remain observable after explicit recovery, without fatal reset',async t=>{
  for(const status of ['CHANNEL_ERROR','TIMED_OUT']){
    const f=await fixture(t);await ready(f);f.status(status);await flush(f.doc);
    assert.equal(f.doc.snapshot().failed,true);assert.equal(f.doc.snapshot().channelFailures[status],1);
    await f.doc.connectionRevived();f.join();await flush(f.doc);f.marker();await flush(f.doc);
    assert.equal(f.doc.snapshot().ready,true);assert.equal(f.doc.snapshot().failed,false);
    assert.equal(f.doc.snapshot().channelFailures[status],1);assert.equal(f.doc.snapshot().unexpectedChannelFailures,1);
  }
});

async function laterFailure(t,api=executor,{status='TIMED_OUT',when='during'}={}){
  const f=await fixture(t,{api});await ready(f);controls(f.doc);
  if(when==='during')await f.doc.connectionRevived();else await f.doc.reconnect();
  if(when==='after'){f.join();await flush(f.doc);f.marker();await flush(f.doc);assert.equal(f.doc.snapshot().ready,true);}
  const count=f.channels.length;f.status(status);await flush(f.doc);
  const until=Date.now()+1800;
  while(f.channels.length===count&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.channels.length,count+1,'actual hook automatic retry must run, not a new explicit recovery');
  f.join();await flush(f.doc);f.marker();await flush(f.doc);
  const blocked=f.doc.snapshot();
  assert.equal(blocked.failed,true,'new unexpected failure must not inherit an older recovery permit');
  assert.equal(blocked.ready,false);assert.equal(blocked.unexpectedChannelFailures,1);
  assert.ok(blocked.channelFailures[status]>=1);
  await f.doc.setVisibility('visible');await flush(f.doc);
  assert.equal(f.doc.snapshot().failed,true,'ordinary visibility cannot renew transport recovery authority');
  await f.doc.connectionRevived();f.join();await flush(f.doc);f.marker();await flush(f.doc);
  assert.equal(f.doc.snapshot().failed,false);assert.equal(f.doc.snapshot().ready,true);
  assert.equal(f.doc.snapshot().unexpectedChannelFailures,1,'new intent never clears failure evidence');
}
for(const status of ['TIMED_OUT','CHANNEL_ERROR'])for(const when of ['during','after'])
  test(`new ${status} ${when} explicit recovery cannot be auto-accepted`,t=>laterFailure(t,executor,{status,when}));
test('new active-channel CLOSED after explicit recovery is not an expected old-channel close',t=>laterFailure(t,executor,{status:'CLOSED',when:'after'}));

async function expectedClose(t,api=executor){
  const f=await fixture(t,{api,generation:'old'});await ready(f);await f.doc.reconnect();
  f.join();await flush(f.doc);
  assert.equal(f.doc.snapshot().ready,true);assert.equal(f.doc.snapshot().unexpectedChannelFailures,0);
  assert.ok(f.doc.snapshot().channelFailures.CLOSED>=1);
  f.status('CLOSED');await flush(f.doc);
  assert.equal(f.doc.snapshot().failed,true);assert.equal(f.doc.snapshot().unexpectedChannelFailures,1);
}
test('explicit disconnect permits old legacy-channel CLOSED only until disconnect settles',expectedClose);

async function revival(t,api=executor){
  const f=await fixture(t,{api});await ready(f);controls(f.doc);
  const before=f.doc.snapshot().barrierEventId;await f.doc.connectionRevived();
  assert.equal(f.channels.length,2,'actual product listener must reopen');
  f.join();await flush(f.doc);assert.equal(f.doc.snapshot().ready,false);f.marker();await flush(f.doc);
  assert.equal(f.doc.snapshot().ready,true);assert.notEqual(f.doc.snapshot().barrierEventId,before);
  assert.equal(f.doc.snapshot().openCount,2);assert.equal(f.doc.snapshot().sounds,0);
}
test('connection-revived dispatches actual module event and quietly reopens the same hook lifetime',revival);

async function lateOpen(t,api=executor){
  const f=await fixture(t,{api});controls(f.doc);const held=f.hold('notification_feed_open_v2');
  f.join();await flush(f.doc);const original=f.opens[0];
  await f.doc.connectionRevived();f.join();await flush(f.doc);f.marker();await flush(f.doc);
  const fresh=f.opens.at(-1).marker;assert.equal(f.doc.snapshot().ready,true);
  held.resolve();await flush(f.doc);f.marker(original);await flush(f.doc);
  assert.equal(f.doc.snapshot().barrierEventId,fresh,'late old RPC may not overwrite current marker');
  assert.equal(f.doc.snapshot().ready,true);assert.deepEqual(f.doc.messageRows(MESSAGE),exact());
}
test('late retired open response/marker cannot poison the recovered document observation',lateOpen);

async function closedReconnect(t,api=executor){
  const f=await fixture(t,{api});await ready(f);controls(f.doc);const held=f.holdDisconnect();
  const reconnect=f.doc.reconnect();await flush(f.doc);f.doc.close();held.resolve();
  await assert.rejects(()=>reconnect,/RT_CLIENT_HOOK_CONTROL_REFUSED/);
  assert.equal(f.connects,0,'closed continuation must not reconnect SDK');
  await assert.rejects(()=>f.doc.connectionRevived(),/RT_CLIENT_HOOK_CONTROL_REFUSED/);
  await assert.rejects(()=>f.doc.setVisibility('visible'),/RT_CLIENT_HOOK_CONTROL_REFUSED/);
}
test('closing during held disconnect fences reconnect continuation and all future controls',closedReconnect);

test('old hook API remains mountable and source admission pins control API without weakening immutable old hashes',async t=>{
  assert.deepEqual(sources.pins.executorApi,{v:1,methods:['messageRows','markRead','reconnect','setVisibility','connectionRevived']});
  const f=await fixture(t,{generation:'old'});await ready(f);controls(f.doc);
  assert.equal(f.doc.hasMessage(MESSAGE),true);assert.deepEqual(f.doc.messageRows(MESSAGE),exact());
  const forged=structuredClone(sources);forged.old['hooks/useNotifications.ts']+='\n// changed';
  forged.pins.old['hooks/useNotifications.ts']=createHash('sha256').update(forged.old['hooks/useNotifications.ts']).digest('hex');
  const digest=pins=>createHash('sha256').update(JSON.stringify(pins,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)
    ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)).digest('hex');
  forged.digest=digest(forged.pins);
  assert.throws(()=>executor.validateRealtimeClientSources(forged),/RT_CLIENT_SOURCE_REFUSED/);
  const stale=structuredClone(sources);delete stale.pins.executorApi;stale.digest=digest(stale.pins);
  assert.throws(()=>executor.validateRealtimeClientSources(stale),/RT_CLIENT_SOURCE_REFUSED/);
});

const moduleUrl=new URL('./topic-notification-realtime-client.hook.mjs',import.meta.url);
async function mutant(from,to){
  let text=(await readFile(moduleUrl,'utf8')).replaceAll('\r\n','\n');
  assert.equal(text.split(from).length,2,'one executed executor anchor');text=text.replace(from,()=>to);
  const require=createRequire(import.meta.url);
  text=text.replace("from 'typescript'",()=>`from '${pathToFileURL(require.resolve('typescript')).href}'`)
    .replace("const ROOT=new URL('../../',import.meta.url)",()=>`const ROOT=new URL('${new URL('../../',import.meta.url).href}')`);
  return import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
}
for(const [name,from,to,oracle] of [
  ['read observation','read_at:row.read_at','read_at:null',observation],
  ['terminal observation','alert_suppressed_at:row.alert_suppressed_at','alert_suppressed_at:null',observation],
  ['revision observation','feed_revision:row.feed_revision','feed_revision:1',observation],
  ['exact notification guard','row.id===notificationId&&','true&&',readGuards],
  ['actual hook read action','await view.markRead(notificationId);','await Promise.resolve();',marking],
  ['retired channel removal','statuses.delete(channel);','',recovery],
  ['explicit recovery release','transportFailed&&!(recoveryPermitted()&&ready)','transportFailed',recovery],
  ['new failure baseline fence','recoveryFailureBaseline===unexpectedChannelFailures','recoveryFailureBaseline!==null',laterFailure],
  ['expected close old-channel scope','expectedDisconnectChannels.has(channel)','true',(t,api)=>laterFailure(t,api,{status:'CLOSED',when:'after'})],
  ['expected close disconnect window','expectedDisconnectChannels.clear();','',expectedClose],
  ['revived event dispatch','window.dispatchEvent({type:revivedEvent});','',revival],
  ['open lifetime fence','epoch===subscriptionGeneration&&','true&&',lateOpen],
  ['post-disconnect owner guard','await client.realtime.disconnect();controlCurrent();','await client.realtime.disconnect();',closedReconnect],
])test('loaded omission mutant is killed: '+name,async t=>{
  const api=await mutant(from,to);
  await assert.rejects(()=>oracle(t,api),e=>e?.name==='AssertionError','must fail behavioral assertion, not setup/admission');
});
