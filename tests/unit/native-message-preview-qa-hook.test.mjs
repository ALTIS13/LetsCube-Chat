import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'../../artifacts/kub/src');
const hookFile='hooks/useNativeMessagePreview.ts';
const USER='11111111-1111-4111-8111-000000000001', SID='22222222-2222-4222-8222-000000000001';
const DEVICE='33333333-3333-4333-8333-000000000001', CONTEXT='44444444-4444-4444-8444-000000000001';
const OTHER='55555555-5555-4555-8555-000000000001';
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

// In-memory React lifecycle/timer, store, native wire and server ports only.
// The hook, typed bridge wrappers and strict parsers are actual compiled modules.
function fixture(options={}) {
  let wall=1700000000000, serial=0, active=null;
  const calls=[], modules=new Map(), timers=new Map(), mounts=new Set(), events=new Map();
  const subscribers=new Set(), authListeners=new Set(), nativeListeners=new Set();
  const holds=new Map(), queued=new Map();
  const state={currentUser:{id:USER},accountEpoch:1};
  let session, selector={recipientId:USER,recipientSessionId:SID,deviceId:DEVICE};
  let wire={qa_choice_v:1,purpose:'consent-only',contextId:CONTEXT,...selector,accountEpoch:1,expiresAt:wall+120000};
  const levels=new Map([[USER,'none']]);
  let nativeRevision=0, nativeChoice=null, retired=false;
  let failures={};
  const makeSession=(user=USER,sid=SID,expiry=wall+300000)=>({user:{id:user},access_token:'fixture.'+Buffer.from(JSON.stringify({
    role:'authenticated',is_anonymous:false,sub:user,session_id:sid,exp:Math.floor(expiry/1000)})).toString('base64url')+'.fixture'});
  session=makeSession(USER,SID,wall+(options.sessionLifetime??300000));
  async function gate(name,value) {
    const entry=holds.get(name);
    if(entry){holds.delete(name);await new Promise(resolve=>queued.set(name,resolve));queued.delete(name);}
    return value;
  }
  const native={
    async getCapabilities(){calls.push(['cap0']);return options.ordinaryCandidate ?? {protocol:0};},
    async getQaUserChoiceContext(input){
      calls.push(['context',plain(input)]);
      const reply=failures.context===undefined?(retired?{qa_choice_v:0}:plain(wire)):failures.context;
      return gate('context',reply);
    },
    async beginQaUserChoice(input){
      calls.push(['begin',plain(input)]);
      const knownFalse=failures.begin?.applied===false && Object.keys(failures.begin).length===1;
      const applied=!knownFalse && !retired && input.contextId===wire.contextId && input.revision>nativeRevision;
      if(applied){nativeRevision=input.revision;nativeChoice=null;}
      return gate('begin',failures.begin===undefined?{applied}:failures.begin);
    },
    async confirmQaUserChoice(input){
      calls.push(['confirm',plain(input)]);
      const applied=!retired && input.contextId===wire.contextId && input.revision===nativeRevision && nativeChoice===null;
      if(applied)nativeChoice=input.choice;
      return gate('confirm',failures.confirm===undefined?{applied}:failures.confirm);
    },
    async retireQaUserChoice(input){
      calls.push(['retire',plain(input)]);
      const applied=input.contextId===wire.contextId && input.expectedIntentRevision===nativeRevision && input.revision>nativeRevision;
      if(applied){nativeRevision=input.revision;retired=true;nativeChoice=null;}
      return gate('retire',failures.retire===undefined?{applied}:failures.retire);
    },
  };
  const client={
    auth:{
      onAuthStateChange(fn){authListeners.add(fn);return{data:{subscription:{unsubscribe(){authListeners.delete(fn);}}}};},
      async getSession(){calls.push(['session']);const result=await gate('session',{data:{session},error:failures.sessionError??null});
        if(failures.sessionReject)throw new Error('fictional session transport');return result;},
    },
    async rpc(name,args){
      calls.push(['rpc',name,plain(args)]);
      const data=[{preview_v:1,recipient_id:selector?.recipientId,session_id:selector?.recipientSessionId,
        device_id:selector?.deviceId,preview_level:levels.get(selector?.recipientId)??'none',...failures.capExtra}];
      const result=await gate('rpc',{data:failures.capData??data,error:failures.rpc ?? null});
      if(failures.rpcReject)throw new Error('fictional capability transport');return result;
    },
    from(table){return{upsert(row,options){calls.push(['upsert',table,plain(row),plain(options)]);return{async select(columns){
      calls.push(['select',columns]); await gate('upsert');
      if(!failures.write)levels.set(row.user_id,row.preview_level);
      return {data:failures.ack ?? [{user_id:row.user_id,preview_level:row.preview_level}],error:failures.write ?? null};
    }}}};},
  };
  const schedule=(work,delay=0)=>{const id=++serial;timers.set(id,{work,due:wall+delay});return id;};
  const add=(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);};
  const remove=(name,fn)=>events.get(name)?.delete(fn);
  const document={visibilityState:'visible',addEventListener:add,removeEventListener:remove};
  const react={
    useRef(value){const m=active,i=m.cursor++;return m.slots[i]??=( {current:value} );},
    useState(value){const m=active,i=m.cursor++;if(!(i in m.slots))m.slots[i]=value;
      return[m.slots[i],next=>{if(m.mounted){m.slots[i]=typeof next==='function'?next(m.slots[i]):next;m.dirty=true;}}];},
    useEffect(run,deps){const m=active,i=m.cursor++,previous=m.effects.get(i);
      if(!previous || deps.some((d,j)=>d!==previous.deps[j]))m.pending.push(()=>{
        previous?.cleanup?.();m.effects.set(i,{deps:[...deps],cleanup:run()});
      });},
  };
  const store=select=>select(state);
  store.getState=()=>state;store.subscribe=fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);};
  const boundary={
    react,'@capacitor/core':{registerPlugin:name=>{assert.equal(name,'MessagePreviews');return native;}},
    '@/store/app.store':{useAppStore:store},'@/lib/supabase/client':{createClient:()=>client},
    [path.join(root,'lib/platform/capabilities.ts')]:{isNativeAndroid:()=>options.android!==false,supportsCapacitorPlugin:()=>options.plugin!==false},
    [path.join(root,'lib/platform/nativeVoiceCalls.ts')]:{
      nativeMessagePreviewBindingSnapshot:()=>selector,
      subscribeNativeVoicePush:fn=>{nativeListeners.add(fn);return()=>nativeListeners.delete(fn);},
    },
  };
  function load(file) {
    if(boundary[file])return boundary[file];if(modules.has(file))return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);
    let source=readFileSync(file,'utf8').replaceAll('\r\n','\n');
    if(options.mutation && path.relative(root,file).replaceAll('\\','/')===options.mutation.file){
      assert.equal(source.split(options.mutation.from).length,2,'one actual source mutation');source=source.replace(options.mutation.from,options.mutation.to);
    }
    source=source.replaceAll('import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE',JSON.stringify(options.qa===false?'false':'true'));
    const compiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
    assert.equal(compiled.diagnostics.length,0,'actual-module syntax compile');
    vm.runInNewContext(compiled.outputText,{module,exports:module.exports,atob,Date:class extends Date{static now(){return wall;}},
      setTimeout:schedule,clearTimeout:id=>timers.delete(id),document,window:{addEventListener:add,removeEventListener:remove},
      require:name=>boundary[name] ?? load(name.startsWith('@/')?path.join(root,`${name.slice(2)}.ts`):path.resolve(path.dirname(file),`${name}.ts`)),
    },{filename:file});return module.exports;
  }
  const hook=load(path.join(root,hookFile)).useNativeMessagePreview;
  const mount=()=>{const m={slots:[],effects:new Map(),pending:[],cursor:0,mounted:true,dirty:true,view:null};mounts.add(m);return m;};
  function render(m){active=m;m.cursor=0;m.pending=[];m.dirty=false;m.view=hook();active=null;for(const run of m.pending)run();}
  const flush=async(runTimers=true)=>{
    for(let i=0;i<100;i++){
      await Promise.resolve();for(const m of mounts)if(m.mounted && m.dirty)render(m);
      if(runTimers)for(const [id,timer]of timers)if(timer.due<=wall && timers.delete(id))timer.work();
    }
  };
  const detach=m=>{m.mounted=false;for(const e of m.effects.values())e.cleanup?.();mounts.delete(m);};
  return{calls,mount,flush,detach,view:m=>plain({...m.view,setChoice:undefined,refresh:undefined}),
    choose:(m,choice)=>m.view.setChoice(choice),refresh:m=>m.view.refresh(),of:name=>calls.filter(c=>c[0]===name),
    hold:name=>holds.set(name,true),held:name=>queued.has(name),release:async(name,runTimers=true)=>{assert.ok(queued.has(name),'held port exists');queued.get(name)();await flush(runTimers);},
    failures,makeSession,now:()=>wall,advance:async(ms,run=true)=>{wall+=ms;if(run)await flush();},
    selector:next=>{selector=next;},context:patch=>{wire={...wire,...patch};},level:value=>{levels.set(selector?.recipientId??USER,value);},
    nativeState:()=>({revision:nativeRevision,choice:nativeChoice,retired}),
    serverLevel:(user=state.currentUser?.id)=>levels.get(user)??'none',
    newNative:patch=>{wire={...wire,...patch};retired=false;nativeRevision=0;nativeChoice=null;},
    auth:(next,event='TOKEN_REFRESHED')=>{session=next;for(const fn of authListeners){const count=calls.length;assert.equal(fn(event,next),undefined);assert.equal(calls.length,count,'auth callback returns before port I/O');}},
    account:patch=>{Object.assign(state,patch);for(const fn of [...subscribers])fn();for(const m of mounts)m.dirty=true;},
    nativeChange:()=>{for(const fn of nativeListeners)fn();},
    event:(name,visibility)=>{if(visibility)document.visibilityState=visibility;for(const fn of [...(events.get(name)??[])])fn();},
    close:async()=>{for(const m of [...mounts])detach(m);for(const resolve of queued.values())resolve();await flush();},
  };
}
async function start(options={}){const f=fixture(options),m=f.mount();await f.flush();return{f,m};}
test('real Settings QA choice absent; ordinary protocol0 closed',async()=>{
  const ordinary=await start({qa:false});
  try{
    assert.equal(ordinary.f.view(ordinary.m).status,'unavailable');assert.equal(ordinary.f.view(ordinary.m).canChoose,false);
    assert.equal(await ordinary.f.choose(ordinary.m,'message'),false);
    assert.equal(ordinary.f.of('rpc').length,0);assert.equal(ordinary.f.of('upsert').length,0);assert.equal(ordinary.f.of('context').length,0);
    assert.equal(ordinary.f.of('cap0').length,1);
    console.log('CONTROL ordinary protocol0 closed / zero-upsert PASS');
  }finally{await ordinary.f.close();}
  const {f,m}=await start();try{
    assert.equal(f.view(m).canChoose,true,'QA_SETTINGS_CONSUMER_SELECTABLE');
    assert.equal(f.view(m).savedChoice,'none');assert.equal(f.view(m).effectiveChoice,'none');
  }finally{await f.close();}
});

