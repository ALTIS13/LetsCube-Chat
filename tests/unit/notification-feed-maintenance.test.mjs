import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const workerPath=new URL('../../artifacts/api-server/src/workers/notificationFeedMaintenanceWorker.ts',import.meta.url);
const source=existsSync(workerPath)?readFileSync(workerPath,'utf8').replaceAll('\r\n','\n'):'';
function compile(text,imports={},ports={}) {
  const module={exports:{}};
  const result=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  vm.runInNewContext(result.outputText,{module,exports:module.exports,process:{env:{}},Date,Promise,Set,Map,Object,JSON,
    setTimeout,clearTimeout,AbortSignal,...ports,require:name=>{assert.ok(Object.hasOwn(imports,name),`unexpected runtime import ${name}`);return imports[name];}});
  return module.exports;
}
const quietLog={'../lib/logger':{logger:{info(){},warn(){}}}};
const api=compile(source,quietLog);
const plain=value=>JSON.parse(JSON.stringify(value));
const UID='70000000-0000-4000-8000-000000000900';
const enabled={NOTIFICATION_FEED_MAINTENANCE_ENABLED:'true'};
const empty={after_fence:null,after_event:null,pending:[]};
const result=(state=empty,patch={})=>({retention_removed:0,orphan_removed:0,accounts_checked:0,accounts_settled:0,
  scanned_fences:0,scanned_events:0,expired_remaining:false,state:plain(state),...patch});
const raw=(patch={})=>({v:1,...result(),...patch});
function deferred() {let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}
const drain=async()=>{for(let i=0;i<24;i++) await Promise.resolve();};
function runtime(module=api,options={}) {
  const timers=[],cancelled=[];
  const worker=module.createNotificationFeedMaintenanceRuntime({schedule:(callback,delay)=>{const entry={callback,delay};timers.push(entry);return entry;},
    cancel:handle=>cancelled.push(handle),...options});
  return {worker,timers,cancelled,next:async()=>{const next=timers.shift();assert.ok(next);assert.equal(next.delay,60000);next.callback();await drain();}};
}
test('actual worker supplies a default-off runtime with zero credentials RPC or timers',async()=>{
  assert.equal(typeof api.createNotificationFeedMaintenanceRuntime,'function','actual maintenance runtime is absent');
  let factories=0,timers=0;
  const runtime=api.createNotificationFeedMaintenanceRuntime({createRepository:async()=>{factories++;throw Error('must stay lazy');},
    schedule:()=>{timers++;}});
  await runtime.start({});
  assert.equal(factories,0);assert.equal(timers,0);assert.equal(runtime.status().enabled,false);
});

for(const flag of [undefined,'false','1','TRUE',' true ']) test(`strict opt-in refuses ${String(flag)} without side effects`,async()=>{
  let calls=0;const f=runtime(api,{createRepository:async()=>{calls++;throw Error('no');}});
  await f.worker.start({NOTIFICATION_FEED_MAINTENANCE_ENABLED:flag});
  assert.equal(calls,0);assert.equal(f.timers.length,0);assert.equal(f.worker.status().enabled,false);
});

async function sequential(module=api) {
  const held=deferred();let calls=0,factories=0;
  const f=runtime(module,{createRepository:async()=>{factories++;return{maintain:async()=>{calls++;return held.promise;}};}});
  const start=f.worker.start(enabled);await drain();const duplicate=f.worker.start(enabled);await drain();
  assert.equal(factories,1);assert.equal(calls,1);assert.equal(f.timers.length,0,'no next tick before completion');
  held.resolve(result());await start;await duplicate;await drain();assert.equal(f.timers.length,1);assert.equal(calls,1);
  await f.next();assert.equal(calls,2);assert.equal(f.timers.length,1);f.worker.stop();
}
test('start is idempotent and ticks are finite/sequential with no overlap or drain loop',()=>sequential());

for(const failure of ['credentials','schema','network']) test(`${failure} failure cannot crash startup or spin retries`,async()=>{
  const f=runtime(api,{createRepository:async()=>{
    if(failure==='credentials') throw Error(UID);
    return {maintain:async()=>{throw Object.assign(Error(UID),{code:failure==='schema'?'PGRST202':'network'});}};
  }});
  await assert.doesNotReject(()=>f.worker.start(enabled));
  const status=f.worker.status();assert.equal(status.running,false);assert.equal(status.error,'maintenance_unavailable');
  assert.equal(status.lastSuccessAt,null);assert.equal(status.lastResult,null);
  assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,60000);assert.equal(JSON.stringify(status).includes(UID),false);
  f.worker.stop();
});

