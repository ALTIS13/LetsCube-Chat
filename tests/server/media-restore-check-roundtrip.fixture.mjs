import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// Diagnostic only. Raw rows/dumps remain distinct from this narrow projection.
export const profileId='pg18.4-local';
export const catalogColumns=Object.freeze({
  pg_attribute:Object.freeze('attrelid attname atttypid attlen attnum atttypmod attndims attbyval attalign attstorage attcompression attnotnull atthasdef atthasmissing attidentity attgenerated attisdropped attislocal attinhcount attcollation attstattarget attacl attoptions attfdwoptions attmissingval'.split(' ')),
  pg_constraint:Object.freeze('oid conname connamespace contype condeferrable condeferred conenforced convalidated conrelid contypid conindid conparentid confrelid confupdtype confdeltype confmatchtype conislocal coninhcount connoinherit conperiod conkey confkey conpfeqop conppeqop conffeqop confdelsetcols conexclop conbin'.split(' ')),
});
export const seedSQL=`CREATE SCHEMA check_roundtrip_fixture;
CREATE TABLE check_roundtrip_fixture.inventory(
  obsolete_before integer, id integer, quantity integer, obsolete_after integer, alternate integer,
  CONSTRAINT quantity_check CHECK(quantity >= 0));
ALTER TABLE check_roundtrip_fixture.inventory DROP COLUMN obsolete_before;
ALTER TABLE check_roundtrip_fixture.inventory DROP COLUMN obsolete_after;`;

const fail=reason=>{throw Object.assign(new Error('check_roundtrip_refused:'+reason),{code:'check_roundtrip_refused',reason});};
function profile(id){if(id!==profileId)fail(id==='pg17.6'?'profile-unexecuted':'profile');}
function copy(value,seen=new Set()) {
  if(value===null||['string','boolean'].includes(typeof value))return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value!=='object'||seen.has(value))fail('shape');
  const array=Array.isArray(value),descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype))fail('shape');
  for(const descriptor of Object.values(descriptors))if(!Object.hasOwn(descriptor,'value'))fail('accessor');
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string'))fail('shape');
  seen.add(value);
  let result;
  if(array){
    if(Object.keys(descriptors).length!==value.length+1)fail('shape');
    result=[];
    for(let i=0;i<value.length;i++){if(!descriptors[i])fail('shape');result.push(copy(descriptors[i].value,seen));}
  }else result=Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,copy(d.value,seen)]));
  seen.delete(value);return result;
}
function fields(value,names){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==names.length||names.some(name=>!Object.hasOwn(value,name)))fail('shape');
}
function address(value){
  fields(value,['type','object_names','object_args']);
  if(typeof value.type!=='string'||!value.type||!Array.isArray(value.object_names)||!value.object_names.length||!Array.isArray(value.object_args)||
    [...value.object_names,...value.object_args].some(x=>typeof x!=='string'||!x||x.includes('\0')))fail('address');
  return value;
}
const oid=value=>{if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value)||BigInt(value)>4294967295n)fail('address');return value;};
const authority=()=>({fullRestoreApproved:false,pg17Accepted:false,runtimeApproved:false,productionApproved:false});

