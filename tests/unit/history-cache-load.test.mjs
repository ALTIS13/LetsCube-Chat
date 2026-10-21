import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { historyCacheCodecModules } from '../helpers/history-cache-codec.mjs';

const path = new URL('../../artifacts/kub/src/lib/historyCache/load.ts', import.meta.url);
let source='export {};';try {source=await readFile(path,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
source=source.replace('"./codec.ts"',JSON.stringify(await historyCacheCodecModules()));
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const api=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const id=n=>`71000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={chatId:id(10),mode:'all',topicId:null,before:null};
const payload=JSON.stringify({version:1,chat_id:id(10),scope:'all',topic_id:null,general_topic_ids:[],
  before_created_at:null,before_id:null,cleared_at:null,has_more:false,next_before_created_at:null,next_before_id:null,rows:[]});
const digest=createHash('sha256').update(payload).digest('hex');

// Only storage/network leaves are controlled in these scheduling tests. Actual
// IDB and SQL are exercised by their own cohorts and the two-document browser case.
function fixture() {
  let generation='owned-v1';const requests=[],writes=[];
  const storage={async capture(namespace,ownerId){return {namespace,ownerId,generation};},async read(){return null;},
    async write(lease,key,value,now){writes.push({key,value,now});return lease.generation===generation;},
    async invalidate(){generation='owned-v2';}};
  const request=async(...args)=>{requests.push(args);return {status:'fresh',payload,digest};};
  return {storage,request,requests,writes};
}

test('page loader returns admitted network data and writes only exact verified snapshot',async()=>{
  assert.equal(typeof api.loadHistoryCachePage,'function','received-history cache loader is missing');
  const f=fixture();
  const result=await api.loadHistoryCachePage({...f,namespace:'backend',ownerId:id(1),scope,isCurrent:()=>true,now:()=>1000});
  assert.equal(result?.digest,digest);assert.equal(f.requests.length,1);assert.equal(f.requests[0][1],null);
  assert.deepEqual(f.writes[0].value,{payload,digest});assert.equal(f.writes[0].now,1000);
});

test('retired owner, held response across invalidate, corrupt or denied replies cannot publish',async()=>{
  for(const phase of ['capture','read','request','write','denied','corrupt']) {
    const f=fixture();let active=true;
    if(phase==='capture') {const capture=f.storage.capture;f.storage.capture=async(...args)=>{const x=await capture(...args);active=false;return x;};}
    if(phase==='read') f.storage.read=async()=>{active=false;return null;};
    if(phase==='request') f.request=async()=>{await f.storage.invalidate();return {status:'fresh',payload,digest};};
    if(phase==='write') {const write=f.storage.write;f.storage.write=async(...args)=>{const ok=await write(...args);active=false;return ok;};}
    if(phase==='denied') f.request=async()=>({status:'denied'});
    if(phase==='corrupt') f.request=async()=>({status:'fresh',payload:payload+' ',digest});
    assert.equal(await api.loadHistoryCachePage({...f,namespace:'backend',ownerId:id(1),scope,isCurrent:()=>active,now:()=>1000}),null,phase);
  }
});

test('unavailable storage and failed durable writes do not masquerade as cache success',async()=>{
  for(const phase of ['capture','read','write']) {
    const f=fixture();f.storage[phase]=async()=>{throw Error('synthetic sensitive detail');};
    assert.equal(await api.loadHistoryCachePage({...f,namespace:'backend',ownerId:id(1),scope,isCurrent:()=>true,now:()=>1000}),null);
  }
  const f=fixture();f.storage.write=async()=>false;
  assert.equal(await api.loadHistoryCachePage({...f,namespace:'backend',ownerId:id(1),scope,isCurrent:()=>true,now:()=>1000}),null);
});
