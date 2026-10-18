import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const requireKub=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const {createClient}=requireKub('@supabase/supabase-js');
const source=readFileSync(new URL('../../artifacts/kub/src/hooks/useUser.ts',import.meta.url),'utf8');

function callback(name,client,{web=false,retire=async()=>true}={}) {
  const ast=ts.createSourceFile('useUser.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  let selected;
  function visit(node) {
    if(name==='useSignOut'&&ts.isFunctionDeclaration(node)&&node.name?.text===name)selected=node.getText(ast);
    if(name==='useUser.signOut'&&ts.isFunctionDeclaration(node)&&node.name?.text==='useUser') {
      for(const statement of node.body.statements)if(ts.isVariableStatement(statement))
        for(const declaration of statement.declarationList.declarations)
          if(declaration.name.getText(ast)==='signOut')selected='export const candidate='+declaration.initializer.getText(ast);
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.ok(selected,'actual source callback required');
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,useCallback:fn=>fn,createClient:()=>client,supabase:client,
      isWebBrowser:()=>web,retireWebMessagePreviews:retire});
  return name==='useSignOut'?module.exports.useSignOut():module.exports.candidate;
}

// Actual installed Auth SDK and product callback; only the HTTP leaf is fictional.
// This proves request scope/retirement order, not production session persistence.
async function authFixture() {
  const requests=[];
  const user={id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{}};
  const jwt=part=>Buffer.from(JSON.stringify(part)).toString('base64url');
  const token=jwt({alg:'HS256',typ:'JWT'})+'.'+jwt({sub:user.id,session_id:'20000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600})+'.'+Buffer.from('fixture').toString('base64url');
  const client=createClient('https://auth-scope.fixture.invalid','fictional-public-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(url,init)=>{
      const u=new URL(url);requests.push({path:u.pathname,scope:u.searchParams.get('scope'),method:init?.method});
      if(u.pathname==='/auth/v1/user')return Response.json(user);
      if(u.pathname==='/auth/v1/logout')return new Response(null,{status:204});
      throw Error('unexpected Auth HTTP request');
    }},
  });
  const result=await client.auth.setSession({access_token:token,refresh_token:'fictional-refresh-token'});
  assert.equal(result.error,null);assert.equal(result.data.user.id,user.id);
  return {client,logouts:()=>requests.filter(r=>r.path==='/auth/v1/logout')};
}

for(const name of ['useSignOut','useUser.signOut'])test(name+' sends local logout through the installed SDK on native clients',async()=>{
  const f=await authFixture();
  const signOut=callback(name,f.client,{retire:()=>{throw Error('native must not use browser retirement');}});
  await signOut();
  assert.deepEqual(f.logouts(),[{path:'/auth/v1/logout',scope:'local',method:'POST'}]);
  assert.equal((await f.client.auth.getSession()).data.session,null);
});

for(const name of ['useSignOut','useUser.signOut'])test(name+' browser logout waits for installation retirement before the local Auth request',async()=>{
  const f=await authFixture();let release;
  const signOut=callback(name,f.client,{web:true,retire:()=>new Promise(resolve=>{release=resolve;})});
  const pending=signOut();assert.equal(typeof release,'function');assert.deepEqual(f.logouts(),[]);
  release(true);await pending;
  assert.deepEqual(f.logouts(),[{path:'/auth/v1/logout',scope:'local',method:'POST'}]);
});

for(const name of ['useSignOut','useUser.signOut'])test(name+' failed browser retirement leaves Auth untouched',async()=>{
  const f=await authFixture();
  await assert.rejects(callback(name,f.client,{web:true,retire:async()=>false})());
  assert.deepEqual(f.logouts(),[]);
  assert.ok((await f.client.auth.getSession()).data.session);
});

test('installed SDK default really emits the global scope as a negative control',async()=>{
  const f=await authFixture();await f.client.auth.signOut();
  assert.deepEqual(f.logouts(),[{path:'/auth/v1/logout',scope:'global',method:'POST'}]);
});
