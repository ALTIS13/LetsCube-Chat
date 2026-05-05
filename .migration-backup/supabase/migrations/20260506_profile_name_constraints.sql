-- Purpose:
--   Add database-level guardrails for profile display fields so a user cannot
--   save extremely long names that break chat/sidebar/admin UI.
--
-- Dependencies:
--   public.profiles(id, username, full_name, bio)
--
-- Important:
--   This file is a proposal for manual execution in Supabase SQL Editor.
--   Do not apply it through MCP/Codex.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format_length_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format_length_check
      check (
        username is null
        or username ~ '^[A-Za-z0-9_.]{1,32}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_full_name_length_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_full_name_length_check
      check (
        full_name is null
        or (
          char_length(btrim(full_name)) between 1 and 64
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_bio_length_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_bio_length_check
      check (
        bio is null
        or char_length(bio) <= 70
      );
  end if;
end $$;

commit;

-- Verify SQL before applying:
-- select
--   count(*) filter (where username is not null and username !~ '^[A-Za-z0-9_.]{1,32}$') as invalid_usernames,
--   count(*) filter (where username is not null and char_length(username) > 32) as usernames_over_32,
--   count(*) filter (where full_name is not null and (char_length(btrim(full_name)) = 0 or char_length(btrim(full_name)) > 64)) as invalid_full_names,
--   count(*) filter (where bio is not null and char_length(bio) > 70) as bios_over_70
-- from public.profiles;
--
-- Verify SQL after applying:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.profiles'::regclass
--   and conname in (
--     'profiles_username_format_length_check',
--     'profiles_full_name_length_check',
--     'profiles_bio_length_check'
--   )
-- order by conname;
--
-- Manual QA checklist:
-- 1. User can save a normal full name and optional username.
-- 2. UI blocks full_name > 64 and username > 32 before submit.
-- 3. SQL rejects direct profile updates that exceed limits.
-- 4. Sidebar, chat list, admin users and settings do not overflow with max-length values.
--
-- Rollback / compatibility notes:
-- alter table public.profiles drop constraint if exists profiles_username_format_length_check;
-- alter table public.profiles drop constraint if exists profiles_full_name_length_check;
-- alter table public.profiles drop constraint if exists profiles_bio_length_check;
