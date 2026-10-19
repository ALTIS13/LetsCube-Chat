import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const sourceRoot=fileURLToPath(new URL('../../artifacts/kub/src/',import.meta.url));
const requireKub=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const {chromium}=requireKub('@playwright/test');
const {build}=createRequire(requireKub.resolve('vite'))('esbuild');
let browser;
const bundles=new Map();

async function compile(mode='signed-only',change){
  if(!change&&bundles.has(mode))return bundles.get(mode);
  let changed=0;
  const result=await build({bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',
    alias:{'@':sourceRoot},define:{'process.env.NODE_ENV':'"development"','import.meta.env':JSON.stringify({VITE_MEDIA_SIGNED_URLS:mode})},
    plugins:[{name:'avatar-controlled-external-leaves',setup(plugin){
      plugin.onResolve({filter:/^@\/lib\/(?:supabase\/client|mediaCompression)$/},args=>({path:args.path,namespace:'fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:
        args.path.endsWith('client')?'export const createClient=()=>window.fixture.client;':'export const readOriginalPreview=()=>null;'}));
      plugin.onLoad({filter:/(?:useMediaVariants|avatarVariantStore|signedMediaUrlStore)\.ts$/},args=>{
        let contents=readFileSync(args.path,'utf8').replaceAll('\r\n','\n');
        if(change&&args.path.replaceAll('\\','/').endsWith(change.file)){
          assert.equal(contents.split(change.before).length-1,1,'literal mutant binds once');changed++;
          contents=contents.replace(change.before,change.after);
        }
        if(args.path.endsWith('useMediaVariants.ts'))contents+=`
          globalThis.avatarFixtureState=()=>({profileRows:avatarVariantRowsByProfileId.size,
            chatRows:avatarVariantRowsByChatId.size,profile:avatarVariants.__debug?.(),chat:chatAvatarVariants.__debug?.()});
        `;
        return{loader:'ts',contents};
      });
    }}],
    stdin:{sourcefile:'avatar-capacity-fixture.tsx',resolveDir:sourceRoot,loader:'tsx',contents:`
      import React,{act} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {useAvatarVariant,useChatAvatarVariant,useAvatarVariantUrls} from './hooks/useMediaVariants';
      import {signedMediaUrls} from './lib/media/mediaUrl';
      globalThis.IS_REACT_ACT_ENVIRONMENT=true;
      const calls=[],queries=[],timers=new Map(),views=new Map();let time=1700000000000,nextTimer=0,holdMeta=false,missing=false;
      let metadataMode='success',failureBudget=0,savedTimers=[];
      Date.now=()=>time;
      window.setTimeout=(callback,delay=0)=>{const id=++nextTimer;timers.set(id,{callback,at:time+delay});return id;};
      window.clearTimeout=id=>timers.delete(id);
      const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
      function metadata(){
        const fields={};const query={select(){return query;},eq(){return query;},is(){return query;},
          in(column,ids){if(column!=='variant_kind'){fields.column=column;fields.ids=[...ids];}return query;},
          then(resolve,reject){const call={...fields,pending:true};queries.push(call);
            const data=()=>missing?[]:call.ids.flatMap(id=>[128,256].map(size=>({id:id+'-'+size,[call.column]:id,
              variant_kind:'avatar_'+size,variant_bucket:'avatars',variant_path:id+'/'+size+'.webp',width:size,height:size,
              status:'ready',updated_at:'2026-10-19T00:00:00Z'})));
            return new Promise((yes,no)=>{
              call.resolve=(mode='success')=>{call.pending=false;
                if(mode==='reject')no(Error('synthetic metadata transport failure'));
                else yes(mode==='error'?{data:null,error:{message:'synthetic metadata refusal'}}:{data:data(),error:null});};
              if(!holdMeta){if(metadataMode==='success')call.resolve();
                else if(failureBudget>0){failureBudget--;call.resolve(metadataMode);}}
            }).then(resolve,reject);}};
        return query;
      }
      const client={from:metadata,storage:{from(bucket){return{
        getPublicUrl:path=>({data:{publicUrl:'https://synthetic.invalid/public/'+bucket+'/'+path}}),
        createSignedUrls:(paths,ttl)=>new Promise((resolve,reject)=>{const index=calls.length;
          const call={bucket,paths:[...paths],ttl,index,pending:true};calls.push(call);
          call.resolve=refuse=>{call.pending=false;resolve({error:null,data:paths.map(path=>({path,
            signedUrl:refuse?null:'https://synthetic.invalid/storage/v1/object/sign/'+bucket+'/'+path+'?issue='+index,
            error:refuse?'synthetic-refusal':null}))});};
          call.reject=()=>{call.pending=false;reject(Error('synthetic-offline'));};})
      };}}};
      const root=createRoot(document.getElementById('root'));let ids=[],kind='profile',oldRelease;
      function Single({id}){const value=kind==='chat'?useChatAvatarVariant(id):useAvatarVariant(id);views.set(id,value);return null;}
      function Bulk(){const value=useAvatarVariantUrls(ids);for(const id of ids)views.set(id,{variant:value[id]});return null;}
      function Tree(){return kind==='bulk'?<Bulk/>:ids.map(id=><Single key={id} id={id}/>);}
      window.fixture={client,
        async mount(values,type='profile'){ids=values;kind=type;views.clear();await act(async()=>{root.render(<Tree/>);await settle();});},
        async detach(){ids=[];views.clear();await act(async()=>{root.render(null);await settle();});},
        async expireAndDetach(ms){await act(async()=>{time+=ms;
          for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.callback();}
          ids=[];views.clear();flushSync(()=>root.render(null));await settle();});},
        async answer(index,refuse=false){await act(async()=>{calls[index].resolve(refuse);await settle();});},
        async reject(index){await act(async()=>{calls[index].reject();await settle();});},
        async drain(max=20){let count=0;for(;count<max;count++){const next=calls.findIndex(call=>call.pending);if(next<0)break;
          await act(async()=>{calls[next].resolve(false);await settle();});}return{count,pending:calls.filter(call=>call.pending).length};},
        async advance(ms){await act(async()=>{time+=ms;const due=[...timers].filter(([,timer])=>timer.at<=time);
          for(const [id,timer] of due){timers.delete(id);timer.callback();}await settle();});},
        async account(id){await act(async()=>{signedMediaUrls().setAccount(id);await settle();});},
        saveLease(){oldRelease=signedMediaUrls().retain({bucket:'avatars',path:'p0/128.webp'});},
        async releaseOld(){await act(async()=>{oldRelease();await settle();});},
        async legacy(){let url;await act(async()=>{const ref={bucket:'messages',path:'fictional/message.webp'};
          signedMediaUrls().request(ref);url=signedMediaUrls().get(ref);await settle();});return url;},
        holdMetadata(value){holdMeta=value;},missing(value){missing=value;},
        metadataMode(value,budget=6){metadataMode=value;failureBudget=budget;},
        async metadata(index,mode='success'){await act(async()=>{queries[index].resolve(mode);await settle();});},
        saveTimers(){savedTimers=[...timers.values()].map(timer=>timer.callback);},
        async fireSaved(){await act(async()=>{for(const callback of savedTimers)callback();await settle();});},
        inspect(){return{calls:calls.map(({resolve,reject,...rest})=>rest),queries:queries.map(({resolve,...rest})=>rest),
          views:Object.fromEntries(views),raw:globalThis.avatarFixtureState(),sign:signedMediaUrls().__debug(),
          timers:[...timers.values()].map(timer=>timer.at-time),
          passive:signedMediaUrls().peek?.({bucket:'avatars',path:'p0/128.webp'})??null};}
      };
    `}});
  if(change)assert.equal(changed,1);
  const bundle=result.outputFiles[0].text;if(!change)bundles.set(mode,bundle);return bundle;
}