async function savedSender(f,m){const task=f.choose(m,'sender');await f.flush();assert.equal(await task,true);await f.flush();}
async function refreshReject(options={}){
  const {f,m}=await start(options);try{
    await savedSender(f,m);
    assert.equal(f.nativeState().choice,'sender','REFRESH_REJECT_CONTROL_CONFIRMED');
    f.hold('session');f.refresh(m);await f.flush();assert.equal(f.held('session'),true);
    assert.equal(f.of('retire').length,0,'held refresh is nonterminal');
    f.failures.sessionReject=true;await f.release('session');
    assert.equal(f.of('retire').length,1,'REFRESH_REJECT_EXACT_RETIRE');
    assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:1,revision:2});
    assert.equal(f.nativeState().choice,null);assert.equal(f.view(m).effectiveChoice,'none');
    assert.equal(f.view(m).nativeClosure,'RETIRED');assert.equal(f.of('upsert').length,1);
  }finally{await f.close();}
}
async function duplicateInitial(options={}){
  const {f,m}=await start(options);try{
    await savedSender(f,m);assert.equal(f.view(m).nativeClosure,'CONFIRMED','INITIAL_SESSION_CONTROL_CONFIRMED');
    f.auth(f.makeSession(),'INITIAL_SESSION');await f.flush();
    assert.equal(f.of('retire').length,0,'DUPLICATE_INITIAL_SESSION_NONTERMINAL');
    assert.equal(f.view(m).canChoose,true);assert.equal(f.view(m).savedChoice,'sender');
    assert.equal(f.view(m).effectiveChoice,'none');assert.equal(f.of('rpc').length,4,'fresh authorization after duplicate initial');
    assert.equal(f.of('upsert').length,1);assert.equal(f.nativeState().choice,'sender');
    await f.advance(120000);assert.equal(f.view(m).canChoose,false);assert.equal(f.of('retire').length,1);
  }finally{await f.close();}
}
test('confirmed QA intent retires after held getSession rejects',()=>refreshReject());
test('late duplicate INITIAL_SESSION same SID epoch is nonterminal fresh authorization',()=>duplicateInitial());

