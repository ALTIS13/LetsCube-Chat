-- The existing delivery guard is SECURITY DEFINER owned by postgres. The
-- private validator created by the prior migration is owned by supabase_admin.
-- Only the guard's owner needs EXECUTE; no client role receives it.
begin;
set local search_path = '';
set local lock_timeout = '5s';

do $prestate$
declare
  v_guard_owner text;
  v_validator_owner text;
begin
  select pg_catalog.pg_get_userbyid(p.proowner) into v_guard_owner
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('private.bot_update_still_visible(uuid,text,jsonb)');
  select pg_catalog.pg_get_userbyid(p.proowner) into v_validator_owner
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('private.bot_viewer_interface_valid(uuid)');
  if v_guard_owner is distinct from 'postgres'
     or v_validator_owner is distinct from 'supabase_admin'
     or exists (
       select 1 from pg_catalog.pg_proc p,
         lateral pg_catalog.aclexplode(p.proacl) acl
       where p.oid = 'private.bot_viewer_interface_valid(uuid)'::regprocedure
         and acl.grantee = 'postgres'::regrole
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'bot_viewer_guard_execute_prestate_drift';
  end if;
end
$prestate$;

grant execute on function private.bot_viewer_interface_valid(uuid) to postgres;

do $poststate$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(p.proacl) acl
    where p.oid = 'private.bot_viewer_interface_valid(uuid)'::regprocedure
      and acl.grantee = 'postgres'::regrole
      and acl.privilege_type = 'EXECUTE'
  ) or pg_catalog.has_function_privilege('anon', 'private.bot_viewer_interface_valid(uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'private.bot_viewer_interface_valid(uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', 'private.bot_viewer_interface_valid(uuid)', 'EXECUTE')
    or pg_catalog.pg_has_role('anon', 'postgres', 'MEMBER')
    or pg_catalog.pg_has_role('authenticated', 'postgres', 'MEMBER')
    or pg_catalog.pg_has_role('service_role', 'postgres', 'MEMBER') then
    raise exception 'bot_viewer_guard_execute_poststate_invalid';
  end if;
end
$poststate$;

commit;
