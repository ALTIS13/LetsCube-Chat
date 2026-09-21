-- PROPOSAL rollback for 20260921114126_android_push_session_binding.sql.
-- Run as postgres after reversing dependent migrations. Existing device rows,
-- tokens, generic push, policies and unregister RPC are retained. The new
-- session/capability metadata is intentionally discarded. Never use CASCADE.
-- Any dependency/drift error aborts the complete transaction; do not skip it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public, extensions;

do $guard$
declare
  v_expected record;
  v_proc record;
begin
  if current_user <> 'postgres'
     or not exists (select 1 from pg_roles where rolname='postgres' and not rolsuper and rolbypassrls)
     or not exists (select 1 from pg_class where oid=to_regclass('public.user_push_devices')
       and relowner='postgres'::regrole and relrowsecurity)
     or not exists (select 1 from pg_namespace where nspname='private' and nspowner='postgres'::regrole) then
    raise exception 'push_binding_rollback_owner_guard';
  end if;
  lock table public.user_push_devices in access exclusive mode;
  for v_expected in select * from (values
    ('public.register_push_device(text,text,text,text,text,text,text)', 'd1b5be092af5067ba458125380f50213'),
    ('public.register_push_device(text,text,text,text,text,text,text,smallint)', 'fac1fca8ceee98da68921e8b74b140ee'),
    ('private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)', 'c09ccc9fb588c9b8a5053124228d87f0')
  ) as expected(signature, hash) loop
    select * into v_proc from pg_proc where oid=to_regprocedure(v_expected.signature);
    if not found then raise exception 'push_binding_rollback_incomplete_state'; end if;
    if v_proc.proowner <> 'postgres'::regrole or md5(pg_get_functiondef(v_proc.oid)) <> v_expected.hash
       or v_proc.proacl is distinct from (case
         when v_expected.signature = 'public.register_push_device(text,text,text,text,text,text,text)'
           then array['postgres=X/postgres','service_role=X/postgres','authenticated=X/postgres']::aclitem[]
         when v_expected.signature like 'public.%' then array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
         else array['postgres=X/postgres']::aclitem[] end) then
      raise exception 'push_binding_rollback_function_drift';
    end if;
  end loop;
  if (select count(*) from pg_attribute where attrelid='public.user_push_devices'::regclass
      and not attisdropped and not attnotnull and not atthasdef and attidentity='' and attgenerated=''
      and ((attname='session_id' and atttypid='uuid'::regtype)
        or (attname='voice_call_protocol' and atttypid='smallint'::regtype))) <> 2
     or not exists (select 1 from pg_constraint where conrelid='public.user_push_devices'::regclass
       and conname='user_push_devices_session_id_fkey' and convalidated and not condeferrable
       and pg_get_constraintdef(oid)='FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE SET NULL')
     or not exists (select 1 from pg_constraint where conrelid='public.user_push_devices'::regclass
       and conname='user_push_devices_voice_call_protocol_check' and convalidated and not condeferrable
       and pg_get_constraintdef(oid)='CHECK (((voice_call_protocol IS NULL) OR ((voice_call_protocol = 1) AND (platform = ''android''::text) AND (provider = ''fcm''::text))))') then
    raise exception 'push_binding_rollback_column_drift';
  end if;
  -- Dropping a column also drops local indexes/constraints even with RESTRICT.
  -- Refuse additional local dependencies instead of silently deleting them.
  if exists (select 1 from pg_depend d join pg_attribute a
      on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
      where d.refclassid='pg_class'::regclass and a.attrelid='public.user_push_devices'::regclass
        and a.attname in ('session_id','voice_call_protocol') and not a.attisdropped
        and not (d.classid='pg_constraint'::regclass and d.objid in (
          select oid from pg_constraint where conrelid='public.user_push_devices'::regclass
            and conname in ('user_push_devices_session_id_fkey','user_push_devices_voice_call_protocol_check')))) then
    raise exception 'push_binding_rollback_dependency' using errcode='2BP01';
  end if;
end
$guard$;

-- Exact live definition, including original comments, whitespace and defaults.
CREATE OR REPLACE FUNCTION public.register_push_device(p_platform text, p_provider text, p_token text, p_token_hash text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_device_model text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_token_hash text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_platform <> 'android' or p_provider <> 'fcm' then
    raise exception 'unsupported_push_provider';
  end if;
  if length(v_token) < 20 or length(v_token) > 4096 then
    raise exception 'invalid_push_token';
  end if;

  -- Hash server-side. p_token_hash remains in the signature for backwards
  -- compatibility but is not trusted.
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.user_push_devices (
    user_id,
    platform,
    provider,
    token,
    token_hash,
    device_id,
    device_model,
    app_version,
    enabled,
    revoked_at,
    last_seen_at,
    updated_at
  )
  values (
    auth.uid(),
    'android',
    'fcm',
    v_token,
    v_token_hash,
    nullif(left(btrim(coalesce(p_device_id, '')), 160), ''),
    nullif(left(btrim(coalesce(p_device_model, '')), 300), ''),
    nullif(left(btrim(coalesce(p_app_version, '')), 60), ''),
    true,
    null,
    now(),
    now()
  )
  on conflict (provider, token_hash) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      token = excluded.token,
      device_id = excluded.device_id,
      device_model = excluded.device_model,
      app_version = excluded.app_version,
      enabled = true,
      revoked_at = null,
      last_seen_at = now(),
      updated_at = now();
end
$function$;
revoke all on function public.register_push_device(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.register_push_device(text,text,text,text,text,text,text) to authenticated;
drop function public.register_push_device(text,text,text,text,text,text,text,smallint) restrict;
drop function private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean) restrict;
alter table public.user_push_devices
  drop constraint user_push_devices_session_id_fkey,
  drop constraint user_push_devices_voice_call_protocol_check,
  drop column session_id restrict,
  drop column voice_call_protocol restrict;

do $check$
begin
  if md5(pg_get_functiondef('public.register_push_device(text,text,text,text,text,text,text)'::regprocedure))
       <> '1ec557fdad31f1c6bd4e436511ef40ac'
     or not exists (select 1 from pg_proc where oid='public.register_push_device(text,text,text,text,text,text,text)'::regprocedure
       and proowner='postgres'::regrole and pronargdefaults=4
       and proacl = array['postgres=X/postgres','service_role=X/postgres','authenticated=X/postgres']::aclitem[])
     or to_regprocedure('public.register_push_device(text,text,text,text,text,text,text,smallint)') is not null
     or to_regprocedure('private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)') is not null
     or exists (select 1 from pg_attribute where attrelid='public.user_push_devices'::regclass
       and attname in ('session_id','voice_call_protocol') and not attisdropped) then
    raise exception 'push_binding_rollback_self_check';
  end if;
end
$check$;
commit;
