import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const url=new URL('./topic-notification-realtime-client.helper.mjs',import.meta.url);
const helper=existsSync(url)?await import(url.href):{};
const id=n=>'70000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sha=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function binding(sourceDigest='9'.repeat(64)) {
  return {v:1,recoveryProofSha256:'2441c65f68a6ad9fd5bd35444102fbe4b4d9552355b733cd364f2efa6353a878',sourceDigest,candidateCatalogSha256:'4'.repeat(64),
    executionNamespace:'net:[70001]',postgres:{postmaster:'2026-10-17T00:00:00.000Z',walLevel:'logical'},
    http:{v:1,owner:'topic-alerts-fullstack-20261017-r5',sourceContainerId:'a'.repeat(64),
      target:{containerId:'b'.repeat(64),image:'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00',
        startedAt:'2026-10-17T00:00:00.000000000Z',cluster:'7000000000000000001',postgrestPid:42,postgrestStartTicks:'100',
        postgrestBinarySha256:'c'.repeat(64),postgrestConfigSha256:'d'.repeat(64),httpPort:3000,network:'none',publishedPorts:[],productionMounts:[]},
      sourceCatalogSha256:'e'.repeat(64),restoreCatalogSha256:'e'.repeat(64),candidateDigest:'f'.repeat(64),rollbackDigest:'0'.repeat(64),
      fixture:{chatId:id(110),topicId:id(120),enabledTopicId:id(121),generalTopicId:id(122),
        actors:{a:{uid:id(101),sid:id(130)},a2:{uid:id(101),sid:id(131)},oldA:{uid:id(101),sid:id(132)},b:{uid:id(102),sid:id(133)}}}},
    realtime:{containerId:'1'.repeat(64),imageId:'sha256:'+'2'.repeat(64),
      imageDigest:'sha256:aa1c92c0cf326007563641730ec9da9c60478caa6853887775365fa2c097a471',
      startedAt:'2026-10-17T00:00:01.000Z',pid:80,startTicks:'200',configSha256:'3'.repeat(64),
      tenant:'topic-alerts-fullstack-20261017-r5',port:4000}};
}
function token(b,actor='a',changes={}) {
  const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),who=b.http.fixture.actors[actor];
  return enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:who.uid,session_id:who.sid,role:'authenticated',is_anonymous:false,
    iss:b.http.owner,exp:Math.floor(Date.now()/1000)+850,...changes})+'.fictional_signature';
}
function credentials(b){return {a:token(b),b:token(b,'b')};}
function initialLegacyB(b=binding()){
  const f=b.http.fixture;
  return {id:id(200),user_id:f.actors.b.uid,kind:'chat_added',created_at:'2026-10-17T00:00:00.123456+00:00',read_at:null,
    payload:{actor_id:f.actors.a.uid,chat_id:f.chatId,chat_type:'group',chat_name:'Topic RT QA'},
    alert_origin:null,alert_suppressed_at:null,feed_revision:1};
}

test('new baseline requires an inert real-SDK admission API, never an env fallback',()=>{
  assert.equal(typeof helper.validateRealtimeClientBinding,'function','REALTIME_CLIENT_ADMISSION_REQUIRED');
  assert.equal(typeof helper.runRealtimeClientBaseline,'function');
  assert.equal(typeof helper.loadRealtimeClientSources,'function');
});

test('binding accepts the actual SQL postmaster text without inventing a normalized receipt epoch',()=>{
  const b=binding();b.postgres.postmaster='2026-10-17 12:34:56.123456+00';
  assert.equal(helper.validateRealtimeClientBinding(b).postgres.postmaster,b.postgres.postmaster);
});

test('new RT binding accepts fresh identities, snapshots inputs and never reuses the old parent=false contract',()=>{
  const b=binding(),copy=helper.validateRealtimeClientBinding(b);
  b.http.fixture.chatId=id(999);assert.equal(copy.http.fixture.chatId,id(110));assert.ok(Object.isFrozen(copy.http.fixture));
  assert.throws(()=>helper.validateRealtimeClientBinding({SUPABASE_URL:'https://production.invalid'}),/^Error: RT_CLIENT_/);
  for(const mutate of [x=>x.http.owner='topic-alerts-fullstack-20261017-r4',x=>x.postgres.walLevel='replica',
    x=>x.recoveryProofSha256='0'.repeat(64),x=>x.realtime.containerId=x.http.target.containerId,
    x=>x.realtime.port=443,x=>x.realtime.tenant='foreign',x=>x.executionNamespace='',
    x=>x.http.target.network='bridge',x=>x.http.target.publishedPorts=[3000],x=>x.http.target.productionMounts=['/production']]) {
    const x=binding();mutate(x);assert.throws(()=>helper.validateRealtimeClientBinding(x),/^Error: (RT_CLIENT_|FULLSTACK_)/);
  }
});

