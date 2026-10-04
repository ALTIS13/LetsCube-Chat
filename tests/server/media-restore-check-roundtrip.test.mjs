import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const url=new URL('./media-restore-check-roundtrip.fixture.mjs',import.meta.url);
const subject=await import(url);
const refused=reason=>error=>error.code==='check_roundtrip_refused'&&error.reason===reason;

test('strict source bytes cannot be replaced by converged parser bytes',()=>{
  assert.deepEqual(subject.classifyCheckDumps({source:Buffer.from('CHECK ((quantity >= 0))\r\n'),
    reference1:Buffer.from('CHECK (quantity >= 0)\n'),reference2:Buffer.from('CHECK (quantity >= 0)\n')}),{
    scope:'check-roundtrip-diagnostic/v1',sourceRepresentable:false,referenceConverged:true,
    strictOperator:'REFUSED',fullRestoreApproved:false,pg17Accepted:false,runtimeApproved:false,productionApproved:false,
  });
});

test('PG17 is unexecuted, not an alias of the PG18 diagnostic',()=>{
  assert.throws(()=>subject.assertCheckDiagnostic({profileId:'pg17.6'}),refused('profile-unexecuted'));
});

const attributeNames='attrelid attname atttypid attlen attnum atttypmod attndims attbyval attalign attstorage attcompression attnotnull atthasdef atthasmissing attidentity attgenerated attisdropped attislocal attinhcount attcollation attstattarget attacl attoptions attfdwoptions attmissingval'.split(' ');
const constraintNames='oid conname connamespace contype condeferrable condeferred conenforced convalidated conrelid contypid conindid conparentid confrelid confupdtype confdeltype confmatchtype conislocal coninhcount connoinherit conperiod conkey confkey conpfeqop conppeqop conffeqop confdelsetcols conexclop conbin'.split(' ');
const native=(type,...object_names)=>({type,object_names,object_args:[]});
function snapshot(origin,captureId,holes=false) {
  const names=holes?['........pg.dropped.1........','id','quantity','........pg.dropped.4........','alternate']:['id','quantity','alternate'];
  const attributes=names.map((attname,index)=>{
    const dropped=attname.startsWith('........');
    return {raw:{attrelid:'16384',attname,atttypid:dropped?'0':'23',attlen:4,attnum:index+1,atttypmod:-1,
      attndims:0,attbyval:true,attalign:'i',attstorage:'p',attcompression:'',attnotnull:false,atthasdef:false,
      atthasmissing:false,attidentity:'',attgenerated:'',attisdropped:dropped,attislocal:true,attinhcount:0,
      attcollation:'0',attstattarget:null,attacl:null,attoptions:null,attfdwoptions:null,attmissingval:null},
      address:dropped?null:native('table column','check_roundtrip_fixture','inventory',attname),roundtrip:!dropped,
      typeAddress:dropped?null:native('type','integer')};
  });
  const checkAddress=native('table constraint','check_roundtrip_fixture','inventory','quantity_check');
  const binding=native('table column','check_roundtrip_fixture','inventory','quantity');
  return {header:{serverVersionNum:180004,catalogVersion:202506291,columns:{pg_attribute:[...attributeNames],pg_constraint:[...constraintNames]}},
    profileId:'pg18.4-local',captureId,origin,sourceReceiptSha256:'0'.repeat(64),inputDumpSha256:origin==='live-before'?null:'1'.repeat(64),
    catalog:{tables:[{raw:{oid:'16384',relkind:'r',relispartition:false,relhassubclass:false,reltoastrelid:'0',relchecks:1},
      address:native('table','check_roundtrip_fixture','inventory'),roundtrip:true}],attributes,
      constraints:[{raw:{oid:'16385',conname:'quantity_check',connamespace:'16380',contype:'c',condeferrable:false,
        condeferred:false,conenforced:true,convalidated:true,conrelid:'16384',contypid:'0',conindid:'0',conparentid:'0',
        confrelid:'0',confupdtype:' ',confdeltype:' ',confmatchtype:' ',conislocal:true,coninhcount:0,connoinherit:false,
        conperiod:false,conkey:[holes?3:2],confkey:null,conpfeqop:null,conppeqop:null,conffeqop:null,confdelsetcols:null,
        conexclop:null,conbin:'fictional raw tree retained without interpretation'},definition:'CHECK ((quantity >= 0))',
        address:checkAddress,roundtrip:true}],dependencies:[{raw:{deptype:'a'},shared:false,from:checkAddress,to:binding,
          fromRoundtrip:true,toRoundtrip:true}]}};
}
function trio() {
  const source=snapshot('live-before','source',true);
  const sourceReceiptSha256=subject.checkSourceDigest(source);
  source.sourceReceiptSha256=sourceReceiptSha256;
  const reference1=snapshot('live-ddl-reference','reference1'),reference2=snapshot('reference1-ddl-reference','reference2');
  reference1.sourceReceiptSha256=reference2.sourceReceiptSha256=sourceReceiptSha256;
  return {profileId:'pg18.4-local',source,reference1,reference2};
}
const expectedReceipt={scope:'check-roundtrip-diagnostic/v1',coverage:'one-fictional-integer-check',
  originAuthority:'consistency-only',fullRestoreApproved:false,pg17Accepted:false,runtimeApproved:false,productionApproved:false};
