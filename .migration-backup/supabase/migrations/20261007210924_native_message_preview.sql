-- SOURCE PROPOSAL ONLY. Not a numbered/applied migration or a rollout switch.
-- Requires section 10 backup/recovery acceptance, reviewed live before-state,
-- rehearsal and a byte-identical migration-backup copy before installation.
-- Rollback (only for this new contract, after consumers are disabled):
-- BEGIN;
-- DROP FUNCTION public.native_message_preview_capability(uuid);
-- DROP FUNCTION public.native_message_notification_preview(uuid,uuid);
-- DROP TABLE public.notification_preview_preferences;
-- DROP FUNCTION public.native_message_preview_recipient();
-- COMMIT;
-- Existing generic native_chat_v1 and voice contracts are not changed.

begin;

set local lock_timeout='5s';
set local statement_timeout='60s';
do $d335_lock$
begin
 if not pg_try_advisory_xact_lock(335,335) then
  raise exception 'native_message_preview_install_lock_refused';end if;
end
$d335_lock$;
lock table auth.users,auth.sessions,public.user_push_devices,public.notifications,public.messages,public.profiles,public.bots,public.notifications_native_push_outbox,public.album_push_members,public.album_push_groups,public.notifications_album_push_outbox,public.chats,public.chat_members,public.topics,public.message_hidden_for_users,public.user_blocks,public.bans,public.notification_preferences,public.chat_notification_preferences,public.privacy_preferences in share update exclusive mode;
do $d335_before$
declare name text; digest text;
begin
 if current_database()<>'postgres' or current_user<>'supabase_admin'
  or (select system_identifier::text from pg_control_system())<>'7652726644035760163'
  or (select oid::text from pg_database where datname=current_database())<>'5'
  or current_setting('server_version')<>'17.6' or inet_server_addr() is not null
 then raise exception 'native_message_preview_install_identity_refused';end if;
 if to_regclass('public.notification_preview_preferences') is not null
  or to_regprocedure('public.native_message_preview_recipient()') is not null
  or to_regprocedure('public.native_message_preview_capability(uuid)') is not null
  or to_regprocedure('public.native_message_notification_preview(uuid,uuid)') is not null
  or to_regtype('public.notification_preview_preferences') is not null
  or to_regclass('public.notification_preview_preferences_pkey') is not null
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('native_message_preview_recipient',
      'native_message_preview_capability','native_message_notification_preview'))
 then raise exception 'native_message_preview_install_existing_object_refused';end if;
 if not exists(select 1 from pg_roles where rolname='postgres')
  or not pg_has_role(current_user,'postgres','USAGE')
  or not has_schema_privilege('postgres','public','USAGE')
  or not has_schema_privilege('postgres','public','CREATE')
  or not has_schema_privilege('postgres','auth','USAGE')
  or not has_schema_privilege('postgres','private','USAGE')
  or not has_schema_privilege('authenticated','public','USAGE')
  or not has_table_privilege(current_user,'auth.users','REFERENCES')
 then raise exception 'native_message_preview_install_owner_acl_refused';end if;
 if not exists(select 1 from pg_roles where rolname='postgres' and (rolsuper or rolbypassrls))
  and not pg_has_role('postgres','bypass_auth_rls','USAGE')
 then raise exception 'native_message_preview_install_owner_acl_refused';end if;
 foreach name in array array['auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences'] loop
  if to_regclass(name) is null or not has_table_privilege('postgres',name,'SELECT')
   or (name like 'public.%' and not exists(select 1 from pg_class c where c.oid=to_regclass(name) and c.relrowsecurity))
  then raise exception 'native_message_preview_install_dependency_refused';end if;
 end loop;
 foreach name in array array['auth.jwt()','auth.uid()','private.message_notification_visible_to(uuid,uuid)','public._notification_push_allowed(uuid,text,jsonb)'] loop
  if to_regprocedure(name) is null or not has_function_privilege('postgres',name,'EXECUTE')
  then raise exception 'native_message_preview_install_dependency_refused';end if;
 end loop;
 select md5(metadata::text) into digest from (select jsonb_build_object(
'namespaces',(select jsonb_agg(jsonb_build_array(n.nspname,r.rolname,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname) from pg_namespace n join pg_roles r on r.oid=n.nspowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'defaultACL',(select jsonb_agg(jsonb_build_array(r.rolname,coalesce(n.nspname,''),d.defaclobjtype,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(d.defaclacl) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by r.rolname,coalesce(n.nspname,''),d.defaclobjtype) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace),
'database',(select jsonb_build_array(d.datname,r.rolname,d.encoding,d.datcollate,d.datctype,d.datlocprovider,to_jsonb(d)->'datlocale',(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) from pg_database d join pg_roles r on r.oid=d.datdba where d.datname='postgres'),
'roles',(select jsonb_agg(to_jsonb(r)-'oid' order by rolname) from pg_authid r),
'memberships',(select jsonb_agg(jsonb_build_array(a.rolname,b.rolname,g.rolname,m.admin_option,m.inherit_option,m.set_option) order by a.rolname,b.rolname,g.rolname) from pg_auth_members m join pg_roles a on a.oid=m.roleid join pg_roles b on b.oid=m.member join pg_roles g on g.oid=m.grantor),
'settings',(select jsonb_agg(jsonb_build_array(coalesce(d.datname,''),coalesce(r.rolname,''),s.setconfig) order by coalesce(d.datname,''),coalesce(r.rolname,'')) from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase left join pg_roles r on r.oid=s.setrole),
'extensions',(select jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname,r.rolname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace join pg_roles r on r.oid=e.extowner),
'relations',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,r.rolname,c.relrowsecurity,c.relforcerowsecurity,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,p.prosecdef,p.provolatile,p.proconfig,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor),md5(p.prosrc)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname not in ('pg_catalog','information_schema')),
'policies',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,(select jsonb_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC')) from unnest(p.polroles) x left join pg_roles r on r.oid=x),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by n.nspname,c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace))) d335(metadata);
 if digest is distinct from '001cc349061eaded24c2a04f09f7aef8' then
  raise exception 'native_message_preview_install_before_drift';end if;
 -- D335_DEPENDENCY_BEFORE_BEGIN
 select value into digest from (select md5(metadata::text) from (select jsonb_build_object(
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,a.attnum,a.attname,
   format_type(a.atttypid,a.atttypmod),tn.nspname,ty.typname,a.attnotnull,
   pg_get_expr(d.adbin,d.adrelid,true),a.attidentity,a.attgenerated,
   cn.nspname,coll.collname) order by n.nspname,c.relname,a.attnum),'[]'::jsonb)
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_type ty on ty.oid=a.atttypid join pg_namespace tn on tn.oid=ty.typnamespace
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   left join pg_collation coll on coll.oid=a.attcollation left join pg_namespace cn on cn.oid=coll.collnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences') and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,k.conname,k.contype,
   k.convalidated,k.condeferrable,k.condeferred,k.connoinherit,pg_get_constraintdef(k.oid,true))
   order by n.nspname,c.relname,k.conname),'[]'::jsonb)
   from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,ic.relname,
   pg_get_indexdef(i.indexrelid),i.indisunique,i.indisprimary,i.indisexclusion,i.indimmediate,
   i.indisvalid,i.indisready,i.indislive) order by n.nspname,c.relname,ic.relname),'[]'::jsonb)
   from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_class ic on ic.oid=i.indexrelid where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,t.tgname,
   pg_get_triggerdef(t.oid,true),t.tgenabled,t.tgisinternal,pn.nspname,p.proname,
   pg_get_function_identity_arguments(p.oid),t.tgdeferrable,t.tginitdeferred)
   order by n.nspname,c.relname,t.tgname),'[]'::jsonb)
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
   left join pg_constraint fk on fk.oid=t.tgconstraint
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')
   and true -- D335_DEPENDENCY_TRIGGER_SCOPE
  )) as metadata) d335(metadata)) d335(value);
 if digest is distinct from 'e778364be7dc0b46fb4f73a1a0ef271d' then
  raise exception 'native_message_preview_install_dependency_before_drift';end if;
 -- D335_DEPENDENCY_BEFORE_END
