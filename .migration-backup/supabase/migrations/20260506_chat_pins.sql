-- Purpose:
--   Add per-user pinned chats so important chats can stay above regular chats
--   without changing other participants' ordering.
--
-- Dependencies:
--   public.chat_members(chat_id, user_id)
--   public.chats(id)
--   public.is_banned(uuid)
--
-- Apply manually in Supabase SQL Editor. Do not apply automatically from Codex.

begin;

alter table public.chat_members
  add column if not exists pinned boolean not null default false,
  add column if not exists pinned_at timestamptz;

create index if not exists idx_chat_members_user_pinned
  on public.chat_members (user_id, pinned desc, pinned_at desc);

create or replace function public.pin_chat(p_chat_id uuid)
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
  set pinned = true,
      pinned_at = now()
  where chat_id = p_chat_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Chat is not available';
  end if;
end;
$$;

create or replace function public.unpin_chat(p_chat_id uuid)
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
  set pinned = false,
      pinned_at = null
  where chat_id = p_chat_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Chat is not available';
  end if;
end;
$$;

revoke all on function public.pin_chat(uuid) from public, anon;
revoke all on function public.unpin_chat(uuid) from public, anon;
grant execute on function public.pin_chat(uuid) to authenticated;
grant execute on function public.unpin_chat(uuid) to authenticated;

commit;

-- Verify SQL:
-- 1. Columns:
--    select column_name, data_type, column_default
--    from information_schema.columns
--    where table_schema='public'
--      and table_name='chat_members'
--      and column_name in ('pinned','pinned_at')
--    order by column_name;
--
-- 2. RPC functions:
--    select p.proname, pg_get_function_arguments(p.oid)
--    from pg_proc p
--    join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname in ('pin_chat','unpin_chat')
--    order by p.proname;
--
-- 3. Realtime:
--    select pubname, schemaname, tablename
--    from pg_publication_tables
--    where pubname='supabase_realtime'
--      and schemaname='public'
--      and tablename='chat_members';
--
-- Manual QA:
-- - Pin a private chat; it moves above regular chats only for the current user.
-- - Pin a group chat; it moves above regular chats only for the current user.
-- - Unpin; the chat returns to regular updated_at/last-message ordering.
-- - Refresh page; pinned order persists.
-- - Open a second tab; chat_members realtime update refreshes order.
-- - Saved Messages / Избранное remains first regardless of pinned state.
--
-- Rollback / compatibility:
-- - drop function public.pin_chat(uuid);
-- - drop function public.unpin_chat(uuid);
-- - alter table public.chat_members drop column if exists pinned;
-- - alter table public.chat_members drop column if exists pinned_at;
