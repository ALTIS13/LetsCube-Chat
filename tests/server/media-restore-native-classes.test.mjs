import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {catalogColumns,nativeClassQueries} from './media-restore-native-classes.fixture.mjs';

const baseline = process.env.NATIVE_CLASS_BASELINE === '1';
const subject = baseline ? {assertNativeClassSubset: () => ({coverage:'selected-only'})}
  : await import('./media-restore-native-classes.contract.mjs');
const refuses = reason => error => error?.code === 'native_class_refused' && error.reason === reason;
const clone=value=>structuredClone(value);
function input() {
  const header={serverVersionNum:180004,catalogVersion:202506291,columns:clone(catalogColumns),functions:[
    {name:'pg_get_object_address',kind:'f',inputs:['text','text[]','text[]'],output:'record'},
    {name:'pg_identify_object_as_address',kind:'f',inputs:['oid','oid','integer'],output:'record'}]};
  const empty={header,profileId:'pg18.4-local',schemas:['fictional'],captureId:'source',origin:'live-before',sourceReceiptSha256:'0'.repeat(64),
    census:[],records:[],dependencies:{edges:[],anchors:[]},residuals:['whole-catalog-registry-open','boundary-semantics-unproved']};
  const result={profileId:'pg18.4-local',liveBefore:empty,reference:{...clone(empty),captureId:'reference',origin:'reference'},restored:{...clone(empty),captureId:'restored',origin:'restored'}};
  return stamp(result);
}
function stamp(value){
  const hash=subject.nativeSourceDigest(value.liveBefore);
  for(const name of ['liveBefore','reference','restored'])value[name].sourceReceiptSha256=hash;
  return value;
}
function tableInput() {
  const value=input();
  const raw=Object.fromEntries(catalogColumns.pg_class.map(name=>[name,null]));
  Object.assign(raw,{oid:'41',relname:'item',relnamespace:'42',relkind:'r',relispartition:false,relhassubclass:false,
    reloftype:'0',relhasrules:false,relpersistence:'p',relrowsecurity:false,relforcerowsecurity:false,relreplident:'d'});
  for(const name of ['liveBefore','reference','restored']){
    value[name].census=[['pg_class','41',0]];
    value[name].records=[{class:'relation',local:['pg_class','41',0],address:{type:'table',object_names:['fictional','item'],object_args:[]},raw:clone(raw),definition:null,roundtrip:true,vectors:{}}];
    value[name].dependencies.anchors=[{local:['pg_namespace','42',0],address:{type:'schema',object_names:['fictional'],object_args:[]},definition:null}];
  }
  return stamp(value);
}

test('desired accessor refusal has independently literal zero getter calls', () => {
  let calls=0;
  const input={};
  Object.defineProperty(input,'profileId',{enumerable:true,get(){calls++;return 'pg18.4-local';}});
  assert.throws(() => subject.assertNativeClassSubset(input),refuses('accessor'));
  assert.equal(calls,0);
});