test.before(async()=>{browser=await chromium.launch({headless:true,env:{...process.env,KUB_QA_ALLOW_MUTATIONS:'0'}});});
test.after(async()=>{await browser?.close();});
async function fixture(t,{mode='signed-only',change}={}){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  await page.route('**/*',route=>route.abort());page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[],'no unhandled avatar failure');});
  await page.setContent('<!doctype html><title>Fictional avatar signing</title><div id="root"></div>');
  await page.addScriptTag({content:await compile(mode,change)});
  const run=(method,...args)=>page.evaluate(({method,args})=>window.fixture[method](...args),{method,args});
  return{run,state:()=>run('inspect')};
}
const ids=(count,offset=0)=>Array.from({length:count},(_,i)=>'p'+(i+offset));

for(const mode of ['signed-only','signed'])for(const kind of ['profile','chat','bulk'])test(`${mode} ${kind}: 514 simultaneously demanded objects settle once without capacity feedback`,async t=>{
  const f=await fixture(t,{mode});await f.run('mount',ids(257),kind);await f.run('drain',20);
  const state=await f.state(),paths=state.calls.flatMap(call=>call.paths);
  assert.equal(paths.length,514,'each variant signs once, including the two beyond idle capacity');
  assert.equal(new Set(paths).size,514);assert.equal(state.calls.some(call=>call.pending),false);
  assert.equal(Object.values(state.views).every(view=>view.variant?.avatar128Url?.includes('/sign/')),true);
  await f.run('advance',2_880_000);await f.run('drain',20);
  const renewed=await f.state();assert.equal(renewed.calls.flatMap(call=>call.paths).length,1028,'over-budget renewal must settle too');
  assert.equal(renewed.calls.some(call=>call.pending),false);
});

