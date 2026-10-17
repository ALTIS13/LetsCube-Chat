import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const kub=fileURLToPath(new URL("../../artifacts/kub/",import.meta.url));
const req=createRequire(resolve(kub,"package.json"));
const {transform,build}=createRequire(req.resolve("vite"))("esbuild");
const source=resolve(kub,"src/lib/platform/webMessagePreviews.ts");
async function compiled(){
  if(!existsSync(source))return {};
  const result=await transform(readFileSync(source,"utf8"),{loader:"ts",format:"esm",target:"es2022"});
  return import("data:text/javascript;base64,"+Buffer.from(result.code).toString("base64"));
}
test("browser preview requires an explicit durable lifecycle rather than generic-only browser state",async()=>{
  const api=await compiled();
  assert.equal(typeof api.createWebMessagePreviewClient,"function","EXPLICIT_WEB_PREVIEW_CLIENT_REQUIRED");
  assert.equal(typeof api.createWebPreviewStore,"function","DURABLE_WORKER_CONTEXT_REQUIRED");
});

const U="11111111-1111-4111-8111-000000000001",S="22222222-2222-4222-8222-000000000001",P="33333333-3333-4333-8333-000000000001";
const FP="v1:"+"a".repeat(64);
function row(extra={}){return {preview_v:1,recipient_id:U,session_id:S,subscription_id:P,subscription_fingerprint:FP,revision:0,preview_level:"none",installation_consent:false,observed_at_epoch_ms:10000,expires_at_epoch_ms:null,...extra};}
test("context parser requires exact TABLE10 fields and exact session descriptor",async()=>{
  const api=await compiled(),owner={userId:U,sessionId:S,accountEpoch:1},sub={subscriptionId:P,fingerprint:FP};
  assert.deepEqual(api.readWebPreviewContext([row()],owner,sub),row());
  for(const input of [row(),[],[row(),row()],[{...row(),grant_secret:'forbidden'}],[row({session_id:U})],[row({revision:1.1})],[row({preview_level:'message'})]])assert.equal(api.readWebPreviewContext(input,owner,sub),null);
});

test("browser hook is a real lifecycle consumer, not an unmounted settings declaration",async()=>{
  const path=resolve(kub,'src/hooks/useWebMessagePreview.ts');
  assert.equal(existsSync(path),true,'WEB_PREVIEW_HOOK_REQUIRED');
});

let browser,code;
test.before(async()=>{
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,"0","FICTIONAL_BROWSER_QA0_REQUIRED");
  const compiled=await transform(readFileSync(source,"utf8"),{loader:"ts",format:"iife",globalName:"Preview",target:"es2022"});code=compiled.code;
  browser=await req('@playwright/test').chromium.launch({headless:true});
});
test.after(async()=>{await browser?.close();});
async function fixture(change){
  const context=await browser.newContext(),page=await context.newPage(),errors=[],unknown=[];
  page.setDefaultTimeout(3000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url()==='https://preview.fixture.invalid/'?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fictional preview fixture</title>'}):(unknown.push(route.request().url()),route.abort()));
  let injected=code;
  if(change){let text=readFileSync(source,'utf8');assert.equal(text.split(change[0]).length,2,'one literal compiled mutation');text=text.replace(change[0],change[1]);
    injected=(await transform(text,{loader:'ts',format:'iife',globalName:'Preview',target:'es2022'})).code;}
  await page.goto('https://preview.fixture.invalid/');await page.addScriptTag({content:injected});
  await page.evaluate(({U,S,P,FP})=>{
    window.api=Preview;window.owner={userId:U,sessionId:S,accountEpoch:1};window.visible=true;window.clock=10000;
    window.level='none';window.revision=0;window.calls=[];window.views=[];window.active=false;window.rpcError=false;window.hold=null;window.release=null;window.expiry=60000;
    window.store=Preview.createWebPreviewStore(indexedDB);
    window.contextRow=()=>({preview_v:1,recipient_id:U,session_id:window.owner.sessionId,subscription_id:P,subscription_fingerprint:FP,
      revision:window.revision,preview_level:window.active?window.level:'none',installation_consent:window.active,observed_at_epoch_ms:window.clock,
      expires_at_epoch_ms:window.active?window.clock+window.expiry:null});
    window.ports={owner:()=>window.owner,foreground:()=>window.visible,subscription:async()=>({subscriptionId:P,fingerprint:FP}),store:window.store,crypto,now:()=>window.clock,
      install:async()=>true,
      changed:v=>window.views.push(v),preference:async value=>{window.calls.push({kind:'preference',value});if(value!==undefined){window.level=value;window.active=false;}
        return {data:[{user_id:U,preview_level:window.level}],error:null};},
      rpc:async(name,args)=>{
        window.calls.push({kind:'rpc',name,args});
        if(name==='web_message_preview_enroll'){window.revision++;window.active=true;}
        if(name==='web_message_preview_revoke'){window.revision++;window.active=false;}
        const data=[window.contextRow()];
        if(window.hold===name){window.hold=null;await new Promise(ok=>window.release=ok);}
        return {data,error:window.rpcError?{message:'PRIVATE_RESPONSE_CANARY'}:null};
      }};
    window.preview=Preview.createWebMessagePreviewClient(window.ports);
  },{U,S,P,FP});
  return {page,close:async()=>{await context.close();assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);}};
}

