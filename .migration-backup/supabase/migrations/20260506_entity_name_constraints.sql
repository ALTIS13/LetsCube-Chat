-- KUB: entity name constraints proposal
-- Date: 2026-05-06
--
-- Purpose:
--   Add database-level length guards for user-editable chat/folder/topic names.
--   Frontend already truncates new input, but DB constraints keep direct API
--   calls from storing names that break the UI.
--
-- Important:
--   Apply manually in Supabase SQL Editor only after running the verify query
--   below. This migration intentionally does not truncate existing data.

begin;

do $$
begin
  if exists (
    select 1 from public.chats
    where name is not null and char_length(name) > 64
  ) then
    raise exception 'Cannot apply: chats.name values longer than 64 exist. Run verify SQL and clean them manually first.';
  end if;

  if exists (
    select 1 from public.folders
    where name is not null and char_length(name) > 64
  ) then
    raise exception 'Cannot apply: folders.name values longer than 64 exist. Run verify SQL and clean them manually first.';
  end if;

  if exists (
    select 1 from public.topics
    where name is not null and char_length(name) > 64
  ) then
    raise exception 'Cannot apply: topics.name values longer than 64 exist. Run verify SQL and clean them manually first.';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chats_name_length_check') then
    alter table public.chats
      add constraint chats_name_length_check
      check (name is null or char_length(name) <= 64);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'folders_name_length_check') then
    alter table public.folders
      add constraint folders_name_length_check
      check (name is null or char_length(name) <= 64);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'topics_name_length_check') then
    alter table public.topics
      add constraint topics_name_length_check
      check (name is null or char_length(name) <= 64);
  end if;
end $$;

commit;

-- Verify SQL before applying:
-- select 'chats' as table_name, id::text, name, char_length(name) as length
-- from public.chats
-- where name is not null and char_length(name) > 64
-- union all
-- select 'folders', id::text, name, char_length(name)
-- from public.folders
-- where name is not null and char_length(name) > 64
-- union all
-- select 'topics', id::text, name, char_length(name)
-- from public.topics
-- where name is not null and char_length(name) > 64;
--
-- Verify after applying:
-- select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conname in (
--   'chats_name_length_check',
--   'folders_name_length_check',
--   'topics_name_length_check'
-- )
-- order by conname;
