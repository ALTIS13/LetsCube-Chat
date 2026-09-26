-- A group administrator can explicitly widen or narrow one bot's visibility.
-- Existing messages do not become newly readable: every transition starts a
-- fresh visibility epoch at joined_at. The group sees the resulting mode on
-- the bot's member-list row. No client gets direct table write access.

alter table private.bot_audit_events
  drop constraint bot_audit_events_action_check;
alter table private.bot_audit_events
  add constraint bot_audit_events_action_check check (action in (
    'webhook_set','webhook_deleted',
    'bot_created','bot_profile_updated','bot_commands_updated',
    'bot_paused','bot_resumed','bot_developer_added','bot_developer_removed',
    'bot_token_rotated','bot_token_revoked',
    'bot_deletion_requested','bot_deletion_cancelled','bot_deleted',
    'bot_privacy_requested','bot_privacy_cancelled','bot_privacy_changed',
    'bot_management_webhook_set','bot_management_webhook_deleted',
    'bot_suspended','bot_unsuspended'
  ));

create function public.chat_bot_set_privacy(
  p_chat_id uuid,
  p_bot_id uuid,
  p_full boolean
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_member public.chat_bot_members%rowtype;
  v_mode text;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_chat_id is null or p_bot_id is null or p_full is null then
    raise exception 'invalid_bot_privacy_input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.chats c
    where c.id = p_chat_id and c.type = 'group'
  ) then
    raise exception 'not_a_group' using errcode = '22023';
  end if;
  if not public.is_chat_admin(p_chat_id) then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  select member_row.* into v_member
  from public.chat_bot_members member_row
  join public.bots bot on bot.id = member_row.bot_id
  where member_row.chat_id = p_chat_id
    and member_row.bot_id = p_bot_id
    and member_row.removed_at is null
    and bot.state = 'active'
  for update of member_row;
  if not found then
    raise exception 'bot_membership_not_found' using errcode = 'P0002';
  end if;

  v_mode := case when p_full then 'full' else 'restricted' end;
  if v_member.privacy_mode = v_mode then
    return true;
  end if;

  update public.chat_bot_members member_row
  set privacy_mode = v_mode,
      joined_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where member_row.chat_id = p_chat_id
    and member_row.bot_id = p_bot_id
    and member_row.removed_at is null;

  insert into private.bot_audit_events(bot_id, action, metadata)
  values (p_bot_id, 'bot_privacy_changed', pg_catalog.jsonb_build_object(
    'actor_id', v_actor,
    'chat_id', p_chat_id,
    'from', v_member.privacy_mode,
    'to', v_mode
  ));
  return true;
end;
$$;

comment on function public.chat_bot_set_privacy(uuid, uuid, boolean) is
  'Group-admin opt-in to all future messages for one active bot; each mode change resets its readable history boundary.';

revoke all on function public.chat_bot_set_privacy(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.chat_bot_set_privacy(uuid, uuid, boolean)
  to authenticated;

do $$
begin
  if not pg_catalog.has_function_privilege(
    'authenticated', 'public.chat_bot_set_privacy(uuid,uuid,boolean)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon', 'public.chat_bot_set_privacy(uuid,uuid,boolean)', 'EXECUTE'
  ) then
    raise exception 'chat_bot_set_privacy_grant_mismatch';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.chat_bot_members', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.chat_bot_members', 'UPDATE') then
    raise exception 'chat_bot_members_direct_update_granted';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.chat_bot_members'::regclass and relrowsecurity
  ) then
    raise exception 'chat_bot_members_rls_disabled';
  end if;
end;
$$;