test("real IDB accepts only current pending generation and survives a new storage reader",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      const first=await window.store.begin(window.owner),second=await window.store.begin(window.owner);
      const c={...window.contextRow(),revision:1,preview_level:'sender',installation_consent:true,expires_at_epoch_ms:20000};
      const e={storage_v:1,context:c,grant_secret:'wpg1_'+'b'.repeat(64)};
      const stale=await window.store.activate(first,e,10000,20000,()=>true),live=await window.store.activate(second,e,10000,20000,()=>true);
      const reloaded=await window.api.createWebPreviewStore(indexedDB).read();
      return {stale,live,state:reloaded.state,generation:reloaded.generation,storedSecret:reloaded.envelope.grant_secret===e.grant_secret};
    });
    assert.deepEqual(result,{stale:false,live:true,state:'active',generation:2,storedSecret:true});
  }finally{await f.close();}
});

test("explicit choice sends hash of full secret and activates only exact ACK plus durable readback",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      const accepted=await window.preview.setChoice('message'),stored=await window.store.read();
      const call=window.calls.find(c=>c.name==='web_message_preview_enroll');
      const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stored.envelope.grant_secret))),b=>b.toString(16).padStart(2,'0')).join('');
      return {accepted,view:window.preview.view(),keys:Object.keys(call.args).sort(),hashMatches:actual===call.args.p_grant_hash,
        ttl:call.args.p_ttl_seconds,revision:call.args.p_expected_revision,secretInRpc:JSON.stringify(window.calls).includes(stored.envelope.grant_secret),envelopeKeys:Object.keys(stored.envelope).sort()};
    });
    assert.equal(result.accepted,true);assert.equal(result.view.effectiveChoice,'message');assert.equal(result.view.installed,true);
    assert.deepEqual(result.keys,['p_expected_revision','p_grant_hash','p_preview_level','p_subscription_fingerprint','p_subscription_id','p_ttl_seconds']);
    assert.equal(result.hashMatches,true);assert.equal(result.ttl,2592000);assert.equal(result.revision,0);assert.equal(result.secretInRpc,false);
    assert.deepEqual(result.envelopeKeys,['context','grant_secret','storage_v']);
  }finally{await f.close();}
});

test("held enroll cannot restore grant after immediate local retirement",async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>{window.hold='web_message_preview_enroll';window.pending=window.preview.setChoice('message');});
    await f.page.waitForFunction(()=>!!window.release);
    const result=await f.page.evaluate(async()=>{
      const retiring=window.preview.retire(),immediate=window.preview.view().effectiveChoice;
      await retiring;window.release();const accepted=await window.pending;
      return {immediate,accepted,state:(await window.store.read()).state,view:window.preview.view()};
    });
    assert.equal(result.immediate,'none');assert.equal(result.accepted,false);assert.equal(result.state,'retired');assert.equal(result.view.installed,false);
  }finally{await f.close();}
});

test("unknown enroll ACK stays retired and fresh context never adopts its unacknowledged secret",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      window.rpcError=true;const accepted=await window.preview.setChoice('sender');window.rpcError=false;
      await window.preview.refresh();return {accepted,view:window.preview.view(),state:(await window.store.read()).state,leak:JSON.stringify(window.views).includes('PRIVATE_RESPONSE_CANARY')};
    });
    assert.equal(result.accepted,false);assert.equal(result.view.effectiveChoice,'none');assert.equal(result.state,'retired');assert.equal(result.leak,false);
  }finally{await f.close();}
});

test("same UID new session during held durable readback cannot leave old active admission",async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>{
      const read=window.store.read;let held=false;
      window.store.read=async()=>{const value=await read();if(!held&&value?.state==='active'){held=true;await new Promise(ok=>window.release=ok);}return value;};
      window.pending=window.preview.setChoice('message');
    });
    await f.page.waitForFunction(()=>!!window.release);
    const result=await f.page.evaluate(async()=>{
      window.owner={...window.owner,sessionId:'22222222-2222-4222-8222-000000000002',accountEpoch:2};window.preview.invalidate();window.release();
      const accepted=await window.pending;return {accepted,state:(await window.store.read()).state,effective:window.preview.view().effectiveChoice};
    });
    assert.deepEqual(result,{accepted:false,state:'retired',effective:'none'});
  }finally{await f.close();}
});

test("worker install refusal cannot leave an acknowledged grant locally active",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      window.ports.install=async()=>false;
      const accepted=await window.preview.setChoice('message');
      return {accepted,state:(await window.store.read()).state,effective:window.preview.view().effectiveChoice};
    });
    assert.deepEqual(result,{accepted:false,state:'retired',effective:'none'});
  }finally{await f.close();}
});

