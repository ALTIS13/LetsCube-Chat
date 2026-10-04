// Fixed capture, not a validator: retain unknown positive attributes and overloads.
export const pg17HeaderQuerySql = `
WITH catalog_headers AS (
  SELECT c.oid, c.relname,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', a.attname,
        'type', tn.nspname::pg_catalog.text || '.' || t.typname::pg_catalog.text
      ) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute AS a
      LEFT JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
      LEFT JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
      WHERE a.attrelid = c.oid AND a.attnum > 0
    ), '[]'::pg_catalog.jsonb) AS attributes
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS cn ON cn.oid = c.relnamespace
  WHERE cn.nspname = 'pg_catalog'
    AND c.relname IN ('pg_type', 'pg_enum', 'pg_range', 'pg_constraint')
), function_headers AS (
  SELECT p.oid, p.proname,
    pg_catalog.jsonb_build_object(
      'oid', p.oid::pg_catalog.int8,
      'name', p.proname,
      'kind', p.prokind,
      'volatility', p.provolatile,
      'returnsSet', p.proretset,
      'variadicTypeOid', p.provariadic::pg_catalog.int8,
      'inputs', CASE WHEN p.proargtypes IS NULL THEN NULL ELSE ARRAY(
        SELECT tn.nspname::pg_catalog.text || '.' || t.typname::pg_catalog.text
        FROM pg_catalog.unnest(p.proargtypes::pg_catalog.oid[]) WITH ORDINALITY AS arg(type_oid, position)
        LEFT JOIN pg_catalog.pg_type AS t ON t.oid = arg.type_oid
        LEFT JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
        ORDER BY arg.position
      ) END,
      'output', rn.nspname::pg_catalog.text || '.' || rt.typname::pg_catalog.text,
      'allTypes', CASE WHEN p.proallargtypes IS NULL THEN NULL ELSE ARRAY(
        SELECT tn.nspname::pg_catalog.text || '.' || t.typname::pg_catalog.text
        FROM pg_catalog.unnest(p.proallargtypes) WITH ORDINALITY AS arg(type_oid, position)
        LEFT JOIN pg_catalog.pg_type AS t ON t.oid = arg.type_oid
        LEFT JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
        ORDER BY arg.position
      ) END,
      'modes', p.proargmodes,
      'names', p.proargnames
    ) AS signature
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace
  LEFT JOIN pg_catalog.pg_type AS rt ON rt.oid = p.prorettype
  LEFT JOIN pg_catalog.pg_namespace AS rn ON rn.oid = rt.typnamespace
  WHERE pn.nspname = 'pg_catalog'
    AND p.proname IN ('pg_get_object_address', 'pg_identify_object_as_address')
)
SELECT pg_catalog.jsonb_build_object(
  'profileId', 'pg17.6-prerequisite',
  'header', pg_catalog.jsonb_build_object(
    'serverVersionNum', pg_catalog.current_setting('server_version_num')::pg_catalog.int4,
    'catalogVersion', (SELECT catalog_version_no FROM pg_catalog.pg_control_system()),
    'catalogs', COALESCE((
      SELECT pg_catalog.jsonb_object_agg(relname, pg_catalog.jsonb_build_object(
        'oid', oid::pg_catalog.int8, 'attributes', attributes
      ) ORDER BY relname::pg_catalog.text COLLATE pg_catalog."C", oid)
      FROM catalog_headers
    ), '{}'::pg_catalog.jsonb),
    'functions', COALESCE((
      SELECT pg_catalog.jsonb_agg(signature ORDER BY proname::pg_catalog.text COLLATE pg_catalog."C", oid)
      FROM function_headers
    ), '[]'::pg_catalog.jsonb)
  )
) AS payload;
`;