async function withStart(options,run){const {f,m}=await start(options);try{await run(f,m);}finally{await f.close();}}
async function roundTrip(options={}){await withStart(options,async(f,m)=>{
  for(const choice of ['sender','message','none']){
    const task=f.choose(m,choice);await f.flush();assert.equal(await task,true);await f.flush();
    assert.equal(f.view(m).savedChoice,choice);assert.equal(f.view(m).effectiveChoice,'none','QA_EFFECTIVE_LITERAL_NONE');
    assert.equal(f.view(m).nativeClosure,'CONFIRMED');assert.equal(f.nativeState().choice,choice);
  }
  assert.equal(f.of('rpc').length,7);assert.equal(f.of('upsert').length,3);assert.equal(f.of('context').length,17);
  assert.equal(f.of('cap0').length,0);assert.equal(f.of('begin').length,3);assert.equal(f.of('confirm').length,3);
  assert.deepEqual(f.of('begin').map(c=>c[1].revision),[1,2,3]);
  assert.deepEqual(f.of('confirm').map(c=>c[1].revision),[1,2,3]);
  for(const call of f.of('upsert'))assert.deepEqual(call.slice(1),['notification_preview_preferences',
    {user_id:USER,preview_level:call[2].preview_level},{onConflict:'user_id'}]);
  for(const call of f.of('context'))assert.deepEqual(call[1],{recipientId:USER,recipientSessionId:SID,deviceId:DEVICE,accountEpoch:1});
});}
test('QA none sender message none exact counts and effective literal none',()=>roundTrip());
async function heldOrdering(options={}){await withStart(options,async(f,m)=>{
  f.hold('begin');const task=f.choose(m,'sender');await f.flush();
  assert.equal(f.held('begin'),true);assert.equal(f.of('upsert').length,0,'BEGIN_ACK_BEFORE_WRITE');
  assert.equal(f.view(m).saving,true);assert.equal(f.view(m).canChoose,false);
  assert.equal(f.view(m).savedChoice,'none','existing radios retained');assert.equal(f.view(m).effectiveChoice,'none');
  assert.equal(f.of('upsert').length,0,'BEGIN_ACK_BEFORE_WRITE');assert.equal(f.of('rpc').length,1);
  f.hold('rpc');await f.release('begin');assert.equal(f.held('rpc'),true);assert.equal(f.view(m).nativeClosure,'PENDING');
  assert.equal(f.of('upsert').length,0);f.hold('upsert');await f.release('rpc');assert.equal(f.held('upsert'),true);
  assert.equal(f.of('confirm').length,0);assert.equal(f.view(m).savedChoice,'none');
  f.hold('rpc');await f.release('upsert');assert.equal(f.held('rpc'),true);assert.equal(f.of('rpc').length,3,'POST_READ_REQUIRED');
  assert.equal(f.of('confirm').length,0);f.hold('confirm');await f.release('rpc');assert.equal(f.held('confirm'),true);
  assert.equal(f.view(m).savedChoice,'none');assert.equal(f.view(m).nativeClosure,'PENDING');assert.equal(f.view(m).canChoose,false);
  assert.equal(f.nativeState().choice,'sender','native may apply before delivered ACK');
  await f.release('confirm');assert.equal(await task,true);assert.equal(f.view(m).savedChoice,'sender');
  assert.equal(f.view(m).nativeClosure,'CONFIRMED');assert.equal(f.of('upsert').length,1);
});}
test('held begin pre-read upsert post-read confirm preserves radios and exact ordering',()=>heldOrdering());
test('ordinary protocol1 unchanged positive path uses no QA methods',async()=>{
  await withStart({qa:false,ordinaryCandidate:{protocol:1,recipientId:USER,recipientSessionId:SID,deviceId:DEVICE}},async(f,m)=>{
    assert.equal(f.view(m).canChoose,true);await savedSender(f,m);assert.equal(f.view(m).effectiveChoice,'sender');
    assert.equal(f.of('rpc').length,3);assert.equal(f.of('cap0').length,6);assert.equal(f.of('upsert').length,1);
    for(const name of ['context','begin','confirm','retire'])assert.equal(f.of(name).length,0);
  });
});
async function rejectedContext(patch,options={}){
  const f=fixture(options),m=f.mount();f.context(patch);try{
    await f.flush();assert.equal(f.view(m).canChoose,false,'STRICT_QA_CONTEXT_REJECT');
    assert.equal(await f.choose(m,'sender'),false);assert.equal(f.of('rpc').length,0);assert.equal(f.of('upsert').length,0);
    assert.equal(f.of('cap0').length,0,'QA_REFUSAL_NEVER_FALLBACK');
  }finally{await f.close();}
}
for(const [name,patch]of Object.entries({marker:{qa_choice_v:7},extra:{unexpected:true},purpose:{purpose:'runtime'},
  owner:{recipientId:OTHER},sid:{recipientSessionId:OTHER},device:{deviceId:OTHER},epoch:{accountEpoch:2},expired:{expiresAt:1700000000000}})){
  test(`QA context ${name} refuses without protocol1 fallback`,()=>rejectedContext(patch,{ordinaryCandidate:{protocol:1,recipientId:USER,recipientSessionId:SID,deviceId:DEVICE}}));
}
for(const reply of [null,{qa_choice_v:0},{protocol:1,recipientId:USER,recipientSessionId:SID,deviceId:DEVICE}]){
  test(`QA context refused wire ${JSON.stringify(reply)} stays closed`,async()=>{
    const f=fixture(),m=f.mount();f.failures.context=reply;try{await f.flush();assert.equal(f.view(m).canChoose,false);assert.equal(f.of('rpc').length,0);}finally{await f.close();}
  });
}
async function selectorFence(options={}){
  const f=fixture(options),m=f.mount();f.hold('context');try{
    await f.flush();assert.equal(f.held('context'),true);f.selector({recipientId:USER,recipientSessionId:SID,deviceId:OTHER});
    await f.release('context');assert.equal(f.of('rpc').length,0,'SELECTOR_FENCE_AFTER_NATIVE_REPLY');assert.equal(f.view(m).canChoose,false);
  }finally{await f.close();}
}
test('held first native context selector swap cannot admit historical binding',()=>selectorFence());
async function contextFence(patch,options={}){await withStart(options,async(f,m)=>{
  f.hold('rpc');const task=f.choose(m,'sender');await f.flush();assert.equal(f.held('rpc'),true);
  f.context(patch);await f.release('rpc');assert.equal(await task,false,'EXACT_CONTEXT_FIXED_FIELDS');
  assert.equal(f.of('upsert').length,0);assert.equal(f.of('confirm').length,0);assert.equal(f.of('retire').length,1);
  assert.equal(f.of('retire')[0][1].contextId,CONTEXT);assert.equal(f.of('retire')[0][1].expectedIntentRevision,1);
});}
for(const [name,patch]of Object.entries({id:{contextId:OTHER},owner:{recipientId:OTHER},sid:{recipientSessionId:OTHER},
  device:{deviceId:OTHER},epoch:{accountEpoch:2},deadline:{expiresAt:1700000119999}}))test(`held pre-read changed context ${name} retires exact original`,()=>contextFence(patch));