test("worker handoff has exact metadata-only protocol and refuses a service role key",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      if(typeof window.api.installWebMessagePreview!=='function')return {missing:true};
      let sent=[];
      const worker={postMessage(message,ports){sent.push(message);ports[0].postMessage({type:'LETSCUBE_WEB_PREVIEW_RESULT',ok:true,
        generation:message.generation,intent_id:message.intent_id,installed:true});}};
      await window.preview.setChoice('sender');const saved=await window.store.read();
      const accepted=await window.api.installWebMessagePreview(worker,saved,saved.envelope,'sb_publishable_fictional',()=>true);
      const secretRole='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({role:'service_role'})).replaceAll('=','')+'.c2ln';
      const denied=await window.api.installWebMessagePreview(worker,saved,saved.envelope,secretRole,()=>true);
      return {accepted,denied,count:sent.length,keys:Object.keys(sent[0]).sort(),secretInMessage:JSON.stringify(sent).includes(saved.envelope.grant_secret)};
    });
    assert.deepEqual(result,{accepted:true,denied:false,count:1,keys:['context','generation','intent_id','public_key','type','v'],secretInMessage:false});
  }finally{await f.close();}
});

test("duplicate authenticated identity keeps consent but same-UID reauthentication retires synchronously",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      window.api.bindWebMessagePreviewRuntime(window.preview);
      window.api.observeWebMessagePreviewIdentity(window.owner);await window.store.read();
      await window.preview.setChoice('message');window.api.observeWebMessagePreviewIdentity({...window.owner});
      const duplicate=window.preview.view().effectiveChoice;
      window.api.observeWebMessagePreviewIdentity({...window.owner,sessionId:'22222222-2222-4222-8222-000000000002'});
      const changed=window.preview.view().effectiveChoice;const saved=await window.store.read();
      return {duplicate,changed,state:saved.state};
    });
    assert.deepEqual(result,{duplicate:'message',changed:'none',state:'retired'});
  }finally{await f.close();}
});

test("None durably retires before a held account writer and keeps the last confirmed radio value",async()=>{
  const f=await fixture();try{
    await f.page.evaluate(async()=>{
      await window.preview.setChoice('message');const write=window.ports.preference;
      window.ports.preference=async choice=>{if(choice==='none')await new Promise(ok=>window.release=ok);return write(choice);};
      window.pending=window.preview.setChoice('none');
    });await f.page.waitForFunction(()=>!!window.release);
    assert.deepEqual(await f.page.evaluate(async()=>({state:(await window.store.read()).state,choice:window.preview.view().savedChoice,effective:window.preview.view().effectiveChoice})),{state:'retired',choice:'message',effective:'none'});
    assert.equal(await f.page.evaluate(async()=>{window.release();return window.pending;}),true);
  }finally{await f.close();}
});

test("failed durable denial emits zero account/enroll requests; elapsed ACK cannot extend request-start TTL",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      const begin=window.store.begin;window.store.begin=async()=>{throw Error('PRIVATE_STORAGE_CANARY');};
      const denied=await window.preview.setChoice('message'),calls=window.calls.length;
      window.store.begin=begin;window.hold='web_message_preview_enroll';window.pending=window.preview.setChoice('message');
      while(!window.release)await new Promise(ok=>setTimeout(ok,0));window.clock+=60001;window.release();
      return {denied,calls,late:await window.pending,state:(await window.store.read()).state};
    });
    assert.deepEqual(result,{denied:false,calls:0,late:false,state:'retired'});
  }finally{await f.close();}
});

test("same descriptor reconciliation preserves consent; replaced keys retire before any remote write",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      if(typeof window.api.retireWebMessagePreviewsForSubscription!=='function')return {missing:true};
      const details={endpoint:'https://push.fixture.invalid/current',keys:{p256dh:'fictional',auth:'fictional'}};
      const sub={endpoint:details.endpoint,toJSON:()=>structuredClone(details)};
      const descriptor=await window.api.webPreviewSubscriptionFingerprint(sub,'33333333-3333-4333-8333-000000000001',window.owner.userId);
      window.ports.subscription=async()=>({subscriptionId:'33333333-3333-4333-8333-000000000001',fingerprint:descriptor});
      const rpc=window.ports.rpc;window.ports.rpc=async(name,args)=>{const r=await rpc(name,args);r.data[0].subscription_fingerprint=descriptor;return r;};
      window.api.bindWebMessagePreviewRuntime(window.preview);await window.preview.setChoice('message');
      const same=await window.api.retireWebMessagePreviewsForSubscription(sub,window.owner.userId,()=>true),kept=(await window.store.read()).state;
      details.keys.auth='replacement';const changed=await window.api.retireWebMessagePreviewsForSubscription(sub,window.owner.userId,()=>true);
      return {same,kept,changed,state:(await window.store.read()).state,effective:window.preview.view().effectiveChoice};
    });
    assert.deepEqual(result,{same:true,kept:'active',changed:true,state:'retired',effective:'none'});
  }finally{await f.close();}
});

test("foreground reconciliation of a missing subscription cannot retain an old active envelope",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      await window.preview.setChoice('sender');window.ports.subscription=async()=>null;await window.preview.refresh();
      return {state:(await window.store.read()).state,effective:window.preview.view().effectiveChoice};
    });assert.deepEqual(result,{state:'retired',effective:'none'});
  }finally{await f.close();}
});

