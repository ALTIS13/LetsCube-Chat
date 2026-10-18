import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = requireKub("@playwright/test");
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const src = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const L = "20000000-0000-4000-8000-000000000001";
const original = readFileSync(new URL("../../artifacts/kub/src/components/layout/BottomNav.tsx", import.meta.url), "utf8");
let browser, bundle;

async function compile(change) {
  const result = await build({write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",
    alias:{"@":src},define:{"process.env.NODE_ENV":'"development"',"import.meta.env":JSON.stringify({DEV:false,VITE_ACCESS_SNAPSHOT_RPC_ENABLED:"0"})},
    plugins:[{name:"read-only-navigation-leaves",setup(plugin){
      plugin.onLoad({filter:/store[\\/]app\.store\.ts$/},()=>({loader:"ts",contents:`
        import {create} from 'zustand';
        export const useAppStore=create(set=>({currentUser:{id:'${A}',role:'client'},accountEpoch:1,mobileSection:'chats',
          setMobileSection:id=>{window.commands.push({section:id});set({mobileSection:id});}}));
        window.store=useAppStore;
      `}));
      plugin.onLoad({filter:/lib[\\/]supabase[\\/]client\.ts$/},()=>({loader:"ts",contents:`
        const client={rpc(name,args){return new Promise(resolve=>window.requests.push({kind:'rpc',name,args,resolve,done:false}));},
          from(table){const filters={};const q={select(){return q;},order(){return q;},eq(k,v){filters[k]=v;return q;},
            then(ok,bad){return new Promise(resolve=>window.requests.push({kind:'table',table,filters,resolve,done:false})).then(ok,bad);}};return q;},
          channel(){const c={on(){return c;},subscribe(){return c;},unsubscribe(){return Promise.resolve();}};return c;},removeChannel(){return Promise.resolve();}};
        export const createClient=()=>client;export const getRealtimeClient=()=>client;
      `}));
      plugin.onLoad({filter:/components[\\/]kub[\\/]index\.ts$/},()=>({loader:"ts",contents:`
        export {KubIcon} from './KubIcon';export {KubStableSkeleton} from './KubStableSkeleton';
      `}));
      plugin.onResolve({filter:/^wouter$/},()=>({path:"router",namespace:"nav-fixture"}));
      plugin.onLoad({filter:/.*/,namespace:"nav-fixture"},()=>({loader:"js",contents:`
        export const useLocation=()=>[window.route??'/',path=>{window.route=path;window.commands.push({route:path});}];
      `}));
      plugin.onLoad({filter:/BottomNav\.tsx$/},args=>{
        if(!change)return;
        let text=readFileSync(args.path,"utf8");assert.equal(text.split(change[0]).length-1,1,"one literal omission");
        return {loader:"tsx",contents:text.replace(change[0],change[1]),resolveDir:fileURLToPath(new URL("../../artifacts/kub/src/components/layout/",import.meta.url))};
      });
    }}],stdin:{resolveDir:src,sourcefile:"bottom-nav-access-fixture.tsx",loader:"tsx",contents:`
      import React,{Profiler} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {BottomNav} from './components/layout/BottomNav';
      window.requests=[];window.commands=[];window.frames=[];window.phase='initial';let callback=false;
      const root=createRoot(document.getElementById('root'));
      const committed=()=>window.frames.push({owner:window.store.getState().currentUser?.id,phase:window.phase,
        labels:[...document.querySelectorAll('nav button')].map(n=>n.getAttribute('aria-label'))});
      window.render=options=>{callback=options?.callback??callback;flushSync(()=>root.render(<Profiler id="nav" onRender={committed}>
        <BottomNav onSelect={callback?entry=>window.commands.push({callback:entry.id}):undefined}/></Profiler>));};
      window.owner=(id,epoch)=>{window.phase='owner-pending';flushSync(()=>window.store.setState({currentUser:{id,role:'client'},accountEpoch:epoch}));};
      window.detach=()=>flushSync(()=>root.unmount());
    `}});
  return result.outputFiles[0].text;
}

