import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const baseline=process.env.TYPE_CENSUS_BASELINE==='1';
const subject=baseline?await import('./media-restore-native-classes.contract.mjs')
  :await import('./media-restore-type-census.contract.mjs');
const columns={
  pg_type:'oid typname typnamespace typowner typlen typbyval typtype typcategory typispreferred typisdefined typdelim typrelid typsubscript typelem typarray typinput typoutput typreceive typsend typmodin typmodout typanalyze typalign typstorage typnotnull typbasetype typtypmod typndims typcollation typdefaultbin typdefault typacl'.split(' '),
  pg_enum:'oid enumtypid enumsortorder enumlabel'.split(' '),
  pg_range:'rngtypid rngsubtype rngmultitypid rngcollation rngsubopc rngcanonical rngsubdiff'.split(' '),
};
const clone=value=>structuredClone(value);
const refuses=reason=>error=>error?.code==='type_census_refused'&&error.reason===reason;
const header=()=>({serverVersionNum:180004,catalogVersion:202506291,columns:clone(columns),functions:[
  {name:'pg_get_object_address',kind:'f',inputs:['text','text[]','text[]'],output:'record'},
  {name:'pg_identify_object_as_address',kind:'f',inputs:['oid','oid','integer'],output:'record'},
]});
function row(oid='41',name='mood',kind='e',formattedName='fictional.'+name){
  const raw=Object.fromEntries(columns.pg_type.map(field=>[field,null]));
  Object.assign(raw,{oid,typname:name,typnamespace:'40',typtype:kind,typisdefined:true,typrelid:kind==='c'?'61':'0'});
  return {local:['pg_type',oid,0],address:{type:'type',object_names:[formattedName],object_args:[]},
    roundtrip:true,formattedName,raw,
    enums:kind==='e'?[{oid:'51',enumtypid:oid,enumsortorder:1,enumlabel:'calm'}]:[],
    ranges:['r','m'].includes(kind)?[{rngtypid:kind==='r'?oid:'71',rngsubtype:'23',
      rngmultitypid:kind==='m'?oid:'72',rngcollation:'0',rngsubopc:'1978',rngcanonical:'-',rngsubdiff:'-'}]:[]};
}
function input(rows=[]){
  const source={header:header(),profileId:'pg18.4-local',schemas:['fictional'],namespaces:[{oid:'40',nspname:'fictional'}],
    captureId:'source',origin:'live-before',sourceReceiptSha256:'0'.repeat(64),census:clone(rows)};
  return stamp({profileId:'pg18.4-local',liveBefore:source,
    reference:{...clone(source),captureId:'reference',origin:'reference'},
    restored:{...clone(source),captureId:'restored',origin:'restored'}});
}
function stamp(value){
  if(!baseline)for(const name of ['liveBefore','reference','restored'])value[name].sourceReceiptSha256=subject.typeSourceDigest(value.liveBefore);
  return value;
}
async function legacyObservation(){
  const {catalogColumns}=await import('./media-restore-native-classes.fixture.mjs');
  const source={header:{...header(),columns:clone(catalogColumns)},profileId:'pg18.4-local',schemas:['fictional'],
    captureId:'old-source',origin:'live-before',sourceReceiptSha256:'0'.repeat(64),census:[],records:[],
    dependencies:{edges:[],anchors:[]},residuals:['whole-catalog-registry-open','boundary-semantics-unproved']};
  source.sourceReceiptSha256=subject.nativeSourceDigest(source);
  return ()=>subject.assertNativeClassSubset({profileId:'pg18.4-local',liveBefore:source,
    reference:{...clone(source),captureId:'old-reference',origin:'reference'},
    restored:{...clone(source),captureId:'old-restored',origin:'restored'}});
}

test('desired standalone enum and generated array common loss refuses live membership',async()=>{
  const value=input([row(),row('42','_mood','b','fictional.mood[]')]);
  value.reference.census=value.restored.census=[];
  const check=baseline?await legacyObservation():()=>subject.assertTypeCensus(value);
  assert.throws(check,refuses('live-membership'));
});

