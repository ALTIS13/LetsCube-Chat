// Exact REL_18_4 catalog headers; generated and extension-owned types are not filtered.
export const profileId='pg18.4-local';
export const typeColumns=Object.freeze({
  pg_type:Object.freeze('oid typname typnamespace typowner typlen typbyval typtype typcategory typispreferred typisdefined typdelim typrelid typsubscript typelem typarray typinput typoutput typreceive typsend typmodin typmodout typanalyze typalign typstorage typnotnull typbasetype typtypmod typndims typcollation typdefaultbin typdefault typacl'.split(' ')),
  pg_enum:Object.freeze('oid enumtypid enumsortorder enumlabel'.split(' ')),
  pg_range:Object.freeze('rngtypid rngsubtype rngmultitypid rngcollation rngsubopc rngcanonical rngsubdiff'.split(' ')),
});
const fail=reason=>{throw Object.assign(new Error('type_census_refused:'+reason),{code:'type_census_refused',reason});};
export function typeCensusQueries(id,schemas){
  if(id!==profileId)fail(id==='pg17.6'?'profile-unexecuted':'profile');
  if(!Array.isArray(schemas)||Object.getPrototypeOf(schemas)!==Array.prototype)fail('scope');
  const descriptors=Object.getOwnPropertyDescriptors(schemas);
  if(Object.values(descriptors).some(d=>!('value' in d)))fail('accessor');
  if(Reflect.ownKeys(schemas).some(key=>typeof key!=='string'))fail('scope');
  const length=descriptors.length.value;
  if(!length||Object.keys(descriptors).length!==length+1)fail('scope');
  const names=[];
  for(let i=0;i<length;i++){
    const name=descriptors[i]?.value;
    if(typeof name!=='string'||!name||name.includes('\0')||names.includes(name))fail('scope');
    names.push(name);
  }
  const scope='ARRAY['+names.map(name=>"'"+name.replaceAll("'","''")+"'").join(',')+']::text[]';
  const start="SET search_path=''; SET standard_conforming_strings=on; ";
  const header=start+`SELECT jsonb_build_object('serverVersionNum',current_setting('server_version_num')::integer,
    'catalogVersion',(pg_catalog.pg_control_system()).catalog_version_no,
    'columns',(SELECT jsonb_object_agg(c.relname,cols.names) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL (SELECT jsonb_agg(a.attname ORDER BY a.attnum) AS names
        FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) cols
      WHERE n.nspname='pg_catalog' AND c.relname IN ('pg_type','pg_enum','pg_range')),
    'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'kind',p.prokind,'inputs',
      (SELECT jsonb_agg(pg_catalog.format_type(x,NULL) ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY a(x,ord)),
      'output',pg_catalog.format_type(p.prorettype,NULL)) ORDER BY p.proname)
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='pg_catalog' AND p.proname IN ('pg_get_object_address','pg_identify_object_as_address')));`;
  const namespaces=start+`SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',n.oid,'nspname',n.nspname)
    ORDER BY n.nspname),'[]'::jsonb) FROM pg_catalog.pg_namespace n WHERE n.nspname=ANY(${scope});`;
  const census=start+`SELECT COALESCE(jsonb_agg(jsonb_build_object('local',jsonb_build_array('pg_type',t.oid,0),
    'address',to_jsonb(a),'roundtrip',(g.classid='pg_catalog.pg_type'::regclass AND g.objid=t.oid AND g.objsubid=0),
    'formattedName',pg_catalog.format_type(t.oid,NULL),'raw',to_jsonb(t),
    'enums',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.enumsortorder,e.oid),'[]'::jsonb)
      FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid),
    'ranges',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.rngtypid),'[]'::jsonb)
      FROM pg_catalog.pg_range r WHERE r.rngtypid=t.oid OR r.rngmultitypid=t.oid)) ORDER BY t.oid),'[]'::jsonb)
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    LEFT JOIN LATERAL pg_catalog.pg_identify_object_as_address('pg_catalog.pg_type'::regclass,t.oid,0) a ON true
    LEFT JOIN LATERAL pg_catalog.pg_get_object_address(a.type,a.object_names,a.object_args) g ON true
    WHERE n.nspname=ANY(${scope});`;
  return Object.freeze({header,namespaces,census});
}
