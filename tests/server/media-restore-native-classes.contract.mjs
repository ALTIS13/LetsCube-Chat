import {createHash} from 'node:crypto';
import {catalogColumns,profileId as implementedProfile} from './media-restore-native-classes.fixture.mjs';

const fail=reason=>{throw Object.assign(new Error('native_class_refused:'+reason),{code:'native_class_refused',reason});};
const key=value=>JSON.stringify(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(name=>[name,canonical(value[name])])):value;
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
    if(Object.keys(descriptors).length!==value.length+1)fail('shape');
    result=[];
    for(let i=0;i<value.length;i++){if(!descriptors[i])fail('shape');result.push(copy(descriptors[i].value,seen));}
  }else result=Object.fromEntries(Object.entries(descriptors).map(([name,d])=>[name,copy(d.value,seen)]));
  seen.delete(value);return result;
}
// PostgreSQL to_jsonb preserves oid values as decimal strings, unlike attnum.
const uint=value=>{if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value)||Number(value)>4294967295)fail('address');};
function local(value) {
  if(!Array.isArray(value)||value.length!==3||typeof value[0]!=='string')fail('address');
  uint(value[1]);if(!Number.isSafeInteger(value[2])||value[2]<0)fail('address');
  return key(value);
}
function address(value) {
  fields(value,['type','object_names','object_args']);
  if(typeof value.type!=='string'||!value.type||!Array.isArray(value.object_names)||!value.object_names.length||!Array.isArray(value.object_args))fail('address');
  if([...value.object_names,...value.object_args].some(x=>typeof x!=='string'||!x||x.includes('\0')))fail('address');
  return ['native',value.type,value.object_names,value.object_args];
}
export function assertNativeClassHeader(input,id=implementedProfile) {
  const header=copy(input);
  if(id!==implementedProfile)fail(id==='pg17.6'?'profile-unexecuted':'profile');
  fields(header,['serverVersionNum','catalogVersion','columns','functions']);
  if(header.serverVersionNum!==180004||header.catalogVersion!==202506291)fail('version');
  if(!equal(header.columns,catalogColumns))fail('catalog-shape');
  if(!equal(header.functions,[
    {name:'pg_get_object_address',kind:'f',inputs:['text','text[]','text[]'],output:'record'},
    {name:'pg_identify_object_as_address',kind:'f',inputs:['oid','oid','integer'],output:'record'},
  ]))fail('function-shape');
  return true;
}
export function nativeSourceDigest(input) {
  const snapshot=copy(input);
  delete snapshot.sourceReceiptSha256;
  return createHash('sha256').update(key(canonical(snapshot))).digest('hex');
}

