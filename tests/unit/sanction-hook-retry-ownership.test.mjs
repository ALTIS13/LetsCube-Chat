import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const sourceRoot=fileURLToPath(new URL('../../artifacts/kub/src/',import.meta.url));
const requireKub=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const {chromium}=requireKub('@playwright/test');
const {build}=createRequire(requireKub.resolve('vite'))('esbuild');
let browser,bundle;

async function compile(change){
  let changed=0;
  const result=await build({bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',
    alias:{'@':sourceRoot},define:{'process.env.NODE_ENV':'"development"'},
    plugins:[{name:'sanction-external-leaves',setup(plugin){
      plugin.onResolve({filter:/^@\/(?:lib\/supabase\/client|store\/app.store|lib\/dev\/instrumentation)$/},args=>({path:args.path,namespace:'fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:
        args.path.endsWith('client')?'export const createClient=()=>window.fixture.client;':
        args.path.endsWith('app.store')?'export const useAppStore=Object.assign(selector=>window.fixture.useStore(selector),{getState:()=>window.fixture.ownerState()});':
        'export const bumpFetch=name=>window.fixture.fetches.push(name);export const registerChannel=()=>{};export const unregisterChannel=()=>{};'}));
      if(change)plugin.onLoad({filter:/use(?:Ban|Mute)State\.ts$/},args=>{
        if(!args.path.replaceAll('\\','/').endsWith(change.file))return;
        const text=readFileSync(args.path,'utf8').replaceAll('\r\n','\n');
        assert.equal(text.split(change.before).length-1,1,'literal mutation must bind exactly once');changed++;
        return{loader:'ts',contents:text.replace(change.before,change.after)};
      });
    }}],
    stdin:{sourcefile:'sanction-retry-fixture.tsx',resolveDir:sourceRoot,loader:'tsx',contents:`
      import React,{act} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useStore} from 'zustand';
      import {createStore} from 'zustand/vanilla';
      import {useBanState} from './hooks/useBanState';
      import {useMuteState} from './hooks/useMuteState';
      globalThis.IS_REACT_ACT_ENVIRONMENT=true;
      const core=createStore(()=>({currentUser:{id:'owner-a'},accountEpoch:1}));
      const calls=[],channels=[],fetches=[],timers=new Map();let time=1700000000000,nextTimer=0,snapshot,kind,chat='chat-a';
      Date.now=()=>time;
      window.setTimeout=(callback,delay=0)=>{const id=++nextTimer;timers.set(id,{callback,at:time+delay});return id;};
      window.clearTimeout=id=>timers.delete(id);
      const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
      function request(table){
        const fields={table};const query={select(){return query;},eq(key,value){fields[key]=value;return query;},
          order(){return query;},or(value){fields.scope=value;return query;},is(key,value){fields[key]=value;return query;},
          then(resolve,reject){const call={...fields,pending:true};calls.push(call);
            return new Promise((yes,no)=>{call.resolve=answer=>{call.pending=false;yes(answer);};call.reject=error=>{call.pending=false;no(error);};}).then(resolve,reject);}};
        return query;
      }
      const client={from:request,channel(name){const channel={name,removed:false,
        on(_event,_filter,callback){channel.callback=callback;return channel;},subscribe(){return channel;}};channels.push(channel);return channel;},
        removeChannel(channel){channel.removed=true;return Promise.resolve('ok');}};
      const root=createRoot(document.getElementById('root'));
      function Consumer(){snapshot=kind==='ban'?useBanState():useMuteState(chat);return null;}
      window.fixture={client,calls,channels,fetches,ownerState:core.getState,useStore:selector=>useStore(core,selector),
        async mount(value){kind=value;await act(async()=>{root.render(<Consumer/>);await settle();});},
        async answer(index,answer){await act(async()=>{calls[index].resolve(answer);await settle();});},
        async reject(index){await act(async()=>{calls[index].reject(Error('synthetic transport refusal'));await settle();});},
        async realtime(index=channels.length-1){await act(async()=>{channels[index].callback({});await settle();});},
        async owner(id,epoch=core.getState().accountEpoch+1){await act(async()=>{core.setState({currentUser:id?{id}:null,accountEpoch:epoch});await settle();});},
        async scope(value){chat=value;await act(async()=>{root.render(<Consumer/>);await settle();});},
        async unmount(){await act(async()=>{root.unmount();await settle();});},
        async advance(ms){await act(async()=>{const target=time+ms;
          for(let steps=0;steps<100;steps++){const due=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
            if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].callback();await settle();}
          time=target;await settle();});},
        inspect(){return{state:snapshot,queries:calls.map(({resolve,reject,...rest})=>rest),
          timers:[...timers.values()].map(value=>value.at-time),pending:calls.filter(call=>call.pending).length,
          channels:channels.map(({name,removed})=>({name,removed})),fetches:[...fetches]};},
        captureTimers(){window.savedTimerCallbacks=[...timers.values()].map(value=>value.callback);},
        async fireSaved(){await act(async()=>{for(const callback of window.savedTimerCallbacks)callback();await settle();});},
      };
    `}});
  if(change)assert.equal(changed,1);
  return result.outputFiles[0].text;
}