test("retained descriptor read from a retired account cannot erase the new account grant",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      await window.preview.setChoice('message');const global=window.api.webPreviewStore(),read=global.read;let current=true;
      global.read=async()=>{const old=await read();await new Promise(ok=>window.release=ok);return old;};
      const sub={endpoint:'https://push.fixture.invalid/replaced',toJSON:()=>({endpoint:'https://push.fixture.invalid/replaced',keys:{p256dh:'changed',auth:'changed'}})};
      const pending=window.api.retireWebMessagePreviewsForSubscription(sub,window.owner.userId,()=>current);
      while(!window.release)await new Promise(ok=>setTimeout(ok,0));
      const next={userId:'11111111-1111-4111-8111-000000000002',sessionId:'22222222-2222-4222-8222-000000000002',accountEpoch:2};
      const token=await window.store.begin(next),context={...window.contextRow(),recipient_id:next.userId,session_id:next.sessionId,preview_level:'sender',installation_consent:true,expires_at_epoch_ms:20000};
      await window.store.activate(token,{storage_v:1,context,grant_secret:'wpg1_'+'c'.repeat(64)},10000,20000,()=>true);
      current=false;window.release();const accepted=await pending;return {accepted,state:(await window.store.read()).state};
    });assert.deepEqual(result,{accepted:false,state:'active'});
  }finally{await f.close();}
});

