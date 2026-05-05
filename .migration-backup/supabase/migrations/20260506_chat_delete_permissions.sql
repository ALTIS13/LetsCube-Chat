-- Purpose:
--   Allow an owner-authorized group/channel chat DELETE to cascade through
--   chat_members without being blocked by the last-owner protection trigger.
--
-- Dependencies:
--   - public.chats
--   - public.chat_members
--   - existing public.enforce_chat_member_delete() trigger function
--   - existing RLS policy "Chat owners delete chat" on public.chats
--
-- Apply order:
--   1. Apply this migration in Supabase SQL Editor.
--   2. Verify the trigger/function definitions with the verify SQL below.
--   3. Re-test deleting a QA_ group chat from the frontend.
--
-- Notes:
--   This does not broaden who can delete a chat. RLS on public.chats remains
--   the source of truth: currently only is_chat_owner(id) can DELETE.
--   The change only distinguishes "owner row is being removed because the
--   whole parent chat is being deleted" from "someone is trying to remove the
--   last owner from a still-existing chat".

begin;

create or replace function public.mark_chat_delete_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  deleting_chat_ids text;
begin
  deleting_chat_ids := coalesce(current_setting('kub.deleting_chat_ids', true), ',');
  if deleting_chat_ids = '' then
    deleting_chat_ids := ',';
  end if;

  if deleting_chat_ids not like ('%,' || old.id::text || ',%') then
    perform set_config('kub.deleting_chat_ids', deleting_chat_ids || old.id::text || ',', true);
  end if;

  return old;
end;
$$;

drop trigger if exists trg_mark_chat_delete_cascade on public.chats;

create trigger trg_mark_chat_delete_cascade
before delete on public.chats
for each row
execute function public.mark_chat_delete_cascade();

create or replace function public.enforce_chat_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
  deleting_chat_ids text;
begin
  if old.role = 'owner'::public.chat_member_role then
    deleting_chat_ids := coalesce(current_setting('kub.deleting_chat_ids', true), '');

    -- When public.chats is being deleted, its chat_members rows are removed by
    -- ON DELETE CASCADE. That is not an owner-management operation and should
    -- not trip last-owner protection.
    if deleting_chat_ids like ('%,' || old.chat_id::text || ',%') then
      return old;
    end if;

    perform pg_advisory_xact_lock(hashtext('chat_owner:' || old.chat_id::text));
    select count(*) into remaining
      from public.chat_members
     where chat_id  = old.chat_id
       and role     = 'owner'::public.chat_member_role
       and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'Нельзя удалить последнего владельца чата'
        using errcode = 'P0001';
    end if;
  end if;
  return old;
end;
$$;

revoke all on function public.mark_chat_delete_cascade() from public, anon, authenticated;

commit;

-- Verify SQL:
--
-- 1. Trigger exists on chats:
-- select tgname, tgenabled
-- from pg_trigger
-- where tgrelid = 'public.chats'::regclass
--   and tgname = 'trg_mark_chat_delete_cascade';
--
-- 2. Last-owner protection still exists:
-- select pg_get_functiondef('public.enforce_chat_member_delete()'::regprocedure);
--
-- 3. Chat delete policy is still owner-only:
-- select policyname, cmd, qual
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'chats'
--   and cmd = 'DELETE';
--
-- Manual QA checklist:
--   - Create a temporary group named QA_group_delete_test_* from the UI.
--   - Confirm the creator is owner and sees "Удалить групповой чат".
--   - Delete it from the chat header or info panel.
--   - Confirm the chat disappears from the list and WelcomeScreen is shown.
--   - Confirm related rows are gone:
--       select count(*) from public.chats where name like 'QA_group_delete_test_%';
--       select count(*) from public.chat_members cm
--        where not exists (select 1 from public.chats c where c.id = cm.chat_id);
--       select count(*) from public.messages m
--        where not exists (select 1 from public.chats c where c.id = m.chat_id);
--   - Confirm deleting/removing the last owner from an existing chat without
--     deleting the chat still fails with "Нельзя удалить последнего владельца чата".
--
-- Rollback / compatibility notes:
--   - To rollback the cascade marker only:
--       drop trigger if exists trg_mark_chat_delete_cascade on public.chats;
--       drop function if exists public.mark_chat_delete_cascade();
--   - If rolled back, owner-authorized group delete may again fail on the
--     last-owner chat_members trigger. No table shape changes are introduced.