async function ackFence(options={}){await withStart(options,async(f,m)=>{
  f.failures.ack=[{user_id:OTHER,preview_level:'sender'}];const task=f.choose(m,'sender');await f.flush();
  assert.equal(await task,false,'OWN_ROW_ACK_REQUIRED');assert.equal(f.of('upsert').length,1);
  assert.equal(f.of('rpc').length,2);assert.equal(f.of('confirm').length,0);assert.equal(f.view(m).savedChoice,'none');
  assert.equal(f.view(m).effectiveChoice,'none');assert.equal(f.view(m).nativeClosure,'RETIRED');
});}
test('foreign owner upsert ACK cannot be saved or confirmed',()=>ackFence());
for(const ack of [[],[{user_id:USER,preview_level:'message'}],[{user_id:USER,preview_level:'sender',extra:true}]]){
  test(`nonexact own-row ACK ${JSON.stringify(ack)} refuses`,async()=>withStart({},async(f,m)=>{
    f.failures.ack=ack;const task=f.choose(m,'sender');await f.flush();assert.equal(await task,false);
    assert.equal(f.of('confirm').length,0);assert.equal(f.view(m).savedChoice,'none');
  }));
}
async function postFence(options={}){await withStart(options,async(f,m)=>{
  f.hold('upsert');const task=f.choose(m,'sender');await f.flush();assert.equal(f.held('upsert'),true);
  f.failures.capData=[{preview_v:1,recipient_id:USER,session_id:SID,device_id:DEVICE,preview_level:'message'}];
  await f.release('upsert');assert.equal(await task,false,'POST_READ_CHOICE_REQUIRED');
  assert.equal(f.of('rpc').length,3);assert.equal(f.of('confirm').length,0);assert.equal(f.view(m).savedChoice,'none');
});}
test('fresh post-read must confirm literal chosen server level',()=>postFence());
test('lost confirm and lost retirement replies remain UNKNOWN no replay rollback or fabricated ACK',async()=>withStart({},async(f,m)=>{
  f.failures.confirm=null;f.hold('retire');const task=f.choose(m,'sender');await f.flush();assert.equal(await task,false);
  assert.equal(f.held('retire'),true);assert.equal(f.view(m).nativeClosure,'UNKNOWN');assert.equal(f.view(m).savedChoice,'none');
  assert.equal(f.serverLevel(),'sender','committed write not rolled back');assert.equal(f.of('upsert').length,1);
  assert.equal(f.view(m).error,'Не удалось подтвердить сохранение');assert.equal(f.view(m).effectiveChoice,'none');
  // The held reply was captured before this; exercise the actual wrapper's 2s timeout.
  await f.advance(2000);assert.equal(f.view(m).nativeClosure,'UNKNOWN');assert.equal(f.of('confirm').length,1);
  assert.equal(f.of('retire').length,1);f.refresh(m);await f.flush();assert.equal(f.view(m).canChoose,false);
  assert.equal(f.of('upsert').length,1);await f.release('retire');assert.equal(f.view(m).nativeClosure,'UNKNOWN','late ACK not reinterpreted after timeout');
}));
test('checked retirement after unknown applied confirm can prove RETIRED only',async()=>withStart({},async(f,m)=>{
  f.failures.confirm=null;const task=f.choose(m,'sender');await f.flush();assert.equal(await task,false);
  assert.equal(f.view(m).nativeClosure,'RETIRED');assert.equal(f.view(m).savedChoice,'none');assert.equal(f.serverLevel(),'sender');
  assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:1,revision:2});
}));
test('native known-false begin prevents own-row write and is not success',async()=>withStart({},async(f,m)=>{
  assert.deepEqual(f.nativeState(),{revision:0,choice:null,retired:false});
  f.failures.begin={applied:false};f.hold('begin');const task=f.choose(m,'sender');await f.flush();
  assert.deepEqual(f.nativeState(),{revision:0,choice:null,retired:false},'KNOWN_FALSE_BEGIN_ZERO_NATIVE_EFFECT');
  await f.release('begin');assert.equal(await task,false);
  assert.equal(f.of('upsert').length,0);assert.equal(f.of('confirm').length,0);assert.equal(f.view(m).canChoose,false);
  assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:0,revision:2});
  assert.deepEqual(f.nativeState(),{revision:2,choice:null,retired:true});
}));
test('failed none retains last confirmed choice not fictitious server deletion',async()=>withStart({},async(f,m)=>{
  await savedSender(f,m);const t=f.choose(m,'message');await f.flush();assert.equal(await t,true);
  f.failures.write={code:'fixture-write-refused'};const failed=f.choose(m,'none');await f.flush();assert.equal(await failed,false);
  assert.equal(f.view(m).savedChoice,'message');assert.equal(f.serverLevel(),'message');assert.equal(f.view(m).effectiveChoice,'none');
  assert.equal(f.of('upsert').length,3);assert.equal(f.of('confirm').length,2);assert.equal(f.view(m).canChoose,false);
}));
async function lateConfirm(options={}){await withStart(options,async(f,m)=>{
  f.hold('confirm');const task=f.choose(m,'sender');await f.flush();assert.equal(f.held('confirm'),true);
  f.auth(f.makeSession(USER,OTHER));await f.flush();assert.equal(f.view(m).canChoose,false);
  await f.release('confirm');assert.equal(await task,false,'LATE_CONFIRM_CANNOT_PUBLISH');
  assert.notEqual(f.view(m).savedChoice,'sender');assert.equal(f.view(m).effectiveChoice,'none');assert.equal(f.of('retire').length,1);
});}
test('held confirm changed Auth SID cannot publish late success',()=>lateConfirm());
test('successor begin fences held old confirm without successor-targeted retirement',async()=>withStart({},async(f,m)=>{
  f.hold('confirm');const a=f.choose(m,'sender');await f.flush();assert.equal(f.held('confirm'),true);
  const b=f.choose(m,'message');await f.flush();assert.equal(f.of('begin').length,2);assert.equal(f.of('upsert').length,1);
  assert.equal(f.nativeState().choice,null,'successor begin closes old native choice');
  await f.release('confirm');assert.equal(await a,false);await f.flush();assert.equal(await b,true);
  assert.equal(f.nativeState().choice,'message');assert.equal(f.view(m).savedChoice,'message');assert.equal(f.of('retire').length,0);
  assert.equal(f.of('upsert').length,2);assert.equal(f.of('rpc').length,5);
}));
for(const [label,change]of [
  ['account B',f=>f.account({currentUser:{id:OTHER},accountEpoch:2})],
  ['same user epoch',f=>f.account({accountEpoch:2})],
  ['TOKEN_REFRESHED same SID',f=>f.auth(f.makeSession())],
  ['SIGNED_OUT',f=>f.auth(null,'SIGNED_OUT')],
  ['native selector loss',f=>{f.selector(null);f.nativeChange();}],
  ['hidden',f=>f.event('visibilitychange','hidden')],['pagehide',f=>f.event('pagehide')],
])test(`held upsert ${label} closes JS and captured native intent`,async()=>withStart({},async(f,m)=>{
  f.hold('upsert');const task=f.choose(m,'sender');await f.flush();assert.equal(f.held('upsert'),true);
  change(f);await f.flush();assert.equal(f.view(m).effectiveChoice,'none');assert.equal(f.view(m).canChoose,false);
  assert.equal(f.of('retire').length,1);assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:1,revision:2});
  await f.release('upsert');assert.equal(await task,false);assert.equal(f.of('confirm').length,0);
  assert.notEqual(f.view(m).savedChoice,'sender');assert.equal(f.of('upsert').length,1);
}));
test('dispose retirement is not suppressed by stopped or missing owner',async()=>{
  const {f,m}=await start();try{await savedSender(f,m);f.detach(m);await f.flush();
    assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:1,revision:2});assert.equal(f.nativeState().retired,true);
  }finally{await f.close();}
});
test('remount owner write barrier and module-global intents survive old dispatched write',async()=>{
  const {f,m}=await start();try{
    f.hold('upsert');const a=f.choose(m,'sender');await f.flush();assert.equal(f.held('upsert'),true);
    f.detach(m);await f.flush();assert.equal(f.of('retire').length,1);
    f.newNative({contextId:OTHER});const n=f.mount();await f.flush();assert.equal(f.of('rpc').length,2,'remount waits old own-row write');
    await f.release('upsert');assert.equal(await a,false);assert.equal(f.of('rpc').length,3);assert.equal(f.view(n).savedChoice,'sender','honest committed readback');
    const b=f.choose(n,'message');await f.flush();assert.equal(await b,true);assert.equal(f.of('begin')[1][1].revision,3,'GLOBAL_INTENT_NOT_RESET');
    assert.equal(f.of('retire').length,1);assert.equal(f.view(n).effectiveChoice,'none');
  }finally{await f.close();}
});
test('same terminal context cannot be rearmed by refresh or remount',async()=>{
  const {f,m}=await start();try{await savedSender(f,m);f.event('pagehide');await f.flush();f.refresh(m);await f.flush();
    assert.equal(f.view(m).canChoose,false);assert.equal(f.of('rpc').length,3);f.detach(m);const n=f.mount();await f.flush();
    assert.equal(f.view(n).canChoose,false);assert.equal(f.of('rpc').length,3);assert.equal(f.of('upsert').length,1);
  }finally{await f.close();}
});
test('explicit nonterminal refresh reads server choice without renewing fixed QA deadline',async()=>withStart({},async(f,m)=>{
  await savedSender(f,m);await f.advance(60000);f.level('message');f.refresh(m);await f.flush();
  assert.equal(f.view(m).savedChoice,'message');assert.equal(f.view(m).effectiveChoice,'none');assert.equal(f.of('retire').length,0);
  await f.advance(59999);assert.equal(f.view(m).canChoose,true);await f.advance(1);assert.equal(f.view(m).canChoose,false);
  assert.equal(f.of('retire').length,1);assert.equal(f.of('rpc').length,4);assert.equal(f.of('upsert').length,1);
}));
for(const [label,lifetime,limit]of [['context',300000,120000],['session',60000,60000]]){
  test(`independent ${label} D-1 D literal boundary not production-derived`,async()=>withStart({sessionLifetime:lifetime},async(f,m)=>{
    const arm=f.now();await f.advance(limit-1);assert.equal(f.now(),arm+limit-1);assert.equal(f.view(m).canChoose,true);
    await f.advance(1);assert.equal(f.now(),arm+limit);assert.equal(f.view(m).canChoose,false);
    assert.equal(f.view(m).effectiveChoice,'none');assert.equal(f.of('retire').length,1);assert.equal(f.of('upsert').length,0);
  }));
}
for(const stage of ['rpc','upsert','confirm'])test(`inline fixed expiry after held ${stage} even without timer delivery`,async()=>withStart({},async(f,m)=>{
  f.hold(stage);const task=f.choose(m,'sender');await f.flush();assert.equal(f.held(stage),true);
  await f.advance(120000,false);await f.release(stage,false);assert.equal(await task,false);await f.flush(false);
  assert.equal(f.view(m).effectiveChoice,'none');assert.equal(f.view(m).canChoose,false);assert.equal(f.of('retire').length,1);
  assert.equal(f.view(m).nativeClosure,'RETIRED','INLINE_EXPIRED_CHECKED_RETIREMENT_NOT_NOT_REQUESTED');
  assert.notEqual(f.view(m).savedChoice,'sender');assert.equal(f.of('upsert').length,stage==='rpc'?0:1);
}));
test('held refresh still retires at original min deadline',async()=>withStart({sessionLifetime:60000},async(f,m)=>{
  await savedSender(f,m);f.hold('session');f.refresh(m);await f.flush();await f.advance(60000);
  assert.equal(f.of('retire').length,1);await f.release('session');assert.equal(f.view(m).canChoose,false);assert.equal(f.of('rpc').length,3);
}));

