-- =====================================================================
-- Group invite accept: read baseline and system join notice
-- =====================================================================
-- Proposal only. Do not auto-apply from Codex.
--
-- Supersedes the 20260510 group_invite_join_system_messages proposal.
-- Apply this after the manually applied 20260509 group_invites migration.
--
-- Fixes:
--   - accepted invitees should not see pre-join history as unread;
--   - accepting an invite should create a system notice, not a normal
--     user-message bubble.
-- =====================================================================

set search_path = public;

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
  v_joined boolean := false;
  v_display_name text := 'Пользователь';
  v_now timestamptz := now();
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

  if v_invite.expires_at is not null and v_invite.expires_at <= v_now then
    update public.group_invites
       set status = 'expired',
           responded_at = coalesce(responded_at, v_now)
     where id = v_invite.id
     returning * into v_invite;
    raise exception 'group_invite_expired' using errcode = 'P0001';
  end if;

  select * into v_chat from public.chats where id = v_invite.chat_id;
  if not found or v_chat.type not in ('group', 'channel') then
    raise exception 'group_invite_chat_unavailable' using errcode = 'P0001';
  end if;

  insert into public.chat_members (
    chat_id,
    user_id,
    role,
    joined_at,
    last_read_at,
    last_delivered_at
  )
  values (
    v_invite.chat_id,
    v_caller,
    'member'::public.chat_member_role,
    v_now,
    v_now,
    v_now
  )
  on conflict (chat_id, user_id) do nothing
  returning true into v_joined;

  update public.group_invites
     set status = 'accepted',
         responded_at = v_now
   where id = v_invite.id
   returning * into v_invite;

  if coalesce(v_joined, false) then
    select coalesce(nullif(full_name, ''), nullif(username, ''), 'Пользователь')
      into v_display_name
      from public.profiles
     where id = v_caller;

    insert into public.messages (chat_id, user_id, type, content)
    values (
      v_invite.chat_id,
      null,
      'system',
      coalesce(v_display_name, 'Пользователь') || ' присоединился к группе'
    );
  end if;

  update public.notifications
     set read_at = coalesce(read_at, v_now),
         payload = public._group_invite_payload(v_invite)
   where user_id = v_caller
     and kind = 'group_invite'
     and payload->>'invite_id' = v_invite.id::text;

  return v_invite.chat_id;
end $$;

revoke all on function public.group_invite_accept(uuid) from public, anon;
grant execute on function public.group_invite_accept(uuid) to authenticated;

-- Manual verification after applying:
-- 1. Invitee accepts a pending group invite.
-- 2. chat_members row has joined_at, last_read_at and last_delivered_at
--    set to the accept timestamp.
-- 3. messages has exactly one type='system' row with user_id null and
--    content "<name> присоединился к группе".
-- 4. Re-opening the accepted group does not resurrect pre-join unread count.
-- 5. Accepting a non-pending invite still fails and does not create duplicates.
