// Native records from fictional schemas only; this is not a full-schema gate.
export const constraintsSql=`SET search_path=''; SELECT coalesce(jsonb_agg(v ORDER BY v->>'name'),'[]') FROM (
 SELECT jsonb_build_object('name',c.conname,'type',c.contype,
  'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,
  'local',c.conislocal,'inherit_count',c.coninhcount,'no_inherit',c.connoinherit,
  'table',c.conrelid::regclass::text,'definition',pg_get_constraintdef(c.oid,true),
  'columns',(SELECT jsonb_agg(a.attname ORDER BY k.ordinal)
    FROM unnest(c.conkey) WITH ORDINALITY k(num,ordinal)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num),
  'dependencies',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type',o.type,'schema',o.schema,'identity',o.identity,'dependency',d.deptype)
    ORDER BY o.type,o.identity,d.deptype),'[]') FROM pg_depend d
    CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) o
    WHERE d.classid='pg_constraint'::regclass AND d.objid=c.oid)) v
 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
 WHERE n.nspname='restore_control' AND c.contype IN ('c','p','u')) q;`;

export const policiesSql=`SET search_path=''; SELECT coalesce(jsonb_agg(v ORDER BY v->>'name'),'[]') FROM (
 SELECT jsonb_build_object('name',p.polname,'table',p.polrelid::regclass::text,
 'command',p.polcmd,'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid,true),
 'check',pg_get_expr(p.polwithcheck,p.polrelid,true),
 'roles',(SELECT jsonb_agg(CASE WHEN a.role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.role) END ORDER BY a.ordinal)
 FROM unnest(p.polroles) WITH ORDINALITY a(role,ordinal))) v
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='restore_control') q;`;

// Independent literal presence checks do not consume the replay capture query.
export const literalPresenceSql=`SET search_path=''; SELECT jsonb_build_object(
 'check_names',(SELECT array_agg(c.conname::text ORDER BY c.conname) FROM pg_constraint c
   WHERE c.conrelid='restore_control.samples'::regclass AND c.contype='c'),
 'constraint_count',(SELECT count(*) FROM pg_constraint c WHERE c.conrelid='restore_control.samples'::regclass AND c.contype IN ('c','p','u')),
 'policy_count',(SELECT count(*) FROM pg_policy p WHERE p.polrelid='restore_control.samples'::regclass),
 'policy_roles',(SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_policy p
   CROSS JOIN LATERAL unnest(p.polroles) k(role) JOIN pg_roles r ON r.oid=k.role
   WHERE p.polrelid='restore_control.samples'::regclass AND p.polname='sample_policy'),
 'scoped_default_types',(SELECT array_agg(a.defaclobjtype::text ORDER BY a.defaclobjtype)
   FROM pg_default_acl a JOIN pg_namespace n ON n.oid=a.defaclnamespace
   WHERE a.defaclrole='fixture_owner'::regrole AND n.nspname='restore_control'),
 'global_default_count',(SELECT count(*) FROM pg_default_acl a
   WHERE a.defaclrole='fixture_owner'::regrole AND a.defaclnamespace=0),
 'quantity_not_null',(SELECT a.attnotnull FROM pg_attribute a
   WHERE a.attrelid='restore_control.samples'::regclass AND a.attname='quantity'),
 'rls',(SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
   WHERE c.oid='restore_control.samples'::regclass));`;

export const constraintMutants=[
 ['check-operator',"ALTER TABLE restore_control.samples DROP CONSTRAINT quantity_check; ALTER TABLE restore_control.samples ADD CONSTRAINT quantity_check CHECK (quantity > 0 AND (label='alpha' OR label='beta'));"],
 ['check-constant',"ALTER TABLE restore_control.samples DROP CONSTRAINT quantity_check; ALTER TABLE restore_control.samples ADD CONSTRAINT quantity_check CHECK (quantity >= 2 AND (label='alpha' OR label='beta'));"],
 ['check-missing','ALTER TABLE restore_control.samples DROP CONSTRAINT quantity_check;'],
 ['check-validation','ALTER TABLE restore_control.samples VALIDATE CONSTRAINT pending_check;'],
 ['constraint-deferrability','ALTER TABLE restore_control.samples DROP CONSTRAINT quantity_unique; ALTER TABLE restore_control.samples ADD CONSTRAINT quantity_unique UNIQUE(quantity) NOT DEFERRABLE;'],
 ['check-column-binding',"ALTER TABLE restore_control.samples DROP CONSTRAINT quantity_check; ALTER TABLE restore_control.samples ADD CONSTRAINT quantity_check CHECK (other_quantity >= 0 AND (label='alpha' OR label='beta'));"],
 ['check-function-binding','ALTER TABLE restore_control.samples DROP CONSTRAINT bound_check; ALTER TABLE restore_control.samples ADD CONSTRAINT bound_check CHECK(restore_shadow.allow_quantity(quantity));'],
];
export const policyMutants=[
 ['policy-missing-role','ALTER POLICY sample_policy ON restore_control.samples TO fixture_alpha;'],
 ['policy-public','ALTER POLICY sample_policy ON restore_control.samples TO PUBLIC;'],
 ['policy-using','ALTER POLICY sample_policy ON restore_control.samples USING(quantity < 10);'],
 ['policy-with-check','ALTER POLICY sample_policy ON restore_control.samples WITH CHECK(other_quantity < 20);'],
];
export const defaultMutants=[
 ['default-table-missing','ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control REVOKE SELECT ON TABLES FROM fixture_alpha;'],
 ['default-function-missing','ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control REVOKE EXECUTE ON FUNCTIONS FROM fixture_alpha;'],
 ['default-sequence-missing','ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control REVOKE USAGE ON SEQUENCES FROM fixture_alpha;'],
 ['default-global-missing','ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner REVOKE SELECT ON TABLES FROM fixture_alpha;'],
 ['default-widened','ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control GRANT UPDATE ON TABLES TO fixture_alpha;'],
 ['default-grant-option','ALTER DEFAULT PRIVILEGES FOR ROLE fixture_owner IN SCHEMA restore_control GRANT SELECT ON TABLES TO fixture_alpha WITH GRANT OPTION;'],
];
