-- Proposal only. Do not apply automatically.
--
-- Goal:
--   Remove default anonymous/PUBLIC EXECUTE access from public functions.
--   Keep app RPC/helpers available to authenticated users and trusted backend
--   service-role callers.
--
-- Why:
--   Live read-only audit on 2026-06-21 showed many SECURITY DEFINER and app
--   RPC functions callable by anon through default EXECUTE grants. Most of
--   them perform internal auth/permission checks, but anonymous execute grants
--   broaden the exposed surface unnecessarily.
--
-- Safety:
--   - This does not disable RLS.
--   - This does not revoke authenticated/service_role execution.
--   - If a future intentionally public RPC is needed, grant it to anon
--     explicitly after reviewing its unauthenticated contract.

begin;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.oid::regprocedure::text
  loop
    execute format('revoke execute on function %s from public', fn.signature);
    execute format('revoke execute on function %s from anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end $$;

commit;

-- Verification after manual apply:
--
-- select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function_name
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and has_function_privilege('anon', p.oid, 'EXECUTE')
-- order by 1;
--
-- Expected: zero rows, unless an intentionally public RPC was explicitly
-- re-granted to anon after review.
