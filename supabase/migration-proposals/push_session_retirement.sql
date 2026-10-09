-- Apply only after exact-target verification, fresh verified backup and PG17
-- rehearsal. Rollback: push_session_retirement.rollback.sql in full, no CASCADE.
-- No existing/unbound endpoint backfill; no token/provider/client identity change.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
set local role postgres;
set local search_path = pg_catalog;

do $migration$
declare
  v_impl regprocedure := 'private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)'::regprocedure;
  v_previous text;
  v_replacement text;
  v_before jsonb;
  v_after jsonb;
  v_function regprocedure;
begin
  if current_user <> 'postgres' or not (select rolbypassrls from pg_roles where rolname=current_user)
     or not has_table_privilege(current_user,'auth.sessions','TRIGGER')
     or (select pg_get_userbyid(relowner) from pg_class where oid='public.user_push_devices'::regclass) <> 'postgres'
     or (select pg_get_userbyid(relowner) from pg_class where oid='auth.sessions'::regclass) <> 'supabase_auth_admin'
     or not exists (select 1 from pg_constraint where conrelid='public.user_push_devices'::regclass
       and conname='user_push_devices_session_id_fkey' and confrelid='auth.sessions'::regclass
       and confdeltype='n' and convalidated and not condeferrable)
     or exists (select 1 from pg_trigger where tgrelid='auth.sessions'::regclass and not tgisinternal)
     or to_regprocedure('private.retire_push_devices_on_session_delete()') is not null then
    raise exception 'push_retirement_target_drift';
  end if;
  select pg_get_functiondef(v_impl) into v_previous;
  if md5(v_previous) <> 'c09ccc9fb588c9b8a5053124228d87f0'
     or not exists (select 1 from pg_proc where oid=v_impl and proowner='postgres'::regrole
       and prosecdef and proacl=array['postgres=X/postgres']::aclitem[]) then
    raise exception 'push_retirement_registration_drift';
  end if;
  select jsonb_agg(jsonb_build_array(c.oid::regclass::text,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
    (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid=c.oid)) order by c.oid)
    into v_before from pg_class c where c.oid in ('auth.sessions'::regclass,'public.user_push_devices'::regclass);

  -- A still-valid JWT for a deleted session must not revive an unbound endpoint.
  -- Truly session-less legacy callers retain the existing compatibility path.
  v_replacement := replace(v_previous,
    'if p_require_session and v_session is null then',
    'if (p_require_session or nullif(auth.jwt()->>''session_id'', '''') is not null) and v_session is null then');
  execute v_replacement;
  execute $ddl$create function private.retire_push_devices_on_session_delete()
    returns trigger language plpgsql security definer set search_path=pg_catalog
    as $fn$
begin
  update public.user_push_devices
     set enabled=false, revoked_at=coalesce(revoked_at,now()), updated_at=now()
   where session_id=old.id and user_id=old.user_id
     and (enabled or revoked_at is null);
  return old;
end
$fn$;$ddl$;
  revoke all on function private.retire_push_devices_on_session_delete() from public,anon,authenticated,service_role,supabase_auth_admin;
  create trigger retire_push_devices_before_session_delete before delete on auth.sessions
    for each row execute function private.retire_push_devices_on_session_delete();
  v_function := 'private.retire_push_devices_on_session_delete()'::regprocedure;

  select jsonb_agg(jsonb_build_array(c.oid::regclass::text,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
    (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid=c.oid)) order by c.oid)
    into v_after from pg_class c where c.oid in ('auth.sessions'::regclass,'public.user_push_devices'::regclass);
  if v_before is distinct from v_after
     or md5(pg_get_functiondef(v_impl)) <> md5(v_replacement)
     or not exists (select 1 from pg_proc where oid=v_impl and proowner='postgres'::regrole
       and prosecdef and proacl=array['postgres=X/postgres']::aclitem[])
     or not exists (select 1 from pg_proc where oid=v_function and proowner='postgres'::regrole
       and prosecdef and prorettype='trigger'::regtype and pronargs=0 and proconfig=array['search_path=pg_catalog']
       and md5(prosrc)='a395c8ebb579197a10f0cb1b45c4214d'
       and proacl=array['postgres=X/postgres']::aclitem[])
     or not exists (select 1 from pg_trigger where tgrelid='auth.sessions'::regclass
       and tgname='retire_push_devices_before_session_delete' and tgfoid=v_function
       and tgtype=11 and tgenabled='O' and not tgisinternal and tgnargs=0 and tgqual is null) then
    raise exception 'push_retirement_self_check';
  end if;
end
$migration$;
commit;