function settingsSource(){
  const ts=req('typescript'),text=readFileSync(resolve(kub,'src/components/settings/SettingsScreen.tsx'),'utf8');
  const file=ts.createSourceFile('SettingsScreen.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),parts=[];let fragment;
  function visit(n){
    if(ts.isFunctionDeclaration(n)&&['SettingsRow','RowIcon','DisclosureRow','RowNote'].includes(n.name?.text))parts.push(n.getText(file));
    if(ts.isVariableDeclaration(n)&&['ROW_GRID','MESSAGE_PREVIEW_OPTIONS'].includes(n.name.getText(file)))parts.push('const '+n.name.getText(file)+'='+n.initializer.getText(file)+';');
    if(ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>a.name?.getText(file)==='data-testid'&&a.getText(file).includes('web-message-preview-setting')))fragment=n.getText(file);
    ts.forEachChild(n,visit);
  }visit(file);assert.ok(fragment,'actual Settings mount required');assert.equal(parts.length,6);
  return {helpers:parts.join('\n'),fragment};
}
async function hookFixture(options={}){
  const settings=options.settings?settingsSource():null;
  const bundle=await build({write:false,bundle:true,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':resolve(kub,'src')},define:{'process.env.NODE_ENV':'"development"','import.meta.env.DEV':'false','import.meta.env.BASE_URL':'"/"'},
    plugins:[{name:'fictional-sdk-boundaries',setup(plugin){
      plugin.onLoad({filter:/store[\\/]app\.store\.ts$/},()=>({loader:'ts',contents:`import {create} from 'zustand';
        export const useAppStore=create(()=>({currentUser:{id:'${U}'},accountEpoch:1,authSessionIdentity:{userId:'${U}',sessionId:'${S}'}}));window.ownerStore=useAppStore;`}));
      plugin.onLoad({filter:/lib[\\/]supabase[\\/]client\.ts$/},()=>({loader:'ts',contents:`export const createClient=()=>window.sdk;
        export const isSupabaseConfigured=()=>true;export const getSupabasePublishableKey=()=> 'sb_publishable_fictional';`}));
      plugin.onLoad({filter:/platform[\\/]capabilities\.ts$/},()=>({loader:'ts',contents:`export const isWebBrowser=()=>true;export const supportsBrowserPush=()=>true;`}));
      plugin.onLoad({filter:/media[\\/]mediaUrl\.ts$/},()=>({loader:'ts',contents:`export const signedMediaUrls=()=>({setAccount(){}});`}));
    }}],stdin:{resolveDir:kub,sourcefile:'fictional-preview-hook.tsx',loader:'tsx',contents:`
      import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{useWebMessagePreview}from'./src/hooks/useWebMessagePreview';import{webPreviewStore}from'./src/lib/platform/webMessagePreviews';
      import{useSignOut}from'./src/hooks/useUser';
      import{KubButton,KubIcon}from'./src/components/kub';import{cn}from'./src/lib/utils';
      ${settings?.helpers??''}
      const root=createRoot(document.getElementById('root'));window.readState=()=>webPreviewStore().read();
      function Control(){const v=useWebMessagePreview();window.signOut=useSignOut();window.view=v;window.storage=webPreviewStore();
        const messagePreview=v,webMessagePreview=v,nativeAndroid=false,fieldPrefix='fixture';const [openSections,setOpen]=React.useState(new Set(['message-preview']));
        const toggleSection=id=>setOpen(openSections.size?new Set():new Set([id]));const savedPreviewLabel=${settings?'MESSAGE_PREVIEW_OPTIONS.find(o=>o.value===v.savedChoice)?.label':'null'};
        return ${settings?.fragment??`<fieldset disabled={!v.canChoose}>
        {['none','sender','message'].map(l=><label key={l}><input type="radio" value={l} checked={v.savedChoice===l} onChange={()=>v.setChoice(l)}/>{l}</label>)}
        <output>{v.effectiveChoice}</output></fieldset>`};}
      window.mount=()=>flushSync(()=>root.render(<Control/>));window.unmount=()=>flushSync(()=>root.unmount());`}});
  const context=await browser.newContext({...(options.viewport?{viewport:options.viewport}:{})}),page=await context.newPage(),errors=[],unknown=[];
  page.setDefaultTimeout(3000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url==='https://preview.fixture.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});
    const fonts=['inter-cyrillic.woff2','inter-latin.woff2'];
    const font=fonts.find(name=>url==='https://preview.fixture.invalid/fonts/inter/'+name);
    if(font)return route.fulfill({contentType:'font/woff2',body:readFileSync(resolve(kub,'public/fonts/inter',font))});
    unknown.push(url);return route.abort();
  });
  await page.goto('https://preview.fixture.invalid/');
  if(options.settings){
    await page.addStyleTag({content:readFileSync(resolve(kub,'dist/public/assets/index-C-bcI_MV.css'),'utf8')});
    await page.evaluate(theme=>{document.documentElement.className=theme;document.documentElement.style.colorScheme=theme;
      document.body.style.cssText='margin:0;padding:24px 12px;background:var(--kub-bg);min-height:100vh';
      document.getElementById('root').style.cssText='max-width:480px;margin:0 auto';},options.theme);
  }
  await page.evaluate(({U,S,P})=>{
    window.matchMedia=()=>({matches:true});window.events=[];window.savedLevel=null;window.rev=0;window.granted=false;window.holdWrite=false;window.holdEnroll=false;
    Object.defineProperty(Notification,'permission',{configurable:true,get:()=> 'granted'});
    const endpoint='https://push.fixture.invalid/fictional',p256dh='fictional-key',auth='fictional-auth';
    const sub={endpoint,toJSON:()=>({endpoint,keys:{p256dh,auth}})};
    Object.defineProperty(navigator.serviceWorker,'controller',{configurable:true,value:{postMessage(message,ports){
      window.events.push({kind:'worker',message});if(ports)ports[0].postMessage({type:'LETSCUBE_WEB_PREVIEW_RESULT',ok:true,generation:message.generation,intent_id:message.intent_id,installed:true});}}});
    navigator.serviceWorker.getRegistration=async()=>({pushManager:{getSubscription:async()=>sub}});
    window.sdk={auth:{signOut:async()=>{window.events.push({kind:'signOut'});return {error:null};}},from(name){return {select(columns){return {eq(){if(name==='notification_preview_preferences')return Promise.resolve({data:window.savedLevel?[{user_id:U,preview_level:window.savedLevel}]:[],error:null});
      return {eq(){return {maybeSingle:async()=>({data:{id:P,user_id:U,endpoint,p256dh,auth,is_active:true},error:null})}}};}};},
      upsert(row,options){return {select:async columns=>{window.events.push({kind:'write',row,options,columns});if(window.holdWrite)await new Promise(ok=>window.writeRelease=ok);
        window.savedLevel=row.preview_level;window.granted=false;return {data:[row],error:null};}};}};},
      async rpc(name,args){window.events.push({kind:'rpc',name,args});if(name==='web_message_preview_enroll'){window.rev++;window.granted=true;
        if(window.holdEnroll)await new Promise(ok=>window.enrollRelease=ok);}if(name==='web_message_preview_revoke'){window.rev++;window.granted=false;}
        return {data:[{preview_v:1,recipient_id:U,session_id:window.ownerStore.getState().authSessionIdentity.sessionId,subscription_id:P,
          subscription_fingerprint:args.p_subscription_fingerprint??window.events.findLast(x=>x.name==='web_message_preview_enroll')?.args.p_subscription_fingerprint??window.expectedFingerprint,
          revision:window.rev,preview_level:window.granted?window.savedLevel:'none',installation_consent:window.granted,observed_at_epoch_ms:Date.now(),expires_at_epoch_ms:window.granted?Date.now()+60000:null}],error:window.rpcError?{message:'PRIVATE_ACK_CANARY'}:null};}};
    window.expectedFingerprint='v1:7114edc8ee468f90313584e27cb642bd92c56b41b1251738a27e04bb0d312f8b';
  },{U,S,P});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>window.mount());
  return {page,close:async()=>{await page.evaluate(()=>window.unmount());await context.close();assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);}};
}

test("actual mounted hook reads existing own preference default and enrolls only an explicit confirmed click",async()=>{
  const f=await hookFixture();try{
    await f.page.waitForFunction(()=>window.view.status==='ready');
    assert.deepEqual(await f.page.evaluate(()=>({choice:window.view.savedChoice,installed:window.view.installed,writes:window.events.filter(x=>x.kind==='write').length})),{choice:'none',installed:false,writes:0});
    await f.page.evaluate(()=>{window.holdWrite=true;});await f.page.locator('input[value="message"]').click();
    await f.page.waitForFunction(()=>!!window.writeRelease);
    assert.deepEqual(await f.page.evaluate(()=>({saving:window.view.saving,choice:window.view.savedChoice,disabled:document.querySelector('fieldset').disabled})),{saving:true,choice:'none',disabled:true});
    await f.page.evaluate(()=>{window.writeRelease();});await f.page.waitForFunction(()=>window.view.installed===true);
    const result=await f.page.evaluate(()=>({choice:window.view.savedChoice,write:window.events.find(x=>x.kind==='write'),rpc:window.events.find(x=>x.name==='web_message_preview_enroll').args}));
    assert.equal(result.choice,'message');assert.deepEqual(result.write,{kind:'write',row:{user_id:U,preview_level:'message'},options:{onConflict:'user_id'},columns:'user_id,preview_level'});
    assert.equal(result.rpc.p_subscription_fingerprint,'v1:7114edc8ee468f90313584e27cb642bd92c56b41b1251738a27e04bb0d312f8b');
  }finally{await f.close();}
});

