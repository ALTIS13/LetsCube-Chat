-- 20260507_message_hide_for_me.sql
--
-- Goal:
--   Add per-user message hiding ("delete for me") without changing global
--   message deletion semantics and without deleting Storage objects for other
--   chat members.
--
-- Manual apply:
--   Apply this file in Supabase SQL Editor. Do not disable RLS.
--
-- Compatibility:
--   Existing messages remain visible. A message becomes hidden only for the
--   authenticated user who inserts a row in message_hidden_for_users.
--
-- Frontend follow-up after apply:
--   1. Filter message list/search/media gallery/pinned/last-message preview
--      by excluding message ids present in message_hidden_for_users for auth.uid().
--   2. Use hide_message_for_me(p_message_id) for "Удалить у себя"/"Скрыть у себя".
--   3. Keep existing global soft delete only for messages the current backend
--      allows the user to update/delete globally.

begin;

create table if not exists public.message_hidden_for_users (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_hidden_for_users_user_hidden_idx
  on public.message_hidden_for_users (user_id, hidden_at desc);

create index if not exists message_hidden_for_users_message_idx
  on public.message_hidden_for_users (message_id);

alter table public.message_hidden_for_users enable row level security;

grant select, insert, delete on public.message_hidden_for_users to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'message_hidden_for_users'
      and policyname = 'message_hidden_for_users select own'
  ) then
    create policy "message_hidden_for_users select own"
      on public.message_hidden_for_users
      for select
      to authenticated
      using (user_id = (select auth.uid()));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'message_hidden_for_users'
      and policyname = 'message_hidden_for_users insert own visible'
  ) then
    create policy "message_hidden_for_users insert own visible"
      on public.message_hidden_for_users
      for insert
      to authenticated
      with check (
        user_id = (select auth.uid())
        and exists (
          select 1
          from public.messages m
          where m.id = message_id
            and m.deleted_at is null
            and public.is_chat_member(m.chat_id)
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'message_hidden_for_users'
      and policyname = 'message_hidden_for_users delete own'
  ) then
    create policy "message_hidden_for_users delete own"
      on public.message_hidden_for_users
      for delete
      to authenticated
      using (user_id = (select auth.uid()));
  end if;
end $$;

create or replace function public.hide_message_for_me(p_message_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into public.message_hidden_for_users (message_id, user_id)
  select m.id, v_uid
  from public.messages m
  where m.id = p_message_id
    and m.deleted_at is null
    and public.is_chat_member(m.chat_id)
  on conflict (message_id, user_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 and not exists (
    select 1
    from public.message_hidden_for_users h
    where h.message_id = p_message_id
      and h.user_id = v_uid
  ) then
    raise exception 'Message is not visible for current user' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.unhide_message_for_me(p_message_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.message_hidden_for_users
  where message_id = p_message_id
    and user_id = auth.uid();
$$;

grant execute on function public.hide_message_for_me(uuid) to authenticated;
grant execute on function public.unhide_message_for_me(uuid) to authenticated;

comment on table public.message_hidden_for_users is
  'Per-user message hide state for delete-for-me. Does not delete messages or media globally.';

comment on function public.hide_message_for_me(uuid) is
  'Hide one visible chat message for the current authenticated user only.';

comment on function public.unhide_message_for_me(uuid) is
  'Remove current user hide state for one message.';

commit;

-- Verify SQL after manual apply:
--
-- 1. Table and RLS:
-- select c.relname as table_name, c.relrowsecurity as rls_enabled
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname = 'message_hidden_for_users';
--
-- 2. Policies:
-- select policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename = 'message_hidden_for_users'
-- order by policyname;
--
-- 3. RPCs:
-- select proname, pg_get_function_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in ('hide_message_for_me', 'unhide_message_for_me')
-- order by proname;
--
-- 4. Manual QA:
-- - User A hides a message from User B with hide_message_for_me(message_id).
-- - The row appears only for User A in message_hidden_for_users.
-- - User B still sees the original message and media.
-- - After frontend follow-up filters are applied, User A no longer sees that
--   message in message list, search, media gallery, pinned banner, or preview.