end
$d335_before$;

create function public.native_message_preview_recipient()
returns uuid language plpgsql stable security definer
set search_path = pg_catalog
as $fn$
declare
  v_claims jsonb := auth.jwt();
  v_recipient uuid;
  v_session uuid;
  v_now timestamptz := statement_timestamp();
begin
  -- PostgREST verifies the signature. Claims alone do not prove a live session.
  if v_claims->>'role' is distinct from 'authenticated'
    or v_claims->>'is_anonymous' is distinct from 'false'
    or coalesce(v_claims->>'sub','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_claims->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_claims->>'exp','') !~ '^[0-9]{1,12}$'
  then return null; end if;
  if (v_claims->>'exp')::bigint <= extract(epoch from v_now) then return null; end if;
  v_recipient := auth.uid();
  v_session := (v_claims->>'session_id')::uuid;
  if v_recipient is null or v_recipient is distinct from (v_claims->>'sub')::uuid then return null; end if;
  if not exists (select 1 from auth.sessions s where s.id=v_session and s.user_id=v_recipient
    and s.created_at <= v_now and (s.not_after is null or s.not_after > v_now)) then return null; end if;
  return v_recipient;
end
$fn$;
alter function public.native_message_preview_recipient() owner to postgres;
revoke all on function public.native_message_preview_recipient() from public, anon, authenticated, service_role;
grant execute on function public.native_message_preview_recipient() to authenticated;

create table public.notification_preview_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preview_level text not null default 'none'
    check (preview_level in ('none','sender','message'))
);
alter table public.notification_preview_preferences owner to postgres;
alter table public.notification_preview_preferences enable row level security;
revoke all on public.notification_preview_preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.notification_preview_preferences to authenticated;