test("actual mounted hook refuses late enroll after same-UID fresh session ownership",async()=>{
  const f=await hookFixture();try{
    await f.page.waitForFunction(()=>window.view.status==='ready');await f.page.evaluate(()=>{window.holdEnroll=true;});
    await f.page.locator('input[value="sender"]').click();await f.page.waitForFunction(()=>!!window.enrollRelease);
    await f.page.evaluate(()=>{window.ownerStore.setState({accountEpoch:2,authSessionIdentity:{...window.ownerStore.getState().authSessionIdentity,sessionId:'22222222-2222-4222-8222-000000000002'}});window.enrollRelease();});
    await f.page.waitForFunction(async()=> (await window.readState())?.state==='retired');
    assert.equal(await f.page.evaluate(()=>window.view.effectiveChoice),'none');
  }finally{await f.close();}
});

test("actual useSignOut waits durable local retirement before the first Auth request",async()=>{
  const f=await hookFixture();try{
    await f.page.waitForFunction(()=>window.view.status==='ready');await f.page.locator('input[value="sender"]').click();
    await f.page.waitForFunction(()=>window.view.installed);
    await f.page.evaluate(()=>{const retire=window.storage.retire;window.storage.retire=async()=>{await new Promise(ok=>window.retireRelease=ok);return retire();};window.logout=window.signOut();});
    assert.equal(await f.page.evaluate(()=>window.events.filter(x=>x.kind==='signOut').length),0);
    assert.equal(await f.page.evaluate(()=>window.view.effectiveChoice),'none');
    const after=await f.page.evaluate(async()=>{window.retireRelease();await window.logout;return {count:window.events.filter(x=>x.kind==='signOut').length,state:(await window.readState()).state};});
    assert.deepEqual(after,{count:1,state:'retired'});
  }finally{await f.close();}
});

async function pushCallback(name, change){
  const ts=req('typescript'),path=resolve(kub,'src/hooks/usePush.ts');let text=readFileSync(path,'utf8');
  if(change){assert.equal(text.split(change[0]).length,2);text=text.replace(change[0],change[1]);}
  const file=ts.createSourceFile('usePush.ts',text,ts.ScriptTarget.Latest,true);let fn;
  function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)fn=n.initializer.arguments[0].getText(file);ts.forEachChild(n,visit);}visit(file);
  assert.ok(fn);return (await transform('window.callback='+fn,{loader:'ts',target:'es2022'})).code;
}
test("actual browser enable keeps transient gesture while awaiting durable retirement before remote upsert",async()=>{
  const f=await fixture();try{
    await f.page.evaluate(async()=>{await window.preview.setChoice('message');window.api.bindWebMessagePreviewRuntime(window.preview);
      const store=window.api.webPreviewStore(),retire=store.retire;store.retire=async()=>{await new Promise(ok=>window.retireRelease=ok);return retire();};
      Object.assign(window,{owner:{...window.owner,userId:window.owner.userId,loaded:true,operation:0},userId:window.owner.userId,browserUnsubscribes:0,browserProviderRevision:0,
        isCurrentOwner:()=>true,isNativeApp:()=>false,isNativeAndroid:()=>false,VAPID_PUBLIC:'AQID',browserReconciled:true,events:[],
        PUSH_STATE_CHANGED_EVENT:'kub:push-state-changed',currentNotificationPermission:()=>Notification.permission,mapPgError:()=> 'fixture error',
        setStatus(){},setMessage(){},getPlatform:()=> 'fictional',urlBase64ToUint8Array:()=>new Uint8Array([1,2,3]),
        retireWebMessagePreviews:window.api.retireWebMessagePreviews,savePreferences:async()=> 'saved',
        browserSubscriptionRecord:()=>({user_id:window.owner.userId}),supabase:{from(){return {upsert:async()=>{window.events.push('upsert');return {error:null};}};}}
      });
      Object.defineProperty(Notification,'permission',{configurable:true,get:()=> 'granted'});
      window.browserRegistrationRef={current:{}};window.subscribeDuringUserGesture=()=>{window.events.push('subscribe');return Promise.resolve({});};
    });await f.page.addScriptTag({content:await pushCallback('enable')});
    const immediate=await f.page.evaluate(()=>{window.operation=window.callback();window.events.push('after-click');return window.events;});
    assert.deepEqual(immediate,['subscribe','after-click']);
    assert.equal(await f.page.evaluate(()=>window.preview.view().effectiveChoice),'none');
    await f.page.evaluate(async()=>{window.retireRelease();await window.operation;});
    assert.deepEqual(await f.page.evaluate(()=>window.events),['subscribe','after-click','upsert']);
  }finally{await f.close();}
});