test('514 leased avatar objects leave an idle budget for a legacy message get/request consumer',async t=>{
  const f=await fixture(t);await f.run('mount',ids(257));await f.run('drain');
  await f.run('legacy');await f.run('drain');const initial=await f.state();
  assert.equal(initial.sign.known,515,'514 pinned avatars plus an independent idle message answer');
  assert.equal(initial.calls.flatMap(call=>call.paths).length,515);
  assert.equal((await f.run('legacy')).includes('/sign/messages/'),true,'ordinary message answer stays usable');
  await f.run('drain');assert.equal((await f.state()).calls.length,initial.calls.length,'legacy answer must not be evicted on arrival');
  await f.run('detach');assert.equal((await f.state()).sign.known,512,'releasing the active set restores the idle cap');
});

test('detached historical avatars do not re-sign on notifications or clock renewal',async t=>{
  const f=await fixture(t);await f.run('mount',ids(257));await f.run('detach');await f.run('drain',20);
  const initial=await f.state();assert.equal(initial.calls.flatMap(call=>call.paths).length<=514,true,'no history-driven signing loop');
  await f.run('advance',2_880_000);await f.run('drain',10);
  assert.equal((await f.state()).calls.length,initial.calls.length,'no active avatar means no renewal demand');
});

test('literal 512-object capacity and public-mode controls calibrate the fixture',async t=>{
  const f=await fixture(t);await f.run('mount',ids(256));await f.run('drain');
  assert.equal((await f.state()).calls.flatMap(call=>call.paths).length,512);
  const p=await fixture(t,{mode:'public'});await p.run('mount',ids(257));await p.run('drain');
  const state=await p.state();assert.equal(state.calls.length,0);
  assert.equal(Object.values(state.views).every(view=>view.variant?.avatar128Url?.includes('/public/')),true);
});

for(const mode of ['signed-only','signed'])for(const kind of ['profile','chat','bulk'])test(`${mode} ${kind}: mounted renewal at 80% needs no metadata query and detach ends demand`,async t=>{
  const f=await fixture(t,{mode});await f.run('mount',['p0'],kind);await f.run('drain');
  const initial=await f.state(),url=initial.views.p0.variant.avatar128Url;
  await f.run('advance',2_879_999);assert.equal((await f.state()).calls.length,1);
  await f.run('advance',1);assert.equal((await f.state()).calls.length,2);
  assert.equal((await f.state()).views.p0.variant.avatar128Url,url,'renewal retains the usable offer');
  await f.run('drain');const renewed=await f.state();assert.notEqual(renewed.views.p0.variant.avatar128Url,url);
  assert.equal(renewed.queries.length,initial.queries.length);
  await f.run('detach');await f.run('advance',2_880_000);assert.equal((await f.state()).calls.length,2);
});

