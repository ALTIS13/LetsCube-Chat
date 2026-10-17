import {createHash,randomUUID} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {parseNotificationFeedPageV2,parseNotificationFeedLookupV2} from '../../artifacts/kub/src/lib/notificationFeedV2.ts';

// SOURCE PREPARATION: no allocation, seed, schema assembler or production fallback.
// A reviewed, self-contained bridge module must export attach({binding,candidate,signal}).
// candidate is the actual pinned assembler export {sql,sha256,inputs}; attach
// MUST NOT apply it implicitly. The clone must already have this candidate.
// It attaches ONLY to an existing owned clone and returns:
// {credentials:{a,a2,oldA,b}, inspect({signal}), http(request), control(request), close({signal})}.
// inspect MUST freshly run the existing clone/process/config/catalog/fixture guards,
// not echo caller input. Its exact fields are enforced below. http MUST perform
// actual HTTP on the bound clone's 127.0.0.1:3000, with bounded body/abort handling.
// control accepts ONLY retire-session, rollback, resume. Rollback uses the
// coordinator's reviewed assembler/manifest; no SQL is assembled in this helper.
// Fixture accounts/sessions/chat/topics MUST already be freshly owned/seeded.
// Parent A is permanently muted, B unmuted; global/privacy/access gates allow.
// fixtureDigest hashes the immutable owned seed identities, not the continued
// existence of oldA after this test deliberately retires that exact session.
// No policy result/allowed boolean is accepted from control or inspect.
// A network-none clone has no host HTTP port: the bridge is REQUIRED, not an
// invented public attestation endpoint. Realtime/provider/client gates are separate.
const PG_IMAGE='sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00';
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SYNTHETIC=/^70000000-0000-4000-8000-[0-9]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const fail=code=>{throw new Error(code);};
const need=(value,code='FULLSTACK_BINDING_REFUSED')=>{if(!value) fail(code);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a,b)=>canonical(a)===canonical(b);
function keys(value,expected) {
  need(value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...expected].sort()));
}
function freeze(value) {for(const item of Object.values(value)) if(item&&typeof item==='object') freeze(item);return Object.freeze(value);}
export function validateBinding(input) {
  keys(input,['v','owner','sourceContainerId','target','sourceCatalogSha256','restoreCatalogSha256','candidateDigest','rollbackDigest','fixture']);
  need(input.v===1&&/^topic-alerts-fullstack-[0-9]{8}-r[1-9][0-9]*$/.test(input.owner));
  for(const key of ['sourceContainerId','sourceCatalogSha256','restoreCatalogSha256','candidateDigest','rollbackDigest']) need(HEX.test(input[key]));
  need(input.sourceCatalogSha256===input.restoreCatalogSha256,'FULLSTACK_RESTORE_NOT_EQUIVALENT');
  const target=input.target;
  keys(target,['containerId','image','startedAt','cluster','postgrestPid','postgrestStartTicks','postgrestBinarySha256','postgrestConfigSha256',
    'httpPort','network','publishedPorts','productionMounts']);
  need(HEX.test(target.containerId)&&target.containerId!==input.sourceContainerId&&target.image===PG_IMAGE);
  need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z$/.test(target.startedAt)&&/^[1-9][0-9]{10,19}$/.test(target.cluster));
  need(Number.isSafeInteger(target.postgrestPid)&&target.postgrestPid>0&&/^(0|[1-9][0-9]{0,19})$/.test(target.postgrestStartTicks));
  need(HEX.test(target.postgrestBinarySha256)&&HEX.test(target.postgrestConfigSha256)&&target.httpPort===3000);
  need(target.network==='none'&&Array.isArray(target.publishedPorts)&&target.publishedPorts.length===0
    &&Array.isArray(target.productionMounts)&&target.productionMounts.length===0);
  const f=input.fixture;
  keys(f,['chatId','topicId','enabledTopicId','generalTopicId','actors']);keys(f.actors,['a','a2','oldA','b']);
  const ids=['chatId','topicId','enabledTopicId','generalTopicId'].map(key=>f[key]);
  for(const name of ['a','a2','oldA','b']) {
    keys(f.actors[name],['uid','sid']);need(SYNTHETIC.test(f.actors[name].uid)&&SYNTHETIC.test(f.actors[name].sid));
  }
  need(f.actors.a.uid===f.actors.a2.uid&&f.actors.a.uid===f.actors.oldA.uid&&f.actors.a.uid!==f.actors.b.uid);
  ids.push(f.actors.a.uid,f.actors.b.uid,...Object.values(f.actors).map(actor=>actor.sid));
  need(ids.every(id=>SYNTHETIC.test(id))&&new Set(ids).size===ids.length);
  return freeze(structuredClone(input));
}
function validateCredentials(binding,input) {
  keys(input,['a','a2','oldA','b']);const now=Math.floor(Date.now()/1000);
  for(const name of Object.keys(input)) {
    const token=input[name];need(typeof token==='string'&&token.length<=8192,'FULLSTACK_FIXTURE_AUTH_REFUSED');
    try {
      const parts=token.split('.');need(parts.length===3&&parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)));
      const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
      const actor=binding.fixture.actors[name];
      need(header.alg==='HS256'&&claims.role==='authenticated'&&claims.iss===binding.owner
        &&claims.sub===actor.uid&&claims.session_id===actor.sid
        &&Number.isSafeInteger(claims.exp)&&claims.exp>=now+240&&claims.exp<=now+3600);
    } catch {fail('FULLSTACK_FIXTURE_AUTH_REFUSED');}
  }
  // Claims only confine fixture identities. Actual PostgREST must validate the
  // isolated signing key; decoding a JWT is NOT authentication acceptance.
  return {...input};
}
const RPCS=new Set(['topic_notification_preferences_read','topic_notification_preference_set',
  'message_notification_alert_decisions','notification_feed_page_v2','notification_feed_lookup_v2']);
