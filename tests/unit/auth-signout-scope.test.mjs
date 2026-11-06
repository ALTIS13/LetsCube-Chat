import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const requireKub=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const {createClient}=requireKub('@supabase/supabase-js');
const source=readFileSync(new URL('../../artifacts/kub/src/hooks/useUser.ts',import.meta.url),'utf8');

function callback(client,{web=false,retire=async()=>true,alert=()=>{},state=()=>({accountEpoch:1,currentUser:null})}={}) {
  const ast=ts.createSourceFile('useUser.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  let selected, shared;
  function visit(node) {
    if(ts.isFunctionDeclaration(node)&&node.name?.text==='signOutCurrentInstallation')shared=node.getText(ast);
    if(ts.isFunctionDeclaration(node)&&node.name?.text==='useSignOut')selected=node.getText(ast);
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.ok(selected&&shared,'actual source callbacks required');
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(shared+'\n'+selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,useCallback:fn=>fn,createClient:()=>client,
      isWebBrowser:()=>web,retireWebMessagePreviews:retire,showAppAlert:alert,useAppStore:{getState:state}});
  return module.exports.useSignOut();
}

// Actual installed Auth SDK and product callback; only the HTTP leaf is fictional.
// This proves request scope/retirement order, not production session persistence.
async function authFixture({logoutStatuses=[204]}={}) {
  const requests=[];
  const user={id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{}};
  const jwt=part=>Buffer.from(JSON.stringify(part)).toString('base64url');
  const token=jwt({alg:'HS256',typ:'JWT'})+'.'+jwt({sub:user.id,session_id:'20000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600})+'.'+Buffer.from('fixture').toString('base64url');
  const client=createClient('https://auth-scope.fixture.invalid','fictional-public-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(url,init)=>{
      const u=new URL(url);requests.push({path:u.pathname,scope:u.searchParams.get('scope'),method:init?.method});
      if(u.pathname==='/auth/v1/user')return Response.json(user);
      if(u.pathname==='/auth/v1/logout') {
        const status=logoutStatuses.shift();
        if(status===204)return new Response(null,{status});
        if(status===503||status===403)return Response.json({msg:'Fictional service details'}, {status});
        throw Error('unexpected fictional logout request');
      }
      throw Error('unexpected Auth HTTP request');
    }},
  });
  const result=await client.auth.setSession({access_token:token,refresh_token:'fictional-refresh-token'});
  assert.equal(result.error,null);assert.equal(result.data.user.id,user.id);
  return {client,logouts:()=>requests.filter(r=>r.path==='/auth/v1/logout')};
}

test('interactive logout reports the SDK failure and a second local attempt can settle it',async()=>{
  const f=await authFixture({logoutStatuses:[503,403]});
  const alerts=[];
  const out=callback(f.client,{alert:(...args)=>alerts.push(args),state:()=>({accountEpoch:1,currentUser:{id:'fictional-owner'}})});
  await out();
  assert.deepEqual(alerts,[['Проверьте соединение и попробуйте ещё раз.','Не удалось выйти','alert','fictional-owner']]);
  assert.ok((await f.client.auth.getSession()).data.session);
  await out();
  assert.equal((await f.client.auth.getSession()).data.session,null);
  assert.equal(alerts.length,1,'successful settlement must not show an error');
  assert.deepEqual(f.logouts().map(r=>r.scope),['local','local']);
});

test('logout sends local scope through the installed SDK on native clients',async()=>{
  const f=await authFixture();
  const signOut=callback(f.client,{retire:()=>{throw Error('native must not use browser retirement');}});
  await signOut();
  assert.deepEqual(f.logouts(),[{path:'/auth/v1/logout',scope:'local',method:'POST'}]);
  assert.equal((await f.client.auth.getSession()).data.session,null);
});

test('browser logout waits for installation retirement before the local Auth request',async()=>{
  const f=await authFixture();let release;
  const signOut=callback(f.client,{web:true,retire:()=>new Promise(resolve=>{release=resolve;})});
  const pending=signOut();assert.equal(typeof release,'function');assert.deepEqual(f.logouts(),[]);
  release(true);await pending;
  assert.deepEqual(f.logouts(),[{path:'/auth/v1/logout',scope:'local',method:'POST'}]);
});

test('failed browser retirement leaves Auth untouched and shows an alert',async()=>{
  const f=await authFixture(), alerts=[];
  const out=callback(f.client,{web:true,retire:async()=>false,alert:(...args)=>alerts.push(args)});
  await out();
  assert.equal(alerts[0]?.[1],'Не удалось выйти');
  assert.deepEqual(f.logouts(),[]);
  assert.ok((await f.client.auth.getSession()).data.session);
});

test('a failed old-account attempt cannot show an alert in a replacement session',async()=>{
  const f=await authFixture(), alerts=[];
  let epoch=1, settle;
  const out=callback(f.client,{web:true,retire:()=>new Promise(resolve=>{settle=resolve;}),
    state:()=>({accountEpoch:epoch,currentUser:{id:'fictional-owner'}}),alert:(...args)=>alerts.push(args)});
  const pending=out();
  epoch=2; settle(false);
  await pending;
  assert.deepEqual(alerts,[]);
  assert.deepEqual(f.logouts(),[]);
});

test('browser retirement completion cannot sign out a replacement session',async()=>{
  const f=await authFixture();
  let epoch=1, settle;
  const out=callback(f.client,{web:true,retire:()=>new Promise(resolve=>{settle=resolve;}),
    state:()=>({accountEpoch:epoch,currentUser:{id:'fictional-owner'}})});
  const pending=out();
  epoch=2; settle(true);
  await pending;
  assert.deepEqual(f.logouts(),[]);
  assert.ok((await f.client.auth.getSession()).data.session);
});

test('installed SDK default really emits the global scope as a negative control',async()=>{
  const f=await authFixture();await f.client.auth.signOut();
  assert.deepEqual(f.logouts(),[{path:'/auth/v1/logout',scope:'global',method:'POST'}]);
});