for(const mode of ['signed-only','signed'])test(`${mode}: held renewal, stale floor, refusal and literal cooldown preserve mode policy`,async t=>{
  const f=await fixture(t,{mode});await f.run('mount',['p0']);await f.run('drain');
  await f.run('advance',2_880_000);await f.run('advance',420_000);
  let state=await f.state();assert.equal(state.calls.length,2);
  assert.equal(state.views.p0.variant.avatar128Url?.includes('/sign/')??false,false,'spent offer must not survive passive snapshot');
  assert.equal(state.views.p0.variant.avatar128Url?.includes('/public/')??false,mode==='signed');
  await f.run('answer',1,true);state=await f.state();assert.equal(state.passive,null,'refusal revokes the old signed answer');
  assert.equal(state.views.p0.variant.avatar128Url?.includes('/public/')??false,mode==='signed');
  await f.run('advance',29_999);assert.equal((await f.state()).calls.length,2);
  await f.run('advance',1);assert.equal((await f.state()).calls.length,3);
  await f.run('drain');assert.equal((await f.state()).views.p0.variant.avatar128Url.includes('/sign/'),true);
});

test('a rejected renewal does not spin or publish a refusal, but heals on a later active clock',async t=>{
  const f=await fixture(t);await f.run('mount',['p0']);await f.run('drain');const old=(await f.state()).views.p0.variant.avatar128Url;
  await f.run('advance',2_880_000);await f.run('reject',1);assert.equal((await f.state()).views.p0.variant.avatar128Url,old);
  await f.run('drain',0);assert.equal((await f.state()).calls.length,2);
  await f.run('advance',60_000);assert.equal((await f.state()).calls.length,3);await f.run('drain');
  assert.notEqual((await f.state()).views.p0.variant.avatar128Url,old);
});

test('raw rows and answers share a literal 512-id idle budget while the mounted set is protected',async t=>{
  const f=await fixture(t);await f.run('mount',ids(520));await f.run('drain',30);
  let state=await f.state();assert.equal(state.raw.profileRows,520);assert.equal(state.raw.profile.known,520);
  assert.equal(state.sign.known,1040);assert.equal(Object.values(state.views).every(view=>view.variant?.avatar128Url),true);
  await f.run('detach');state=await f.state();assert.equal(state.raw.profileRows,512);assert.equal(state.raw.profile.known,512);
  assert.equal(state.raw.profile.retained,0);assert.equal(state.sign.known,512);
  const queries=state.queries.length,calls=state.calls.length;
  await f.run('advance',3_300_000);assert.equal((await f.state()).calls.length,calls);
  await f.run('mount',['p0']);await f.run('drain');state=await f.state();assert.equal(state.queries.length,queries+1,'evicted rows/answer are fetched together');
  assert.equal(state.raw.profileRows,513);assert.equal(state.raw.profile.known,513,'512 idle plus one mounted id');
  assert.equal(state.views.p0.variant.avatar128Url.includes('/sign/'),true);
  await f.run('detach');state=await f.state();assert.equal(state.raw.profileRows,512);assert.equal(state.raw.profile.known,512);
});

test('a remounted idle answer cannot expose its spent signature before lease renewal',async t=>{
  const f=await fixture(t);await f.run('mount',['p0']);await f.run('drain');await f.run('detach');
  await f.run('advance',3_300_000);await f.run('mount',['p0']);
  const pending=await f.state();assert.equal(pending.views.p0.variant.avatar128Url,undefined);assert.equal(pending.queries.length,1);
  await f.run('drain');assert.equal((await f.state()).views.p0.variant.avatar128Url.includes('/sign/'),true);
});

for(const kind of ['profile','chat','bulk'])test(`${kind}: held old-account metadata cannot repopulate rows or request signatures`,async t=>{
  const f=await fixture(t);await f.run('holdMetadata',true);await f.run('mount',['p0'],kind);
  await f.run('account','next-owner');await f.run('metadata',0);
  let state=await f.state();assert.equal(state.calls.length,0);assert.equal(state.raw.profileRows+state.raw.chatRows,0);
  assert.equal(state.queries.length,2);await f.run('metadata',1);await f.run('drain');
  state=await f.state();assert.equal(state.views.p0.variant.avatar128Url.includes('/sign/'),true);
  assert.equal(state.raw.profileRows+state.raw.chatRows,1);
});

