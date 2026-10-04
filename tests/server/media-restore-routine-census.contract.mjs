import {createHash} from 'node:crypto';
import {routineColumns,profileId as implementedProfile} from './media-restore-routine-census.fixture.mjs';

const fail=reason=>{throw Object.assign(new Error('routine_census_refused:'+reason),{code:'routine_census_refused',reason});};
const key=value=>JSON.stringify(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(name=>[name,canonical(value[name])])):value;
const equal=(a,b)=>key(canonical(a))===key(canonical(b));
const fields=(value,names)=>{
  if(!value||Array.isArray(value)||typeof value!=='object'||!equal(Object.keys(value).sort(),[...names].sort()))fail('shape');
};
function copy(value,seen=new Set()) {
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('shape');return value;}
  if(typeof value!=='object'||seen.has(value))fail('shape');
  seen.add(value);
  const array=Array.isArray(value),descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype))fail('shape');
  for(const descriptor of Object.values(descriptors))if(!('value' in descriptor))fail('accessor');
  if(Reflect.ownKeys(value).some(name=>typeof name!=='string'))fail('shape');
  let result;
  if(array){
    const length=descriptors.length.value;
    if(Object.keys(descriptors).length!==length+1)fail('shape');
    result=[];
    for(let i=0;i<length;i++){if(!descriptors[i])fail('shape');result.push(copy(descriptors[i].value,seen));}
  }else result=Object.fromEntries(Object.entries(descriptors).map(([name,d])=>[name,copy(d.value,seen)]));
  seen.delete(value);return result;
}
const oid=value=>{
  if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value)||Number(value)>4294967295)fail('address');
};
function scope(value) {
  if(!Array.isArray(value)||!value.length||value.some(name=>typeof name!=='string'||!name||name.includes('\0'))||new Set(value).size!==value.length)fail('scope');
}
function project(snapshot) {
  fields(snapshot,['header','profileId','schemas','captureId','origin','sourceReceiptSha256','census']);
  const header=snapshot.header;
  fields(header,['serverVersionNum','catalogVersion','columns','functions']);
  if(header.serverVersionNum!==180004||header.catalogVersion!==202506291)fail('version');
  if(!equal(header.columns,{pg_proc:routineColumns}))fail('catalog-shape');
  if(!equal(header.functions,[
    {name:'pg_get_object_address',kind:'f',inputs:['text','text[]','text[]'],output:'record'},
    {name:'pg_identify_object_as_address',kind:'f',inputs:['oid','oid','integer'],output:'record'},
  ]))fail('function-shape');
  scope(snapshot.schemas);
  if(typeof snapshot.captureId!=='string'||!snapshot.captureId||typeof snapshot.sourceReceiptSha256!=='string'||!/^[0-9a-f]{64}$/.test(snapshot.sourceReceiptSha256))fail('provenance');
  if(!Array.isArray(snapshot.census))fail('shape');
  const locals=new Set(),members=new Set();
  for(const entry of snapshot.census){
    fields(entry,['local','address','roundtrip','raw']);
    fields(entry.raw,routineColumns);
    const local=entry.local,raw=entry.raw,address=entry.address;
    if(!Array.isArray(local)||local.length!==3||local[0]!=='pg_proc'||local[2]!==0)fail('address');
    oid(local[1]);oid(raw.pronamespace);
    if(raw.oid!==local[1])fail('address');
    if(!['f','p','a','w'].includes(raw.prokind))fail('routine-kind');
    if(entry.roundtrip!==true)fail('roundtrip');
    fields(address,['type','object_names','object_args']);
    if(address.type!==({f:'function',p:'procedure',a:'aggregate',w:'function'}[raw.prokind])||
      !Array.isArray(address.object_names)||address.object_names.length!==2||!Array.isArray(address.object_args)||
      [...address.object_names,...address.object_args].some(name=>typeof name!=='string'||!name||name.includes('\0'))||
      raw.proname!==address.object_names[1])fail('address');
    if(!snapshot.schemas.includes(address.object_names[0]))fail('scope');
    const localKey=key(local),memberKey=key([raw.prokind,address.type,address.object_names,address.object_args]);
    if(locals.has(localKey)||members.has(memberKey))fail('duplicate-census');
    locals.add(localKey);members.add(memberKey);
  }
  return [...members].sort();
}
export function routineSourceDigest(input) {
  const snapshot=copy(input);
  delete snapshot.sourceReceiptSha256;
  return createHash('sha256').update(key(canonical(snapshot))).digest('hex');
}
export function assertRoutineCensus(input) {
  const args=copy(input);
  fields(args,['profileId','liveBefore','reference','restored']);
  if(args.profileId!==implementedProfile)fail(args.profileId==='pg17.6'?'profile-unexecuted':'profile');
  const snapshots=[args.liveBefore,args.reference,args.restored];
  const memberships=snapshots.map(project);
  if(snapshots.some(snapshot=>snapshot.profileId!==args.profileId))fail('version');
  if(!equal(snapshots.map(snapshot=>snapshot.origin),['live-before','reference','restored'])||new Set(snapshots.map(snapshot=>snapshot.captureId)).size!==3)fail('provenance');
  const sourceHash=routineSourceDigest(args.liveBefore);
  if(snapshots.some(snapshot=>snapshot.sourceReceiptSha256!==sourceHash))fail('provenance');
  if(snapshots.some(snapshot=>!equal(snapshot.schemas,args.liveBefore.schemas)))fail('scope');
  // Equal replay copies cannot conceal a member omitted from the source census.
  for(const actual of memberships.slice(1)){
    if(!equal(actual,memberships[0]))fail('live-membership');
  }
  if(memberships[0].length)fail('unsupported-semantics');
  return Object.freeze({scope:'routine-census/v1',coverage:'explicit-schema-only',fullRestoreApproved:false,
    pg17Accepted:false,runtimeApproved:false,productionApproved:false,
    residuals:Object.freeze(['all-other-native-classes','extension-scope-open'])});
}