test('ordinary JWT admission refuses service, foreign, anonymous and expired identities without logging tokens',()=>{
  const b=binding(),c=credentials(b);assert.equal(helper.validateRealtimeClientCredentials(b,c).a,c.a);
  for(const changes of [{role:'service_role'},{sub:id(999)},{session_id:id(999)},{iss:'foreign'},
    {is_anonymous:true},{is_anonymous:undefined},{exp:1},{exp:Math.floor(Date.now()/1000)+10000}]) {
    assert.throws(()=>helper.validateRealtimeClientCredentials(b,{...credentials(b),a:token(b,'a',changes)}),/^Error: RT_CLIENT_AUTH_REFUSED$/);
  }
});

test('measured initial legacy contract admits A empty and one retained ordinary B chat_added, never a fake policy reply',()=>{
  assert.equal(typeof helper.validateRealtimeClientInitialLegacy,'function','INITIAL_LEGACY_HISTORY_CONTRACT_REQUIRED');
  const b=binding(),row=initialLegacyB(b),copy=JSON.stringify(row);
  assert.equal(helper.validateRealtimeClientInitialLegacy(b,'a',[]),null);
  assert.equal(helper.validateRealtimeClientInitialLegacy(b,'b',[row]),id(200));
  assert.equal(JSON.stringify(row),copy);
});

test('initial legacy contract rejects missing/extra history, foreign identity and changed exact producer payload',()=>{
  const b=binding(),original=initialLegacyB(b);
  for(const rows of [[],[original,original],null,{},
    [{...original,id:'invalid'}],[{...original,user_id:b.http.fixture.actors.a.uid}],[{...original,kind:'message'}],
    ...[{actor_id:b.http.fixture.actors.b.uid},{actor_id:'invalid'},{chat_id:id(999)},{chat_type:'private'},
      {chat_name:'foreign'},{extra:'PRIVATE_EXTRA'}].map(change=>[{...original,payload:{...original.payload,...change}}]),
    [{...original,payload:null}],[{...original,payload:[]}],
    [{...original,payload:{actor_id:original.payload.actor_id,chat_id:original.payload.chat_id,chat_type:'group'}}],
  ])assert.throws(()=>helper.validateRealtimeClientInitialLegacy(b,'b',rows),/^Error: RT_CLIENT_INITIAL_LEGACY_REFUSED$/);
  assert.throws(()=>helper.validateRealtimeClientInitialLegacy(b,'a',[original]),/^Error: RT_CLIENT_INITIAL_LEGACY_REFUSED$/);
  assert.throws(()=>helper.validateRealtimeClientInitialLegacy(b,'foreign',[]),/^Error: RT_CLIENT_INITIAL_LEGACY_REFUSED$/);
});

test('retained initial B history is validated by the SAME remembered ID, not a replacement chat_added row',()=>{
  const b=binding(),row=initialLegacyB(b),remembered=helper.validateRealtimeClientInitialLegacy(b,'b',[row]);
  const retained=rows=>helper.validateRealtimeClientInitialLegacy(b,'b',rows.filter(note=>note.id===remembered));
  assert.equal(retained([row,{id:id(201),kind:'message'}]),remembered);
  for(const rows of [[],[{...row,id:id(202)}],[{...row,kind:'message'}]])
    assert.throws(()=>retained(rows),/^Error: RT_CLIENT_INITIAL_LEGACY_REFUSED$/);
});

test('loaded payload-key and fixture-name omissions are both killed by measured initial-history controls',async()=>{
  const original=readFileSync(url,'utf8');
  for(const [anchor,replacement,change] of [
    ["keys(row.payload,['actor_id','chat_id','chat_type','chat_name']);",'',{extra:'PRIVATE_EXTRA'}],
    ["row.payload.chat_name==='Topic RT QA'",'true',{chat_name:'foreign'}],
  ]){
    assert.equal(original.split(anchor).length,2);
    let text=original.replace(anchor,replacement).replaceAll('import.meta.url',JSON.stringify(url.href))
      .replace(/from '([.][^']+)'/g,(_all,relative)=>'from '+JSON.stringify(new URL(relative,url).href));
    let mutant;try{mutant=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));}catch{throw Error('INITIAL_HISTORY_MUTANT_IMPORT_REFUSED');}
    const b=binding(),row=initialLegacyB(b);row.payload={...row.payload,...change};
    const control=module=>assert.throws(()=>module.validateRealtimeClientInitialLegacy(b,'b',[row]),/^Error: RT_CLIENT_INITIAL_LEGACY_REFUSED$/);
    control(helper);assert.throws(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
  }
});

