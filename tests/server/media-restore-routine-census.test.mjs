import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const baseline=process.env.ROUTINE_CENSUS_BASELINE==='1';
const subject=baseline ? await import('./media-restore-native-classes.contract.mjs')
  : await import('./media-restore-routine-census.contract.mjs');
const columns='oid proname pronamespace proowner prolang procost prorows provariadic prosupport prokind prosecdef proleakproof proisstrict proretset provolatile proparallel pronargs pronargdefaults prorettype proargtypes proallargtypes proargmodes proargnames proargdefaults protrftypes prosrc probin prosqlbody proconfig proacl'.split(' ');
const refuses=reason=>error=>error?.code==='routine_census_refused'&&error.reason===reason;
const clone=value=>structuredClone(value);
const header=()=>({serverVersionNum:180004,catalogVersion:202506291,columns:{pg_proc:[...columns]},functions:[
  {name:'pg_get_object_address',kind:'f',inputs:['text','text[]','text[]'],output:'record'},
  {name:'pg_identify_object_as_address',kind:'f',inputs:['oid','oid','integer'],output:'record'},
]});
function row(oid='41',name='standalone',kind='f') {
  const raw=Object.fromEntries(columns.map(field=>[field,null]));
  Object.assign(raw,{oid,proname:name,pronamespace:'40',prokind:kind});
  return {local:['pg_proc',oid,0],address:{type:kind==='p'?'procedure':kind==='a'?'aggregate':'function',
    object_names:['fictional',name],object_args:[]},roundtrip:true,raw};
}
function input(rows=[]) {
  const source={header:header(),profileId:'pg18.4-local',schemas:['fictional'],captureId:'source',origin:'live-before',
    sourceReceiptSha256:'0'.repeat(64),census:clone(rows)};
  return stamp({profileId:'pg18.4-local',liveBefore:source,reference:{...clone(source),captureId:'reference',origin:'reference'},
    restored:{...clone(source),captureId:'restored',origin:'restored'}});
}
function stamp(value) {
  if(!baseline)for(const name of ['liveBefore','reference','restored'])value[name].sourceReceiptSha256=subject.routineSourceDigest(value.liveBefore);
  return value;
}
function legacyObservation() {
  const oldColumns={};
  // This characterization asks the real selected-only contract about its actual empty scope.
  return import('./media-restore-native-classes.fixture.mjs').then(({catalogColumns})=>{
    Object.assign(oldColumns,clone(catalogColumns));
    const source={header:{...header(),columns:oldColumns},profileId:'pg18.4-local',schemas:['fictional'],captureId:'old-source',
      origin:'live-before',sourceReceiptSha256:'0'.repeat(64),census:[],records:[],dependencies:{edges:[],anchors:[]},
      residuals:['whole-catalog-registry-open','boundary-semantics-unproved']};
    source.sourceReceiptSha256=subject.nativeSourceDigest(source);
    const value={profileId:'pg18.4-local',liveBefore:source,reference:{...clone(source),captureId:'old-reference',origin:'reference'},
      restored:{...clone(source),captureId:'old-restored',origin:'restored'}};
    return ()=>subject.assertNativeClassSubset(value);
  });
}

test('desired common standalone function and procedure loss refuses source membership',async()=>{
  const value=input([row(),row('42','standalone_procedure','p')]);
  for(const name of ['reference','restored'])value[name].census=[];
  const check=baseline?await legacyObservation():()=>subject.assertRoutineCensus(value);
  assert.throws(check,refuses('live-membership'));
});

