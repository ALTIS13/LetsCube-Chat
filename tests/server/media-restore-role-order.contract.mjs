import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

// PG17.6 src/include/access/transam.h: FirstNormalObjectId. Not creation chronology.
const normalOid=16384;
function fields(value,keys) {
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value),'closed role projection object required');
  const prototype=Object.getPrototypeOf(value);
  assert.ok(prototype===Object.prototype||prototype===null,'plain role projection object required');
  const actual=Reflect.ownKeys(value);
  assert.ok(actual.length===keys.length&&actual.every(key=>keys.includes(key)),'unexpected role projection fields');
  const descriptors=Object.getOwnPropertyDescriptors(value),copy={};
  for(const key of keys) {
    const descriptor=descriptors[key];
    assert.ok(descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.enumerable,'data fields required');
    copy[key]=descriptor.value;
  }
  return copy;
}
function name(value) {
  assert.ok(typeof value==='string'&&value.length>0&&!value.includes('\0'),'invalid role name');
  assert.ok(Buffer.byteLength(value,'utf8')<=63,'role name exceeds native byte limit');
  assert.equal(Buffer.from(value,'utf8').toString('utf8'),value,'role name must preserve Unicode identity');
  return value;
}
function projection(value) {
  assert.ok(Array.isArray(value),'native role array required');
  const keys=Reflect.ownKeys(value);
  assert.ok(keys.length===value.length+1&&keys.includes('length'),'dense native role array required');
  const rows=[],names=new Set();let previous=0;
  for(let index=0;index<value.length;index++) {
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    assert.ok(descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.enumerable,'native role data row required');
    const row=fields(descriptor.value,['oid','name']);
    assert.ok(typeof row.oid==='number'&&Number.isInteger(row.oid)&&row.oid>0&&row.oid<=4294967295,'invalid numeric native OID');
    assert.ok(row.oid>previous,'native OIDs must be unique and strictly ascending');
    name(row.name);assert.ok(!names.has(row.name),'native role names must be unique');
    names.add(row.name);previous=row.oid;rows.push(row);
  }
  return rows;
}
function bootstrapIdentity(rows,bootstrapName) {
  const bootstrap=rows.find(row=>row.oid===10);
  assert.ok(bootstrap,'captured bootstrap OID10 is missing');
  assert.equal(bootstrap.name,bootstrapName,'captured bootstrap name differs');
}
function context(input,keys) {
  const spec=fields(input,keys),source=projection(spec.source),pristine=projection(spec.pristine);
  const bootstrapName=name(spec.bootstrapName);
  bootstrapIdentity(source,bootstrapName);bootstrapIdentity(pristine,bootstrapName);
  assert.ok(pristine.every(row=>row.oid<normalOid),'unexpected preexisting user role');
  assert.deepEqual(source.filter(row=>row.oid<normalOid),pristine,'predefined role inventory differs');
  assert.ok(source.every(row=>row.oid<normalOid||!row.name.startsWith('pg_')),'reserved user role name');
  return {spec,source,pristine,bootstrapName};
}
function authority() {
  return {scope:'role-name-order-only',fullRestoreApproved:false,runtimeApproved:false,productionApproved:false};
}
export function planRoleNameBootstrap(input) {
  const {source}=context(input,['source','pristine','bootstrapName']);
  const statements=source.filter(row=>row.oid>=normalOid).map(row=>
    'CREATE ROLE "'+row.name.replaceAll('"','""')+'";');
  return Object.freeze({...authority(),statements:Object.freeze(statements)});
}
export function validateRoleNameBootstrap(input) {
  const {spec,source,pristine,bootstrapName}=context(input,['source','pristine','bootstrapName','restored']);
  const restored=projection(spec.restored);
  bootstrapIdentity(restored,bootstrapName);
  assert.deepEqual(restored.filter(row=>row.oid<normalOid),pristine,'restored predefined role inventory differs');
  assert.equal(restored.length,source.length,'restored role-name set differs');
  assert.deepEqual(new Set(restored.map(row=>row.name)),new Set(source.map(row=>row.name)),'restored role-name set differs');
  assert.deepEqual(restored.map(row=>row.name),source.map(row=>row.name),'restored role-name rank differs');
  return Object.freeze(authority());
}
