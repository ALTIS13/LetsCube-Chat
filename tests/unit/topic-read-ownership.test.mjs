import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';

const kub=fileURLToPath(new URL('../../artifacts/kub/',import.meta.url));
const require=createRequire(resolve(kub,'package.json'));
const {build}=createRequire(require.resolve('vite'))('esbuild');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const C='30000000-0000-4000-8000-000000000001',D='30000000-0000-4000-8000-000000000002';
const row=(name,archived=false)=>({id:'40000000-0000-4000-8000-000000000001',chat_id:C,name,is_general:false,archived});
let browser,code;
async function compile(change){
  const result=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':resolve(kub,'src')},
    define:{'process.env.NODE_ENV':'"development"','import.meta.env.DEV':'false'},
    plugins:[{name:'owned-topic-read-ports',setup(p){
      if(change)p.onLoad({filter:/hooks[\\/]useTopics\.ts$/},()=>{
        const source=readFileSync(resolve(kub,'src/hooks/useTopics.ts'),'utf8');assert.equal(source.split(change[0]).length,2);
        return{loader:'ts',contents:source.replace(change[0],change[1]),resolveDir:resolve(kub,'src/hooks')};
      });
      p.onLoad({filter:/store[\\/]app\.store\.ts$/},()=>({loader:'ts',contents:`import{create}from'zustand';export const useAppStore=create(set=>({currentUser:{id:'${A}'},accountEpoch:1,selectedTopicId:null,setSelectedTopicId(value){set({selectedTopicId:value})}}));window.store=useAppStore;`}));
      p.onLoad({filter:/lib[\\/]supabase[\\/]client\.ts$/},()=>({loader:'ts',contents:`
        const rt={channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){return Promise.resolve()}};
        export const getRealtimeClient=()=>rt;
        export const createClient=()=>({from(){let resolve;const promise=new Promise(r=>resolve=r),request={resolve};window.requests.push(request);
          const q={select(){return q},eq(_k,v){request.chatId=v;return q},order(){return q},then:promise.then.bind(promise)};return q}});`}));
      p.onLoad({filter:/lib[\\/]dev[\\/]instrumentation\.ts$/},()=>({loader:'ts',contents:'export const bumpFetch=()=>{};export const registerChannel=()=>{};export const unregisterChannel=()=>{};'}));
    }}],stdin:{resolveDir:kub,loader:'tsx',contents:`
      import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{useTopics}from'./src/hooks/useTopics';import{useAppStore}from'@/store/app.store';
      window.requests=[];let chatId='${C}',root=createRoot(document.getElementById('root'));
      function App(){useAppStore(s=>s.currentUser?.id);useAppStore(s=>s.accountEpoch);const v=useTopics(chatId,true);window.view=v;return null;}
      window.render=id=>{chatId=id;flushSync(()=>root.render(<App/>));};
      window.owner=(uid,epoch)=>flushSync(()=>useAppStore.setState({currentUser:{id:uid},accountEpoch:epoch}));
      window.select=id=>flushSync(()=>useAppStore.setState({selectedTopicId:id}));
      window.stop=()=>flushSync(()=>root.unmount());window.restart=()=>{root=createRoot(document.getElementById('root'));window.render(chatId);};
      window.render(chatId);`}});
  return result.outputFiles[0].text;
}
test.before(async()=>{
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,'0','FICTIONAL_QA0_REQUIRED');
  code=await compile();browser=await require('@playwright/test').chromium.launch({headless:true});
});
test.after(async()=>{await browser?.close();});
async function fixture(t,script=code){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],network=[];
  page.setDefaultTimeout(1800);
  await page.route('**/*',r=>{network.push('UNKNOWN_REQUEST');return r.abort();});page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><div id="root"></div>');await page.addScriptTag({content:script});
  const count=n=>page.waitForFunction(n=>window.requests.length===n,n);
  await count(1);
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
  return{page,count,async answer(index,rows,error=null){await page.evaluate(({index,rows,error})=>window.requests[index].resolve({data:rows,error}),{index,rows,error});await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));},
    read:()=>page.evaluate(()=>({known:window.view.scopeKnown,names:window.view.topics.map(t=>t.name),snapshot:window.view.snapshot??null}))};
}