async function actualWorkerFixture(change){
  const ts=req('typescript'),url=new URL('web-message-preview-worker.test.mjs',import.meta.url);
  const text=readFileSync(url,'utf8'),file=ts.createSourceFile('worker-fixture.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  // Reuse the worker owner's actual VM/event/IDB boundary model, without
  // registering or replaying his unchanged suites. sw.js/client remain actual.
  let declarations=file.statements.filter(n=>ts.isImportDeclaration(n)||ts.isVariableStatement(n)||ts.isFunctionDeclaration(n)).map(n=>n.getText(file)).join('\n');
  if(change){const original=readFileSync(source,'utf8');assert.equal(original.split(change[0]).length,2);
    assert.equal(declarations.split('transformSync(clientSource,').length,2);
    declarations=declarations.replace('transformSync(clientSource,','transformSync('+JSON.stringify(original.replace(change[0],change[1]))+',');}
  const code=declarations.replaceAll('import.meta.url',JSON.stringify(url.href))+'\nexport {worker,install,content,ctx,deferred,generic,localOwner,now};';
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
test("actual client None/replacement synchronously retires the actual worker before a held IDB open",async()=>{
  const api=await actualWorkerFixture();
  for(const level of ['none','sender']){
    const w=api.worker();await api.install(w);
    const response=api.deferred(),started=api.deferred(),opening=api.deferred(),openStarted=api.deferred();
    w.fetch=async()=>{started.resolve();return response.promise;};const push=w.push();await started.promise;
    let once=true;w.db.holdOpen=()=>{if(once){once=false;openStarted.resolve();return opening.promise;}};
    const store=w.client.createWebPreviewStore(w.db.indexedDB,()=> '70000000-0000-4000-8000-000000000099');
    const client=w.client.createWebMessagePreviewClient({owner:()=>api.localOwner,foreground:()=>true,store,now:()=>api.now,crypto:{},
      retireHint:()=>{void w.message({type:'LETSCUBE_WEB_PREVIEW_RETIRE',v:1});},subscription:async()=>null,
      rpc:async()=>assert.fail('NO_RPC_BEFORE_DURABLE_DENIAL'),preference:async()=>assert.fail('NO_PREFERENCE_BEFORE_DURABLE_DENIAL'),install:async()=>false});
    const choice=client.setChoice(level);await openStarted.promise;
    response.resolve(new Response(JSON.stringify([api.content()])));await push;
    try{assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,'LETSCUBE');assert.equal(w.shown[0].options.body,'Новое уведомление');}
    finally{opening.resolve();assert.equal(await choice,false);}
  }
});

test("failed None storage intent cannot silently reinstall the older grant on refresh",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      await window.preview.setChoice('message');const retire=window.store.retire;window.store.retire=async()=>{throw Error('FICTIONAL_STORAGE_DENIED');};
      const accepted=await window.preview.setChoice('none');window.store.retire=retire;await window.preview.refresh();
      return {accepted,installed:window.preview.view().installed,state:(await window.store.read()).state};
    });assert.deepEqual(result,{accepted:false,installed:false,state:'retired'});
  }finally{await f.close();}
});

test("failed explicit logout retirement remains locally denied after an ordinary refresh",async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{
      window.api.bindWebMessagePreviewRuntime(window.preview);await window.preview.setChoice('message');
      const global=window.api.webPreviewStore();global.retire=async()=>{throw Error('FICTIONAL_STORAGE_DENIED');};
      const accepted=await window.api.retireWebMessagePreviews();await window.preview.refresh();
      return {accepted,installed:window.preview.view().installed,state:(await window.store.read()).state};
    });assert.deepEqual(result,{accepted:false,installed:false,state:'retired'});
  }finally{await f.close();}
});

test("compiled synchronous RETIRE omission exposes a rich push during the real client IDB wait",async()=>{
  const api=await actualWorkerFixture(['const retirementHint = () => { try { (ports.retireHint ?? hintWebMessagePreviewRetirement)(); } catch { /* Durable denial is still required. */ } };','const retirementHint = () => {};']);
  const w=api.worker();await api.install(w);const response=api.deferred(),started=api.deferred(),opening=api.deferred(),openStarted=api.deferred();
  w.fetch=async()=>{started.resolve();return response.promise;};const push=w.push();await started.promise;
  let once=true;w.db.holdOpen=()=>{if(once){once=false;openStarted.resolve();return opening.promise;}};
  const store=w.client.createWebPreviewStore(w.db.indexedDB,()=> '70000000-0000-4000-8000-000000000099');
  const client=w.client.createWebMessagePreviewClient({owner:()=>api.localOwner,foreground:()=>true,store,now:()=>api.now,crypto:{},
    retireHint:()=>{void w.message({type:'LETSCUBE_WEB_PREVIEW_RETIRE',v:1});},subscription:async()=>null,rpc:async()=>assert.fail(),preference:async()=>assert.fail(),install:async()=>false});
  const choice=client.setChoice('none');await openStarted.promise;response.resolve(new Response(JSON.stringify([api.content()])));await push;
  try{assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,'QA Sender');assert.throws(()=>assert.equal(w.shown[0].title,'LETSCUBE'),assert.AssertionError);}
  finally{opening.resolve();await choice;}
});

