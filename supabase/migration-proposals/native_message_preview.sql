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

commit;
