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

test('new IPC bundle builder is available without changing the baseline builder',async()=>{
  assert.equal(typeof api.buildRealtimeClientIpcBundle,'function','SELF_CONTAINED_IPC_BUNDLE_REQUIRED');
  assert.equal(sha(readFileSync(new URL('./topic-notification-realtime-client.build.mjs',import.meta.url))),
    '68cf96e5fd47ba94379dd01dda843492ccd8f557753d0e465b677cd94035b04b');
});

test('combined Node22 code reuses the exact accepted baseline bundle and includes frozen IPC source pins',async()=>{
  const b=await bundle();assert.equal(b.sha256,sha(b.code));assert.equal(b.target,'node22');
  assert.equal(b.baselineBundleSha256,'a6880489e12d5e69badf6f65225002b22820b40296e3308ca572935a170a2764');
  assert.deepEqual(b.externalPackages,[]);assert.equal(b.credentialsEmbedded,false);assert.equal(b.sourceSnapshot,'embedded-public-only');
  assert.equal(b.sourcePins.ipc,'8f908750d9791b017cc432d1bdcf0a914479d764bae95a4650cea6538ba12e3f');
  assert.equal(b.sourcePins.ipcTest,'7281113ceeb97df7b4b21523b0ef5fc84aa371bad4101439a7c46c05f8cde521');
  assert.ok(b.code.length>100000&&b.code.length<25000000);
  assert.doesNotMatch(b.code,/C:\\\\Users|D:\\\\CodexProjects|VITE_SUPABASE|SUPABASE_SERVICE_ROLE_KEY/);
});

test('standalone CommonJS imports silently and exposes actual IPC/baseline plus immutable public sources without file/Git reads',async()=>{
  const b=await bundle(),loaded=load(b.code);
  assert.equal(typeof loaded.api.runRealtimeClientIpc,'function');assert.equal(typeof loaded.api.runRealtimeClientBaseline,'function');
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
