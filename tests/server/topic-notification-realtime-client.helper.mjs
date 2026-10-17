import {randomUUID} from 'node:crypto';
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

/** BASELINE ONLY. Import/construction never starts a service or reads credentials.
 * Execute inside the bound Linux namespace. inspect must freshly establish the
 * exact processes/catalog/fixture, not echo this input. No CAS/rollback here.
 */
export async function runRealtimeClientBaseline(input){
  need(typeof input?.inspect==='function','RT_CLIENT_INSPECT_REQUIRED');
  const binding=validateRealtimeClientBinding(input.binding),sources=validateRealtimeClientSources(input.sources);
  need(sources.digest===binding.sourceDigest,'RT_CLIENT_SOURCE_REFUSED');const credentials=validateRealtimeClientCredentials(binding,input.credentials);
  need(process.platform==='linux'&&await readlink('/proc/self/ns/net')===binding.executionNamespace,'RT_CLIENT_EXECUTION_NAMESPACE_REFUSED');
  need(process.versions.node.startsWith('22.'),'RT_CLIENT_NODE22_REQUIRED');
  const {parseNotificationFeedPageV2,parseNotificationFeedOpenV2,parseNotificationFeedEventV2}=realtimeClientFeedParsers(sources);
  const lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,AbortSignal.timeout(480000),...(input.signal?[input.signal]:[])]);
  let requests=0,failed=false,httpFailureStatus=null;const sockets=new Set(),clients=[],docs=[];
  const expected={binding,runtimeEnabled:true};
  const op=()=>AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  async function inspect(){try{const s=op();s.throwIfAborted();const p=await input.inspect({signal:s});s.throwIfAborted();need(stable(p)===stable(expected));}
    catch{throw Error('RT_CLIENT_TARGET_REFUSED');}}
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
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transportFetch},
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
  try{
    const versions=await realtimeClientSdkVersions(),slots={};
    for(const [label,actor,generation,desktop] of [['oldWeb','a','old',false],['newWeb','a','current',false],
      ['oldWindows','a','old',true],['newWindows','a','current',true],['controlWeb','b','old',false],['controlWindows','b','old',true]])
      slots[label]={actor,generation,desktop,client:await sdk(actor)};
    const f=binding.http.fixture,initialLegacyIds={};
    for(const actor of ['a','b']){
      const client=slots[actor==='a'?'oldWeb':'controlWeb'].client,uid=f.actors[actor].uid;
      const parents=result(await client.from('chat_notification_preferences').select('chat_id,user_id,push_enabled,muted_until').eq('chat_id',f.chatId).eq('user_id',uid));
      need(stable(parents)===stable([{chat_id:f.chatId,user_id:uid,push_enabled:true,muted_until:null}]),'RT_CLIENT_PARENT_NOT_ALLOWED');
      need(stable(result(await client.rpc('topic_notification_preferences_read',{p_chat_id:f.chatId})))==='[]','RT_CLIENT_FIXTURE_NOT_PRISTINE');
      initialLegacyIds[actor]=validateRealtimeClientInitialLegacy(binding,actor,
        result(await client.from('notifications').select('*').eq('user_id',uid).limit(30)));
    }
    const controls={oldWeb:observer(slots.oldWeb.client,f.actors.a.uid),oldWindows:observer(slots.oldWindows.client,f.actors.a.uid)};
    for(const slot of Object.values(slots)){slot.doc=await mountRealtimeClientHook({...slot,sources,actor:f.actors[slot.actor]});docs.push(slot.doc);}
    await wait(()=>docs.every(d=>d.snapshot().ready)&&Object.values(controls).every(c=>c.current()));await inspect();
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
    return {v:1,boundary:'REAL_SDK_ACTUAL_HOOK_BASELINE_ONLY',baselineAccepted:true,legacyMuteAccepted:false,fullstackAccepted:false,osAccepted:false,
      sourceDigest:sources.digest,legacyRevision:sources.legacyRevision,versions,requests,sameJwtOldNewDocuments:true,sameOldSocketProducerAndMarker:true,
      observations:Object.fromEntries(Object.entries(slots).map(([k,v])=>[k,v.doc.snapshot()])),
      pending:['disabled-CAS legacy denial and v2 retained history','rollback retained fence/history','preauthorized queued callback, not recall']};
  }catch{
    const error=Error(httpFailureStatus===null?'RT_CLIENT_BASELINE_REFUSED_NO_RETRY':'RT_CLIENT_BASELINE_HTTP_STATUS_'+httpFailureStatus+'_ABORTED_NO_RETRY');
    if(httpFailureStatus!==null)error.status=httpFailureStatus;throw error;
  }
  finally{
    lifetime.abort();for(const doc of docs)doc.close();for(const socket of sockets)socket.terminate();
    await Promise.all(clients.map(async client=>{await client.removeAllChannels();client.realtime.disconnect();}));
  }
}
