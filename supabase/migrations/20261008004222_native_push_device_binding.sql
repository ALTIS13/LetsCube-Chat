-- SOURCE PROPOSAL ONLY. No installation, backfill or native display enablement.
-- Requires reviewed before-state, section 10 backup, PG17/JWT delta rehearsal
-- and a numbered byte-identical mirror before the one production dispatch.
-- Rollback after disabling new consumers, only for this additive contract:
-- BEGIN;
-- DROP FUNCTION public.native_push_device_binding(text) RESTRICT;
-- COMMIT;
-- Both register_push_device signatures, endpoint rows and consent stay unchanged.
begin;
set local search_path=pg_catalog,public;
set local lock_timeout='5s'; set local statement_timeout='60s';
do $binding_lock$ begin
 if not pg_try_advisory_xact_lock(335,335) then raise exception 'binding_lock_refused'; end if;
end $binding_lock$;
lock table auth.users,auth.sessions,public.user_push_devices,public.notification_preview_preferences in share update exclusive mode;
do $binding_before$
  declare digest text;
  begin
  if current_database()<>'postgres' or current_user<>'supabase_admin'
    or (select system_identifier::text from pg_control_system())<>'7652726644035760163'
    or (select oid::text from pg_database where datname=current_database())<>'5'
    or current_setting('server_version')<>'17.6' or inet_server_addr() is not null
    or exists(select 1 from pg_tablespace where spcname not in ('pg_default','pg_global'))
    then raise exception 'binding_target_refused'; end if;
  if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.native_message_preview_recipient()') and md5(prosrc)='1378c43b640fd36122c1a9a89a1a88b2')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.native_message_preview_capability(uuid)') and md5(prosrc)='98aed76f949dafe086358e1c58c2d214')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.native_message_notification_preview(uuid,uuid)') and md5(prosrc)='440bcb0877e43b9342ff54ff48394669')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.register_push_device(text,text,text,text,text,text,text)') and md5(prosrc)='71eb8c33406a28b1f2e6f40937c07cd3')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.register_push_device(text,text,text,text,text,text,text,smallint)') and md5(prosrc)='759c806109aa8254d9acd2302dee1e58')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)') and md5(prosrc)='3b0548bec5e1bcc49d5030acf8cf1534')
    then raise exception 'binding_old_definition_refused'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='native_push_device_binding')
    then raise exception 'binding_existing_name_refused'; end if;
  select value into digest from (select md5(metadata::text) from (select jsonb_build_object(
'namespaces',(select jsonb_agg(jsonb_build_array(n.nspname,r.rolname,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname) from pg_namespace n join pg_roles r on r.oid=n.nspowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'defaultACL',(select jsonb_agg(jsonb_build_array(r.rolname,coalesce(n.nspname,''),d.defaclobjtype,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(d.defaclacl) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by r.rolname,coalesce(n.nspname,''),d.defaclobjtype) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace),
'database',(select jsonb_build_array(d.datname,r.rolname,d.encoding,d.datcollate,d.datctype,d.datlocprovider,to_jsonb(d)->'datlocale',(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) from pg_database d join pg_roles r on r.oid=d.datdba where d.datname='postgres'),
'roles',(select jsonb_agg(to_jsonb(r)-'oid' order by rolname) from pg_authid r),
'memberships',(select jsonb_agg(jsonb_build_array(a.rolname,b.rolname,g.rolname,m.admin_option,m.inherit_option,m.set_option) order by a.rolname,b.rolname,g.rolname) from pg_auth_members m join pg_roles a on a.oid=m.roleid join pg_roles b on b.oid=m.member join pg_roles g on g.oid=m.grantor),
'settings',(select jsonb_agg(jsonb_build_array(coalesce(d.datname,''),coalesce(r.rolname,''),s.setconfig) order by coalesce(d.datname,''),coalesce(r.rolname,'')) from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase left join pg_roles r on r.oid=s.setrole),
'extensions',(select jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname,r.rolname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace join pg_roles r on r.oid=e.extowner),
'relations',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,r.rolname,c.relrowsecurity,c.relforcerowsecurity,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,p.prosecdef,p.provolatile,p.proconfig,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor),md5(p.prosrc)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname not in ('pg_catalog','information_schema')),
'policies',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,(select jsonb_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC')) from unnest(p.polroles) x left join pg_roles r on r.oid=x),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by n.nspname,c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace))) d335(metadata)) binding(value);
  if digest is distinct from '38623c9739e11681d0509bc52310a32b' then raise exception 'binding_before_security_refused'; end if;
  select value into digest from (select md5(metadata::text) from (select jsonb_build_object(
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,a.attnum,a.attname,
   format_type(a.atttypid,a.atttypmod),tn.nspname,ty.typname,a.attnotnull,
   pg_get_expr(d.adbin,d.adrelid,true),a.attidentity,a.attgenerated,
   cn.nspname,coll.collname) order by n.nspname,c.relname,a.attnum),'[]'::jsonb)
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_type ty on ty.oid=a.atttypid join pg_namespace tn on tn.oid=ty.typnamespace
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   left join pg_collation coll on coll.oid=a.attcollation left join pg_namespace cn on cn.oid=coll.collnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences') and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,k.conname,k.contype,
   k.convalidated,k.condeferrable,k.condeferred,k.connoinherit,pg_get_constraintdef(k.oid,true))
   order by n.nspname,c.relname,k.conname),'[]'::jsonb)
   from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,ic.relname,
   pg_get_indexdef(i.indexrelid),i.indisunique,i.indisprimary,i.indisexclusion,i.indimmediate,
   i.indisvalid,i.indisready,i.indislive) order by n.nspname,c.relname,ic.relname),'[]'::jsonb)
   from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_class ic on ic.oid=i.indexrelid where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,t.tgname,
   pg_get_triggerdef(t.oid,true),t.tgenabled,t.tgisinternal,pn.nspname,p.proname,
   pg_get_function_identity_arguments(p.oid),t.tgdeferrable,t.tginitdeferred)
   order by n.nspname,c.relname,t.tgname),'[]'::jsonb)
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
   left join pg_constraint fk on fk.oid=t.tgconstraint
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')
   and true -- D335_DEPENDENCY_TRIGGER_SCOPE
  )) as metadata) d335(metadata)) binding(value);
  if digest is distinct from '2e7130139c01a19b6129ecb60b1c0db1' then raise exception 'binding_before_dependency_refused'; end if;
  select value into digest from (select md5(jsonb_agg(jsonb_build_array(s.signature,
    pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),p.proowner::regrole::text,
    p.prolang,p.provolatile,p.prosecdef,p.proconfig,md5(p.prosrc)) order by s.signature)::text)
    from unnest(array['public.native_message_preview_recipient()','public.native_message_preview_capability(uuid)','public.native_message_notification_preview(uuid,uuid)','public.register_push_device(text,text,text,text,text,text,text)','public.register_push_device(text,text,text,text,text,text,text,smallint)','private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)']) s(signature)
    left join pg_proc p on p.oid=to_regprocedure(s.signature)) binding(value);
  if digest is distinct from 'd02e819e85395e223c3a86cdf5559d27' then raise exception 'binding_before_functions_refused'; end if;
  end $binding_before$;
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
do $binding_preserve$
  declare digest text;
  begin
  if current_database()<>'postgres' or current_user<>'supabase_admin'
    or (select system_identifier::text from pg_control_system())<>'7652726644035760163'
    or (select oid::text from pg_database where datname=current_database())<>'5'
    or current_setting('server_version')<>'17.6' or inet_server_addr() is not null
    or exists(select 1 from pg_tablespace where spcname not in ('pg_default','pg_global'))
    then raise exception 'binding_target_refused'; end if;
  if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.native_message_preview_recipient()') and md5(prosrc)='1378c43b640fd36122c1a9a89a1a88b2')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.native_message_preview_capability(uuid)') and md5(prosrc)='98aed76f949dafe086358e1c58c2d214')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.native_message_notification_preview(uuid,uuid)') and md5(prosrc)='440bcb0877e43b9342ff54ff48394669')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.register_push_device(text,text,text,text,text,text,text)') and md5(prosrc)='71eb8c33406a28b1f2e6f40937c07cd3')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('public.register_push_device(text,text,text,text,text,text,text,smallint)') and md5(prosrc)='759c806109aa8254d9acd2302dee1e58')
    then raise exception 'binding_old_definition_refused'; end if;