async function remountIntent(options={}){
  const {f,m}=await start(options);try{
    f.hold('upsert');const a=f.choose(m,'sender');await f.flush();assert.equal(f.held('upsert'),true);
    f.detach(m);await f.flush();assert.equal(f.of('retire').length,1);
    f.newNative({contextId:OTHER});const n=f.mount();await f.flush();assert.equal(f.of('rpc').length,2);
    await f.release('upsert');assert.equal(await a,false);assert.equal(f.of('rpc').length,3);
    const b=f.choose(n,'message');await f.flush();assert.equal(await b,true);
    assert.equal(f.of('begin')[1][1].revision,3,'GLOBAL_INTENT_NOT_RESET');
  }finally{await f.close();}
}
async function timerLiteral(options={}){await withStart(options,async(f,m)=>{
  const arm=f.now();await f.advance(119999);assert.equal(f.now(),arm+119999);assert.equal(f.view(m).canChoose,true);
  await f.advance(1);assert.equal(f.now(),arm+120000);assert.equal(f.of('retire').length,1,'FIXED_DEADLINE_RETIRE_AT_D');
  assert.equal(f.of('upsert').length,0);
});}
async function retirementTarget(options={}){await withStart(options,async(f,m)=>{
  await savedSender(f,m);f.event('pagehide');await f.flush();
  assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:1,revision:2},'RETIRE_EXACT_CAPTURED_INTENT');
});}
test('changed INITIAL_SESSION SID is terminal not a duplicate',async()=>withStart({},async(f,m)=>{
  await savedSender(f,m);f.auth(f.makeSession(USER,OTHER),'INITIAL_SESSION');await f.flush();
  assert.equal(f.of('retire').length,1);assert.equal(f.view(m).canChoose,false);assert.equal(f.of('upsert').length,1);
}));
test('getSession error result retires confirmed exact intent',async()=>withStart({},async(f,m)=>{
  await savedSender(f,m);f.failures.sessionError={code:'fixture-auth-refused'};f.refresh(m);await f.flush();
  assert.equal(f.of('retire').length,1);assert.equal(f.view(m).nativeClosure,'RETIRED');assert.equal(f.view(m).canChoose,false);
}));
test('held post-read native context swap prevents confirm and targets only original',async()=>withStart({},async(f,m)=>{
  f.hold('upsert');const task=f.choose(m,'sender');await f.flush();f.hold('rpc');await f.release('upsert');
  assert.equal(f.held('rpc'),true);f.context({contextId:OTHER});await f.release('rpc');assert.equal(await task,false);
  assert.equal(f.of('confirm').length,0);assert.equal(f.of('retire')[0][1].contextId,CONTEXT);assert.equal(f.of('upsert').length,1);
}));
test('context swap during held confirm cannot publish a saved ACK',async()=>withStart({},async(f,m)=>{
  f.hold('confirm');const task=f.choose(m,'sender');await f.flush();f.context({contextId:OTHER});await f.release('confirm');
  assert.equal(await task,false);assert.equal(f.view(m).savedChoice,'none');assert.equal(f.view(m).nativeClosure,'UNKNOWN');
  assert.equal(f.of('retire')[0][1].contextId,CONTEXT);assert.equal(f.of('upsert').length,1);
}));
test('unsafe next global intent refuses without wrap or replay',async()=>withStart({mutation:{file:hookFile,
  from:'let intentRevision = 0;',to:'let intentRevision = Number.MAX_SAFE_INTEGER - 1;'}},async(f,m)=>{
  await savedSender(f,m);assert.equal(f.of('begin')[0][1].revision,9007199254740991);
  assert.equal(await f.choose(m,'message'),false);await f.flush();assert.equal(f.view(m).canChoose,false);
  assert.equal(f.view(m).nativeClosure,'UNKNOWN');assert.equal(f.of('begin').length,1);assert.equal(f.of('upsert').length,1);
  assert.equal(f.of('retire').length,0,'no unsafe wrapped revision');
}));
test('loading fresh authorization retains known confirmed native diagnostic',async()=>withStart({},async(f,m)=>{
  await savedSender(f,m);f.hold('rpc');f.refresh(m);await f.flush();assert.equal(f.held('rpc'),true);
  assert.equal(f.view(m).status,'loading');assert.equal(f.view(m).effectiveChoice,'none');
  assert.equal(f.view(m).nativeClosure,'CONFIRMED','LOADING_NATIVE_DIAGNOSTIC_NOT_RESET');
  await f.release('rpc');assert.equal(f.view(m).canChoose,true);assert.equal(f.of('retire').length,0);
}));
test('account B fresh context survives late A own-row ACK with separate owner barrier',async()=>{
  const {f,m}=await start();try{
    f.hold('upsert');const a=f.choose(m,'sender');await f.flush();assert.equal(f.held('upsert'),true);
    f.account({currentUser:{id:OTHER},accountEpoch:2});await f.flush();
    assert.equal(f.of('retire').length,1);assert.equal(f.of('retire')[0][1].contextId,CONTEXT);
    f.selector({recipientId:OTHER,recipientSessionId:OTHER,deviceId:OTHER});
    // A different fictional native incarnation, not rearming the old plugin owner.
    f.newNative({contextId:OTHER,recipientId:OTHER,recipientSessionId:OTHER,deviceId:OTHER,accountEpoch:2});
    f.auth(f.makeSession(OTHER,OTHER),'SIGNED_IN');await f.flush();assert.equal(f.view(m).canChoose,true);
    const b=f.choose(m,'message');await f.flush();assert.equal(await b,true);assert.equal(f.of('begin')[1][1].revision,3);
    await f.release('upsert');assert.equal(await a,false);assert.equal(f.view(m).savedChoice,'message');
    assert.equal(f.nativeState().choice,'message');assert.equal(f.of('retire').length,1);assert.equal(f.of('confirm').length,1);
    assert.equal(f.serverLevel(USER),'sender');assert.equal(f.serverLevel(OTHER),'message');assert.equal(f.of('upsert').length,2);
    assert.equal(f.of('rpc').length,5);assert.equal(f.view(m).effectiveChoice,'none');
  }finally{await f.close();}
});

