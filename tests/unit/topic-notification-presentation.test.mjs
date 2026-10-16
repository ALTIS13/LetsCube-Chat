import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const sourceUrl=new URL("../../artifacts/kub/src/lib/messageAlertDecisions.ts",import.meta.url);
const ID="91000000-0000-4000-8000-000000000001";
const OTHER="91000000-0000-4000-8000-000000000002";
const TOPIC="92000000-0000-4000-8000-000000000001";
const decision=(extra={})=>({notification_id:ID,allowed:true,scope_key:"general",revision:0,...extra});
async function subject(source) {
  if(source===undefined) {
    try {source=readFileSync(sourceUrl,"utf8");} catch(error) {if(error.code!=="ENOENT")throw error;}
  }
  assert.ok(source,"fresh account-owned message alert authority is missing");
  const code=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
async function run(response={data:[decision()],error:null},current=()=>true,source) {
  const {currentMessageAlertAllowed}=await subject(source);
  const calls=[];
  const allowed=await currentMessageAlertAllowed(ID,current,{rpc:async(name,args)=>{
    calls.push({name,args});return response;
  }});
  return {allowed,calls};
}

test("a current exact decision permits one attempt without caching or broadening its IDs",async()=>{
  const result=await run();assert.equal(result.allowed,true);
  assert.deepEqual(result.calls,[{name:"message_notification_alert_decisions",args:{p_notification_ids:[ID]}}]);
  assert.equal((await run({data:[decision({scope_key:TOPIC,revision:7})],error:null})).allowed,true);
  assert.equal((await run({data:[decision({allowed:false,scope_key:null,revision:null})],error:null})).allowed,false);
});
test("a retired caller never asks or reuses another owner's decision",async()=>{
  const result=await run(undefined,()=>false);assert.equal(result.allowed,false);assert.deepEqual(result.calls,[]);
  const {currentMessageAlertAllowed}=await subject();let owner=true,release;
  const held=new Promise(resolve=>{release=resolve;});
  const pending=currentMessageAlertAllowed(ID,()=>owner,{rpc:()=>held});
  owner=false;release({data:[decision()],error:null});assert.equal(await pending,false);
});
test("unknown errors foreign duplicate malformed and unbounded responses never become allow",async()=>{
  const malformed=[null,{},[],[decision(),decision()],[decision({notification_id:OTHER})],
    [decision({allowed:"true"})],[decision({scope_key:null})],[decision({scope_key:"unknown"})],
    [decision({revision:null})],[decision({revision:-1})],[decision({revision:0.5})],
    [decision({revision:9007199254740992})],[decision({revision:"1"})]];
  for(const data of malformed) assert.equal((await run({data,error:null})).allowed,false,JSON.stringify(data));
  for(const response of [undefined,{data:[decision()]},{data:[decision()],error:{}},{data:[decision()],error:"denied"}])
    assert.equal((await run(response===undefined?{}:response)).allowed,false);
  const {currentMessageAlertAllowed}=await subject();
  assert.equal(await currentMessageAlertAllowed(ID,()=>true,{rpc:async()=>{throw Error("private provider detail");}}),false);
});
test("malformed notification identity is refused before a transport call",async()=>{
  const {currentMessageAlertAllowed}=await subject();let calls=0;
  for(const id of [null,undefined,"",{},"not-a-uuid"])
    assert.equal(await currentMessageAlertAllowed(id,()=>true,{rpc:async()=>{calls++;return {data:[decision({notification_id:id})],error:null};}}),false);
  assert.equal(calls,0);
});

test("compiled decision guard omissions break literal authority assertions",async()=>{
  const original=readFileSync(sourceUrl,"utf8");
  const changes=[
    ["post-await owner","if (!isCurrent()) return false;","",async source=>{
      const {currentMessageAlertAllowed}=await subject(source);let current=true,release;
      const held=new Promise(resolve=>{release=resolve;});
      const pending=currentMessageAlertAllowed(ID,()=>current,{rpc:()=>held});
      current=false;release({data:[decision()],error:null});return pending;
    }],
    ["exact ID","row.notification_id !== notificationId || ","",async source=>(await run({data:[decision({notification_id:OTHER})],error:null},()=>true,source)).allowed],
    ["RPC error","result.error !== null || ","",async source=>(await run({data:[decision()],error:{}},()=>true,source)).allowed],
    ["safe revision","Number.isSafeInteger(row.revision)","Number.isFinite(row.revision)",async source=>(await run({data:[decision({revision:0.5})],error:null},()=>true,source)).allowed],
  ];
  for(const [name,before,after,attempt] of changes) {
    assert.equal(original.split(before).length,2,`${name}: unique compiled anchor`);
    assert.equal(await attempt(original.replace(before,after)),true,`${name}: omitted rule must violate the independent false expectation`);
  }
});
