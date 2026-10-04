import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertTypeCensus} from './media-restore-type-census.contract.mjs';

const legacy=process.env.LETSCUBE_PG17_LEGACY_BASELINE==='1';
const legacyInput={profileId:'pg17.6',liveBefore:{},reference:{},restored:{}};
const check=legacy?()=>assertTypeCensus(legacyInput):
  (await import('./media-restore-pg17-header.contract.mjs')).assertPg17Header;

// Independent REL_17_6 oracle; never import the subject's manifest for expectations.
const columns={
  pg_type:[1247,'oid:oid typname:name typnamespace:oid typowner:oid typlen:int2 typbyval:bool typtype:char typcategory:char typispreferred:bool typisdefined:bool typdelim:char typrelid:oid typsubscript:regproc typelem:oid typarray:oid typinput:regproc typoutput:regproc typreceive:regproc typsend:regproc typmodin:regproc typmodout:regproc typanalyze:regproc typalign:char typstorage:char typnotnull:bool typbasetype:oid typtypmod:int4 typndims:int4 typcollation:oid typdefaultbin:pg_node_tree typdefault:text typacl:_aclitem'],
  pg_enum:[3501,'oid:oid enumtypid:oid enumsortorder:float4 enumlabel:name'],
  pg_range:[3541,'rngtypid:oid rngsubtype:oid rngmultitypid:oid rngcollation:oid rngsubopc:oid rngcanonical:regproc rngsubdiff:regproc'],
  pg_constraint:[2606,'oid:oid conname:name connamespace:oid contype:char condeferrable:bool condeferred:bool convalidated:bool conrelid:oid contypid:oid conindid:oid conparentid:oid confrelid:oid confupdtype:char confdeltype:char confmatchtype:char conislocal:bool coninhcount:int2 connoinherit:bool conkey:_int2 confkey:_int2 conpfeqop:_oid conppeqop:_oid conffeqop:_oid confdelsetcols:_int2 conexclop:_oid conbin:pg_node_tree'],
};
function fixture(){
  return {profileId:'pg17.6-prerequisite',header:{
    serverVersionNum:170006,catalogVersion:202406281,
    catalogs:Object.fromEntries(Object.entries(columns).map(([name,[oid,fields]])=>[name,{oid,
      attributes:fields.split(' ').map(field=>{const [name,type]=field.split(':');return {name,type:'pg_catalog.'+type};}),
    }])),
    functions:[
      {oid:3954,name:'pg_get_object_address',kind:'f',volatility:'s',returnsSet:false,variadicTypeOid:0,
        inputs:['pg_catalog.text','pg_catalog._text','pg_catalog._text'],output:'pg_catalog.record',
        allTypes:['pg_catalog.text','pg_catalog._text','pg_catalog._text','pg_catalog.oid','pg_catalog.oid','pg_catalog.int4'],
        modes:['i','i','i','o','o','o'],names:['type','object_names','object_args','classid','objid','objsubid']},
      {oid:3382,name:'pg_identify_object_as_address',kind:'f',volatility:'s',returnsSet:false,variadicTypeOid:0,
        inputs:['pg_catalog.oid','pg_catalog.oid','pg_catalog.int4'],output:'pg_catalog.record',
        allTypes:['pg_catalog.oid','pg_catalog.oid','pg_catalog.int4','pg_catalog.text','pg_catalog._text','pg_catalog._text'],
        modes:['i','i','i','o','o','o'],names:['classid','objid','objsubid','type','object_names','object_args']},
    ],
  }};
}
const receipt={scope:'pg17-header/v1',evidence:'supplied-header-only',fullRestoreApproved:false,
  pg17Accepted:false,runtimeApproved:false,productionApproved:false};