function snapshotBody(input) {
  try {
    const wire=JSON.stringify(input);
    need(typeof wire==='string'&&Buffer.byteLength(wire)<=65536);
    return {body:freeze(JSON.parse(wire)),wire};
  } catch {fail('FULLSTACK_BODY_REFUSED');}
}
export function createChannel(input,bridge) {
  const binding=validateBinding(input),credentials=validateCredentials(binding,bridge.credentials);
  for(const method of ['inspect','http','control','close']) need(typeof bridge[method]==='function','FULLSTACK_BRIDGE_INTERFACE_REQUIRED');
  let deadline,requests=0,runtimeEnabled=true;
  const signal=()=>AbortSignal.any([deadline??=AbortSignal.timeout(180_000),AbortSignal.timeout(15_000)]);
  const expected={owner:binding.owner,sourceContainerId:binding.sourceContainerId,target:binding.target,
    sourceCatalogSha256:binding.sourceCatalogSha256,restoreCatalogSha256:binding.restoreCatalogSha256,
    candidateDigest:binding.candidateDigest,rollbackDigest:binding.rollbackDigest,fixtureDigest:digest(canonical(binding.fixture))};
  async function inspect() {
    let proof;try {proof=await bridge.inspect({signal:signal()});} catch {fail('FULLSTACK_TARGET_UNAVAILABLE');}
    need(same(proof,{...expected,runtimeEnabled}),'FULLSTACK_TARGET_DRIFT');
  }
  async function send(actor,path,body,expectedStatus=200,method='POST') {
    need(Object.hasOwn(credentials,actor),'FULLSTACK_FIXTURE_AUTH_REFUSED');
    need(method==='GET'?body===null:typeof body==='string','FULLSTACK_BODY_REFUSED');
    need(!deadline?.aborted&&++requests<=80,'FULLSTACK_HTTP_BUDGET');await inspect();
    let response;
    try {response=await bridge.http({method,path,address:'127.0.0.1',port:3000,
      headers:{Authorization:'Bearer '+credentials[actor],'Content-Type':'application/json',Accept:'application/json',
        ...(path==='/messages'?{Prefer:'return=minimal'}:{})},
      body,signal:signal()});}
    catch {fail('FULLSTACK_HTTP_UNAVAILABLE_NO_RETRY');}
    await inspect();
    need(response&&Number.isInteger(response.status)&&typeof response.body==='string'
      &&Buffer.byteLength(response.body)<=65536,'FULLSTACK_HTTP_PROTOCOL');
    let value;try {value=response.body===''?null:JSON.parse(response.body);} catch {fail('FULLSTACK_HTTP_PROTOCOL');}
    need(response.status===expectedStatus||(expectedStatus==='refused'&&response.status>=400&&response.status<=599),'FULLSTACK_HTTP_STATUS');return value;
  }
  return {
    binding,inspect,
    async assertParents() {
      for(const actor of ['a','b']) {
        const uid=binding.fixture.actors[actor].uid;
        const value=await send(actor,'/chat_notification_preferences?select=chat_id,user_id,push_enabled,muted_until&chat_id=eq.'+
          binding.fixture.chatId+'&user_id=eq.'+uid,null,200,'GET');
        need(same(value,[{chat_id:binding.fixture.chatId,user_id:uid,push_enabled:actor==='b',muted_until:null}]),'FULLSTACK_PARENT_FIXTURE_REFUSED');
      }
    },
    rpc(actor,name,args={},expectedStatus=200) {
      need(RPCS.has(name),'FULLSTACK_RPC_REFUSED');
      // Validate the exact frozen JSON representation sent below, before any
      // await or caller mutation, including getters/toJSON and nested arrays.
      const {body,wire}=snapshotBody(args);
      if(name==='topic_notification_preferences_read'||name==='topic_notification_preference_set') {
        keys(body,name==='topic_notification_preferences_read'?['p_chat_id']:['p_chat_id','p_topic_id','p_mode','p_expected_revision']);
        need(body.p_chat_id===binding.fixture.chatId,'FULLSTACK_SCOPE_REFUSED');
        if(name==='topic_notification_preference_set') {
          need(body.p_topic_id===null||[binding.fixture.topicId,binding.fixture.enabledTopicId,binding.fixture.generalTopicId].includes(body.p_topic_id),'FULLSTACK_SCOPE_REFUSED');
          need(['inherit','enabled','disabled'].includes(body.p_mode)&&Number.isSafeInteger(body.p_expected_revision)
            &&body.p_expected_revision>=0,'FULLSTACK_BODY_REFUSED');
        }
      } else if(name==='notification_feed_page_v2') {
        keys(body,['p_limit']);need(Number.isInteger(body.p_limit)&&body.p_limit>=1&&body.p_limit<=30,'FULLSTACK_BODY_REFUSED');
      } else {
        const key=name==='notification_feed_lookup_v2'?'p_ids':'p_notification_ids';keys(body,[key]);
        need(Array.isArray(body[key])&&body[key].length>=1&&body[key].length<=100
          &&body[key].every(value=>typeof value==='string'&&UUID.test(value)),'FULLSTACK_BODY_REFUSED');
      }
      return send(actor,'/rpc/'+name,wire,expectedStatus);
    },
    async produce(actor,topicId) {
      need([binding.fixture.topicId,binding.fixture.enabledTopicId].includes(topicId),'FULLSTACK_SCOPE_REFUSED');
      const id=randomUUID(),{wire}=snapshotBody({id,chat_id:binding.fixture.chatId,
        user_id:binding.fixture.actors[actor]?.uid,topic_id:topicId,type:'text',content:'fictional topic alert acceptance'});
      await send(actor,'/messages',wire,201);return id;
    },
    async control(operation) {
      need(['retire-session','rollback','resume'].includes(operation),'FULLSTACK_CONTROL_REFUSED');await inspect();
      const args=operation==='retire-session'?binding.fixture.actors.oldA:{digest:operation==='rollback'?binding.rollbackDigest:binding.candidateDigest};
      try {await bridge.control({operation,args,signal:signal()});} catch {fail('FULLSTACK_CONTROL_UNAVAILABLE');}
      if(operation!=='retire-session') runtimeEnabled=operation==='resume';await inspect();
    },
    async close() {try {await bridge.close({signal:AbortSignal.timeout(5000)});} catch {fail('FULLSTACK_BRIDGE_CLOSE_UNAVAILABLE');}},
    receipt:()=>({boundary:'HTTP_CAS_SESSION_ROLLBACK_ONLY',fullstackAccepted:false,requests}),
  };
}
async function pinnedFile(path,expected,max) {
  need(typeof path==='string'&&isAbsolute(path)&&HEX.test(expected),'FULLSTACK_PIN_REQUIRED');
  try {
    const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink()&&info.size<=max);
    const bytes=await readFile(path);need(digest(bytes)===expected);return bytes;
  } catch {fail('FULLSTACK_FILE_PIN_REFUSED');}
}
export async function loadBoundCandidate(input) {
  const binding=validateBinding(input);let candidate;
  try {
    const {loadTopicNotificationCandidate}=await import('../../scripts/topic-notification-candidate.mjs');
    candidate=await loadTopicNotificationCandidate();
  } catch {fail('FULLSTACK_CANDIDATE_UNAVAILABLE');}
  need(candidate.sha256===binding.candidateDigest,'FULLSTACK_CANDIDATE_DRIFT');
  return Object.freeze(candidate);
}
export async function loadRuntime(env) {
  need(env.LETSCUBE_TOPIC_FULLSTACK_RUN==='http'&&env.LETSCUBE_TOPIC_FULLSTACK_SELFTEST===undefined
    &&env.KUB_QA_ALLOW_MUTATIONS==='0','FULLSTACK_EXPLICIT_HTTP_MODE_REQUIRED');
  for(const name of ['BINDING','BINDING_SHA256','DRIVER','DRIVER_SHA256']) need(env['LETSCUBE_TOPIC_FULLSTACK_'+name],'FULLSTACK_PIN_REQUIRED');
  const bytes=await pinnedFile(env.LETSCUBE_TOPIC_FULLSTACK_BINDING,env.LETSCUBE_TOPIC_FULLSTACK_BINDING_SHA256,65536);
  let binding;try {binding=validateBinding(JSON.parse(bytes));} catch {fail('FULLSTACK_BINDING_REFUSED');}
  const candidate=await loadBoundCandidate(binding);
  const code=await pinnedFile(env.LETSCUBE_TOPIC_FULLSTACK_DRIVER,env.LETSCUBE_TOPIC_FULLSTACK_DRIVER_SHA256,262144);
  let bridge;
  try {
    const module=await import('data:text/javascript;base64,'+code.toString('base64'));
    need(typeof module.attach==='function');bridge=await module.attach({binding,candidate,signal:AbortSignal.timeout(15_000)});
  } catch {fail('FULLSTACK_BRIDGE_ATTACH_REFUSED');}
  try {return createChannel(binding,bridge);} catch {fail('FULLSTACK_BRIDGE_FIXTURE_REFUSED');}
}