async function progress(module=api) {
  const calls=[];let run=0;
  const state={after_fence:UID,after_event:UID,pending:[UID]};
  const f=runtime(module,{createRepository:async()=>({maintain:async input=>{
    calls.push(plain(input));if(++run===2) throw Error(UID);
    return result(state,{accounts_checked:1,scanned_fences:100,scanned_events:100});
  }})});
  await f.worker.start(enabled);assert.deepEqual(calls,[empty]);
  assert.equal(JSON.stringify(f.worker.status()).includes(UID),false,'private progress cannot escape through status');
  const copy=f.worker.status();copy.lastResult.pending_count=99;assert.equal(f.worker.status().lastResult.pending_count,1);
  await f.next();assert.equal(f.worker.status().lastSuccessAt,null);assert.equal(f.worker.status().lastResult,null);
  await f.next();assert.deepEqual(calls,[empty,state,state],'failed pass retries the last accepted progress');
  assert.equal(f.worker.status().error,null);f.worker.stop();
}
test('accepted private progress survives failure, status projection is copied and contains no UUIDs',()=>progress());

test('stop fences held completion and cancels the sole future timer',async()=>{
  const held=deferred(),f=runtime(api,{createRepository:async()=>({maintain:()=>held.promise})});
  const start=f.worker.start(enabled);await drain();f.worker.stop();held.resolve(result());await start;
  assert.equal(f.worker.status().lastSuccessAt,null);assert.equal(f.timers.length,0);
  await f.worker.start(enabled);assert.equal(f.timers.length,1);f.worker.stop();assert.equal(f.cancelled.length,1);
});

async function restartSequential(module=api) {
  const held=deferred();let calls=0;
  const f=runtime(module,{createRepository:async()=>({maintain:async()=>++calls===1?held.promise:result()})});
  const old=f.worker.start(enabled);await drain();f.worker.stop();
  const resumed=f.worker.start(enabled);await drain();
  try {assert.equal(calls,1,'restart must await the old RPC, not merely fence its result');}
  finally {held.resolve(result());await old;await resumed;f.worker.stop();}
  assert.equal(calls,2);
}
test('stop/start does not overlap an unresolved old RPC',()=>restartSequential());

async function logConsumer(text=source) {
  const records=[];let imports=0,calls=0,factories=0;
  const pino=createRequire(workerPath)('pino');
  const logger=pino({base:null,timestamp:false},{write:line=>records.push(JSON.parse(line))});
  const module=compile(text,{'../lib/logger':{get logger(){imports++;return logger;}}});
  const f=runtime(module,{createRepository:async()=>{factories++;return{maintain:async()=>{
    if(++calls===2) throw Object.assign(Error(UID),{code:UID});
    return {...result({after_fence:UID,after_event:UID,pending:[UID]},
      {retention_removed:2,orphan_removed:3,accounts_checked:1,scanned_fences:100,scanned_events:100,expired_remaining:true}),raw_error:UID};
  }};}});
  try {
    await f.worker.start({});assert.equal(imports,0);assert.equal(factories,0);assert.equal(f.timers.length,0);assert.deepEqual(records,[]);
    await f.worker.start(enabled);
    assert.deepEqual(records,[{level:30,code:'ok',retention_removed:2,orphan_removed:3,accounts_checked:1,accounts_settled:0,
      scanned_fences:100,scanned_events:100,expired_remaining:true,pending_count:1,msg:'notificationFeedMaintenance tick'}]);
    await f.next();assert.equal(records.length,2,'one operational record per completed tick');
    assert.deepEqual(records[1],{level:40,code:'maintenance_unavailable',retention_removed:null,orphan_removed:null,
      accounts_checked:null,accounts_settled:null,scanned_fences:null,scanned_events:null,expired_remaining:null,pending_count:null,
      msg:'notificationFeedMaintenance tick'});
    assert.equal(JSON.stringify(records).includes(UID),false,'no UUID, raw RPC fields or exception details reach the consumer');
    await f.next();assert.equal(records.length,3);assert.deepEqual(records[2],records[0]);
  } finally {f.worker.stop();}
}
test('real structured logger observes failure after PASS and recovery with only allowlisted fields; default-off stays silent',()=>logConsumer());

const repositoryPath=new URL('../../artifacts/api-server/src/workers/notificationFeedMaintenanceRepository.ts',import.meta.url);
const repositorySource=readFileSync(repositoryPath,'utf8').replaceAll('\r\n','\n');
function repoModule(text=repositorySource,createClient=()=>{throw Error('credentials must not be loaded for an injected RPC port');},signals=AbortSignal) {
  return compile(text,{'@supabase/supabase-js':{createClient}},{AbortSignal:signals});
}
const repoApi=repoModule();
function postgrest(execute) {
  let signal;
  return {abortSignal(value){signal=value;return this;},then(resolve,reject){return Promise.resolve().then(()=>execute(signal)).then(resolve,reject);}};
}

