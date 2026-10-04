import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as subject from './media-restore-role-order.contract.mjs';

const pristine=[{oid:10,name:'fixture_control'}];
const input=()=>({source:[...pristine.map(row=>({...row})),{oid:16384,name:'fixture_user'}],
  pristine:pristine.map(row=>({...row})),bootstrapName:'fixture_control'});

function oracle(module,kind) {
  const spec=input();let calls=0,error;
  if(kind==='field')Object.defineProperty(spec,'bootstrapName',{
    enumerable:true,get(){calls++;return 'fixture_control';}
  });
  else Object.defineProperty(spec.source,'1',{
    enumerable:true,get(){calls++;return {oid:16384,name:'fixture_user'};}
  });
  try{module.planRoleNameBootstrap(spec);}catch(value){error=value;}
  assert.equal(calls,0,'role projection accessor must not execute');
  assert.equal(error?.code,'ERR_ASSERTION','accessor projection must refuse');
}

async function compile(kind) {
  let text=await readFile(new URL('./media-restore-role-order.contract.mjs',import.meta.url),'utf8');
  const changes=kind==='field'?[
    ["assert.ok(descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.enumerable,'data fields required');",''],
    ['copy[key]=descriptor.value;','copy[key]=value[key];'],
  ]:[
    ["assert.ok(descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.enumerable,'native role data row required');",''],
    ["fields(descriptor.value,['oid','name'])","fields(value[index],['oid','name'])"],
  ];
  for(const [from,to] of changes){
    assert.equal(text.split(from).length,2,'one actual compiled mutation target');
    text=text.replace(from,to);
  }
  return import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
}

for(const kind of ['field','array-row']){
  test('data-only '+kind+' does not invoke a valid-returning getter',async()=>{
    const module=process.env.MEDIA_ROLE_ACCESSOR_BASELINE==='1'?await compile(kind):subject;
    oracle(module,kind);
  });
  test('compiled '+kind+' reader mutant fails the independent zero-invocation oracle',async()=>{
    const mutant=await compile(kind);
    assert.throws(()=>oracle(mutant,kind),error=>error?.code==='ERR_ASSERTION'
      &&error.message.includes('role projection accessor must not execute'));
    oracle(subject,kind);
  });
}
