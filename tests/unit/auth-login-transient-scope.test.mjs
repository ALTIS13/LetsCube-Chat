import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const kub=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const {createClient}=kub('@supabase/supabase-js');
const source=readFileSync(new URL('../../artifacts/kub/src/components/auth/LoginForm.tsx',import.meta.url),'utf8');

function actualLogin(client,{globalTransientOmission=false}={}){
  const ast=ts.createSourceFile('LoginForm.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleLogin')arrow=node.initializer.getText(ast);
    ts.forEachChild(node,visit);};visit(ast);assert.ok(arrow,'actual product handleLogin must be selected');
  let selected='export const candidate='+arrow;
  if(globalTransientOmission){
    const parsed=ts.createSourceFile('candidate.ts',selected,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),calls=[];
    const find=node=>{if(ts.isIfStatement(node)&&node.expression.getText(parsed)==='bansErr'){
      const call=n=>{if(ts.isCallExpression(n)&&n.expression.getText(parsed)==='supabase.auth.signOut')calls.push(n);
        ts.forEachChild(n,call);};call(node.thenStatement);}ts.forEachChild(node,find);};find(parsed);
    assert.equal(calls.length,1,'only transient bansErr call may be omitted');
    selected=selected.slice(0,calls[0].getStart(parsed))+'supabase.auth.signOut()'+selected.slice(calls[0].getEnd());
  }
  const state={error:false,ban:false,routes:[],loading:null},module={exports:{}};
  vm.runInNewContext(ts.transpileModule(selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,supabase:client,email:'client@fixture.invalid',password:'public-offline-fixture',
      setError:v=>{state.error=Boolean(v);},setBanInfo:v=>{state.ban=Boolean(v);},setLoading:v=>{state.loading=v;},
      setLocation:v=>state.routes.push(v),mapPgError:()=> 'offline-fixture-error',pendingJoinPath:()=>null,Date});
  return {invoke:()=>module.exports.candidate({preventDefault(){}}),state};
}

// Actual product callback + installed SDK, fictional HTTP leaf/issuer only.
// Peer refresh removal models global scope; it is NOT live auth.sessions or native UI evidence.
async function fixture(mode){
  const uid='10000000-0000-4000-8000-000000000001',sidA='20000000-0000-4000-8000-000000000001',sidB='20000000-0000-4000-8000-000000000002';
  const user={id:uid,aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{}};
  const jwt=sid=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),
    Buffer.from(JSON.stringify({sub:uid,session_id:sid,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'cHVibGljLWZpeHR1cmU'].join('.');
  const session=sid=>({access_token:jwt(sid),refresh_token:sid===sidA?'fixture-A-refresh':'fixture-B-refresh',token_type:'bearer',expires_in:3600,user});
  const live=new Set([sidB]),logouts=[];let banReads=0;
  const leaf=async(input,init={})=>{
    const u=new URL(input instanceof Request?input.url:String(input));assert.equal(u.origin,'https://login-scope.fixture.invalid');
    if(u.pathname==='/auth/v1/user')return Response.json(user);
    if(u.pathname==='/auth/v1/token'&&u.searchParams.get('grant_type')==='password'){live.add(sidA);return Response.json(session(sidA));}
    if(u.pathname==='/auth/v1/token'&&u.searchParams.get('grant_type')==='refresh_token'){
      const body=JSON.parse(init.body),sid=body.refresh_token==='fixture-B-refresh'?sidB:sidA;
      return live.has(sid)?Response.json(session(sid)):Response.json({code:'refresh_token_not_found',msg:'offline fixture retired'},{status:401});
    }
    if(u.pathname==='/auth/v1/logout'){
      const scope=u.searchParams.get('scope');logouts.push({scope,method:init.method});
      if(scope==='global')live.clear();else if(scope==='local')live.delete(sidA);else throw Error('UNEXPECTED_FIXTURE_SCOPE');
      return new Response(null,{status:204});
    }
    if(u.pathname==='/rest/v1/bans'){
      banReads++;
      if(mode==='transient')return Response.json({code:'TEMPORARY_UNAVAILABLE',message:'offline fixture transient read failure'},{status:503});
      return Response.json(mode==='active-ban'?[{reason:'offline fixture only',expires_at:null}]:[]);
    }
    throw Error('UNEXPECTED_OFFLINE_HTTP_LEAF');
  };
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:leaf}};
  const client=createClient('https://login-scope.fixture.invalid','public-offline-fixture',options),peer=createClient('https://login-scope.fixture.invalid','public-offline-fixture',options);
  const restored=await peer.auth.setSession(session(sidB));assert.equal(restored.error,null);
  return {client,peer,logouts,banReads:()=>banReads};
}

test('normal unbanned LoginForm success emits no logout and leaves peer refresh usable',async()=>{
  const f=await fixture('success'),run=actualLogin(f.client);await run.invoke();
  assert.deepEqual(f.logouts,[]);assert.deepEqual(run.state.routes,['/']);assert.equal(run.state.error,false);
  assert.equal((await f.peer.auth.refreshSession()).error,null);
});

const assertLocalFailureResult=(f,peer)=>assert.deepEqual({logouts:f.logouts,peerRefreshOk:peer.error===null},
  {logouts:[{scope:'local',method:'POST'}],peerRefreshOk:true});

test('transient postAuth bans read failure cleans up only this new login, not peer SID',async()=>{
  const f=await fixture('transient'),run=actualLogin(f.client);await run.invoke();
  const peer=await f.peer.auth.refreshSession();
  assert.ok(f.banReads()>=1);assert.equal(run.state.error,true);assert.equal(run.state.ban,false);assert.deepEqual(run.state.routes,[]);
  assert.equal((await f.client.auth.getSession()).data.session,null);
  assertLocalFailureResult(f,peer);
});

test('literal global omission in ONLY transient call is rejected by the unchanged local/peer oracle',async()=>{
  const f=await fixture('transient'),run=actualLogin(f.client,{globalTransientOmission:true});await run.invoke();
  const peer=await f.peer.auth.refreshSession();
  assert.deepEqual({logouts:f.logouts,peerRefreshOk:peer.error===null},
    {logouts:[{scope:'global',method:'POST'}],peerRefreshOk:false});
  assert.throws(()=>assertLocalFailureResult(f,peer),assert.AssertionError);
});

test('SEPARATE POLICY CHARACTERIZATION: active-ban branch still uses global; no local-policy fix asserted',async()=>{
  const f=await fixture('active-ban'),run=actualLogin(f.client);await run.invoke();
  assert.deepEqual(f.logouts,[{scope:'global',method:'POST'}]);assert.equal(run.state.ban,true);assert.deepEqual(run.state.routes,[]);
});
