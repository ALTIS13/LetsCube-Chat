-- Synthetic dependency slice, not a production dump. Auth/normalization and
-- the pre-item-74 RPC match read-only PG17.6 inspection on 2026-10-01.
begin;
create role postgres nologin bypassrls;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private authorization postgres;
alter schema public owner to postgres;
grant usage on schema public, auth to anon, authenticated, service_role;
grant usage on schema auth to postgres;
create function auth.uid() returns uuid language sql stable as $function$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$function$;
create table auth.users (id uuid primary key);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, full_name text, username text, avatar_url text,
  updated_at timestamptz not null default now(), staff boolean not null default false,
  banned boolean not null default false
);
create table public.profile_contacts (
  user_id uuid primary key references public.profiles(id), phone text,
  phone_verified boolean not null default false, phone_discoverable boolean not null default false
);
-- These columns/defaults, check, policies, grants and update trigger match
-- the read-only production catalog; no live preference values are copied.
create table public.privacy_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  presence_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  forward_origin_visible boolean not null default true,
  manual_status text not null default 'online',
  manual_status_until timestamptz,
  last_active_at timestamptz,
  constraint privacy_preferences_manual_status_check check (
    manual_status in ('online', 'idle', 'dnd', 'invisible')
    and (manual_status <> 'online' or manual_status_until is null)
  )
);
create table public.user_blocks (blocker_id uuid, blocked_id uuid);
create table public.user_contacts (owner_user_id uuid, contact_user_id uuid);
alter table public.profiles owner to postgres;
alter table public.profile_contacts owner to postgres;
alter table public.privacy_preferences owner to postgres;
alter table public.user_blocks owner to postgres;
alter table public.user_contacts owner to postgres;
alter table public.profiles enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.privacy_preferences enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_contacts enable row level security;
grant select, insert, update, delete on public.privacy_preferences to anon, authenticated, service_role;
create policy "privacy_preferences own delete" on public.privacy_preferences for delete to public using (auth.uid() = user_id);
create policy "privacy_preferences own insert" on public.privacy_preferences for insert to public with check (auth.uid() = user_id);
create policy "privacy_preferences own select" on public.privacy_preferences for select to public using (auth.uid() = user_id);
create policy "privacy_preferences own update" on public.privacy_preferences for update to public using (auth.uid() = user_id) with check (auth.uid() = user_id);
create function public.privacy_preferences_touch_updated_at() returns trigger language plpgsql set search_path = '' as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
create trigger privacy_preferences_set_updated_at before update on public.privacy_preferences
  for each row execute function public.privacy_preferences_touch_updated_at();
-- Permission fixtures are deliberate stubs; full production RLS and roles
-- are outside this migration's isolated quota rehearsal.
create function public.is_banned(actor uuid) returns boolean language sql stable security definer
  set search_path = pg_catalog, pg_temp as $function$
  select coalesce((select banned from public.profiles where id = actor), false)
$function$;
create function public.has_permission(actor uuid, permission text) returns boolean
  language sql stable security definer set search_path = pg_catalog, pg_temp as $function$
  select coalesce((select staff from public.profiles where id = actor), false) and permission = 'users.view'
$function$;
create function public._normalize_phone_e164(p text) returns text language plpgsql immutable as $function$
declare v text;
begin
  if p is null then return null; end if;
  v := regexp_replace(p, '[^0-9+]', '', 'g');
  if v = '' or v = '+' then return null; end if;
  if left(v, 1) = '+' then
    v := '+' || regexp_replace(substring(v from 2), '\D', '', 'g');
  elsif left(v, 1) = '8' and length(v) = 11 then
    v := '+7' || substring(v from 2);
  elsif length(v) = 10 then
    v := '+7' || v;
  else
    v := '+' || v;
  end if;
  return v;
end
$function$;
create function public.profile_phone_set_discoverable(boolean) returns void language sql as $function$
  select null::void
$function$;
create function public.search_profiles_by_phone(p_query text, p_limit integer default 10)
returns table(id uuid, title text, subtitle text, avatar_url text, created_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public as $function$
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
alter function public.search_profiles_by_phone(text, integer) owner to postgres;
revoke all on function public.search_profiles_by_phone(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_profiles_by_phone(text, integer) to authenticated;
comment on function public.search_profiles_by_phone(text, integer) is
  'Returns a bounded profile-only projection for an exact verified E.164 lookup. Requires users.view and never returns the phone value.';
insert into auth.users(id) select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 5) as n;
insert into public.profiles(id, full_name, username, staff, banned) values
  ('00000000-0000-0000-0000-000000000001', 'Fixture Actor', 'fixture_actor', false, false),
  ('00000000-0000-0000-0000-000000000002', 'Fixture Target', 'fixture_target', false, false),
  ('00000000-0000-0000-0000-000000000003', 'Fixture Staff', 'fixture_staff', true, false),
  ('00000000-0000-0000-0000-000000000004', 'Fixture Banned', 'fixture_banned', false, true),
  ('00000000-0000-0000-0000-000000000005', 'Fixture Other', 'fixture_other', false, false);
insert into public.profile_contacts(user_id, phone, phone_verified) values
  ('00000000-0000-0000-0000-000000000002', '+19995550199', true);
insert into public.privacy_preferences(user_id) select id from public.profiles;
commit;