if(!baseline) {
  test('empty exact scope grants no broader authority',()=>{
    const actual=subject.assertRoutineCensus(input());
    assert.deepEqual(actual,{scope:'routine-census/v1',coverage:'explicit-schema-only',fullRestoreApproved:false,
      pg17Accepted:false,runtimeApproved:false,productionApproved:false,residuals:['all-other-native-classes','extension-scope-open']});
    assert.equal(Object.isFrozen(actual),true);assert.equal(Object.isFrozen(actual.residuals),true);
  });
  for(const kind of ['f','p','a','w'])test('intact '+kind+' membership never admits unimplemented semantics',()=>{
    const value=input([row('41','standalone',kind)]);
    for(const name of ['reference','restored']){value[name].census[0].local[1]='51';value[name].census[0].raw.oid='51';}
    assert.throws(()=>subject.assertRoutineCensus(value),refuses('unsupported-semantics'));
  });
  const cases=[
    ['unknown profile','profile',v=>{v.profileId='pg19';}],
    ['PG17 unexecuted','profile-unexecuted',v=>{v.profileId='pg17.6';}],
    ['snapshot mixed profile','version',v=>{v.reference.profileId='pg19';}],
    ['server version','version',v=>{v.reference.header.serverVersionNum=180003;}],
    ['catalog version','version',v=>{v.restored.header.catalogVersion=202506292;}],
    ['missing catalog field','catalog-shape',v=>{v.reference.header.columns.pg_proc.pop();}],
    ['signature drift','function-shape',v=>{v.reference.header.functions[0].inputs[0]='integer';}],
    ['extra envelope','shape',v=>{v.extra=true;}],
    ['missing census','shape',v=>{delete v.reference.census;}],
    ['extra raw field','shape',v=>{v.reference.census[0].raw.extra=true;}],
    ['missing raw field','shape',v=>{delete v.reference.census[0].raw.prosrc;}],
    ['duplicate census','duplicate-census',v=>{v.reference.census.push(clone(v.reference.census[0]));}],
    ['duplicate native key with distinct local oid','duplicate-census',v=>{const r=clone(v.reference.census[0]);r.local[1]=r.raw.oid='71';v.reference.census.push(r);}],
    ['same count wrong native key','live-membership',v=>{v.reference.census[0].raw.proname=v.reference.census[0].address.object_names[1]='different';}],
    ['source empty but copies nonempty','live-membership',v=>{v.liveBefore.census=[];stamp(v);}],
    ['unknown kind','routine-kind',v=>{v.reference.census[0].raw.prokind='?';}],
    ['wrong address type','address',v=>{v.reference.census[0].address.type='table';}],
    ['numeric oid','address',v=>{v.reference.census[0].local[1]=41;}],
    ['zero oid','address',v=>{v.reference.census[0].local[1]='0';}],
    ['oid out of range','address',v=>{v.reference.census[0].local[1]='4294967296';}],
    ['oid leading zero','address',v=>{v.reference.census[0].local[1]='041';}],
    ['raw local oid mismatch','address',v=>{v.reference.census[0].raw.oid='71';}],
    ['subobject unsupported','address',v=>{v.reference.census[0].local[2]=1;}],
    ['wrong catalog','address',v=>{v.reference.census[0].local[0]='pg_type';}],
    ['null inverse resolution','roundtrip',v=>{v.reference.census[0].roundtrip=null;}],
    ['false inverse resolution','roundtrip',v=>{v.reference.census[0].roundtrip=false;}],
    ['null address','shape',v=>{v.reference.census[0].address=null;}],
    ['out of scope','scope',v=>{v.reference.census[0].address.object_names[0]='another';}],
    ['empty scope','scope',v=>{v.reference.schemas=[];}],
    ['duplicate scope','scope',v=>{v.reference.schemas=['fictional','fictional'];}],
    ['scope drift','scope',v=>{v.reference.schemas=['another'];v.reference.census[0].address.object_names[0]='another';}],
    ['null byte scope','scope',v=>{v.reference.schemas=['fictional\0'];}],
    ['same capture identity','provenance',v=>{v.reference.captureId=v.liveBefore.captureId;}],
    ['wrong origin','provenance',v=>{v.reference.origin='live-before';}],
    ['wrong digest','provenance',v=>{v.reference.sourceReceiptSha256='a'.repeat(64);}],
  ];
  for(const [name,reason,mutate] of cases)test('refuses '+name,()=>{
    const value=input([row()]);mutate(value);assert.throws(()=>subject.assertRoutineCensus(value),refuses(reason));
  });
  for(const nested of [false,true])test('accessor refusal with zero calls '+nested,()=>{
    const value=input([row()]);let calls=0;
    Object.defineProperty(nested?value.reference.census[0].raw:value,nested?'prokind':'profileId',{
      enumerable:true,get(){calls++;throw new Error('must never run');}});
    assert.throws(()=>subject.assertRoutineCensus(value),refuses('accessor'));assert.equal(calls,0);
  });
  test('adapter exception is preserved rather than disguised as refusal',()=>{
    const error=new Error('descriptor adapter failed');
    assert.throws(()=>subject.assertRoutineCensus(new Proxy({},{ownKeys(){throw error;}})),actual=>actual===error);
  });
  test('cycles, sparse, symbolic and nonplain inputs refuse',()=>{
    for(const mutate of [v=>{v.reference.extra=v;},v=>{delete v.reference.census[0];},v=>{v[Symbol('x')]=1;},v=>{Object.setPrototypeOf(v,null);}]){
      const value=input([row()]);mutate(value);assert.throws(()=>subject.assertRoutineCensus(value),refuses('shape'));
    }
  });
  test('empty check and digest preserve supplied evidence',()=>{
    const value=input(),before=clone(value);subject.assertRoutineCensus(value);subject.routineSourceDigest(value.liveBefore);assert.deepEqual(value,before);
  });
  test('query scope is explicit, escaped and does not execute accessors',async()=>{
    const {routineCensusQueries}=await import('./media-restore-routine-census.fixture.mjs');
    assert.throws(()=>routineCensusQueries('pg17.6',['fictional']),refuses('profile-unexecuted'));
    assert.throws(()=>routineCensusQueries('pg19',['fictional']),refuses('profile'));
    for(const scope of [[],['fictional','fictional'],['bad\0'],[''],[23]])assert.throws(()=>routineCensusQueries('pg18.4-local',scope),refuses('scope'));
    const scope=['fictional'];let calls=0;
    Object.defineProperty(scope,0,{get(){calls++;throw new Error('never run');}});
    assert.throws(()=>routineCensusQueries('pg18.4-local',scope),refuses('accessor'));assert.equal(calls,0);
    const actual=routineCensusQueries('pg18.4-local',["fictional'quoted"]);
    assert.equal(Object.isFrozen(actual),true);
    assert.deepEqual(Object.keys(actual),['header','census']);
    assert.ok(actual.census.includes("fictional''quoted"));
  });
  for(const [name,edits,fixture,reason,redKind] of [
    ['membership',[["for(const actual of memberships.slice(1)){","for(const actual of []){"]],()=>{const v=input([row()]);v.reference.census=v.restored.census=[];return v;},'live-membership','wrong-refusal'],
    ['unsupported semantics',[["if(memberships[0].length)fail('unsupported-semantics');",'']],()=>input([row()]),'unsupported-semantics','missing'],
    ['duplicate',[["if(locals.has(localKey)||members.has(memberKey))fail('duplicate-census');",'']],()=>{const v=input([row()]);v.reference.census.push(clone(v.reference.census[0]));return v;},'duplicate-census','wrong-refusal'],
    ['version literal',[["header.serverVersionNum!==180004","header.serverVersionNum!==180003"]],()=>{const v=input();for(const n of ['liveBefore','reference','restored'])v[n].header.serverVersionNum=180003;return stamp(v);},'version','missing'],
  ])test('compiled '+name+' mutant breaks literal oracle',async()=>{
    let source=await readFile(new URL('./media-restore-routine-census.contract.mjs',import.meta.url),'utf8');
    for(const [before,after] of edits){assert.equal(source.split(before).length-1,1);source=source.replace(before,after);}
    source=source.replace("'./media-restore-routine-census.fixture.mjs'",JSON.stringify(new URL('./media-restore-routine-census.fixture.mjs',import.meta.url).href));
    const mutant=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const value=fixture();assert.throws(()=>subject.assertRoutineCensus(value),refuses(reason));
    assert.throws(()=>assert.throws(()=>mutant.assertRoutineCensus(value),refuses(reason)),error=>
      error?.code==='ERR_ASSERTION'&&(redKind==='missing'?error.message==='Missing expected exception.':error.message.includes('validation function')));
  });
}
