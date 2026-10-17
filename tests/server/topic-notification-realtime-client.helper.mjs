import {randomUUID,createHash} from 'node:crypto';
import {readlink} from 'node:fs/promises';
import Supabase from '../../node_modules/.pnpm/@supabase+supabase-js@2.105.1/node_modules/@supabase/supabase-js/dist/index.cjs';
import WebSocket from '../../node_modules/.pnpm/ws@8.20.0/node_modules/ws/wrapper.mjs';
import sdkPackage from '../../node_modules/.pnpm/@supabase+supabase-js@2.105.1/node_modules/@supabase/supabase-js/package.json' with {type:'json'};
import realtimePackage from '../../node_modules/.pnpm/@supabase+realtime-js@2.105.1/node_modules/@supabase/realtime-js/package.json' with {type:'json'};
import wsPackage from '../../node_modules/.pnpm/ws@8.20.0/node_modules/ws/package.json' with {type:'json'};
import {loadRealtimeClientSources,validateRealtimeClientSources,mountRealtimeClientHook,realtimeClientFeedParsers} from './topic-notification-realtime-client.hook.mjs';

export {loadRealtimeClientSources,validateRealtimeClientSources,mountRealtimeClientHook};
const HTTP_ORIGIN='http://127.0.0.1:3000',SDK_WS_ORIGIN='ws://127.0.0.1:3000',WS_ORIGIN='ws://127.0.0.1:4000';
const OWNER='topic-alerts-fullstack-20261017-r5';
const RECOVERY='2441c65f68a6ad9fd5bd35444102fbe4b4d9552355b733cd364f2efa6353a878';
const IMAGE='sha256:aa1c92c0cf326007563641730ec9da9c60478caa6853887775365fa2c097a471';
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const BODY='fictional realtime client baseline';
const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const need=(v,code='RT_CLIENT_BINDING_REFUSED')=>{if(!v)throw Error(code);};
function keys(v,names){need(v&&typeof v==='object'&&!Array.isArray(v)&&stable(Object.keys(v).sort())===stable([...names].sort()));}
function freeze(v){for(const x of Object.values(v))if(x&&typeof x==='object')freeze(x);return Object.freeze(v);}
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z$/.test(v)&&Number.isFinite(Date.parse(v));
const pgTimestamp=v=>timestamp(v)||(typeof v==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?\+00$/.test(v)&&Number.isFinite(Date.parse(v)));

// Same owned HTTP binding shape, without importing its assembler/CLI graph into
// the standalone client bundle. This validator grants no policy/auth authority.
function validateHttpBinding(b){
  keys(b,['v','owner','sourceContainerId','target','sourceCatalogSha256','restoreCatalogSha256','candidateDigest','rollbackDigest','fixture']);
  need(b.v===1&&b.owner===OWNER&&HEX.test(b.sourceContainerId));
  for(const k of ['sourceCatalogSha256','restoreCatalogSha256','candidateDigest','rollbackDigest'])need(HEX.test(b[k]));
  need(b.sourceCatalogSha256===b.restoreCatalogSha256);
  const t=b.target;keys(t,['containerId','image','startedAt','cluster','postgrestPid','postgrestStartTicks','postgrestBinarySha256','postgrestConfigSha256','httpPort','network','publishedPorts','productionMounts']);
  need(HEX.test(t.containerId)&&t.containerId!==b.sourceContainerId&&t.image==='sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
    &&timestamp(t.startedAt)&&/^[1-9][0-9]{10,19}$/.test(t.cluster)&&Number.isSafeInteger(t.postgrestPid)&&t.postgrestPid>0
    &&/^(0|[1-9][0-9]*)$/.test(t.postgrestStartTicks)&&HEX.test(t.postgrestBinarySha256)&&HEX.test(t.postgrestConfigSha256)
    &&t.httpPort===3000&&t.network==='none'&&Array.isArray(t.publishedPorts)&&!t.publishedPorts.length&&Array.isArray(t.productionMounts)&&!t.productionMounts.length);
  const f=b.fixture;keys(f,['chatId','topicId','enabledTopicId','generalTopicId','actors']);keys(f.actors,['a','a2','oldA','b']);
  const ids=[f.chatId,f.topicId,f.enabledTopicId,f.generalTopicId];
  for(const a of Object.values(f.actors)){keys(a,['uid','sid']);need(/^70000000-0000-4000-8000-[0-9]{12}$/.test(a.uid));ids.push(a.sid);}
  need(f.actors.a.uid===f.actors.a2.uid&&f.actors.a.uid===f.actors.oldA.uid&&f.actors.a.uid!==f.actors.b.uid);
  ids.push(f.actors.a.uid,f.actors.b.uid);need(new Set(ids).size===ids.length&&ids.every(v=>/^70000000-0000-4000-8000-[0-9]{12}$/.test(v)));
  return b;
}