create policy notification_preview_select_own on public.notification_preview_preferences
  for select to authenticated using (user_id = public.native_message_preview_recipient());
create policy notification_preview_insert_own on public.notification_preview_preferences
  for insert to authenticated with check (user_id = public.native_message_preview_recipient());
create policy notification_preview_update_own on public.notification_preview_preferences
  for update to authenticated using (user_id = public.native_message_preview_recipient())
    with check (user_id = public.native_message_preview_recipient());
create policy notification_preview_delete_own on public.notification_preview_preferences
  for delete to authenticated using (user_id = public.native_message_preview_recipient());

-- Server availability and account consent are not native display authority.
-- The client must separately negotiate an actual preview-capable native bridge.
create function public.native_message_preview_capability(p_device_id uuid)
returns table (
  preview_v smallint,
  recipient_id uuid,
  session_id uuid,
  device_id uuid,
  preview_level text
)
language plpgsql stable security definer
set search_path = pg_catalog
as $fn$
declare
  v_recipient uuid;
  v_session uuid;
begin
  if p_device_id is null then return; end if;
  v_recipient := public.native_message_preview_recipient();
  if v_recipient is null then return; end if;
  v_session := (auth.jwt()->>'session_id')::uuid;
  return query
  select 1::smallint, v_recipient, v_session, d.id, coalesce(pref.preview_level,'none')
  from public.user_push_devices d
  left join public.notification_preview_preferences pref on pref.user_id = v_recipient
  where d.id = p_device_id and d.user_id = v_recipient and d.session_id = v_session
    and d.platform = 'android' and d.provider = 'fcm'
    and d.enabled is true and d.revoked_at is null;