async function deadline(moduleSource=repositorySource) {
  const controllers=[],durations=[];let calls=0;
  const module=repoModule(moduleSource,undefined,{timeout:duration=>{
    durations.push(duration);const controller=new AbortController();controllers.push(controller);return controller.signal;
  }});
  const repository=module.createNotificationFeedMaintenanceRepository({}, {rpc:()=>postgrest(signal=>{
    if(++calls>1) return {data:raw(),error:null};
    assert.equal(signal,controllers[0]?.signal,'signal is bound before the actual request thenable runs');
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error(UID)),{once:true}));
  })});
  const f=runtime(api,{createRepository:async()=>repository});
  const started=f.worker.start(enabled);await drain();
  try {
    assert.deepEqual(durations,[30000],'literal SDK transport deadline');assert.equal(f.timers.length,0);
    controllers[0].abort();await started;
    assert.equal(f.worker.status().error,'maintenance_unavailable');assert.equal(f.timers.length,1);
    assert.equal(JSON.stringify(f.worker.status()).includes(UID),false);
    await f.next();assert.equal(calls,2);assert.deepEqual(durations,[30000,30000]);
    assert.equal(f.worker.status().error,null);assert.equal(f.timers.length,1);
  } finally {for(const controller of controllers) controller.abort();await started;f.worker.stop();}
}
test('actual repository binds a 30s abort signal before await; timeout is isolated and a later tick recovers',()=>deadline());
test('repository refuses an RPC port without abortSignal rather than waiting unbounded',async()=>{
  const repository=repoApi.createNotificationFeedMaintenanceRepository({}, {rpc:async()=>({data:raw(),error:null})});
  await assert.rejects(()=>repository.maintain(empty),error=>error.message==='notification_feed_maintenance_rpc_failed');
});
test('actual PostgREST builder forwards the deadline signal to fetch without a network request',async()=>{
  const {createClient}=createRequire(repositoryPath)('@supabase/supabase-js');
  const controller=new AbortController(),durations=[];let observed,calls=0;
  const client=createClient('https://fictional.invalid','fictional-server-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(_url,options)=>{
      calls++;observed=options.signal;
      return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error(UID)),{once:true}));
    }},
  });
  const module=repoModule(repositorySource,undefined,{timeout:value=>{durations.push(value);return controller.signal;}});
  const repository=module.createNotificationFeedMaintenanceRepository({},client);
  const refused=assert.rejects(()=>repository.maintain(empty),error=>error.message==='notification_feed_maintenance_rpc_failed');
  await drain();
  try {assert.deepEqual(durations,[30000]);assert.equal(observed,controller.signal);assert.equal(calls,1);}
  finally {controller.abort();await refused;}
});
test('repository calls only the service maintenance RPC with bounded private state',async()=>{
  const calls=[],repository=repoApi.createNotificationFeedMaintenanceRepository({}, {rpc:(...args)=>{calls.push(plain(args));return postgrest(()=>({data:raw(),error:null}));}});
  const value=await repository.maintain(empty);
  assert.deepEqual(calls,[['notification_feed_maintenance_v2',{p_after_fence:null,p_after_event:null,p_pending:[]}]]);
  assert.deepEqual(plain(value),result());
});

