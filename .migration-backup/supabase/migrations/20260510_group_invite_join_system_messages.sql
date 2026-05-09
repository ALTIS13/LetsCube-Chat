-- =====================================================================
-- Group invite accept: persistent join system message
-- =====================================================================
-- Proposal only. Do not auto-apply from Codex.
--
-- Extends the already-applied 20260509 group_invites migration:
--   - accepting a pending invite still inserts chat_members through RPC;
--   - after the membership row is created, a type='system' message is
--     inserted into the group chat: "<name> присоединился к группе";
--   - notification payload/read state behavior is preserved.
--
-- Apply manually in Supabase SQL Editor after reviewing.
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
  on conflict (chat_id, user_id) do nothing
  returning true into v_joined;

  update public.group_invites
     set status = 'accepted',
         responded_at = now()
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
      v_caller,
      'system',
      coalesce(v_display_name, 'Пользователь') || ' присоединился к группе'
    );
  end if;

  update public.notifications
     set read_at = coalesce(read_at, now()),
         payload = public._group_invite_payload(v_invite)
   where user_id = v_caller
     and kind = 'group_invite'
     and payload->>'invite_id' = v_invite.id::text;

  return v_invite.chat_id;
end $$;

revoke all on function public.group_invite_accept(uuid) from public, anon;
grant execute on function public.group_invite_accept(uuid) to authenticated;

-- Verify manually after applying:
-- - invitee accepts a pending invite.
-- - chat_members gets exactly one member row.
-- - messages gets one type='system' row with "<name> присоединился к группе".
-- - the message appears through the existing realtime/messages flow.
-- - accepting an already non-pending invite still fails and does not create duplicates.
