/**
 * Rollback for 20260913140000_profile_badges.sql (D-180).
 *
 * Order matters: the function goes before the columns it reads, so nothing can
 * call it against a table that has lost them mid-transaction.
 *
 * Dropping the columns discards which roles were worn. That is four rows of
 * seed, restated in the migration itself, so nothing irreplaceable is lost —
 * but it is worth knowing before running this rather than after.
 *
 * After this the product is where it was this morning: a person sees their own
 * roles and nobody else's, and `ProfileRoleSummary` is an administrator's
 * component again.
 */

begin;

set local lock_timeout = '5s';

drop function if exists public.profile_badges(uuid[]);

alter table public.roles
  drop constraint if exists roles_badge_icon_format_check;

alter table public.roles
  drop column if exists badge_icon,
  drop column if exists badge_public;

do $check$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'profile_badges'
  ) then
    raise exception 'profile_badges survived its own rollback';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'roles'
       and column_name in ('badge_icon', 'badge_public')
  ) then
    raise exception 'a badge column survived the rollback';
  end if;
end
$check$;

commit;
