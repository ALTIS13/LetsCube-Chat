-- Private & Group Chats Hardening (Task #28) — REVISED
--
-- Closes the "open" RLS on chats / chat_members that the original schema
-- shipped with, separates the global `app_role` from the per-chat
-- `chat_member_role`, adds last-owner protection, auto-adds the creator
-- as owner, and exposes `open_or_create_private_chat` so the client can
-- no longer race itself into duplicate private chats.
--
-- This revision fixes two problems with the previous draft:
--
--   1. The `alter column role type chat_member_role` step failed because
--      RLS policies on chat_members (some inherited from the baseline
--      schema) referenced the column directly as text. Postgres refuses
--      a type change on a column that any policy expression depends on.
--      The fix: dynamically drop EVERY policy on chat_members before the
--      alter, then recreate the full set afterwards.
--
--   2. The membership helpers (`is_chat_member`, `chat_role_of`,
--      `is_chat_admin`, `is_chat_owner`) used to take a `(cid, uid)`
--      pair where `uid` defaulted to `auth.uid()`. Authenticated users
--      could pass an arbitrary uid and probe other people's
--      membership. This revision drops those signatures and ships
--      single-argument helpers `(cid uuid)` that read `auth.uid()`
--      internally, so the caller is never able to spoof an identity.
--
-- Idempotent: safe to re-apply.  Apply in the Supabase SQL editor.
--
-- Depends on the SECURITY DEFINER helpers shipped in
-- `20260504_roles_admin.sql` (`is_admin`, `is_banned`).

-- ── 1. chat_member_role enum ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'chat_member_role') then
    create type public.chat_member_role as enum ('owner', 'admin', 'member');
  end if;
end $$;

-- ── 2. Drop EVERY policy that depends on chat_members / the old helpers ──
-- We have to do this BEFORE the column type change and BEFORE dropping the
-- old two-argument helper signatures.
--
-- a) chat_members: nuke all policies dynamically — baseline / pre-task-28
--    policies referencing `role` as text would otherwise block the alter.
do $$
declare p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public' and tablename = 'chat_members'
  loop
    execute format('drop policy if exists %I on public.chat_members', p.policyname);
  end loop;
end $$;

-- b) chats: drop the policies we manage here so the helper drop succeeds.
--    "Chat members can update chats" (from 20260427_chats_update_policy.sql)
--    is the older permissive form that subselected chat_members and is
--    replaced below by the stricter "Chat admins update chat".
drop policy if exists "Authenticated users can create chats" on public.chats;
drop policy if exists "Users create chats with self as creator" on public.chats;
drop policy if exists "Chat members can update chats"          on public.chats;
drop policy if exists "Chat admins update chat"                on public.chats;
drop policy if exists "Chat owners delete chat"                on public.chats;

-- c) messages: drop the SELECT/INSERT policies that call is_chat_member.
drop policy if exists "Chat members can view messages" on public.messages;
drop policy if exists "Chat members can send messages" on public.messages;

-- d) topics (from 20260427_topics.sql): both policies expand
--    `chat_members.role in ('owner','admin')` as TEXT directly.  Postgres
--    refuses to convert the column to the enum while these policies depend
--    on the text expression, so we drop them here and recreate them in
--    section 10b using the safe one-arg helpers.  The restrictive ban veto
--    policies on `topics` (from roles_admin) only reference `is_banned`,
--    so they are NOT touched.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='topics') then
    execute 'drop policy if exists "members read topics"  on public.topics';
    execute 'drop policy if exists "admins manage topics" on public.topics';
  end if;
end $$;

-- NOTE: `Admins update any profile` on public.profiles is intentionally
-- left in place — it references `profiles.role::app_role`, NOT
-- `chat_members.role`, so it does not block the type conversion below
-- and belongs to the global role system (roles_admin migration), not to
-- this one.