test('real SDK HTTP mapping confines the original request before any async guard',async()=>{
  const b=helper.validateRealtimeClientBinding(binding()),jwt=token(b),f=b.http.fixture;
  const headers={Authorization:'Bearer '+jwt};
  const body={p_chat_id:f.chatId};
  const mapped=await helper.prepareRealtimeSdkRequest(b,'a',jwt,'http://127.0.0.1:3000/rest/v1/rpc/topic_notification_preferences_read',
    {method:'POST',headers,body:JSON.stringify(body)});
  headers.Authorization='foreign';body.p_chat_id=id(999);
  assert.equal(mapped.url,'http://127.0.0.1:3000/rpc/topic_notification_preferences_read');
  assert.equal(await mapped.text(),JSON.stringify({p_chat_id:f.chatId}));assert.equal(mapped.headers.get('authorization'),'Bearer '+jwt);
  for(const [address,init] of [
    ['https://production.invalid/rest/v1/notifications',{headers}],
    ['http://127.0.0.1:3000/rest/v1/auth/users',{headers}],
    ['http://127.0.0.1:3000/rest/v1/messages',{method:'DELETE',headers}],
    ['http://127.0.0.1:3000/rest/v1/rpc/topic_notification_preference_set',{method:'POST',headers,body:'{}'}],
    ['http://127.0.0.1:3000/rest/v1/notifications?select=*&user_id=eq.'+id(999),{headers}],
    ['http://127.0.0.1:3000/rest/v1/rpc/topic_notification_preferences_read',{method:'POST',headers,body:JSON.stringify({p_chat_id:id(999)})}],
  ]) await assert.rejects(()=>helper.prepareRealtimeSdkRequest(b,'a',jwt,address,init),/^Error: RT_CLIENT_/);
});

test('real message producer is the only baseline write; arbitrary bodies and RPCs refuse',async()=>{
  const b=helper.validateRealtimeClientBinding(binding()),f=b.http.fixture,jwt=token(b,'b');
  const data={id:'12345678-1234-4234-8234-123456789012',chat_id:f.chatId,user_id:f.actors.b.uid,topic_id:f.topicId,
    type:'text',content:'fictional realtime client baseline'};
  const send=x=>helper.prepareRealtimeSdkRequest(b,'b',jwt,'http://127.0.0.1:3000/rest/v1/messages',
    {method:'POST',body:JSON.stringify(x)});
  assert.equal((await send(data)).method,'POST');
  for(const x of [{...data,chat_id:id(999)},{...data,user_id:f.actors.a.uid},{...data,content:'foreign'},[data],{...data,extra:1}])
    await assert.rejects(()=>send(x),/^Error: RT_CLIENT_/);
});

test('WS mapping rewrites only SDK path and pins tenant Host, ordinary token and loopback',()=>{
  const b=helper.validateRealtimeClientBinding(binding()),jwt=token(b);
  const mapped=helper.mapRealtimeSdkWebSocket(b,jwt,'ws://127.0.0.1:3000/realtime/v1/websocket?apikey='+jwt+'&vsn=1.0.0');
  const url=new URL(mapped.url);assert.equal(url.origin,'ws://127.0.0.1:4000');assert.equal(url.pathname,'/socket/websocket');
  assert.equal(mapped.headers.Host,'topic-alerts-fullstack-20261017-r5.localhost:4000');
  for(const address of ['wss://production.invalid/realtime/v1/websocket','ws://127.0.0.1:4000/foreign',
    'ws://127.0.0.1:3000/realtime/v1/websocket?apikey=foreign&vsn=1.0.0',
    'ws://127.0.0.1:3000/realtime/v1/websocket?apikey='+jwt+'&vsn=1.0.0&foreign=1'])
    assert.throws(()=>helper.mapRealtimeSdkWebSocket(b,jwt,address),/^Error: RT_CLIENT_/);
});

let sources;
test('actual source closure uses immutable old commit and current source, without product config/store loading',async()=>{
  sources=await helper.loadRealtimeClientSources();
  assert.equal(sources.legacyRevision,'75096aa30427fdf551fd0c3bdcb7d9eee7fbd5c5');
  assert.match(sources.digest,/^[a-f0-9]{64}$/);
  assert.ok(sources.old['hooks/useNotifications.ts'].includes('.from("notifications")'));
  assert.ok(sources.current['hooks/useNotifications.ts'].includes('createNotificationFeedV2'));
  assert.ok(!Object.keys(sources.old).some(p=>/supabase\/client|app.store|env/.test(p)));
  const forged=structuredClone(sources);forged.old['hooks/useNotifications.ts']+='\n// wrong closure';
  assert.throws(()=>helper.validateRealtimeClientSources(forged),/^Error: RT_CLIENT_SOURCE_REFUSED$/);
});

