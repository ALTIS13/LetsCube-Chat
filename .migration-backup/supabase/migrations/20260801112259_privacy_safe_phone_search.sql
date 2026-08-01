begin;

do $migration_guard$
begin
  if to_regclass('public.profile_contacts') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.has_permission(uuid,text)') is null
     or to_regprocedure('public.is_banned(uuid)') is null then
    raise exception 'privacy-safe phone search prerequisites are missing';
  end if;
end
$migration_guard$;

create or replace function public.search_profiles_by_phone(
  p_query text,
  p_limit integer default 10
)
returns table (
  id uuid,
  title text,
  subtitle text,
  avatar_url text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid;
  v_phone text;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 10);
begin
  if auth.uid() is null then
    return;
  end if;

  v_actor := auth.uid();
  if public.is_banned(v_actor)
     or not public.has_permission(v_actor, 'users.view') then
    return;
  end if;

  if p_query is null or p_query !~ '^\+[0-9 ()-]{7,24}$' then
    return;
  end if;

  v_phone := regexp_replace(btrim(p_query), '[ ()-]', '', 'g');
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return;
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(btrim(profile.full_name), ''),
      case when profile.username is not null then '@' || profile.username end,
      'Пользователь'
    ) as title,
    case
      when profile.username is not null then '@' || profile.username
      else 'Профиль'
    end as subtitle,
    profile.avatar_url,
    profile.updated_at as created_at
  from public.profile_contacts contact
  join public.profiles profile on profile.id = contact.user_id
  where contact.phone_verified is true
    and contact.phone = v_phone
  order by profile.updated_at desc, profile.id
  limit v_limit;
end
$function$;

revoke all on function public.search_profiles_by_phone(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_profiles_by_phone(text, integer)
  to authenticated;

comment on function public.search_profiles_by_phone(text, integer) is
  'Returns a bounded profile-only projection for an exact verified E.164 lookup. Requires users.view and never returns the phone value.';

commit;
