-- Rollback only this reviewed retirement change; never use CASCADE.
-- Existing revoked rows stay revoked. Re-enabling them is a new registration,
-- not rollback. No unrelated Auth state, RLS or client grants are changed.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
set local role postgres;
set local search_path=pg_catalog;
do $rollback$
declare
  v_impl regprocedure := 'private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)'::regprocedure;
  v_current text := pg_get_functiondef(v_impl);
  v_previous text;
  v_function regprocedure := to_regprocedure('private.retire_push_devices_on_session_delete()');
begin
  v_previous := replace(v_current,
    'if (p_require_session or nullif(auth.jwt()->>''session_id'', '''') is not null) and v_session is null then',
    'if p_require_session and v_session is null then');
  if md5(v_previous) <> 'c09ccc9fb588c9b8a5053124228d87f0' or v_previous=v_current
     or not exists (select 1 from pg_proc where oid=v_impl and proowner='postgres'::regrole
       and prosecdef and proacl=array['postgres=X/postgres']::aclitem[])
     or not exists (select 1 from pg_proc where oid=v_function and proowner='postgres'::regrole
       and prosecdef and prorettype='trigger'::regtype and pronargs=0
       and proconfig=array['search_path=pg_catalog'] and md5(prosrc)='a395c8ebb579197a10f0cb1b45c4214d'
       and proacl=array['postgres=X/postgres']::aclitem[])
     or not exists (select 1 from pg_trigger where tgrelid='auth.sessions'::regclass
       and tgname='retire_push_devices_before_session_delete'
       and tgfoid=v_function and tgtype=11 and tgenabled='O'
       and not tgisinternal and tgnargs=0 and tgqual is null) then
    raise exception 'push_retirement_rollback_drift';
  end if;
  set local role supabase_auth_admin;
  drop trigger retire_push_devices_before_session_delete on auth.sessions;
  set local role postgres;
  drop function private.retire_push_devices_on_session_delete();
  execute v_previous;
  if md5(pg_get_functiondef(v_impl)) <> 'c09ccc9fb588c9b8a5053124228d87f0'
     or to_regprocedure('private.retire_push_devices_on_session_delete()') is not null
     or exists (select 1 from pg_trigger where tgrelid='auth.sessions'::regclass and tgname='retire_push_devices_before_session_delete') then
    raise exception 'push_retirement_rollback_self_check';
  end if;
end
$rollback$;
commit;