const classCatalog={relation:'pg_class',column:'pg_attribute',constraint:'pg_constraint',trigger:'pg_trigger',index:'pg_index'};
const boundaryCatalogs=['pg_class','pg_constraint','pg_trigger','pg_namespace','pg_type','pg_proc','pg_operator','pg_opclass','pg_collation','pg_authid'];
const pick=(raw,names)=>Object.fromEntries(names.split(' ').map(name=>[name,raw[name]]));
function project(snapshot) {
  fields(snapshot,['header','profileId','schemas','captureId','origin','sourceReceiptSha256','census','records','dependencies','residuals']);
  assertNativeClassHeader(snapshot.header,snapshot.profileId);
  if(!Array.isArray(snapshot.schemas)||!snapshot.schemas.length||snapshot.schemas.some(x=>typeof x!=='string'||!x)||new Set(snapshot.schemas).size!==snapshot.schemas.length)fail('scope');
  if(typeof snapshot.captureId!=='string'||!snapshot.captureId||typeof snapshot.sourceReceiptSha256!=='string'||!/^[0-9a-f]{64}$/.test(snapshot.sourceReceiptSha256))fail('provenance');
  if(!equal(snapshot.residuals,['whole-catalog-registry-open','boundary-semantics-unproved']))fail('coverage');
  if(!Array.isArray(snapshot.census)||!Array.isArray(snapshot.records))fail('shape');
  fields(snapshot.dependencies,['edges','anchors']);
  if(!Array.isArray(snapshot.dependencies.edges)||!Array.isArray(snapshot.dependencies.anchors))fail('shape');
  const census=new Set(),records=new Map(),resolved=new Map(),definitions=new Map(),columns=new Map();
  for(const entry of snapshot.census){
    const id=local(entry);
    if(!['pg_class','pg_constraint','pg_trigger'].includes(entry[0]))fail('unsupported-class');
    if(census.has(id))fail('duplicate-census');census.add(id);
  }
  for(const entry of snapshot.records){
    fields(entry,['class','local','address','roundtrip','raw','definition','vectors']);
    if(!Object.hasOwn(classCatalog,entry.class))fail('unsupported-class');
    const id=local(entry.local);
    if(entry.local[0]!==({relation:'pg_class',column:'pg_class',index:'pg_class',constraint:'pg_constraint',trigger:'pg_trigger'}[entry.class]))fail('address');
    if(records.has(id))fail('duplicate-record');
    fields(entry.raw,catalogColumns[classCatalog[entry.class]]);
    const raw=entry.raw;
    if((entry.class==='column'?(raw.attrelid!==entry.local[1]||raw.attnum!==entry.local[2]):
      (entry.class==='index'?raw.indexrelid:raw.oid)!==entry.local[1])||(entry.class!=='column'&&entry.local[2]!==0))fail('address');
    if(typeof entry.roundtrip!=='boolean'||!(entry.definition===null||typeof entry.definition==='string'))fail('shape');
    if(entry.class==='column'&&raw.attisdropped){
      if(entry.address!==null||entry.roundtrip!==false)fail('dropped-column');
    }else{
      if(entry.roundtrip!==true)fail('roundtrip');
      resolved.set(id,address(entry.address));
    }
    fields(entry.vectors,entry.class==='trigger'?['tgattr']:entry.class==='index'?['indkey','indcollation','indclass','indoption']:[]);
    records.set(id,entry);
  }
  if(!equal([...records.keys()].sort(),[...census].sort()))fail('census-records');
  for(const entry of snapshot.dependencies.anchors){
    fields(entry,['local','address','definition']);
    const id=local(entry.local);
    if(!boundaryCatalogs.includes(entry.local[0]))fail('unsupported-endpoint');
    const token=address(entry.address);
    if(token[1]==='toast table')fail('unsupported-physical-dependency');
    if(resolved.has(id)&&!equal(resolved.get(id),token))fail('address');
    if(definitions.has(id))fail('duplicate-anchor');
    resolved.set(id,token);definitions.set(id,entry.definition);
    if(!(entry.definition===null||typeof entry.definition==='string'))fail('shape');
  }
  const get=(catalog,oid,sub=0)=>{
    if(oid==='0')return null;
    const id=local([catalog,oid,sub]);
    if(!resolved.has(id))fail('binding');return resolved.get(id);
  };
  for(const entry of records.values())if(entry.class==='relation'){
    const r=entry.raw;
    if(r.relkind!=='r'||r.relispartition||r.relhassubclass||r.reloftype!=='0')fail('unsupported-relation');
    if(r.relhasrules)fail('unsupported-class');
  }
  for(const entry of records.values())if(entry.class==='column'){
    const r=entry.raw;
    if(!records.has(key(['pg_class',r.attrelid,0])))fail('binding');
    if(r.attisdropped)continue;
    if(r.atthasdef||r.atthasmissing||r.attgenerated!==''||r.attidentity!==''||r.attinhcount!==0)fail('unsupported-column');
    if(!columns.has(r.attrelid))columns.set(r.attrelid,[]);
    columns.get(r.attrelid).push(entry);
  }
  for(const [oid,list] of columns){
    list.sort((a,b)=>a.raw.attnum-b.raw.attnum);
    const names=new Set();
    for(let rank=0;rank<list.length;rank++){
      const entry=list[rank];if(names.has(entry.raw.attname))fail('duplicate-column');names.add(entry.raw.attname);
      resolved.set(key(entry.local),['column',get('pg_class',oid),entry.raw.attname,rank+1]);
    }
  }
  const vector=(value,convert)=>{
    if(value===null)return null;
    if(!Array.isArray(value))fail('shape');return value.map(convert);
  };
  const col=(oid,attnum)=>{
    if(!Number.isSafeInteger(attnum)||attnum<=0)fail('column-binding');
    const entry=records.get(key(['pg_class',oid,attnum]));
    if(!entry||entry.raw.attisdropped)fail('column-binding');return get('pg_class',oid,attnum);
  };
  const payloads=[];
  for(const entry of records.values())if(entry.class==='constraint'){
    const r=entry.raw;
    if(!['c','p','u','f','n'].includes(r.contype)||r.contypid!=='0'||r.conparentid!=='0'||r.coninhcount!==0||r.conperiod||r.conexclop!==null)fail('unsupported-constraint');
    if(!records.has(key(['pg_class',r.conrelid,0])))fail('binding');
    payloads.push([get('pg_constraint',r.oid),{class:'constraint',definition:entry.definition,
      ...pick(r,'contype condeferrable condeferred conenforced convalidated confupdtype confdeltype confmatchtype conislocal coninhcount connoinherit conperiod'),
      table:get('pg_class',r.conrelid),index:get('pg_class',r.conindid),
      referenced:get('pg_class',r.confrelid),columns:vector(r.conkey,x=>col(r.conrelid,x)),
      referencedColumns:vector(r.confkey,x=>col(r.confrelid,x)),deleteColumns:vector(r.confdelsetcols,x=>col(r.conrelid,x)),
      operators:[r.conpfeqop,r.conppeqop,r.conffeqop].map(v=>vector(v,x=>get('pg_operator',x)))}]);
  }
  const internalKeys=new Set();
  for(const entry of records.values())if(entry.class==='trigger'){
    const r=entry.raw;
    if(r.tgparentid!=='0')fail('unsupported-trigger');
    if(!['O','D','R','A'].includes(r.tgenabled))fail('shape');
    let identity=get('pg_trigger',r.oid);
    if(r.tgisinternal){
      const constraint=records.get(key(['pg_constraint',r.tgconstraint,0]));
      const fn=get('pg_proc',r.tgfoid);
      if(!constraint||constraint.raw.contype!=='f'||r.tgnargs!==0||r.tgargs!=='\\x'||r.tgqual!==null||r.tgoldtable!==null||r.tgnewtable!==null||entry.vectors.tgattr.length)fail('unsupported-trigger');
      if(fn[1]!=='function'||fn[2][0]!=='pg_catalog'||!/^RI_FKey_(check_(ins|upd)|noaction_(del|upd)|restrict_(del|upd)|cascade_(del|upd)|setnull_(del|upd)|setdefault_(del|upd))$/.test(fn[2][1]))fail('unsupported-trigger');
      identity=['internal-fk',get('pg_constraint',r.tgconstraint),get('pg_class',r.tgrelid),fn,r.tgtype];
      if(internalKeys.has(key(identity)))fail('duplicate-internal-key');internalKeys.add(key(identity));
      resolved.set(key(entry.local),identity);
    }else if(r.tgconstraint!=='0')fail('unsupported-trigger');
    payloads.push([identity,{class:'trigger',definition:r.tgisinternal?null:entry.definition,
      ...pick(r,'tgenabled tgisinternal tgtype tgdeferrable tginitdeferred tgnargs tgargs tgoldtable tgnewtable'),
      table:get('pg_class',r.tgrelid),function:get('pg_proc',r.tgfoid),constraint:get('pg_constraint',r.tgconstraint),
      referenced:get('pg_class',r.tgconstrrelid),index:get('pg_class',r.tgconstrindid),columns:vector(entry.vectors.tgattr,x=>col(r.tgrelid,x))}]);
  }
  for(const entry of records.values()){
    const r=entry.raw;
    if(entry.class==='relation')payloads.push([get('pg_class',r.oid),{class:'relation',
      ...pick(r,'relkind relpersistence relrowsecurity relforcerowsecurity relreplident reloptions'),schema:get('pg_namespace',r.relnamespace)}]);
    if(entry.class==='column'&&!r.attisdropped)payloads.push([get('pg_class',r.attrelid,r.attnum),{class:'column',
      ...pick(r,'attname atttypmod attndims attnotnull atthasdef atthasmissing attidentity attgenerated attislocal attinhcount attstorage attcompression attoptions'),
      type:get('pg_type',r.atttypid),collation:get('pg_collation',r.attcollation)}]);
    if(entry.class==='index'){
      if(r.indexprs!==null||r.indpred!==null||r.indisexclusion)fail('unsupported-index');
      payloads.push([get('pg_class',r.indexrelid),{class:'index',definition:entry.definition,
        ...pick(r,'indnatts indnkeyatts indisunique indnullsnotdistinct indisprimary indimmediate indisclustered indisvalid indcheckxmin indisready indislive indisreplident'),
        table:get('pg_class',r.indrelid),columns:vector(entry.vectors.indkey,x=>col(r.indrelid,x)),
        collations:vector(entry.vectors.indcollation,x=>get('pg_collation',x)),
        opclasses:vector(entry.vectors.indclass,x=>get('pg_opclass',x)),options:entry.vectors.indoption}]);
    }
  }
  const unique=new Set();
  for(const [identity] of payloads){if(unique.has(key(identity)))fail('duplicate-key');unique.add(key(identity));}
  const edges=snapshot.dependencies.edges.map(edge=>{
    fields(edge,['from','to','deptype','shared']);
    if(typeof edge.shared!=='boolean'||!(edge.shared?['o','a','i','r','t']:['n','a','i','e','x','P','S']).includes(edge.deptype))fail('dependency-kind');
    return [get(...edge.from),get(...edge.to),edge.deptype,edge.shared];
  });
  const boundary=[...definitions].filter(([id])=>!records.has(id)).map(([id,definition])=>[resolved.get(id),definition]);
  const sort=values=>values.sort((a,b)=>key(a).localeCompare(key(b),'en'));
  return {keys:sort(payloads.map(x=>x[0])),payloads:sort(payloads),edges:sort(edges),boundary:sort(boundary)};
}

