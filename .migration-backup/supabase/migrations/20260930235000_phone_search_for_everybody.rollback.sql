/**
 * Rollback of 20260930235000_phone_search_for_everybody.sql: the lookup goes
 * back to staff with `users.view` only, exactly as it stood from 20260801112259
 * until this change, and the setting and the log are dropped.
 *
 * Roll the client back first: it offers the setting and writes the column.
 */
begin;
set local lock_timeout = '5s';
set local search_path = pg_catalog, pg_temp;

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
comment on column public.profile_contacts.phone_discoverable is null;
comment on function public.profile_phone_set_discoverable(boolean) is null;

drop table if exists private.phone_lookups;
alter table public.privacy_preferences drop constraint if exists privacy_preferences_phone_findable_by_check;
alter table public.privacy_preferences drop column if exists phone_findable_by;

do $$
declare
  v_rpc oid := 'public.search_profiles_by_phone(text, integer)'::regprocedure;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'privacy_preferences' and column_name = 'phone_findable_by')
     or to_regclass('private.phone_lookups') is not null
     or (select provolatile from pg_proc where oid = v_rpc) is distinct from 's'::"char"
     or (select prosecdef from pg_proc where oid = v_rpc) is distinct from true
     or (select proconfig from pg_proc where oid = v_rpc)
        is distinct from array['search_path=pg_catalog, public']::text[]
     or not has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     or has_function_privilege('anon', v_rpc, 'EXECUTE')
     or has_function_privilege('service_role', v_rpc, 'EXECUTE')
     or col_description('public.profile_contacts'::regclass,
          (select attnum from pg_attribute where attrelid = 'public.profile_contacts'::regclass and attname = 'phone_discoverable')) is not null
     or obj_description('public.profile_phone_set_discoverable(boolean)'::regprocedure, 'pg_proc') is not null then
    raise exception 'phone_search_rollback_incomplete';
  end if;
end;
$$;

commit;