test('actual old/new hook and matching sound/Windows dependencies compile on the scheduler with NO fake rows or policy replies',async()=>{
  sources??=await helper.loadRealtimeClientSources();
  for(const generation of ['old','current']) for(const desktop of [false,true]) {
    const calls=[];const pending=new Promise(()=>{});
    const client={from(table){calls.push(['from',table]);const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},then(a,b){return pending.then(a,b);}};return query;},
      rpc(){return pending;},channel(){const channel={on(_kind,filter){calls.push(['channel',filter.table]);return channel;},subscribe(){return channel;}};return channel;},removeChannel:async()=> 'ok'};
    const doc=await helper.mountRealtimeClientHook({generation,desktop,sources,client,actor:binding().http.fixture.actors.a});
    await doc.drain();const snap=doc.snapshot();
    assert.equal(snap.sounds,0);assert.equal(snap.cards,0);assert.equal(snap.frames,0);assert.equal(snap.ready,false);
    assert.ok(calls.some(x=>x[0]==='channel'&&x[1]===(generation==='old'?'notifications':'notification_feed_events_v2')));
    doc.close();assert.equal(doc.snapshot().closed,true);
  }
});

test('baseline refuses missing inspector and wrong execution namespace BEFORE sockets or HTTP; no live run in selftests',async()=>{
  sources??=await helper.loadRealtimeClientSources();const b=binding(sources.digest);let inspections=0;
  await assert.rejects(()=>helper.runRealtimeClientBaseline({binding:b,credentials:credentials(b),sources}),/^Error: RT_CLIENT_INSPECT_REQUIRED$/);
  await assert.rejects(()=>helper.runRealtimeClientBaseline({binding:b,credentials:credentials(b),sources,
    inspect:async()=>{inspections++;return {};}}),/^Error: RT_CLIENT_EXECUTION_NAMESPACE_REFUSED$/);
  assert.equal(inspections,0);
});

test('dependency inventory is actual locked SDK metadata, not a reimplemented Phoenix client',async()=>{
  assert.deepEqual(await helper.realtimeClientSdkVersions(),{supabase:'2.105.1',realtime:'2.105.1',ws:'8.20.0'});
});

test('baseline HTTP transport is a callable source-test boundary, not a second policy implementation',()=>{
  assert.equal(typeof helper.createRealtimeSdkFetch,'function','REALTIME_SDK_FETCH_BOUNDARY_REQUIRED');
});

async function sdkRefusal(module,{networkFailure=false,status=503}={}){
  const require=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
  const b=helper.validateRealtimeClientBinding(binding()),jwt=token(b),lifetime=new AbortController();
  let calls=0,sdkCalls=0,guards=0;const failures=[];
  const transport=module.createRealtimeSdkFetch({binding:b,actor:'a',jwt,signal:lifetime.signal,
    op:()=>AbortSignal.any([lifetime.signal,AbortSignal.timeout(15000)]),
    inspect:async()=>{guards++;},admit(){if(lifetime.signal.aborted)throw Error('ALREADY_ABORTED');},
    refuse(status){failures.push(status);lifetime.abort();},
    wire:async()=>{calls++;if(networkFailure||calls>1)throw Error('PRIVATE_NETWORK_REASON');
      return new Response('{"message":"PRIVATE_FAILURE_BODY"}',{status,headers:{'content-type':'application/json'}});}});
  const client=require('@supabase/supabase-js').createClient('http://127.0.0.1:3000',jwt,{accessToken:async()=>jwt,
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(...args)=>{sdkCalls++;return transport(...args);}}});
  const result=await client.from('notifications').select('*').eq('user_id',b.http.fixture.actors.a.uid);
  return {calls,sdkCalls,guards,failures,aborted:lifetime.signal.aborted,result};
}

test('actual locked SDK GET503 aborts after one failure response, without rows, policy replies or retry',async()=>{
  const observed=await sdkRefusal(helper);
  assert.equal(observed.calls,1,'NO_SECOND_HTTP_DISPATCH_AFTER_503');
  assert.equal(observed.sdkCalls,1,'SDK_MUST_NOT_REENTER_TRANSPORT_AFTER_503');
  assert.equal(observed.guards,1);assert.deepEqual(observed.failures,[503]);assert.equal(observed.aborted,true);
  assert.equal(observed.result.data,null);assert.equal(observed.result.status,0);
  assert.match(observed.result.error.message,/AbortError: RT_CLIENT_HTTP_STATUS_503_ABORTED_NO_RETRY/);
  assert.doesNotMatch(JSON.stringify(observed.result),/PRIVATE_/);
});

test('actual locked SDK network exception is one terminal AbortError, not a retry or raw diagnostic',async()=>{
  const observed=await sdkRefusal(helper,{networkFailure:true});
  assert.equal(observed.calls,1);assert.equal(observed.sdkCalls,1);assert.equal(observed.guards,1);
  assert.deepEqual(observed.failures,[null]);assert.equal(observed.aborted,true);assert.equal(observed.result.data,null);
  assert.match(observed.result.error.message,/AbortError: RT_CLIENT_HTTP_UNAVAILABLE_NO_RETRY/);
  assert.doesNotMatch(JSON.stringify(observed.result),/PRIVATE_/);
});

