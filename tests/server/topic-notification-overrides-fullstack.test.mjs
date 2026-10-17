import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const url=new URL('./topic-notification-fullstack.helper.mjs',import.meta.url);
const helper=existsSync(url)?await import(url.href):{};
const id=n=>'70000000-0000-4000-8000-'+String(n).padStart(12,'0');
function binding() {
  return {v:1,owner:'topic-alerts-fullstack-20261017-r3',sourceContainerId:'a'.repeat(64),
    target:{containerId:'b'.repeat(64),image:'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00',
      startedAt:'2026-10-17T00:00:00.000000000Z',cluster:'7000000000000000001',postgrestPid:42,postgrestStartTicks:'100',
      postgrestBinarySha256:'c'.repeat(64),postgrestConfigSha256:'d'.repeat(64),httpPort:3000,network:'none',publishedPorts:[],productionMounts:[]},
    sourceCatalogSha256:'e'.repeat(64),restoreCatalogSha256:'e'.repeat(64),candidateDigest:'f'.repeat(64),rollbackDigest:'0'.repeat(64),
    fixture:{chatId:id(10),topicId:id(20),enabledTopicId:id(21),generalTopicId:id(22),
      actors:{a:{uid:id(1),sid:id(30)},a2:{uid:id(1),sid:id(31)},oldA:{uid:id(1),sid:id(32)},b:{uid:id(2),sid:id(33)}}}};
}
function credentials(b) {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return Object.fromEntries(Object.entries(b.fixture.actors).map(([key,actor])=>[key,
    encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:actor.uid,session_id:actor.sid,role:'authenticated',iss:b.owner,
      exp:Math.floor(Date.now()/1000)+600})+'.fictional_signature']));
}
function fixtureProof(b) {
  // Independent manifest encoding for this fictional admission fixture, not a
  // policy/HTTP success oracle and not a real clone or authentication receipt.
  const {a,a2,b:other,oldA}=b.fixture.actors,actor=x=>({sid:x.sid,uid:x.uid});
  const fixture={actors:{a:actor(a),a2:actor(a2),b:actor(other),oldA:actor(oldA)},chatId:b.fixture.chatId,
    enabledTopicId:b.fixture.enabledTopicId,generalTopicId:b.fixture.generalTopicId,topicId:b.fixture.topicId};
  return {owner:b.owner,sourceContainerId:b.sourceContainerId,target:structuredClone(b.target),
    sourceCatalogSha256:b.sourceCatalogSha256,restoreCatalogSha256:b.restoreCatalogSha256,candidateDigest:b.candidateDigest,
    rollbackDigest:b.rollbackDigest,fixtureDigest:createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),runtimeEnabled:true};
}
function port(b,options={}) {
  const calls={inspect:0,http:0,control:0},proof=fixtureProof(b);
  const bridge={credentials:credentials(b),inspect:async()=>{calls.inspect++;return structuredClone(proof);},
    http:async()=>{calls.http++;return{status:200,body:'[]'};},control:async()=>{calls.control++;},close:async()=>{},...options};
  return {bridge,calls,proof};
}
async function driftAfterResponse(module=helper) {
  const b=binding(),p=port(b);
  p.bridge.inspect=async()=>{p.calls.inspect++;const result=structuredClone(p.proof);if(p.calls.inspect===2) result.target.postgrestStartTicks='101';return result;};
  const channel=module.createChannel(b,p.bridge);
  await assert.rejects(()=>channel.rpc('a','topic_notification_preferences_read',{p_chat_id:b.fixture.chatId}),/FULLSTACK_TARGET_DRIFT/);
  assert.equal(p.calls.http,1);
}
async function heldBody(kind,module=helper) {
  const b=binding(),p=port(b);let enter,release,transportBody;
  const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
  p.bridge.inspect=async()=>{if(++p.calls.inspect===1) {enter();await held;}return structuredClone(p.proof);};
  p.bridge.http=async request=>{p.calls.http++;transportBody=JSON.parse(request.body);return{status:200,body:'[]'};};
  const channel=module.createChannel(b,p.bridge);
  const args=kind==='setter'?{p_chat_id:b.fixture.chatId,p_topic_id:b.fixture.topicId,p_mode:'enabled',p_expected_revision:0}
    :{p_ids:[id(100)]};
  const expected=structuredClone(args),pending=channel.rpc('a',kind==='setter'?'topic_notification_preference_set':'notification_feed_lookup_v2',args);
  await entered;
  if(kind==='setter') Object.assign(args,{p_chat_id:id(999),p_topic_id:id(998),p_mode:'disabled',p_expected_revision:99});
  else {args.p_ids[0]=id(999);args.p_ids.push(null);}
  args.extra='must not cross the transport boundary';release();await pending;
  assert.deepEqual(transportBody,expected);assert.equal(p.calls.http,1);
}
async function decisionFrame(which,change=()=>{},module=helper) {
  // Fictional response-contract prefix only. It always stops, never produces an
  // HTTP/fullstack success receipt or substitutes for SQL policy acceptance.
  const b=binding(),f=b.fixture;let reads=0,sets=0,decisions=0,closed=false;
  const pref={scope_key:f.topicId,mode:'enabled',revision:1};
  const cas=[{status:'applied',...pref},{status:'conflict',...pref},{status:'applied',...pref},
    {status:'applied',scope_key:f.topicId,mode:'disabled',revision:2}];
  const channel={binding:b,inspect:async()=>{},assertParents:async()=>{},produce:async()=>id(100),close:async()=>{closed=true;},
    rpc:async(_actor,name)=>{
      if(decisions===which) throw Error('FULLSTACK_TEST_AFTER_DECISION');
      if(name==='topic_notification_preferences_read') return ++reads<=3?[]:[pref];
      if(name==='topic_notification_preference_set') return cas[sets++];
      if(name==='notification_feed_page_v2') return {v:2,next:null,rows:[{id:id(101),user_id:f.actors.a.uid,kind:'message',
        payload:{message_id:id(100)},read_at:null,created_at:'2026-10-17T00:00:00.000001Z',alert_suppressed_at:null,feed_revision:1}]};
      if(name==='message_notification_alert_decisions') {
        const row={notification_id:id(101),allowed:++decisions===1,scope_key:f.topicId,revision:decisions===1?1:2};
        if(decisions===which) change(row);return[row];
      }
      throw Error('FULLSTACK_TEST_UNEXPECTED_RPC');
    }};
  try {await module.runHttpSlice(channel);} finally {assert.equal(closed,true);}
}

