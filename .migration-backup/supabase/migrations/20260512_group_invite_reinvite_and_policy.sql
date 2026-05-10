-- =====================================================================
-- Group invite reinvite support and invite policy
-- =====================================================================
-- Proposal only. Do not auto-apply from Codex.
--
-- Apply manually after:
--   - 20260509_group_invites.sql
--   - 20260511_invite_accept_read_baseline_and_system_notice.sql
--
-- Adds:
--   - chats.invite_policy:
--       owner_admin_only  -> only owner/admin can send invites
--       members_can_invite -> any current group member can send invites
--   - explicit reinvite behavior for accepted/declined/cancelled/expired
--     historical invites when the invitee is no longer a current member.
-- =====================================================================

set search_path = public;

alter table public.chats
  add column if not exists invite_policy text not null default 'owner_admin_only';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'chats_invite_policy_check'
       and conrelid = 'public.chats'::regclass
  ) then
    alter table public.chats
      add constraint chats_invite_policy_check
      check (invite_policy in ('owner_admin_only', 'members_can_invite'));
  end if;
end $$;

comment on column public.chats.invite_policy is
  'Group invite permission mode: owner_admin_only or members_can_invite.';

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
  v_policy text := 'owner_admin_only';
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_chat from public.chats where id = p_chat_id;
  if not found then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if v_chat.type not in ('group', 'channel') then
    raise exception 'group_invite_not_group_chat' using errcode = 'P0001';
  end if;

  v_policy := coalesce(v_chat.invite_policy, 'owner_admin_only');

  if v_policy = 'members_can_invite' then
    if not exists (
      select 1
        from public.chat_members
       where chat_id = p_chat_id
         and user_id = v_caller
    ) then
      raise exception 'group_invite_member_required' using errcode = '42501';
    end if;
  else
    if not public.is_chat_admin(p_chat_id) then
      raise exception 'group_invite_admin_required' using errcode = '42501';
    end if;
  end if;

  if p_invitee_id = v_caller then
    raise exception 'group_invite_self_forbidden' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = p_invitee_id) then
    raise exception 'group_invite_invitee_not_found' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.chat_members
     where chat_id = p_chat_id
       and user_id = p_invitee_id
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

  insert into public.group_invites (chat_id, inviter_id, invitee_id, status, created_at, responded_at)
  values (p_chat_id, v_caller, p_invitee_id, 'pending', now(), null)
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

  if not public.is_chat_admin(v_invite.chat_id) then
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
revoke all on function public.group_invite_cancel(uuid) from public, anon;
grant execute on function public.group_invite_create(uuid, uuid) to authenticated;
grant execute on function public.group_invite_cancel(uuid) to authenticated;

-- Manual verification after applying:
-- 1. In owner_admin_only groups, only owner/admin can create invites.
-- 2. In members_can_invite groups, any current member can create an invite.
-- 3. Ordinary members cannot cancel pending invites through the RPC.
-- 4. A removed ex-member with historical accepted invite can be invited again.
-- 5. Reinvite creates a fresh pending group_invites row and group_invite notification.
