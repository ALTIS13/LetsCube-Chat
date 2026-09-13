-- Every function, table, policy and trigger the database actually has, one per
-- line, for `scripts/migration-inventory.mjs` to compare against the recorded
-- migrations.
--
-- Read-only, inside a transaction that ends in ROLLBACK, and it names objects
-- rather than reading any row: no message, no profile, no phone number and no
-- token passes through it. Safe to run against production.
--
--   ssh -i ~/.ssh/letscube_ed25519 root@ms.letscube.ru \
--     'docker exec -i supabase-db psql -U supabase_admin -d postgres' \
--     < scripts/migration-inventory.sql > output/live-objects.txt
\pset pager off
\t on
\a

begin;
set local transaction read only;

select 'F|' || n.nspname || '.' || p.proname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private', 'storage');

select 'T|' || schemaname || '.' || tablename
  from pg_catalog.pg_tables
 where schemaname in ('public', 'private', 'storage');

select 'P|' || policyname || '@' || schemaname || '.' || tablename
  from pg_catalog.pg_policies
 where schemaname in ('public', 'private', 'storage');

select 'G|' || tgname
  from pg_catalog.pg_trigger
 where not tgisinternal;

rollback;