-- e) tasks / task_events (Task #30): if the previous tasks migration was
--    applied before this revision, its policies also reference the helper.
--    Dropping them defensively means Task #30 can be (re-)applied cleanly
--    afterwards.  The recreate is owned by Task #30, not by us.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='tasks') then
    execute 'drop policy if exists "tasks select"                    on public.tasks';
    execute 'drop policy if exists "tasks select for participants"   on public.tasks';
    execute 'drop policy if exists "tasks insert blocked"            on public.tasks';
    execute 'drop policy if exists "tasks update blocked"            on public.tasks';
    execute 'drop policy if exists "tasks delete blocked"            on public.tasks';
  end if;
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='task_events') then
    execute 'drop policy if exists "task_events select"                  on public.task_events';
    execute 'drop policy if exists "task_events select for participants" on public.task_events';
    execute 'drop policy if exists "task_events insert blocked"          on public.task_events';
    execute 'drop policy if exists "task_events update blocked"          on public.task_events';
    execute 'drop policy if exists "task_events delete blocked"          on public.task_events';
  end if;
end $$;

-- ── 3. Drop the old two-argument helper signatures ───────────────────────
-- `create or replace` cannot change a function's signature, so we must
-- drop the old shape explicitly.  The new single-arg shape is created in
-- section 5.  We use `drop function if exists` so re-runs are safe even
-- when the old shape never existed.
drop function if exists public.is_chat_member(uuid, uuid);
drop function if exists public.chat_role_of(uuid, uuid);
drop function if exists public.is_chat_admin(uuid, uuid);
drop function if exists public.is_chat_owner(uuid, uuid);

-- ── 4. Convert chat_members.role from text → enum ────────────────────────
-- The original baseline ships a text CHECK constraint such as
--   CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))
-- and possibly partial indexes that compare `role` to text literals.  When
-- Postgres tries to convert the column to the enum, it re-validates those
-- expressions and fails with `operator does not exist: chat_member_role = text`.
-- Drop every CHECK constraint and every index on chat_members that mentions
-- `role` BEFORE the alter; the enum itself already restricts the allowed
-- values, so we do NOT recreate a text-based CHECK afterwards.

-- 4a. Drop all CHECK constraints on chat_members whose definition mentions `role`.
do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.chat_members'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format(
      'alter table public.chat_members drop constraint if exists %I',
      r.conname
    );
  end loop;
end $$;

-- 4b. Drop any non-PK index on chat_members whose definition mentions `role`
--     (typically partial indexes like `WHERE role = 'owner'::text` that would
--     also fail to re-validate against the enum).  The PK is intentionally
--     skipped — it doesn't reference role.
do $$
declare r record;
begin
  for r in
    select i.indexname
      from pg_indexes i
     where i.schemaname = 'public'
       and i.tablename  = 'chat_members'
       and i.indexdef   ilike '%role%'
       and not exists (
         -- never drop the table's primary key
         select 1
           from pg_constraint c
          where c.conrelid = 'public.chat_members'::regclass
            and c.contype  = 'p'
            and c.conname  = i.indexname
       )
  loop
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end $$;

-- 4c. Convert the column. Using a CASE with a 'member' fallback keeps the
--     migration safe even if a baseline row holds an unexpected value
--     (e.g. 'creator' from an earlier draft); the cast can't blow up.
do $$
declare current_udt text;
begin
  select udt_name into current_udt
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'chat_members'
     and column_name  = 'role';

  if current_udt <> 'chat_member_role' then
    alter table public.chat_members alter column role drop default;
    alter table public.chat_members
      alter column role type public.chat_member_role
      using (
        case
          when role::text in ('owner', 'admin', 'member')
            then role::text::public.chat_member_role
          else 'member'::public.chat_member_role
        end
      );
    alter table public.chat_members
      alter column role set default 'member'::public.chat_member_role;
    alter table public.chat_members
      alter column role set not null;
  end if;
end $$;

-- NOTE: we deliberately do NOT add a new CHECK on `role` here. The enum
-- type already constrains the allowed values, and any text-based CHECK
-- would just re-introduce the same alter-type blocker for the next
-- migration that touches this column.

-- ── 5. SECURITY DEFINER membership helpers — single argument ─────────────
-- These read `auth.uid()` themselves so that no authenticated caller can
-- substitute another user's id.  They live in `public` and are exposed to
-- the `authenticated` role only.  RLS policies and other RPCs call them
-- without arguments aside from the chat id.
create or replace function public.is_chat_member(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = cid and user_id = auth.uid()
  )
$$;

create or replace function public.chat_role_of(cid uuid)
returns public.chat_member_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.chat_members
   where chat_id = cid and user_id = auth.uid()
$$;

create or replace function public.is_chat_admin(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = cid and user_id = auth.uid()
       and role in ('owner', 'admin')
  )
