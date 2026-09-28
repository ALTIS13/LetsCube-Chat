-- Rollback of 20260928200000_profile_badges_since.sql. Revert the web client
-- first or not at all: a client that reads `since` treats a missing column as
-- no date. Run as supabase_admin. The function goes back to its eight columns,
-- text for text, with its comment and grants.
begin;

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
  rank integer
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
           r.priority as rank
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
           (100000 - a.sort_order) as rank
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
begin
  if pg_get_function_result('public.profile_badges(uuid[])'::regprocedure)
       <> 'TABLE(user_id uuid, kind text, key text, title text, detail text, icon text, colour text, rank integer)'
     or (select proacl::text from pg_proc where oid = 'public.profile_badges(uuid[])'::regprocedure)
       is distinct from '{supabase_admin=X/supabase_admin,authenticated=X/supabase_admin}' then
    raise exception 'profile_badges_since_rollback_incomplete';
  end if;
end;
$$;

commit;