export function checkRoundtripQueries(id) {
  profile(id);
  const header=`SET search_path=''; SELECT jsonb_build_object(
    'serverVersionNum',current_setting('server_version_num')::integer,
    'catalogVersion',(pg_catalog.pg_control_system()).catalog_version_no,
    'columns',(SELECT jsonb_object_agg(c.relname,q.columns) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL
      (SELECT jsonb_agg(a.attname ORDER BY a.attnum) columns FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) q
      WHERE n.nspname='pg_catalog' AND c.relname IN('pg_attribute','pg_constraint')));`;
  const capture=`SET search_path=''; WITH roots AS (
    SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='check_roundtrip_fixture' AND c.relkind NOT IN('i','I')
  ), checks AS (
    SELECT c.* FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='check_roundtrip_fixture'
  ), owned AS (
    SELECT 'pg_catalog.pg_class'::regclass::oid cat,r.oid obj FROM roots r
    UNION SELECT 'pg_catalog.pg_constraint'::regclass,c.oid FROM checks c
  ), edges AS (
    SELECT to_jsonb(d) raw,d.classid cat,d.objid obj,d.objsubid sub,
      d.refclassid refcat,d.refobjid refobj,d.refobjsubid refsub,d.deptype,false shared
    FROM pg_catalog.pg_depend d WHERE EXISTS(SELECT 1 FROM owned o
      WHERE (o.cat=d.classid AND o.obj=d.objid) OR (o.cat=d.refclassid AND o.obj=d.refobjid))
    UNION ALL SELECT to_jsonb(d),d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,0,d.deptype,true
    FROM pg_catalog.pg_shdepend d WHERE d.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
      AND EXISTS(SELECT 1 FROM owned o WHERE o.cat=d.classid AND o.obj=d.objid)
  ) SELECT jsonb_build_object(
    'tables',COALESCE((SELECT jsonb_agg(jsonb_build_object('raw',to_jsonb(r),'address',to_jsonb(a),
      'roundtrip',g.classid='pg_catalog.pg_class'::regclass AND g.objid=r.oid AND g.objsubid=0) ORDER BY r.oid)
      FROM roots r CROSS JOIN LATERAL pg_catalog.pg_identify_object_as_address('pg_catalog.pg_class'::regclass,r.oid,0) a
      CROSS JOIN LATERAL pg_catalog.pg_get_object_address(a.type,a.object_names,a.object_args) g),'[]'::jsonb),
    'attributes',COALESCE((SELECT jsonb_agg(jsonb_build_object('raw',to_jsonb(a),
      'address',CASE WHEN a.attisdropped THEN NULL ELSE to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_class'::regclass,a.attrelid,a.attnum)) END,
      'roundtrip',CASE WHEN a.attisdropped THEN false ELSE (SELECT
        g.classid='pg_catalog.pg_class'::regclass AND g.objid=a.attrelid AND g.objsubid=a.attnum
        FROM pg_catalog.pg_identify_object_as_address('pg_catalog.pg_class'::regclass,a.attrelid,a.attnum) i
        CROSS JOIN LATERAL pg_catalog.pg_get_object_address(i.type,i.object_names,i.object_args) g) END,
      'typeAddress',CASE WHEN a.attisdropped THEN NULL ELSE to_jsonb(pg_catalog.pg_identify_object_as_address('pg_catalog.pg_type'::regclass,a.atttypid,0)) END) ORDER BY a.attrelid,a.attnum)
      FROM pg_catalog.pg_attribute a JOIN roots r ON r.oid=a.attrelid
      WHERE a.attnum>0),'[]'::jsonb),
    'constraints',COALESCE((SELECT jsonb_agg(jsonb_build_object('raw',to_jsonb(c),
      'definition',pg_catalog.pg_get_constraintdef(c.oid,false),'address',to_jsonb(a),
      'roundtrip',g.classid='pg_catalog.pg_constraint'::regclass AND g.objid=c.oid AND g.objsubid=0) ORDER BY c.oid)
      FROM checks c CROSS JOIN LATERAL pg_catalog.pg_identify_object_as_address('pg_catalog.pg_constraint'::regclass,c.oid,0) a
      CROSS JOIN LATERAL pg_catalog.pg_get_object_address(a.type,a.object_names,a.object_args) g),'[]'::jsonb),
    'dependencies',COALESCE((SELECT jsonb_agg(jsonb_build_object('raw',e.raw,'shared',e.shared,
      'from',to_jsonb(a),'to',to_jsonb(b),'fromRoundtrip',g.classid=e.cat AND g.objid=e.obj AND g.objsubid=e.sub,
      'toRoundtrip',h.classid=e.refcat AND h.objid=e.refobj AND h.objsubid=e.refsub)
      ORDER BY e.shared,e.cat,e.obj,e.sub,e.refcat,e.refobj,e.refsub,e.deptype)
      FROM edges e CROSS JOIN LATERAL pg_catalog.pg_identify_object_as_address(e.cat,e.obj,e.sub) a
      CROSS JOIN LATERAL pg_catalog.pg_identify_object_as_address(e.refcat,e.refobj,e.refsub) b
      CROSS JOIN LATERAL pg_catalog.pg_get_object_address(a.type,a.object_names,a.object_args) g
      CROSS JOIN LATERAL pg_catalog.pg_get_object_address(b.type,b.object_names,b.object_args) h),'[]'::jsonb));`;
  return Object.freeze({header,capture});
}

