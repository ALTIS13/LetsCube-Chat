import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const permissive={
  planRoleNameBootstrap:()=>({statements:[],scope:'role-name-order-only',
    fullRestoreApproved:false,runtimeApproved:false,productionApproved:false}),
  validateRoleNameBootstrap:()=>({scope:'role-name-order-only',
    fullRestoreApproved:false,runtimeApproved:false,productionApproved:false}),
};
const subject=process.env.MEDIA_ROLE_ORDER_BASELINE==='1'?permissive:
  await import('./media-restore-role-order.contract.mjs');
const pristine=[{oid:10,name:'fixture_control'},{oid:3373,name:'pg_monitor'},
  {oid:16383,name:'fixture_fixed_edge'}];
const source=[...pristine.map(row=>({...row})),{oid:16384,name:'zz_fixture'},{oid:17000,name:'postgres'},
  {oid:19000,name:'aa_fixture'},{oid:20000,name:'Quote "\u0416"'}];
const input=()=>structuredClone({source,pristine,bootstrapName:'fixture_control'});
const restored=()=>source.map(row=>({...row,oid:row.oid>=16384?row.oid+100000:row.oid}));
const validatorInput=()=>({...input(),restored:restored()});
const refusal=error=>error.code==='ERR_ASSERTION';
const authority={scope:'role-name-order-only',fullRestoreApproved:false,
  runtimeApproved:false,productionApproved:false};
const statements=['CREATE ROLE "zz_fixture";','CREATE ROLE "postgres";',
  'CREATE ROLE "aa_fixture";','CREATE ROLE "Quote ""\u0416""";'];

function bootstrapOracle(module) {
  const spec=input();spec.bootstrapName='postgres';
  assert.throws(()=>module.planRoleNameBootstrap(spec),refusal);
}
function rankOracle(module) {
  const spec=validatorInput();
  [spec.restored[3].name,spec.restored[5].name]=[spec.restored[5].name,spec.restored[3].name];
  assert.throws(()=>module.validateRoleNameBootstrap(spec),refusal);
}

test('desired refusal: captured bootstrap is not a later postgres role',()=>bootstrapOracle(subject));
test('original numeric rank emits only serial safely quoted role-name statements',()=>{
  assert.deepEqual(subject.planRoleNameBootstrap(input()),{...authority,statements});
});
test('complete relative rank permits different absolute user OIDs',()=>{
  assert.deepEqual(subject.validateRoleNameBootstrap(validatorInput()),authority);
});
test('a bootstrap-only source needs no CREATE statements',()=>{
  assert.deepEqual(subject.planRoleNameBootstrap({source:pristine,pristine,
    bootstrapName:'fixture_control'}),{...authority,statements:[]});
});
test('planner does not mutate frozen input or expose mutable statements',()=>{
  const spec=input(),before=structuredClone(spec);
  for(const rows of [spec.source,spec.pristine]){rows.forEach(Object.freeze);Object.freeze(rows);}
  Object.freeze(spec);
  const plan=subject.planRoleNameBootstrap(spec);
  assert.deepEqual(spec,before);
  assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.statements));
  assert.throws(()=>plan.statements.push('unexpected'),TypeError);
});
test('validator refuses actual name-set equality with wrong relative rank',()=>rankOracle(subject));

for(const [label,change] of [
  ['string OID',s=>s.source[3].oid='16384'],
  ['fractional OID',s=>s.source[3].oid=16384.5],
  ['zero OID',s=>s.source[0].oid=0],
  ['negative OID',s=>s.source[0].oid=-1],
  ['out of uint32',s=>s.source[6].oid=4294967296],
  ['NaN OID',s=>s.source[3].oid=NaN],
  ['duplicate OID',s=>s.source[4].oid=16384],
  ['duplicate name',s=>s.source[4].name='zz_fixture'],
  ['unsorted OIDs',s=>s.source.reverse()],
  ['extra record key',s=>s.source[3].password='forbidden-projection-field'],
  ['missing record key',s=>delete s.source[3].name],
])test('projection refuses '+label,()=>{
  const spec=input();change(spec);
  assert.throws(()=>subject.planRoleNameBootstrap(spec),refusal);
});

for(const [label,name] of [
  ['empty',''],['NUL','bad\0name'],['64 ASCII bytes','x'.repeat(64)],
  ['64 UTF8 bytes','\u0416'.repeat(32)],['unpaired high surrogate','\uD800'],
  ['unpaired low surrogate','\uDC00'],['reserved user prefix','pg_fixture_user'],
])test('role name refuses '+label,()=>{
  const spec=input();spec.source[3].name=name;
  assert.throws(()=>subject.planRoleNameBootstrap(spec),refusal);
});
test('63 ASCII bytes and 62 UTF8 bytes preserve exact identity',()=>{
  const spec=input();spec.source[3].name='x'.repeat(63);spec.source[4].name='\u0416'.repeat(31);
  const plan=subject.planRoleNameBootstrap(spec);
  assert.equal(plan.statements[0],'CREATE ROLE "'+'x'.repeat(63)+'";');
  assert.equal(plan.statements[1],'CREATE ROLE "'+'\u0416'.repeat(31)+'";');
});
test('SQL-looking punctuation remains a single quoted identifier without normalization',()=>{
  const spec=input();spec.source[3].name='x"; SELECT 99; -- ';
  assert.equal(subject.planRoleNameBootstrap(spec).statements[0],'CREATE ROLE "x""; SELECT 99; -- ";');
});

