-- Tracker item 38: a badge says since when. The owner, 2026-09-20: a badge
-- carries history, «условно купил подписку с такого числа, админ приложения
-- или т.п». Approved by the owner on 2026-09-28 with the rest of
-- docs/operations/2026-09-28-database-proposals.md (entry 7).
--
-- The grants already hold their dates: `user_global_roles.assigned_at` and
-- `user_achievements.granted_at`, both not null. `profile_badges` did not
-- return them. It gains one column, `since`, and nothing else changes: every
-- other column, the filters, the bound of 200 ids, and the answers to a
-- banned or signed-out caller are the function as it stood. CREATE OR
-- REPLACE cannot change a result's columns, so the function is dropped and
-- created in one transaction. Its comment and grants are restored as they
-- were: EXECUTE for authenticated only.
--
-- Run as supabase_admin, the function's owner; `postgres` cannot drop it.
--
-- Rollback: 20260928200000_profile_badges_since.rollback.sql.
begin;

-- The comparison below asks as a signed-in reader, because the function
-- answers nothing without one: any account that is not banned.
do $$
declare
  v_reader uuid;
begin
  select p.id into v_reader
    from public.profiles p
   where not public.is_banned(p.id)
   order by p.created_at
   limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_reader, 'role', 'authenticated')::text, true);
end;
$$;

create temporary table _badge_holders on commit drop as
select array(
  select holder.user_id
    from (
      select ugr.user_id from public.user_global_roles ugr
      union
      select ua.user_id from public.user_achievements ua
    ) as holder
   order by holder.user_id
   limit 200
) as ids;

create temporary table _badges_before on commit drop as
select * from public.profile_badges((select ids from _badge_holders));

drop function public.profile_badges(uuid[]);

create function public.profile_badges(p_user_ids uuid[])
returns table (
  user_id uuid,
  kind text,
  key text,
  title text,
  detail text,
  icon text,
  colour text,
  rank integer,
  since timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $function$
declare
  v_caller uuid := auth.uid();
  v_count integer := coalesce(array_length(p_user_ids, 1), 0);
begin
  if v_caller is null then
    return;
  end if;
  if v_count > 200 then
    raise exception 'too_many_ids' using errcode = '22023';
  end if;
  if v_count = 0 then
    return;
  end if;
  if public.is_banned(v_caller) then
    return;
  end if;

  return query
    select ugr.user_id,
           'global_role'::text as kind,
           r.key,
           r.name as title,
           r.description as detail,
           r.badge_icon as icon,
           r.colour,
           r.priority as rank,
           ugr.assigned_at as since
      from public.user_global_roles ugr
      join public.roles r on r.id = ugr.role_id
      join public.profiles p on p.id = ugr.user_id
     where ugr.user_id = any (p_user_ids)
       and r.scope = 'global'
       and r.is_active
       and r.badge_public
       and not coalesce(p.is_test_account, false)
    union all
    select ua.user_id,
           'achievement'::text as kind,
           a.key,
           a.title,
           a.description as detail,
           a.icon,
           null::text as colour,
           (100000 - a.sort_order) as rank,
           ua.granted_at as since
      from public.user_achievements ua
      join public.achievements a on a.key = ua.achievement_key
      join public.profiles p on p.id = ua.user_id
     where ua.user_id = any (p_user_ids)
       and a.active
       and not coalesce(p.is_test_account, false);
end;
$function$;

revoke all on function public.profile_badges(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.profile_badges(uuid[]) to authenticated;

comment on function public.profile_badges(uuid[]) is
  'The badges other people may see: public global roles and granted achievements, presentation fields only (D-180).';

do $$
declare
  v_fn regprocedure := 'public.profile_badges(uuid[])'::regprocedure;
begin
  if (select count(*) from _badges_before) = 0 then
    raise exception 'profile_badges_since_no_sample';
  end if;
  if exists (
    select user_id, kind, key, title, detail, icon, colour, rank from _badges_before
    except all
    select user_id, kind, key, title, detail, icon, colour, rank
      from public.profile_badges((select ids from _badge_holders))
  ) or exists (
    select user_id, kind, key, title, detail, icon, colour, rank
      from public.profile_badges((select ids from _badge_holders))
    except all
    select user_id, kind, key, title, detail, icon, colour, rank from _badges_before
  ) then
    raise exception 'profile_badges_since_changed_other_columns';
  end if;
  if exists (select 1 from public.profile_badges((select ids from _badge_holders)) where since is null) then
    raise exception 'profile_badges_since_missing';
  end if;
  if (select proacl::text from pg_proc where oid = v_fn)
       is distinct from '{supabase_admin=X/supabase_admin,authenticated=X/supabase_admin}'
     or (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn) <> 'supabase_admin'
     or (select provolatile from pg_proc where oid = v_fn) <> 's'
     or not (select prosecdef from pg_proc where oid = v_fn)
     or obj_description(v_fn, 'pg_proc') is null then
    raise exception 'profile_badges_since_wrong_definition';
  end if;
end;
$$;

commit;