export function assertCheckRoundtripHeader(input,id=profileId) {
  profile(id);const header=copy(input);
  fields(header,['serverVersionNum','catalogVersion','columns']);
  if(header.serverVersionNum!==180004||header.catalogVersion!==202506291)fail('version');
  if(!isDeepStrictEqual(header.columns,catalogColumns))fail('catalog-shape');
  return true;
}
export function checkSourceDigest(input) {
  const source=copy(input);delete source.sourceReceiptSha256;
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
function projection(snapshot) {
  fields(snapshot,['header','profileId','captureId','origin','sourceReceiptSha256','inputDumpSha256','catalog']);
  assertCheckRoundtripHeader(snapshot.header,snapshot.profileId);
  if(typeof snapshot.captureId!=='string'||!snapshot.captureId||typeof snapshot.sourceReceiptSha256!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.sourceReceiptSha256))fail('origin-consistency');
  fields(snapshot.catalog,['tables','attributes','constraints','dependencies']);
  const {tables,attributes,constraints,dependencies}=snapshot.catalog;
  if(![tables,attributes,constraints,dependencies].every(Array.isArray))fail('shape');
  if(tables.length!==1)fail('table-membership');
  const table=tables[0];fields(table,['raw','address','roundtrip']);
  if(table.roundtrip!==true)fail('roundtrip');
  address(table.address);oid(table.raw.oid);
  if(!isDeepStrictEqual(table.address,{type:'table',object_names:['check_roundtrip_fixture','inventory'],object_args:[]})||
    table.raw.relkind!=='r'||table.raw.relispartition||table.raw.relhassubclass||table.raw.reltoastrelid!=='0')fail('unsupported-table');
  const active=[],slots=new Map();let previous=0;
  for(const entry of attributes){
    fields(entry,['raw','address','roundtrip','typeAddress']);fields(entry.raw,catalogColumns.pg_attribute);
    const r=entry.raw;
    if(r.attrelid!==table.raw.oid||!Number.isInteger(r.attnum)||r.attnum!==previous+1)fail('column-slots');
    previous=r.attnum;slots.set(r.attnum,entry);
    if(r.attisdropped){if(entry.address!==null||entry.typeAddress!==null||entry.roundtrip!==false)fail('dropped-slot');continue;}
    if(entry.roundtrip!==true)fail('roundtrip');
    address(entry.address);address(entry.typeAddress);
    if(!isDeepStrictEqual(entry.address,{type:'table column',object_names:['check_roundtrip_fixture','inventory',r.attname],object_args:[]}))fail('check-binding');
    if(r.atttypid!=='23'||!isDeepStrictEqual(entry.typeAddress,{type:'type',object_names:['integer'],object_args:[]})||
      r.atthasdef||r.atthasmissing||r.attidentity!==''||r.attgenerated!==''||r.attinhcount!==0)fail('unsupported-column');
    active.push({name:r.attname,address:entry.address,typeAddress:entry.typeAddress,notNull:r.attnotnull,
      acl:r.attacl,options:r.attoptions,collation:r.attcollation});
  }
  if(!isDeepStrictEqual(active.map(x=>x.name),['id','quantity','alternate']))fail('column-membership');
  if(constraints.length!==1||table.raw.relchecks!==1)fail('check-membership');
  const check=constraints[0];fields(check,['raw','definition','address','roundtrip']);fields(check.raw,catalogColumns.pg_constraint);
  const r=check.raw;oid(r.oid);address(check.address);
  if(check.roundtrip!==true)fail('roundtrip');
  if(!isDeepStrictEqual(check.address,{type:'table constraint',object_names:['check_roundtrip_fixture','inventory','quantity_check'],object_args:[]})||
    r.conname!=='quantity_check'||r.contype!=='c'||r.conrelid!==table.raw.oid)fail('check-binding');
  if(r.contypid!=='0'||r.conindid!=='0'||r.conparentid!=='0'||r.confrelid!=='0'||r.conperiod||r.coninhcount!==0||!r.conislocal||r.connoinherit)fail('unsupported-check');
  if(!Array.isArray(r.conkey)||r.conkey.length!==1||!slots.has(r.conkey[0])||slots.get(r.conkey[0]).raw.attisdropped)fail('check-binding');
  const binding=slots.get(r.conkey[0]).address;
  if(!isDeepStrictEqual(binding,{type:'table column',object_names:['check_roundtrip_fixture','inventory','quantity'],object_args:[]}))fail('check-binding');
  if(typeof check.definition!=='string'||typeof r.conbin!=='string'||!r.conbin)fail('shape');
  const checkEdges=[];
  for(const edge of dependencies){
    fields(edge,['raw','shared','from','to','fromRoundtrip','toRoundtrip']);
    address(edge.from);address(edge.to);
    if(edge.fromRoundtrip!==true||edge.toRoundtrip!==true)fail('roundtrip');
    if(typeof edge.shared!=='boolean'||typeof edge.raw.deptype!=='string')fail('shape');
    if(isDeepStrictEqual(edge.from,check.address)||isDeepStrictEqual(edge.to,check.address)){
      checkEdges.push({from:edge.from,to:edge.to,deptype:edge.raw.deptype,shared:edge.shared});
    }
  }
  if(!checkEdges.some(edge=>isDeepStrictEqual(edge.from,check.address)&&isDeepStrictEqual(edge.to,binding)&&edge.deptype==='a'&&!edge.shared))fail('check-dependency');
  return {active,binding,definition:check.definition,validated:r.convalidated,enforced:r.conenforced,
    deferrable:r.condeferrable,deferred:r.condeferred,checkEdges};
}