test('repository credential aliases are native-server-only and errors do not disclose their values',()=>{
  const calls=[],module=repoModule(repositorySource,(...args)=>{calls.push(args);return{rpc:()=>{throw Error('not called');}};});
  module.createNotificationFeedMaintenanceRepository({VITE_SUPABASE_URL:'https://fictional.invalid',SELFHOST_SERVICE_ROLE_KEY:'fictional-server-key'});
  assert.equal(calls.length,1);assert.deepEqual(plain(calls[0][2]),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  assert.throws(()=>module.createNotificationFeedMaintenanceRepository({}),/notification_feed_maintenance_credentials_missing/);
});

for(const [name,patch] of [
  ['retention1001',{retention_removed:1001}],['orphan1001',{orphan_removed:1001,accounts_checked:10}],
  ['eleven accounts',{accounts_checked:11}],['window101',{scanned_events:101}],['settled exceeds checked',{accounts_settled:1}],
  ['cursor contradicts short window',{state:{...empty,after_fence:UID}}],['pending11',{state:{...empty,pending:Array(11).fill(UID)}}],
  ['duplicate pending',{state:{...empty,pending:[UID,UID]}}],['unknown field',{unknown:UID}],['bad version',{v:2}],
  ['bad backlog',{expired_remaining:null}],['invalid cursor',{state:{...empty,after_event:'bad'}}],
]) test(`repository refuses ${name} without adopting progress`,async()=>{
  const repository=repoApi.createNotificationFeedMaintenanceRepository({}, {rpc:()=>postgrest(()=>({data:raw(patch),error:null}))});
  await assert.rejects(()=>repository.maintain(empty),/notification_feed_maintenance_invalid_data/);
});

test('malformed input refuses before RPC; backend error never becomes empty successful progress',async()=>{
  let calls=0;const repository=repoApi.createNotificationFeedMaintenanceRepository({}, {rpc:()=>{calls++;return postgrest(()=>({data:raw(),error:{message:UID}}));}});
  await assert.rejects(()=>repository.maintain({...empty,pending:Array(11).fill(UID)}),/invalid_data/);assert.equal(calls,0);
  await assert.rejects(()=>repository.maintain(empty),error=>error.message==='notification_feed_maintenance_rpc_failed');assert.equal(calls,1);
});

function mutate(name,needle,replacement,proof) {
  test(`compiled literal omission: ${name}`,async()=>{
    assert.equal(source.split(needle).length-1,1);await proof(api);
    const mutant=compile(source.replace(needle,()=>replacement),quietLog);
    await assert.rejects(()=>proof(mutant),error=>error.code==='ERR_ASSERTION');
  });
}
mutate('default-off', 'environment["NOTIFICATION_FEED_MAINTENANCE_ENABLED"] !== "true"',
  'environment["NOTIFICATION_FEED_MAINTENANCE_ENABLED"] === "true"',async module=>{
    let calls=0;const f=runtime(module,{createRepository:async()=>{calls++;throw Error('no');}});
    await f.worker.start({});assert.equal(calls,0);assert.equal(f.timers.length,0);f.worker.stop();
  });
mutate('duplicate start must not retire the running tick','if (active || environment[','if (environment[',sequential);
mutate('failure must retain private progress','current.lastSuccessAt = null; current.lastResult = null;',
  'progress = { after_fence: null, after_event: null, pending: [] }; current.lastSuccessAt = null; current.lastResult = null;',progress);
mutate('status must not expose private cursors','return { ...current, lastResult:', 'return { ...current, ...progress, lastResult:',progress);
mutate('restart must await unresolved RPC','if (inFlight) await inFlight;','',restartSequential);

for(const [name,needle,replacement] of [
  ['missing consumer','await logTick(g);',''],
  ['private state spread','const fields = {','const fields = { ...progress,'],
  ['stale PASS code','code: current.error ?? "ok"','code: "ok"'],
]) test(`compiled operational logging omission: ${name}`,async()=>{
  assert.equal(source.split(needle).length-1,1);
  await assert.rejects(()=>logConsumer(source.replace(needle,()=>replacement)),error=>error.code==='ERR_ASSERTION');
});

test('logger write failure is isolated and the next maintenance tick is still scheduled',async()=>{
  let calls=0;const module=compile(source,{'../lib/logger':{logger:{info(){throw Error(UID);},warn(){throw Error(UID);}}}});
  const f=runtime(module,{createRepository:async()=>({maintain:async()=>{calls++;return result();}})});
  try {
    await assert.doesNotReject(()=>f.worker.start(enabled));assert.equal(f.timers.length,1);
    await f.next();assert.equal(calls,2);assert.equal(f.timers.length,1);
  } finally {f.worker.stop();}
});
test('compiled literal repository retention1001 omission is caught by actual response validation',async()=>{
  const needle='integer(row.retention_removed, 1000)';assert.equal(repositorySource.split(needle).length-1,1);
  const module=repoModule(repositorySource.replace(needle,'integer(row.retention_removed, 1001)'));
  const repository=module.createNotificationFeedMaintenanceRepository({}, {rpc:()=>postgrest(()=>({data:raw({retention_removed:1001}),error:null}))});
  await assert.rejects(()=>assert.rejects(()=>repository.maintain(empty),/invalid_data/),error=>error.code==='ERR_ASSERTION');
});

for(const [name,replacement] of [['absent',''],['unbounded','.abortSignal(AbortSignal.timeout(300_000))']])
  test(`compiled SDK deadline ${name} omission is caught`,async()=>{
    const needle='.abortSignal(AbortSignal.timeout(30_000))';assert.equal(repositorySource.split(needle).length-1,1);
    await assert.rejects(()=>deadline(repositorySource.replace(needle,replacement)),error=>error.code==='ERR_ASSERTION');
  });