if(!baseline){
  test('exact empty existing scope grants no broader authority',()=>{
    const actual=subject.assertTypeCensus(input());
    assert.deepEqual(actual,{scope:'type-census/v1',coverage:'explicit-schema-only',fullRestoreApproved:false,
      pg17Accepted:false,runtimeApproved:false,productionApproved:false,
      residuals:['all-other-native-classes','extension-scope-open']});
    assert.equal(Object.isFrozen(actual),true);assert.equal(Object.isFrozen(actual.residuals),true);
  });
  for(const kind of ['b','c','d','e','m','p','r'])test('intact '+kind+' membership refuses unsupported semantics with different copy OIDs',()=>{
    const value=input([row('41','owned',kind)]);
    for(const name of ['reference','restored']){
      const snapshot=value[name],entry=snapshot.census[0];
      snapshot.namespaces[0].oid=entry.raw.typnamespace='140';entry.local[1]=entry.raw.oid='141';
      for(const item of entry.enums)item.enumtypid='141';
      for(const item of entry.ranges)item[kind==='r'?'rngtypid':'rngmultitypid']='141';
    }
    assert.throws(()=>subject.assertTypeCensus(value),refuses('unsupported-semantics'));
  });
  for(const [name,reason,mutate] of [
    ['unknown profile','profile',v=>{v.profileId='pg19';}],
    ['PG17 unexecuted','profile-unexecuted',v=>{v.profileId='pg17.6';}],
    ['snapshot profile','version',v=>{v.reference.profileId='pg17.6';}],
    ['server version','version',v=>{v.reference.header.serverVersionNum=180003;}],
    ['catalog version','version',v=>{v.reference.header.catalogVersion=202506292;}],
    ['catalog shape','catalog-shape',v=>{v.reference.header.columns.pg_type.pop();}],
    ['range catalog shape','catalog-shape',v=>{v.reference.header.columns.pg_range.pop();}],
    ['function signature','function-shape',v=>{v.reference.header.functions[0].inputs[0]='integer';}],
    ['extra envelope','shape',v=>{v.extra=true;}],
    ['extra raw field','shape',v=>{v.reference.census[0].raw.unknown=true;}],
    ['missing enum field','shape',v=>{delete v.reference.census[0].enums[0].enumlabel;}],
    ['duplicate local','duplicate-census',v=>{v.reference.census.push(clone(v.reference.census[0]));}],
    ['duplicate native key','duplicate-census',v=>{const entry=clone(v.reference.census[0]);entry.local[1]=entry.raw.oid='81';entry.enums[0].enumtypid='81';v.reference.census.push(entry);}],
    ['count preserving native swap','live-membership',v=>{const entry=v.reference.census[0];entry.raw.typname='different';entry.formattedName=entry.address.object_names[0]='fictional.different';}],
    ['empty source nonempty copies','live-membership',v=>{v.liveBefore.census=[];stamp(v);}],
    ['unknown kind','type-kind',v=>{v.reference.census[0].raw.typtype='?';}],
    ['numeric local OID','address',v=>{v.reference.census[0].local[1]=41;}],
    ['leading zero OID','address',v=>{v.reference.census[0].local[1]='041';}],
    ['overflow OID','address',v=>{v.reference.census[0].local[1]='4294967296';}],
    ['zero namespace OID','address',v=>{v.reference.namespaces[0].oid='0';}],
    ['raw local mismatch','address',v=>{v.reference.census[0].raw.oid='91';}],
    ['subobject','address',v=>{v.reference.census[0].local[2]=1;}],
    ['wrong catalog','address',v=>{v.reference.census[0].local[0]='pg_proc';}],
    ['false inverse resolution','roundtrip',v=>{v.reference.census[0].roundtrip=false;}],
    ['formatted identity mismatch','address',v=>{v.reference.census[0].formattedName='fictional.different';}],
    ['two-part address','address',v=>{v.reference.census[0].address.object_names=['fictional','mood'];}],
    ['address arguments','address',v=>{v.reference.census[0].address.object_args=['integer'];}],
    ['unbound namespace','scope',v=>{v.reference.census[0].raw.typnamespace='91';}],
    ['missing namespace','scope',v=>{v.reference.namespaces=[];}],
    ['duplicate namespace','scope',v=>{v.reference.namespaces.push(clone(v.reference.namespaces[0]));}],
    ['empty scope','scope',v=>{v.reference.schemas=[];}],
    ['changed scope','scope',v=>{v.reference.schemas=['another'];v.reference.namespaces[0].nspname='another';}],
    ['wrong enum owner','binding',v=>{v.reference.census[0].enums[0].enumtypid='91';}],
    ['duplicate enum local','binding',v=>{v.reference.census[0].enums.push(clone(v.reference.census[0].enums[0]));}],
    ['duplicate enum label','binding',v=>{const item=clone(v.reference.census[0].enums[0]);item.oid='52';item.enumsortorder=2;v.reference.census[0].enums.push(item);}],
    ['duplicate enum rank','binding',v=>{const item=clone(v.reference.census[0].enums[0]);item.oid='52';item.enumlabel='happy';v.reference.census[0].enums.push(item);}],
    ['enum nonfinite rank','shape',v=>{v.reference.census[0].enums[0].enumsortorder=Infinity;}],
    ['non-enum labels','binding',v=>{v.reference.census[0].raw.typtype='b';}],
    ['replayed origin','provenance',v=>{v.reference.origin='live-before';}],
    ['same capture','provenance',v=>{v.reference.captureId=v.liveBefore.captureId;}],
    ['wrong source digest','provenance',v=>{v.reference.sourceReceiptSha256='a'.repeat(64);}],
  ])test('refuses '+name,()=>{const value=input([row()]);mutate(value);assert.throws(()=>subject.assertTypeCensus(value),refuses(reason));});
  for(const [name,kind,mutate] of [
    ['range missing','r',v=>{v.reference.census[0].ranges=[];}],
    ['range wrong owner','r',v=>{v.reference.census[0].ranges[0].rngtypid='91';}],
    ['multirange wrong owner','m',v=>{v.reference.census[0].ranges[0].rngmultitypid='91';}],
    ['duplicate range','r',v=>{v.reference.census[0].ranges.push(clone(v.reference.census[0].ranges[0]));}],
    ['non-range attached','b',v=>{v.reference.census[0].ranges=row('41','r','r').ranges;}],
  ])test('refuses '+name,()=>{const value=input([row('41','owned',kind)]);mutate(value);assert.throws(()=>subject.assertTypeCensus(value),refuses('binding'));});
  test('generated array identity remains visible and unsupported',()=>{
    const value=input([row('41','_mood','b','fictional.mood[]')]);
    assert.throws(()=>subject.assertTypeCensus(value),refuses('unsupported-semantics'));
  });
  test('legal empty enum label is retained without invented semantics',()=>{
    const value=input([row()]);for(const name of ['liveBefore','reference','restored'])value[name].census[0].enums[0].enumlabel='';stamp(value);
    assert.throws(()=>subject.assertTypeCensus(value),refuses('unsupported-semantics'));
  });
  for(const nested of [false,true])test('accessors refused with zero getter calls '+nested,()=>{
    const value=input([row()]);let calls=0;
    Object.defineProperty(nested?value.reference.census[0].raw:value,nested?'typtype':'profileId',{
      enumerable:true,get(){calls++;throw new Error('must never execute');}});
    assert.throws(()=>subject.assertTypeCensus(value),refuses('accessor'));assert.equal(calls,0);
  });
  test('raw evidence is not mutated on refusal or empty receipt',()=>{
    for(const value of [input(),input([row()])]){
      const before=clone(value);if(value.liveBefore.census.length)assert.throws(()=>subject.assertTypeCensus(value),refuses('unsupported-semantics'));
      else subject.assertTypeCensus(value);subject.typeSourceDigest(value.liveBefore);assert.deepEqual(value,before);
    }
  });
  test('cycles sparse symbols and nonplain values fail closed',()=>{
    for(const mutate of [v=>{v.reference.extra=v;},v=>{delete v.reference.census[0];},v=>{v[Symbol('extra')]=1;},v=>{Object.setPrototypeOf(v,null);}]){
      const value=input([row()]);mutate(value);assert.throws(()=>subject.assertTypeCensus(value),refuses('shape'));
    }
  });
  test('descriptor adapter exception is preserved',()=>{
    const error=new Error('adapter failed');assert.throws(()=>subject.assertTypeCensus(new Proxy({},{ownKeys(){throw error;}})),actual=>actual===error);
  });
  test('query inputs escape explicit namespaces and reject unsafe descriptors before construction',async()=>{
    const {typeCensusQueries}=await import('./media-restore-type-census.fixture.mjs');
    assert.throws(()=>typeCensusQueries('pg17.6',['fictional']),refuses('profile-unexecuted'));
    assert.throws(()=>typeCensusQueries('pg19',['fictional']),refuses('profile'));
    for(const scope of [[],[''],['bad\0'],['fictional','fictional'],[41]])
      assert.throws(()=>typeCensusQueries('pg18.4-local',scope),refuses('scope'));
    const scope=['fictional'];let calls=0;
    Object.defineProperty(scope,0,{get(){calls++;throw new Error('never execute');}});
    assert.throws(()=>typeCensusQueries('pg18.4-local',scope),refuses('accessor'));assert.equal(calls,0);
    const query=typeCensusQueries('pg18.4-local',["fictional'quoted"]);
    assert.deepEqual(Object.keys(query),['header','namespaces','census']);assert.equal(Object.isFrozen(query),true);
    assert.ok(query.namespaces.includes("ARRAY['fictional''quoted']::text[]"));
    assert.ok(query.census.includes("ARRAY['fictional''quoted']::text[]"));
  });
  for(const [name,edits,fixture,reason] of [
    ['source membership',[["for(const actual of memberships.slice(1)){","for(const actual of []){"]],()=>{
      const value=input([row()]);value.reference.census=value.restored.census=[];return value;
    },'live-membership'],
    ['unsupported semantics',[["if(memberships[0].length)fail('unsupported-semantics');",'']],()=>input([row()]),'unsupported-semantics'],
    ['version literal',[["header.serverVersionNum!==180004","header.serverVersionNum!==180003"]],()=>{
      const value=input();for(const name of ['liveBefore','reference','restored'])value[name].header.serverVersionNum=180003;return stamp(value);
    },'version'],
    ['missing namespace',[["if(!equal([...namespaceNames].sort(),[...snapshot.schemas].sort()))fail('scope');",'']],()=>{
      const value=input();value.reference.namespaces=[];return value;
    },'scope'],
    ['enum owner',[["item.enumtypid!==local[1]||",'']],()=>{
      const value=input([row()]);value.reference.census[0].enums[0].enumtypid='91';return value;
    },'binding'],
    ['range owner',[["if(item[raw.typtype==='r'?'rngtypid':'rngmultitypid']!==local[1])fail('binding');",'']],()=>{
      const value=input([row('41','owned','r')]);value.reference.census[0].ranges[0].rngtypid='91';return value;
    },'binding'],
  ])test('compiled '+name+' mutant breaks independently literal refusal oracle',async()=>{
    let source=await readFile(new URL('./media-restore-type-census.contract.mjs',import.meta.url),'utf8');
    for(const [before,after] of edits){assert.equal(source.split(before).length-1,1);source=source.replace(before,after);}
    source=source.replace("'./media-restore-type-census.fixture.mjs'",JSON.stringify(new URL('./media-restore-type-census.fixture.mjs',import.meta.url).href));
    const mutant=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const value=fixture();assert.throws(()=>subject.assertTypeCensus(value),refuses(reason));
    assert.throws(()=>assert.throws(()=>mutant.assertTypeCensus(value),refuses(reason)),error=>
      error?.code==='ERR_ASSERTION'&&(error.message==='Missing expected exception.'||error.message.includes('validation function')));
  });
}
