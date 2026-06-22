-- Proposal file. Applied manually to self-host Supabase on 2026-06-22
-- after explicit approval; keep this file as migration history/proposal source.
--
-- Goal:
-- Harden group_invite_create so a user cannot create invites for a group/channel
-- they are not a member of, even if a broad invite permission is accidentally
-- attached to their global role.
--
-- Background:
-- The opt-in RLS smoke fixture found that a non-member QA user could create a
-- group invite for a temporary owner_admin_only group. This function keeps the
-- intended invite policy behavior while adding a membership guard around broad
-- invite permissions.

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
  v_is_member boolean := false;
  v_is_admin boolean := false;
  v_has_invite boolean := false;
  v_has_invite_any boolean := false;
  v_has_system_manage boolean := false;
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
  -- Keep this check local to the function so invite authorization is tied to
  -- the explicit caller captured above, not to nested helper behavior.
  v_is_member := exists (
    select 1
      from public.chat_members
     where chat_id = p_chat_id
       and user_id = v_caller
  );
  v_is_admin := exists (
    select 1
      from public.chat_members
     where chat_id = p_chat_id
       and user_id = v_caller
       and role in ('owner', 'admin')
  );
  v_has_invite := public.has_permission(v_caller, 'chats.invite');
  v_has_invite_any := public.has_permission(v_caller, 'chats.invite_any');
  v_has_system_manage := public.has_permission(v_caller, 'system.manage');

  if not v_has_system_manage then
    if v_has_invite_any then
      if not v_is_member then
        raise exception 'group_invite_member_required' using errcode = '42501';
      end if;
    elsif v_policy = 'members_can_invite' then
      if not (v_is_member and v_has_invite) then
        raise exception 'group_invite_member_required' using errcode = '42501';
      end if;
    elsif not v_is_admin then
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
end
$$;

revoke all on function public.group_invite_create(uuid, uuid) from public, anon;
grant execute on function public.group_invite_create(uuid, uuid) to authenticated;

-- Manual validation after apply:
-- 1. Run `KUB_QA_ALLOW_MUTATIONS=1 pnpm.cmd rls:smoke`.
-- 2. Confirm `group_invites fixture ownership` returns ok.
-- 3. Confirm normal group invites still work for chat owners/admins.
-- 4. Confirm `members_can_invite` still works for current members with `chats.invite`.