test('actual locked SDK auth/missing/server non2xx responses all abort before error bodies reach the SDK',async()=>{
  for(const status of [401,403,404,500]){
    const observed=await sdkRefusal(helper,{status});assert.equal(observed.calls,1);assert.equal(observed.sdkCalls,1);
    assert.deepEqual(observed.failures,[status]);assert.equal(observed.aborted,true);assert.equal(observed.result.data,null);
    assert.ok(observed.result.error.message.includes('RT_CLIENT_HTTP_STATUS_'+status+'_ABORTED_NO_RETRY'));
    assert.doesNotMatch(JSON.stringify(observed.result),/PRIVATE_/);
  }
});

test('loaded literal non2xx-gate omission revives the real SDK retry and is rejected by the one-dispatch control',async()=>{
  let text=readFileSync(url,'utf8');const anchor='if(!response.ok){status=response.status;throw httpAbort(status);}';
  assert.equal(text.split(anchor).length,2);text=text.replace(anchor,'');
  text=text.replaceAll('import.meta.url',JSON.stringify(url.href))
    .replace(/from '([.][^']+)'/g,(_all,relative)=>'from '+JSON.stringify(new URL(relative,url).href));
  let mutant;try{mutant=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));}catch{throw Error('LITERAL_MUTANT_IMPORT_REFUSED');}
  const control=async module=>{const observed=await sdkRefusal(module);assert.equal(observed.calls,1,'NO_SECOND_HTTP_DISPATCH_AFTER_503');};
  await control(helper);await assert.rejects(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
});

test('actual locked Supabase SDK generates the mapped HTTP/WS paths without any response/frame/network success oracle',async()=>{
  const require=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url)),b=helper.validateRealtimeClientBinding(binding()),jwt=token(b);
  let http,ws;
  class NoNetworkSocket {static CONNECTING=0;static OPEN=1;readyState=0;constructor(address){ws=address;}close(){this.readyState=3;}send(){}addEventListener(){}removeEventListener(){}}
  const client=require('@supabase/supabase-js').createClient('http://127.0.0.1:3000',jwt,{accessToken:async()=>jwt,
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(address,init)=>{http=await helper.prepareRealtimeSdkRequest(b,'a',jwt,address,init);throw Error('OFFLINE_NO_REPLY');}},
    realtime:{transport:NoNetworkSocket,timeout:10000}});
  try{
    await client.rpc('notification_feed_page_v2',{p_limit:30});assert.equal(new URL(http.url).pathname,'/rpc/notification_feed_page_v2');
    client.channel('offline-constructor').on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+b.http.fixture.actors.a.uid},()=>assert.fail('NO_FRAMES_ALLOWED')).subscribe();
    for(let i=0;i<100&&!ws;i++)await Promise.resolve();
    assert.equal(new URL(helper.mapRealtimeSdkWebSocket(b,jwt,ws).url).pathname,'/socket/websocket');
  }finally{await client.removeAllChannels();client.realtime.disconnect();}
});

test('in-memory self-contained Node22 bundle is required, without Docker/full-repo build or output files',async()=>{
  const buildUrl=new URL('./topic-notification-realtime-client.build.mjs',import.meta.url);
  const api=existsSync(buildUrl)?await import(buildUrl.href):{};
  assert.equal(typeof api.buildRealtimeClientBundle,'function','NODE22_CLIENT_BUNDLE_REQUIRED');
  const bundle=await api.buildRealtimeClientBundle();
  assert.equal(bundle.sha256,sha(bundle.code));assert.equal(bundle.target,'node22');
  assert.ok(bundle.code.length>100000&&bundle.code.length<25000000);
  assert.equal(bundle.externalPackages.length,0);assert.equal(bundle.credentialsEmbedded,false);
  assert.deepEqual(bundle.unavailableOptional,['source-map-support']);
  assert.doesNotMatch(bundle.code,/C:\\\\Users|D:\\\\CodexProjects|VITE_SUPABASE|SUPABASE_SERVICE_ROLE_KEY/);
  const module={exports:{}};
  vm.runInNewContext(bundle.code,{module,exports:module.exports,require:createRequire(import.meta.url),
    __filename:fileURLToPath(import.meta.url),__dirname:fileURLToPath(new URL('.',import.meta.url)),process,Buffer,URL,
    setTimeout,clearTimeout,setInterval,clearInterval,TextEncoder,TextDecoder,AbortController,AbortSignal,Request,Response,Headers,
    console:{log(){throw Error('BUNDLE_IMPORT_MUST_BE_SILENT');},warn(){throw Error('BUNDLE_IMPORT_MUST_BE_SILENT');},error(){throw Error('BUNDLE_IMPORT_MUST_BE_SILENT');}}},
    {timeout:5000,filename:'client-bundle.cjs'});
  assert.equal(typeof module.exports.runRealtimeClientBaseline,'function');
  assert.equal(typeof module.exports.runRealtimeClientPhases,'function');
});