test.before(async()=>{
  bundle=await compile();browser=await chromium.launch({headless:true,env:{...process.env,KUB_QA_ALLOW_MUTATIONS:'0'}});
});
test.after(async()=>{await browser?.close();});

async function fixture(t,kind,code=bundle){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  await page.route('**/*',route=>route.abort());page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[],'no unhandled hook rejection');});
  await page.setContent('<!doctype html><title>Fictional sanction retry</title><div id="root"></div>');
  await page.addScriptTag({content:code});await page.evaluate(kind=>window.fixture.mount(kind),kind);
  const run=(method,...args)=>page.evaluate(({method,args})=>window.fixture[method](...args),{method,args});
  return{page,run,state:()=>run('inspect')};
}
const failure={data:null,error:{code:'42501',message:'synthetic refusal'}};
const success={data:[],error:null};
const sanction=kind=>({id:'synthetic-sanction',user_id:'owner-a',expires_at:null,...(kind==='mute'?{chat_id:null}:{})});

for(const kind of ['ban','mute']){
  test(`${kind}: fail -> retry T1, realtime fail -> T2, unmount leaves no late SQL dispatch`,async t=>{
    const f=await fixture(t,kind);await f.run('answer',0,failure);await f.run('realtime');await f.run('answer',1,failure);
    await f.run('unmount');assert.deepEqual((await f.state()).timers,[],'cleanup must release the timer immediately');
    await f.run('advance',30000);
    assert.equal((await f.state()).queries.length,2,'a superseded retry must not query after unmount');
    assert.deepEqual((await f.state()).timers,[]);
  });
  test(`${kind}: successful realtime read cancels the older retry`,async t=>{
    const f=await fixture(t,kind);await f.run('answer',0,failure);await f.run('realtime');await f.run('answer',1,success);
    await f.run('advance',1000);assert.equal((await f.state()).queries.length,2,'success must retire the earlier retry');
    assert.deepEqual((await f.state()).timers,[]);assert.equal((await f.state()).state.view,'ready');
  });
  test(`${kind}: held read coalesces realtime bursts to one trailing read`,async t=>{
    const f=await fixture(t,kind);for(let i=0;i<4;i++)await f.run('realtime');
    assert.equal((await f.state()).queries.length,1,'same-owner reads must not overlap');
    await f.run('answer',0,success);assert.equal((await f.state()).queries.length,2,'do not lose a newer realtime intent');
    await f.run('answer',1,success);assert.equal((await f.state()).queries.length,2);
  });
  test(`${kind}: captured retry and channel callbacks cannot query after cleanup`,async t=>{
    const f=await fixture(t,kind);await f.run('answer',0,failure);await f.run('captureTimers');await f.run('unmount');
    await f.run('fireSaved');await f.run('realtime',0);
    assert.equal((await f.state()).queries.length,1,'cancellation must be checked before starting a query');
  });
  test(`${kind}: old owner completion cannot change the new owner or schedule its retry`,async t=>{
    const f=await fixture(t,kind);await f.run('owner','owner-b');assert.equal((await f.state()).queries.length,2);
    await f.run('answer',1,success);await f.run('answer',0,failure);await f.run('realtime',0);await f.run('advance',30000);
    const state=await f.state();assert.equal(state.queries.length,2);assert.equal(state.state.view,'ready');
    assert.equal(state.state[kind==='ban'?'banned':'muted'],false);assert.deepEqual(state.timers,[]);
  });
  test(`${kind}: late successful old-owner read cannot replace the new owner verdict`,async t=>{
    const f=await fixture(t,kind);await f.run('owner','owner-b');await f.run('answer',1,success);
    await f.run('answer',0,{data:[sanction(kind)],error:null});
    assert.equal((await f.state()).state[kind==='ban'?'banned':'muted'],false);
  });
  test(`${kind}: logout retires pending retry and retained callbacks before dispatch`,async t=>{
    const f=await fixture(t,kind);await f.run('answer',0,failure);await f.run('captureTimers');await f.run('owner',null);
    await f.run('fireSaved');await f.run('realtime',0);await f.run('advance',30000);
    const value=await f.state();assert.equal(value.queries.length,1);assert.equal(value.state.view,'ready');
    assert.equal(value.state[kind==='ban'?'banned':'muted'],false);assert.deepEqual(value.timers,[]);
  });
  test(`${kind}: cleanup while read and realtime intent are held starts no trailing lane`,async t=>{
    const f=await fixture(t,kind);await f.run('realtime');await f.run('unmount');await f.run('answer',0,failure);
    await f.run('advance',30000);assert.equal((await f.state()).queries.length,1);assert.deepEqual((await f.state()).timers,[]);
  });
  test(`${kind}: rejected read releases its lane and retries with explicit refused state`,async t=>{
    const f=await fixture(t,kind);await f.run('reject',0);const refused=await f.state();
    assert.equal(refused.state.view,'unavailable');assert.equal(refused.state.loading,false);assert.deepEqual(refused.timers,[1000]);
    await f.run('advance',1000);assert.equal((await f.state()).queries.length,2);
    await f.run('answer',1,{data:[sanction(kind)],error:null});assert.equal((await f.state()).state[kind==='ban'?'banned':'muted'],true);
    assert.equal((await f.state()).state.view,'ready');assert.deepEqual((await f.state()).timers,[]);
  });
  test(`${kind}: refusal retains a known sanction and literal 1/2/4/8/16/30 second backoff`,async t=>{
    const f=await fixture(t,kind);await f.run('answer',0,{data:[sanction(kind)],error:null});await f.run('realtime');
    let index=1;
    for(const delay of [1000,2000,4000,8000,16000,30000,30000]){
      await f.run('answer',index,failure);const before=await f.state();
      assert.equal(before.state[kind==='ban'?'banned':'muted'],true);assert.equal(before.state.view,'stale');
      assert.deepEqual(before.timers,[delay]);await f.run('advance',delay-1);assert.equal((await f.state()).queries.length,index+1);
      await f.run('advance',1);index++;assert.equal((await f.state()).queries.length,index+1);
    }
    await f.run('answer',index,success);assert.equal((await f.state()).state[kind==='ban'?'banned':'muted'],false);
    await f.run('realtime');await f.run('answer',index+1,failure);assert.deepEqual((await f.state()).timers,[1000]);
  });
}

