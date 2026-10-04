import {createHash} from 'node:crypto';
import {typeColumns,profileId as implementedProfile} from './media-restore-type-census.fixture.mjs';

const fail=reason=>{throw Object.assign(new Error('type_census_refused:'+reason),{code:'type_census_refused',reason});};
const key=value=>JSON.stringify(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(name=>[name,canonical(value[name])])):value;
const equal=(a,b)=>key(canonical(a))===key(canonical(b));
const fields=(value,names)=>{
  if(!value||Array.isArray(value)||typeof value!=='object'||!equal(Object.keys(value).sort(),[...names].sort()))fail('shape');
};
function copy(value,seen=new Set()){
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
const text=value=>typeof value==='string'&&!!value&&!value.includes('\0');
function project(snapshot){
  fields(snapshot,['header','profileId','schemas','namespaces','captureId','origin','sourceReceiptSha256','census']);
  const header=snapshot.header;
  fields(header,['serverVersionNum','catalogVersion','columns','functions']);
  if(header.serverVersionNum!==180004||header.catalogVersion!==202506291)fail('version');
  if(!equal(header.columns,typeColumns))fail('catalog-shape');
  if(!equal(header.functions,[
    {name:'pg_get_object_address',kind:'f',inputs:['text','text[]','text[]'],output:'record'},
    {name:'pg_identify_object_as_address',kind:'f',inputs:['oid','oid','integer'],output:'record'},
  ]))fail('function-shape');
  if(!Array.isArray(snapshot.schemas)||!snapshot.schemas.length||snapshot.schemas.some(name=>!text(name))||
    new Set(snapshot.schemas).size!==snapshot.schemas.length||!Array.isArray(snapshot.namespaces))fail('scope');
  const namespaces=new Map(),namespaceNames=new Set();
  for(const namespace of snapshot.namespaces){
    fields(namespace,['oid','nspname']);oid(namespace.oid);
    if(!snapshot.schemas.includes(namespace.nspname)||namespaces.has(namespace.oid)||namespaceNames.has(namespace.nspname))fail('scope');
    namespaces.set(namespace.oid,namespace.nspname);namespaceNames.add(namespace.nspname);
  }
  if(!equal([...namespaceNames].sort(),[...snapshot.schemas].sort()))fail('scope');
  if(!text(snapshot.captureId)||typeof snapshot.sourceReceiptSha256!=='string'||!/^[0-9a-f]{64}$/.test(snapshot.sourceReceiptSha256))fail('provenance');
  if(!Array.isArray(snapshot.census))fail('shape');
  const locals=new Set(),members=new Set(),enumOids=new Set();
  for(const entry of snapshot.census){
    fields(entry,['local','address','roundtrip','formattedName','raw','enums','ranges']);
    fields(entry.raw,typeColumns.pg_type);
    const {local,raw,address}=entry;
    if(!Array.isArray(local)||local.length!==3||local[0]!=='pg_type'||local[2]!==0)fail('address');
    oid(local[1]);oid(raw.typnamespace);
    if(raw.oid!==local[1])fail('address');
    if(!['b','c','d','e','m','p','r'].includes(raw.typtype))fail('type-kind');
    if(!namespaces.has(raw.typnamespace))fail('scope');
    if(entry.roundtrip!==true)fail('roundtrip');
    fields(address,['type','object_names','object_args']);
    if(!text(raw.typname)||!text(entry.formattedName)||address.type!=='type'||
      !Array.isArray(address.object_names)||address.object_names.length!==1||address.object_names[0]!==entry.formattedName||
      !Array.isArray(address.object_args)||address.object_args.length!==0)fail('address');
    const localKey=key(local),memberKey=key([raw.typtype,address.type,address.object_names,address.object_args]);
    if(locals.has(localKey)||members.has(memberKey))fail('duplicate-census');
    locals.add(localKey);members.add(memberKey);
    if(!Array.isArray(entry.enums)||!Array.isArray(entry.ranges))fail('shape');
    if(raw.typtype!=='e'&&entry.enums.length)fail('binding');
    const labels=new Set(),ranks=new Set();
    for(const item of entry.enums){
      fields(item,typeColumns.pg_enum);oid(item.oid);oid(item.enumtypid);
      if(item.enumtypid!==local[1]||enumOids.has(item.oid)||typeof item.enumlabel!=='string'||item.enumlabel.includes('\0')||
        typeof item.enumsortorder!=='number'||labels.has(item.enumlabel)||ranks.has(item.enumsortorder))fail('binding');
      enumOids.add(item.oid);labels.add(item.enumlabel);ranks.add(item.enumsortorder);
    }
    const ranged=raw.typtype==='r'||raw.typtype==='m';
    if(entry.ranges.length!==(ranged?1:0))fail('binding');
    for(const item of entry.ranges){
      fields(item,typeColumns.pg_range);oid(item.rngtypid);oid(item.rngmultitypid);oid(item.rngsubtype);oid(item.rngsubopc);
      if(item[raw.typtype==='r'?'rngtypid':'rngmultitypid']!==local[1])fail('binding');
    }
  }
  return [...members].sort();
}
export function typeSourceDigest(input){
  const snapshot=copy(input);delete snapshot.sourceReceiptSha256;
  return createHash('sha256').update(key(canonical(snapshot))).digest('hex');
}
export function assertTypeCensus(input){
  const args=copy(input);
  fields(args,['profileId','liveBefore','reference','restored']);
  if(args.profileId!==implementedProfile)fail(args.profileId==='pg17.6'?'profile-unexecuted':'profile');
  const snapshots=[args.liveBefore,args.reference,args.restored],memberships=snapshots.map(project);
  if(snapshots.some(snapshot=>snapshot.profileId!==args.profileId))fail('version');
  if(!equal(snapshots.map(snapshot=>snapshot.origin),['live-before','reference','restored'])||
    new Set(snapshots.map(snapshot=>snapshot.captureId)).size!==3)fail('provenance');
  const sourceHash=typeSourceDigest(args.liveBefore);
  if(snapshots.some(snapshot=>snapshot.sourceReceiptSha256!==sourceHash))fail('provenance');
  if(snapshots.some(snapshot=>!equal(snapshot.schemas,args.liveBefore.schemas)))fail('scope');
  // Detect common loss before refusing the unimplemented payload semantics.
  for(const actual of memberships.slice(1)){
    if(!equal(actual,memberships[0]))fail('live-membership');
  }
  if(memberships[0].length)fail('unsupported-semantics');
  return Object.freeze({scope:'type-census/v1',coverage:'explicit-schema-only',fullRestoreApproved:false,
    pg17Accepted:false,runtimeApproved:false,productionApproved:false,
    residuals:Object.freeze(['all-other-native-classes','extension-scope-open'])});
}