if(process.env.LETSCUBE_TOPIC_FULLSTACK_SELFTEST==='1'&&process.env.LETSCUBE_TOPIC_FULLSTACK_RUN===undefined) {
  test('admission refuses absent isolated binding without production configuration fallback',async()=>{
    assert.equal(typeof helper.loadRuntime,'function','FULLSTACK_ADMISSION_REQUIRED');
    await assert.rejects(()=>helper.loadRuntime({SUPABASE_URL:'https://production.invalid',SUPABASE_SERVICE_ROLE_KEY:'fictional'}),
      error=>error.message==='FULLSTACK_EXPLICIT_HTTP_MODE_REQUIRED');
  });
  test('runtime uses the real six-draft candidate export and refuses a different digest',async()=>{
    const {loadTopicNotificationCandidate}=await import('../../scripts/topic-notification-candidate.mjs');
    const candidate=await loadTopicNotificationCandidate(),b=binding();
    b.candidateDigest=candidate.sha256;
    const bound=await helper.loadBoundCandidate(b);
    assert.equal(bound.sha256,candidate.sha256);assert.equal(bound.sql,candidate.sql);
    assert.equal(bound.inputs.length,6);assert.deepEqual(bound.inputs,candidate.inputs);
    b.candidateDigest='0'.repeat(64);
    await assert.rejects(()=>helper.loadBoundCandidate(b),/FULLSTACK_CANDIDATE_DRIFT/);
  });
  for(const env of [
    {LETSCUBE_TOPIC_FULLSTACK_RUN:'http',KUB_QA_ALLOW_MUTATIONS:'0'},
    {LETSCUBE_TOPIC_FULLSTACK_RUN:'http',LETSCUBE_TOPIC_FULLSTACK_SELFTEST:'1',KUB_QA_ALLOW_MUTATIONS:'0'},
    {LETSCUBE_TOPIC_FULLSTACK_RUN:'http',KUB_QA_ALLOW_MUTATIONS:'1'},
  ]) test('incomplete or ambiguous execution inputs refuse before attach/HTTP',async()=>{
    await assert.rejects(()=>helper.loadRuntime(env),/FULLSTACK_(PIN_REQUIRED|EXPLICIT_HTTP_MODE_REQUIRED)/);
  });
  for(const [name,change] of [
    ['source container',b=>b.target.containerId=b.sourceContainerId],
    ['network',b=>b.target.network='bridge'],['host port',b=>b.target.publishedPorts=[3000]],
    ['production mount',b=>b.target.productionMounts=['/production']],
    ['restoration drift',b=>b.restoreCatalogSha256='0'.repeat(64)],
    ['image',b=>b.target.image='sha256:'+'0'.repeat(64)],['process',b=>b.target.postgrestStartTicks=''],
    ['foreign fixture UID',b=>b.fixture.actors.a.uid='12345678-1234-4234-8234-123456789012'],
    ['same session',b=>b.fixture.actors.a2.sid=b.fixture.actors.a.sid],
    ['unknown metadata',b=>b.productionUrl='https://production.invalid'],
  ]) test(`admission rejects ${name} before bridge I/O`,()=>{
    const b=binding(),p=port(b);change(b);
    assert.throws(()=>helper.createChannel(b,p.bridge),/FULLSTACK_/);assert.deepEqual(p.calls,{inspect:0,http:0,control:0});
  });
  test('foreign JWT issuer refuses locally; decoded claims never grant authentication',()=>{
    const b=binding(),p=port(b),foreign={...b,owner:'not-the-owned-clone'};
    p.bridge.credentials=credentials(foreign);
    assert.throws(()=>helper.createChannel(b,p.bridge),/FULLSTACK_FIXTURE_AUTH_REFUSED/);assert.equal(p.calls.http,0);
  });
  test('construction is inert and target/scope mutation cannot redirect a request',async()=>{
    const b=binding(),p=port(b),channel=helper.createChannel(b,p.bridge);
    b.target.containerId='0'.repeat(64);assert.equal(channel.binding.target.containerId,'b'.repeat(64));
    assert.deepEqual(p.calls,{inspect:0,http:0,control:0});
    assert.throws(()=>channel.rpc('a','topic_notification_preferences_read',{p_chat_id:id(999)}),/FULLSTACK_SCOPE_REFUSED/);
    assert.throws(()=>channel.rpc('a','invented_policy',{p_chat_id:id(10)}),/FULLSTACK_RPC_REFUSED/);
    assert.deepEqual(p.calls,{inspect:0,http:0,control:0});
  });
  for(const kind of ['setter','lookup']) test('held inspect cannot change snapshotted '+kind+' transport body',()=>heldBody(kind));
  for(const [name,rpc,args] of [
    ['extra field','topic_notification_preferences_read',{p_chat_id:id(10),extra:true}],
    ['invalid mode','topic_notification_preference_set',{p_chat_id:id(10),p_topic_id:id(20),p_mode:'unknown',p_expected_revision:0}],
    ['unsafe revision','topic_notification_preference_set',{p_chat_id:id(10),p_topic_id:id(20),p_mode:'enabled',p_expected_revision:9007199254740992}],
    ['invalid nested ID','notification_feed_lookup_v2',{p_ids:[id(100),null]}],
    ['page cap','notification_feed_page_v2',{p_limit:31}],
  ]) test('entire outbound RPC rejects '+name+' before inspect',()=>{
    const b=binding(),p=port(b),channel=helper.createChannel(b,p.bridge);
    assert.throws(()=>channel.rpc('a',rpc,args),/FULLSTACK_/);assert.deepEqual(p.calls,{inspect:0,http:0,control:0});
  });
  test('scope validation applies to serialized body rather than caller toJSON facade',()=>{
    const b=binding(),p=port(b),channel=helper.createChannel(b,p.bridge);
    assert.throws(()=>channel.rpc('a','topic_notification_preferences_read',{
      p_chat_id:b.fixture.chatId,toJSON:()=>({p_chat_id:id(999)}),
    }),/FULLSTACK_SCOPE_REFUSED/);assert.equal(p.calls.inspect,0);
  });
  for(const which of [1,2]) test('decision literal positive prefix '+which+' passes only to the controlled stop',()=>
    assert.rejects(()=>decisionFrame(which),/FULLSTACK_TEST_AFTER_DECISION/));
  for(const [name,which,change] of [
    ['allowed foreign scope',1,row=>row.scope_key=id(21)],['allowed stale revision',1,row=>row.revision=0],
    ['allowed string revision',1,row=>row.revision='1'],['terminal null scope',2,row=>row.scope_key=null],
    ['terminal stale revision',2,row=>row.revision=1],['terminal null revision',2,row=>row.revision=null],
  ]) test('decision literal rejects '+name,()=>assert.rejects(()=>decisionFrame(which,change),/FULLSTACK_DECISION_ASSERTION/));
  test('drift before request refuses before authentication leaves the process',async()=>{
    const b=binding(),p=port(b);p.proof.target.containerId='0'.repeat(64);
    const channel=helper.createChannel(b,p.bridge);
    await assert.rejects(()=>channel.rpc('a','topic_notification_preferences_read',{p_chat_id:b.fixture.chatId}),/FULLSTACK_TARGET_DRIFT/);
    assert.equal(p.calls.http,0);
  });
  test('drift while awaiting HTTP invalidates even a successful response',()=>driftAfterResponse());
  test('transport failure is sanitized and never retried automatically',async()=>{
    const b=binding(),p=port(b);p.bridge.http=async request=>{
      p.calls.http++;assert.equal(request.address,'127.0.0.1');assert.equal(request.port,3000);
      assert.ok(request.signal instanceof AbortSignal);throw Error('fictional-secret-body-and-token');
    };
    const channel=helper.createChannel(b,p.bridge);
    await assert.rejects(()=>channel.rpc('a','topic_notification_preferences_read',{p_chat_id:b.fixture.chatId}),
      error=>error.message==='FULLSTACK_HTTP_UNAVAILABLE_NO_RETRY');assert.equal(p.calls.http,1);
  });
  async function budget(module=helper) {
    const b=binding(),p=port(b),channel=module.createChannel(b,p.bridge);
    for(let i=0;i<80;i++) await channel.rpc('a','topic_notification_preferences_read',{p_chat_id:b.fixture.chatId});
    await assert.rejects(()=>channel.rpc('a','topic_notification_preferences_read',{p_chat_id:b.fixture.chatId}),/FULLSTACK_HTTP_BUDGET/);
    assert.equal(p.calls.http,80);
  }
  test('literal request budget stops before request81',()=>budget());
  test('unknown control and invalid response cannot become successful empty data',async()=>{
    const b=binding(),p=port(b),channel=helper.createChannel(b,p.bridge);
    await assert.rejects(()=>channel.control('delete-account'),/FULLSTACK_CONTROL_REFUSED/);assert.equal(p.calls.control,0);
    p.bridge.http=async()=>({status:200,body:'private-not-json'});
    await assert.rejects(()=>channel.rpc('a','topic_notification_preferences_read',{p_chat_id:b.fixture.chatId}),/FULLSTACK_HTTP_PROTOCOL/);
  });
  test('default CLI is an actual refusal, never a skipped or synthetic fullstack PASS',()=>{
    const env={...process.env,KUB_QA_ALLOW_MUTATIONS:'0',SUPABASE_URL:'https://production.invalid',SUPABASE_SERVICE_ROLE_KEY:'fictional-secret'};
    delete env.LETSCUBE_TOPIC_FULLSTACK_SELFTEST;delete env.LETSCUBE_TOPIC_FULLSTACK_RUN;
    // The child must be a new runner, not inherit this runner's child context.
    delete env.NODE_TEST_CONTEXT;
    const run=spawnSync(process.execPath,['--test',fileURLToPath(import.meta.url)],{env,encoding:'utf8',timeout:10_000});
    assert.equal(run.status,1);assert.match(run.stdout,/FULLSTACK_EXPLICIT_HTTP_MODE_REQUIRED/);
    assert.doesNotMatch(run.stdout+run.stderr,/fictional-secret|production\.invalid|HTTP_SLICE_PASS/);
  });
  const text=readFileSync(url,'utf8');
  async function mutated(needle,replacement) {
    assert.equal(text.split(needle).length-1,1);
    const client=new URL('../../artifacts/kub/src/lib/notificationFeedV2.ts',import.meta.url).href;
    const assembler=new URL('../../scripts/topic-notification-candidate.mjs',import.meta.url).href;
    return import('data:text/javascript;base64,'+Buffer.from(text.replace(needle,()=>replacement)
      .replace("'../../artifacts/kub/src/lib/notificationFeedV2.ts'",JSON.stringify(client))
      .replace("'../../scripts/topic-notification-candidate.mjs'",JSON.stringify(assembler))).toString('base64'));
  }
  for(const [name,needle,change] of [
    ['network',"target.network==='none'",b=>b.target.network='bridge'],
    ['source CID','target.containerId!==input.sourceContainerId',b=>b.target.containerId=b.sourceContainerId],
  ]) test('loaded admission omission: '+name,async()=>{
    const module=await mutated(needle,'true'),b=binding();change(b);
    assert.throws(()=>assert.throws(()=>module.validateBinding(b),/FULLSTACK_/),assert.AssertionError);
  });
  test('loaded post-await identity omission cannot accept a stale transport result',async()=>{
    const module=await mutated('await inspect();\n    need(response','need(response');
    await assert.rejects(()=>driftAfterResponse(module),assert.AssertionError);
  });
  test('loaded budget81 omission exposes request beyond the literal cap',async()=>{
    const module=await mutated('++requests<=80','++requests<=81');
    await assert.rejects(()=>budget(module),assert.AssertionError);
  });
  test('loaded candidate-digest omission exposes a different assembled source',async()=>{
    const module=await mutated('candidate.sha256===binding.candidateDigest','true');
    await assert.rejects(()=>assert.rejects(()=>module.loadBoundCandidate(binding()),/FULLSTACK_CANDIDATE_DRIFT/),assert.AssertionError);
  });
  test('loaded outbound scope omission exposes a foreign body at transport',async()=>{
    const module=await mutated('body.p_chat_id===binding.fixture.chatId','true'),b=binding(),p=port(b),channel=module.createChannel(b,p.bridge);
    await assert.rejects(()=>assert.rejects(async()=>channel.rpc('a','topic_notification_preferences_read',{p_chat_id:id(999)}),
      /FULLSTACK_SCOPE_REFUSED/),assert.AssertionError);assert.equal(p.calls.http,1);
  });
  test('loaded decision scope omission exposes a foreign permitted scope',async()=>{
    const module=await mutated('rows[0].scope_key===scope','true');
    await assert.rejects(()=>assert.rejects(()=>decisionFrame(1,row=>row.scope_key=id(21),module),
      /FULLSTACK_DECISION_ASSERTION/),assert.AssertionError);
  });
  test('loaded decision revision omission exposes stale terminal metadata',async()=>{
    const module=await mutated('rows[0].revision===revision','true');
    await assert.rejects(()=>assert.rejects(()=>decisionFrame(2,row=>row.revision=1,module),
      /FULLSTACK_DECISION_ASSERTION/),assert.AssertionError);
  });
  test('selftest receipt does not claim isolated HTTP, Realtime or fullstack acceptance',t=>{
    t.diagnostic('SELFTEST_ONLY; NETWORK_AUTH_REALTIME_DELIVERY_NOT_RUN');
  });
} else {
  test('isolated authenticated HTTP slice; not Realtime/delivery/fullstack acceptance',{timeout:200_000},async t=>{
    assert.equal(typeof helper.loadRuntime,'function','FULLSTACK_ADMISSION_REQUIRED');
    const runtime=await helper.loadRuntime(process.env);
    const receipt=await helper.runHttpSlice(runtime);
    assert.equal(receipt.boundary,'HTTP_CAS_SESSION_ROLLBACK_ONLY');
    assert.equal(receipt.fullstackAccepted,false);
    t.diagnostic('HTTP_SLICE_PASS; REALTIME_DELIVERY_FULLSTACK_UNPROVEN');
  });
}
