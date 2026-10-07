-- SOURCE PROPOSAL ONLY. No installation, backfill or native display enablement.
-- Requires reviewed before-state, section 10 backup, PG17/JWT delta rehearsal
-- and a numbered byte-identical mirror before the one production dispatch.
-- Rollback after disabling new consumers, only for this additive contract:
-- BEGIN;
-- DROP FUNCTION public.native_push_device_binding(text) RESTRICT;
-- COMMIT;
-- Both register_push_device signatures, endpoint rows and consent stay unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $before$
begin
  if not pg_try_advisory_xact_lock(335,335) then
    raise exception 'native_push_device_binding_lock_refused';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='native_push_device_binding') then
    raise exception 'native_push_device_binding_existing_name_refused';
  end if;
  if to_regclass('public.user_push_devices') is null then
    raise exception 'native_push_device_binding_dependency_refused';
  end if;
end
$before$;

lock table public.user_push_devices in share update exclusive mode;
do $dependency$
begin
  if not exists (select 1 from pg_class c where c.oid='public.user_push_devices'::regclass
      and c.relrowsecurity and c.relowner='postgres'::regrole and c.relkind='r')
    or not exists (select 1 from pg_proc p
      where p.oid=to_regprocedure('public.native_message_preview_recipient()')
        and p.proowner='postgres'::regrole and p.provolatile='s' and p.prosecdef
        and p.prorettype='uuid'::regtype and not p.proretset
        and p.proconfig=array['search_path=pg_catalog']) then
    raise exception 'native_push_device_binding_dependency_refused';
  end if;
  if has_any_column_privilege('anon','public.user_push_devices','SELECT,INSERT,UPDATE,REFERENCES')
    or has_any_column_privilege('authenticated','public.user_push_devices','SELECT,INSERT,UPDATE,REFERENCES')
    or has_table_privilege('anon','public.user_push_devices','DELETE,TRUNCATE,TRIGGER')
    or has_table_privilege('authenticated','public.user_push_devices','DELETE,TRUNCATE,TRIGGER') then
    raise exception 'native_push_device_binding_endpoint_acl_refused';
  end if;
end
$dependency$;

do $index$
begin
  if not exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
    where i.indrelid='public.user_push_devices'::regclass
      and c.relname='user_push_devices_provider_token_hash_uidx'
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indnkeyatts=2 and i.indnatts=2 and i.indpred is null and i.indexprs is null
      and i.indkey[0]=(select attnum from pg_attribute
        where attrelid=i.indrelid and attname='provider' and not attisdropped)
      and i.indkey[1]=(select attnum from pg_attribute
        where attrelid=i.indrelid and attname='token_hash' and not attisdropped)) then
    raise exception 'native_push_device_binding_index_refused';
  end if;
end
$index$;

-- Definer is narrowly required: authenticated has no endpoint-table SELECT.
-- Live recipient authorization is the installed D335 helper, not a client claim.
create function public.native_push_device_binding(p_token_hash text)
returns table(binding_v smallint,recipient_id uuid,session_id uuid,device_id uuid)
language plpgsql stable security definer
set search_path = pg_catalog
as $fn$
declare
  v_recipient uuid;
  v_session uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return; end if;
  v_recipient := public.native_message_preview_recipient();
  if v_recipient is null then return; end if;
  v_session := (auth.jwt()->>'session_id')::uuid;
  return query
  with matching as materialized (
    select d.id,d.user_id,d.session_id,d.platform,d.enabled,d.revoked_at
    from public.user_push_devices d
    where d.provider='fcm' and d.token_hash=p_token_hash
  )
  select 1::smallint,v_recipient,v_session,d.id
  from matching d
  where (select count(*) from matching)=1
    and d.user_id=v_recipient and d.session_id=v_session
    and d.platform='android' and d.enabled is true and d.revoked_at is null;
end
$fn$;
alter function public.native_push_device_binding(text) owner to postgres;
revoke all on function public.native_push_device_binding(text)
  from public,anon,authenticated,service_role;
grant execute on function public.native_push_device_binding(text) to authenticated;

do $check$
declare
  p record;
begin
  select * into p from pg_proc where oid=to_regprocedure('public.native_push_device_binding(text)');
  if not found then raise exception 'native_push_device_binding_missing'; end if;
  if p.proowner<>'postgres'::regrole or p.provolatile<>'s' or not p.prosecdef
    or p.prolang<>(select oid from pg_language where lanname='plpgsql')
    or p.proconfig is distinct from array['search_path=pg_catalog']
    or p.prorettype<>'record'::regtype or not p.proretset or p.pronargs<>1
    or p.proallargtypes is distinct from array[
      'text'::regtype::oid,'smallint'::regtype::oid,'uuid'::regtype::oid,
      'uuid'::regtype::oid,'uuid'::regtype::oid]
    or p.proargmodes is distinct from array['i','t','t','t','t']::"char"[]
    or p.proargnames is distinct from array[
      'p_token_hash','binding_v','recipient_id','session_id','device_id']
    or md5(p.prosrc)<>'4e2ec69d5c4fe0cb900000ecf276c28c' then
    raise exception 'native_push_device_binding_definition_refused';
  end if;
  if exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee not in ('postgres'::regrole::oid,'authenticated'::regrole::oid)
        or a.privilege_type<>'EXECUTE'
        or (a.grantee='authenticated'::regrole::oid and a.is_grantable))
    or not has_function_privilege('authenticated',p.oid,'EXECUTE')
    or has_function_privilege('anon',p.oid,'EXECUTE')
    or has_function_privilege('service_role',p.oid,'EXECUTE') then
    raise exception 'native_push_device_binding_acl_refused';
  end if;
end
$check$;
commit;