const refused=reason=>error=>error.code==='pg17_header_refused'&&error.reason===reason;
async function compiled(before,after){
  let source=await readFile(new URL('./media-restore-pg17-header.contract.mjs',import.meta.url),'utf8');
  assert.equal(source.split(before).length-1,1);source=source.replace(before,after);
  source=source.replace("'./media-restore-pg17-header.fixture.mjs'",JSON.stringify(new URL('./media-restore-pg17-header.fixture.mjs',import.meta.url).href));
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
test('exact PG17 header gives diagnostic-only receipt, never recovery authority',()=>{
  assert.deepEqual(check(fixture()),receipt);
});
if(!legacy){
  for(const [name,mutate,reason] of [
    ['other minor',x=>x.header.serverVersionNum=170011,'version'],
    ['PG18',x=>x.header.serverVersionNum=180004,'version'],
    ['string version',x=>x.header.serverVersionNum='170006','version'],
    ['other catalog',x=>x.header.catalogVersion=202506291,'version'],
    ['missing catalog',x=>delete x.header.catalogs.pg_enum,'catalog-shape'],
    ['extra catalog',x=>x.header.catalogs.pg_attribute={oid:1249,attributes:[]},'catalog-shape'],
    ['wrong catalog OID',x=>x.header.catalogs.pg_type.oid=1248,'catalog-shape'],
    ['missing field',x=>x.header.catalogs.pg_type.attributes.pop(),'catalog-shape'],
    ['PG18 enforced field',x=>x.header.catalogs.pg_constraint.attributes.splice(6,0,{name:'conenforced',type:'pg_catalog.bool'}),'catalog-shape'],
    ['PG18 period field',x=>x.header.catalogs.pg_constraint.attributes.push({name:'conperiod',type:'pg_catalog.bool'}),'catalog-shape'],
    ['field order',x=>x.header.catalogs.pg_enum.attributes.reverse(),'catalog-shape'],
    ['same count wrong type',x=>x.header.catalogs.pg_type.attributes[4].type='pg_catalog.int4','catalog-shape'],
    ['shadow type',x=>x.header.catalogs.pg_enum.attributes[3].type='public.name','catalog-shape'],
    ['missing function',x=>x.header.functions.pop(),'function-shape'],
    ['overload',x=>x.header.functions.push(structuredClone(x.header.functions[0])),'function-shape'],
    ['wrong function OID',x=>x.header.functions[0].oid=3955,'function-shape'],
    ['procedure',x=>x.header.functions[0].kind='p','function-shape'],
    ['volatile',x=>x.header.functions[0].volatility='v','function-shape'],
    ['set-returning',x=>x.header.functions[0].returnsSet=true,'function-shape'],
    ['variadic',x=>x.header.functions[0].variadicTypeOid=25,'function-shape'],
    ['input type',x=>x.header.functions[1].inputs[2]='pg_catalog.int2','function-shape'],
    ['return type',x=>x.header.functions[0].output='pg_catalog.text','function-shape'],
    ['OUT type',x=>x.header.functions[0].allTypes[5]='pg_catalog.int2','function-shape'],
    ['OUT mode',x=>x.header.functions[0].modes[5]='b','function-shape'],
    ['argument name',x=>x.header.functions[0].names[5]='objid','function-shape'],
    ['argument order',x=>x.header.functions[0].names.reverse(),'function-shape'],
    ['extra function field',x=>x.header.functions[0].trusted=true,'function-shape'],
    ['normal restoration profile',x=>x.profileId='pg17.6','profile'],
    ['PG18 profile',x=>x.profileId='pg18.4-local','profile'],
    ['extra authority field',x=>x.productionApproved=true,'shape'],
    ['extra header field',x=>x.header.vendorVerified=true,'shape'],
  ])test('refuses '+name,()=>{const input=fixture();mutate(input);assert.throws(()=>check(input),refused(reason));});

  test('malformed values never execute accessors or toJSON',()=>{
    for(const where of ['root','header','catalogs','attributes','function']){
      const input=fixture();let called=false;
      const target={root:input,header:input.header,catalogs:input.header.catalogs,
        attributes:input.header.catalogs.pg_type.attributes,function:input.header.functions[0]}[where];
      Object.defineProperty(target,'untrusted',{get(){called=true;throw new Error('getter executed');}});
      assert.throws(()=>check(input),refused('accessor'));assert.equal(called,false);
    }
    const input=fixture();let called=false;
    input.header.toJSON=()=>{called=true;return {};};
    assert.throws(()=>check(input),refused('shape'));assert.equal(called,false);
  });
  test('refuses non-data input, inherited prototypes, sparse or decorated arrays',()=>{
    const cyclic=fixture();cyclic.loop=cyclic;
    const inherited=fixture();Object.setPrototypeOf(inherited.header,{serverVersionNum:170006});
    const sparse=fixture();delete sparse.header.functions[0];
    const decorated=fixture();decorated.header.functions.extra=true;
    const symbol=fixture();symbol.header[Symbol('authority')]=true;
    for(const input of [null,undefined,{},cyclic,inherited,sparse,decorated,symbol])assert.throws(()=>check(input),refused('shape'));
  });
  test('returned receipt is immutable and old PG17 recovery gate remains closed',()=>{
    const result=check(fixture());assert.equal(Object.isFrozen(result),true);
    assert.throws(()=>{result.pg17Accepted=true;},TypeError);
    assert.throws(()=>assertTypeCensus(legacyInput),error=>error.reason==='profile-unexecuted');
  });
  test('a deeply nested malformed header refuses without exhausting the call stack',()=>{
    const input=fixture();let cursor=input.header;
    for(let index=0;index<10000;index++)cursor=cursor.extra={};
    assert.throws(()=>check(input),refused('input-depth'));
  });
  test('a wide malformed header refuses within the evidence node budget',()=>{
    const input=fixture();input.header.extra=Array(8192).fill(null);
    assert.throws(()=>check(input),refused('input-budget'));
  });
  test('input stays byte-equivalent on acceptance and refusal',()=>{
    for(const valid of [true,false]){
      const input=fixture();if(!valid)input.header.serverVersionNum=170005;
      const before=JSON.stringify(input);
      if(valid)check(input);else assert.throws(()=>check(input),refused('version'));
      assert.equal(JSON.stringify(input),before);
    }
  });
  for(const where of ['root','header','catalogs','attributes','function'])
    test('Proxy '+where+' refuses with zero introspection hooks',()=>{
      const input=fixture();let calls=0;
      const handler={getPrototypeOf(target){calls++;return Reflect.getPrototypeOf(target);},
        ownKeys(target){calls++;return Reflect.ownKeys(target);},
        getOwnPropertyDescriptor(target,key){calls++;return Reflect.getOwnPropertyDescriptor(target,key);},
        get(target,key,receiver){calls++;return Reflect.get(target,key,receiver);}};
      let subject=input;
      if(where==='root')subject=new Proxy(input,handler);
      if(where==='header')input.header=new Proxy(input.header,handler);
      if(where==='catalogs')input.header.catalogs=new Proxy(input.header.catalogs,handler);
      if(where==='attributes')input.header.catalogs.pg_type.attributes=new Proxy(input.header.catalogs.pg_type.attributes,handler);
      if(where==='function')input.header.functions[0]=new Proxy(input.header.functions[0],handler);
      assert.throws(()=>check(subject),refused('proxy'));assert.equal(calls,0);
    });
  test('revoked Proxy refuses without executing or throwing introspection errors',()=>{
    const {proxy,revoke}=Proxy.revocable({},{});revoke();
    const input=fixture();input.header=proxy;
    assert.throws(()=>check(input),refused('proxy'));
  });
  for(const [name,before,after,change,reason] of [
    ['Proxy guard',"if(types.isProxy(value))fail('proxy');",'',x=>{x.header=new Proxy(x.header,{});},'proxy'],
    ['version literal','header.serverVersionNum!==170006','header.serverVersionNum!==170005',x=>x.header.serverVersionNum=170005,'version'],
    ['catalog literal','header.catalogVersion!==202406281','header.catalogVersion!==202406282',x=>x.header.catalogVersion=202406282,'version'],
    ['version guard',"if(header.serverVersionNum!==170006||header.catalogVersion!==202406281)fail('version');",'',x=>x.header.serverVersionNum=180004,'version'],
    ['catalog guard',"if(!isDeepStrictEqual(header.catalogs,pg17Catalogs))fail('catalog-shape');",'',x=>x.header.catalogs.pg_constraint.attributes.pop(),'catalog-shape'],
    ['function guard',"if(!isDeepStrictEqual(header.functions,pg17AddressFunctions))fail('function-shape');",'',x=>x.header.functions[0].modes[5]='b','function-shape'],
    ['profile guard',"if(data.profileId!==pg17HeaderProfileId)fail('profile');",'',x=>x.profileId='pg17.6','profile'],
  ])test('compiled '+name+' mutant breaks a literal refusal',async()=>{
    const mutant=await compiled(before,after),input=fixture();change(input);
    assert.throws(()=>check(input),refused(reason));
    assert.throws(()=>assert.throws(()=>mutant.assertPg17Header(input),refused(reason)),error=>error.code==='ERR_ASSERTION');
  });
  for(const flag of ['fullRestoreApproved','pg17Accepted','runtimeApproved','productionApproved'])
    test('compiled '+flag+' authority escalation is detected',async()=>{
      const mutant=await compiled(flag+':false',flag+':true');
      assert.deepEqual(check(fixture()),receipt);
      assert.throws(()=>assert.deepEqual(mutant.assertPg17Header(fixture()),receipt),error=>error.code==='ERR_ASSERTION');
    });
  for(const [name,before,change,reason] of [
    ['depth',"if(depth>16)fail('input-depth');",x=>{let cursor=x.header;for(let i=0;i<10000;i++)cursor=cursor.extra={};},'input-depth'],
    ['node budget',"if(--budget.remaining<0)fail('input-budget');",x=>{x.header.extra=Array(8192).fill(null);},'input-budget'],
  ])test('compiled '+name+' mutant loses the bounded refusal',async()=>{
    const mutant=await compiled(before,''),input=fixture();change(input);
    assert.throws(()=>check(input),refused(reason));
    assert.throws(()=>assert.throws(()=>mutant.assertPg17Header(input),refused(reason)),error=>error.code==='ERR_ASSERTION');
  });
}
