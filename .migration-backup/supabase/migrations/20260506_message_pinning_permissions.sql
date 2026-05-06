-- KUB messenger: allow chat members to pin/unpin messages safely.
--
-- Status:
--   Proposal only. Do NOT assume this has been applied until Supabase SQL Editor
--   verification passes.
--
-- Goal:
--   Any authenticated, non-banned member of a chat can pin or unpin a message in
--   that chat without receiving broad UPDATE access to other users' messages.
--
-- Dependencies:
--   - public.messages(id, chat_id, deleted_at, pinned)
--   - public.is_chat_member(uuid)
--   - public.is_banned(uuid)
--   - RLS remains enabled on public.messages.
--
-- Design:
--   Current RLS allows UPDATE messages only for the author. Opening UPDATE to all
--   chat members would also risk allowing edits/deletes of чужие сообщения.
--   Instead, these SECURITY DEFINER RPCs update only the pinned column after
--   checking auth, chat membership, deletion state, and ban state.

create or replace function public.pin_message(p_message_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.messages%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select *
    into v_message
    from public.messages
   where id = p_message_id
     and deleted_at is null;

  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;

  if public.is_banned(v_uid) then
    raise exception 'user_banned' using errcode = '42501';
  end if;

  if not public.is_chat_member(v_message.chat_id) then
    raise exception 'not_chat_member' using errcode = '42501';
  end if;

  update public.messages
     set pinned = true
   where id = p_message_id
   returning * into v_message;

  return v_message;
end;
$$;

create or replace function public.unpin_message(p_message_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.messages%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select *
    into v_message
    from public.messages
   where id = p_message_id
     and deleted_at is null;

  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;

  if public.is_banned(v_uid) then
    raise exception 'user_banned' using errcode = '42501';
  end if;

  if not public.is_chat_member(v_message.chat_id) then
    raise exception 'not_chat_member' using errcode = '42501';
  end if;

  update public.messages
     set pinned = false
   where id = p_message_id
   returning * into v_message;

  return v_message;
end;
$$;

revoke all on function public.pin_message(uuid) from public;
revoke all on function public.pin_message(uuid) from anon;
revoke all on function public.unpin_message(uuid) from public;
revoke all on function public.unpin_message(uuid) from anon;

grant execute on function public.pin_message(uuid) to authenticated;
grant execute on function public.unpin_message(uuid) to authenticated;

comment on function public.pin_message(uuid) is
  'Pins a non-deleted message when auth.uid() is a non-banned member of the message chat.';
comment on function public.unpin_message(uuid) is
  'Unpins a non-deleted message when auth.uid() is a non-banned member of the message chat.';

-- Verify SQL after applying manually:
--
-- 1) Functions exist and are SECURITY DEFINER:
-- select
--   p.proname,
--   p.prosecdef as security_definer,
--   pg_get_function_arguments(p.oid) as args
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('pin_message', 'unpin_message')
-- order by p.proname;
--
-- 2) Only authenticated has EXECUTE:
-- select
--   routine_name,
--   grantee,
--   privilege_type
-- from information_schema.routine_privileges
-- where specific_schema = 'public'
--   and routine_name in ('pin_message', 'unpin_message')
-- order by routine_name, grantee;
--
-- 3) RLS policy did not broaden message UPDATE:
-- select policyname, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'messages'
--   and cmd in ('UPDATE', 'ALL')
-- order by policyname;
--
-- 4) Realtime still publishes message updates:
-- select schemaname, tablename
-- from pg_publication_tables
-- where pubname = 'supabase_realtime'
--   and schemaname = 'public'
--   and tablename = 'messages';
--
-- Manual QA after applying:
-- 1. Open a chat as user A and find a message sent by user B.
-- 2. User A runs pin from the UI. Expected: message becomes pinned.
-- 3. User B sees pinned banner via realtime without refresh.
-- 4. User A or B unpins. Expected: banner disappears via realtime.
-- 5. A non-member cannot pin/unpin via direct RPC call.
-- 6. A banned user cannot pin/unpin.
-- 7. Editing/deleting чужие сообщения remains blocked by RLS.
--
-- Rollback / compatibility:
-- drop function if exists public.pin_message(uuid);
-- drop function if exists public.unpin_message(uuid);
--
-- Frontend compatibility:
-- Existing direct UPDATE-based pinning can keep working for own messages.
-- After this migration is applied, frontend should call pin_message/unpin_message
-- for all pin/unpin actions so members can pin чужие сообщения safely.
