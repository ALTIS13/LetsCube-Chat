// Same-copy raw catalog evidence only. OIDs/generated names are intentionally
// retained; these queries are not a cross-restore or whole-schema admission gate.
export const constraintInventorySql = `SET search_path=''; SELECT COALESCE(jsonb_agg(
  jsonb_build_object(
    'schema', n.nspname,
    'name', c.conname,
    'type', c.contype,
    'table', CASE WHEN c.conrelid = 0 THEN NULL ELSE c.conrelid::regclass::text END,
    'domain', CASE WHEN c.contypid = 0 THEN NULL ELSE c.contypid::regtype::text END,
    'definition', pg_get_constraintdef(c.oid, false),
    'validated', c.convalidated,
    'deferrable', c.condeferrable,
    'deferred', c.condeferred,
    'catalog', to_jsonb(c)
  ) ORDER BY n.nspname, c.conrelid, c.contypid, c.conname, c.oid
), '[]'::jsonb)
FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp_';`;

export const triggerInventorySql = `SET search_path=''; SELECT COALESCE(jsonb_agg(
  jsonb_build_object(
    'schema', n.nspname,
    'table', t.tgrelid::regclass::text,
    'name', t.tgname,
    'function', t.tgfoid::regprocedure::text,
    'enabled', t.tgenabled,
    'internal', t.tgisinternal,
    'definition', pg_get_triggerdef(t.oid, false),
    'constraint', CASE WHEN t.tgconstraint = 0 THEN NULL ELSE
      jsonb_build_object('name', c.conname, 'catalog', to_jsonb(c)) END,
    'catalog', to_jsonb(t)
  ) ORDER BY n.nspname, t.tgrelid, t.tgname, t.oid
), '[]'::jsonb)
FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = r.relnamespace
LEFT JOIN pg_constraint c ON c.oid = t.tgconstraint
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp_';`;
