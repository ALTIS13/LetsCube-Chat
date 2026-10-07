import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const kub = fileURLToPath(new URL("../../artifacts/kub/", import.meta.url));
const root = resolve(kub, "src");
const req = createRequire(resolve(kub, "package.json"));
const {build} = createRequire(req.resolve("vite"))("esbuild");
const {chromium} = req("@playwright/test");
const U = "11111111-1111-4111-8111-000000000001";
const S = "22222222-2222-4222-8222-000000000001";
const D = "33333333-3333-4333-8333-000000000001";
let browser, bundle;

async function compile(mutation) {
  let changed = 0;
  const stubs = {
    "lib/platform/capabilities.ts": `export const isNativeAndroid=()=>window.native;
      export const supportsCapacitorPlugin=name=>name==='MessagePreviews' && window.plugin;`,
    "lib/supabase/client.ts": `export const createClient=()=>window.client;`,
    "store/app.store.ts": `import {useSyncExternalStore} from 'react';
      const listeners=new Set();
      export function useAppStore(select) {return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>select(window.state));}
      useAppStore.getState=()=>window.state;
      useAppStore.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
      useAppStore.setState=patch=>{window.state={...window.state,...patch};for(const fn of listeners) fn(window.state);};`,
  };
  // Before the feature exists, model the existing generic-only outcome, not a build failure.
  if (!existsSync(resolve(root, "hooks/useNativeMessagePreview.ts"))) stubs["hooks/useNativeMessagePreview.ts"] =
    `export const useNativeMessagePreview=()=>({status:'unavailable',savedChoice:null,effectiveChoice:'none',canChoose:false,saving:false,error:null,refresh(){},async setChoice(){return false;}});`;
  const result = await build({write:false, bundle:true, platform:"browser", format:"iife", jsx:"automatic",
    alias:{"@":root}, define:{"process.env.NODE_ENV":'"development"'}, plugins:[{name:"offline",setup(p) {
      p.onResolve({filter:/^@capacitor\/core$/},()=>({path:"core",namespace:"fixture"}));
      p.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:`export function registerPlugin(name) {
        window.registered.push(name);if(name!=='MessagePreviews') throw Error('wrong authority');
        return {async getCapabilities(){const value={...window.binding};window.calls.push(['native']);await window.gate('native');return value;}};}`,loader:"ts"}));
      p.onResolve({filter:/useNativeMessagePreview/},args=>stubs["hooks/useNativeMessagePreview.ts"] ? {path:"missing-hook",namespace:"baseline"}:undefined);
      p.onLoad({filter:/.*/,namespace:"baseline"},()=>({contents:stubs["hooks/useNativeMessagePreview.ts"],loader:"ts"}));
      p.onLoad({filter:/\.[tj]s$/},args=>{
        const path=args.path.slice(root.length+1).replaceAll("\\","/");
        if(stubs[path]) return {contents:stubs[path],loader:"ts",resolveDir:root};
        if(mutation && path===mutation.file) {
          const text=readFileSync(args.path,"utf8").replaceAll("\r\n","\n");
          assert.equal(text.split(mutation.from).length-1,1,"literal mutation must match once");changed++;
          return {contents:text.replace(mutation.from,mutation.to),loader:"ts",resolveDir:resolve(args.path,"..")};
        }
      });
    }}], stdin:{loader:"tsx",resolveDir:kub,contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {useAppStore} from './src/store/app.store.ts';import {useNativeMessagePreview} from './src/hooks/useNativeMessagePreview.ts';
      import * as contract from './src/lib/platform/nativeMessagePreviewContract.ts';window.contract=contract;
      const U='${U}',S='${S}',D='${D}';window.state={currentUser:{id:U},accountEpoch:1};
      window.native=true;window.plugin=true;window.registered=[];window.calls=[];window.holds={};window.gates=new Map();
      window.results=[];window.level='none';window.capError=null;window.writeError=null;window.badWrite=false;window.capExtra={};
      window.binding={protocol:1,recipientId:U,recipientSessionId:S,deviceId:D};
      window.makeSession=(sid=S,extra={})=>({user:{id:U},access_token:'fixture.'+btoa(JSON.stringify({sub:U,session_id:sid,
        role:'authenticated',is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600,...extra}))+'.fixture'});
      window.session=window.makeSession();window.authListeners=new Set();
      window.gate=async name=>{if(!window.holds[name])return;delete window.holds[name];await new Promise(ok=>window.gates.set(name,ok));window.gates.delete(name);};
      window.client={auth:{onAuthStateChange(fn){window.authListeners.add(fn);return {data:{subscription:{unsubscribe(){window.authListeners.delete(fn);}}}};},
        async getSession(){const session=window.session;window.calls.push(['session']);await window.gate('session');return {data:{session},error:null};}},
        async rpc(name,args){window.calls.push(['rpc',name,args]);const data=[{preview_v:1,recipient_id:window.binding.recipientId,session_id:window.binding.recipientSessionId,
          device_id:window.binding.deviceId,preview_level:window.level,...window.capExtra}];await window.gate('rpc');return {data,error:window.capError};},
        from(table){return {upsert(value,options){window.calls.push(['write',table,value,options]);return {async select(columns){
          window.calls.push(['select',columns]);await window.gate('write');if(window.writeError)return {data:null,error:window.writeError};
          window.level=value.preview_level;return {data:[{user_id:value.user_id,preview_level:window.badWrite?'message':value.preview_level}],error:null};}};}};}};
      window.auth=(session,event='TOKEN_REFRESHED')=>{window.session=session;for(const fn of window.authListeners) {
        const before=window.calls.length;const returned=fn(event,session);if(returned!==undefined || window.calls.length!==before)throw Error('auth callback did async work');}};
      function Harness(){window.preview=useNativeMessagePreview();return <output>{window.preview.effectiveChoice}</output>;}
      const app=createRoot(document.getElementById('root'));window.attach=()=>flushSync(()=>app.render(<Harness/>));window.detach=()=>flushSync(()=>app.render(null));
      const account=id=>useAppStore.setState({currentUser:id?{id}:null,accountEpoch:window.state.accountEpoch+1});
      window.roundTrip=()=>{account(null);account(U);};window.account=id=>flushSync(()=>account(id));
      window.choose=level=>{window.preview.setChoice(level).then(value=>window.results.push(value));};
      window.destroy=()=>flushSync(()=>app.unmount());
    `}});
  if(mutation) assert.equal(changed,1,"mutated actual source compiled");
  return result.outputFiles[0].text;
}
test.before(async()=>{bundle=await compile();browser=await chromium.launch({headless:true});});
test.after(async()=>{await browser?.close();});

async function fixture(setup, code=bundle) {
  const context=await browser.newContext({serviceWorkers:"block"});const page=await context.newPage();const errors=[],network=[];
  page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",route=>{network.push(route.request().url());return route.abort();});
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:code});if(setup)await page.evaluate(setup);await page.evaluate(()=>window.attach());
  const drain=()=>page.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(ok=>setTimeout(ok,10));});await drain();
  return {page,drain,view:()=>page.evaluate(()=>({status:window.preview.status,saved:window.preview.savedChoice,effective:window.preview.effectiveChoice,choose:window.preview.canChoose,saving:window.preview.saving})),
    release:async name=>{await page.evaluate(name=>window.gates.get(name)?.(),name);await drain();},
    close:async()=>{await page.evaluate(()=>{window.destroy();for(const resolve of window.gates.values())resolve();});await drain();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await context.close();}};
}

async function ready(f) {
  assert.deepEqual(await f.view(),{status:"ready",saved:"none",effective:"none",choose:true,saving:false});
  const calls=await f.page.evaluate(()=>window.calls);
  assert.deepEqual(calls.find(x=>x[0]==="rpc"),["rpc","native_message_preview_capability",{p_device_id:D}]);
}
test("old APK and ordinary browser never register MessagePreviews or call backend",async()=>{
  for(const setup of [()=>{window.plugin=false;},()=>{window.native=false;}]) {
    const f=await fixture(setup);try {assert.equal((await f.view()).effective,"none");assert.equal((await f.view()).choose,false);
      await f.page.evaluate(()=>window.choose('message'));await f.drain();assert.deepEqual(await f.page.evaluate(()=>window.calls),[]);
      assert.deepEqual(await f.page.evaluate(()=>window.registered),[]);} finally {await f.close();}
  }
});
test("actual hook authenticates distinct native candidate and exact capability RPC",async()=>{const f=await fixture();try {await ready(f);}finally{await f.close();}});
test("explicit choice needs exact own-row ACK and a fresh matching capability",async()=>{
  const f=await fixture();try {await ready(f);await f.page.evaluate(()=>window.choose('sender'));await f.drain();
    assert.equal((await f.view()).effective,"sender");assert.equal((await f.view()).saved,"sender");
    assert.deepEqual(await f.page.evaluate(()=>window.calls.find(x=>x[0]==='write')),
      ["write","notification_preview_preferences",{user_id:U,preview_level:"sender"},{onConflict:"user_id"}]);
    assert.deepEqual(await f.page.evaluate(()=>window.results),[true]);
  }finally{await f.close();}
});
test("failed none is locally closed without claiming a saved ACK",async()=>{
  const f=await fixture(()=>{window.level='message';});try {assert.equal((await f.view()).effective,"message");
    await f.page.evaluate(()=>{window.writeError={code:'42501'};window.choose('none');});await f.drain();
    assert.equal((await f.view()).effective,"none");assert.equal((await f.view()).saved,"message");
    assert.deepEqual(await f.page.evaluate(()=>window.results),[false]);
  }finally{await f.close();}
});

test("wrong role/anonymous/expired JWT and wrong native session cause no RPC or writes",async()=>{
  for(const extra of [{role:'service_role'},{is_anonymous:true},{exp:1}]) {
    const f=await fixture(()=>{});try {
      await ready(f);const count=await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='rpc').length);
      await f.page.evaluate(extra=>window.auth(window.makeSession(undefined,extra)),extra);await f.drain();
      assert.equal((await f.view()).effective,'none');assert.equal((await f.view()).choose,false);
      assert.equal(await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='rpc').length),count);
    }finally{await f.close();}
  }
  const f=await fixture(()=>{window.binding.recipientSessionId=window.binding.deviceId;});try {
    assert.equal((await f.view()).choose,false);assert.equal(await f.page.evaluate(()=>window.calls.some(x=>x[0]==='rpc')),false);
  }finally{await f.close();}
});
test("missing RPC or malformed capability never grants a choice",async()=>{
  for(const setup of [()=>{window.capError={code:'PGRST202'};},()=>{window.capExtra.preview_v=2;},
    ()=>{window.capExtra.body='must not be consumed';},()=>{window.capExtra.device_id=window.binding.recipientId;}]) {
    const f=await fixture(setup);try {assert.equal((await f.view()).choose,false);assert.equal((await f.view()).saved,null);
      await f.page.evaluate(()=>window.choose('message'));await f.drain();assert.equal(await f.page.evaluate(()=>window.calls.some(x=>x[0]==='write')),false);
    }finally{await f.close();}
  }
});
test("held bootstrap read loses to synchronous auth callback and newest session",async()=>{
  const f=await fixture(()=>{window.holds.session=true;});try {
    assert.equal(await f.page.evaluate(()=>window.gates.has('session')),true);
    await f.page.evaluate(()=>{window.level='sender';window.auth(window.makeSession());});await f.drain();
    assert.equal((await f.view()).effective,'sender');const before=await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='rpc').length);
    await f.release('session');assert.equal(await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='rpc').length),before);
  }finally{await f.close();}
});
test("token refresh fences a held capability before React commit",async()=>{
  const f=await fixture(()=>{window.level='message';window.holds.rpc=true;});try {
    assert.equal(await f.page.evaluate(()=>window.gates.has('rpc')),true);
    await f.page.evaluate(()=>{window.level='none';window.auth(window.makeSession());});await f.drain();
    assert.equal((await f.view()).effective,'none');await f.release('rpc');assert.equal((await f.view()).effective,'none');
  }finally{await f.close();}
});
test("batched same-owner accountEpoch ABA fences the old capability",async()=>{
  const f=await fixture(()=>{window.level='message';window.holds.rpc=true;});try {
    assert.equal(await f.page.evaluate(()=>window.gates.has('rpc')),true);
    await f.page.evaluate(()=>{window.level='none';window.roundTrip();});await f.drain();
    await f.release('rpc');assert.equal((await f.view()).effective,'none');
  }finally{await f.close();}
});
test("device changes while capability reply is held never enable old device authority",async()=>{
  const f=await fixture(()=>{window.level='message';window.holds.rpc=true;});try {
    assert.equal(await f.page.evaluate(()=>window.gates.has('rpc')),true);
    await f.page.evaluate(()=>{window.binding.deviceId=window.binding.recipientSessionId;});
    await f.release('rpc');assert.equal((await f.view()).choose,false);assert.equal((await f.view()).effective,'none');
  }finally{await f.close();}
});
test("explicit refresh supersedes held loading and never dispatches an invalidated write",async()=>{
  const f=await fixture();try {await ready(f);
    await f.page.evaluate(()=>{window.holds.native=true;window.choose('message');});await f.drain();
    assert.equal(await f.page.evaluate(()=>window.gates.has('native')),true);
    await f.page.evaluate(()=>window.preview.refresh());await f.drain();await f.release('native');
    assert.equal((await f.view()).effective,'none');assert.equal(await f.page.evaluate(()=>window.calls.some(x=>x[0]==='write')),false);
  }finally{await f.close();}
});
test("wrong device at write preflight and wrong own-row ACK refuse consent",async()=>{
  for(const setup of [()=>{window.binding.deviceId=window.binding.recipientSessionId;},()=>{window.badWrite=true;}]) {
    const f=await fixture();try {await ready(f);await f.page.evaluate(setup);await f.page.evaluate(()=>window.choose('sender'));await f.drain();
      assert.equal((await f.view()).effective,'none');assert.equal((await f.view()).saved,'none');assert.deepEqual(await f.page.evaluate(()=>window.results),[false]);
    }finally{await f.close();}
  }
});
test("consent ACK alone cannot replace final capability confirmation",async()=>{
  const f=await fixture();try {await ready(f);await f.page.evaluate(()=>{window.holds.write=true;window.choose('sender');});await f.drain();
    assert.equal(await f.page.evaluate(()=>window.gates.has('write')),true);
    await f.page.evaluate(()=>{window.capExtra.preview_level='message';});await f.release('write');
    assert.equal((await f.view()).effective,'none');assert.equal((await f.view()).saved,'none');assert.deepEqual(await f.page.evaluate(()=>window.results),[false]);
  }finally{await f.close();}
});
test("newest none is serialized after an already dispatched message write",async()=>{
  const f=await fixture();try {await ready(f);await f.page.evaluate(()=>{window.holds.write=true;window.choose('message');});await f.drain();
    assert.equal(await f.page.evaluate(()=>window.gates.has('write')),true);
    await f.page.evaluate(()=>window.choose('none'));await f.drain();
    assert.equal(await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='write').length),1);
    await f.release('write');assert.equal((await f.view()).effective,'none');assert.equal((await f.view()).saved,'none');
    assert.equal(await f.page.evaluate(()=>window.level),'none');assert.deepEqual(await f.page.evaluate(()=>window.results),[false,true]);
  }finally{await f.close();}
});
test("remount/refresh waits for an old dispatched write before taking a saved snapshot",async()=>{
  for(const action of ['remount','refresh']) {
    const f=await fixture();try {await ready(f);await f.page.evaluate(()=>{window.holds.write=true;window.choose('sender');});await f.drain();
      assert.equal(await f.page.evaluate(()=>window.gates.has('write')),true);
      await f.page.evaluate(action=>{if(action==='remount'){window.detach();window.attach();}else window.preview.refresh();},action);await f.drain();
      assert.equal((await f.view()).effective,'none');await f.release('write');assert.equal((await f.view()).saved,'sender');
      assert.equal((await f.view()).effective,'sender');assert.deepEqual(await f.page.evaluate(()=>window.results),[false]);
    }finally{await f.close();}
  }
});
test("unmounted held auth/native/capability reads do not continue backend work",async()=>{
  for(const hold of ['session','native','rpc']) {
    const f=await fixture();
    try {await f.page.evaluate(hold=>{window.holds[hold]=true;window.preview.refresh();},hold);await f.drain();
      assert.equal(await f.page.evaluate(hold=>window.gates.has(hold),hold),true);
      const count=await f.page.evaluate(()=>window.calls.length);await f.page.evaluate(()=>window.detach());await f.release(hold);
      assert.equal(await f.page.evaluate(()=>window.calls.length),count);
    }finally{await f.close();}
  }
});

test("a setter captured by account A cannot write into the later ready account B",async()=>{
  const f=await fixture();try {await ready(f);await f.page.evaluate(()=>{
    window.oldChoice=window.preview.setChoice;const owner=window.binding.deviceId;
    window.binding.recipientId=owner;window.session={user:{id:owner},access_token:'fixture.'+btoa(JSON.stringify({
      sub:owner,session_id:window.binding.recipientSessionId,role:'authenticated',is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600}))+'.fixture'};
    window.account(owner);
  });await f.drain();assert.equal((await f.view()).choose,true);
    const result=await f.page.evaluate(()=>window.oldChoice('message'));await f.drain();
    assert.equal(result,false);assert.equal(await f.page.evaluate(()=>window.calls.some(x=>x[0]==='write')),false);
  }finally{await f.close();}
});

const hookFile = "hooks/useNativeMessagePreview.ts";
const contractFile = "lib/platform/nativeMessagePreviewContract.ts";
const mutants = [
  {name:"wrong-role context", file:contractFile, from:'claims.role !== "authenticated"', to:'false',
    setup:()=>{window.session=window.makeSession(undefined,{role:'service_role'});}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"anonymous context", file:contractFile, from:'claims.is_anonymous !== false', to:'false',
    setup:()=>{window.session=window.makeSession(undefined,{is_anonymous:true});}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"future native protocol", file:contractFile, from:'value.protocol !== 1', to:'value.protocol !== 2',
    setup:()=>{window.binding.protocol=2;}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"future server version", file:contractFile, from:'row.preview_v !== 1', to:'row.preview_v !== 2',
    setup:()=>{window.capExtra.preview_v=2;}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"server recipient binding", file:contractFile, from:'row.recipient_id !== expected.recipientId', to:'false',
    setup:()=>{window.capExtra.recipient_id=window.binding.deviceId;}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"server session binding", file:contractFile, from:'row.session_id !== expected.recipientSessionId', to:'false',
    setup:()=>{window.capExtra.session_id=window.binding.deviceId;}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"server device binding", file:contractFile, from:'row.device_id !== expected.deviceId', to:'false',
    setup:()=>{window.capExtra.device_id=window.binding.recipientId;}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"five-key response refusal", file:contractFile, from:'Object.keys(row).length !== CAPABILITY_KEYS.length', to:'false',
    setup:()=>{window.capExtra.body='private field';}, oracle:async f=>assert.equal((await f.view()).choose,false)},
  {name:"account epoch final guard", file:hookFile,
    from:'useAppStore.getState().accountEpoch === epoch;\n    const current', to:'true;\n    const current',
    oracle:async f=>{await ready(f);await f.page.evaluate(()=>{window.holds.native=true;window.preview.refresh();});await f.drain();
      assert.equal(await f.page.evaluate(()=>window.gates.has('native')),true);
      const before=await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='rpc').length);
      await f.page.evaluate(()=>{window.state={...window.state,accountEpoch:window.state.accountEpoch+2};});await f.release('native');
      assert.equal(await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='rpc').length),before);}},
  {name:"auth and request revisions", file:hookFile,
    from:'own() && auth === authRevision && op === operation\n      && session !== null', to:'own() && session !== null',
    setup:()=>{window.level='message';window.holds.rpc=true;}, oracle:async f=>{
      assert.equal(await f.page.evaluate(()=>window.gates.has('rpc')),true);
      await f.page.evaluate(()=>{window.level='none';window.auth(window.makeSession());});await f.drain();await f.release('rpc');
      assert.equal((await f.view()).effective,'none');}},
  {name:"post-response native binding", file:hookFile, from:'latest.deviceId !== candidate.deviceId', to:'false',
    setup:()=>{window.level='message';window.holds.rpc=true;}, oracle:async f=>{
      assert.equal(await f.page.evaluate(()=>window.gates.has('rpc')),true);
      await f.page.evaluate(()=>{window.binding.deviceId=window.binding.recipientSessionId;});await f.release('rpc');assert.equal((await f.view()).choose,false);}},
  {name:"consent exact ACK", file:hookFile, from:'readMessagePreviewConsent(result.data, owner, choice) === null', to:'false',
    oracle:async f=>{await ready(f);await f.page.evaluate(()=>{window.badWrite=true;window.choose('sender');});await f.drain();assert.equal((await f.view()).effective,'none');}},
  {name:"final capability choice", file:hookFile, from:'after.choice !== choice', to:'false',
    oracle:async f=>{await ready(f);await f.page.evaluate(()=>{window.capExtra.preview_level='message';window.choose('sender');});await f.drain();assert.equal((await f.view()).saved,'none');}},
  {name:"serialized latest consent", file:hookFile, from:'(writes.get(owner) ?? Promise.resolve()).catch(() => {}).then(run)', to:'Promise.resolve().then(run)',
    oracle:async f=>{await ready(f);await f.page.evaluate(()=>{window.holds.write=true;window.choose('message');});await f.drain();
      assert.equal(await f.page.evaluate(()=>window.gates.has('write')),true);await f.page.evaluate(()=>window.choose('none'));await f.drain();
      assert.equal(await f.page.evaluate(()=>window.calls.filter(x=>x[0]==='write').length),1);await f.release('write');assert.equal(await f.page.evaluate(()=>window.level),'none');}},
  {name:"remount write barrier", file:hookFile, from:'await (writes.get(owner) ?? Promise.resolve());', to:'await Promise.resolve();',
    oracle:async f=>{await ready(f);await f.page.evaluate(()=>{window.holds.write=true;window.choose('sender');});await f.drain();
      assert.equal(await f.page.evaluate(()=>window.gates.has('write')),true);await f.page.evaluate(()=>{window.detach();window.attach();});await f.drain();
      await f.release('write');assert.equal((await f.view()).saved,'sender');}},
  {name:"disposal retirement", file:hookFile, from:'stopped = true; invalidate(); authSubscription.unsubscribe();', to:'authSubscription.unsubscribe();',
    setup:()=>{window.holds.session=true;}, oracle:async f=>{assert.equal(await f.page.evaluate(()=>window.gates.has('session')),true);
      const before=await f.page.evaluate(()=>window.calls.length);await f.page.evaluate(()=>window.detach());await f.release('session');assert.equal(await f.page.evaluate(()=>window.calls.length),before);}},
  {name:"render-owned setter", file:hookFile,
    from:'ownsRender() ? runtime.current?.setChoice(choice) ?? Promise.resolve(false) : Promise.resolve(false)', to:'runtime.current?.setChoice(choice) ?? Promise.resolve(false)',
    oracle:async f=>{await ready(f);await f.page.evaluate(()=>{window.oldChoice=window.preview.setChoice;const owner=window.binding.deviceId;
      window.binding.recipientId=owner;window.session={user:{id:owner},access_token:'fixture.'+btoa(JSON.stringify({
        sub:owner,session_id:window.binding.recipientSessionId,role:'authenticated',is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600}))+'.fixture'};window.account(owner);});
      await f.drain();assert.equal((await f.view()).choose,true);assert.equal(await f.page.evaluate(()=>window.oldChoice('message')),false);}},
];
for (const mutation of mutants) test(`compiled mutant refuses ${mutation.name}`, async()=>{
  const control=await fixture(mutation.setup);try {await mutation.oracle(control);}finally{await control.close();}
  const code=await compile(mutation);const f=await fixture(mutation.setup,code);
  let failure;
  try {await mutation.oracle(f);}catch(error){failure=error;}finally{await f.close();}
  assert.ok(failure instanceof assert.AssertionError,"mutant must fail a behavioral assertion, not setup/compile/network");
});