export function validateRealtimeClientBinding(input){
  const b=JSON.parse(JSON.stringify(input));
  keys(b,['v','http','recoveryProofSha256','sourceDigest','candidateCatalogSha256','executionNamespace','postgres','realtime']);
  need(b.v===1&&b.recoveryProofSha256===RECOVERY&&HEX.test(b.sourceDigest)&&HEX.test(b.candidateCatalogSha256));b.http=validateHttpBinding(b.http);
  need(b.http.owner===OWNER&&/^net:\[[1-9][0-9]*\]$/.test(b.executionNamespace));
  keys(b.postgres,['postmaster','walLevel']);need(b.postgres.walLevel==='logical'&&pgTimestamp(b.postgres.postmaster));
  const r=b.realtime;keys(r,['containerId','imageId','imageDigest','startedAt','pid','startTicks','configSha256','tenant','port']);
  need(HEX.test(r.containerId)&&![b.http.sourceContainerId,b.http.target.containerId].includes(r.containerId)
    &&/^sha256:[a-f0-9]{64}$/.test(r.imageId)&&r.imageDigest===IMAGE&&timestamp(r.startedAt)
    &&Number.isSafeInteger(r.pid)&&r.pid>0&&/^[1-9][0-9]*$/.test(r.startTicks)&&HEX.test(r.configSha256)
    &&r.tenant===OWNER&&r.port===4000);
  return freeze(b);
}
export function validateRealtimeClientCredentials(binding,input){
  try{
    keys(input,['a','b']);const now=Math.floor(Date.now()/1000),copy={...input};
    for(const [name,jwt] of Object.entries(copy)){
      need(typeof jwt==='string'&&jwt.length<=8192);const pieces=jwt.split('.');
      need(pieces.length===3&&pieces.every(v=>/^[A-Za-z0-9_-]+$/.test(v)));
      const header=JSON.parse(Buffer.from(pieces[0],'base64url')),c=JSON.parse(Buffer.from(pieces[1],'base64url')),actor=binding.http.fixture.actors[name];
      need(header.alg==='HS256'&&c.role==='authenticated'&&c.is_anonymous===false&&c.iss===binding.http.owner
        &&c.sub===actor.uid&&c.session_id===actor.sid&&Number.isSafeInteger(c.exp)&&c.exp>=now+480&&c.exp<=now+900);
    }
    // Decoding only confines identities. Actual services must verify the QA key.
    return Object.freeze(copy);
  }catch{throw Error('RT_CLIENT_AUTH_REFUSED');}
}
// Measured fullschema contract (rollback proof d47f434e): the real
// _notify_chat_members_after_insert producer retains B's ordinary chat_added.
// It is history, not a producer-positive or permission to delete/reseed rows.
export function validateRealtimeClientInitialLegacy(binding,actor,rows){
  try{
    need(['a','b'].includes(actor)&&Array.isArray(rows));
    if(actor==='a'){need(rows.length===0);return null;}
    need(rows.length===1);const row=rows[0],f=binding.http.fixture;
    need(row&&typeof row==='object'&&!Array.isArray(row)&&UUID.test(row.id)&&row.kind==='chat_added'&&row.user_id===f.actors.b.uid);
    keys(row.payload,['actor_id','chat_id','chat_type','chat_name']);
    need(UUID.test(row.payload.actor_id)&&row.payload.actor_id===f.actors.a.uid
      &&UUID.test(row.payload.chat_id)&&row.payload.chat_id===f.chatId&&row.payload.chat_type==='group'&&row.payload.chat_name==='Topic RT QA');
    return row.id;
  }catch{throw Error('RT_CLIENT_INITIAL_LEGACY_REFUSED');}
}
function ownQuery(u,allowed){
  need([...u.searchParams.keys()].every(k=>allowed.includes(k))&&new Set(u.searchParams.keys()).size===[...u.searchParams.keys()].length,'RT_CLIENT_HTTP_SCOPE_REFUSED');
}
export async function prepareRealtimeSdkRequest(binding,actor,jwt,input,init){
  try{
    need(['a','b'].includes(actor),'RT_CLIENT_AUTH_REFUSED');
    const request=new Request(input,init),u=new URL(request.url),f=binding.http.fixture,uid=f.actors[actor].uid;
    need(u.origin===HTTP_ORIGIN,'RT_CLIENT_HTTP_SCOPE_REFUSED');
    need(!u.username&&!u.password&&!u.hash&&u.pathname.startsWith('/rest/v1/'),'RT_CLIENT_HTTP_SCOPE_REFUSED');
    const route=u.pathname.slice('/rest/v1'.length);let body;
    if(request.method==='GET'){
      need(['/notifications','/chat_notification_preferences'].includes(route),'RT_CLIENT_HTTP_SCOPE_REFUSED');
      ownQuery(u,route==='/notifications'?['select','user_id','order','limit']:['select','chat_id','user_id']);
      need(u.searchParams.get('user_id')==='eq.'+uid,'RT_CLIENT_HTTP_SCOPE_REFUSED');
      if(route==='/notifications')need(u.searchParams.get('select')==='*'&&(!u.searchParams.has('limit')||u.searchParams.get('limit')==='30'),'RT_CLIENT_HTTP_SCOPE_REFUSED');
      else need(u.searchParams.get('chat_id')==='eq.'+f.chatId&&u.searchParams.get('select')==='chat_id,user_id,push_enabled,muted_until','RT_CLIENT_HTTP_SCOPE_REFUSED');
    }else{
      need(request.method==='POST'&&!u.search,'RT_CLIENT_HTTP_SCOPE_REFUSED');body=await request.text();need(Buffer.byteLength(body)<=65536,'RT_CLIENT_BODY_REFUSED');
      const args=JSON.parse(body);
      if(route==='/messages'){
        keys(args,['id','chat_id','user_id','topic_id','type','content']);need(UUID.test(args.id)&&args.chat_id===f.chatId&&args.user_id===uid
          &&args.topic_id===f.topicId&&args.type==='text'&&args.content===BODY,'RT_CLIENT_BODY_REFUSED');
      }else if(route==='/rpc/topic_notification_preferences_read'){
        keys(args,['p_chat_id']);need(args.p_chat_id===f.chatId,'RT_CLIENT_BODY_REFUSED');
      }else if(route==='/rpc/topic_notification_preference_set'){
        keys(args,['p_chat_id','p_topic_id','p_mode','p_expected_revision']);
        need(args.p_chat_id===f.chatId&&args.p_topic_id===f.topicId&&['inherit','enabled','disabled'].includes(args.p_mode)
          &&Number.isSafeInteger(args.p_expected_revision)&&args.p_expected_revision>=0,'RT_CLIENT_BODY_REFUSED');
      }else if(['/rpc/notification_feed_page_v2','/rpc/notification_feed_open_v2'].includes(route)){
        keys(args,route.endsWith('open_v2')?['p_limit','p_held_ids']:['p_limit']);
        need(Number.isInteger(args.p_limit)&&args.p_limit>=1&&args.p_limit<=30,'RT_CLIENT_BODY_REFUSED');
        if(route.endsWith('open_v2'))need(Array.isArray(args.p_held_ids)&&args.p_held_ids.length<=100&&args.p_held_ids.every(id=>typeof id==='string'&&UUID.test(id)),'RT_CLIENT_BODY_REFUSED');
      }else{
        need(['/rpc/notification_feed_lookup_v2','/rpc/message_notification_alert_decisions'].includes(route),'RT_CLIENT_HTTP_SCOPE_REFUSED');
        const key=route.endsWith('lookup_v2')?'p_ids':'p_notification_ids';keys(args,[key]);
        need(Array.isArray(args[key])&&args[key].length>=1&&args[key].length<=100&&args[key].every(id=>typeof id==='string'&&UUID.test(id)),'RT_CLIENT_BODY_REFUSED');
      }
    }
    const headers=new Headers(request.headers);headers.set('Authorization','Bearer '+jwt);headers.set('apikey',jwt);
    // URL, headers and body are copied before the first asynchronous inspect.
    return new Request(HTTP_ORIGIN+route+u.search,{method:request.method,headers,body,signal:request.signal,redirect:'error'});
  }catch{throw Error('RT_CLIENT_HTTP_SCOPE_REFUSED');}
}
export function mapRealtimeSdkWebSocket(binding,jwt,address){
  try{
    const u=new URL(address);need(u.origin===SDK_WS_ORIGIN&&u.pathname==='/realtime/v1/websocket'&&!u.hash&&!u.username&&!u.password);
    ownQuery(u,['apikey','vsn','log_level']);need(u.searchParams.get('apikey')===jwt&&['1.0.0','2.0.0'].includes(u.searchParams.get('vsn')));
    need(!u.searchParams.has('log_level')||u.searchParams.get('log_level')==='error');
    return {url:WS_ORIGIN+'/socket/websocket'+u.search,headers:{Host:binding.realtime.tenant+'.localhost:4000'}};
  }catch{throw Error('RT_CLIENT_WS_SCOPE_REFUSED');}
}

