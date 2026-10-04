// Selected fictional-schema capture. Raw evidence is never a whole-catalog gate.
export const profileId='pg18.4-local';
export const catalogColumns=Object.freeze(Object.fromEntries(Object.entries({
  pg_attribute:'attrelid attname atttypid attlen attnum atttypmod attndims attbyval attalign attstorage attcompression attnotnull atthasdef atthasmissing attidentity attgenerated attisdropped attislocal attinhcount attcollation attstattarget attacl attoptions attfdwoptions attmissingval',
  pg_class:'oid relname relnamespace reltype reloftype relowner relam relfilenode reltablespace relpages reltuples relallvisible relallfrozen reltoastrelid relhasindex relisshared relpersistence relkind relnatts relchecks relhasrules relhastriggers relhassubclass relrowsecurity relforcerowsecurity relispopulated relreplident relispartition relrewrite relfrozenxid relminmxid relacl reloptions relpartbound',
  pg_constraint:'oid conname connamespace contype condeferrable condeferred conenforced convalidated conrelid contypid conindid conparentid confrelid confupdtype confdeltype confmatchtype conislocal coninhcount connoinherit conperiod conkey confkey conpfeqop conppeqop conffeqop confdelsetcols conexclop conbin',
  pg_index:'indexrelid indrelid indnatts indnkeyatts indisunique indnullsnotdistinct indisprimary indisexclusion indimmediate indisclustered indisvalid indcheckxmin indisready indislive indisreplident indkey indcollation indclass indoption indexprs indpred',
  pg_trigger:'oid tgrelid tgparentid tgname tgfoid tgtype tgenabled tgisinternal tgconstrrelid tgconstrindid tgconstraint tgdeferrable tginitdeferred tgnargs tgattr tgargs tgqual tgoldtable tgnewtable',
}).map(([key,value])=>[key,Object.freeze(value.split(' '))])));