export function assertNativeClassSubset(input) {
  const args=copy(input);
  fields(args,['profileId','liveBefore','reference','restored']);
  if(args.profileId!==implementedProfile)fail(args.profileId==='pg17.6'?'profile-unexecuted':'profile');
  const snapshots=[args.liveBefore,args.reference,args.restored];
  const projections=snapshots.map(project);
  if(!equal(snapshots.map(x=>x.origin),['live-before','reference','restored'])||new Set(snapshots.map(x=>x.captureId)).size!==3)fail('provenance');
  if(snapshots.some(x=>x.profileId!==args.profileId))fail('version');
  const sourceHash=nativeSourceDigest(args.liveBefore);
  if(snapshots.some(x=>x.sourceReceiptSha256!==sourceHash))fail('provenance');
  if(snapshots.some(x=>!equal(x.schemas,args.liveBefore.schemas)))fail('scope');
  for(const actual of projections.slice(1)){
    if(!equal(actual.keys,projections[0].keys))fail('live-membership');
    if(!equal(actual.payloads,projections[0].payloads))fail('selected-state');
    if(!equal(actual.edges,projections[0].edges)||!equal(actual.boundary,projections[0].boundary))fail('dependency-binding');
  }
  return Object.freeze({scope:'constraint-trigger-bindings/v1',coverage:'selected-only',
    fullRestoreApproved:false,pg17Accepted:false,runtimeApproved:false,productionApproved:false});
}