test.before(async()=>{bundle=await compile();browser=await chromium.launch({headless:true,env:{...process.env,KUB_QA_ALLOW_MUTATIONS:"0"}});});
test.after(async()=>{await browser?.close();assert.equal(readFileSync(new URL("../../artifacts/kub/src/components/layout/BottomNav.tsx",import.meta.url),"utf8"),original);});
async function mount(t,code=bundle,options={}) {
  const context=await browser.newContext({serviceWorkers:"block",viewport:{width:390,height:960}}),page=await context.newPage(),network=[],errors=[];
  page.setDefaultTimeout(3000);page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",r=>{network.push(r.request().url());return r.abort();});
  await page.setContent('<main id="app"><div id="root"></div><button id="outside">Outside</button></main>');
  await page.addScriptTag({content:code});await page.evaluate(options=>window.render(options),options);
  t.after(async()=>{await page.evaluate(()=>window.detach());await context.close();assert.deepEqual(network,[]);assert.deepEqual(errors,[]);});
  return {page,
    async globalAnswer(allowed=false){await page.waitForFunction(()=>window.requests.some(r=>r.kind==='rpc'&&!r.done));
      await page.evaluate(allowed=>{window.phase='routing-pending';for(const r of window.requests)if(r.kind==='rpc'&&!r.done){r.done=true;r.resolve({data:allowed,error:null});}},allowed);},
    async routes(uid=A,membership=true){await page.waitForFunction(()=>window.requests.some(r=>r.kind==='table'&&!r.done));
      await page.evaluate(({uid,membership,L})=>{window.phase='location-pending';for(const r of window.requests)if(r.kind==='table'&&!r.done){r.done=true;
        r.resolve({data:r.table==='locations'?[{id:L,name:'Synthetic',is_active:true}]:membership?[{id:'synthetic-member',user_id:uid,location_id:L}]:[],error:null});}}, {uid,membership,L});},
    async locationAllowed(){await page.waitForFunction(()=>window.requests.some(r=>r.name==='has_location_permission'&&!r.done));
      await page.evaluate(()=>{window.phase='ready';for(const r of window.requests)if(r.name==='has_location_permission'&&!r.done){r.done=true;r.resolve({data:true,error:null});}});},
    labels:()=>page.locator('nav button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),
  };
}

test("actual navbar has no interactive destinations while account access is unresolved",async t=>{
  const f=await mount(t);
  assert.deepEqual(await f.labels(),[],"pending three-tab navbar exposes the old Profile hitbox");
  assert.equal(await f.page.locator('nav').getAttribute('aria-busy'),"true");
  assert.equal(await f.page.locator('nav [role="status"]').count(),1);
  assert.equal(await f.page.locator('#outside').isEnabled(),true,"only navbar waits, not the application");
  await f.globalAnswer();assert.deepEqual(await f.labels(),[]);
  await f.routes();await f.locationAllowed();
  await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
  assert.deepEqual(await f.labels(),["Чаты","Контакты","Профиль","Задачи"]);
});

test("location permission activation has no one-commit interactive false-denial navbar",async t=>{
  const f=await mount(t);await f.globalAnswer();await f.routes();
  await f.page.waitForFunction(()=>window.requests.some(r=>r.name==='has_location_permission'));
  const frames=await f.page.evaluate(()=>window.frames.filter(f=>f.phase==='location-pending'));
  assert.ok(frames.length>0);assert.ok(frames.every(f=>f.labels.length===0),JSON.stringify(frames));
  await f.locationAllowed();await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
});

test("account change cannot expose previous account destinations even before access effects run",async t=>{
  const f=await mount(t);await f.globalAnswer(true);await f.routes(A,false);
  await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
  await f.page.evaluate(B=>window.owner(B,2),B);
  const first=await f.page.evaluate(B=>window.frames.filter(f=>f.owner===B),B);
  assert.ok(first.length>0);assert.ok(first.every(f=>f.labels.length===0),JSON.stringify(first));
  await f.globalAnswer();await f.routes(B,false);
  await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===3);
  assert.deepEqual(await f.labels(),["Чаты","Контакты","Профиль"]);
  assert.equal(await f.page.locator('nav').getAttribute('aria-busy'),"false");
});