const mutants=[
  {name:'QA marker literal',file:'lib/platform/nativeMessagePreviewContract.ts',from:'value.qa_choice_v !== 1',to:'false',
    run:options=>rejectedContext({qa_choice_v:7},options),assertion:'STRICT_QA_CONTEXT_REJECT'},
  {name:'QA exact shape',file:'lib/platform/nativeMessagePreviewContract.ts',from:'Object.keys(value).length !== 8',to:'Object.keys(value).length < 8',
    run:options=>rejectedContext({extra:true},options),assertion:'STRICT_QA_CONTEXT_REJECT'},
  {name:'selector owner recheck',file:hookFile,from:'return !!value && value.recipientId === context.recipientId',to:'return true || !!value && value.recipientId === context.recipientId',
    run:selectorFence,assertion:'SELECTOR_FENCE_AFTER_NATIVE_REPLY'},
  {name:'fixed context deadline equality',file:hookFile,from:'&& a.accountEpoch === b.accountEpoch && a.expiresAt === b.expiresAt;',to:'&& a.accountEpoch === b.accountEpoch;',
    run:options=>contextFence({expiresAt:1700000119999},options),assertion:'EXACT_CONTEXT_FIXED_FIELDS'},
  {name:'own-row ACK verification',file:hookFile,from:'if (result.error || readMessagePreviewConsent(result.data, owner, choice) === null) throw new Error("refused");',
    to:'if (result.error) throw new Error("refused");',run:ackFence,assertion:'OWN_ROW_ACK_REQUIRED'},
  {name:'post-read cannot be replaced by requested choice',file:hookFile,from:'const after = await capability(auth, op, expected);',
    to:'const after = before && { ...before, choice };',run:postFence,assertion:'POST_READ_CHOICE_REQUIRED'},
  {name:'begin ACK must precede write',file:hookFile,
    from:'const ack = await nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({ contextId: lease.context.contextId, revision: target.revision });',
    to:'const ack = { applied: true }; void nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({ contextId: lease.context.contextId, revision: target.revision });',
    run:heldOrdering,assertion:'BEGIN_ACK_BEFORE_WRITE'},
  {name:'late confirm publication fence',file:hookFile,
    from:'if (ack?.applied !== true || !live()) return failed();\n            const latest = await qaContext(auth, op, lease.context);\n            if (!latest || !live()) return failed();',
    to:'if (ack?.applied !== true) return failed();',run:lateConfirm,assertion:'LATE_CONFIRM_CANNOT_PUBLISH'},
  {name:'QA effective none',file:hookFile,
    from:'publish({ status: "ready", savedChoice, effectiveChoice: qa ? "none" : savedChoice, error: null, nativeClosure: target?.closure ?? "NOT_REQUESTED" });',
    to:'publish({ status: "ready", savedChoice, effectiveChoice: savedChoice, error: null, nativeClosure: target?.closure ?? "NOT_REQUESTED" });',
    run:roundTrip,assertion:'QA_EFFECTIVE_LITERAL_NONE'},
  {name:'module-global intent cannot reset at mount',file:hookFile,
    from:'if (!owner || !nativeMessagePreviewsAvailable()) return;',to:'if (!owner || !nativeMessagePreviewsAvailable()) return; intentRevision = 0;',
    run:remountIntent,assertion:'GLOBAL_INTENT_NOT_RESET'},
  {name:'deadline plus one millisecond',file:hookFile,
    from:'deadline = Math.min(session.expiresAt, qaLease?.context.expiresAt ?? session.expiresAt);',
    to:'deadline = Math.min(session.expiresAt, qaLease?.context.expiresAt ?? session.expiresAt) + 1;',run:timerLiteral,assertion:'FIXED_DEADLINE_RETIRE_AT_D'},
  {name:'retirement must capture exact intent',file:hookFile,from:'expectedIntentRevision: target.erasureRevision ?? target.revision, revision,',to:'expectedIntentRevision: 0, revision,',
    run:retirementTarget,assertion:'RETIRE_EXACT_CAPTURED_INTENT'},
  {name:'rejected refresh must retire',file:hookFile,
    from:'if (own() && auth === authRevision && op === operation) { if (qa) invalidate(true); else publish(CLOSED); }',
    to:'if (own() && auth === authRevision && op === operation) publish(CLOSED);',run:refreshReject,assertion:'REFRESH_REJECT_EXACT_RETIRE'},
  {name:'duplicate initial is not token rotation',file:hookFile,
    from:'invalidate(qa && (!duplicateInitial || lastView.status === "saving")); acceptSession(value);',
    to:'invalidate(qa); acceptSession(value);',run:duplicateInitial,assertion:'DUPLICATE_INITIAL_SESSION_NONTERMINAL'},
];
for(const {name,run,assertion,...mutation}of mutants)test(`compiled runtime mutant ${name} killed after passing control`,async()=>{
  await run({});
  await assert.rejects(()=>run({mutation}),error=>error.code==='ERR_ASSERTION' && error.message.includes(assertion),
    'mutant must fail the named runtime assertion, not syntax/import/setup');
});