test('same UID reauthentication never relabels a prior snapshot with the new epoch',async t=>{
  const f=await fixture(t);await f.answer(0,[row('prior')]);assert.equal((await f.read()).known,true);
  await f.page.evaluate(A=>window.owner(A,2),A);
  assert.equal((await f.read()).known,false);assert.equal((await f.read()).snapshot,null);
  await f.count(2);
  await f.answer(1,[row('current')]);const v=await f.read();assert.deepEqual(v.names,['current']);assert.equal(v.snapshot.accountEpoch,2);
});
test('a late A response cannot populate B state or its warm cache',async t=>{
  const f=await fixture(t);await f.page.evaluate(B=>window.owner(B,2),B);await f.count(2);
  await f.answer(1,[row('B current')]);await f.answer(0,[row('A stale')]);assert.deepEqual((await f.read()).names,['B current']);
  await f.page.evaluate(()=>{window.stop();window.restart();});await f.count(3);
  const v=await f.read();assert.equal(v.known,true);assert.deepEqual(v.names,['B current']);assert.equal(v.snapshot.userId,B);
});
test('overlapping reads publish only the latest completed request generation',async t=>{
  const f=await fixture(t);await f.page.evaluate(()=>{void window.view.refetch();});await f.count(2);
  await f.answer(1,[row('newer')]);await f.answer(0,[row('older')]);assert.deepEqual((await f.read()).names,['newer']);
});
test('same-owner warm reopen preserves known scope without borrowing from another chat',async t=>{
  const f=await fixture(t);await f.answer(0,[row('warm')]);await f.page.evaluate(D=>window.render(D),D);await f.count(2);
  assert.equal((await f.read()).known,false);await f.page.evaluate(C=>window.render(C),C);await f.count(3);
  assert.equal((await f.read()).known,true);assert.deepEqual((await f.read()).names,['warm']);
  await f.answer(1,[{...row('other chat'),chat_id:D}]);assert.deepEqual((await f.read()).names,['warm']);
});
test('unmounted requests cannot seed a later mount cache',async t=>{
  const f=await fixture(t);await f.page.evaluate(()=>window.stop());await f.answer(0,[row('retired')]);
  await f.page.evaluate(()=>window.restart());await f.count(2);assert.equal((await f.read()).known,false);
});
test('owned raw snapshot keeps archived rows while the visible channel list filters them',async t=>{
  const f=await fixture(t);await f.answer(0,[row('archived',true)]);const v=await f.read();
  assert.deepEqual(v.names,[]);assert.equal(v.snapshot.userId,A);assert.equal(v.snapshot.accountEpoch,1);
  assert.equal(v.snapshot.chatId,C);assert.equal(v.snapshot.topics[0].archived,true);
});

test('unknown scope does not reset the selected topic before an owned read answers',async t=>{
  const f=await fixture(t),topic=row('selected').id;
  await f.page.evaluate(topic=>window.select(topic),topic);await f.page.evaluate(()=>new Promise(r=>setTimeout(r,0)));
  assert.equal(await f.page.evaluate(()=>window.store.getState().selectedTopicId),topic);
  await f.answer(0,[]);await f.page.waitForFunction(()=>window.store.getState().selectedTopicId===null);
});
test('a retained refetch for a departed chat cannot retire the new current request',async t=>{
  const f=await fixture(t);await f.page.evaluate(D=>{window.oldRefetch=window.view.refetch;window.render(D);},D);await f.count(2);
  await f.page.evaluate(()=>window.oldRefetch());assert.equal(await f.page.evaluate(()=>window.requests.length),2);
  await f.answer(1,[{...row('current chat'),chat_id:D}]);assert.equal((await f.read()).known,true);
});
test('owned read refusal preserves visible rows but retires snapshot and warm trust',async t=>{
  const f=await fixture(t);await f.answer(0,[row('retained')]);
  await f.page.evaluate(()=>{void window.view.refetch({background:true});});await f.count(2);
  await f.answer(1,null,{code:'42501',message:'FICTIONAL_REFUSAL'});const v=await f.read();
  assert.deepEqual(v.names,['retained']);assert.equal(v.known,false);assert.equal(v.snapshot,null);
  assert.equal(await f.page.evaluate(()=>Boolean(window.view.error)),true);
  await f.page.evaluate(()=>{window.stop();window.restart();});await f.count(3);assert.equal((await f.read()).known,false);
});

for(const control of [
  {name:'epoch cache key',change:['return `${userId ?? ""}:${accountEpoch}:${chatId}`;','return `${userId ?? ""}:${chatId}`;'],kind:'epoch'},
  {name:'post-await retirement',change:['    if (!current()) return;\n    if (error) {','    if (error) {'],kind:'unmount'},
  {name:'request generation',change:['request === generation.current','true'],kind:'generation'},
])test(`actual loaded omission is killed for ${control.name}`,async t=>{
  async function observe(script){
    const f=await fixture(t,script);
    if(control.kind==='epoch'){await f.answer(0,[row('prior')]);await f.page.evaluate(A=>window.owner(A,2),A);return(await f.read()).known;}
    if(control.kind==='unmount'){await f.page.evaluate(()=>window.stop());await f.answer(0,[row('retired')]);await f.page.evaluate(()=>window.restart());await f.count(2);return(await f.read()).known;}
    await f.page.evaluate(()=>{void window.view.refetch();});await f.count(2);
    await f.answer(1,[row('newer')]);await f.answer(0,[row('older')]);return(await f.read()).names;
  }
  const expected=control.kind==='generation'?['newer']:false;
  assert.deepEqual(await observe(code),expected);
  const actual=await observe(await compile(control.change));
  assert.throws(()=>assert.deepEqual(actual,expected),assert.AssertionError);
});