end
$fn$;
alter function public.native_message_preview_capability(uuid) owner to postgres;
revoke all on function public.native_message_preview_capability(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.native_message_preview_capability(uuid) to authenticated;

create function public.native_message_notification_preview(p_device_id uuid,p_notification_id uuid)
returns table (
  preview_v smallint,
  recipient_id uuid,
  session_id uuid,
  device_id uuid,
  notification_id uuid,
  chat_id uuid,
  message_id uuid,
  preview_level text,
  sender_name text,
  title text,
  body text,
  expires_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog
as $fn$
declare
  v_claims jsonb := auth.jwt();
  v_recipient uuid;
  v_session uuid;
  v_now timestamptz := statement_timestamp();
begin
  if p_device_id is null or p_notification_id is null then return; end if;
  v_recipient := public.native_message_preview_recipient();
  if v_recipient is null then return; end if;
  v_session := (v_claims->>'session_id')::uuid;

  return query
  select 1::smallint, v_recipient, v_session, d.id, n.id, m.chat_id, m.id,
    pref.preview_level, label.name, label.name,
    case when pref.preview_level = 'sender' then 'Новое сообщение'
      else coalesce(nullif(left(btrim(regexp_replace(
        case m.type
          when 'text' then m.content
          when 'image' then 'Фото'
          when 'video' then 'Видео'
          when 'audio' then 'Голосовое сообщение'
          when 'voice' then 'Голосовое сообщение'
          when 'file' then 'Файл'
          else 'Новое сообщение'
        end, '[[:cntrl:][:space:]]+', ' ', 'g')),240),''),'Новое сообщение')
    end,
    v_now + interval '15 seconds'
  from auth.sessions s
  join public.user_push_devices d on d.session_id = s.id and d.user_id = s.user_id
  join public.notification_preview_preferences pref on pref.user_id = s.user_id
  join public.notifications n on n.user_id = s.user_id
  join public.messages m on n.payload->>'message_id' = m.id::text
    and n.payload->>'chat_id' = m.chat_id::text
  left join public.profiles profile on profile.id = m.user_id and m.bot_id is null
  left join public.bots bot on bot.id = m.bot_id and m.user_id is null
  cross join lateral (select left(btrim(regexp_replace(
    coalesce(profile.full_name,bot.display_name,''),'[[:cntrl:][:space:]]+',' ','g')),96) as name) label
  where s.id = v_session and s.user_id = v_recipient
    and s.created_at <= v_now and (s.not_after is null or s.not_after > v_now)
    and d.id = p_device_id and d.enabled is true and d.revoked_at is null
    and d.platform = 'android' and d.provider = 'fcm'
    and pref.preview_level in ('sender','message')
    and n.id = p_notification_id and n.kind = 'message' and n.read_at is null
    and n.created_at >= s.created_at and n.created_at <= v_now
    and label.name <> ''
    and (
      exists (select 1 from public.notifications_native_push_outbox o
        where o.notification_id = n.id and o.device_id = d.id and o.user_id = v_recipient)
      or exists (select 1 from public.album_push_members member
        join public.album_push_groups album on album.id = member.group_id
        join public.notifications_album_push_outbox delivery on delivery.group_id = album.id
        where member.notification_id = n.id and member.message_id = m.id
          and album.user_id = v_recipient and album.chat_id = m.chat_id
          and ((album.sender_kind = 'user' and album.sender_id = m.user_id and m.bot_id is null)
            or (album.sender_kind = 'bot' and album.sender_id = m.bot_id and m.user_id is null))
          and delivery.device_id = d.id and delivery.subscription_id is null
          and delivery.suppressed_at is null)
    )
    and private.message_notification_visible_to(m.id,v_recipient)
    -- Never reuse the outbox's old title/body/sender/mention flags for consent.
    and public._notification_push_allowed(v_recipient,'message',jsonb_build_object(
      'message_id',m.id,'chat_id',m.chat_id,'sender_id',m.user_id));
end
$fn$;

alter function public.native_message_notification_preview(uuid,uuid) owner to postgres;
revoke all on function public.native_message_notification_preview(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.native_message_notification_preview(uuid,uuid) to authenticated;

do $check$
declare
  f record;
  function_id regprocedure;
begin
  foreach function_id in array array['public.native_message_notification_preview(uuid,uuid)'::regprocedure,
    'public.native_message_preview_capability(uuid)'::regprocedure,
    'public.native_message_preview_recipient()'::regprocedure] loop
    select * into strict f from pg_proc where oid = function_id;
    if not f.prosecdef or f.provolatile <> 's'
    or f.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or pg_get_userbyid(f.proowner) <> 'postgres'
    or not has_function_privilege('authenticated',f.oid,'execute')
    or has_function_privilege('anon',f.oid,'execute')
    or has_function_privilege('service_role',f.oid,'execute')
    or exists (select 1 from aclexplode(f.proacl) a
      where a.grantee not in ('postgres'::regrole::oid,'authenticated'::regrole::oid))
    then raise exception 'native_message_preview_self_check_failed'; end if;
  end loop;
  if not exists (select 1 from pg_class c
      where c.oid='public.notification_preview_preferences'::regclass and c.relrowsecurity)
    or (select count(*) from pg_policy p
      where p.polrelid='public.notification_preview_preferences'::regclass) <> 4
    or has_table_privilege('anon','public.notification_preview_preferences','select')
    or has_table_privilege('service_role','public.notification_preview_preferences','select')
    or exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid='public.notification_preview_preferences'::regclass
        and a.grantee not in ('postgres'::regrole::oid,'authenticated'::regrole::oid))
  then raise exception 'native_message_preview_self_check_failed'; end if;
end
$check$;

do $d335_preserve$
declare digest text; privilege text;
begin
 if not exists(select 1 from pg_class c where c.oid='public.notification_preview_preferences'::regclass
   and c.relowner='postgres'::regrole and c.relrowsecurity)
 then raise exception 'native_message_preview_install_owner_acl_refused';end if;
 foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE'] loop
  if not has_table_privilege('authenticated','public.notification_preview_preferences',privilege) then
   raise exception 'native_message_preview_install_owner_acl_refused';end if;
 end loop;
 foreach privilege in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
  if has_table_privilege('authenticated','public.notification_preview_preferences',privilege) then
   raise exception 'native_message_preview_install_owner_acl_refused';end if;
 end loop;
 select value into digest from (select md5((metadata || jsonb_build_object(
 'relations',(select jsonb_agg(item order by position) from jsonb_array_elements(metadata->'relations') with ordinality e(item,position)
   where not (item->>0='public' and ((item->>1='notification_preview_preferences' and item->>2='r')
     or (item->>1='notification_preview_preferences_pkey' and item->>2='i')))),
 'functions',(select jsonb_agg(item order by position) from jsonb_array_elements(metadata->'functions') with ordinality e(item,position)
   where not (item->>0='public' and ((item->>1='native_message_preview_recipient' and item->>2='')
     or (item->>1='native_message_preview_capability' and item->>2='p_device_id uuid')
     or (item->>1='native_message_notification_preview' and item->>2='p_device_id uuid, p_notification_id uuid')))),
 'policies',(select jsonb_agg(item order by position) from jsonb_array_elements(metadata->'policies') with ordinality e(item,position)
   where not (item->>0='public' and item->>1='notification_preview_preferences'
     and item->>2 in ('notification_preview_select_own','notification_preview_insert_own',
       'notification_preview_update_own','notification_preview_delete_own')))
 ))::text) from (select jsonb_build_object(
'namespaces',(select jsonb_agg(jsonb_build_array(n.nspname,r.rolname,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname) from pg_namespace n join pg_roles r on r.oid=n.nspowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'defaultACL',(select jsonb_agg(jsonb_build_array(r.rolname,coalesce(n.nspname,''),d.defaclobjtype,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(d.defaclacl) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by r.rolname,coalesce(n.nspname,''),d.defaclobjtype) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace),
'database',(select jsonb_build_array(d.datname,r.rolname,d.encoding,d.datcollate,d.datctype,d.datlocprovider,to_jsonb(d)->'datlocale',(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) from pg_database d join pg_roles r on r.oid=d.datdba where d.datname='postgres'),
'roles',(select jsonb_agg(to_jsonb(r)-'oid' order by rolname) from pg_authid r),
'memberships',(select jsonb_agg(jsonb_build_array(a.rolname,b.rolname,g.rolname,m.admin_option,m.inherit_option,m.set_option) order by a.rolname,b.rolname,g.rolname) from pg_auth_members m join pg_roles a on a.oid=m.roleid join pg_roles b on b.oid=m.member join pg_roles g on g.oid=m.grantor),
'settings',(select jsonb_agg(jsonb_build_array(coalesce(d.datname,''),coalesce(r.rolname,''),s.setconfig) order by coalesce(d.datname,''),coalesce(r.rolname,'')) from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase left join pg_roles r on r.oid=s.setrole),
'extensions',(select jsonb_agg(jsonb_build_array(e.extname,e.extversion,n.nspname,r.rolname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace join pg_roles r on r.oid=e.extowner),
'relations',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,r.rolname,c.relrowsecurity,c.relforcerowsecurity,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast|^pg_temp'),
'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),r.rolname,p.prosecdef,p.provolatile,p.proconfig,(select coalesce(jsonb_agg(jsonb_build_array(coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable) order by coalesce(g.rolname,'PUBLIC'),r.rolname,a.privilege_type,a.is_grantable),'[]') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles g on g.oid=a.grantee join pg_roles r on r.oid=a.grantor),md5(p.prosrc)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname not in ('pg_catalog','information_schema')),
'policies',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,(select jsonb_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC')) from unnest(p.polroles) x left join pg_roles r on r.oid=x),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by n.nspname,c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace))) d335(metadata)) d335(value);
 if digest is distinct from '001cc349061eaded24c2a04f09f7aef8' then
  raise exception 'native_message_preview_install_preservation_failed';end if;
 -- D335_DEPENDENCY_POST_BEGIN
 select value into digest from (select case when (select count(*) from pg_trigger t
 join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 join pg_constraint fk on fk.oid=t.tgconstraint where n.nspname='auth' and c.relname='users'
 and t.tgisinternal and t.tgenabled='O' and not t.tgdeferrable and not t.tginitdeferred
 and t.tgnargs=0 and t.tgargs=''::bytea and t.tgqual is null
 and fk.conrelid=to_regclass('public.notification_preview_preferences')
 and fk.conname='notification_preview_preferences_user_id_fkey' and fk.contype='f'
 and fk.convalidated and not fk.condeferrable and not fk.condeferred
 and fk.confrelid=to_regclass('auth.users')
 and fk.confdeltype='c' and fk.confupdtype='a' and fk.confmatchtype='s'
 and fk.conkey=array[(select attnum from pg_attribute
   where attrelid=to_regclass('public.notification_preview_preferences') and attname='user_id' and not attisdropped)]::smallint[]
 and fk.confkey=array[(select attnum from pg_attribute
   where attrelid=to_regclass('auth.users') and attname='id' and not attisdropped)]::smallint[]
 and ((t.tgfoid=to_regprocedure('pg_catalog."RI_FKey_cascade_del"()') and t.tgtype=9)
   or (t.tgfoid=to_regprocedure('pg_catalog."RI_FKey_noaction_upd"()') and t.tgtype=17)))=2
 then md5(metadata::text) else null end from (select jsonb_build_object(
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,a.attnum,a.attname,
   format_type(a.atttypid,a.atttypmod),tn.nspname,ty.typname,a.attnotnull,
   pg_get_expr(d.adbin,d.adrelid,true),a.attidentity,a.attgenerated,
   cn.nspname,coll.collname) order by n.nspname,c.relname,a.attnum),'[]'::jsonb)
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_type ty on ty.oid=a.atttypid join pg_namespace tn on tn.oid=ty.typnamespace
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   left join pg_collation coll on coll.oid=a.attcollation left join pg_namespace cn on cn.oid=coll.collnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences') and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,k.conname,k.contype,
   k.convalidated,k.condeferrable,k.condeferred,k.connoinherit,pg_get_constraintdef(k.oid,true))
   order by n.nspname,c.relname,k.conname),'[]'::jsonb)
   from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,ic.relname,
   pg_get_indexdef(i.indexrelid),i.indisunique,i.indisprimary,i.indisexclusion,i.indimmediate,
   i.indisvalid,i.indisready,i.indislive) order by n.nspname,c.relname,ic.relname),'[]'::jsonb)
   from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_class ic on ic.oid=i.indexrelid where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname||'.'||c.relname,t.tgname,
   pg_get_triggerdef(t.oid,true),t.tgenabled,t.tgisinternal,pn.nspname,p.proname,
   pg_get_function_identity_arguments(p.oid),t.tgdeferrable,t.tginitdeferred)
   order by n.nspname,c.relname,t.tgname),'[]'::jsonb)
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
   left join pg_constraint fk on fk.oid=t.tgconstraint
   where n.nspname||'.'||c.relname in ('auth.users','auth.sessions','public.user_push_devices','public.notifications','public.messages','public.profiles','public.bots','public.notifications_native_push_outbox','public.album_push_members','public.album_push_groups','public.notifications_album_push_outbox','public.chats','public.chat_members','public.topics','public.message_hidden_for_users','public.user_blocks','public.bans','public.notification_preferences','public.chat_notification_preferences','public.privacy_preferences')
   and not coalesce((n.nspname='auth' and c.relname='users'
 and t.tgisinternal and t.tgenabled='O' and not t.tgdeferrable and not t.tginitdeferred
 and t.tgnargs=0 and t.tgargs=''::bytea and t.tgqual is null
 and fk.conrelid=to_regclass('public.notification_preview_preferences')
 and fk.conname='notification_preview_preferences_user_id_fkey' and fk.contype='f'
 and fk.convalidated and not fk.condeferrable and not fk.condeferred
 and fk.confrelid=to_regclass('auth.users')
 and fk.confdeltype='c' and fk.confupdtype='a' and fk.confmatchtype='s'
 and fk.conkey=array[(select attnum from pg_attribute
   where attrelid=to_regclass('public.notification_preview_preferences') and attname='user_id' and not attisdropped)]::smallint[]
 and fk.confkey=array[(select attnum from pg_attribute
   where attrelid=to_regclass('auth.users') and attname='id' and not attisdropped)]::smallint[]
 and ((t.tgfoid=to_regprocedure('pg_catalog."RI_FKey_cascade_del"()') and t.tgtype=9)
   or (t.tgfoid=to_regprocedure('pg_catalog."RI_FKey_noaction_upd"()') and t.tgtype=17))),false)
  )) as metadata) d335(metadata)) d335(value);
 if digest is distinct from 'e778364be7dc0b46fb4f73a1a0ef271d' then
  raise exception 'native_message_preview_install_dependency_preservation_failed';end if;
 -- D335_DEPENDENCY_POST_END
end
$d335_preserve$;

commit;