if not exists(select 1 from pg_proc
    where oid=to_regprocedure('private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)') and md5(prosrc)='3b0548bec5e1bcc49d5030acf8cf1534')
    then raise exception 'binding_old_definition_refused'; end if;
  select value into digest from (select md5((metadata || jsonb_build_object('functions',
      (select jsonb_agg(item order by position)
       from jsonb_array_elements(metadata->'functions') with ordinality e(item,position)
       where not (item->>0='public' and item->>1='native_push_device_binding'
         and item->>2='p_token_hash text'))))::text) from (select jsonb_build_object(
'namespaces',(select jsonb_agg(jsonb_build_array(n.nspname,r.rolname,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname) from pg_namespace n join pg_roles r on r.oid=n.nspowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'defaultACL',(select jsonb_agg(jsonb_build_array(r.rolname,coalesce(n.nspname,''),d.defaclobjtype,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(d.defaclacl) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by r.rolname,coalesce(n.nspname,''),d.defaclobjtype) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace),
'database',(select jsonb_build_array(d.datname,r.rolname,d.encoding,d.datcollate,d.datctype,d.datlocprovider,to_jsonb(d)->'datlocale',(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) from pg_database d join pg_roles r on r.oid=d.datdba where d.datname='postgres'),
'roles',(select jsonb_agg(to_jsonb(r)-'oid' order by rolname) from pg_authid r),
'memberships',(select jsonb_agg(jsonb_build_array(a.rolname,b.rolname,g.rolname,m.admin_option,m.inherit_option,m.set_option) order by a.rolname,b.rolname,g.rolname) from pg_auth_members m join pg_roles a on a.oid=m.roleid join pg_roles b on b.oid=m.member join pg_roles g on g.oid=m.grantor),
'settings',(select jsonb_agg(jsonb_build_array(coalesce(d.datname,''),coalesce(r.rolname,''),s.setconfig) order by coalesce(d.datname,''),coalesce(r.rolname,'')) from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase left join pg_roles r on r.oid=s.setrole),
'extensions',(select jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname,r.rolname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace join pg_roles r on r.oid=e.extowner),
'relations',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,r.rolname,c.relrowsecurity,c.relforcerowsecurity,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,p.prosecdef,p.provolatile,p.proconfig,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor),md5(p.prosrc)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname not in ('pg_catalog','information_schema')),
'policies',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,(select jsonb_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC')) from unnest(p.polroles) x left join pg_roles r on r.oid=x),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by n.nspname,c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace))) d335(metadata)) binding(value);
  if digest is distinct from '38623c9739e11681d0509bc52310a32b' then raise exception 'binding_security_preservation_refused'; end if;
  select value into digest from (select md5(metadata::text) from (select jsonb_build_object(
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,a.attnum,a.attname,
   format_type(a.atttypid,a.atttypmod),tn.nspname,ty.typname,a.attnotnull,
   pg_get_expr(d.adbin,d.adrelid,true),a.attidentity,a.attgenerated,
   cn.nspname,coll.collname) order by n.nspname,c.relname,a.attnum),'[]'::jsonb)
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_type ty on ty.oid=a.atttypid join pg_namespace tn on tn.oid=ty.typnamespace
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   left join pg_collation coll on coll.oid=a.attcollation left join pg_namespace cn on cn.oid=coll.collnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences') and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,k.conname,k.contype,
   k.convalidated,k.condeferrable,k.condeferred,k.connoinherit,pg_get_constraintdef(k.oid,true))
   order by n.nspname,c.relname,k.conname),'[]'::jsonb)
   from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,ic.relname,
   pg_get_indexdef(i.indexrelid),i.indisunique,i.indisprimary,i.indisexclusion,i.indimmediate,
   i.indisvalid,i.indisready,i.indislive) order by n.nspname,c.relname,ic.relname),'[]'::jsonb)
   from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_class ic on ic.oid=i.indexrelid where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,t.tgname,
   pg_get_triggerdef(t.oid,true),t.tgenabled,t.tgisinternal,pn.nspname,p.proname,
   pg_get_function_identity_arguments(p.oid),t.tgdeferrable,t.tginitdeferred)
   order by n.nspname,c.relname,t.tgname),'[]'::jsonb)
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
   left join pg_constraint fk on fk.oid=t.tgconstraint
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notification_preview_preferences','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')
   and true -- D335_DEPENDENCY_TRIGGER_SCOPE
  )) as metadata) d335(metadata)) binding(value);
  if digest is distinct from '2e7130139c01a19b6129ecb60b1c0db1' then raise exception 'binding_dependency_preservation_refused'; end if;
  select value into digest from (select md5(jsonb_agg(jsonb_build_array(s.signature,
    pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),p.proowner::regrole::text,
    p.prolang,p.provolatile,p.prosecdef,p.proconfig,md5(p.prosrc)) order by s.signature)::text)
    from unnest(array['public.native_message_preview_recipient()','public.native_message_preview_capability(uuid)','public.native_message_notification_preview(uuid,uuid)','public.register_push_device(text,text,text,text,text,text,text)','public.register_push_device(text,text,text,text,text,text,text,smallint)','private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean)']) s(signature)
    left join pg_proc p on p.oid=to_regprocedure(s.signature)) binding(value);
  if digest is distinct from 'd02e819e85395e223c3a86cdf5559d27' then raise exception 'binding_function_preservation_refused'; end if;
  end $binding_preserve$;
commit;