export async function realtimeClientSdkVersions(){
  const versions={supabase:sdkPackage.version,realtime:realtimePackage.version,ws:wsPackage.version};
  need(stable(versions)===stable({supabase:'2.105.1',realtime:'2.105.1',ws:'8.20.0'}),'RT_CLIENT_SDK_REFUSED');return versions;
}
const result=r=>{need(r&&r.error===null,'RT_CLIENT_SERVER_REFUSED');return r.data;};
function httpAbort(status){
  const known=Number.isInteger(status)&&status>=100&&status<=599;
  return Object.assign(Error(known?'RT_CLIENT_HTTP_STATUS_'+status+'_ABORTED_NO_RETRY':'RT_CLIENT_HTTP_UNAVAILABLE_NO_RETRY'),
    {name:'AbortError',status:known?status:null});
}

// Extracted from the baseline for actual locked-SDK refusal tests. The wire port
// defaults to real fetch; tests supply failure responses only, never policy data.
export function createRealtimeSdkFetch({binding,actor,jwt,inspect,signal,op,admit,refuse,wire=globalThis.fetch}){
  return async(address,init)=>{
    let response,status=null;
    try{
      signal.throwIfAborted();
      const request=await prepareRealtimeSdkRequest(binding,actor,jwt,address,init);admit();
      const s=AbortSignal.any([op(),request.signal]);await inspect();s.throwIfAborted();
      response=await wire(new Request(request,{signal:s}));
      if(!response.ok){status=response.status;throw httpAbort(status);}
      const chunks=[];let bytes=0;
      if(response.body){const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;
        bytes+=part.value.length;need(bytes<=1048576,'RT_CLIENT_RESPONSE_BOUND');chunks.push(part.value);}}finally{await reader.cancel();}}
      await inspect();s.throwIfAborted();return new Response(Buffer.concat(chunks),{status:response.status,headers:{'Content-Type':response.headers.get('content-type')??'application/json'}});
    }catch{
      refuse(status);
      if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});
      // Locked supabase-js does not pass a global retry option to PostgREST.
      // Its retry loop explicitly refuses AbortError, including network errors.
      throw httpAbort(status);
    }
  };
}