$$;

create or replace function public.is_chat_owner(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = cid and user_id = auth.uid()
       and role = 'owner'
  )
$$;

revoke all on function public.is_chat_member(uuid) from public, anon;
revoke all on function public.chat_role_of(uuid)   from public, anon;
revoke all on function public.is_chat_admin(uuid)  from public, anon;
revoke all on function public.is_chat_owner(uuid)  from public, anon;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.chat_role_of(uuid)   to authenticated;
grant execute on function public.is_chat_admin(uuid)  to authenticated;
grant execute on function public.is_chat_owner(uuid)  to authenticated;

-- ── 6. chats — INSERT / UPDATE / DELETE policies ────────────────────────
create policy "Users create chats with self as creator"
  on public.chats for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Chat admins update chat"
  on public.chats for update
  to authenticated
  using      (public.is_chat_admin(chats.id))
  with check (public.is_chat_admin(chats.id));

create policy "Chat owners delete chat"
  on public.chats for delete
  to authenticated
  using (public.is_chat_owner(chats.id));

-- ── 7. Auto-add creator as owner ─────────────────────────────────────────
create or replace function public.add_chat_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.chat_members (chat_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (chat_id, user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_add_chat_creator_as_owner on public.chats;
create trigger trg_add_chat_creator_as_owner
  after insert on public.chats
  for each row execute function public.add_chat_creator_as_owner();

-- ── 8. chat_members — recreate the full policy set ──────────────────────
-- All previous policies on chat_members were dropped in section 2.

create policy "chat_members select"
  on public.chat_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_chat_member(chat_id)
  );

create policy "chat_members insert"
  on public.chat_members for insert
  to authenticated
  with check (
    public.is_chat_admin(chat_id)
    and role = 'member'::public.chat_member_role
  );

create policy "chat_members update"
  on public.chat_members for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_chat_admin(chat_id)
  )
  with check (
    user_id = auth.uid()
    or public.is_chat_admin(chat_id)
  );

create policy "chat_members delete"
  on public.chat_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or (public.chat_role_of(chat_id) = 'owner' and role <> 'owner')
    or (public.chat_role_of(chat_id) = 'admin' and role  = 'member')
  );

-- Re-add the ban veto policies on chat_members (these were dropped in
-- section 2 along with the rest).  They are also defined by the
-- roles_admin migration's loop — duplicating the names here keeps this
-- migration self-contained, and `drop policy if exists` in roles_admin
-- means a re-run there will simply rebuild them.
create policy "block banned writes (insert)"
  on public.chat_members
  as restrictive
  for insert to authenticated
  with check (not public.is_banned(auth.uid()));

create policy "block banned writes (update)"
  on public.chat_members
  as restrictive
  for update to authenticated
  using      (not public.is_banned(auth.uid()))
  with check (not public.is_banned(auth.uid()));

create policy "block banned writes (delete)"
  on public.chat_members
  as restrictive
  for delete to authenticated
  using (not public.is_banned(auth.uid()));

create policy "block banned reads"
  on public.chat_members
  as restrictive
  for select to authenticated
  using (not public.is_banned(auth.uid()));

-- ── 9. chat_members — role-change matrix + last-owner protection ────────
create or replace function public.enforce_chat_member_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller       uuid := auth.uid();
  caller_role  public.chat_member_role;
  remaining    int;
begin
  if caller is null then
    return new;  -- service / SQL session
  end if;

  if new.chat_id is distinct from old.chat_id
     or new.user_id is distinct from old.user_id then
    raise exception 'Нельзя переносить участника между чатами'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    select role into caller_role
      from public.chat_members
     where chat_id = new.chat_id and user_id = caller;

    if caller_role = 'owner'::public.chat_member_role then
      null;  -- full control
    elsif caller_role = 'admin'::public.chat_member_role then
      if old.role = 'owner'::public.chat_member_role
         or new.role = 'owner'::public.chat_member_role then
        raise exception 'Администратор не может менять роль владельца'
          using errcode = '42501';
      end if;
      if not (
        (old.role = 'member' and new.role = 'admin')
        or
        (old.role = 'admin'  and new.role = 'member')
      ) then
        raise exception 'Недопустимое изменение роли'
          using errcode = '42501';
      end if;
    else
      raise exception 'Только владелец или администратор может менять роли'
        using errcode = '42501';
    end if;

    if old.role = 'owner'::public.chat_member_role
       and new.role <> 'owner'::public.chat_member_role then
      perform pg_advisory_xact_lock(hashtext('chat_owner:' || new.chat_id::text));
      select count(*) into remaining
        from public.chat_members
       where chat_id  = new.chat_id
         and role     = 'owner'::public.chat_member_role
         and user_id <> old.user_id;
      if remaining = 0 then
        raise exception 'Нельзя снять последнего владельца чата'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_chat_member_update on public.chat_members;