const text=value=>"'"+value.replaceAll("'","''")+"'";
export function nativeClassQueries(id,schemas) {
  if(id!==profileId)throw Object.assign(new Error('native_class_refused'),{code:'native_class_refused',reason:id==='pg17.6'?'profile-unexecuted':'profile'});
  if(!Array.isArray(schemas)||!schemas.length||schemas.some(value=>typeof value!=='string'||!value||value.includes('\0'))||new Set(schemas).size!==schemas.length)throw new TypeError('explicit schema names required');
  const scope='ARRAY['+schemas.map(text).join(',')+']::text[]';
  const start="SET search_path=''; ";
  const header=start+`SELECT jsonb_build_object('serverVersionNum',current_setting('server_version_num')::integer,
    'catalogVersion',(pg_catalog.pg_control_system()).catalog_version_no,
    'columns',(SELECT jsonb_object_agg(c.relname,q.cols) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN LATERAL
      (SELECT jsonb_agg(a.attname ORDER BY a.attnum) cols FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) q ON true
      WHERE n.nspname='pg_catalog' AND c.relname IN('pg_class','pg_attribute','pg_constraint','pg_trigger','pg_index')),
    'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'kind',p.prokind,'inputs',
      (SELECT jsonb_agg(pg_catalog.format_type(x,NULL) ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY a(x,ord)),
      'output',pg_catalog.format_type(p.prorettype,NULL)) ORDER BY p.proname)
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='pg_catalog' AND p.proname IN('pg_get_object_address','pg_identify_object_as_address')));`;
  // Independent FROM clauses, not a count of captured-record CTEs.
  const census=start+`SELECT COALESCE(jsonb_agg(q.local ORDER BY q.local::text),'[]'::jsonb) FROM (
    SELECT jsonb_build_array('pg_class',c.oid,0) local FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY(${scope}) AND c.relkind NOT IN('i','I')
    UNION ALL SELECT jsonb_build_array('pg_class',a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY(${scope}) AND c.relkind NOT IN('i','I') AND a.attnum>0
    UNION ALL SELECT jsonb_build_array('pg_constraint',c.oid,0) FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=ANY(${scope})
    UNION ALL SELECT jsonb_build_array('pg_trigger',t.oid,0) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(${scope})
    UNION ALL SELECT jsonb_build_array('pg_class',i.indexrelid,0) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(${scope})
    UNION ALL SELECT jsonb_build_array('pg_attrdef',a.oid,0) FROM pg_catalog.pg_attrdef a JOIN pg_catalog.pg_class c ON c.oid=a.adrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(${scope})
    UNION ALL SELECT jsonb_build_array('pg_policy',p.oid,0) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(${scope})
    UNION ALL SELECT jsonb_build_array('pg_type',t.oid,0) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname=ANY(${scope}) AND t.typtype='d') q;`;
  const roots=`roots AS (SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY(${scope}) AND c.relkind NOT IN('i','I'))`;
  const records=start+`WITH ${roots}, objects AS (
    SELECT 'relation' AS class, 'pg_catalog.pg_class'::regclass::oid AS cat, c.oid AS obj,0 AS sub,to_jsonb(c) AS raw,NULL::text AS definition,'{}'::jsonb AS vectors FROM roots c
    UNION ALL SELECT 'column','pg_catalog.pg_class'::regclass,a.attrelid,a.attnum,to_jsonb(a),NULL,'{}'::jsonb FROM pg_catalog.pg_attribute a JOIN roots r ON r.oid=a.attrelid WHERE a.attnum>0
    UNION ALL SELECT 'constraint','pg_catalog.pg_constraint'::regclass,c.oid,0,to_jsonb(c),pg_catalog.pg_get_constraintdef(c.oid,false),'{}'::jsonb
      FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=ANY(${scope})
    UNION ALL SELECT 'trigger','pg_catalog.pg_trigger'::regclass,t.oid,0,to_jsonb(t),pg_catalog.pg_get_triggerdef(t.oid,false),jsonb_build_object('tgattr',t.tgattr::smallint[]) FROM pg_catalog.pg_trigger t JOIN roots r ON r.oid=t.tgrelid
    UNION ALL SELECT 'index','pg_catalog.pg_class'::regclass,i.indexrelid,0,to_jsonb(i),pg_catalog.pg_get_indexdef(i.indexrelid,0,false),
      jsonb_build_object('indkey',i.indkey::smallint[],'indcollation',i.indcollation::oid[],'indclass',i.indclass::oid[],'indoption',i.indoption::smallint[])
      FROM pg_catalog.pg_index i JOIN roots r ON r.oid=i.indrelid
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('class',o.class,'local',jsonb_build_array(c.relname,o.obj,o.sub),
    'address',CASE WHEN o.class='column' AND (o.raw->>'attisdropped')::boolean THEN NULL ELSE to_jsonb(a) END,
    'roundtrip',CASE WHEN o.class='column' AND (o.raw->>'attisdropped')::boolean THEN false ELSE
      (g.classid=o.cat AND g.objid=o.obj AND g.objsubid=o.sub) END,'raw',o.raw,'definition',o.definition,'vectors',o.vectors)
    ORDER BY o.cat,o.obj,o.sub),'[]'::jsonb) FROM objects o JOIN pg_catalog.pg_class c ON c.oid=o.cat
    LEFT JOIN LATERAL pg_catalog.pg_identify_object_as_address(o.cat,o.obj,o.sub) a
      ON NOT (o.class='column' AND (o.raw->>'attisdropped')::boolean)
    LEFT JOIN LATERAL pg_catalog.pg_get_object_address(a.type,a.object_names,a.object_args) g
      ON NOT (o.class='column' AND (o.raw->>'attisdropped')::boolean);`;
  const dependencies=start+`WITH ${roots}, owned AS (
    SELECT 'pg_catalog.pg_class'::regclass::oid cat,r.oid obj FROM roots r
    UNION SELECT 'pg_catalog.pg_class'::regclass,i.indexrelid FROM pg_catalog.pg_index i JOIN roots r ON r.oid=i.indrelid
    UNION SELECT 'pg_catalog.pg_constraint'::regclass,c.oid FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=ANY(${scope})
    UNION SELECT 'pg_catalog.pg_trigger'::regclass,t.oid FROM pg_catalog.pg_trigger t JOIN roots r ON r.oid=t.tgrelid
  ), edges AS (
    SELECT d.classid cat,d.objid obj,d.objsubid sub,d.refclassid refcat,d.refobjid refobj,d.refobjsubid refsub,d.deptype,false shared
      FROM pg_catalog.pg_depend d WHERE EXISTS(SELECT 1 FROM owned o WHERE (o.cat=d.classid AND o.obj=d.objid) OR (o.cat=d.refclassid AND o.obj=d.refobjid))
    UNION ALL SELECT d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,0,d.deptype,true FROM pg_catalog.pg_shdepend d
      WHERE d.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND EXISTS(SELECT 1 FROM owned o WHERE o.cat=d.classid AND o.obj=d.objid)
  ), addresses AS (
    SELECT cat,obj,sub FROM edges UNION SELECT refcat,refobj,refsub FROM edges
    UNION SELECT 'pg_catalog.pg_namespace'::regclass,relnamespace,0 FROM roots
    UNION SELECT 'pg_catalog.pg_type'::regclass,a.atttypid,0 FROM pg_catalog.pg_attribute a JOIN roots r ON r.oid=a.attrelid WHERE a.attnum>0 AND NOT a.attisdropped
    UNION SELECT 'pg_catalog.pg_collation'::regclass,a.attcollation,0 FROM pg_catalog.pg_attribute a JOIN roots r ON r.oid=a.attrelid WHERE a.attnum>0 AND a.attcollation<>0 AND NOT a.attisdropped
    UNION SELECT 'pg_catalog.pg_proc'::regclass,t.tgfoid,0 FROM pg_catalog.pg_trigger t JOIN roots r ON r.oid=t.tgrelid
    UNION SELECT 'pg_catalog.pg_opclass'::regclass,x,0 FROM pg_catalog.pg_index i JOIN roots r ON r.oid=i.indrelid CROSS JOIN LATERAL unnest(i.indclass::oid[]) q(x)
    UNION SELECT 'pg_catalog.pg_collation'::regclass,x,0 FROM pg_catalog.pg_index i JOIN roots r ON r.oid=i.indrelid CROSS JOIN LATERAL unnest(i.indcollation::oid[]) q(x) WHERE x<>0
    UNION SELECT 'pg_catalog.pg_operator'::regclass,x,0 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace
      CROSS JOIN LATERAL unnest(c.conpfeqop||c.conppeqop||c.conffeqop) q(x) WHERE n.nspname=ANY(${scope})
  ), anchors AS (SELECT c.relname catalog,a.*,CASE WHEN c.relname IN('pg_class','pg_constraint','pg_trigger','pg_namespace','pg_type','pg_proc','pg_operator','pg_opclass','pg_collation','pg_authid')
      THEN to_jsonb(pg_catalog.pg_identify_object_as_address(a.cat,a.obj,a.sub)) ELSE NULL END address,
    CASE WHEN c.relname='pg_proc' AND p.prokind<>'a' THEN pg_catalog.pg_get_functiondef(a.obj) ELSE NULL END definition
    FROM addresses a JOIN pg_catalog.pg_class c ON c.oid=a.cat LEFT JOIN pg_catalog.pg_proc p ON c.relname='pg_proc' AND p.oid=a.obj)
  SELECT jsonb_build_object('edges',COALESCE((SELECT jsonb_agg(jsonb_build_object('from',jsonb_build_array(c.relname,e.obj,e.sub),
    'to',jsonb_build_array(r.relname,e.refobj,e.refsub),'deptype',e.deptype,'shared',e.shared) ORDER BY e.cat,e.obj,e.sub,e.refcat,e.refobj,e.refsub,e.deptype)
    FROM edges e JOIN pg_catalog.pg_class c ON c.oid=e.cat JOIN pg_catalog.pg_class r ON r.oid=e.refcat),'[]'::jsonb),
    'anchors',COALESCE((SELECT jsonb_agg(jsonb_build_object('local',jsonb_build_array(a.catalog,a.obj,a.sub),'address',a.address,'definition',a.definition) ORDER BY a.cat,a.obj,a.sub) FROM anchors a),'[]'::jsonb));`;
  return Object.freeze({header,census,records,dependencies});
}