test('mute: replaced chat owns its query and late old-scope result/callback cannot overwrite it',async t=>{
  const f=await fixture(t,'mute');await f.run('realtime');await f.run('scope','chat-b');
  assert.equal((await f.state()).queries.length,2);assert.equal((await f.state()).queries[1].scope,'chat_id.is.null,chat_id.eq.chat-b');
  await f.run('answer',1,success);await f.run('answer',0,{data:[{...sanction('mute'),chat_id:'chat-a'}],error:null});
  await f.run('realtime',0);const value=await f.state();assert.equal(value.queries.length,2);
  assert.equal(value.state.muted,false);assert.equal(value.state.scope,null);assert.equal(value.channels[0].removed,true);
});

for(const kind of ['ban','mute']){
  const file=`hooks/use${kind==='ban'?'Ban':'Mute'}State.ts`;
  const mutants=[
    {name:'retry replacement',before:'      clearRetry();\n      if (inFlight)',after:'      if (inFlight)',
      async check(f){await f.run('answer',0,failure);await f.run('realtime');await f.run('answer',1,success);
        await f.run('advance',1000);assert.equal((await f.state()).queries.length,2);}},
    {name:'pre-query cancellation',before:'    const refresh = async (): Promise<void> => {\n      if (cancelled) return;',
      after:'    const refresh = async (): Promise<void> => {',async check(f){
        await f.run('answer',0,failure);await f.run('captureTimers');await f.run('unmount');await f.run('fireSaved');
        assert.equal((await f.state()).queries.length,1);}},
    {name:'single-flight gate',before:'      if (inFlight) {\n        refreshPending = true;\n        return;\n      }',after:'',
      async check(f){await f.run('realtime');await f.run('realtime');assert.equal((await f.state()).queries.length,1);}},
    {name:'trailing realtime intent',before:'        if (!cancelled && refreshPending) {\n          refreshPending = false;\n          void refresh();\n        }',after:'',
      async check(f){await f.run('realtime');await f.run('answer',0,success);assert.equal((await f.state()).queries.length,2);}},
    {name:'cleanup timer release',before:'      cancelled = true;\n      clearRetry();',after:'      cancelled = true;',
      async check(f){await f.run('answer',0,failure);await f.run('unmount');assert.deepEqual((await f.state()).timers,[]);}},
    {name:'post-read owner fence',before:'        if (cancelled) return;\n        if (error)',after:'        if (error)',
      async check(f){await f.run('owner','owner-b');await f.run('answer',1,success);await f.run('answer',0,{data:[sanction(kind)],error:null});
        assert.equal((await f.state()).state[kind==='ban'?'banned':'muted'],false);}},
  ];
  for(const mutant of mutants)test(`${kind}: literal omission of ${mutant.name} fails its behavioral oracle`,async t=>{
    const f=await fixture(t,kind,await compile({file,...mutant}));
    await assert.rejects(()=>mutant.check(f),{code:'ERR_ASSERTION'});
  });
}