for(const control of [
  {name:'pending token CAS',change:['a.generation === b.generation && a.intent_id === b.intent_id && ', ''],expected:false,
    run:()=>window.store.begin(window.owner).then(async old=>{await window.store.begin(window.owner);return window.store.activate(old,{storage_v:1,context:{...window.contextRow(),revision:1,preview_level:'sender',installation_consent:true,expires_at_epoch_ms:20000},grant_secret:'wpg1_'+'b'.repeat(64)},10000,20000,()=>true);})},
  {name:'worker ACK cannot be omitted',change:['if (!await ports.install(token, value, own) || !own()) throw new Error();','if (!own()) throw new Error();'],expected:false,
    run:async()=>{window.ports.install=async()=>false;return window.preview.setChoice('message');}},
  {name:'TTL is literal30days',change:['p_ttl_seconds: 2592000','p_ttl_seconds: 2592001'],expected:2592000,
    run:async()=>{await window.preview.setChoice('message');return window.calls.find(x=>x.name==='web_message_preview_enroll').args.p_ttl_seconds;}},
  {name:'hash covers the complete canonical secret',change:['new TextEncoder().encode(secret)','new TextEncoder().encode(secret.slice(5))'],expected:true,
    run:async()=>{await window.preview.setChoice('message');const s=await window.store.read();const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s.envelope.grant_secret))),b=>b.toString(16).padStart(2,'0')).join('');return window.calls.find(x=>x.name==='web_message_preview_enroll').args.p_grant_hash===expected;}},
  {name:'session parsing is exact',change:['v.session_id !== owner.sessionId','false'],expected:null,
    run:()=>window.api.readWebPreviewContext([{...window.contextRow(),session_id:'22222222-2222-4222-8222-000000000002'}],window.owner,{subscriptionId:'33333333-3333-4333-8333-000000000001',fingerprint:'v1:'+'a'.repeat(64)})},
])test('compiled literal omission exposes '+control.name,async()=>{
  const positive=await fixture();try{assert.deepEqual(await positive.page.evaluate(control.run),control.expected);}finally{await positive.close();}
  const mutant=await fixture(control.change);try{const actual=await mutant.page.evaluate(control.run);assert.throws(()=>assert.deepEqual(actual,control.expected),assert.AssertionError);}finally{await mutant.close();}
});

test("exact Settings JSX with actual hook fits1440/390 both themes and retains keyboard/confirmed radios",async()=>{
  const folder=resolve(tmpdir(),'letscube-web-preview-20261017');mkdirSync(folder,{recursive:true});
  for(const width of [1440,390])for(const theme of ['light','dark']){
    const f=await hookFixture({settings:true,viewport:{width,height:900},theme});try{
      await f.page.waitForFunction(()=>window.view.status==='ready');
      await f.page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getElementById('settings-panel-message-preview').getAnimations({subtree:true})
        .filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
      assert.equal(await f.page.locator('input[type=radio]').count(),3);
      const geometry=await f.page.locator('fieldset label').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,right:n.getBoundingClientRect().right})));
      assert.equal(geometry.every(n=>n.height>=44&&n.right<=width),true,JSON.stringify({width,theme,geometry}));
      assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await f.page.screenshot({path:resolve(folder,`${width}-${theme}-none.png`)});
      await f.page.locator('input[value=none]').focus();await f.page.keyboard.press('ArrowDown');
      await f.page.waitForFunction(()=>window.view.installed&&window.view.savedChoice==='sender');
      await f.page.evaluate(()=>{window.holdWrite=true;});await f.page.locator('input[value=message]').click();
      await f.page.waitForFunction(()=>!!window.writeRelease);
      assert.equal(await f.page.locator('input[value=sender]').isChecked(),true);
      assert.equal(await f.page.locator('fieldset').evaluate(n=>n.disabled),true);
      assert.equal(await f.page.locator('input[value=message]').isDisabled(),true);
      await f.page.screenshot({path:resolve(folder,`${width}-${theme}-pending.png`)});
      await f.page.evaluate(()=>{window.holdWrite=false;window.writeRelease();});await f.page.waitForFunction(()=>window.view.installed&&window.view.savedChoice==='message');
      await f.page.screenshot({path:resolve(folder,`${width}-${theme}-message.png`)});
      await f.page.evaluate(()=>{window.rpcError=true;});await f.page.locator('input[value=none]').click();
      await f.page.waitForFunction(()=>window.view.status==='error');
      assert.equal(await f.page.getByRole('button',{name:'Повторить',exact:true}).isVisible(),true);
      assert.equal((await f.page.locator('body').innerText()).includes('PRIVATE_ACK_CANARY'),false);
      await f.page.screenshot({path:resolve(folder,`${width}-${theme}-error.png`)});
    }finally{await f.close();}
  }
});
