-- Purpose:
--   Prepare safe per-user chat history clearing and private chat hiding.
--   Also tighten the current broad messages UPDATE policy so ordinary users
--   cannot globally soft-delete or edit messages they do not own.
--
-- Dependencies:
--   public.chat_members(chat_id, user_id)
--   public.chats(id, type)
--   public.messages(deleted_at, user_id, chat_id)
--   public.is_chat_member(uuid)
--   public.is_banned(uuid)
--
-- Apply manually in Supabase SQL Editor. Do not apply automatically from Codex.

begin;

alter table public.chat_members
  add column if not exists hidden_at timestamptz,
  add column if not exists cleared_at timestamptz;

create index if not exists idx_chat_members_user_hidden
  on public.chat_members (user_id, hidden_at);

create index if not exists idx_chat_members_user_cleared
  on public.chat_members (user_id, cleared_at);

-- Existing production state has a permissive "block banned writes (update)"
-- policy on messages. Because permissive policies are OR-ed together, that
-- policy allows any non-banned user to UPDATE every message row. Replace it
-- with a restrictive banned-user guard, while keeping the owner-only edit
-- policy as the permissive policy.
drop policy if exists "block banned writes (update)" on public.messages;

create policy "block banned writes (update)"
  on public.messages
  as restrictive
  for update
  to authenticated
  using (not public.is_banned(auth.uid()))
  with check (not public.is_banned(auth.uid()));

create or replace function public.clear_chat_for_me(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.is_banned(auth.uid()) then
    raise exception 'Недостаточно прав';
  end if;

  update public.chat_members
  set cleared_at = now()
  where chat_id = p_chat_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Chat is not available';
  end if;
end;
$$;

create or replace function public.hide_private_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.is_banned(auth.uid()) then
    raise exception 'Недостаточно прав';
  end if;

  select c.type
    into v_type
  from public.chats c
  join public.chat_members cm on cm.chat_id = c.id
  where c.id = p_chat_id
    and cm.user_id = auth.uid();

  if v_type is null then
    raise exception 'Chat is not available';
  end if;

  if v_type <> 'private' then
    raise exception 'Only private chats can be hidden with this function';
  end if;

  update public.chat_members
  set hidden_at = now(),
      cleared_at = coalesce(cleared_at, now())
  where chat_id = p_chat_id
    and user_id = auth.uid();
end;
$$;

create or replace function public.unhide_private_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.chat_members
  set hidden_at = null
  where chat_id = p_chat_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Chat is not available';
  end if;
end;
$$;

revoke all on function public.clear_chat_for_me(uuid) from public, anon;
revoke all on function public.hide_private_chat(uuid) from public, anon;
revoke all on function public.unhide_private_chat(uuid) from public, anon;
grant execute on function public.clear_chat_for_me(uuid) to authenticated;
grant execute on function public.hide_private_chat(uuid) to authenticated;
grant execute on function public.unhide_private_chat(uuid) to authenticated;

commit;

-- Verify SQL:
-- 1. Columns:
--    select column_name, data_type
--    from information_schema.columns
--    where table_schema='public'
--      and table_name='chat_members'
--      and column_name in ('hidden_at','cleared_at')
--    order by column_name;
--
-- 2. Messages UPDATE policies:
--    select policyname, permissive, cmd, qual, with_check
--    from pg_policies
--    where schemaname='public'
--      and tablename='messages'
--      and cmd='UPDATE'
--    order by policyname;
--
-- 3. RPC grants:
--    select routine_name
--    from information_schema.routines
--    where specific_schema='public'
--      and routine_name in ('clear_chat_for_me','hide_private_chat','unhide_private_chat');
--
-- Manual QA:
-- - Ordinary user can no longer globally soft-delete all messages by direct
--   UPDATE; own-message edit/delete still works.
-- - clear_chat_for_me hides old messages locally after frontend alignment.
-- - hide_private_chat hides a private chat only for the current user after
--   frontend alignment; the other participant still sees the chat.
-- - A new incoming message should unhide or re-surface the chat according to
--   the frontend alignment decision.
--
-- Rollback / compatibility:
-- - drop function public.clear_chat_for_me(uuid);
-- - drop function public.hide_private_chat(uuid);
-- - drop function public.unhide_private_chat(uuid);
-- - alter table public.chat_members drop column if exists hidden_at;
-- - alter table public.chat_members drop column if exists cleared_at;
-- - The restrictive messages policy can be dropped and replaced with the old
--   permissive policy only if you intentionally accept the global update risk.