for(const [label,change] of [
  ['missing bootstrap',s=>s.source.shift()],
  ['renamed bootstrap',s=>s.source[0].name='other_bootstrap'],
  ['wrong pristine bootstrap',s=>s.pristine[0].name='other_bootstrap'],
  ['missing predefined role',s=>s.pristine.splice(1,1)],
  ['extra predefined role',s=>s.source.splice(1,0,{oid:20,name:'unknown_fixed'})],
  ['changed fixed OID',s=>s.source[1].oid=3374],
  ['preexisting user/QA',s=>s.pristine.push({oid:16384,name:'zz_fixture'})],
])test('fixed inventory refuses '+label,()=>{
  const spec=input();change(spec);
  assert.throws(()=>subject.planRoleNameBootstrap(spec),refusal);
});
for(const [label,change] of [
  ['missing role',s=>s.restored.pop()],
  ['extra QA',s=>s.restored.push({oid:200000,name:'fixture_qa'})],
  ['renamed bootstrap',s=>s.restored[0].name='other_bootstrap'],
  ['changed fixed identity',s=>s.restored[1].oid=3374],
  ['user below literal 16384',s=>s.restored[3].oid=16382],
])test('post-name validator refuses '+label,()=>{
  const spec=validatorInput();change(spec);
  assert.throws(()=>subject.validateRoleNameBootstrap(spec),refusal);
});
test('closed options and native arrays reject extensions, holes and accessors without invocation',()=>{
  for(const change of [
    s=>s.fullRestoreApproved=true,
    s=>s.source.extra=true,
    s=>delete s.source[4],
    s=>Object.defineProperty(s.source[3],'name',{get(){assert.fail('getter must not run');},enumerable:true}),
    s=>Object.defineProperty(s,'bootstrapName',{get(){assert.fail('getter must not run');},enumerable:true}),
  ]){const spec=input();change(spec);assert.throws(()=>subject.planRoleNameBootstrap(spec),refusal);}
});
test('unexpected inspection failures survive rather than becoming a permission refusal',()=>{
  const primary=new Error('independent inspection failure'),spec=input();
  spec.source[3]=new Proxy(spec.source[3],{getPrototypeOf(){throw primary;}});
  assert.throws(()=>subject.planRoleNameBootstrap(spec),error=>error===primary);
});

async function compile(target,replacement) {
  const text=await readFile(new URL('./media-restore-role-order.contract.mjs',import.meta.url),'utf8');
  assert.equal(text.split(target).length,2,'one actual compiled mutation target');
  return import('data:text/javascript;base64,'+Buffer.from(text.replace(target,replacement)).toString('base64'));
}
function missingRefusal(work) {
  assert.throws(work,error=>error.code==='ERR_ASSERTION'&&error.message==='Missing expected exception (refusal).');
}
test('compiled bootstrap guard omission makes the literal refusal oracle RED',async()=>{
  const mutant=await compile("assert.equal(bootstrap.name,bootstrapName,'captured bootstrap name differs');",'');
  missingRefusal(()=>bootstrapOracle(mutant));
  bootstrapOracle(subject);
});
test('compiled relative-rank guard omission makes the literal refusal oracle RED',async()=>{
  const mutant=await compile("assert.deepEqual(restored.map(row=>row.name),source.map(row=>row.name),'restored role-name rank differs');",'');
  missingRefusal(()=>rankOracle(mutant));
  rankOracle(subject);
});
test('compiled alphabetic statement order fails independent literal original-rank statements',async()=>{
  const mutant=await compile('source.filter(row=>row.oid>=normalOid).map(row=>',
    'source.filter(row=>row.oid>=normalOid).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).map(row=>');
  assert.throws(()=>assert.deepEqual(mutant.planRoleNameBootstrap(input()).statements,
    ['CREATE ROLE "zz_fixture";','CREATE ROLE "postgres";','CREATE ROLE "aa_fixture";','CREATE ROLE "Quote ""\u0416""";']),
  refusal);
});
test('compiled predefined omission fails independent missing-fixed refusal oracle',async()=>{
  const mutant=await compile("assert.deepEqual(source.filter(row=>row.oid<normalOid),pristine,'predefined role inventory differs');",'');
  const spec=input();spec.source.splice(1,0,{oid:20,name:'unknown_fixed'});
  missingRefusal(()=>assert.throws(()=>mutant.planRoleNameBootstrap(spec),refusal));
  assert.throws(()=>subject.planRoleNameBootstrap(spec),refusal);
});
test('compiled FirstNormalObjectId change fails literal 16384 boundary positive',async()=>{
  const mutant=await compile('const normalOid=16384;','const normalOid=16385;');
  assert.throws(()=>mutant.planRoleNameBootstrap(input()),refusal);
  assert.equal(subject.planRoleNameBootstrap(input()).statements[0],'CREATE ROLE "zz_fixture";');
});
test('compiled byte-limit widening makes literal 64-byte refusal oracle RED',async()=>{
  const mutant=await compile("Buffer.byteLength(value,'utf8')<=63","Buffer.byteLength(value,'utf8')<=64");
  const spec=input();spec.source[3].name='x'.repeat(64);
  missingRefusal(()=>assert.throws(()=>mutant.planRoleNameBootstrap(spec),refusal));
});
test('compiled quote-escape omission fails literal quoted Unicode statement',async()=>{
  const mutant=await compile("row.name.replaceAll('\"','\"\"')",'row.name');
  assert.throws(()=>assert.equal(mutant.planRoleNameBootstrap(input()).statements[3],
    'CREATE ROLE "Quote ""\u0416""";'),refusal);
});
for(const flag of ['fullRestoreApproved','runtimeApproved','productionApproved'])
test('compiled '+flag+' widening fails literal false authority',async()=>{
  const mutant=await compile(flag+':false',flag+':true');
  for(const value of [mutant.planRoleNameBootstrap(input()),mutant.validateRoleNameBootstrap(validatorInput())])
    assert.throws(()=>assert.equal(value[flag],false),refusal);
});
