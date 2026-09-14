/**
 * Categories for a group's channels, so a group can be shaped like a server.
 *
 * The database already had almost all of this and the interface used almost
 * none of it: `voice_channels` has carried `chat_id`, `name`, `position`,
 * `max_participants`, `speak_role` and `archived` since the voice work, with
 * "admins manage voice channels" granting `is_chat_admin(chat_id)` FOR ALL --
 * so an administrator could always have had as many rooms as they liked. The
 * client read `.limit(1)` and offered no way to make a second one. `topics` is
 * the same shape for text.
 *
 * What is genuinely missing for the server shape is the grouping: a rail of
 * channels under collapsible headings, which is how a server stays readable
 * once it has more than about six of them.
 *
 * **The composite foreign key is the point of this file.** A category belongs
 * to one chat, and a channel in another chat must not be able to point at it.
 * That is not a CHECK -- it spans two tables -- and a trigger would be a rule
 * living somewhere nobody looks. A unique key on (chat_id, id) makes it a
 * schema fact instead:
 *
 *     foreign key (chat_id, category_id)
 *       references chat_channel_categories (chat_id, id)
 *
 * With the default MATCH SIMPLE, a null category_id satisfies the constraint
 * outright, which is exactly what an uncategorised channel needs.
 *
 * **And the delete action names its column.** `on delete set null
 * (category_id)` rather than a bare `set null`, which would try to null
 * `chat_id` too -- a NOT NULL column -- and fail the delete. That is D-189
 * exactly: a referential action is a write, and the write meets every
 * constraint on the table. PostgreSQL 17.6 here; the column list needs 15.
 *
 * Deleting a category therefore leaves its channels where they are, without a
 * heading. That is what Discord does, and it is the safe direction: losing a
 * heading is an inconvenience, losing a room full of history is not.
 *
 * **Run this as `supabase_admin`, not as `postgres`.** `voice_channels` is owned
 * by `supabase_admin` while `topics`, `chats` and `messages` are owned by
 * `postgres`, and the first attempt died on
 * "must be owner of table voice_channels" after creating the table -- the
 * transaction rolled the whole thing back, which is why it is one transaction.
 * `postgres` cannot `set role supabase_admin` here (`pg_has_role` answers
 * false), so there is no way to do it from the other side. The new table's
 * owner is set back to `postgres` at the end so it matches its siblings.
 *
 * Rollback: 20260914140000_channel_categories.rollback.sql. Run that as
 * `supabase_admin` too, for the same reason.
 */

begin;

set local lock_timeout = '5s';

create table if not exists public.chat_channel_categories (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_channel_categories_name_length
    check (char_length(btrim(name)) between 1 and 64),
  constraint chat_channel_categories_chat_id_id_key unique (chat_id, id)
);

create index if not exists chat_channel_categories_chat_position_idx
  on public.chat_channel_categories (chat_id, position, created_at);

-- Revoked before anything is granted. This deployment's default privileges
-- hand anon and authenticated arwd on every new table in public, read off
-- pg_default_acl on 2026-09-14, so create table publishes it and a narrower
-- grant afterwards adds nothing.
revoke all on public.chat_channel_categories from anon, authenticated;
grant select, insert, update, delete on public.chat_channel_categories to authenticated;

alter table public.chat_channel_categories enable row level security;

drop policy if exists "members read channel categories" on public.chat_channel_categories;
create policy "members read channel categories"
  on public.chat_channel_categories for select to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "admins manage channel categories" on public.chat_channel_categories;
create policy "admins manage channel categories"
  on public.chat_channel_categories for all to authenticated
  using (public.is_chat_admin(chat_id))
  with check (public.is_chat_admin(chat_id));

-- The same four restrictive guards topics and voice_channels carry.
drop policy if exists "block banned reads" on public.chat_channel_categories;
create policy "block banned reads"
  on public.chat_channel_categories as restrictive for select to authenticated
  using (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (insert)" on public.chat_channel_categories;
create policy "block banned writes (insert)"
  on public.chat_channel_categories as restrictive for insert to authenticated
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (update)" on public.chat_channel_categories;
create policy "block banned writes (update)"
  on public.chat_channel_categories as restrictive for update to authenticated
  using (not public.is_banned(auth.uid()))
  with check (not public.is_banned(auth.uid()));

drop policy if exists "block banned writes (delete)" on public.chat_channel_categories;
create policy "block banned writes (delete)"
  on public.chat_channel_categories as restrictive for delete to authenticated
  using (not public.is_banned(auth.uid()));

alter table public.topics
  add column if not exists category_id uuid;
alter table public.voice_channels
  add column if not exists category_id uuid;

do $fk$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.topics'::regclass and conname = 'topics_category_fkey'
  ) then
    alter table public.topics
      add constraint topics_category_fkey
      foreign key (chat_id, category_id)
      references public.chat_channel_categories (chat_id, id)
      on delete set null (category_id);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.voice_channels'::regclass and conname = 'voice_channels_category_fkey'
  ) then
    alter table public.voice_channels
      add constraint voice_channels_category_fkey
      foreign key (chat_id, category_id)
      references public.chat_channel_categories (chat_id, id)
      on delete set null (category_id);
  end if;
end
$fk$;

create index if not exists topics_category_idx
  on public.topics (category_id) where category_id is not null;
create index if not exists voice_channels_category_idx
  on public.voice_channels (category_id) where category_id is not null;

-- The new columns are written by the same people who already manage the row,
-- so they need no grant of their own: topics and voice_channels grant
-- authenticated table-wide UPDATE already, filtered by "admins manage ...".

-- Created by supabase_admin because voice_channels needs that; owned by
-- postgres afterwards because topics, chats and messages are.
alter table public.chat_channel_categories owner to postgres;

do $check$
declare
  v_def text;
  v_count integer;
  v_owner text;
begin
  select pg_get_userbyid(relowner) into v_owner
    from pg_catalog.pg_class where oid = 'public.chat_channel_categories'::regclass;
  if v_owner <> 'postgres' then
    raise exception 'the new table is owned by % rather than postgres', v_owner;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
     where oid = 'public.chat_channel_categories'::regclass and relrowsecurity
  ) then
    raise exception 'row level security is not on for chat_channel_categories';
  end if;

  if has_table_privilege('anon', 'public.chat_channel_categories', 'select')
     or has_table_privilege('anon', 'public.chat_channel_categories', 'insert') then
    raise exception 'anon can still reach chat_channel_categories';
  end if;

  select count(*) into v_count from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'chat_channel_categories'
     and permissive = 'RESTRICTIVE';
  if v_count <> 4 then
    raise exception 'expected four restrictive guards, found %', v_count;
  end if;

  for v_def in
    select pg_get_constraintdef(oid) from pg_catalog.pg_constraint
     where conname in ('topics_category_fkey', 'voice_channels_category_fkey')
  loop
    if v_def not like '%ON DELETE SET NULL (category_id)%' then
      raise exception 'a category foreign key would null more than the category: %', v_def;
    end if;
    if v_def not like '%(chat_id, category_id)%' then
      raise exception 'a category foreign key is not scoped to the chat: %', v_def;
    end if;
  end loop;

  select count(*) into v_count from pg_catalog.pg_constraint
   where conname in ('topics_category_fkey', 'voice_channels_category_fkey');
  if v_count <> 2 then
    raise exception 'expected both category foreign keys, found %', v_count;
  end if;

  raise notice 'channel categories are in, scoped to their chat, and delete only the heading';
end
$check$;

commit;