export function assertCheckDiagnostic(input) {
  const args=copy(input);profile(args.profileId);
  fields(args,['profileId','source','reference1','reference2']);
  const snapshots=[args.source,args.reference1,args.reference2];
  // Origins are consistency checks, not authenticated live/backup provenance.
  if(!isDeepStrictEqual(snapshots.map(x=>x.origin),['live-before','live-ddl-reference','reference1-ddl-reference'])||
    new Set(snapshots.map(x=>x.captureId)).size!==3)fail('origin-consistency');
  const hash=checkSourceDigest(args.source);
  if(snapshots.some(x=>x.sourceReceiptSha256!==hash)||args.source.inputDumpSha256!==null||
    snapshots.slice(1).some(x=>typeof x.inputDumpSha256!=='string'||!/^[a-f0-9]{64}$/.test(x.inputDumpSha256)))fail('origin-consistency');
  const projections=snapshots.map(projection);
  const source=projections[0];
  if(source.definition!=='CHECK ((quantity >= 0))')fail('source-literal');
  if(source.validated!==true||source.enforced!==true||source.deferrable!==false||source.deferred!==false)fail('source-literal');
  for(const actual of projections.slice(1)){
    if(actual.validated!==source.validated)fail('check-validation');
    if(actual.definition!==source.definition)fail('check-definition');
    if(!isDeepStrictEqual(actual.binding,source.binding)||!isDeepStrictEqual(actual.checkEdges,source.checkEdges))fail('check-binding');
    if(!isDeepStrictEqual(actual.active,source.active)||actual.enforced!==source.enforced||
      actual.deferrable!==source.deferrable||actual.deferred!==source.deferred)fail('check-state');
  }
  return Object.freeze({scope:'check-roundtrip-diagnostic/v1',coverage:'one-fictional-integer-check',
    originAuthority:'consistency-only',...authority()});
}

export function classifyCheckDumps({source,reference1,reference2}) {
  if(![source,reference1,reference2].every(Buffer.isBuffer))fail('dump-bytes');
  const sourceRepresentable=source.equals(reference1)&&source.equals(reference2);
  return Object.freeze({scope:'check-roundtrip-diagnostic/v1',sourceRepresentable,
    referenceConverged:reference1.equals(reference2),strictOperator:sourceRepresentable?'BYTE_EXACT_DIAGNOSTIC_ONLY':'REFUSED',...authority()});
}
export function assertCheckSourceDumps(input) {
  const result=classifyCheckDumps(input);
  if(!result.sourceRepresentable)fail('source-ddl');
  return result;
}