async function r1InlineRefreshExpiry(reject,options={}){await withStart({...options,sessionLifetime:60000},async(f,m)=>{
  const arm=f.now();await savedSender(f,m);assert.deepEqual(f.nativeState(),{revision:1,choice:'sender',retired:false});
  f.hold('rpc');f.refresh(m);await f.flush();assert.equal(f.held('rpc'),true);assert.equal(f.of('retire').length,0);
  f.failures.rpcReject=reject;await f.advance(59999,false);assert.equal(f.now(),arm+59999);
  assert.equal(f.nativeState().choice,'sender','R1_REFRESH_EXPIRY_PASSING_D_MINUS_ONE_CONTROL');
  await f.advance(1,false);await f.release('rpc',false);await f.flush(false);
  assert.equal(f.now(),arm+60000);assert.equal(f.of('retire').length,1,'R1_REFRESH_INLINE_SESSION_D_RETIRE');
  assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:1,revision:2});
  assert.deepEqual(f.nativeState(),{revision:2,choice:null,retired:true});assert.equal(f.view(m).nativeClosure,'RETIRED');
  assert.equal(f.view(m).canChoose,false);assert.equal(f.view(m).effectiveChoice,'none');
  assert.equal(f.of('upsert').length,1);assert.equal(f.of('rpc').length,4);assert.equal(f.of('confirm').length,1);
});}
async function r1DuplicateDuringRefresh(options={}){await withStart(options,async(f,m)=>{
  await savedSender(f,m);f.hold('session');f.refresh(m);await f.flush();assert.equal(f.held('session'),true);
  assert.equal(f.nativeState().choice,'sender');assert.equal(f.of('retire').length,0);
  f.hold('rpc');f.auth(f.makeSession(),'INITIAL_SESSION');await f.flush();
  assert.equal(f.of('retire').length,0,'R1_DUPLICATE_INITIAL_HELD_REFRESH_NONTERMINAL');
  assert.equal(f.held('rpc'),true);assert.equal(f.view(m).nativeClosure,'CONFIRMED');
  f.failures.sessionReject=true;await f.release('session');f.failures.sessionReject=false;
  assert.equal(f.of('retire').length,0,'stale getSession rejection cannot retire fresh operation');
  await f.release('rpc');assert.equal(f.view(m).canChoose,true);assert.equal(f.view(m).savedChoice,'sender');
  assert.equal(f.of('rpc').length,4);assert.equal(f.of('upsert').length,1);assert.equal(f.nativeState().choice,'sender');
  await f.advance(119999);assert.equal(f.view(m).canChoose,true);await f.advance(1);
  assert.equal(f.view(m).canChoose,false);assert.equal(f.of('retire').length,1,'duplicate does not renew fixed context');
});}
async function r1KnownFalseBegin(previousPositive,options={}){await withStart(options,async(f,m)=>{
  if(previousPositive)await savedSender(f,m);
  assert.deepEqual(f.nativeState(),previousPositive?{revision:1,choice:'sender',retired:false}:{revision:0,choice:null,retired:false});
  f.failures.begin={applied:false};f.hold('begin');const task=f.choose(m,'message');await f.flush();
  assert.equal(f.held('begin'),true);assert.deepEqual(f.nativeState(),previousPositive?
    {revision:1,choice:'sender',retired:false}:{revision:0,choice:null,retired:false},'KNOWN_FALSE_BEGIN_ZERO_NATIVE_EFFECT');
  assert.equal(f.of('upsert').length,previousPositive?1:0);await f.release('begin');assert.equal(await task,false);
  assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:previousPositive?1:0,revision:previousPositive?3:2},
    'KNOWN_FALSE_BEGIN_EXACT_PRIOR_RETIREMENT');
  assert.equal(f.nativeState().retired,true);assert.equal(f.nativeState().choice,null);assert.equal(f.view(m).nativeClosure,'RETIRED');
  assert.equal(f.of('upsert').length,previousPositive?1:0);assert.equal(f.of('confirm').length,previousPositive?1:0);
  assert.equal(f.of('retire').length,1);assert.equal(f.view(m).effectiveChoice,'none');
});}
async function r1LostBegin(options={}){await withStart(options,async(f,m)=>{
  await savedSender(f,m);f.failures.begin=null;f.hold('begin');const task=f.choose(m,'message');await f.flush();
  assert.deepEqual(f.nativeState(),{revision:2,choice:null,retired:false},'lost ACK still may have applied attempted begin');
  f.hold('retire');await f.release('begin');assert.equal(await task,false);assert.equal(f.view(m).nativeClosure,'UNKNOWN');
  assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:2,revision:3},'R1_LOST_BEGIN_RETIRE_ATTEMPTED_INTENT');
  assert.equal(f.of('upsert').length,1);assert.equal(f.serverLevel(),'sender');assert.equal(f.of('begin').length,2);
  await f.release('retire');assert.equal(f.view(m).nativeClosure,'RETIRED');assert.equal(f.of('retire').length,1);
});}
async function r1StaleRefresh(options={}){await withStart({...options,sessionLifetime:60000},async(f,m)=>{
  const arm=f.now();await savedSender(f,m);f.hold('rpc');f.refresh(m);await f.flush();assert.equal(f.held('rpc'),true);
  f.auth(f.makeSession(USER,SID,arm+300000),'INITIAL_SESSION');await f.flush();assert.equal(f.view(m).canChoose,true);
  const successor=f.choose(m,'message');await f.flush();assert.equal(await successor,true);
  await f.advance(60000,false);await f.release('rpc',false);await f.flush(false);
  assert.equal(f.of('retire').length,0,'R1_STALE_REFRESH_CANNOT_RETIRE_SUCCESSOR');
  assert.equal(f.view(m).savedChoice,'message');assert.deepEqual(f.nativeState(),{revision:2,choice:'message',retired:false});
  assert.equal(f.of('rpc').length,7);assert.equal(f.of('upsert').length,2);assert.equal(f.view(m).effectiveChoice,'none');
});}
test('r1 inline session D during confirmed refresh held capability response',()=>r1InlineRefreshExpiry(false));
test('r1 inline session D during confirmed refresh held capability rejection',()=>r1InlineRefreshExpiry(true));
test('r1 duplicate INITIAL_SESSION during held getSession preserves exact prior identity',()=>r1DuplicateDuringRefresh());
test('r1 known-false begin initial native target genuinely unchanged',()=>r1KnownFalseBegin(false));
test('r1 known-false begin previous confirmed target genuinely unchanged',()=>r1KnownFalseBegin(true));
test('r1 applied lost begin ACK is not known-false zero-effect refusal',()=>r1LostBegin());
test('r1 stale refresh after old session D cannot retire confirmed successor',()=>r1StaleRefresh());
test('r1 duplicate INITIAL_SESSION during saving remains terminal',async()=>withStart({},async(f,m)=>{
  f.hold('upsert');const task=f.choose(m,'sender');await f.flush();assert.equal(f.held('upsert'),true);
  f.auth(f.makeSession(),'INITIAL_SESSION');await f.flush();assert.equal(f.of('retire').length,1);
  assert.deepEqual(f.of('retire')[0][1],{contextId:CONTEXT,expectedIntentRevision:1,revision:2});
  await f.release('upsert');assert.equal(await task,false);assert.equal(f.view(m).canChoose,false);assert.equal(f.of('confirm').length,0);
}));