test('literal origin omission is killed by a foreign-target negative admission control',async()=>{
  let text=readFileSync(url,'utf8');const anchor="need(u.origin===HTTP_ORIGIN,'RT_CLIENT_HTTP_SCOPE_REFUSED');";
  assert.equal(text.split(anchor).length,2);text=text.replace(anchor,'');
  text=text.replaceAll('import.meta.url',JSON.stringify(url.href))
    .replace(/from '([.][^']+)'/g,(_all,relative)=>'from '+JSON.stringify(new URL(relative,url).href));
  let mutant;try{mutant=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));}catch{throw Error('LITERAL_MUTANT_IMPORT_REFUSED');}
  const b=helper.validateRealtimeClientBinding(binding()),address='https://production.invalid/rest/v1/notifications?select=*&user_id=eq.'+b.http.fixture.actors.a.uid;
  const control=module=>assert.rejects(()=>module.prepareRealtimeSdkRequest(b,'a',token(b),address),/^Error: RT_CLIENT_/);
  await control(helper);
  await assert.rejects(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
});

test('finite phase runner exists alongside the unchanged legacy baseline entry',()=>{
  assert.equal(typeof helper.runRealtimeClientPhases,'function','FINITE_PHASE_RUNNER_REQUIRED');
  assert.equal(typeof helper.createRealtimeClientPhaseGate,'function','PHASE_GATE_REQUIRED');
  assert.equal(typeof helper.runRealtimeClientBaseline,'function');
});

test('finite phase setter confines authenticated own topic, mode and safe CAS revision',async()=>{
  const b=helper.validateRealtimeClientBinding(binding()),jwt=token(b),f=b.http.fixture;
  const send=args=>helper.prepareRealtimeSdkRequest(b,'a',jwt,'http://127.0.0.1:3000/rest/v1/rpc/topic_notification_preference_set',
    {method:'POST',body:JSON.stringify(args)});
  const args={p_chat_id:f.chatId,p_topic_id:f.topicId,p_mode:'disabled',p_expected_revision:0};
  const request=await send(args);assert.equal(request.url,'http://127.0.0.1:3000/rpc/topic_notification_preference_set');
  assert.equal(request.headers.get('authorization'),'Bearer '+jwt);assert.deepEqual(JSON.parse(await request.text()),args);
  for(const x of [{...args,p_chat_id:id(999)},{...args,p_topic_id:id(999)},{...args,p_mode:'unknown'},
    {...args,p_expected_revision:-1},{...args,p_expected_revision:9007199254740992},{...args,extra:true}])
    await assert.rejects(()=>send(x),/^Error: RT_CLIENT_HTTP_SCOPE_REFUSED$/);
});

function phaseSnapshot(b=binding(),disabled=false){
  return {topicId:b.http.fixture.topicId,revision:disabled?1:0,mode:disabled?'disabled':'inherit',initialBNotificationId:id(200),initialBHistorySha256:'0'.repeat(64),
    baselineMessageIds:{a:id(210),b:id(211)},baselineNotificationIds:{a:id(212),b:id(213)},
    baselineHistorySha256:{a:'1'.repeat(64),b:'2'.repeat(64)},
    blockedMessageId:disabled?id(214):null,blockedNotificationId:disabled?id(215):null,
    controlMessageId:disabled?id(216):null,terminalSha256:disabled?'3'.repeat(64):null};
}
function phaseParent(b){
  const seen=[];
  return {seen,
    inspect:async request=>({binding:b,...Object.fromEntries(['runtimeEnabled','phase','snapshotSha256'].map(k=>[k,request[k]]))}),
    phase:async request=>{seen.push(structuredClone({...request,signal:undefined}));
      return {binding:b,phase:request.phase,snapshot:request.snapshot,runtimeEnabled:request.runtimeEnabled};}};
}

test('finite phase gate drains held HTTP, accepts real parent runtime false only at rollback and keeps checkpoint bytes immutable',async()=>{
  const b=helper.validateRealtimeClientBinding(binding()),parent=phaseParent(b),gate=helper.createRealtimeClientPhaseGate({binding:b,...parent});
  await gate.transition('baseline',phaseSnapshot(b));
  await gate.transition('disabled',phaseSnapshot(b,true));
  let release,entered=0;
  const held=gate.dispatch(()=>{entered++;return new Promise(r=>{release=r;});});
  await Promise.resolve();const pending=gate.transition('rollback',phaseSnapshot(b,true));
  const queued=gate.dispatch(async()=>{entered++;await gate.inspect();return 'AFTER_REAL_ACK';});
  await Promise.resolve();assert.equal(parent.seen.length,2);assert.equal(entered,1);
  release();await held;await pending;assert.equal(await queued,'AFTER_REAL_ACK');
  assert.equal(parent.seen.length,3);assert.equal(parent.seen[2].runtimeEnabled,false);assert.equal(gate.runtimeEnabled(),false);
  assert.equal(entered,2);await gate.inspect();
});

