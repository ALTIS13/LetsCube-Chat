-- =====================================================================
-- Group chat invitations via notifications
-- =====================================================================
-- Proposal only. Do not auto-apply from Codex.
--
-- Adds pending/accepted/declined/cancelled/expired group invites and
-- RPC-only mutations:
--   - group_invite_create(p_chat_id, p_invitee_id)
--   - group_invite_accept(p_invite_id)
--   - group_invite_decline(p_invite_id)
--   - group_invite_cancel(p_invite_id)
--
-- Clients must not insert into chat_members for existing group invites.
-- Accepting an invite inserts chat_members from the RPC after checking
-- the invitee and current status.
-- =====================================================================

set search_path = public;

create table if not exists public.group_invites (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.chats(id) on delete cascade,
  inviter_id   uuid not null references public.profiles(id) on delete cascade,
  invitee_id   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  responded_at timestamptz,
  check (inviter_id <> invitee_id)
);

create unique index if not exists group_invites_one_pending_per_user_chat_idx
  on public.group_invites (chat_id, invitee_id)
  where status = 'pending';

create index if not exists group_invites_invitee_status_created_idx
  on public.group_invites (invitee_id, status, created_at desc);

create index if not exists group_invites_chat_status_idx
  on public.group_invites (chat_id, status);

create index if not exists group_invites_inviter_created_idx
  on public.group_invites (inviter_id, created_at desc);

alter table public.group_invites enable row level security;

drop policy if exists "group_invites select scoped" on public.group_invites;
create policy "group_invites select scoped"
  on public.group_invites
  for select
  to authenticated
  using (
    invitee_id = auth.uid()
    or inviter_id = auth.uid()
    or public.is_chat_admin(chat_id)
  );

-- No direct client INSERT/UPDATE/DELETE policies: all state changes go
-- through the RPCs below.
grant select on public.group_invites to authenticated;
revoke insert, update, delete on public.group_invites from anon, authenticated;

create or replace function public._group_invite_payload(p_invite public.group_invites)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_chat public.chats%rowtype;
  v_inviter public.profiles%rowtype;
begin
  select * into v_chat from public.chats where id = p_invite.chat_id;
  select * into v_inviter from public.profiles where id = p_invite.inviter_id;

  return jsonb_build_object(
    'invite_id', p_invite.id,
    'chat_id', p_invite.chat_id,
    'chat_name', coalesce(v_chat.name, 'Группа'),
    'inviter_id', p_invite.inviter_id,
    'inviter_name', coalesce(v_inviter.full_name, v_inviter.username, 'Администратор'),
    'inviter_avatar_url', v_inviter.avatar_url,
    'status', p_invite.status,
    'expires_at', p_invite.expires_at
  );
end $$;

revoke all on function public._group_invite_payload(public.group_invites) from public, anon, authenticated;

create or replace function public.group_invite_create(
  p_chat_id uuid,
  p_invitee_id uuid
)
returns public.group_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_chat public.chats%rowtype;
  v_invite public.group_invites%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_chat from public.chats where id = p_chat_id;
  if not found then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if v_chat.type not in ('group', 'channel') then
    raise exception 'group_invite_chat_type_invalid' using errcode = 'P0001';
  end if;

  if not public.is_chat_admin(p_chat_id) then
    raise exception 'group_invite_admin_required' using errcode = '42501';
  end if;

  if p_invitee_id = v_caller then
    raise exception 'group_invite_self_forbidden' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = p_invitee_id) then
    raise exception 'group_invite_invitee_not_found' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.chat_members
     where chat_id = p_chat_id and user_id = p_invitee_id
  ) then
    raise exception 'group_invite_already_member' using errcode = 'P0001';
  end if;

  select * into v_invite
    from public.group_invites
   where chat_id = p_chat_id
     and invitee_id = p_invitee_id
     and status = 'pending'
   order by created_at desc
   limit 1;

  if found then
    return v_invite;
  end if;

  insert into public.group_invites (chat_id, inviter_id, invitee_id)
  values (p_chat_id, v_caller, p_invitee_id)
  returning * into v_invite;

  perform public._notify(
    p_invitee_id,
    'group_invite',
    public._group_invite_payload(v_invite)
  );

  return v_invite;
exception
  when unique_violation then
    select * into v_invite
      from public.group_invites
     where chat_id = p_chat_id
       and invitee_id = p_invitee_id
       and status = 'pending'
     order by created_at desc
     limit 1;
    if found then
      return v_invite;
    end if;
    raise;
end $$;

