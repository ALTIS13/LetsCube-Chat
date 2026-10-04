// Exact PG18.4 catalog shape: REL_18_4/src/include/catalog/pg_proc.h.
export const profileId='pg18.4-local';
export const routineColumns=Object.freeze('oid proname pronamespace proowner prolang procost prorows provariadic prosupport prokind prosecdef proleakproof proisstrict proretset provolatile proparallel pronargs pronargdefaults prorettype proargtypes proallargtypes proargmodes proargnames proargdefaults protrftypes prosrc probin prosqlbody proconfig proacl'.split(' '));
const fail=reason=>{throw Object.assign(new Error('routine_census_refused:'+reason),{code:'routine_census_refused',reason});};
export function routineCensusQueries(id,schemas) {
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
    'columns',jsonb_build_object('pg_proc',(SELECT jsonb_agg(a.attname ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid='pg_catalog.pg_proc'::regclass AND a.attnum>0 AND NOT a.attisdropped)),
    'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'kind',p.prokind,'inputs',
      (SELECT jsonb_agg(pg_catalog.format_type(x,NULL) ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY a(x,ord)),
      'output',pg_catalog.format_type(p.prorettype,NULL)) ORDER BY p.proname)
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='pg_catalog' AND p.proname IN('pg_get_object_address','pg_identify_object_as_address')));`;
  // Direct routine membership; no table reachability or selected-record dependency.
  const census=start+`SELECT COALESCE(jsonb_agg(jsonb_build_object('local',jsonb_build_array('pg_proc',p.oid,0),
    'address',to_jsonb(a),'roundtrip',(g.classid='pg_catalog.pg_proc'::regclass AND g.objid=p.oid AND g.objsubid=0),
    'raw',to_jsonb(p)) ORDER BY p.oid),'[]'::jsonb)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    LEFT JOIN LATERAL pg_catalog.pg_identify_object_as_address('pg_catalog.pg_proc'::regclass,p.oid,0) a ON true
    LEFT JOIN LATERAL pg_catalog.pg_get_object_address(a.type,a.object_names,a.object_args) g ON true
    WHERE n.nspname=ANY(${scope});`;
  return Object.freeze({header,census});
}
