/**
 * Rollback for 20260918120000_chat_roles_and_member_tags.sql.
 *
 * Every role a group has defined and every tag anybody wears is discarded, and
 * there is no way to get them back short of a restore. Worth knowing before
 * running this rather than after.
 *
 * Nothing outside the two new tables and the two `private` trigger functions is
 * touched, because nothing outside them was changed: no column was added to an
 * existing table, no policy on an existing table was rewritten, and the three
 * dead chat-scope rows in `public.roles` were left exactly as they were found.
 * The last of those is asserted rather than assumed.
 *
 * Run as `postgres`, the same role that applied it.
 */

begin;

set local lock_timeout = '5s';

do $unpublish$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'chat_member_roles'
  ) then
    alter publication supabase_realtime drop table public.chat_member_roles;
    raise notice 'unpublished public.chat_member_roles';
  end if;

  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'chat_roles'
  ) then
    alter publication supabase_realtime drop table public.chat_roles;
    raise notice 'unpublished public.chat_roles';
  end if;
end
$unpublish$;

drop trigger if exists trg_enforce_chat_member_role_rules on public.chat_member_roles;
drop trigger if exists trg_enforce_chat_role_rules on public.chat_roles;

drop function if exists private.enforce_chat_member_role_rules();
drop function if exists private.enforce_chat_role_rules();

-- chat_member_roles first: it holds the foreign keys.
drop table if exists public.chat_member_roles;
drop table if exists public.chat_roles;

do $check$
begin
  if pg_catalog.to_regclass('public.chat_member_roles') is not null
     or pg_catalog.to_regclass('public.chat_roles') is not null then
    raise exception 'a table survived its own rollback';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('enforce_chat_role_rules', 'enforce_chat_member_role_rules')
  ) then
    raise exception 'a trigger function survived its own rollback';
  end if;

  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('chat_roles', 'chat_member_roles')
  ) then
    raise exception 'a dropped table is still listed in supabase_realtime';
  end if;

  -- Neither the migration nor this rollback may touch the catalogue.
  if (select pg_catalog.count(*) from public.roles where scope = 'chat') <> 3 then
    raise exception 'the rollback disturbed the chat-scope roles catalogue';
  end if;
  if exists (select 1 from public.roles where scope = 'chat' and (is_active or badge_public)) then
    raise exception 'a dead chat-scope role is no longer dead';
  end if;

  -- And chat_members must be exactly as it was: no column, no constraint, no
  -- trigger of ours was ever added to it, and the composite key it lent out is
  -- its own primary key, which must still be there.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.chat_members'::regclass
       and conname = 'chat_members_pkey' and contype = 'p'
  ) then
    raise exception 'chat_members lost its primary key';
  end if;

  raise notice 'the per-group roles are gone and nothing else moved';
end
$check$;

commit;
