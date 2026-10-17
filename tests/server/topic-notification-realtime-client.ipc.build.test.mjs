import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire,builtinModules} from 'node:module';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import vm from 'node:vm';

const url=new URL('./topic-notification-realtime-client.ipc.build.mjs',import.meta.url);
const api=existsSync(url)?await import(url.href):{};
const sha=value=>createHash('sha256').update(value).digest('hex');
let pending;
async function bundle(){
  assert.equal(typeof api.buildRealtimeClientIpcBundle,'function','SELF_CONTAINED_IPC_BUNDLE_REQUIRED');
  return pending??=api.buildRealtimeClientIpcBundle();
}
function load(code){
  const actualRequire=createRequire(import.meta.url),module={exports:{}};let forbidFiles=false,fileReads=0;
  const guardedFs=new Proxy(actualRequire('node:fs'),{get(target,key){
    if(['readFile','readFileSync','open','openSync'].includes(key))return (...args)=>{
      if(forbidFiles){fileReads++;throw Error('BUNDLE_FILE_READ_REFUSED');}return target[key](...args);};
    return target[key];}});
  const require=name=>{assert.ok(name.startsWith('node:')||builtinModules.includes(name),'ONLY_NODE_CORE_EXTERNALS');
    if(name==='node:fs'||name==='fs')return guardedFs;
    if(name==='node:child_process'||name==='child_process')return new Proxy(actualRequire(name),{
      get(target,key){if(['execFile','execFileSync','spawn','spawnSync','exec','execSync'].includes(key))return ()=>{throw Error('BUNDLE_PROCESS_START_REFUSED');};return target[key];}});
    return actualRequire(name);};
  vm.runInNewContext(code,{module,exports:module.exports,require,process,Buffer,URL,structuredClone,
    __filename:fileURLToPath(import.meta.url),__dirname:fileURLToPath(new URL('.',import.meta.url)),
    setTimeout,clearTimeout,setInterval,clearInterval,TextEncoder,TextDecoder,AbortController,AbortSignal,Request,Response,Headers,
    console:{log(){throw Error('IMPORT_MUST_BE_SILENT');},warn(){throw Error('IMPORT_MUST_BE_SILENT');},error(){throw Error('IMPORT_MUST_BE_SILENT');}}},
  {filename:'client-ipc.cjs',timeout:5000});
  forbidFiles=true;return {api:module.exports,fileReads:()=>fileReads};
}

test('IPC bundle builder pins the reviewed baseline-compatible phase export builder',async()=>{
  assert.equal(typeof api.buildRealtimeClientIpcBundle,'function','SELF_CONTAINED_IPC_BUNDLE_REQUIRED');
  assert.equal(sha(readFileSync(new URL('./topic-notification-realtime-client.build.mjs',import.meta.url))),
    '9b40a68a2dfb644ecec857f478c80e95f23728c9df4c25e1ae58d739cbc878df');
});

test('combined Node22 code reuses the current baseline-compatible phase bundle and includes frozen IPC source pins',async()=>{
  const b=await bundle();assert.equal(b.sha256,sha(b.code));assert.equal(b.target,'node22');
  assert.equal(b.baselineBundleSha256,'2e926dc30a4a0fcfa472b8915a85347a27e8143e6778107305f519cc445b12eb');
  assert.deepEqual(b.externalPackages,[]);assert.equal(b.credentialsEmbedded,false);assert.equal(b.sourceSnapshot,'embedded-public-only');
  assert.equal(b.sourcePins.ipc,'16698aef9a465727859204974ba6e514738517cf7556bc2bf52dccc54e27887d');
  assert.equal(b.sourcePins.ipcTest,'6b6697687caee026f9217835283530ecbba014f71c0271bbbfa3a0367a40d28d');
  assert.ok(b.code.length>100000&&b.code.length<25000000);
  assert.doesNotMatch(b.code,/C:\\\\Users|D:\\\\CodexProjects|VITE_SUPABASE|SUPABASE_SERVICE_ROLE_KEY/);
});

test('standalone CommonJS imports silently and exposes actual IPC/baseline plus immutable public sources without file/Git reads',async()=>{
  const b=await bundle(),loaded=load(b.code);
  assert.equal(typeof loaded.api.runRealtimeClientIpc,'function');assert.equal(typeof loaded.api.runRealtimeClientBaseline,'function');
  assert.equal(typeof loaded.api.runRealtimeClientPhaseIpc,'function');assert.equal(typeof loaded.api.runRealtimeClientPhases,'function');
  assert.equal(typeof loaded.api.loadRealtimeClientSources,'function');
  const a=await loaded.api.loadRealtimeClientSources(),other=await loaded.api.loadRealtimeClientSources();
  assert.equal(a.digest,b.sourceDigest);assert.equal(a.legacyRevision,'75096aa30427fdf551fd0c3bdcb7d9eee7fbd5c5');
  assert.equal(Object.keys(a.old).length,12);assert.equal(Object.keys(a.current).length,15);
  assert.notEqual(a,other);assert.notEqual(a.old,other.old);assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.current));
  assert.throws(()=>{a.old['hooks/useNotifications.ts']='MUTATED';},/read only|Cannot assign/);
  assert.ok(other.old['hooks/useNotifications.ts'].includes('.from("notifications")'));
  assert.equal(loaded.fileReads(),0);
});

test('combined real baseline refuses missing inspector before IO; no policy or native success is manufactured',async()=>{
  const loaded=load((await bundle()).code);
  await assert.rejects(()=>loaded.api.runRealtimeClientBaseline({}),/^Error: RT_CLIENT_INSPECT_REQUIRED$/);
  assert.equal(loaded.fileReads(),0);
});

test('combined actual IPC consumes private stdin config and returns only fixed refusal for an unbound target',async()=>{
  const loaded=load((await bundle()).code),input=new PassThrough(),output=new PassThrough();let stdout='';
  output.on('data',chunk=>{stdout+=chunk.toString();});
  const done=loaded.api.runRealtimeClientIpc({input,output,runBaseline:loaded.api.runRealtimeClientBaseline});
  input.write(JSON.stringify({v:1,kind:'config',binding:{},credentials:{a:'PRIVATE_A',b:'PRIVATE_B'},
    sources:await loaded.api.loadRealtimeClientSources()})+'\n');
  const r=await done;assert.equal(r.status,'REFUSED');assert.equal(r.baselineAccepted,false);assert.equal(r.fullstackAccepted,false);
  assert.equal(r.inspectCount,0);assert.doesNotMatch(stdout,/PRIVATE_|notificationFeed|legacyRevision/);
  assert.equal(JSON.parse(stdout).code,'RT_CLIENT_IPC_REFUSED');assert.equal(loaded.fileReads(),0);
});

test('combined phase IPC uses the real phase runner and fails an unbound target without filesystem/Git/process reads',async()=>{
  const loaded=load((await bundle()).code),input=new PassThrough(),output=new PassThrough();let stdout='';
  output.on('data',chunk=>{stdout+=chunk.toString();});
  const done=loaded.api.runRealtimeClientPhaseIpc({input,output,runPhases:loaded.api.runRealtimeClientPhases});
  input.write(JSON.stringify({v:1,kind:'config',binding:{},credentials:{a:'PRIVATE_A',b:'PRIVATE_B'},sources:await loaded.api.loadRealtimeClientSources()})+'\n');
  const result=await done;assert.equal(result.status,'REFUSED');assert.equal(result.fullstackAccepted,false);
  assert.equal(result.inspectCount,0);assert.doesNotMatch(stdout,/PRIVATE_|legacyRevision|notificationFeed/);assert.equal(loaded.fileReads(),0);
});