create trigger trg_enforce_chat_member_update
  before update on public.chat_members
  for each row execute function public.enforce_chat_member_update();

create or replace function public.enforce_chat_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if old.role = 'owner'::public.chat_member_role then
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
end $$;

drop trigger if exists trg_enforce_chat_member_delete on public.chat_members;
create trigger trg_enforce_chat_member_delete
  before delete on public.chat_members
  for each row execute function public.enforce_chat_member_delete();

-- ── 10. messages — recreate SELECT / INSERT policies ────────────────────
create policy "Chat members can view messages"
  on public.messages for select
  to authenticated
  using (public.is_chat_member(chat_id));

create policy "Chat members can send messages"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.is_chat_member(chat_id)
  );

-- ── 10b. topics — recreate the policies using the safe helpers ──────────
-- Same intent as the originals from 20260427_topics.sql: any chat member
-- can SELECT, only owner/admin can INSERT/UPDATE/DELETE. Now expressed
-- via SECURITY DEFINER helpers, so we don't expand chat_members in the
-- policy body and the column type can change freely in the future.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='topics') then
    execute $p$
      create policy "members read topics"
        on public.topics for select
        to authenticated
        using (public.is_chat_member(topics.chat_id))
    $p$;
    execute $p$
      create policy "admins manage topics"
        on public.topics for all
        to authenticated
        using      (public.is_chat_admin(topics.chat_id))
        with check (public.is_chat_admin(topics.chat_id))
    $p$;
  end if;
end $$;

-- ── 11. open_or_create_private_chat RPC ─────────────────────────────────
create or replace function public.open_or_create_private_chat(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  cid    uuid;
begin
  if caller is null then
    raise exception 'Требуется аутентификация' using errcode = '42501';
  end if;
  if target_user_id is null then
    raise exception 'Не указан собеседник' using errcode = '22023';
  end if;
  if target_user_id = caller then
    raise exception 'Нельзя открыть приватный чат с самим собой' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'Пользователь не найден' using errcode = 'P0002';
  end if;
  if public.is_banned(caller) then
    raise exception 'Пользователь заблокирован' using errcode = '42501';
  end if;

  -- Order-independent advisory lock: same key for (a,b) and (b,a).
  perform pg_advisory_xact_lock(
    hashtext(
      'private_chat:' ||
      least(caller::text, target_user_id::text) || ':' ||
      greatest(caller::text, target_user_id::text)
    )
  );

  select c.id into cid
    from public.chats c
   where c.type = 'private'
     and exists (select 1 from public.chat_members m
                  where m.chat_id = c.id and m.user_id = caller)
     and exists (select 1 from public.chat_members m
                  where m.chat_id = c.id and m.user_id = target_user_id)
     and (select count(*) from public.chat_members m where m.chat_id = c.id) = 2
   order by c.created_at asc
   limit 1;

  if cid is not null then
    return cid;
  end if;

  insert into public.chats (type, created_by)
       values ('private', caller)
    returning id into cid;

  insert into public.chat_members (chat_id, user_id, role)
       values (cid, target_user_id, 'member'::public.chat_member_role);

  return cid;
end $$;

revoke all on function public.open_or_create_private_chat(uuid) from public, anon;
grant execute on function public.open_or_create_private_chat(uuid) to authenticated;

-- ── 12. Backfill: ensure every existing chat has at least one owner ─────
update public.chat_members cm
   set role = 'owner'::public.chat_member_role
  where cm.user_id = (
    select user_id from public.chat_members
     where chat_id = cm.chat_id
     order by joined_at asc
     limit 1
  )
  and not exists (
    select 1 from public.chat_members
     where chat_id = cm.chat_id
       and role    = 'owner'::public.chat_member_role
  );