test('late signing completion and old lease cleanup cannot replace or unpin the current account',async t=>{
  const f=await fixture(t);await f.run('mount',['p0']);assert.equal((await f.state()).calls.length,1);
  await f.run('saveLease');
  await f.run('account','next-owner');assert.equal((await f.state()).calls.length,2);
  await f.run('answer',1);const current=(await f.state()).views.p0.variant.avatar128Url;
  await f.run('answer',0);assert.equal((await f.state()).views.p0.variant.avatar128Url,current);
  await f.run('releaseOld');
  await f.run('advance',2_880_000);assert.equal((await f.state()).calls.length,3,'current account still owns its renewable leases');
  assert.equal((await f.state()).calls[2].paths.length,2,'old cleanup cannot release either current variant');
  await f.run('drain');await f.run('detach');await f.run('account',null);await f.run('advance',2_880_000);
  const state=await f.state();assert.equal(state.sign.known,0);assert.equal(state.raw.profileRows,0);assert.equal(state.calls.length,3);
});

test('bulk-to-individual handoff reuses metadata and detach ends renewal',async t=>{
  const f=await fixture(t);await f.run('mount',['p0'],'bulk');await f.run('drain');
  await f.run('mount',['p0'],'profile');assert.equal((await f.state()).queries.length,1);
  await f.run('advance',2_880_000);assert.equal((await f.state()).calls.length,2);
  await f.run('drain');await f.run('detach');await f.run('advance',2_880_000);assert.equal((await f.state()).calls.length,2);
});

for(const kind of ['bulk','profile','chat'])for(const failure of ['error','reject']){
  test(`metadata ${failure} ${kind}: failure emits once without a render-driven hot retry`,async t=>{
    const f=await fixture(t);await f.run('metadataMode',failure,6);await f.run('mount',['p0'],kind);
    const state=await f.state();assert.equal(state.queries.length,1,'one failure is not a render-driven retry intent');
    assert.equal(state.calls.length,0);assert.equal(state.raw.profile.known+state.raw.chat.known,0,'transport failure is not NONE');
    assert.equal(state.views.p0.variant,undefined);
  });
}

for(const kind of ['bulk','profile','chat'])test(`metadata ${kind}: one owned 30000ms retry heals while mounted without caching NONE`,async t=>{
  const f=await fixture(t);await f.run('metadataMode','error');await f.run('mount',['p0'],kind);
  let state=await f.state();assert.deepEqual(state.timers,[30000]);assert.equal(state.queries.length,1);
  await f.run('mount',['p0'],kind);assert.equal((await f.state()).queries.length,1,'ordinary rerender is not retry authority');
  await f.run('advance',29999);assert.equal((await f.state()).queries.length,1);
  await f.run('metadataMode','success');await f.run('advance',1);await f.run('drain');
  state=await f.state();assert.equal(state.queries.length,2);assert.equal(state.views.p0.variant.avatar128Url.includes('/sign/'),true);
  assert.equal(state.raw.profile.failed+state.raw.chat.failed,0);assert.equal(state.raw.profile.retryScheduled||state.raw.chat.retryScheduled,false);
});

test('metadata: repeated refusals own one timer, a held retry owns one read, detach cancels future retry',async t=>{
  const f=await fixture(t);await f.run('metadataMode','error');await f.run('mount',ids(3),'bulk');
  assert.deepEqual((await f.state()).timers,[30000]);await f.run('advance',30000);
  assert.equal((await f.state()).queries.length,2);assert.deepEqual((await f.state()).timers,[30000]);
  await f.run('holdMetadata',true);await f.run('advance',30000);await f.run('advance',90000);
  assert.equal((await f.state()).queries.length,3,'held request must not gain parallel retries');
  await f.run('metadata',2,'error');await f.run('saveTimers');await f.run('detach');
  assert.deepEqual((await f.state()).timers,[]);await f.run('fireSaved');await f.run('advance',30000);
  assert.equal((await f.state()).queries.length,3,'captured callback is cancelled too');
});

test('metadata: detach after retry clock fires but before its queued query cancels dispatch',async t=>{
  const f=await fixture(t);await f.run('metadataMode','error');await f.run('mount',['p0'],'bulk');
  await f.run('expireAndDetach',30000);assert.equal((await f.state()).queries.length,1);
  assert.deepEqual((await f.state()).timers,[]);
});