if(!baseline){
  test('literal selected receipt never grants broader authority',()=>{
    const result=subject.assertNativeClassSubset(input());
    assert.deepEqual(result,{scope:'constraint-trigger-bindings/v1',coverage:'selected-only',fullRestoreApproved:false,
      pg17Accepted:false,runtimeApproved:false,productionApproved:false});
    assert.equal(Object.isFrozen(result),true);
  });
  test('nonempty selected table positive without absolute OID equality',()=>{
    const value=tableInput();
    for(const name of ['reference','restored']){
      value[name].census[0][1]='51';value[name].records[0].local[1]='51';value[name].records[0].raw.oid='51';
    }
    assert.equal(subject.assertNativeClassSubset(value).coverage,'selected-only');
  });
  const negatives=[
    ['unknown profile','profile',value=>{value.profileId='pg19';}],
    ['unexecuted PG17 profile','profile-unexecuted',value=>{value.profileId='pg17.6';}],
    ['mixed server version','version',value=>{value.reference.header.serverVersionNum=170006;}],
    ['catalog version drift','version',value=>{value.restored.header.catalogVersion=202506292;}],
    ['catalog column omission','catalog-shape',value=>{value.reference.header.columns.pg_trigger.pop();}],
    ['native function signature drift','function-shape',value=>{value.reference.header.functions[0].inputs[0]='integer';}],
    ['extra envelope field','shape',value=>{value.extra=true;}],
    ['unknown record class','unsupported-class',value=>{value.reference.records[0].class='policy';}],
    ['extra raw field','shape',value=>{value.reference.records[0].raw.unreviewed=true;}],
    ['duplicate census','duplicate-census',value=>{value.reference.census.push(clone(value.reference.census[0]));}],
    ['duplicate record','duplicate-record',value=>{value.reference.records.push(clone(value.reference.records[0]));}],
    ['missing census','census-records',value=>{value.reference.census=[];}],
    ['missing record','census-records',value=>{value.reference.records=[];}],
    ['common loss in BOTH copies','live-membership',value=>{for(const name of ['reference','restored']){value[name].census=[];value[name].records=[];}}],
    ['false native roundtrip','roundtrip',value=>{value.reference.records[0].roundtrip=false;}],
    ['null native address','shape',value=>{value.reference.records[0].address=null;}],
    ['numeric OID coercion','address',value=>{value.reference.census[0][1]=41;}],
    ['zero object OID','address',value=>{value.reference.census[0][1]='0';}],
    ['unknown census catalog','unsupported-class',value=>{value.reference.census.push(['pg_policy','75',0]);}],
    ['partition relation','unsupported-relation',value=>{value.reference.records[0].raw.relispartition=true;}],
    ['shared capture identity','provenance',value=>{value.reference.captureId=value.liveBefore.captureId;}],
    ['copied origin label','provenance',value=>{value.restored.origin='live-before';}],
    ['forged receipt digest','provenance',value=>{value.reference.sourceReceiptSha256='a'.repeat(64);} ],
    ['scope drift','scope',value=>{value.reference.schemas=['different'];}],
    ['erased residual limits','coverage',value=>{value.reference.residuals=[];}],
    ['unsupported endpoint','unsupported-endpoint',value=>{value.reference.dependencies.anchors[0].local[0]='pg_policy';}],
    ['duplicate native anchor','duplicate-anchor',value=>{value.reference.dependencies.anchors.push(clone(value.reference.dependencies.anchors[0]));}],
    ['unknown dependency kind','dependency-kind',value=>{value.reference.dependencies.edges.push({from:['pg_class','41',0],to:['pg_namespace','42',0],deptype:'?',shared:false});}],
    ['native dependency omission','binding',value=>{value.reference.dependencies.anchors=[];}],
  ];
  for(const [name,reason,mutate] of negatives)test('refuses '+name,()=>{
    const value=tableInput();mutate(value);assert.throws(()=>subject.assertNativeClassSubset(value),refuses(reason));
  });
  test('retains physical TOAST refusal rather than ignoring generated identities',()=>{
    const value=input();
    for(const name of ['liveBefore','reference','restored'])value[name].dependencies.anchors=[{
      local:['pg_class','49',0],address:{type:'toast table',object_names:['pg_toast','pg_toast_45'],object_args:[]},definition:null}];
    stamp(value);
    assert.throws(()=>subject.assertNativeClassSubset(value),refuses('unsupported-physical-dependency'));
  });
  test('nested getter refusal does not invoke assertion-throwing getter',()=>{
    const value=tableInput();let calls=0;
    Object.defineProperty(value.reference.records[0].raw,'relkind',{enumerable:true,get(){calls++;assert.fail('getter assertion must not be the refusal');}});
    assert.throws(()=>subject.assertNativeClassSubset(value),refuses('accessor'));assert.equal(calls,0);
  });
  test('unexpected descriptor adapter error survives without permission/refusal mapping',()=>{
    const error=new Error('independent adapter assertion');
    assert.throws(()=>subject.assertNativeClassSubset(new Proxy({},{ownKeys(){throw error;}})),actual=>actual===error);
  });
  test('does not mutate input and raw evidence',()=>{
    const value=tableInput(),before=clone(value);subject.assertNativeClassSubset(value);assert.deepEqual(value,before);
  });
  test('sparse arrays and cyclic input refuse',()=>{
    const sparse=tableInput();delete sparse.reference.census[0];assert.throws(()=>subject.assertNativeClassSubset(sparse),refuses('shape'));
    const cycle=tableInput();cycle.reference.extra=cycle;assert.throws(()=>subject.assertNativeClassSubset(cycle),refuses('shape'));
  });
  test('fixture rejects unknown profile before SQL construction',()=>{
    assert.throws(()=>nativeClassQueries('pg17.6',['fictional']),refuses('profile-unexecuted'));
    assert.throws(()=>nativeClassQueries('pg19',['fictional']),refuses('profile'));
    const queries=nativeClassQueries('pg18.4-local',["fictional'quoted"]);
    assert.ok(queries.census.includes("fictional''quoted"));assert.equal(Object.isFrozen(queries),true);
  });
  for(const [name,reason,edits,mutate] of [
    ['live comparison','live-membership',[["for(const actual of projections.slice(1)){","for(const actual of []){"]],value=>{
      for(const name of ['reference','restored']){value[name].census=[];value[name].records=[];}
    }],
    ['duplicate census','duplicate-census',[["if(census.has(id))fail('duplicate-census');",'']],value=>{
      value.reference.census.push(clone(value.reference.census[0]));
    }],
    ['unknown profile','profile',[
      ["if(args.profileId!==implementedProfile)fail(args.profileId==='pg17.6'?'profile-unexecuted':'profile');",''],
      ["if(snapshots.some(x=>x.profileId!==args.profileId))fail('version');",''],
    ],value=>{value.profileId='pg19';}],
  ])test('compiled '+name+' omission must make literal refusal oracle RED',async()=>{
    let source=await readFile(new URL('./media-restore-native-classes.contract.mjs',import.meta.url),'utf8');
    for(const [before,after] of edits){assert.equal(source.split(before).length-1,1);source=source.replace(before,after);}
    source=source.replace("'./media-restore-native-classes.fixture.mjs'",JSON.stringify(new URL('./media-restore-native-classes.fixture.mjs',import.meta.url).href));
    const mutant=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const value=tableInput();mutate(value);
    assert.throws(()=>subject.assertNativeClassSubset(value),refuses(reason));
    assert.throws(()=>assert.throws(()=>mutant.assertNativeClassSubset(value),refuses(reason)),
      error=>error?.code==='ERR_ASSERTION'&&error.message==='Missing expected exception.');
  });
}