// This gate coordinates IO, not policy. Both callbacks must be the parent's real
// fresh guards. Checkpoints contain only owned IDs/digests; never rows or tokens.
export function createRealtimeClientPhaseGate({binding,inspect,phase,signal}){
  const b=validateRealtimeClientBinding(binding),check=v=>need(v,'RT_CLIENT_PHASE_REFUSED');
  check(typeof inspect==='function'&&typeof phase==='function');
  const inspectParent=inspect,phaseParent=phase;
  let current='initial',runtime=true,saved=null,failed=false,active=0,blocked=null,release,drained;
  const live=()=>check(!failed&&!signal?.aborted);
  const operation=()=>AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]);
  function wait(promise,s=operation()){
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(Error('RT_CLIENT_PHASE_REFUSED'));if(s.aborted){abort();return;}
      s.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>{
        s.removeEventListener('abort',abort);try{live();check(!s.aborted);resolve(value);}catch{abort();}
      },()=>{s.removeEventListener('abort',abort);abort();});
    });
  }
  function snapshot(input,next){
    const v=JSON.parse(JSON.stringify(input));
    keys(v,['topicId','revision','mode','initialBNotificationId','initialBHistorySha256','baselineMessageIds','baselineNotificationIds','baselineHistorySha256',
      'blockedMessageId','blockedNotificationId','controlMessageId','terminalSha256']);
    check(v.topicId===b.http.fixture.topicId&&UUID.test(v.initialBNotificationId)&&HEX.test(v.initialBHistorySha256));
    for(const key of ['baselineMessageIds','baselineNotificationIds','baselineHistorySha256']){
      keys(v[key],['a','b']);check(Object.values(v[key]).every(x=>(key==='baselineHistorySha256'?HEX:UUID).test(x)));
    }
    const ids=[v.initialBNotificationId,...Object.values(v.baselineMessageIds),...Object.values(v.baselineNotificationIds)];
    check(new Set(ids).size===ids.length);
    check(v.revision===(next==='baseline'?0:1)&&v.mode===(next==='baseline'?'inherit':'disabled'));
    for(const key of ['blockedMessageId','blockedNotificationId','controlMessageId','terminalSha256'])
      check(next==='baseline'?v[key]===null:(key==='terminalSha256'?HEX:UUID).test(v[key]));
    if(next!=='baseline'){
      check(stable(Object.fromEntries(['topicId','initialBNotificationId','initialBHistorySha256','baselineMessageIds','baselineNotificationIds','baselineHistorySha256'].map(k=>[k,v[k]])))
        ===stable(Object.fromEntries(['topicId','initialBNotificationId','initialBHistorySha256','baselineMessageIds','baselineNotificationIds','baselineHistorySha256'].map(k=>[k,saved[k]]))));
      const all=[...ids,v.blockedMessageId,v.blockedNotificationId,v.controlMessageId];check(new Set(all).size===all.length);
    }
    if(next==='rollback')check(stable(v)===stable(saved));
    return freeze(v);
  }
  return {
    runtimeEnabled:()=>runtime,
    async inspect(){
      try{
        live();const context={runtimeEnabled:runtime,phase:current,snapshotSha256:saved?sha(stable(saved)):null};
        const s=operation(),result=await wait(inspectParent({...context,signal:s}),s);
        check(stable(result)===stable({binding:b,...context}));return result;
      }catch{failed=true;throw Error('RT_CLIENT_PHASE_REFUSED');}
    },
    async dispatch(fn){
      try{live();if(blocked)await wait(blocked);live();active++;try{return await fn();}finally{active--;if(active===0)drained?.();}}
      catch{failed=true;throw Error('RT_CLIENT_PHASE_REFUSED');}
    },
    async transition(next,input){
      try{
        live();check(!blocked&&next===({initial:'baseline',baseline:'disabled',disabled:'rollback'})[current]);
        const exact=snapshot(input,next),expectedRuntime=next!=='rollback',s=operation();
        blocked=new Promise(r=>{release=r;});
        if(active)await wait(new Promise(r=>{drained=r;}),s);
        live();check(!s.aborted);const result=await wait(phaseParent({phase:next,snapshot:exact,runtimeEnabled:expectedRuntime,signal:s}),s);
        check(stable(result)===stable({binding:b,phase:next,snapshot:exact,runtimeEnabled:expectedRuntime}));
        runtime=result.runtimeEnabled;current=next;saved=exact;
      }catch{failed=true;throw Error('RT_CLIENT_PHASE_REFUSED');}
      finally{drained=null;release?.();release=null;blocked=null;}
    },
  };
}

export function assertRealtimeClientPhasePresentation(before,after){
  for(const label of ['oldWeb','oldWindows','newWeb','newWindows'])for(const key of ['sounds','cards',...(label.startsWith('old')?['legacyInserts']:[])]){
    const a=before[label]?.[key],b=after[label]?.[key];
    need(Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b===a,'RT_CLIENT_PHASE_ALERT_LEAK');
  }
}