create or replace function public.group_invite_accept(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.group_invites%rowtype;
  v_chat public.chats%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
    from public.group_invites
   where id = p_invite_id
   for update;

  if not found or v_invite.invitee_id <> v_caller then
    raise exception 'group_invite_not_found_or_unavailable' using errcode = 'P0001';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'group_invite_not_pending' using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    update public.group_invites
       set status = 'expired',
           responded_at = coalesce(responded_at, now())
     where id = v_invite.id
     returning * into v_invite;
    raise exception 'group_invite_expired' using errcode = 'P0001';
  end if;

  select * into v_chat from public.chats where id = v_invite.chat_id;
  if not found or v_chat.type not in ('group', 'channel') then
    raise exception 'group_invite_chat_unavailable' using errcode = 'P0001';
  end if;

  insert into public.chat_members (chat_id, user_id, role)
  values (v_invite.chat_id, v_caller, 'member'::public.chat_member_role)
  on conflict (chat_id, user_id) do nothing;

  update public.group_invites
     set status = 'accepted',
         responded_at = now()
   where id = v_invite.id
   returning * into v_invite;

  update public.notifications
     set read_at = coalesce(read_at, now()),
         payload = public._group_invite_payload(v_invite)
   where user_id = v_caller
     and kind = 'group_invite'
     and payload->>'invite_id' = v_invite.id::text;

  return v_invite.chat_id;
end $$;

create or replace function public.group_invite_decline(p_invite_id uuid)
returns public.group_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.group_invites%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
    from public.group_invites
   where id = p_invite_id
   for update;

  if not found or v_invite.invitee_id <> v_caller then
    raise exception 'group_invite_not_found_or_unavailable' using errcode = 'P0001';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'group_invite_not_pending' using errcode = 'P0001';
  end if;

  update public.group_invites
     set status = 'declined',
         responded_at = now()
   where id = v_invite.id
   returning * into v_invite;

  update public.notifications
     set read_at = coalesce(read_at, now()),
         payload = public._group_invite_payload(v_invite)
   where user_id = v_caller
     and kind = 'group_invite'
     and payload->>'invite_id' = v_invite.id::text;

  return v_invite;
end $$;

create or replace function public.group_invite_cancel(p_invite_id uuid)
returns public.group_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.group_invites%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
    from public.group_invites
   where id = p_invite_id
   for update;

  if not found then
    raise exception 'group_invite_not_found_or_unavailable' using errcode = 'P0001';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'group_invite_not_pending' using errcode = 'P0001';
  end if;

  if v_invite.inviter_id <> v_caller and not public.is_chat_admin(v_invite.chat_id) then
    raise exception 'group_invite_admin_required' using errcode = '42501';
  end if;

  update public.group_invites
     set status = 'cancelled',
         responded_at = now()
   where id = v_invite.id
   returning * into v_invite;

  update public.notifications
     set payload = public._group_invite_payload(v_invite)
   where user_id = v_invite.invitee_id
     and kind = 'group_invite'
     and payload->>'invite_id' = v_invite.id::text;

  return v_invite;
end $$;

revoke all on function public.group_invite_create(uuid, uuid) from public, anon;
revoke all on function public.group_invite_accept(uuid) from public, anon;
revoke all on function public.group_invite_decline(uuid) from public, anon;
revoke all on function public.group_invite_cancel(uuid) from public, anon;
grant execute on function public.group_invite_create(uuid, uuid) to authenticated;
grant execute on function public.group_invite_accept(uuid) to authenticated;
grant execute on function public.group_invite_decline(uuid) to authenticated;
grant execute on function public.group_invite_cancel(uuid) to authenticated;

create or replace function public._notification_push_payload(
  p_kind text,
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_title    text := 'КУБ';
  v_body     text := '';
  v_url      text := '/';
  v_t_title  text := nullif(p_payload->>'title', '');
  v_chat     text := nullif(p_payload->>'chat_name', '');
  v_chat_id  text := nullif(p_payload->>'chat_id', '');
  v_reason   text := nullif(p_payload->>'reason', '');
  v_inviter  text := nullif(p_payload->>'inviter_name', '');
begin
  if p_kind = 'task_assigned' then
    v_body := coalesce('Новая задача: «' || v_t_title || '»', 'Вам назначена задача');
    v_url  := '/tasks';
  elsif p_kind = 'task_waiting_confirmation' then
    v_body := coalesce('Задача «' || v_t_title || '» ждёт подтверждения', 'Задача ждёт подтверждения');
    v_url  := '/tasks';
  elsif p_kind = 'task_confirmed' then
    v_body := coalesce('Задача «' || v_t_title || '» подтверждена', 'Задача подтверждена');
    v_url  := '/tasks';
  elsif p_kind = 'task_rejected' then
    v_body := coalesce('Задача «' || v_t_title || '» отклонена', 'Задача отклонена');
    v_url  := '/tasks';
  elsif p_kind = 'chat_added' then
    v_body := coalesce('Вас добавили в чат «' || v_chat || '»', 'Вас добавили в чат');
    v_url  := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
  elsif p_kind = 'group_invite' then
    v_body := coalesce(v_inviter, 'Администратор') || ' приглашает вас в ' || coalesce('«' || v_chat || '»', 'группу');
    v_url  := '/';
  elsif p_kind = 'mute_issued' then
    v_body := coalesce('Вам выдан мут: ' || v_reason, 'Вам выдан мут');
    v_url  := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
  elsif p_kind = 'ban_issued' then
    v_body := coalesce('Вы заблокированы: ' || v_reason, 'Вы заблокированы');
  else
    v_body := 'Новое уведомление';
  end if;
  return jsonb_build_object(
    'title', v_title,
    'body',  v_body,
    'url',   v_url,
    'tag',   'kub-notification:' || p_kind,
    'kind',  p_kind
  );
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_invites'
  ) then
    alter publication supabase_realtime add table public.group_invites;
  end if;
end $$;

-- Verify manually after applying:
-- - group_invites table exists with RLS enabled.
-- - authenticated can SELECT only scoped rows and cannot direct INSERT/UPDATE/DELETE.
-- - group_invite_create creates one pending invite and one group_invite notification.
-- - group_invite_accept inserts chat_members and updates notification payload status.
-- - group_invite_decline/cancel update payload status without adding membership.
