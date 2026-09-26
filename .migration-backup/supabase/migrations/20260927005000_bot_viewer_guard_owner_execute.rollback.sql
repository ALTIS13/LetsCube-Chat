begin;
set local search_path = '';
set local lock_timeout = '5s';

do $prestate$
begin
  if pg_catalog.to_regprocedure('private.bot_viewer_interface_valid(uuid)') is null
     or not exists (
       select 1 from pg_catalog.pg_proc p,
         lateral pg_catalog.aclexplode(p.proacl) acl
       where p.oid = 'private.bot_viewer_interface_valid(uuid)'::regprocedure
         and acl.grantee = 'postgres'::regrole
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'bot_viewer_guard_execute_rollback_prestate_drift';
  end if;
end
$prestate$;

revoke execute on function private.bot_viewer_interface_valid(uuid) from postgres;

do $poststate$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(p.proacl) acl
    where p.oid = 'private.bot_viewer_interface_valid(uuid)'::regprocedure
      and acl.grantee = 'postgres'::regrole
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'bot_viewer_guard_execute_rollback_poststate_invalid';
  end if;
end
$poststate$;

commit;