test('metadata: account/reset clears cooldown, retired timer/read cannot modify the new owner',async t=>{
  const f=await fixture(t);await f.run('metadataMode','error');await f.run('mount',['p0'],'bulk');await f.run('saveTimers');
  await f.run('holdMetadata',true);await f.run('account','next-owner');let state=await f.state();assert.equal(state.queries.length,2);
  assert.equal(state.raw.profile.failed,0);assert.deepEqual(state.timers,[],'reset releases the timer before a held new-owner reply');
  await f.run('metadata',1,'error');state=await f.state();
  assert.deepEqual(state.timers,[30000]);assert.equal(state.raw.profile.failed,1);
  await f.run('fireSaved');assert.deepEqual((await f.state()).timers,[30000]);assert.equal((await f.state()).queries.length,2);
  await f.run('holdMetadata',true);await f.run('advance',30000);await f.run('account','third-owner');
  assert.equal((await f.state()).queries.length,4);await f.run('metadata',2,'error');
  state=await f.state();assert.equal(state.raw.profile.failed,0);assert.equal(state.raw.profile.retryScheduled,false);
  await f.run('metadata',3);await f.run('drain');assert.equal((await f.state()).views.p0.variant.avatar128Url.includes('/sign/'),true);
  await f.run('detach');await f.run('account',null);state=await f.state();assert.equal(state.raw.profile.failed,0);assert.deepEqual(state.timers,[]);
});

test('metadata: failed entries are bounded by mounted ids plus 512 idle and never become answers',async t=>{
  const f=await fixture(t);await f.run('metadataMode','error',30);await f.run('mount',ids(520),'bulk');
  let state=await f.state();assert.equal(state.queries.length,6);assert.equal(state.raw.profile.failed,520);
  assert.equal(state.raw.profile.known,0);assert.equal(state.raw.profileRows,0);assert.deepEqual(state.timers,[30000]);
  await f.run('detach');state=await f.state();assert.equal(state.raw.profile.failed,512);assert.deepEqual(state.timers,[]);
  await f.run('advance',30000);assert.equal((await f.state()).queries.length,6,'idle failures do not own retry work');
  await f.run('metadataMode','success');await f.run('mount',['p0'],'bulk');await f.run('drain');
  assert.equal((await f.state()).views.p0.variant.avatar128Url.includes('/sign/'),true);
  await f.run('detach');await f.run('account',null);assert.equal((await f.state()).raw.profile.failed,0,'reset removes idle failures too');
});

test('metadata: unrelated failure preserves a known avatar while the failed id heals',async t=>{
  const f=await fixture(t);await f.run('mount',['p0'],'bulk');await f.run('drain');const initial=await f.state(),url=initial.views.p0.variant.avatar128Url;
  await f.run('metadataMode','error');await f.run('mount',['p0','p1'],'bulk');let state=await f.state();
  assert.equal(state.queries.length,2);assert.equal(state.views.p0.variant.avatar128Url,url);
  assert.equal(state.views.p1.variant,undefined);assert.equal(state.raw.profile.known,1,'failed id is not a NONE answer');
  await f.run('metadataMode','success');await f.run('advance',30000);await f.run('drain');state=await f.state();
  assert.equal(state.views.p0.variant.avatar128Url,url);assert.equal(state.views.p1.variant.avatar128Url.includes('/sign/'),true);
});