test("same-account epoch change also waits for its own access lifetime",async t=>{
  const f=await mount(t);await f.globalAnswer();await f.routes();await f.locationAllowed();
  await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
  await f.page.evaluate(A=>window.owner(A,2),A);
  const frames=await f.page.evaluate(()=>window.frames.filter(f=>f.phase==='owner-pending'));
  assert.ok(frames.length>0);assert.ok(frames.every(f=>f.labels.length===0),JSON.stringify(frames));
  await f.routes();await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
});

test("resolved profile/settings callback and normal task routing preserve accepted destinations",async t=>{
  const f=await mount(t,bundle,{callback:true});await f.globalAnswer();await f.routes();await f.locationAllowed();
  await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
  await f.page.getByRole('button',{name:'Профиль',exact:true}).click();
  assert.deepEqual(await f.page.evaluate(()=>window.commands),[{callback:'profile'}]);
  await f.page.evaluate(()=>window.render({callback:false}));
  await f.page.getByRole('button',{name:'Профиль',exact:true}).click();
  await f.page.getByRole('button',{name:'Задачи',exact:true}).click();
  assert.deepEqual(await f.page.evaluate(()=>window.commands),[{callback:'profile'},{section:'profile'},{route:'/tasks'}]);
});

test("literal omission of the loading rule restores interactive pending destinations",async t=>{
  const code=await compile(['const loading = checking || settledAccess !== accessKey;','const loading = false;']);
  const f=await mount(t,code);
  assert.deepEqual(await f.labels(),["Чаты","Контакты","Профиль"]);
  assert.equal(await f.page.locator('nav').getAttribute('aria-busy'),"false");
});

test("checking alone misses the actual routing-to-location permission commit",async t=>{
  const code=await compile(['const loading = checking || settledAccess !== accessKey;','const loading = checking;']);
  const f=await mount(t,code);await f.globalAnswer();await f.routes();
  await f.page.waitForFunction(()=>window.requests.some(r=>r.name==='has_location_permission'));
  const frames=await f.page.evaluate(()=>window.frames.filter(f=>f.phase==='location-pending'));
  assert.ok(frames.some(f=>JSON.stringify(f.labels)===JSON.stringify(["Чаты","Контакты","Профиль"])),JSON.stringify(frames));
});

test("omitting account ownership exposes the prior account's four destinations in a committed frame",async t=>{
  const code=await compile(['key={`${userId ?? "guest"}:${accountEpoch}`}','key="unowned"']);
  const f=await mount(t,code);await f.globalAnswer(true);await f.routes(A,false);
  await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
  await f.page.evaluate(B=>window.owner(B,2),B);
  const frames=await f.page.evaluate(B=>window.frames.filter(f=>f.owner===B),B);
  assert.ok(frames.some(f=>JSON.stringify(f.labels)===JSON.stringify(["Чаты","Контакты","Профиль","Задачи"])),JSON.stringify(frames));
});

test("omitting the epoch key reuses stale settled access in the same account",async t=>{
  const code=await compile(['key={`${userId ?? "guest"}:${accountEpoch}`}','key={userId ?? "guest"}']);
  const f=await mount(t,code);await f.globalAnswer();await f.routes();await f.locationAllowed();
  await f.page.waitForFunction(()=>document.querySelectorAll('nav button').length===4);
  await f.page.evaluate(A=>window.owner(A,2),A);
  const frames=await f.page.evaluate(()=>window.frames.filter(f=>f.phase==='owner-pending'));
  assert.ok(frames.some(f=>f.labels.length===4),JSON.stringify(frames));
});