/** BASELINE ONLY. Import/construction never starts a service or reads credentials.
 * Execute inside the bound Linux namespace. inspect must freshly establish the
 * exact processes/catalog/fixture, not echo this input. No CAS/rollback here.
 */
export async function runRealtimeClientBaseline(input){return runRealtimeClient(input,false);}
/** One lifetime, no reset/reseed. phase({phase,snapshot,runtimeEnabled,signal})
 * must fresh-check the owned checkpoint on the parent; rollback additionally
 * executes its pinned compatible runtime-off control ONCE before returning.
 * inspect returns {binding,phase,snapshotSha256,runtimeEnabled} from real guards.
 * Snapshots bind retained history prefixes, not whole-catalog equivalence.
 * Neither callback may echo its expected input as evidence.
 */
export async function runRealtimeClientPhases(input){
  need(typeof input?.phase==='function','RT_CLIENT_PHASE_REQUIRED');return runRealtimeClient(input,true);
}
async function runRealtimeClient(input,phases){
  need(typeof input?.inspect==='function','RT_CLIENT_INSPECT_REQUIRED');
  const binding=validateRealtimeClientBinding(input.binding),sources=validateRealtimeClientSources(input.sources);
  need(sources.digest===binding.sourceDigest,'RT_CLIENT_SOURCE_REFUSED');const credentials=validateRealtimeClientCredentials(binding,input.credentials);
  need(process.platform==='linux'&&await readlink('/proc/self/ns/net')===binding.executionNamespace,'RT_CLIENT_EXECUTION_NAMESPACE_REFUSED');
  need(process.versions.node.startsWith('22.'),'RT_CLIENT_NODE22_REQUIRED');
  const {parseNotificationFeedPageV2,parseNotificationFeedOpenV2,parseNotificationFeedEventV2}=realtimeClientFeedParsers(sources);
  const lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,AbortSignal.timeout(480000),...(input.signal?[input.signal]:[])]);
  const phaseGate=phases?createRealtimeClientPhaseGate({binding,inspect:input.inspect,phase:input.phase,signal}):null;
  let requests=0,failed=false,httpFailureStatus=null;const sockets=new Set(),clients=[],docs=[];
  const expected={binding,runtimeEnabled:true};
  const op=()=>AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  async function inspect(){try{const s=op();s.throwIfAborted();const p=await input.inspect({signal:s});s.throwIfAborted();need(stable(p)===stable(expected));}
    catch{throw Error('RT_CLIENT_TARGET_REFUSED');}}
  if(phases)inspect=()=>phaseGate.inspect();
  async function wait(check){const until=Date.now()+15000;while(!check()){
    need(!failed&&!signal.aborted&&Date.now()<until&&!docs.some(d=>d.snapshot().failed||d.snapshot().error),'RT_CLIENT_WAIT_REFUSED');
    await new Promise(resolve=>setTimeout(resolve,10));
  }}
  async function sdk(actor){
    await inspect();const jwt=credentials[actor];let connections=0;
    class BoundSocket extends WebSocket{
      constructor(address,protocols){
        need(++connections===1&&!signal.aborted,'RT_CLIENT_RECONNECT_REFUSED');const mapped=mapRealtimeSdkWebSocket(binding,jwt,address);
        super(mapped.url,protocols,{headers:mapped.headers,followRedirects:false,handshakeTimeout:10000,maxPayload:1048576});sockets.add(this);
        this.on('error',()=>{failed=true;});this.on('close',()=>{if(!signal.aborted)failed=true;});
      }
    }
    const transportFetch=createRealtimeSdkFetch({binding,actor,jwt,inspect,signal,op,
      admit(){need(++requests<=80&&!failed&&!signal.aborted,'RT_CLIENT_REQUEST_BUDGET');},
      refuse(status){failed=true;if(httpFailureStatus===null&&Number.isInteger(status)&&status>=100&&status<=599)httpFailureStatus=status;
        lifetime.abort();for(const socket of sockets)socket.terminate();}});
    const client=Supabase.createClient(HTTP_ORIGIN,jwt,{accessToken:async()=>jwt,
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:phases?
        (...args)=>phaseGate.dispatch(()=>transportFetch(...args)):transportFetch},
      realtime:{transport:BoundSocket,timeout:10000,logLevel:'error',logger(){},reconnectAfterMs:()=>600000}});
    clients.push(client);return client;
  }
  function observer(client,uid){
    let joined=false;const rows=new Map();let sequence=0;
    const channel=client.channel('qa-client-control:'+randomUUID()).on('postgres_changes',
      {event:'INSERT',schema:'public',table:'notification_feed_events_v2',filter:'recipient_id=eq.'+uid},payload=>{
        try{const event=parseNotificationFeedEventV2(payload.new,uid);need(rows.size<128);rows.set(event.event_id,{event,sequence:++sequence});}catch{failed=true;}
      }).subscribe(status=>{joined=status==='SUBSCRIBED';if(['CLOSED','TIMED_OUT','CHANNEL_ERROR'].includes(status)&&!signal.aborted)failed=true;});
    return {channel,rows,current:()=>joined&&channel.state==='joined'&&client.realtime.isConnected()};
  }
  function legacyObserver(client,uid){
    let joined=false,count=0;const ids=new Set();
    const channel=client.channel('qa-legacy-control:'+randomUUID()).on('postgres_changes',
      {event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+uid},payload=>{
        try{need(++count<=128&&payload.new.user_id===uid&&UUID.test(payload.new.id));ids.add(payload.new.id);}catch{failed=true;}
      }).subscribe(status=>{joined=status==='SUBSCRIBED';if(['CLOSED','TIMED_OUT','CHANNEL_ERROR'].includes(status)&&!signal.aborted)failed=true;});
    return {ids,count:()=>count,current:()=>joined&&channel.state==='joined'&&client.realtime.isConnected()};
  }
  try{
    const versions=await realtimeClientSdkVersions(),slots={};
    for(const [label,actor,generation,desktop] of [['oldWeb','a','old',false],['newWeb','a','current',false],
      ['oldWindows','a','old',true],['newWindows','a','current',true],['controlWeb','b','old',false],['controlWindows','b','old',true]])
      slots[label]={actor,generation,desktop,client:await sdk(actor)};
    const f=binding.http.fixture,initialLegacyIds={},initialLegacyRows={};
    for(const actor of ['a','b']){
      const client=slots[actor==='a'?'oldWeb':'controlWeb'].client,uid=f.actors[actor].uid;
      const parents=result(await client.from('chat_notification_preferences').select('chat_id,user_id,push_enabled,muted_until').eq('chat_id',f.chatId).eq('user_id',uid));
      need(stable(parents)===stable([{chat_id:f.chatId,user_id:uid,push_enabled:true,muted_until:null}]),'RT_CLIENT_PARENT_NOT_ALLOWED');
      need(stable(result(await client.rpc('topic_notification_preferences_read',{p_chat_id:f.chatId})))==='[]','RT_CLIENT_FIXTURE_NOT_PRISTINE');
      initialLegacyRows[actor]=result(await client.from('notifications').select('*').eq('user_id',uid).limit(30));
      initialLegacyIds[actor]=validateRealtimeClientInitialLegacy(binding,actor,initialLegacyRows[actor]);
    }
    const controls={oldWeb:observer(slots.oldWeb.client,f.actors.a.uid),oldWindows:observer(slots.oldWindows.client,f.actors.a.uid)};
    const legacyControls=phases?{oldWeb:legacyObserver(slots.oldWeb.client,f.actors.a.uid),oldWindows:legacyObserver(slots.oldWindows.client,f.actors.a.uid)}:{};
    for(const slot of Object.values(slots)){slot.doc=await mountRealtimeClientHook({...slot,sources,actor:f.actors[slot.actor]});docs.push(slot.doc);}
    await wait(()=>docs.every(d=>d.snapshot().ready)&&Object.values(controls).every(c=>c.current())&&Object.values(legacyControls).every(c=>c.current()));await inspect();
    const before=Object.fromEntries(Object.entries(slots).map(([k,v])=>[k,v.doc.snapshot()]));
    const produced={};
    for(const actor of ['b','a']){
      const id=randomUUID(),slot=slots[actor==='b'?'controlWeb':'oldWeb'];
      result(await slot.client.from('messages').insert({id,chat_id:f.chatId,user_id:f.actors[actor].uid,topic_id:f.topicId,type:'text',content:BODY}));
      produced[actor==='b'?'a':'b']=id;
    }
    await wait(()=>Object.entries(slots).every(([,s])=>s.doc.hasMessage(produced[s.actor])
      &&s.doc.snapshot()[s.desktop?'cards':'sounds']>before[Object.keys(slots).find(k=>slots[k]===s)][s.desktop?'cards':'sounds']));
    // Drain each SAME physical old-A SDK connection with the exact producer event
    // followed by a new random-ID marker. created_at/UUID are never watermarks.
    const page=parseNotificationFeedPageV2(result(await slots.newWeb.client.rpc('notification_feed_page_v2',{p_limit:30})),f.actors.a.uid);
    const note=page.rows.find(n=>n.payload?.message_id===produced.a);need(note,'RT_CLIENT_PRODUCER_ROW_MISSING');
    for(const [label,control] of Object.entries(controls)){
      await wait(()=>[...control.rows.values()].some(v=>v.event.event_kind==='created'&&v.event.notification_id===note.id));
      const created=[...control.rows.values()].find(v=>v.event.event_kind==='created'&&v.event.notification_id===note.id);
      const open=parseNotificationFeedOpenV2(result(await slots[label].client.rpc('notification_feed_open_v2',{p_limit:30,p_held_ids:[note.id]})),f.actors.a.uid,[note.id]);
      await wait(()=>control.rows.has(open.barrier_event_id));need(control.current()&&control.rows.get(open.barrier_event_id).sequence>created.sequence,'RT_CLIENT_SAME_SOCKET_DRAIN_REFUSED');
    }
    for(const actor of ['a','b']){
      const client=slots[actor==='a'?'oldWeb':'controlWeb'].client;
      const rows=result(await client.from('notifications').select('*').eq('user_id',f.actors[actor].uid).limit(30));
      need(Array.isArray(rows)&&rows.some(n=>n.user_id===f.actors[actor].uid&&n.payload?.message_id===produced[actor]),'RT_CLIENT_LEGACY_REST_POSITIVE_MISSING');
      if(actor==='b')validateRealtimeClientInitialLegacy(binding,'b',rows.filter(row=>row.id===initialLegacyIds.b));
    }
    await inspect();need(!failed&&docs.every(d=>d.snapshot().ready),'RT_CLIENT_FINAL_REFUSED');
    if(phases){
      const history=row=>sha(stable(Object.fromEntries(['id','user_id','kind','payload','read_at','created_at'].map(k=>[k,row[k]]))));
      const page=async actor=>parseNotificationFeedPageV2(result(await slots[actor==='a'?'newWeb':'controlWeb'].client.rpc('notification_feed_page_v2',{p_limit:30})),f.actors[actor].uid);
      const message=(messageId,rows)=>{
        const found=rows.filter(n=>n.kind==='message'&&n.payload?.message_id===messageId);
        need(found.length===1,'RT_CLIENT_PHASE_ROW_REQUIRED');return found[0];
      };
      const original={a:message(produced.a,(await page('a')).rows),b:message(produced.b,(await page('b')).rows)};
      await wait(()=>Object.values(legacyControls).every(c=>c.current()&&c.ids.has(original.a.id)));
      const checkpoint={topicId:f.topicId,revision:0,mode:'inherit',initialBNotificationId:initialLegacyIds.b,initialBHistorySha256:history(initialLegacyRows.b[0]),
        baselineMessageIds:{...produced},baselineNotificationIds:{a:original.a.id,b:original.b.id},
        baselineHistorySha256:{a:history(original.a),b:history(original.b)},blockedMessageId:null,blockedNotificationId:null,controlMessageId:null,terminalSha256:null};
      await phaseGate.transition('baseline',checkpoint);
      const counts=()=>Object.fromEntries(Object.entries(slots).map(([k,v])=>[k,{...v.doc.snapshot(),...(legacyControls[k]?{legacyInserts:legacyControls[k].count()}:{} )}]));
      const noOldAlerts=previous=>{
        need(Object.values(legacyControls).every(c=>c.current()),'RT_CLIENT_LEGACY_SOCKET_LOST');
        assertRealtimeClientPhasePresentation(previous,counts());
      };
      const sequence=()=>Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,Math.max(0,...[...c.rows.values()].map(x=>x.sequence))]));
      const drain=async previous=>{
        for(const [label,control] of Object.entries(controls)){
          const open=parseNotificationFeedOpenV2(result(await slots[label].client.rpc('notification_feed_open_v2',{p_limit:30,p_held_ids:[original.a.id]})),f.actors.a.uid,[original.a.id]);
          await wait(()=>control.rows.has(open.barrier_event_id));
          need(control.current()&&control.rows.get(open.barrier_event_id).sequence>previous[label],'RT_CLIENT_PHASE_DRAIN_REFUSED');
        }
        for(const doc of docs)await doc.drain();
      };
      const produce=async actor=>{const id=randomUUID();result(await slots[actor==='a'?'oldWeb':'controlWeb'].client.from('messages')
        .insert({id,chat_id:f.chatId,user_id:f.actors[actor].uid,topic_id:f.topicId,type:'text',content:BODY}));return id;};
      const controlPositive=async previous=>{
        const id=await produce('a');
        await wait(()=>['controlWeb','controlWindows'].every(label=>slots[label].doc.hasMessage(id)
          &&slots[label].doc.snapshot()[label==='controlWeb'?'sounds':'cards']>previous[label][label==='controlWeb'?'sounds':'cards']));return id;
      };
      const decisions=async(ids,revision)=>{
        const rows=result(await slots.newWeb.client.rpc('message_notification_alert_decisions',{p_notification_ids:ids}));
        need(Array.isArray(rows)&&stable([...rows].sort((a,b)=>String(a.notification_id).localeCompare(String(b.notification_id))))
          ===stable(ids.map(id=>({notification_id:id,allowed:false,scope_key:f.topicId,revision})).sort((a,b)=>a.notification_id.localeCompare(b.notification_id))),'RT_CLIENT_PHASE_DENIAL_REQUIRED');
      };
      const retained=async pages=>{
        for(const actor of ['a','b'])need(history(message(produced[actor],pages[actor]))===checkpoint.baselineHistorySha256[actor],'RT_CLIENT_PHASE_HISTORY_CHANGED');
        const rows=result(await slots.controlWeb.client.from('notifications').select('*').eq('user_id',f.actors.b.uid).limit(30));
        validateRealtimeClientInitialLegacy(binding,'b',rows.filter(n=>n.id===initialLegacyIds.b));
        need(history(rows.find(n=>n.id===initialLegacyIds.b))===checkpoint.initialBHistorySha256,'RT_CLIENT_PHASE_INITIAL_HISTORY_CHANGED');
      };
      const legacyDenied=async()=>need(stable(result(await slots.oldWeb.client.from('notifications').select('*').eq('user_id',f.actors.a.uid).limit(30)))==='[]','RT_CLIENT_LEGACY_REST_LEAK');
      const beforeDisable=counts(),beforeSequence=sequence();
      const ack=result(await slots.newWeb.client.rpc('topic_notification_preference_set',
        {p_chat_id:f.chatId,p_topic_id:f.topicId,p_mode:'disabled',p_expected_revision:0}));
      need(stable(ack)===stable({status:'applied',scope_key:f.topicId,mode:'disabled',revision:1}),'RT_CLIENT_CAS_UNKNOWN_NO_RETRY');
      need(stable(result(await slots.newWeb.client.rpc('topic_notification_preferences_read',{p_chat_id:f.chatId})))
        ===stable([{scope_key:f.topicId,mode:'disabled',revision:1}]),'RT_CLIENT_CAS_READBACK_REQUIRED');
      await wait(()=>Object.entries(controls).every(([label,c])=>[...c.rows.values()].some(x=>x.sequence>beforeSequence[label]&&x.event.event_kind==='invalidate')));
      const blocked=await produce('b'),control=await controlPositive(beforeDisable);
      await wait(()=>['newWeb','newWindows'].every(label=>slots[label].doc.hasMessage(blocked)));
      await drain(beforeSequence);const disabledPages={a:(await page('a')).rows,b:(await page('b')).rows};
      const blockedRow=message(blocked,disabledPages.a),terminal=message(produced.a,disabledPages.a);
      need(terminal.alert_suppressed_at!==null&&blockedRow.alert_suppressed_at!==null,'RT_CLIENT_TERMINAL_REQUIRED');
      await decisions([original.a.id,blockedRow.id],1);await legacyDenied();noOldAlerts(beforeDisable);await retained(disabledPages);
      const disabled={...checkpoint,revision:1,mode:'disabled',blockedMessageId:blocked,blockedNotificationId:blockedRow.id,
        controlMessageId:control,terminalSha256:sha(terminal.alert_suppressed_at)};
      await phaseGate.transition('disabled',disabled);
      const beforeRollback=counts(),rollbackSequence=sequence(),blockedHistory=history(blockedRow),blockedTerminal=blockedRow.alert_suppressed_at;
      // Parent executes the one reviewed rollback and proves runtime=false while
      // new HTTP is gated; existing sockets and already delivered callbacks stay.
      await phaseGate.transition('rollback',disabled);
      const rollbackMessage=await produce('b');await controlPositive(beforeRollback);
      await wait(()=>['newWeb','newWindows'].every(label=>slots[label].doc.hasMessage(rollbackMessage)));
      await drain(rollbackSequence);const rollbackPages={a:(await page('a')).rows,b:(await page('b')).rows};
      noOldAlerts(beforeRollback);await legacyDenied();await retained(rollbackPages);
      const after=message(produced.a,rollbackPages.a),afterBlocked=message(blocked,rollbackPages.a),rollbackRow=message(rollbackMessage,rollbackPages.a);
      need(sha(after.alert_suppressed_at)===disabled.terminalSha256&&history(afterBlocked)===blockedHistory
        &&afterBlocked.alert_suppressed_at===blockedTerminal&&rollbackRow.alert_suppressed_at!==null,'RT_CLIENT_ROLLBACK_REOPENED');
      await decisions([original.a.id,blockedRow.id,rollbackRow.id],1);
      await inspect();need(!failed&&docs.every(d=>d.snapshot().ready),'RT_CLIENT_FINAL_REFUSED');
      return {v:1,boundary:'REAL_SDK_ACTUAL_HOOK_CAS_ROLLBACK_ONLY',baselineAccepted:true,casDisableAccepted:true,rollbackAccepted:true,
        legacyMuteAccepted:false,fullstackAccepted:false,osAccepted:false,requests,phaseCount:3,runtimeEnabled:false,sameClientLifetime:true,
        sameJwtOldNewDocuments:true,sameOldSocketProducerAndMarker:true,
        pending:['reconnect/token refresh','inherit reset and allowed-scope presentation','held pre-CAS callback/response, not recall','fresh-fixture fence-omission variant','provider/physical OS acceptance']};
    }
    return {v:1,boundary:'REAL_SDK_ACTUAL_HOOK_BASELINE_ONLY',baselineAccepted:true,legacyMuteAccepted:false,fullstackAccepted:false,osAccepted:false,
      sourceDigest:sources.digest,legacyRevision:sources.legacyRevision,versions,requests,sameJwtOldNewDocuments:true,sameOldSocketProducerAndMarker:true,
      observations:Object.fromEntries(Object.entries(slots).map(([k,v])=>[k,v.doc.snapshot()])),
      pending:['disabled-CAS legacy denial and v2 retained history','rollback retained fence/history','preauthorized queued callback, not recall']};
  }catch{
    const prefix=phases?'RT_CLIENT_PHASE':'RT_CLIENT_BASELINE';
    const error=Error(httpFailureStatus===null?prefix+'_REFUSED_NO_RETRY':prefix+'_HTTP_STATUS_'+httpFailureStatus+'_ABORTED_NO_RETRY');
    if(httpFailureStatus!==null)error.status=httpFailureStatus;throw error;
  }
  finally{
    lifetime.abort();for(const doc of docs)doc.close();for(const socket of sockets)socket.terminate();
    await Promise.all(clients.map(async client=>{await client.removeAllChannels();client.realtime.disconnect();}));
  }
}