const mutations=[
  {name:'metadata cooldown admission omitted',file:'lib/avatarVariantStore.ts',
    before:'    if ((failed.get(id) ?? 0) > now()) return;',after:'',
    async check(f){await f.run('metadataMode','error',6);await f.run('mount',['p0'],'bulk');
      assert.equal((await f.state()).queries.length,1);}},
  {name:'metadata retry ownership omitted',file:'lib/avatarVariantStore.ts',
    before:'    retryTimer = timer;',after:'    retryWindow.clearTimeout(timer);',
    async check(f){await f.run('metadataMode','error');await f.run('mount',['p0'],'bulk');await f.run('metadataMode','success');
      await f.run('advance',30000);assert.equal((await f.state()).queries.length,2);}},
  {name:'metadata old callback fence omitted',file:'lib/avatarVariantStore.ts',
    before:'      if (retryGeneration !== generation || retryTimer !== timer) return;',after:'',
    async check(f){await f.run('metadataMode','error');await f.run('mount',['p0'],'bulk');await f.run('saveTimers');
      await f.run('account','next-owner');await f.run('fireSaved');assert.deepEqual((await f.state()).timers,[30000]);}},
  {name:'metadata idle failure eviction omitted',file:'lib/avatarVariantStore.ts',
    before:'      failed.delete(id);\n      idleFailures -= 1;',after:'      idleFailures -= 1;',
    async check(f){await f.run('metadataMode','error',30);await f.run('mount',ids(520),'bulk');await f.run('detach');
      assert.equal((await f.state()).raw.profile.failed,512);}},
  {name:'metadata queued retry detach omitted',file:'lib/avatarVariantStore.ts',
    before:'          pending.delete(id);',after:'',
    async check(f){await f.run('metadataMode','error');await f.run('mount',['p0'],'bulk');await f.run('expireAndDetach',30000);
      assert.equal((await f.state()).queries.length,1);}},
  {name:'metadata reset forget omitted',file:'lib/avatarVariantStore.ts',
    before:'      failed.clear();',after:'',
    async check(f){await f.run('metadataMode','error');await f.run('mount',['p0'],'bulk');await f.run('detach');await f.run('account',null);
      assert.equal((await f.state()).raw.profile.failed,0);}},
  {name:'passive projection replaced by demandful get',file:'hooks/useMediaVariants.ts',
    before:'signedMediaUrls().peek(ref)',after:'signedMediaUrls().get(ref)',
    async check(f){await f.run('mount',ids(257));await f.run('detach');await f.run('drain',20);
      assert.equal((await f.state()).calls.flatMap(call=>call.paths).length<=514,true);}},
  {name:'mounted answer protection omitted',file:'lib/media/signedMediaUrlStore.ts',
    before:'.filter(([key]) => !retained.has(key))',after:'.filter(() => true)',
    async check(f){await f.run('mount',ids(257));await f.run('drain');
      assert.equal(Object.values((await f.state()).views).every(view=>view.variant?.avatar128Url&&view.variant?.avatar256Url),true);}},
  {name:'active clock demand omitted',file:'lib/media/signedMediaUrlStore.ts',
    before:'    for (const { ref } of retained.values()) enqueue(ref);',after:'',
    async check(f){await f.run('mount',['p0']);await f.run('drain');await f.run('advance',2_880_000);
      assert.equal((await f.state()).calls.length,2);}},
  {name:'last avatar release omitted',file:'hooks/useMediaVariants.ts',
    before:'    for (const release of signingReleases.get(id) ?? []) release();',after:'',
    async check(f){await f.run('mount',['p0']);await f.run('drain');await f.run('detach');await f.run('advance',2_880_000);
      assert.equal((await f.state()).calls.length,1);}},
  {name:'row eviction omitted',file:'hooks/useMediaVariants.ts',
    before:'        rowsByOwnerId.delete(id);',after:'',
    async check(f){await f.run('mount',ids(520));await f.run('drain',30);await f.run('detach');
      assert.equal((await f.state()).raw.profileRows,512);}},
  {name:'old-owner metadata fence omitted',file:'hooks/useMediaVariants.ts',
    before:'  if (generation !== avatarSigningGeneration) return {};',after:'',
    async check(f){await f.run('holdMetadata',true);await f.run('mount',['p0']);await f.run('account','next-owner');await f.run('metadata',0);
      assert.equal((await f.state()).raw.profileRows,0);assert.equal((await f.state()).calls.length,0);}},
  {name:'old lease generation fence omitted',file:'lib/media/signedMediaUrlStore.ts',
    before:'if (released || retainedGeneration !== generation) return;',after:'if (released) return;',
    async check(f){await f.run('mount',['p0']);await f.run('saveLease');await f.run('account','next-owner');await f.run('answer',1);
      await f.run('answer',0);await f.run('releaseOld');await f.run('advance',2_880_000);
      assert.equal((await f.state()).calls.at(-1).paths.length,2);}},
  {name:'idle budget silently increased',file:'lib/media/signedMediaUrlStore.ts',
    before:'SIGN_CACHE_LIMIT = 512',after:'SIGN_CACHE_LIMIT = 1024',
    async check(f){await f.run('mount',ids(257));await f.run('drain');await f.run('detach');
      assert.equal((await f.state()).sign.known,512);}},
];
for(const mutant of mutations)for(const mode of mutant.name==='passive projection replaced by demandful get'?['signed-only','signed']:['signed-only']){
  test(`${mode}: literal omission killed - ${mutant.name}`,async t=>{
    const f=await fixture(t,{mode,change:mutant});await assert.rejects(()=>mutant.check(f),{code:'ERR_ASSERTION'});
  });
}