export async function runHttpSlice(channel) {
  const {binding:b}=channel,f=b.fixture,own=b.fixture.actors.a.uid;
  const read=actor=>channel.rpc(actor,'topic_notification_preferences_read',{p_chat_id:f.chatId});
  const set=(actor,mode,revision,topic=f.topicId,status=200)=>channel.rpc(actor,'topic_notification_preference_set',
    {p_chat_id:f.chatId,p_topic_id:topic,p_mode:mode,p_expected_revision:revision},status);
  const row=(value,status,scope,mode,revision)=>need(same(value,{status,scope_key:scope,mode,revision}),'FULLSTACK_CAS_ASSERTION');
  const ownRows=async(actor,expected)=>need(same(await read(actor),expected),'FULLSTACK_OWN_READ_ASSERTION');
  const error=(value,code,message)=>need(value?.code===code&&value.message===message,'FULLSTACK_REFUSAL_ASSERTION');
  const lookup=async id=>{
    const value=parseNotificationFeedLookupV2(await channel.rpc('a','notification_feed_lookup_v2',{p_ids:[id]}),own,[id]);
    need(value.rows.length===1&&value.unavailable_ids.length===0,'FULLSTACK_FEED_ASSERTION');return value.rows[0];
  };
  const stable=value=>digest(canonical(Object.fromEntries(['id','user_id','kind','payload','read_at','created_at'].map(key=>[key,value[key]]))));
  const decision=async(id,allowed,scope,revision)=>{
    const rows=await channel.rpc('a','message_notification_alert_decisions',{p_notification_ids:[id]});
    need(Array.isArray(rows)&&rows.length===1&&same(Object.keys(rows[0]).sort(),['allowed','notification_id','revision','scope_key'])
      &&rows[0].notification_id===id&&rows[0].allowed===allowed
      &&rows[0].scope_key===scope&&rows[0].revision===revision,'FULLSTACK_DECISION_ASSERTION');
  };
  const produce=async topic=>{
    const message=await channel.produce('b',topic);
    const page=parseNotificationFeedPageV2(await channel.rpc('a','notification_feed_page_v2',{p_limit:30}),own);
    const rows=page.rows.filter(note=>note.kind==='message'&&note.payload?.message_id===message);
    need(rows.length===1,'FULLSTACK_REAL_PRODUCER_ASSERTION');return rows[0];
  };
  try {
    await channel.inspect();await channel.assertParents();await ownRows('a',[]);await ownRows('b',[]);await ownRows('oldA',[]);
    row(await set('a','enabled',0),'applied',f.topicId,'enabled',1);
    await ownRows('a2',[{scope_key:f.topicId,mode:'enabled',revision:1}]);
    row(await set('a2','disabled',0),'conflict',f.topicId,'enabled',1);
    row(await set('b','enabled',0),'applied',f.topicId,'enabled',1);
    await ownRows('b',[{scope_key:f.topicId,mode:'enabled',revision:1}]);
    const first=await produce(f.topicId),firstStable=stable(first);await decision(first.id,true,f.topicId,1);
    row(await set('a','disabled',1),'applied',f.topicId,'disabled',2);await decision(first.id,false,f.topicId,2);
    const terminal=await lookup(first.id);need(terminal.alert_suppressed_at!==null,'FULLSTACK_TERMINAL_ASSERTION');
    row(await set('a2','enabled',2),'applied',f.topicId,'enabled',3);await decision(first.id,false,f.topicId,3);
    const fresh=await produce(f.topicId);await decision(fresh.id,true,f.topicId,3);
    row(await set('a','disabled',0,null),'applied','general','disabled',1);
    row(await set('a2','enabled',0,f.generalTopicId),'conflict','general','disabled',1);
    await ownRows('b',[{scope_key:f.topicId,mode:'enabled',revision:1}]);
    await channel.control('retire-session');
    error(await channel.rpc('oldA','topic_notification_preferences_read',{p_chat_id:f.chatId},403),'42501','topic_notification_session_invalid');
    error(await set('oldA','disabled',3,f.topicId,403),'42501','topic_notification_session_invalid');
    row(await set('a','disabled',3),'applied',f.topicId,'disabled',4);
    row(await set('a','enabled',0,f.enabledTopicId),'applied',f.enabledTopicId,'enabled',1);
    const enabled=await produce(f.enabledTopicId);await decision(enabled.id,true,f.enabledTopicId,1);
    const before=await read('a');
    await channel.control('rollback');
    error(await set('a','enabled',4,f.topicId,'refused'),'55000','topic_notifications_unavailable');
    error(await channel.rpc('a','topic_notification_preferences_read',{p_chat_id:f.chatId},'refused'),'55000','topic_notifications_unavailable');
    // SQL preserves identity/current CAS metadata on terminal/runtime-off denial
    // while source visibility is intact; these fixtures never revoke access.
    await decision(first.id,false,f.topicId,4);await decision(fresh.id,false,f.topicId,4);await decision(enabled.id,false,f.enabledTopicId,1);
    await channel.control('resume');await ownRows('a2',before);
    await decision(first.id,false,f.topicId,4);await decision(fresh.id,false,f.topicId,4);await decision(enabled.id,false,f.enabledTopicId,1);
    row(await set('a','enabled',4),'applied',f.topicId,'enabled',5);await decision(first.id,false,f.topicId,5);
    need(stable(await lookup(first.id))===firstStable,'FULLSTACK_HISTORY_CHANGED');
    need((await lookup(first.id)).alert_suppressed_at===terminal.alert_suppressed_at,'FULLSTACK_TERMINAL_CLEARED');
    const after=await produce(f.topicId);await decision(after.id,true,f.topicId,5);
    return channel.receipt();
  } catch(error) {
    // Never allow a parser/bridge assertion to dump private row/token values.
    if(error instanceof Error&&/^FULLSTACK_[A-Z_]+$/.test(error.message)) throw error;
    fail('FULLSTACK_HTTP_SLICE_REFUSED');
  } finally {await channel.close();}
}