test('finite phase gate refuses echo-true rollback, replay, altered history, out-of-order and late aborted ACK',async()=>{
  const b=helper.validateRealtimeClientBinding(binding());
  for(const variant of ['runtime','history','order','replay','abort']){
    const stop=new AbortController(),parent=phaseParent(b),gate=helper.createRealtimeClientPhaseGate({binding:b,...parent,signal:stop.signal});
    if(variant==='order'){await assert.rejects(()=>gate.transition('disabled',phaseSnapshot(b,true)),/^Error: RT_CLIENT_PHASE_REFUSED$/);continue;}
    await gate.transition('baseline',phaseSnapshot(b));
    if(variant==='replay'){await assert.rejects(()=>gate.transition('baseline',phaseSnapshot(b)),/^Error: RT_CLIENT_PHASE_REFUSED$/);continue;}
    const snapshot=phaseSnapshot(b,true);if(variant==='history')snapshot.baselineHistorySha256.a='4'.repeat(64);
    if(variant==='history'){await assert.rejects(()=>gate.transition('disabled',snapshot),/^Error: RT_CLIENT_PHASE_REFUSED$/);continue;}
    await gate.transition('disabled',snapshot);
    // Use a second gate because parent callbacks are snapshotted at construction.
    const changed=phaseParent(b);let release;
    changed.phase=async request=>request.phase==='rollback'?new Promise(r=>{release=()=>r({binding:b,phase:request.phase,snapshot:request.snapshot,runtimeEnabled:variant==='runtime'});}):
      ({binding:b,phase:request.phase,snapshot:request.snapshot,runtimeEnabled:true});
    const next=helper.createRealtimeClientPhaseGate({binding:b,...changed,signal:stop.signal});
    await next.transition('baseline',phaseSnapshot(b));await next.transition('disabled',phaseSnapshot(b,true));
    const result=next.transition('rollback',phaseSnapshot(b,true));await new Promise(r=>setImmediate(r));
    if(variant==='abort')stop.abort();release();
    await assert.rejects(()=>result,/^Error: RT_CLIENT_PHASE_REFUSED$/);assert.equal(next.runtimeEnabled(),true);
    await assert.rejects(()=>next.dispatch(async()=>assert.fail('NO_LATE_DISPATCH')),/^Error: RT_CLIENT_PHASE_REFUSED$/);
  }
});

test('finite phase presentation rejects old OR current sound/card growth after a bounded socket drain',()=>{
  assert.equal(typeof helper.assertRealtimeClientPhasePresentation,'function','PHASE_PRESENTATION_GUARD_REQUIRED');
  const before=Object.fromEntries(['oldWeb','oldWindows','newWeb','newWindows'].map(k=>[k,{sounds:1,cards:1,...(k.startsWith('old')?{legacyInserts:1}:{} )}]));
  helper.assertRealtimeClientPhasePresentation(before,structuredClone(before));
  for(const label of Object.keys(before))for(const counter of Object.keys(before[label])){
    const after=structuredClone(before);after[label][counter]++;
    assert.throws(()=>helper.assertRealtimeClientPhasePresentation(before,after),/^Error: RT_CLIENT_PHASE_ALERT_LEAK$/);
  }
});

test('finite phase runner refuses missing parent or wrong namespace BEFORE any HTTP/socket/effect',async()=>{
  sources??=await helper.loadRealtimeClientSources();const b=binding(sources.digest);let effects=0;
  const args={binding:b,credentials:credentials(b),sources,inspect:async()=>{effects++;},phase:async()=>{effects++;}};
  await assert.rejects(()=>helper.runRealtimeClientPhases({...args,phase:undefined}),/^Error: RT_CLIENT_PHASE_REQUIRED$/);
  await assert.rejects(()=>helper.runRealtimeClientPhases(args),/^Error: RT_CLIENT_EXECUTION_NAMESPACE_REFUSED$/);
  assert.equal(effects,0);
});

test('finite phase checkpoint is copied before a held parent ACK and ignored-signal timeout cannot release new IO',async t=>{
  const b=helper.validateRealtimeClientBinding(binding()),parent=phaseParent(b);let release;
  parent.phase=request=>new Promise(r=>{release=()=>r({binding:b,phase:request.phase,snapshot:request.snapshot,runtimeEnabled:true});});
  const gate=helper.createRealtimeClientPhaseGate({binding:b,...parent}),snapshot=phaseSnapshot(b);
  const pending=gate.transition('baseline',snapshot);snapshot.baselineHistorySha256.a='9'.repeat(64);release();await pending;
  const disabled=gate.transition('disabled',phaseSnapshot(b,true));release();await disabled;
  // The timeout signal is controlled, while the parent deliberately ignores it.
  const deadline=new AbortController();t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,15000);return deadline.signal;});
  const blocked=helper.createRealtimeClientPhaseGate({binding:b,inspect:parent.inspect,phase:()=>new Promise(()=>{})});
  const held=blocked.transition('baseline',phaseSnapshot(b));let called=false;
  const queued=blocked.dispatch(async()=>{called=true;});
  deadline.abort();
  await assert.rejects(()=>held,/^Error: RT_CLIENT_PHASE_REFUSED$/);
  await assert.rejects(()=>queued,/^Error: RT_CLIENT_PHASE_REFUSED$/);assert.equal(called,false);
});