const r1Mutants=[
  {name:'response inline expiry omitted',
    from:'if (!current(auth, op)) { closeExpiredOperation(auth, op); return; }',to:'if (!current(auth, op)) return;',
    run:options=>r1InlineRefreshExpiry(false,options),assertion:'R1_REFRESH_INLINE_SESSION_D_RETIRE'},
  {name:'rejection inline expiry omitted',
    from:'if (!closeExpiredOperation(auth, op) && current(auth, op)) { if (qa) invalidate(true); else publish(CLOSED); }',
    to:'if (current(auth, op)) { if (qa) invalidate(true); else publish(CLOSED); }',
    run:options=>r1InlineRefreshExpiry(true,options),assertion:'R1_REFRESH_INLINE_SESSION_D_RETIRE'},
  {name:'stale response mistaken for expired same operation',
    from:'if (!current(auth, op)) { closeExpiredOperation(auth, op); return; }',
    to:'if (!current(auth, op)) { invalidate(true); return; }',
    run:r1StaleRefresh,assertion:'R1_STALE_REFRESH_CANNOT_RETIRE_SUCCESSOR'},
  {name:'prior fingerprint cleared by nonterminal refresh',
    from:'if (terminal) acceptedIdentity = null;',to:'acceptedIdentity = null;',
    run:r1DuplicateDuringRefresh,assertion:'R1_DUPLICATE_INITIAL_HELD_REFRESH_NONTERMINAL'},
  {name:'known-false begin retires unaccepted new intent',
    from:'target.erasureRevision = previousTarget?.erasureRevision ?? previousTarget?.revision ?? 0;',
    to:'target.erasureRevision = target.revision;',
    run:options=>r1KnownFalseBegin(true,options),assertion:'KNOWN_FALSE_BEGIN_EXACT_PRIOR_RETIREMENT'},
  {name:'lost begin ACK treated as known-false',
    from:'ack?.applied === false && lease.target === target && !target.retirement',
    to:'ack?.applied !== true && lease.target === target && !target.retirement',
    run:r1LostBegin,assertion:'R1_LOST_BEGIN_RETIRE_ATTEMPTED_INTENT'},
];
for(const {name,run,assertion,...mutation}of r1Mutants)test(`r1 compiled runtime mutant ${name} killed after passing control`,async()=>{
  await run({});
  await assert.rejects(()=>run({mutation:{file:hookFile,...mutation}}),error=>error.code==='ERR_ASSERTION' && error.message.includes(assertion),
    'r1 mutant must fail named runtime assertion, not syntax/import/setup');
});