test('INTEGER holes retain raw local rank while only active native bindings project',()=>{
  const input=trio(),before=structuredClone(input);
  assert.deepEqual(subject.assertCheckDiagnostic(input),expectedReceipt);
  assert.deepEqual(input,before,'no raw row, node tree or dropped-slot rewriting');
  assert.deepEqual(input.source.catalog.attributes.map(x=>x.raw.attnum),[1,2,3,4,5]);
  assert.deepEqual(input.source.catalog.attributes.filter(x=>x.raw.attisdropped).map(x=>x.raw.attnum),[1,4]);
  assert.deepEqual(input.source.catalog.attributes.filter(x=>x.raw.attisdropped).map(x=>x.raw.atttypid),['0','0']);
  assert.deepEqual(input.source.catalog.constraints[0].raw.conkey,[3]);
  assert.deepEqual(input.reference1.catalog.constraints[0].raw.conkey,[2]);
});
test('PG18 INTEGER native address uses one SQL type name, not an invented schema/name tuple',()=>{
  const input=trio();
  for(const snapshot of [input.source,input.reference1,input.reference2]){
    for(const entry of snapshot.catalog.attributes)if(!entry.raw.attisdropped)entry.typeAddress={type:'type',object_names:['integer'],object_args:[]};
  }
  const digest=subject.checkSourceDigest(input.source);
  for(const snapshot of [input.source,input.reference1,input.reference2])snapshot.sourceReceiptSha256=digest;
  assert.deepEqual(subject.assertCheckDiagnostic(input),expectedReceipt);
});
for(const [name,mutate,reason] of [
  ['constant1',x=>x.catalog.constraints[0].definition='CHECK ((quantity >= 1))','check-definition'],
  ['operator>',x=>x.catalog.constraints[0].definition='CHECK ((quantity > 0))','check-definition'],
  ['drop CHECK from both',x=>{x.catalog.constraints=[];x.catalog.tables[0].raw.relchecks=0;},'check-membership'],
  ['validated false',x=>{x.catalog.constraints[0].raw.convalidated=false;x.catalog.constraints[0].definition='CHECK ((quantity >= 0)) NOT VALID';},'check-validation'],
  ['alternate column',x=>{x.catalog.constraints[0].raw.conkey=[3];x.catalog.constraints[0].definition='CHECK ((alternate >= 0))';},'check-binding'],
  ['missing native dependency',x=>x.catalog.dependencies=[],'check-dependency'],
  ['NULL inverse',x=>x.catalog.constraints[0].roundtrip=null,'roundtrip'],
  ['unexpected raw field',x=>x.catalog.constraints[0].raw.future=true,'shape'],
])test('independent diagnostic reaches '+name+' even if strict DDL is already refused',()=>{
  const input=trio();assert.deepEqual(subject.assertCheckDiagnostic(input),expectedReceipt);
  assert.equal(subject.classifyCheckDumps({source:Buffer.from('source'),reference1:Buffer.from('parser'),reference2:Buffer.from('parser')}).strictOperator,'REFUSED');
  for(const snapshot of [input.reference1,input.reference2])mutate(snapshot);
  assert.throws(()=>subject.assertCheckDiagnostic(input),refused(reason));
});
for(const origin of ['backup','replayed'])test('reference1 '+origin+' origin independently refuses',()=>{
  const input=trio();input.reference1.origin=origin;
  assert.throws(()=>subject.assertCheckDiagnostic(input),refused('origin-consistency'));
});
test('copied IDs and changed source digest are not a distinct-source receipt',()=>{
  const ids=trio();ids.reference2.captureId=ids.reference1.captureId;
  assert.throws(()=>subject.assertCheckDiagnostic(ids),refused('origin-consistency'));
  const hashes=trio();hashes.reference1.sourceReceiptSha256='9'.repeat(64);
  assert.throws(()=>subject.assertCheckDiagnostic(hashes),refused('origin-consistency'));
});
test('an accessor never executes during diagnostic refusal',()=>{
  const input=trio();let calls=0;
  Object.defineProperty(input.reference1.catalog.constraints[0],'definition',{enumerable:true,get(){calls++;throw new Error('must not execute');}});
  assert.throws(()=>subject.assertCheckDiagnostic(input),refused('accessor'));assert.equal(calls,0);
});
for(const [name,value] of [['zero','0'],['leading zero','016384'],['over uint32','4294967296'],['numeric',16384]]){
  for(const target of ['table','check'])test('raw '+target+' object OID refuses literal '+name,()=>{
    const input=trio(),catalog=input.reference1.catalog;
    if(target==='table'){
      catalog.tables[0].raw.oid=value;
      for(const entry of catalog.attributes)entry.raw.attrelid=value;
      catalog.constraints[0].raw.conrelid=value;
    }else catalog.constraints[0].raw.oid=value;
    assert.throws(()=>subject.assertCheckDiagnostic(input),refused('address'));
  });
}
test('native constants are literal pinned and schema header is never learned from subject',()=>{
  assert.deepEqual(subject.catalogColumns,{pg_attribute:attributeNames,pg_constraint:constraintNames});
  assert.equal(subject.assertCheckRoundtripHeader(trio().source.header),true);
  for(const change of [header=>header.serverVersionNum=170006,header=>header.catalogVersion=1,header=>header.columns.pg_constraint.pop()]){
    const input=trio();change(input.reference1.header);
    assert.throws(()=>subject.assertCheckDiagnostic(input),error=>error.code==='check_roundtrip_refused'&&['version','catalog-shape'].includes(error.reason));
  }
});
test('byte oracle retains names, parentheses, order, ACL and line endings',()=>{
  const source=Buffer.from('CHECK ((quantity >= 0));\r\nOWNER alice;\r\nGRANT SELECT;\r\n');
  for(const other of [Buffer.from(source.toString().replace('((quantity >= 0))','(quantity >= 0)')),
    Buffer.from(source.toString().replace('alice','bob')),Buffer.from(source.toString().replace('GRANT SELECT;\r\n','')),
    Buffer.from(source.toString().replaceAll('\r\n','\n')),Buffer.from('GRANT SELECT;\r\nCHECK ((quantity >= 0));\r\nOWNER alice;\r\n')]){
    assert.throws(()=>subject.assertCheckSourceDumps({source,reference1:other,reference2:other}),refused('source-ddl'));
  }
  assert.equal(subject.assertCheckSourceDumps({source,reference1:Buffer.from(source),reference2:Buffer.from(source)}).strictOperator,'BYTE_EXACT_DIAGNOSTIC_ONLY');
  assert.throws(()=>subject.classifyCheckDumps({source:'text',reference1:source,reference2:source}),refused('dump-bytes'));
});
async function compiled(before,after) {
  let source=await readFile(url,'utf8');assert.equal(source.split(before).length-1,1);
  source=source.replace(before,after);
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const missing=error=>error.code==='ERR_ASSERTION'&&error.message==='Missing expected exception.';
for(const [name,before,after,mutate,reason] of [
  ['definition comparison',"if(actual.definition!==source.definition)fail('check-definition');",'',
    x=>{x.catalog.constraints[0].definition='CHECK ((quantity >= 1))';},'check-definition'],
  ['validation comparison',"if(actual.validated!==source.validated)fail('check-validation');",'',
    x=>{x.catalog.constraints[0].raw.convalidated=false;},'check-validation'],
])test('compiled '+name+' omission cannot satisfy the desired specific oracle',async()=>{
  const mutant=await compiled(before,after),input=trio();for(const x of [input.reference1,input.reference2])mutate(x);
  assert.deepEqual(mutant.assertCheckDiagnostic(input),expectedReceipt);
  assert.throws(()=>assert.throws(()=>mutant.assertCheckDiagnostic(input),refused(reason)),missing);
});
test('compiled membership bypass reaches WRONG check-validation refusal; exact membership oracle is RED',async()=>{
  const mutant=await compiled("if(constraints.length!==1||table.raw.relchecks!==1)fail('check-membership');",
    "if(constraints.length!==1||table.raw.relchecks!==1)return {absent:true};");
  const input=trio();for(const x of [input.reference1,input.reference2]){x.catalog.constraints=[];x.catalog.tables[0].raw.relchecks=0;}
  assert.throws(()=>mutant.assertCheckDiagnostic(input),refused('check-validation'));
  assert.throws(()=>assert.throws(()=>mutant.assertCheckDiagnostic(input),refused('check-membership')),error=>
    error.code==='ERR_ASSERTION'&&error.operator==='throws'&&error.actual?.code==='check_roundtrip_refused'&&
    error.actual.reason==='check-validation'&&error.message.startsWith('The validation function is expected to return "true".'));
});
test('compiled strict-byte omission makes desired source refusal RED',async()=>{
  const mutant=await compiled("if(!result.sourceRepresentable)fail('source-ddl');",'');
  const input={source:Buffer.from('source'),reference1:Buffer.from('parser'),reference2:Buffer.from('parser')};
  assert.throws(()=>assert.throws(()=>mutant.assertCheckSourceDumps(input),refused('source-ddl')),missing);
});