async function phaseMutant(anchor,replacement){
  let text=readFileSync(url,'utf8');assert.equal(text.split(anchor).length,2,'exact loaded phase control anchor');
  text=text.replace(anchor,replacement).replaceAll('import.meta.url',JSON.stringify(url.href))
    .replace(/from '([.][^']+)'/g,(_all,relative)=>'from '+JSON.stringify(new URL(relative,url).href));
  return import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
}

test('finite phase loaded runtime and rollback-snapshot omissions fail real gate rejection assertions',async()=>{
  const b=helper.validateRealtimeClientBinding(binding());
  for(const [anchor,replacement,variant] of [
    ['check(stable(result)===stable({binding:b,phase:next,snapshot:exact,runtimeEnabled:expectedRuntime}));','', 'runtime'],
    ["if(next==='rollback')check(stable(v)===stable(saved));",'', 'terminal'],
  ]){
    const control=async module=>{
      const parent=phaseParent(b);if(variant==='runtime')parent.phase=async r=>({binding:b,phase:r.phase,snapshot:r.snapshot,runtimeEnabled:true});
      const gate=module.createRealtimeClientPhaseGate({binding:b,...parent});
      await gate.transition('baseline',phaseSnapshot(b));await gate.transition('disabled',phaseSnapshot(b,true));
      const snapshot=phaseSnapshot(b,true);if(variant==='terminal')snapshot.terminalSha256='4'.repeat(64);
      await assert.rejects(()=>gate.transition('rollback',snapshot),/^Error: RT_CLIENT_PHASE_REFUSED$/);
    };
    await control(helper);const mutant=await phaseMutant(anchor,replacement);await assert.rejects(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
  }
});

test('finite phase loaded drain omission releases parent rollback while an actual held dispatch is outstanding',async()=>{
  const control=async module=>{
    const b=helper.validateRealtimeClientBinding(binding()),parent=phaseParent(b),gate=module.createRealtimeClientPhaseGate({binding:b,...parent});
    await gate.transition('baseline',phaseSnapshot(b));await gate.transition('disabled',phaseSnapshot(b,true));
    let release;const io=gate.dispatch(()=>new Promise(r=>{release=r;}));await Promise.resolve();
    const pending=gate.transition('rollback',phaseSnapshot(b,true));
    await new Promise(r=>setImmediate(r));const observed=parent.seen.length;release();await io;await pending;
    assert.equal(observed,2,'ROLLBACK_MUST_WAIT_FOR_HELD_HTTP');
  };
  await control(helper);const mutant=await phaseMutant('if(active)await wait(new Promise(r=>{drained=r;}),s);','');
  await assert.rejects(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
});

test('finite phase loaded current-client presentation omission is killed by a newWindows card leak',async()=>{
  const control=module=>{
    const before=Object.fromEntries(['oldWeb','oldWindows','newWeb','newWindows'].map(k=>[k,{sounds:0,cards:0,legacyInserts:0}])),after=structuredClone(before);
    after.newWindows.cards=1;assert.throws(()=>module.assertRealtimeClientPhasePresentation(before,after),/^Error: RT_CLIENT_PHASE_ALERT_LEAK$/);
  };
  control(helper);const mutant=await phaseMutant("for(const label of ['oldWeb','oldWindows','newWeb','newWindows'])for(const key", "for(const label of ['oldWeb','oldWindows'])for(const key");
  assert.throws(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
});

test('finite phase loaded safe-revision omission admits an unsafe CAS and fails the real request refusal',async()=>{
  const b=helper.validateRealtimeClientBinding(binding()),args={p_chat_id:b.http.fixture.chatId,p_topic_id:b.http.fixture.topicId,p_mode:'disabled',p_expected_revision:9007199254740992};
  const control=module=>assert.rejects(()=>module.prepareRealtimeSdkRequest(b,'a',token(b),'http://127.0.0.1:3000/rest/v1/rpc/topic_notification_preference_set',
    {method:'POST',body:JSON.stringify(args)}),/^Error: RT_CLIENT_HTTP_SCOPE_REFUSED$/);
  await control(helper);const mutant=await phaseMutant('&&Number.isSafeInteger(args.p_expected_revision)&&args.p_expected_revision>=0','');
  await assert.rejects(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
});
